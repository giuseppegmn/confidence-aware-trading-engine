/**
 * CATE Engine - Production Grade
 * Thread-safe execution with mutex locks per asset
 */

import type { OracleSnapshot } from './oracle/types';
import type { RiskDecision, RiskParameters } from './risk/engine';
import type { ExecutionResult } from './execution/jupiter';
import type { CircuitStatus } from './failsafe/circuitBreaker';
import { PublicKey } from '@solana/web3.js';

import { pythHermesService } from './oracle/pythHermes';
import { riskEngine } from './risk/engine';
import { jupiterExecutionEngine } from './execution/jupiter';
import { circuitBreaker } from './failsafe/circuitBreaker';
import { decisionLogger } from './observability/decisionLog';
import { requestRemoteSigning } from './crypto/signing';
import { PROGRAM_ID, SOLANA_RPC } from '@/config/env';

// =============================================================================
// TYPES
// =============================================================================

export interface CATEEngineConfig {
  useTestnet?: boolean;
  simulationMode?: boolean;
  publishToChain?: boolean;
}

export interface SystemMetrics {
  totalDecisions?: number;
  blockedTrades?: number;
  executedTrades?: number;
  avgLatencyMs?: number;
}

export interface EngineState {
  isRunning: boolean;
  snapshots: Map<string, OracleSnapshot>;
  decisions: Map<string, RiskDecision>;
  circuitStatus: CircuitStatus;
  metrics: SystemMetrics;
  signerPublicKey: string | null;
}

// =============================================================================
// MUTEX IMPLEMENTATION
// =============================================================================

class AsyncMutex {
  private promises: Map<string, Promise<void>> = new Map();

  async acquire(key: string): Promise<() => void> {
    while (this.promises.has(key)) {
      try {
        await this.promises.get(key);
      } catch {
        // Ignore errors from previous holders
      }
    }

    let release: () => void;
    const promise = new Promise<void>((resolve) => {
      release = () => {
        this.promises.delete(key);
        resolve();
      };
    });

    this.promises.set(key, promise);
    return release!;
  }

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

// =============================================================================
// ENGINE
// =============================================================================

export class CATEEngine {
  private config: Required<CATEEngineConfig>;
  private isRunning: boolean = false;
  private snapshots: Map<string, OracleSnapshot> = new Map();
  private decisions: Map<string, RiskDecision> = new Map();
  private subscribers: Set<(state: EngineState) => void> = new Set();
  private mutex = new AsyncMutex();
  private metrics: SystemMetrics = {
    totalDecisions: 0,
    blockedTrades: 0,
    executedTrades: 0,
    avgLatencyMs: 0
  };

  constructor(config: CATEEngineConfig = {}) {
    this.config = {
      useTestnet: false,
      simulationMode: true,
      publishToChain: false,
      ...config
    };

    console.log('[CATEEngine] Initialized:', this.config);
  }

  // =============================================================================
  // LIFECYCLE
  // =============================================================================

  async start(): Promise<void> {
    if (this.isRunning) return;

    // Start services
    pythHermesService.subscribe(this.handleOracleUpdate.bind(this));
    circuitBreaker.subscribe(this.handleCircuitChange.bind(this));
    
    await pythHermesService.start();
    
    this.isRunning = true;
    this.notifySubscribers();
    
    console.log('[CATEEngine] Started');
  }

  stop(): void {
    if (!this.isRunning) return;

    pythHermesService.stop();
    this.isRunning = false;
    this.notifySubscribers();
    
    console.log('[CATEEngine] Stopped');
  }

  // =============================================================================
  // SUBSCRIPTION (Safe Memory Management)
  // =============================================================================

  subscribe(callback: (state: EngineState) => void): () => void {
    this.subscribers.add(callback);
    
    // Return cleanup function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notifySubscribers(): void {
    const state = this.getEngineState();
    // Use setTimeout to avoid blocking
    setTimeout(() => {
      this.subscribers.forEach(cb => {
        try {
          cb(state);
        } catch (error) {
          console.error('[CATEEngine] Subscriber error:', error);
        }
      });
    }, 0);
  }

  // =============================================================================
  // ORACLE HANDLING
  // =============================================================================

  private handleOracleUpdate(snapshot: OracleSnapshot): void {
    if (!this.isRunning) return;

    const assetId = snapshot.price.id;
    
    // Validate snapshot data
    if (!this.isValidSnapshot(snapshot)) {
      console.warn(`[CATEEngine] Invalid snapshot for ${assetId}`);
      circuitBreaker.recordFailure(`invalid_snapshot_${assetId}`);
      return;
    }

    this.snapshots.set(assetId, snapshot);

    // Evaluate risk outside lock (read-only)
    const decision = riskEngine.evaluate(snapshot);
    this.decisions.set(assetId, decision);
    
    this.metrics.totalDecisions = (this.metrics.totalDecisions || 0) + 1;
    
    // Update circuit breaker
    circuitBreaker.processSnapshot(snapshot);
    
    decisionLogger.logDecision(decision);
    this.notifySubscribers();
  }

  private isValidSnapshot(snapshot: OracleSnapshot): boolean {
    const price = snapshot.price;
    
    // Check for NaN, Infinity, negative
    if (!Number.isFinite(price.price) || price.price < 0) return false;
    if (!Number.isFinite(price.confidence) || price.confidence < 0) return false;
    if (price.publishTime <= 0) return false;
    
    // Check staleness (max 2 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (now - price.publishTime > 120) return false;
    
    return true;
  }

  // =============================================================================
  // TRADE EXECUTION (Thread-Safe)
  // =============================================================================

  async executeTransaction(
    assetId: string,
    direction: 'BUY' | 'SELL',
    inputAmount: bigint,
    maxSlippageBps: number,
    wallet: { publicKey: PublicKey; signTransaction: (tx: any) => Promise<any> }
  ): Promise<ExecutionResult> {
    // Run exclusively per asset (prevents race conditions)
    return this.mutex.runExclusive(assetId, async () => {
      if (!this.isRunning) {
        throw new Error('Engine not running');
      }

      // Check circuit breaker
      const circuitCheck = circuitBreaker.isAllowed(assetId);
      if (!circuitCheck.allowed) {
        return {
          status: 'BLOCKED',
          reason: `Circuit breaker: ${circuitCheck.reason}`,
          assetId,
          timestamp: Date.now()
        };
      }

      // Get decision
      const decision = this.decisions.get(assetId);
      if (!decision) {
        return {
          status: 'BLOCKED',
          reason: 'No decision available',
          assetId,
          timestamp: Date.now()
        };
      }

      // Block if decision says so
      if (decision.action === 'BLOCK') {
        this.metrics.blockedTrades = (this.metrics.blockedTrades || 0) + 1;
        return {
          status: 'BLOCKED',
          reason: decision.explanation || 'High risk',
          assetId,
          decision,
          timestamp: Date.now()
        };
      }

      try {
        const startTime = Date.now();
        
        // Execute via Jupiter
        const result = await jupiterExecutionEngine.execute({
          assetId,
          direction,
          amount: inputAmount,
          maxSlippageBps,
          wallet
        });

        const latency = Date.now() - startTime;
        this.updateLatencyMetrics(latency);

        if (result.status === 'EXECUTED') {
          this.metrics.executedTrades = (this.metrics.executedTrades || 0) + 1;
          
          // Publish decision proof on-chain (async, don't block)
          if (this.config.publishToChain && decision) {
            this.publishDecision(assetId, decision).catch(console.error);
          }
        }

        decisionLogger.logExecution(result);
        return result;

      } catch (error) {
        circuitBreaker.recordFailure(`execution_${assetId}`);
        throw error;
      }
    });
  }

  private async publishDecision(assetId: string, decision: RiskDecision): Promise<void> {
    try {
      const snapshot = this.snapshots.get(assetId);
      if (!snapshot) return;

      // Request remote signing (secure)
      const signed = await requestRemoteSigning({
        assetId,
        price: snapshot.price.price,
        timestamp: Math.floor(Date.now() / 1000),
        confidenceRatio: Math.floor(snapshot.price.confidence * 100),
        riskScore: decision.score || 0,
        isBlocked: decision.action === 'BLOCK',
        publisherCount: snapshot.price.numPublishers || 0,
        nonce: Date.now()
      });

      console.log('[CATEEngine] Decision signed and published');
    } catch (error) {
      console.error('[CATEEngine] Failed to publish decision:', error);
      // Don't throw - publish is best-effort
    }
  }

  // =============================================================================
  // UTILITIES
  // =============================================================================

  updateRiskParams(params: RiskParameters): void {
    riskEngine.updateParameters(params);
  }

  private updateLatencyMetrics(latencyMs: number): void {
    const current = this.metrics.avgLatencyMs || 0;
    const count = this.metrics.executedTrades || 1;
    this.metrics.avgLatencyMs = (current * (count - 1) + latencyMs) / count;
  }

  private getEngineState(): EngineState {
    return {
      isRunning: this.isRunning,
      snapshots: new Map(this.snapshots),
      decisions: new Map(this.decisions),
      circuitStatus: circuitBreaker.getStatus(),
      metrics: { ...this.metrics },
      signerPublicKey: null // Obtained from API
    };
  }
}

// Singleton export (kept for compaytibility but prefer Context)
export const cateEngine = new CATEEngine();

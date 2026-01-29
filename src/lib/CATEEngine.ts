/**
 * CATE - Confidence-Aware Trading Engine
 *
 * Production-grade integration layer...
 */

import type { OracleSnapshot, OracleEvent, ConnectionState } from './oracle/types';
import type { RiskDecision, RiskParameters } from './risk/engine';
import type { ExecutionResult } from './execution/jupiter';
import type { SignedDecision } from './crypto/signing';
import type { CircuitStatus } from './failsafe/circuitBreaker';
import type { SystemMetrics } from './observability/decisionLog';

import { pythHermesService, SUPPORTED_ASSETS } from './oracle/pythHermes';
import { riskEngine } from './risk/engine';
import { getSigningEngine } from './crypto/signing';
import { jupiterExecutionEngine } from './execution/jupiter';
import { circuitBreaker } from './failsafe/circuitBreaker';
import { decisionLogger } from './observability/decisionLog';
import { onChainTrustService } from './chain/onChainTrust';

// ============================================
// TYPES
// ============================================

export interface CATEEngineConfig {
  useTestnet: boolean;
  simulationMode: boolean;
  autoStart: boolean;
  requireLiveOracle: boolean;
  publishToChain: boolean;
}

export interface EngineStatus {
  isRunning: boolean;
  oracleStatus: ConnectionState;
  circuitStatus: CircuitStatus;
  metrics: SystemMetrics;
  signerPublicKey: string;
  chainConfigInitialized: boolean;
  lastUpdate: number;
}

// ============================================
// DEFAULT CONFIG
// ============================================

const DEFAULT_CONFIG: CATEEngineConfig = {
  useTestnet: false,
  simulationMode: true,
  autoStart: true,
  requireLiveOracle: true,
  publishToChain: false,
};

// ============================================
// ENGINE STATE TYPE
// ============================================

export interface EngineState {
  isRunning: boolean;
  snapshots: Map<string, OracleSnapshot>;
  decisions: Map<string, RiskDecision>;
  status: EngineStatus;
  metrics: SystemMetrics;
  circuitStatus: CircuitStatus;
  recentExecutions: ExecutionResult[];
}

// ============================================
// CATE ENGINE
// ============================================

export class CATEEngine {
  private config: CATEEngineConfig;
  private isRunning: boolean = false;
  private snapshots: Map<string, OracleSnapshot> = new Map();
  private decisions: Map<string, RiskDecision> = new Map();
  private subscribers: Set<(state: EngineState) => void> = new Set();

  constructor(config: Partial<CATEEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Configure risk engine
    riskEngine.updateParameters({
      requireLiveOracle: this.config.requireLiveOracle,
    });

    // Configure execution engine
    jupiterExecutionEngine.setSimulationMode(this.config.simulationMode);

    console.log('[CATEEngine] Initialized with config:', this.config);
    console.log('[CATEEngine] Signer public key:', getSigningEngine().getPublicKey());
  }

  // ==========================================
  // LIFECYCLE
  // ==========================================

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('[CATEEngine] Starting...');

    pythHermesService.subscribeToEvents(this.handleOracleEvent.bind(this));
    pythHermesService.subscribe(this.handleOracleUpdate.bind(this));
    circuitBreaker.subscribe(this.handleCircuitChange.bind(this));

    await pythHermesService.start();

    this.isRunning = true;
    console.log('[CATEEngine] Started');

    this.notifySubscribers();
  }

  stop(): void {
    if (!this.isRunning) return;

    console.log('[CATEEngine] Stopping...');

    pythHermesService.stop();
    this.isRunning = false;

    console.log('[CATEEngine] Stopped');
    this.notifySubscribers();
  }

  // ==========================================
  // ORACLE HANDLING
  // ==========================================

  private handleOracleUpdate(newSnapshots: Map<string, OracleSnapshot>): void {
    this.snapshots = newSnapshots;

    for (const [assetId, snapshot] of newSnapshots) {
      circuitBreaker.processSnapshot(snapshot);

      const { allowed, reason } = circuitBreaker.isAllowed(assetId);

      if (allowed) {
        const decision = riskEngine.evaluate(snapshot);
        this.decisions.set(assetId, decision);
        decisionLogger.logDecision(decision);
      } else {
        const blockedDecision = this.createBlockedDecision(snapshot, reason);
        this.decisions.set(assetId, blockedDecision);
        decisionLogger.logDecision(blockedDecision);
      }
    }

    this.notifySubscribers();
  }

  private handleOracleEvent(event: OracleEvent): void {
    decisionLogger.logOracleEvent(event);

    if (event.type === 'CONNECTION_CHANGE') {
      circuitBreaker.processConnectionEvent(event.data.state);
    }
  }

  private handleCircuitChange(status: CircuitStatus): void {
    if (status.state === 'OPEN') {
      console.warn('[CATEEngine] Circuit breaker OPEN - all trading blocked');
    }
    this.notifySubscribers();
  }

  // ==========================================
  // TRADE EXECUTION
  // ==========================================

  async executeTrade(
    assetId: string,
    direction: 'BUY' | 'SELL',
    inputAmount: bigint,
    maxSlippageBps: number,
    wallet?: { publicKey: any; signTransaction: (tx: any) => Promise<any> }
  ): Promise<ExecutionResult> {
    const { allowed, reason } = circuitBreaker.isAllowed(assetId);

    if (!allowed) {
      const snapshot = this.snapshots.get(assetId);
      const blockedDecision = this.createBlockedDecision(snapshot!, `Circuit breaker: ${reason}`);

      const intent = jupiterExecutionEngine.createIntent(
        assetId,
        direction,
        inputAmount,
        maxSlippageBps,
        wallet?.publicKey?.toString() || 'unknown'
      );

      const result: ExecutionResult = {
        intent,
        decision: blockedDecision,
        status: 'BLOCKED',
        actualInputAmount: 0n,
        errorMessage: reason,
        executedAt: Date.now(),
      };

      decisionLogger.logExecution(result);
      return result;
    }

    const decision = this.decisions.get(assetId);
    if (!decision) throw new Error(`No decision available for ${assetId}`);

    const intent = jupiterExecutionEngine.createIntent(
      assetId,
      direction,
      inputAmount,
      maxSlippageBps,
      wallet?.publicKey?.toString() || 'unknown'
    );

    const result = await jupiterExecutionEngine.execute(intent, decision, wallet);
    decisionLogger.logExecution(result);

    if (this.config.publishToChain && result.status === 'EXECUTED' && wallet) {
      this.publishDecisionToChain(decision).catch((err) => {
        console.error('[CATEEngine] Failed to publish to chain:', err);
      });
    }

    return result;
  }

  async executeDemoTrade(wallet?: { publicKey: any; signTransaction: (tx: any) => Promise<any> }): Promise<ExecutionResult> {
    const assets = Array.from(this.snapshots.keys());
    if (assets.length === 0) throw new Error('No assets available');

    const assetId = assets[Math.floor(Math.random() * assets.length)];
    const direction = Math.random() > 0.5 ? 'BUY' : 'SELL';

    const amounts: Record<string, bigint> = {
      'SOL/USD': BigInt(1_000_000_000),
      'BTC/USD': BigInt(100_000),
      'ETH/USD': BigInt(1_000_000),
      'JUP/USD': BigInt(1_000_000_000),
      'BONK/USD': BigInt(1_000_000_000_000),
    };

    const amount = amounts[assetId] || BigInt(1_000_000_000);
    return this.executeTrade(assetId, direction, amount, 100, wallet);
  }

  // ==========================================
  // ON-CHAIN OPERATIONS
  // ==========================================

  async initializeChainConfig(wallet: { publicKey: any; signTransaction: (tx: any) => Promise<any> }): Promise<{ success: boolean; txSignature?: string; error?: string }> {
    onChainTrustService.initializeWithWallet(wallet);
    return onChainTrustService.initializeConfig(getSigningEngine().getPublicKey());
  }

  async publishDecisionToChain(decision: RiskDecision): Promise<{ success: boolean; txSignature?: string; error?: string }> {
    return onChainTrustService.publishDecision(
      decision.signedDecision,
      decision.oracleSnapshot.metrics.confidenceRatio,
      0
    );
  }

  async getOnChainStatus(assetId: string) {
    return onChainTrustService.getRiskStatus(assetId);
  }

  // ==========================================
  // STATE ACCESS
  // ==========================================

  getStatus(): EngineStatus {
    return {
      isRunning: this.isRunning,
      oracleStatus: pythHermesService.getStatus().state,
      circuitStatus: circuitBreaker.getStatus(),
      metrics: decisionLogger.getMetrics(),
      signerPublicKey: getSigningEngine().getPublicKey(),
      chainConfigInitialized: onChainTrustService.isConfigInitialized(),
      lastUpdate: Date.now(),
    };
  }

  getSnapshots(): Map<string, OracleSnapshot> {
    return new Map(this.snapshots);
  }

  getSnapshot(assetId: string): OracleSnapshot | undefined {
    return this.snapshots.get(assetId);
  }

  getDecisions(): Map<string, RiskDecision> {
    return new Map(this.decisions);
  }

  getDecision(assetId: string): RiskDecision | undefined {
    return this.decisions.get(assetId);
  }

  getSupportedAssets() {
    return SUPPORTED_ASSETS;
  }

  getRiskParameters(): RiskParameters {
    return riskEngine.getParameters();
  }

  updateRiskParameters(params: Partial<RiskParameters>): void {
    riskEngine.updateParameters(params);
  }

  getSignerPublicKey(): string {
    return getSigningEngine().getPublicKey();
  }

  isSimulationMode(): boolean {
    return this.config.simulationMode;
  }

  setSimulationMode(enabled: boolean): void {
    this.config.simulationMode = enabled;
    jupiterExecutionEngine.setSimulationMode(enabled);
  }

  // ==========================================
  // SUBSCRIPTION
  // ==========================================

  subscribe(callback: (state: EngineState) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getEngineState());
    return () => this.subscribers.delete(callback);
  }

  private getEngineState(): EngineState {
    return {
      isRunning: this.isRunning,
      snapshots: this.snapshots,
      decisions: this.decisions,
      status: this.getStatus(),
      metrics: decisionLogger.getMetrics(),
      circuitStatus: circuitBreaker.getStatus(),
      recentExecutions: jupiterExecutionEngine.getRecentExecutions(20),
    };
  }

  private notifySubscribers(): void {
    const state = this.getEngineState();
    for (const callback of this.subscribers) {
      try {
        callback(state);
      } catch (error) {
        console.error('[CATEEngine] Subscriber error:', error);
      }
    }
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private createBlockedDecision(snapshot: OracleSnapshot, reason: string): RiskDecision {
    const signedDecision = getSigningEngine().sign(
      snapshot.price.assetId,
      snapshot.price.price,
      snapshot.price.confidence,
      100,
      'BLOCK',
      0,
      `BLOCKED: ${reason}`
    );

    return {
      action: 'BLOCK',
      sizeMultiplier: 0,
      riskScore: 100,
      explanation: `BLOCKED: ${reason}`,
      factors: [
        {
          name: 'Circuit Breaker',
          value: 0,
          threshold: 0,
          impact: -100,
          triggered: true,
          description: reason,
          severity: 'CRITICAL',
        },
      ],
      timestamp: Date.now(),
      oracleSnapshot: snapshot,
      parameters: riskEngine.getParameters(),
      signedDecision,
    };
  }

  // ==========================================
  // EMERGENCY CONTROLS
  // ==========================================

  emergencyStop(reason: string): void {
    circuitBreaker.emergencyStop(reason);
  }

  resetCircuitBreaker(): void {
    circuitBreaker.manualReset();
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const cateEngine = new CATEEngine();

// Re-export types and services for convenience
export { SUPPORTED_ASSETS } from './oracle/pythHermes';
export type { OracleSnapshot, OracleMetrics, AssetConfig } from './oracle/types';
export type { RiskDecision, RiskFactor, RiskAction } from './risk/engine';
export type { ExecutionResult, TradeIntent } from './execution/jupiter';
export type { SignedDecision } from './crypto/signing';
export type { CircuitStatus, CircuitState } from './failsafe/circuitBreaker';
export type { SystemMetrics, DecisionLogEntry, ExecutionLogEntry } from './observability/decisionLog';

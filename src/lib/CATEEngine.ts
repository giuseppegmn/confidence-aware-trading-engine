/**
 * CATE - Confidence-Aware Trading Engine
 * 
 * Production-grade integration layer that connects:
 * - Real Pyth Hermes oracle feeds
 * - Cryptographic decision signing
 * - Risk Intelligence evaluation
 * - Circuit breaker fail-safes
 * - Jupiter execution
 * - On-chain trust layer
 * - Full observability
 * 
 * Design philosophy: Fail closed, never default to unsafe execution.
 */

import type { OracleSnapshot, OracleEvent, ConnectionState } from './oracle/types';
import type { RiskDecision, RiskParameters } from './risk/engine';
import type { ExecutionResult, TradeIntent } from './execution/jupiter';
import type { SignedDecision } from './crypto/signing';
import type { CircuitStatus } from './failsafe/circuitBreaker';
import type { SystemMetrics } from './observability/decisionLog';

import { pythHermesService, SUPPORTED_ASSETS } from './oracle/pythHermes';
import { riskEngine, DEFAULT_RISK_PARAMETERS } from './risk/engine';
import { signingEngine } from './crypto/signing';
import { jupiterExecutionEngine, TOKEN_MINTS } from './execution/jupiter';
import { circuitBreaker } from './failsafe/circuitBreaker';
import { decisionLogger } from './observability/decisionLog';
import { onChainTrustService } from './chain/onChainTrust';

// ============================================
// TYPES
// ============================================

export interface CATEEngineConfig {
  /** Use testnet endpoints */
  useTestnet: boolean;
  
  /** Enable simulation mode for execution */
  simulationMode: boolean;
  
  /** Auto-start oracle on initialization */
  autoStart: boolean;
  
  /** Require live oracle data */
  requireLiveOracle: boolean;
  
  /** Publish decisions to chain */
  publishToChain: boolean;
}

export interface EngineStatus {
  /** Is engine running */
  isRunning: boolean;
  
  /** Oracle status */
  oracleStatus: ConnectionState;
  
  /** Circuit breaker status */
  circuitStatus: CircuitStatus;
  
  /** System metrics */
  metrics: SystemMetrics;
  
  /** Engine public key */
  signerPublicKey: string;
  
  /** On-chain config initialized */
  chainConfigInitialized: boolean;
  
  /** Last update timestamp */
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
    console.log('[CATEEngine] Signer public key:', signingEngine.getPublicKey());
  }
  
  // ==========================================
  // LIFECYCLE
  // ==========================================
  
  /**
   * Start the engine
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    console.log('[CATEEngine] Starting...');
    
    // Subscribe to oracle events
    pythHermesService.subscribeToEvents(this.handleOracleEvent.bind(this));
    
    // Subscribe to oracle updates
    pythHermesService.subscribe(this.handleOracleUpdate.bind(this));
    
    // Subscribe to circuit breaker
    circuitBreaker.subscribe(this.handleCircuitChange.bind(this));
    
    // Start oracle service
    await pythHermesService.start();
    
    this.isRunning = true;
    console.log('[CATEEngine] Started');
    
    this.notifySubscribers();
  }
  
  /**
   * Stop the engine
   */
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
    
    // Process each snapshot through circuit breaker and risk engine
    for (const [assetId, snapshot] of newSnapshots) {
      // Check circuit breaker
      circuitBreaker.processSnapshot(snapshot);
      
      // Evaluate risk
      const { allowed, reason } = circuitBreaker.isAllowed(assetId);
      
      if (allowed) {
        const decision = riskEngine.evaluate(snapshot);
        this.decisions.set(assetId, decision);
        
        // Log decision
        decisionLogger.logDecision(decision);
      } else {
        // Create blocked decision
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
  
  /**
   * Execute a trade with full risk evaluation
   */
  async executeTrade(
    assetId: string,
    direction: 'BUY' | 'SELL',
    inputAmount: bigint,
    maxSlippageBps: number,
    wallet?: { publicKey: any; signTransaction: (tx: any) => Promise<any> }
  ): Promise<ExecutionResult> {
    // Check circuit breaker first
    const { allowed, reason } = circuitBreaker.isAllowed(assetId);
    
    if (!allowed) {
      const snapshot = this.snapshots.get(assetId);
      const blockedDecision = this.createBlockedDecision(
        snapshot!,
        `Circuit breaker: ${reason}`
      );
      
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
    
    // Get current decision
    const decision = this.decisions.get(assetId);
    if (!decision) {
      throw new Error(`No decision available for ${assetId}`);
    }
    
    // Create trade intent
    const intent = jupiterExecutionEngine.createIntent(
      assetId,
      direction,
      inputAmount,
      maxSlippageBps,
      wallet?.publicKey?.toString() || 'unknown'
    );
    
    // Execute through Jupiter
    const result = await jupiterExecutionEngine.execute(intent, decision, wallet);
    
    // Log execution
    decisionLogger.logExecution(result);
    
    // Publish to chain if enabled and executed
    if (this.config.publishToChain && result.status === 'EXECUTED' && wallet) {
      this.publishDecisionToChain(decision).catch(err => {
        console.error('[CATEEngine] Failed to publish to chain:', err);
      });
    }
    
    return result;
  }
  
  /**
   * Create a demo trade for testing
   */
  async executeDemoTrade(
    wallet?: { publicKey: any; signTransaction: (tx: any) => Promise<any> }
  ): Promise<ExecutionResult> {
    const assets = Array.from(this.snapshots.keys());
    if (assets.length === 0) {
      throw new Error('No assets available');
    }
    
    const assetId = assets[Math.floor(Math.random() * assets.length)];
    const direction = Math.random() > 0.5 ? 'BUY' : 'SELL';
    
    // Demo amounts
    const amounts: Record<string, bigint> = {
      'SOL/USD': BigInt(1_000_000_000), // 1 SOL
      'BTC/USD': BigInt(100_000), // 0.001 BTC
      'ETH/USD': BigInt(1_000_000), // 0.001 ETH
      'JUP/USD': BigInt(1_000_000_000), // 1000 JUP
      'BONK/USD': BigInt(1_000_000_000_000), // 1M BONK
    };
    
    const amount = amounts[assetId] || BigInt(1_000_000_000);
    
    return this.executeTrade(assetId, direction, amount, 100, wallet);
  }
  
  // ==========================================
  // ON-CHAIN OPERATIONS
  // ==========================================
  
  /**
   * Initialize on-chain config with engine's public key
   */
  async initializeChainConfig(
    wallet: { publicKey: any; signTransaction: (tx: any) => Promise<any> }
  ): Promise<{ success: boolean; txSignature?: string; error?: string }> {
    onChainTrustService.initializeWithWallet(wallet);
    
    return onChainTrustService.initializeConfig(
      signingEngine.getPublicKey()
    );
  }
  
  /**
   * Publish a decision to chain
   */
  async publishDecisionToChain(decision: RiskDecision): Promise<{ success: boolean; txSignature?: string; error?: string }> {
    return onChainTrustService.publishDecision(
      decision.signedDecision,
      decision.oracleSnapshot.metrics.confidenceRatio,
      0 // Publisher count not available in Hermes
    );
  }
  
  /**
   * Get on-chain status for an asset
   */
  async getOnChainStatus(assetId: string) {
    return onChainTrustService.getRiskStatus(assetId);
  }
  
  // ==========================================
  // STATE ACCESS
  // ==========================================
  
  /**
   * Get engine status
   */
  getStatus(): EngineStatus {
    return {
      isRunning: this.isRunning,
      oracleStatus: pythHermesService.getStatus().state,
      circuitStatus: circuitBreaker.getStatus(),
      metrics: decisionLogger.getMetrics(),
      signerPublicKey: signingEngine.getPublicKey(),
      chainConfigInitialized: onChainTrustService.isConfigInitialized(),
      lastUpdate: Date.now(),
    };
  }
  
  /**
   * Get all snapshots
   */
  getSnapshots(): Map<string, OracleSnapshot> {
    return new Map(this.snapshots);
  }
  
  /**
   * Get snapshot for asset
   */
  getSnapshot(assetId: string): OracleSnapshot | undefined {
    return this.snapshots.get(assetId);
  }
  
  /**
   * Get all decisions
   */
  getDecisions(): Map<string, RiskDecision> {
    return new Map(this.decisions);
  }
  
  /**
   * Get decision for asset
   */
  getDecision(assetId: string): RiskDecision | undefined {
    return this.decisions.get(assetId);
  }
  
  /**
   * Get supported assets
   */
  getSupportedAssets() {
    return SUPPORTED_ASSETS;
  }
  
  /**
   * Get risk parameters
   */
  getRiskParameters(): RiskParameters {
    return riskEngine.getParameters();
  }
  
  /**
   * Update risk parameters
   */
  updateRiskParameters(params: Partial<RiskParameters>): void {
    riskEngine.updateParameters(params);
  }
  
  /**
   * Get signer public key
   */
  getSignerPublicKey(): string {
    return signingEngine.getPublicKey();
  }
  
  /**
   * Is in simulation mode
   */
  isSimulationMode(): boolean {
    return this.config.simulationMode;
  }
  
  /**
   * Set simulation mode
   */
  setSimulationMode(enabled: boolean): void {
    this.config.simulationMode = enabled;
    jupiterExecutionEngine.setSimulationMode(enabled);
  }
  
  // ==========================================
  // SUBSCRIPTION
  // ==========================================
  
  /**
   * Subscribe to engine state updates
   */
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
  
  private createBlockedDecision(
    snapshot: OracleSnapshot,
    reason: string
  ): RiskDecision {
    const signedDecision = signingEngine.sign(
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
      factors: [{
        name: 'Circuit Breaker',
        value: 0,
        threshold: 0,
        impact: -100,
        triggered: true,
        description: reason,
        severity: 'CRITICAL',
      }],
      timestamp: Date.now(),
      oracleSnapshot: snapshot,
      parameters: riskEngine.getParameters(),
      signedDecision,
    };
  }
  
  // ==========================================
  // EMERGENCY CONTROLS
  // ==========================================
  
  /**
   * Emergency stop - trips circuit breaker
   */
  emergencyStop(reason: string): void {
    circuitBreaker.emergencyStop(reason);
  }
  
  /**
   * Manual reset of circuit breaker
   */
  resetCircuitBreaker(): void {
    circuitBreaker.manualReset();
  }
}

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

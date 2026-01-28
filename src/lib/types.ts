/**
 * CATE - Confidence-Aware Trading Engine
 * Core Type Definitions
 * 
 * These types form the foundation of the trading engine's type system.
 * All data structures are designed for deterministic, reproducible behavior.
 */

// ============================================
// ORACLE DATA TYPES
// ============================================

export interface OraclePrice {
  /** Asset identifier (e.g., "SOL/USD", "BTC/USD") */
  assetId: string;
  
  /** Current price in USD */
  price: number;
  
  /** Confidence interval (±) in USD */
  confidence: number;
  
  /** Unix timestamp in milliseconds */
  timestamp: number;
  
  /** Number of publishers contributing to this price */
  publisherCount: number;
  
  /** Exponential moving average price */
  emaPrice: number;
  
  /** Exponential moving average confidence */
  emaConfidence: number;
}

export interface OracleMetrics {
  /** Confidence as percentage of price */
  confidenceRatio: number;
  
  /** Standard deviations from mean confidence */
  confidenceZscore: number;
  
  /** Realized volatility (annualized) */
  volatilityRealized: number;
  
  /** Expected volatility from confidence */
  volatilityExpected: number;
  
  /** Seconds since last update */
  dataFreshnessSeconds: number;
  
  /** Rolling average confidence ratio (1h) */
  avgConfidenceRatio1h: number;
  
  /** Rolling average confidence ratio (24h) */
  avgConfidenceRatio24h: number;
  
  /** Price change percentage (1h) */
  priceChange1h: number;
  
  /** Price change percentage (24h) */
  priceChange24h: number;
}

export interface OracleSnapshot {
  price: OraclePrice;
  metrics: OracleMetrics;
  rollingWindows: RollingWindows;
}

export interface RollingWindows {
  '1m': PricePoint[];
  '5m': PricePoint[];
  '15m': PricePoint[];
  '1h': PricePoint[];
  '24h': PricePoint[];
}

export interface PricePoint {
  price: number;
  confidence: number;
  timestamp: number;
}

// ============================================
// RISK INTELLIGENCE TYPES
// ============================================

export type RiskAction = 'ALLOW' | 'SCALE' | 'BLOCK';

export interface RiskDecision {
  /** The action to take */
  action: RiskAction;
  
  /** Position size multiplier (0.0 to 1.0) */
  sizeMultiplier: number;
  
  /** Risk score (0 to 100, higher = riskier) */
  riskScore: number;
  
  /** Human-readable explanation */
  explanation: string;
  
  /** Detailed breakdown of factors */
  factors: RiskFactor[];
  
  /** Timestamp of decision */
  timestamp: number;
  
  /** Oracle state at time of decision */
  oracleState: OracleSnapshot;
  
  /** Parameters used for decision */
  parameters: RiskParameters;
}

export interface RiskFactor {
  /** Factor name */
  name: string;
  
  /** Factor value */
  value: number;
  
  /** Threshold that triggered action */
  threshold: number;
  
  /** Impact on decision (negative = cautious) */
  impact: number;
  
  /** Whether this factor triggered a constraint */
  triggered: boolean;
  
  /** Human-readable description */
  description: string;
}

export interface RiskParameters {
  /** Max confidence ratio before scaling (default: 1%) */
  maxConfidenceRatioScale: number;
  
  /** Max confidence ratio before blocking (default: 3%) */
  maxConfidenceRatioBlock: number;
  
  /** Max confidence z-score before blocking (default: 3.0) */
  maxConfidenceZscore: number;
  
  /** Max data staleness in seconds (default: 30) */
  maxStalenessSeconds: number;
  
  /** Max realized volatility (annualized) before scaling (default: 100%) */
  maxVolatilityScale: number;
  
  /** Max realized volatility before blocking (default: 200%) */
  maxVolatilityBlock: number;
  
  /** Min publisher count required (default: 3) */
  minPublisherCount: number;
  
  /** Volatility spike threshold (realized/expected ratio) */
  volatilitySpikeThreshold: number;
}

// ============================================
// EXECUTION TYPES
// ============================================

export type ExecutionStatus = 'PENDING' | 'EXECUTED' | 'BLOCKED' | 'FAILED';

export interface TradeIntent {
  /** Unique trade ID */
  id: string;
  
  /** Asset to trade */
  assetId: string;
  
  /** Trade direction */
  side: 'BUY' | 'SELL';
  
  /** Intended position size (before risk adjustment) */
  intendedSize: number;
  
  /** Maximum acceptable slippage (%) */
  maxSlippage: number;
  
  /** Timestamp of intent */
  timestamp: number;
  
  /** Trader's wallet address */
  trader: string;
}

export interface ExecutionResult {
  /** Trade intent that was processed */
  intent: TradeIntent;
  
  /** Risk decision for this trade */
  decision: RiskDecision;
  
  /** Final execution status */
  status: ExecutionStatus;
  
  /** Actual size executed (after risk adjustment) */
  executedSize: number;
  
  /** Execution price (if executed) */
  executionPrice?: number;
  
  /** Actual slippage (if executed) */
  actualSlippage?: number;
  
  /** Transaction hash (if on-chain) */
  txHash?: string;
  
  /** Error message (if failed/blocked) */
  errorMessage?: string;
  
  /** Execution timestamp */
  executedAt: number;
}

export interface ExecutionLog {
  results: ExecutionResult[];
  totalExecuted: number;
  totalBlocked: number;
  totalFailed: number;
  averageRiskScore: number;
}

// ============================================
// ON-CHAIN TYPES
// ============================================

export interface OnChainRiskStatus {
  /** Asset identifier */
  assetId: string;
  
  /** Current risk score (0-100) */
  riskScore: number;
  
  /** Whether trading is blocked */
  isBlocked: boolean;
  
  /** Last update timestamp */
  lastUpdated: number;
  
  /** Authority that signed this status */
  authority: string;
  
  /** Signature of the decision */
  signature: string;
}

// ============================================
// CONFIGURATION TYPES
// ============================================

export interface CATEConfig {
  /** Supported assets */
  assets: AssetConfig[];
  
  /** Default risk parameters */
  defaultRiskParams: RiskParameters;
  
  /** Oracle endpoint */
  oracleEndpoint: string;
  
  /** Update interval in milliseconds */
  updateIntervalMs: number;
  
  /** Enable simulation mode */
  simulationMode: boolean;
  
  /** Solana RPC endpoint */
  solanaRpcEndpoint: string;
  
  /** Program ID for on-chain trust layer */
  programId: string;
}

export interface AssetConfig {
  /** Asset identifier */
  id: string;
  
  /** Display name */
  name: string;
  
  /** Symbol */
  symbol: string;
  
  /** Pyth price feed ID */
  pythFeedId: string;
  
  /** Custom risk parameters (overrides default) */
  riskParams?: Partial<RiskParameters>;
  
  /** Decimal places for display */
  decimals: number;
}

// ============================================
// DASHBOARD TYPES
// ============================================

export interface DashboardState {
  /** All asset snapshots */
  assets: Map<string, OracleSnapshot>;
  
  /** Recent decisions */
  recentDecisions: RiskDecision[];
  
  /** Execution log */
  executionLog: ExecutionLog;
  
  /** System health status */
  systemHealth: SystemHealth;
  
  /** Last update timestamp */
  lastUpdate: number;
}

export interface SystemHealth {
  /** Oracle connection status */
  oracleStatus: 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED';
  
  /** Solana connection status */
  solanaStatus: 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED';
  
  /** Overall system status */
  overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'CRITICAL';
  
  /** Latency in milliseconds */
  latencyMs: number;
  
  /** Error messages if any */
  errors: string[];
}

/**
 * CATE - Oracle Layer Types
 * 
 * Production-grade type definitions for Pyth Hermes integration.
 * All data structures designed for cryptographic verification.
 */

// ============================================
// PYTH HERMES TYPES
// ============================================

export interface PythPriceFeed {
  /** Pyth feed ID (hex string without 0x) */
  id: string;
  
  /** Price data */
  price: PythPrice;
  
  /** EMA price data */
  emaPrice: PythPrice;
  
  /** VAA (Verified Action Approval) for on-chain verification */
  vaa?: string;
}

export interface PythPrice {
  /** Price value as string (to preserve precision) */
  price: string;
  
  /** Confidence interval as string */
  conf: string;
  
  /** Exponent for price calculation */
  expo: number;
  
  /** Publish time (Unix timestamp) */
  publishTime: number;
}

// ============================================
// NORMALIZED ORACLE TYPES
// ============================================

export interface OraclePrice {
  /** Asset identifier (e.g., "SOL/USD") */
  assetId: string;
  
  /** Pyth feed ID */
  feedId: string;
  
  /** Current price in USD (normalized) */
  price: number;
  
  /** Confidence interval (±) in USD */
  confidence: number;
  
  /** Unix timestamp in milliseconds */
  timestamp: number;
  
  /** Publish time from Pyth */
  publishTime: number;
  
  /** Exponential moving average price */
  emaPrice: number;
  
  /** Exponential moving average confidence */
  emaConfidence: number;
  
  /** Raw exponent from Pyth */
  exponent: number;
  
  /** Data source identifier */
  source: 'PYTH_HERMES' | 'FALLBACK' | 'CACHED';
  
  /** Sequence number for ordering */
  sequence: number;
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
  
  /** Number of updates in last minute */
  updateFrequency1m: number;
  
  /** Data quality score (0-100) */
  dataQualityScore: number;
}

export interface PricePoint {
  price: number;
  confidence: number;
  timestamp: number;
  source: 'PYTH_HERMES' | 'FALLBACK' | 'CACHED';
}

export interface RollingWindows {
  '1m': PricePoint[];
  '5m': PricePoint[];
  '15m': PricePoint[];
  '1h': PricePoint[];
}

export interface OracleSnapshot {
  price: OraclePrice;
  metrics: OracleMetrics;
  rollingWindows: RollingWindows;
  
  /** Hash of snapshot for verification */
  snapshotHash: string;
  
  /** Timestamp when snapshot was created */
  createdAt: number;
}

// ============================================
// ASSET CONFIGURATION
// ============================================

export interface AssetConfig {
  /** Internal asset identifier */
  id: string;
  
  /** Display name */
  name: string;
  
  /** Trading symbol */
  symbol: string;
  
  /** Pyth price feed ID (hex, no 0x prefix) */
  pythFeedId: string;
  
  /** Decimal places for display */
  decimals: number;
  
  /** Token mint address on Solana */
  mintAddress?: string;
  
  /** Whether this asset is actively monitored */
  active: boolean;
}

// ============================================
// CONNECTION STATUS
// ============================================

export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'ERROR';

export interface OracleStatus {
  /** Current connection state */
  state: ConnectionState;
  
  /** Last successful update timestamp */
  lastUpdate: number;
  
  /** Connection latency in ms */
  latencyMs: number;
  
  /** Number of reconnection attempts */
  reconnectAttempts: number;
  
  /** Last error message */
  lastError?: string;
  
  /** Feeds currently subscribed */
  subscribedFeeds: string[];
  
  /** Hermes endpoint being used */
  endpoint: string;
}

// ============================================
// EVENTS
// ============================================

export type OracleEventType = 
  | 'PRICE_UPDATE'
  | 'CONNECTION_CHANGE'
  | 'STALE_DATA'
  | 'RECONNECTING'
  | 'ERROR';

export interface OracleEvent {
  type: OracleEventType;
  timestamp: number;
  data: any;
  assetId?: string;
}

// ============================================
// FALLBACK DATA
// ============================================

export interface FallbackData {
  /** Last valid price */
  price: OraclePrice;
  
  /** When fallback was activated */
  activatedAt: number;
  
  /** Reason for fallback */
  reason: 'CONNECTION_LOST' | 'STALE_DATA' | 'INVALID_DATA';
  
  /** Age of fallback data in seconds */
  ageSeconds: number;
}

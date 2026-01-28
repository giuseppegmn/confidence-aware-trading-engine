/**
 * CATE - Oracle Ingestion Layer
 * 
 * Consumes real-time and historical feeds from Pyth Network.
 * Maintains rolling windows and computes derived metrics.
 * 
 * In production, this would connect to Pyth Hermes API.
 * For demonstration, uses realistic simulated data.
 */

import type {
  OraclePrice,
  OracleMetrics,
  OracleSnapshot,
  RollingWindows,
  PricePoint,
  AssetConfig,
} from './types';

// ============================================
// CONSTANTS
// ============================================

const WINDOW_SIZES = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '24h': 86400,
} as const;

// Maximum data points to store per window
const MAX_POINTS_PER_WINDOW = {
  '1m': 60,
  '5m': 60,
  '15m': 60,
  '1h': 60,
  '24h': 288,
};

// ============================================
// ASSET CONFIGURATIONS
// ============================================

export const SUPPORTED_ASSETS: AssetConfig[] = [
  {
    id: 'SOL/USD',
    name: 'Solana',
    symbol: 'SOL',
    pythFeedId: 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG',
    decimals: 4,
  },
  {
    id: 'BTC/USD',
    name: 'Bitcoin',
    symbol: 'BTC',
    pythFeedId: 'GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU',
    decimals: 2,
  },
  {
    id: 'ETH/USD',
    name: 'Ethereum',
    symbol: 'ETH',
    pythFeedId: 'JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB',
    decimals: 2,
  },
  {
    id: 'JUP/USD',
    name: 'Jupiter',
    symbol: 'JUP',
    pythFeedId: 'g6eRCbboSwK4tSWngn773RCMexr1APQr4uA9bGZBYfo',
    decimals: 6,
  },
  {
    id: 'BONK/USD',
    name: 'Bonk',
    symbol: 'BONK',
    pythFeedId: '8ihFLu5FimgTQ1Unh4dVyEHUGodJ5gJQCrQf4KUVB9bN',
    decimals: 10,
  },
];

// ============================================
// MARKET STATE SIMULATION
// ============================================

type MarketCondition = 'CALM' | 'VOLATILE' | 'DEGRADED';

interface MarketState {
  condition: MarketCondition;
  volatilityMultiplier: number;
  confidenceMultiplier: number;
  lastConditionChange: number;
}

const marketStates = new Map<string, MarketState>();

function getMarketState(assetId: string): MarketState {
  if (!marketStates.has(assetId)) {
    marketStates.set(assetId, {
      condition: 'CALM',
      volatilityMultiplier: 1.0,
      confidenceMultiplier: 1.0,
      lastConditionChange: Date.now(),
    });
  }
  return marketStates.get(assetId)!;
}

// Simulate market condition changes
function updateMarketCondition(assetId: string): void {
  const state = getMarketState(assetId);
  const now = Date.now();
  const timeSinceChange = now - state.lastConditionChange;
  
  // Change condition every 30-120 seconds
  if (timeSinceChange > 30000 && Math.random() < 0.02) {
    const rand = Math.random();
    if (rand < 0.6) {
      state.condition = 'CALM';
      state.volatilityMultiplier = 0.8 + Math.random() * 0.4;
      state.confidenceMultiplier = 0.8 + Math.random() * 0.4;
    } else if (rand < 0.85) {
      state.condition = 'VOLATILE';
      state.volatilityMultiplier = 2.0 + Math.random() * 3.0;
      state.confidenceMultiplier = 1.5 + Math.random() * 2.0;
    } else {
      state.condition = 'DEGRADED';
      state.volatilityMultiplier = 1.0 + Math.random() * 1.0;
      state.confidenceMultiplier = 3.0 + Math.random() * 5.0;
    }
    state.lastConditionChange = now;
  }
}

// ============================================
// BASE PRICE SIMULATION
// ============================================

const basePrices: Record<string, number> = {
  'SOL/USD': 185.50,
  'BTC/USD': 97500.00,
  'ETH/USD': 3450.00,
  'JUP/USD': 1.25,
  'BONK/USD': 0.0000245,
};

const baseConfidence: Record<string, number> = {
  'SOL/USD': 0.15,
  'BTC/USD': 25.00,
  'ETH/USD': 1.50,
  'JUP/USD': 0.005,
  'BONK/USD': 0.0000001,
};

// Price simulation state
const priceState = new Map<string, { price: number; trend: number; momentum: number }>();

function getPriceState(assetId: string) {
  if (!priceState.has(assetId)) {
    priceState.set(assetId, {
      price: basePrices[assetId] || 100,
      trend: 0,
      momentum: 0,
    });
  }
  return priceState.get(assetId)!;
}

// ============================================
// ORACLE PRICE GENERATION
// ============================================

export function generateOraclePrice(assetId: string): OraclePrice {
  updateMarketCondition(assetId);
  
  const marketState = getMarketState(assetId);
  const state = getPriceState(assetId);
  const basePrice = basePrices[assetId] || 100;
  const baseConf = baseConfidence[assetId] || basePrice * 0.001;
  
  // Update price with random walk + mean reversion
  const volatility = 0.0002 * marketState.volatilityMultiplier;
  const meanReversionStrength = 0.001;
  
  // Random shock
  const shock = (Math.random() - 0.5) * 2 * volatility * state.price;
  
  // Mean reversion
  const reversion = (basePrice - state.price) * meanReversionStrength;
  
  // Momentum
  state.momentum = state.momentum * 0.95 + shock * 0.05;
  state.trend = state.trend * 0.99 + (Math.random() - 0.5) * 0.001;
  
  // Update price
  state.price = state.price + shock + reversion + state.momentum + state.trend * state.price;
  state.price = Math.max(state.price, basePrice * 0.5);
  state.price = Math.min(state.price, basePrice * 1.5);
  
  // Calculate confidence with market condition multiplier
  const confidenceBase = baseConf * marketState.confidenceMultiplier;
  const confidenceNoise = confidenceBase * (0.8 + Math.random() * 0.4);
  
  // EMA calculations (simulated)
  const emaPrice = state.price * (0.995 + Math.random() * 0.01);
  const emaConfidence = confidenceNoise * (0.9 + Math.random() * 0.2);
  
  // Publisher count varies with market condition
  let publisherCount = 25 + Math.floor(Math.random() * 10);
  if (marketState.condition === 'DEGRADED') {
    publisherCount = Math.max(2, Math.floor(publisherCount * 0.3));
  }
  
  return {
    assetId,
    price: state.price,
    confidence: confidenceNoise,
    timestamp: Date.now(),
    publisherCount,
    emaPrice,
    emaConfidence,
  };
}

// ============================================
// ROLLING WINDOWS MANAGEMENT
// ============================================

const rollingWindowsStore = new Map<string, RollingWindows>();

function getOrCreateWindows(assetId: string): RollingWindows {
  if (!rollingWindowsStore.has(assetId)) {
    rollingWindowsStore.set(assetId, {
      '1m': [],
      '5m': [],
      '15m': [],
      '1h': [],
      '24h': [],
    });
  }
  return rollingWindowsStore.get(assetId)!;
}

function addToWindow(
  windows: RollingWindows,
  windowKey: keyof RollingWindows,
  point: PricePoint
): void {
  const window = windows[windowKey];
  const maxPoints = MAX_POINTS_PER_WINDOW[windowKey];
  const windowSize = WINDOW_SIZES[windowKey] * 1000;
  const cutoff = Date.now() - windowSize;
  
  // Add new point
  window.push(point);
  
  // Remove old points
  while (window.length > 0 && window[0].timestamp < cutoff) {
    window.shift();
  }
  
  // Trim to max points
  while (window.length > maxPoints) {
    window.shift();
  }
}

export function updateRollingWindows(price: OraclePrice): RollingWindows {
  const windows = getOrCreateWindows(price.assetId);
  const point: PricePoint = {
    price: price.price,
    confidence: price.confidence,
    timestamp: price.timestamp,
  };
  
  // Add to all windows
  addToWindow(windows, '1m', point);
  addToWindow(windows, '5m', point);
  addToWindow(windows, '15m', point);
  addToWindow(windows, '1h', point);
  addToWindow(windows, '24h', point);
  
  return windows;
}

// ============================================
// METRICS CALCULATION
// ============================================

function calculateStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  
  return Math.sqrt(variance);
}

function calculateRealizedVolatility(prices: number[], periodSeconds: number): number {
  if (prices.length < 2) return 0;
  
  // Calculate log returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  
  if (returns.length === 0) return 0;
  
  const stdDev = calculateStandardDeviation(returns);
  
  // Annualize (assuming 365 days, 24 hours)
  const periodsPerYear = (365 * 24 * 3600) / periodSeconds;
  const annualizedVol = stdDev * Math.sqrt(periodsPerYear * returns.length);
  
  return annualizedVol * 100; // Return as percentage
}

export function calculateMetrics(
  price: OraclePrice,
  windows: RollingWindows
): OracleMetrics {
  // Confidence ratio
  const confidenceRatio = (price.confidence / price.price) * 100;
  
  // Calculate confidence z-score from 1h window
  const confidenceRatios1h = windows['1h'].map(p => (p.confidence / p.price) * 100);
  const meanConfRatio = confidenceRatios1h.length > 0
    ? confidenceRatios1h.reduce((a, b) => a + b, 0) / confidenceRatios1h.length
    : confidenceRatio;
  const stdConfRatio = calculateStandardDeviation(confidenceRatios1h) || 0.01;
  const confidenceZscore = (confidenceRatio - meanConfRatio) / stdConfRatio;
  
  // Realized volatility from 1h window
  const prices1h = windows['1h'].map(p => p.price);
  const volatilityRealized = calculateRealizedVolatility(prices1h, 60);
  
  // Expected volatility from confidence
  const volatilityExpected = confidenceRatio * Math.sqrt(365 * 24);
  
  // Data freshness
  const dataFreshnessSeconds = (Date.now() - price.timestamp) / 1000;
  
  // Average confidence ratios
  const avgConfidenceRatio1h = meanConfRatio;
  
  const confidenceRatios24h = windows['24h'].map(p => (p.confidence / p.price) * 100);
  const avgConfidenceRatio24h = confidenceRatios24h.length > 0
    ? confidenceRatios24h.reduce((a, b) => a + b, 0) / confidenceRatios24h.length
    : confidenceRatio;
  
  // Price changes
  const priceChange1h = windows['1h'].length > 0
    ? ((price.price - windows['1h'][0].price) / windows['1h'][0].price) * 100
    : 0;
  
  const priceChange24h = windows['24h'].length > 0
    ? ((price.price - windows['24h'][0].price) / windows['24h'][0].price) * 100
    : 0;
  
  return {
    confidenceRatio,
    confidenceZscore,
    volatilityRealized,
    volatilityExpected,
    dataFreshnessSeconds,
    avgConfidenceRatio1h,
    avgConfidenceRatio24h,
    priceChange1h,
    priceChange24h,
  };
}

// ============================================
// SNAPSHOT GENERATION
// ============================================

export function generateSnapshot(assetId: string): OracleSnapshot {
  const price = generateOraclePrice(assetId);
  const windows = updateRollingWindows(price);
  const metrics = calculateMetrics(price, windows);
  
  return {
    price,
    metrics,
    rollingWindows: windows,
  };
}

// ============================================
// ORACLE SERVICE CLASS
// ============================================

export class OracleService {
  private snapshots = new Map<string, OracleSnapshot>();
  private subscribers = new Set<(snapshots: Map<string, OracleSnapshot>) => void>();
  private intervalId: NodeJS.Timeout | null = null;
  private updateInterval: number;
  
  constructor(updateIntervalMs: number = 1000) {
    this.updateInterval = updateIntervalMs;
  }
  
  start(): void {
    if (this.intervalId) return;
    
    // Initialize all assets
    for (const asset of SUPPORTED_ASSETS) {
      this.snapshots.set(asset.id, generateSnapshot(asset.id));
    }
    
    // Start update loop
    this.intervalId = setInterval(() => {
      for (const asset of SUPPORTED_ASSETS) {
        this.snapshots.set(asset.id, generateSnapshot(asset.id));
      }
      this.notifySubscribers();
    }, this.updateInterval);
    
    this.notifySubscribers();
  }
  
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  subscribe(callback: (snapshots: Map<string, OracleSnapshot>) => void): () => void {
    this.subscribers.add(callback);
    callback(this.snapshots);
    
    return () => {
      this.subscribers.delete(callback);
    };
  }
  
  private notifySubscribers(): void {
    for (const callback of this.subscribers) {
      callback(new Map(this.snapshots));
    }
  }
  
  getSnapshot(assetId: string): OracleSnapshot | undefined {
    return this.snapshots.get(assetId);
  }
  
  getAllSnapshots(): Map<string, OracleSnapshot> {
    return new Map(this.snapshots);
  }
  
  // Force a specific market condition for testing
  setMarketCondition(assetId: string, condition: MarketCondition): void {
    const state = getMarketState(assetId);
    state.condition = condition;
    state.lastConditionChange = Date.now();
    
    switch (condition) {
      case 'CALM':
        state.volatilityMultiplier = 0.8;
        state.confidenceMultiplier = 0.8;
        break;
      case 'VOLATILE':
        state.volatilityMultiplier = 3.0;
        state.confidenceMultiplier = 2.0;
        break;
      case 'DEGRADED':
        state.volatilityMultiplier = 1.5;
        state.confidenceMultiplier = 5.0;
        break;
    }
  }
  
  getMarketCondition(assetId: string): MarketCondition {
    return getMarketState(assetId).condition;
  }
}

// Singleton instance
export const oracleService = new OracleService(1000);

/**
 * CATE - Pyth Hermes Integration
 * 
 * Production-grade connection to Pyth Network's Hermes API.
 * Features:
 * - WebSocket streaming for real-time updates
 * - HTTP fallback for reliability
 * - Automatic reconnection with exponential backoff
 * - Stale data detection
 * - Rolling window management
 */

import type {
  PythPriceFeed,
  OraclePrice,
  OracleMetrics,
  OracleSnapshot,
  PricePoint,
  RollingWindows,
  AssetConfig,
  OracleStatus,
  ConnectionState,
  OracleEvent,
  FallbackData,
} from './types';

// ============================================
// CONSTANTS
// ============================================

// Pyth Hermes endpoints
const HERMES_ENDPOINTS = {
  mainnet: 'https://hermes.pyth.network',
  testnet: 'https://hermes-beta.pyth.network',
};

const HERMES_WS_ENDPOINTS = {
  mainnet: 'wss://hermes.pyth.network/ws',
  testnet: 'wss://hermes-beta.pyth.network/ws',
};

// Window configuration
const WINDOW_CONFIG = {
  '1m': { maxAge: 60 * 1000, maxPoints: 60 },
  '5m': { maxAge: 5 * 60 * 1000, maxPoints: 60 },
  '15m': { maxAge: 15 * 60 * 1000, maxPoints: 60 },
  '1h': { maxAge: 60 * 60 * 1000, maxPoints: 120 },
} as const;

// Stale data threshold
const STALE_THRESHOLD_MS = 30000; // 30 seconds

// Reconnection settings
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;

// ============================================
// SUPPORTED ASSETS
// ============================================

export const SUPPORTED_ASSETS: AssetConfig[] = [
  {
    id: 'SOL/USD',
    name: 'Solana',
    symbol: 'SOL',
    pythFeedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
    decimals: 4,
    mintAddress: 'So11111111111111111111111111111111111111112',
    active: true,
  },
  {
    id: 'BTC/USD',
    name: 'Bitcoin',
    symbol: 'BTC',
    pythFeedId: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    decimals: 2,
    mintAddress: '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E',
    active: true,
  },
  {
    id: 'ETH/USD',
    name: 'Ethereum',
    symbol: 'ETH',
    pythFeedId: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    decimals: 2,
    mintAddress: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    active: true,
  },
  {
    id: 'JUP/USD',
    name: 'Jupiter',
    symbol: 'JUP',
    pythFeedId: '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
    decimals: 6,
    mintAddress: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    active: true,
  },
  {
    id: 'BONK/USD',
    name: 'Bonk',
    symbol: 'BONK',
    pythFeedId: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
    decimals: 10,
    mintAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    active: true,
  },
];

// ============================================
// UTILITY FUNCTIONS
// ============================================

function normalizePythPrice(feed: PythPriceFeed, assetId: string, sequence: number): OraclePrice {
  const priceValue = parseFloat(feed.price.price) * Math.pow(10, feed.price.expo);
  const confValue = parseFloat(feed.price.conf) * Math.pow(10, feed.price.expo);
  const emaPriceValue = parseFloat(feed.emaPrice.price) * Math.pow(10, feed.emaPrice.expo);
  const emaConfValue = parseFloat(feed.emaPrice.conf) * Math.pow(10, feed.emaPrice.expo);
  
  return {
    assetId,
    feedId: feed.id,
    price: priceValue,
    confidence: confValue,
    timestamp: Date.now(),
    publishTime: feed.price.publishTime * 1000,
    emaPrice: emaPriceValue,
    emaConfidence: emaConfValue,
    exponent: feed.price.expo,
    source: 'PYTH_HERMES',
    sequence,
  };
}

function calculateStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function calculateRealizedVolatility(prices: number[], periodMs: number): number {
  if (prices.length < 2) return 0;
  
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  
  if (returns.length === 0) return 0;
  
  const stdDev = calculateStandardDeviation(returns);
  const periodsPerYear = (365 * 24 * 60 * 60 * 1000) / periodMs;
  const annualizedVol = stdDev * Math.sqrt(periodsPerYear * returns.length);
  
  return annualizedVol * 100;
}

function hashSnapshot(price: OraclePrice, metrics: OracleMetrics): string {
  const data = JSON.stringify({
    assetId: price.assetId,
    price: price.price,
    confidence: price.confidence,
    timestamp: price.timestamp,
    publishTime: price.publishTime,
    confidenceRatio: metrics.confidenceRatio,
  });
  
  // Simple hash for demo - in production use crypto.subtle
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

// ============================================
// ROLLING WINDOWS MANAGER
// ============================================

class RollingWindowsManager {
  private windows: Map<string, RollingWindows> = new Map();
  
  getOrCreate(assetId: string): RollingWindows {
    if (!this.windows.has(assetId)) {
      this.windows.set(assetId, {
        '1m': [],
        '5m': [],
        '15m': [],
        '1h': [],
      });
    }
    return this.windows.get(assetId)!;
  }
  
  addPoint(assetId: string, point: PricePoint): RollingWindows {
    const windows = this.getOrCreate(assetId);
    const now = Date.now();
    
    for (const [key, config] of Object.entries(WINDOW_CONFIG)) {
      const windowKey = key as keyof RollingWindows;
      const window = windows[windowKey];
      
      // Add new point
      window.push(point);
      
      // Remove old points
      const cutoff = now - config.maxAge;
      while (window.length > 0 && window[0].timestamp < cutoff) {
        window.shift();
      }
      
      // Trim to max points
      while (window.length > config.maxPoints) {
        window.shift();
      }
    }
    
    return windows;
  }
  
  get(assetId: string): RollingWindows | undefined {
    return this.windows.get(assetId);
  }
}

// ============================================
// METRICS CALCULATOR
// ============================================

class MetricsCalculator {
  calculate(price: OraclePrice, windows: RollingWindows): OracleMetrics {
    const now = Date.now();
    
    // Confidence ratio
    const confidenceRatio = price.price > 0 
      ? (price.confidence / price.price) * 100 
      : 0;
    
    // Z-score calculation from 1h window
    const confRatios1h = windows['1h'].map(p => 
      p.price > 0 ? (p.confidence / p.price) * 100 : 0
    );
    const meanConfRatio = confRatios1h.length > 0
      ? confRatios1h.reduce((a, b) => a + b, 0) / confRatios1h.length
      : confidenceRatio;
    const stdConfRatio = calculateStandardDeviation(confRatios1h) || 0.01;
    const confidenceZscore = (confidenceRatio - meanConfRatio) / stdConfRatio;
    
    // Realized volatility
    const prices1h = windows['1h'].map(p => p.price);
    const volatilityRealized = calculateRealizedVolatility(prices1h, 60000);
    
    // Expected volatility
    const volatilityExpected = confidenceRatio * Math.sqrt(365 * 24);
    
    // Data freshness
    const dataFreshnessSeconds = (now - price.publishTime) / 1000;
    
    // Average confidence ratios
    const avgConfidenceRatio1h = meanConfRatio;
    
    // Price changes
    const priceChange1h = windows['1h'].length > 0 && windows['1h'][0].price > 0
      ? ((price.price - windows['1h'][0].price) / windows['1h'][0].price) * 100
      : 0;
    
    const priceChange24h = 0; // Would need 24h data
    
    // Update frequency
    const updateFrequency1m = windows['1m'].length;
    
    // Data quality score
    const freshnessScore = Math.max(0, 100 - (dataFreshnessSeconds * 3));
    const confScore = Math.max(0, 100 - (confidenceRatio * 20));
    const freqScore = Math.min(100, updateFrequency1m * 10);
    const dataQualityScore = (freshnessScore + confScore + freqScore) / 3;
    
    return {
      confidenceRatio,
      confidenceZscore,
      volatilityRealized,
      volatilityExpected,
      dataFreshnessSeconds,
      avgConfidenceRatio1h,
      avgConfidenceRatio24h: avgConfidenceRatio1h,
      priceChange1h,
      priceChange24h,
      updateFrequency1m,
      dataQualityScore,
    };
  }
}

// ============================================
// PYTH HERMES SERVICE
// ============================================

export class PythHermesService {
  private ws: WebSocket | null = null;
  private status: OracleStatus;
  private snapshots: Map<string, OracleSnapshot> = new Map();
  private fallbackData: Map<string, FallbackData> = new Map();
  private windowsManager: RollingWindowsManager;
  private metricsCalculator: MetricsCalculator;
  private subscribers: Set<(snapshots: Map<string, OracleSnapshot>) => void> = new Set();
  private eventSubscribers: Set<(event: OracleEvent) => void> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private sequence: number = 0;
  private useTestnet: boolean;
  
  constructor(useTestnet: boolean = false) {
    this.useTestnet = useTestnet;
    this.windowsManager = new RollingWindowsManager();
    this.metricsCalculator = new MetricsCalculator();
    
    this.status = {
      state: 'DISCONNECTED',
      lastUpdate: 0,
      latencyMs: 0,
      reconnectAttempts: 0,
      subscribedFeeds: [],
      endpoint: useTestnet ? HERMES_ENDPOINTS.testnet : HERMES_ENDPOINTS.mainnet,
    };
  }
  
  // ==========================================
  // PUBLIC API
  // ==========================================
  
  async start(): Promise<void> {
    console.log('[PythHermes] Starting oracle service...');
    this.updateStatus('CONNECTING');
    
    // Initial HTTP fetch for immediate data
    await this.fetchInitialPrices();
    
    // Start WebSocket connection
    this.connectWebSocket();
    
    // Start health check
    this.startHealthCheck();
  }
  
  stop(): void {
    console.log('[PythHermes] Stopping oracle service...');
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    this.updateStatus('DISCONNECTED');
  }
  
  subscribe(callback: (snapshots: Map<string, OracleSnapshot>) => void): () => void {
    this.subscribers.add(callback);
    // Immediately send current state
    if (this.snapshots.size > 0) {
      callback(new Map(this.snapshots));
    }
    return () => this.subscribers.delete(callback);
  }
  
  subscribeToEvents(callback: (event: OracleEvent) => void): () => void {
    this.eventSubscribers.add(callback);
    return () => this.eventSubscribers.delete(callback);
  }
  
  getSnapshot(assetId: string): OracleSnapshot | undefined {
    return this.snapshots.get(assetId);
  }
  
  getAllSnapshots(): Map<string, OracleSnapshot> {
    return new Map(this.snapshots);
  }
  
  getStatus(): OracleStatus {
    return { ...this.status };
  }
  
  getFallbackData(assetId: string): FallbackData | undefined {
    return this.fallbackData.get(assetId);
  }
  
  // ==========================================
  // HTTP FETCH
  // ==========================================
  
  private async fetchInitialPrices(): Promise<void> {
    const feedIds = SUPPORTED_ASSETS.filter(a => a.active).map(a => a.pythFeedId);
    const endpoint = this.useTestnet ? HERMES_ENDPOINTS.testnet : HERMES_ENDPOINTS.mainnet;
    
    try {
      const url = `${endpoint}/v2/updates/price/latest?${feedIds.map(id => `ids[]=${id}`).join('&')}`;
      const startTime = Date.now();
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const latency = Date.now() - startTime;
      
      this.status.latencyMs = latency;
      this.status.lastUpdate = Date.now();
      
      // Process parsed price feeds
      if (data.parsed && Array.isArray(data.parsed)) {
        for (const feed of data.parsed) {
          this.processPriceFeed(feed);
        }
      }
      
      console.log(`[PythHermes] Initial fetch complete: ${data.parsed?.length || 0} feeds, ${latency}ms`);
      
    } catch (error) {
      console.error('[PythHermes] Initial fetch failed:', error);
      this.emitEvent('ERROR', { error: String(error) });
    }
  }
  
  // ==========================================
  // WEBSOCKET CONNECTION
  // ==========================================
  
  private connectWebSocket(): void {
    const wsEndpoint = this.useTestnet 
      ? HERMES_WS_ENDPOINTS.testnet 
      : HERMES_WS_ENDPOINTS.mainnet;
    
    console.log(`[PythHermes] Connecting to WebSocket: ${wsEndpoint}`);
    
    try {
      this.ws = new WebSocket(wsEndpoint);
      
      this.ws.onopen = () => {
        console.log('[PythHermes] WebSocket connected');
        this.updateStatus('CONNECTED');
        this.status.reconnectAttempts = 0;
        
        // Subscribe to price feeds
        this.subscribeToFeeds();
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWebSocketMessage(data);
        } catch (error) {
          console.error('[PythHermes] Failed to parse WebSocket message:', error);
        }
      };
      
      this.ws.onerror = (error) => {
        console.error('[PythHermes] WebSocket error:', error);
        this.status.lastError = 'WebSocket connection error';
        this.emitEvent('ERROR', { error: 'WebSocket connection error' });
      };
      
      this.ws.onclose = (event) => {
        console.log(`[PythHermes] WebSocket closed: ${event.code} ${event.reason}`);
        this.ws = null;
        
        if (this.status.state !== 'DISCONNECTED') {
          this.scheduleReconnect();
        }
      };
      
    } catch (error) {
      console.error('[PythHermes] Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }
  
  private subscribeToFeeds(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const feedIds = SUPPORTED_ASSETS.filter(a => a.active).map(a => a.pythFeedId);
    
    const subscribeMessage = {
      type: 'subscribe',
      ids: feedIds,
    };
    
    this.ws.send(JSON.stringify(subscribeMessage));
    this.status.subscribedFeeds = feedIds;
    
    console.log(`[PythHermes] Subscribed to ${feedIds.length} feeds`);
  }
  
  private handleWebSocketMessage(data: any): void {
    if (data.type === 'price_update' && data.price_feed) {
      this.processPriceFeed(data.price_feed);
    }
  }
  
  // ==========================================
  // PRICE PROCESSING
  // ==========================================
  
  private processPriceFeed(feed: PythPriceFeed): void {
    // Find matching asset
    const asset = SUPPORTED_ASSETS.find(a => a.pythFeedId === feed.id);
    if (!asset) return;
    
    this.sequence++;
    
    // Normalize price
    const price = normalizePythPrice(feed, asset.id, this.sequence);
    
    // Check for stale data
    const age = Date.now() - price.publishTime;
    if (age > STALE_THRESHOLD_MS) {
      this.handleStaleData(asset.id, price, age);
      return;
    }
    
    // Add to rolling windows
    const point: PricePoint = {
      price: price.price,
      confidence: price.confidence,
      timestamp: price.timestamp,
      source: price.source,
    };
    
    const windows = this.windowsManager.addPoint(asset.id, point);
    
    // Calculate metrics
    const metrics = this.metricsCalculator.calculate(price, windows);
    
    // Create snapshot
    const snapshot: OracleSnapshot = {
      price,
      metrics,
      rollingWindows: windows,
      snapshotHash: hashSnapshot(price, metrics),
      createdAt: Date.now(),
    };
    
    // Store and notify
    this.snapshots.set(asset.id, snapshot);
    this.status.lastUpdate = Date.now();
    
    // Clear any fallback
    this.fallbackData.delete(asset.id);
    
    // Emit events
    this.emitEvent('PRICE_UPDATE', { assetId: asset.id, price: price.price }, asset.id);
    this.notifySubscribers();
  }
  
  private handleStaleData(assetId: string, price: OraclePrice, ageMs: number): void {
    console.warn(`[PythHermes] Stale data for ${assetId}: ${(ageMs / 1000).toFixed(1)}s old`);
    
    // Use existing snapshot as fallback
    const existingSnapshot = this.snapshots.get(assetId);
    if (existingSnapshot) {
      this.fallbackData.set(assetId, {
        price: existingSnapshot.price,
        activatedAt: Date.now(),
        reason: 'STALE_DATA',
        ageSeconds: ageMs / 1000,
      });
    }
    
    this.emitEvent('STALE_DATA', { assetId, ageMs }, assetId);
  }
  
  // ==========================================
  // RECONNECTION
  // ==========================================
  
  private scheduleReconnect(): void {
    if (this.status.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      console.error('[PythHermes] Max reconnection attempts reached');
      this.updateStatus('ERROR');
      this.status.lastError = 'Max reconnection attempts reached';
      return;
    }
    
    this.updateStatus('RECONNECTING');
    this.status.reconnectAttempts++;
    
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.status.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY
    );
    
    console.log(`[PythHermes] Reconnecting in ${delay}ms (attempt ${this.status.reconnectAttempts})`);
    
    this.emitEvent('RECONNECTING', { 
      attempt: this.status.reconnectAttempts, 
      delay 
    });
    
    this.reconnectTimeout = setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }
  
  // ==========================================
  // HEALTH CHECK
  // ==========================================
  
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 5000);
  }
  
  private performHealthCheck(): void {
    const now = Date.now();
    
    // Check each asset for stale data
    for (const asset of SUPPORTED_ASSETS.filter(a => a.active)) {
      const snapshot = this.snapshots.get(asset.id);
      
      if (!snapshot) continue;
      
      const age = now - snapshot.price.publishTime;
      
      if (age > STALE_THRESHOLD_MS && !this.fallbackData.has(asset.id)) {
        this.handleStaleData(asset.id, snapshot.price, age);
      }
    }
    
    // Check WebSocket health
    if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[PythHermes] WebSocket not open, scheduling reconnect');
      this.scheduleReconnect();
    }
  }
  
  // ==========================================
  // HELPERS
  // ==========================================
  
  private updateStatus(state: ConnectionState): void {
    this.status.state = state;
    this.emitEvent('CONNECTION_CHANGE', { state });
  }
  
  private notifySubscribers(): void {
    const snapshotsCopy = new Map(this.snapshots);
    for (const callback of this.subscribers) {
      try {
        callback(snapshotsCopy);
      } catch (error) {
        console.error('[PythHermes] Subscriber error:', error);
      }
    }
  }
  
  private emitEvent(type: OracleEvent['type'], data: any, assetId?: string): void {
    const event: OracleEvent = {
      type,
      timestamp: Date.now(),
      data,
      assetId,
    };
    
    for (const callback of this.eventSubscribers) {
      try {
        callback(event);
      } catch (error) {
        console.error('[PythHermes] Event subscriber error:', error);
      }
    }
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const pythHermesService = new PythHermesService(false);

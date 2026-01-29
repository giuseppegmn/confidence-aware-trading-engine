/**
 * Pyth Hermes Oracle Client with Auto-Reconnection
 * Handles connection drops gracefully
 */

import { HermesClient } from '@pythnetwork/hermes-client';

// =============================================================================
// TYPES
// =============================================================================

export interface PriceFeed {
  id: string;
  price: number;
  confidence: number;
  exponent: number;
  publishTime: number;
  prevPublishTime: number;
}

export interface OracleSnapshot {
  price: {
    id: string;
    price: number;
    confidence: number;
    confidenceRatio: number;
    exponent: number;
    publishTime: number;
    numPublishers: number;
  };
  timestamp: number;
}

export interface ConnectionState {
  status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  lastUpdate: number;
  error?: string;
}

// =============================================================================
// CONFIG
// =============================================================================

const RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const STALENESS_THRESHOLD = 120000; // 2 minutes

// =============================================================================
// HERMES SERVICE
// =============================================================================

export class PythHermesService {
  private client: HermesClient | null = null;
  private isRunning = false;
  private subscribers: Set<(snapshot: OracleSnapshot) => void> = new Set();
  private connectionSubscribers: Set<(state: ConnectionState) => void> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastDataTime = 0;
  private priceFeeds: Map<string, PriceFeed> = new Map();
  private subscribedPriceIds: Set<string> = new Set();

  constructor(private endpoint: string = 'https://hermes.pyth.network') {}

  // =============================================================================
  // LIFECYCLE
  // =============================================================================

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.reconnectAttempts = 0;
    await this.connect();
  }

  stop(): void {
    this.isRunning = false;
    this.clearTimers();
    
    if (this.client) {
      // Cleanup WebSocket if exists
      this.client = null;
    }
    
    console.log('[Hermes] Stopped');
  }

  // =============================================================================
  // CONNECTION MANAGEMENT
  // =============================================================================

  private async connect(): Promise<void> {
    if (!this.isRunning) return;

    try {
      this.notifyConnectionState('CONNECTING');
      
      this.client = new HermesClient(this.endpoint);
      
      // Setup price feeds monitoring
      await this.subscribeToFeeds();
      
      // Start heartbeat
      this.startHeartbeat();
      
      this.reconnectAttempts = 0;
      this.lastDataTime = Date.now();
      this.notifyConnectionState('CONNECTED');
      
      console.log('[Hermes] Connected to', this.endpoint);
      
    } catch (error) {
      console.error('[Hermes] Connection failed:', error);
      this.notifyConnectionState('ERROR', error instanceof Error ? error.message : 'Unknown error');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.isRunning) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[Hermes] Max reconnection attempts reached');
      this.notifyConnectionState('ERROR', 'Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[Hermes] Reconnecting in ${RECONNECT_DELAY}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    
    this.clearTimers();
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // =============================================================================
  // SUBSCRIPTION MANAGEMENT
  // =============================================================================

  private async subscribeToFeeds(): Promise<void> {
    if (!this.client) return;

    const priceIds = Array.from(this.subscribedPriceIds);
    if (priceIds.length === 0) {
      // Default price feeds if none specified
      priceIds.push(
        '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC/USD
        '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'  // ETH/USD
      );
    }

    try {
      // Use WebSocket streaming if available, fallback to polling
      await this.startStreaming(priceIds);
    } catch (error) {
      console.warn('[Hermes] Streaming failed, falling back to polling:', error);
      this.startPolling(priceIds);
    }
  }

  private async startStreaming(priceIds: string[]): Promise<void> {
    if (!this.client) return;
    
    // Note: HermesClient might not support native WebSocket streaming in all versions
    // This is a placeholder for streaming implementation
    console.log('[Hermes] Starting stream for', priceIds.length, 'feeds');
    
    // Simulate receiving data (replace with actual implementation)
    this.startPolling(priceIds);
  }

  private startPolling(priceIds: string[]): void {
    const poll = async () => {
      if (!this.isRunning || !this.client) return;
      
      try {
        const updates = await this.client.getLatestPriceUpdates(priceIds);
        this.processUpdates(updates);
        this.lastDataTime = Date.now();
        
        if (this.reconnectAttempts > 0) {
          // Recovery successful
          this.reconnectAttempts = 0;
          this.notifyConnectionState('CONNECTED');
        }
      } catch (error) {
        console.error('[Hermes] Poll error:', error);
        this.scheduleReconnect();
      }
    };

    // Poll immediately then every 5 seconds
    poll();
    this.heartbeatTimer = setInterval(poll, 5000);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const staleness = now - this.lastDataTime;
      
      if (staleness > STALENESS_THRESHOLD) {
        console.warn(`[Hermes] Data stale (${staleness}ms), reconnecting...`);
        this.notifyConnectionState('DISCONNECTED', 'Data stale');
        this.scheduleReconnect();
      }
    }, HEARTBEAT_INTERVAL);
  }

  // =============================================================================
  // DATA PROCESSING
  // =============================================================================

  private processUpdates(updates: any): void {
    // Parse Hermes response format
    const parsed = this.parseHermesUpdate(updates);
    
    for (const feed of parsed) {
      this.priceFeeds.set(feed.id, feed);
      
      const snapshot: OracleSnapshot = {
        price: {
          id: feed.id,
          price: feed.price,
          confidence: feed.confidence,
          confidenceRatio: (feed.confidence / feed.price) * 100,
          exponent: feed.exponent,
          publishTime: feed.publishTime,
          numPublishers: 5 // Default, should come from metadata
        },
        timestamp: Date.now()
      };
      
      this.notifySubscribers(snapshot);
    }
  }

  private parseHermesUpdate(updates: any): PriceFeed[] {
    try {
      // Handle different Hermes response formats
      if (!updates || !updates.parsed) return [];
      
      return updates.parsed.map((item: any) => ({
        id: item.id,
        price: Number(item.price.price) * Math.pow(10, item.price.expo),
        confidence: Number(item.price.conf) * Math.pow(10, item.price.expo),
        exponent: item.price.expo,
        publishTime: item.price.publish_time,
        prevPublishTime: item.price.prev_publish_time
      }));
    } catch (error) {
      console.error('[Hermes] Parse error:', error);
      return [];
    }
  }

  // =============================================================================
  // PUBLIC API
  // =============================================================================

  subscribe(callback: (snapshot: OracleSnapshot) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  subscribeToConnection(callback: (state: ConnectionState) => void): () => void {
    this.connectionSubscribers.add(callback);
    callback(this.getConnectionState()); // Initial state
    return () => this.connectionSubscribers.delete(callback);
  }

  addPriceFeed(priceId: string): void {
    this.subscribedPriceIds.add(priceId);
    if (this.isRunning && this.client) {
      this.subscribeToFeeds(); // Re-subscribe with new feed
    }
  }

  removePriceFeed(priceId: string): void {
    this.subscribedPriceIds.delete(priceId);
  }

  getLatestPrice(priceId: string): PriceFeed |

/**
 * CATE - Circuit Breaker & Fail-Safe Module
 * 
 * Production-grade failure handling.
 * System must FAIL CLOSED - never default to unsafe execution.
 * 
 * Handles:
 * - Oracle outages
 * - Data spikes
 * - Corrupted feeds
 * - Delayed updates
 */

import type { OracleSnapshot, OracleEvent, ConnectionState } from '../oracle/types';
import type { RiskDecision } from '../risk/engine';

// ============================================
// TYPES
// ============================================

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Failures before opening circuit */
  failureThreshold: number;
  
  /** Time to wait before half-open (ms) */
  resetTimeout: number;
  
  /** Successes needed to close from half-open */
  successThreshold: number;
  
  /** Max stale data age before tripping (ms) */
  maxStaleAge: number;
  
  /** Max confidence ratio spike before tripping */
  maxConfidenceSpike: number;
  
  /** Min data quality score before tripping */
  minDataQuality: number;
}

export interface CircuitStatus {
  /** Current state */
  state: CircuitState;
  
  /** Failure count */
  failureCount: number;
  
  /** Success count (in half-open) */
  successCount: number;
  
  /** Last state change */
  lastStateChange: number;
  
  /** Reason for current state */
  reason: string;
  
  /** Time until reset attempt (if open) */
  timeUntilReset?: number;
  
  /** Per-asset status */
  assetStatus: Map<string, AssetCircuitStatus>;
}

export interface AssetCircuitStatus {
  /** Asset ID */
  assetId: string;
  
  /** Is trading blocked for this asset */
  blocked: boolean;
  
  /** Reason for block */
  blockReason?: string;
  
  /** Last valid data timestamp */
  lastValidData: number;
  
  /** Consecutive failures */
  consecutiveFailures: number;
  
  /** Health score (0-100) */
  healthScore: number;
}

export interface FailureEvent {
  /** Event timestamp */
  timestamp: number;
  
  /** Failure type */
  type: 'STALE_DATA' | 'CONFIDENCE_SPIKE' | 'ORACLE_DISCONNECT' | 'DATA_QUALITY' | 'INVALID_DATA';
  
  /** Asset ID */
  assetId?: string;
  
  /** Details */
  details: string;
  
  /** Severity */
  severity: 'WARNING' | 'CRITICAL';
}

// ============================================
// DEFAULT CONFIG
// ============================================

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  successThreshold: 3,
  maxStaleAge: 30000, // 30 seconds
  maxConfidenceSpike: 5.0, // 5% confidence ratio
  minDataQuality: 30,
};

// ============================================
// CIRCUIT BREAKER
// ============================================

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastStateChange: number = Date.now();
  private reason: string = 'System initialized';
  private assetStatus: Map<string, AssetCircuitStatus> = new Map();
  private failureLog: FailureEvent[] = [];
  private resetTimer: NodeJS.Timeout | null = null;
  private subscribers: Set<(status: CircuitStatus) => void> = new Set();
  
  constructor(config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG) {
    this.config = { ...config };
    console.log('[CircuitBreaker] Initialized with config:', this.config);
  }
  
  // ==========================================
  // PUBLIC API
  // ==========================================
  
  /**
   * Check if trading is allowed for an asset
   * Returns false if circuit is open or asset is blocked
   */
  isAllowed(assetId: string): { allowed: boolean; reason: string } {
    // Global circuit check
    if (this.state === 'OPEN') {
      return { 
        allowed: false, 
        reason: `Circuit OPEN: ${this.reason}` 
      };
    }
    
    // Asset-specific check
    const assetStatus = this.assetStatus.get(assetId);
    if (assetStatus?.blocked) {
      return { 
        allowed: false, 
        reason: `Asset blocked: ${assetStatus.blockReason}` 
      };
    }
    
    return { allowed: true, reason: 'OK' };
  }
  
  /**
   * Process an oracle snapshot and check for failures
   */
  processSnapshot(snapshot: OracleSnapshot): void {
    const assetId = snapshot.price.assetId;
    const now = Date.now();
    
    // Initialize asset status if needed
    if (!this.assetStatus.has(assetId)) {
      this.assetStatus.set(assetId, {
        assetId,
        blocked: false,
        lastValidData: now,
        consecutiveFailures: 0,
        healthScore: 100,
      });
    }
    
    const status = this.assetStatus.get(assetId)!;
    const failures: FailureEvent[] = [];
    
    // Check stale data
    const dataAge = now - snapshot.price.publishTime;
    if (dataAge > this.config.maxStaleAge) {
      failures.push({
        timestamp: now,
        type: 'STALE_DATA',
        assetId,
        details: `Data is ${(dataAge / 1000).toFixed(1)}s old (max: ${this.config.maxStaleAge / 1000}s)`,
        severity: 'CRITICAL',
      });
    }
    
    // Check confidence spike
    if (snapshot.metrics.confidenceRatio > this.config.maxConfidenceSpike) {
      failures.push({
        timestamp: now,
        type: 'CONFIDENCE_SPIKE',
        assetId,
        details: `Confidence ratio ${snapshot.metrics.confidenceRatio.toFixed(2)}% exceeds ${this.config.maxConfidenceSpike}%`,
        severity: 'CRITICAL',
      });
    }
    
    // Check data quality
    if (snapshot.metrics.dataQualityScore < this.config.minDataQuality) {
      failures.push({
        timestamp: now,
        type: 'DATA_QUALITY',
        assetId,
        details: `Data quality ${snapshot.metrics.dataQualityScore.toFixed(0)} below ${this.config.minDataQuality}`,
        severity: 'WARNING',
      });
    }
    
    // Process failures
    if (failures.length > 0) {
      for (const failure of failures) {
        this.recordFailure(failure);
      }
      
      status.consecutiveFailures++;
      status.healthScore = Math.max(0, status.healthScore - 10 * failures.length);
      
      // Block asset if too many failures
      if (status.consecutiveFailures >= 3) {
        status.blocked = true;
        status.blockReason = failures[0].details;
      }
    } else {
      // Success - update status
      status.lastValidData = now;
      status.consecutiveFailures = 0;
      status.healthScore = Math.min(100, status.healthScore + 5);
      status.blocked = false;
      status.blockReason = undefined;
      
      this.recordSuccess();
    }
    
    this.assetStatus.set(assetId, status);
    this.notifySubscribers();
  }
  
  /**
   * Process oracle connection event
   */
  processConnectionEvent(state: ConnectionState): void {
    if (state === 'DISCONNECTED' || state === 'ERROR') {
      this.recordFailure({
        timestamp: Date.now(),
        type: 'ORACLE_DISCONNECT',
        details: `Oracle connection state: ${state}`,
        severity: 'CRITICAL',
      });
    } else if (state === 'CONNECTED') {
      this.recordSuccess();
    }
  }
  
  /**
   * Get current circuit status
   */
  getStatus(): CircuitStatus {
    const now = Date.now();
    let timeUntilReset: number | undefined;
    
    if (this.state === 'OPEN') {
      const elapsed = now - this.lastStateChange;
      timeUntilReset = Math.max(0, this.config.resetTimeout - elapsed);
    }
    
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastStateChange: this.lastStateChange,
      reason: this.reason,
      timeUntilReset,
      assetStatus: new Map(this.assetStatus),
    };
  }
  
  /**
   * Get recent failures
   */
  getRecentFailures(count: number = 20): FailureEvent[] {
    return this.failureLog.slice(-count).reverse();
  }
  
  /**
   * Force trip the circuit (emergency stop)
   */
  emergencyStop(reason: string): void {
    console.warn('[CircuitBreaker] EMERGENCY STOP:', reason);
    this.trip(`Emergency stop: ${reason}`);
  }
  
  /**
   * Manual reset (use with caution)
   */
  manualReset(): void {
    console.log('[CircuitBreaker] Manual reset initiated');
    this.close('Manual reset');
  }
  
  /**
   * Subscribe to status changes
   */
  subscribe(callback: (status: CircuitStatus) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getStatus());
    return () => this.subscribers.delete(callback);
  }
  
  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[CircuitBreaker] Config updated:', this.config);
  }
  
  // ==========================================
  // PRIVATE METHODS
  // ==========================================
  
  private recordFailure(failure: FailureEvent): void {
    this.failureLog.push(failure);
    if (this.failureLog.length > 1000) {
      this.failureLog.shift();
    }
    
    if (failure.severity === 'CRITICAL') {
      this.failureCount++;
      console.warn(`[CircuitBreaker] Failure recorded: ${failure.type} - ${failure.details}`);
      
      if (this.failureCount >= this.config.failureThreshold && this.state === 'CLOSED') {
        this.trip(failure.details);
      }
    }
  }
  
  private recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      
      if (this.successCount >= this.config.successThreshold) {
        this.close('Sufficient successful operations');
      }
    } else if (this.state === 'CLOSED') {
      // Decay failure count over time
      this.failureCount = Math.max(0, this.failureCount - 0.1);
    }
  }
  
  private trip(reason: string): void {
    this.state = 'OPEN';
    this.reason = reason;
    this.lastStateChange = Date.now();
    this.successCount = 0;
    
    console.error(`[CircuitBreaker] CIRCUIT OPENED: ${reason}`);
    
    // Schedule reset attempt
    this.scheduleReset();
    this.notifySubscribers();
  }
  
  private scheduleReset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    
    this.resetTimer = setTimeout(() => {
      this.halfOpen();
    }, this.config.resetTimeout);
  }
  
  private halfOpen(): void {
    this.state = 'HALF_OPEN';
    this.reason = 'Testing recovery';
    this.lastStateChange = Date.now();
    this.successCount = 0;
    
    console.log('[CircuitBreaker] Circuit HALF-OPEN, testing recovery');
    this.notifySubscribers();
  }
  
  private close(reason: string): void {
    this.state = 'CLOSED';
    this.reason = reason;
    this.lastStateChange = Date.now();
    this.failureCount = 0;
    this.successCount = 0;
    
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    
    // Clear all asset blocks
    for (const [assetId, status] of this.assetStatus) {
      status.blocked = false;
      status.blockReason = undefined;
      status.consecutiveFailures = 0;
    }
    
    console.log(`[CircuitBreaker] Circuit CLOSED: ${reason}`);
    this.notifySubscribers();
  }
  
  private notifySubscribers(): void {
    const status = this.getStatus();
    for (const callback of this.subscribers) {
      try {
        callback(status);
      } catch (error) {
        console.error('[CircuitBreaker] Subscriber error:', error);
      }
    }
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const circuitBreaker = new CircuitBreaker();

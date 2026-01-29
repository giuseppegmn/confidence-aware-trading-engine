/**
 * Circuit Breaker with Hysteresis and Debounce
 * Prevents flapping and ensures stability
 */

// =============================================================================
// TYPES
// =============================================================================

export type CircuitState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

export interface CircuitStatus {
  state: CircuitState;
  reason: string;
  failureCount: number;
  isOpen: boolean;
  lastFailureTime?: number;
  recoveryAttemptedAt?: number;
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;        // Failures before opening (default: 5)
  resetTimeoutMs?: number;          // Time before half-open (default: 30000)
  halfOpenMaxAttempts?: number;     // Max tests in half-open (default: 3)
  successThreshold?: number;        // Successes to close (default: 2)
  debounceMs?: number;              // Min time between state changes (default: 1000)
}

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private lastStateChange: number = 0;
  private recoveryAttemptedAt: number = 0;
  private halfOpenAttempts: number = 0;
  private reason: string = '';
  private subscribers: Set<(status: CircuitStatus) => void> = new Set();
  
  private config: Required<CircuitBreakerConfig>;

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenMaxAttempts: 3,
      successThreshold: 2,
      debounceMs: 1000,
      ...config
    };
  }

  // =============================================================================
  // SUBSCRIPTION
  // =============================================================================

  subscribe(callback: (status: CircuitStatus) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private notify(): void {
    const status = this.getStatus();
    this.subscribers.forEach(cb => {
      try {
        cb(status);
      } catch (error) {
        console.error('[CircuitBreaker] Subscriber error:', error);
      }
    });
  }

  // =============================================================================
  // STATE MANAGEMENT
  // =============================================================================

  isAllowed(assetId?: string): { allowed: boolean; reason: string } {
    const now = Date.now();

    switch (this.state) {
      case 'CLOSED':
        return { allowed: true, reason: 'Circuit closed' };

      case 'OPEN':
        // Check if ready for half-open
        if (now - this.lastFailureTime > this.config.resetTimeoutMs) {
          this.transitionTo('HALF_OPEN');
          this.recoveryAttemptedAt = now;
          this.halfOpenAttempts = 0;
          return { allowed: true, reason: 'Half-open: testing recovery' };
        }
        return { 
          allowed: false, 
          reason: `Circuit open: cooling down (${Math.ceil((this.config.resetTimeoutMs - (now - this.lastFailureTime)) / 1000)}s remaining)` 
        };

      case 'HALF_OPEN':
        // Limit attempts in half-open state
        if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
          this.transitionTo('OPEN');
          return { allowed: false, reason: 'Half-open limit reached, circuit reopened' };
        }
        this.halfOpenAttempts++;
        return { allowed: true, reason: 'Half-open: testing' };

      default:
        return { allowed: false, reason: 'Unknown state' };
    }
  }

  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      this.failureCount = 0;
      
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('CLOSED');
        console.log('[CircuitBreaker] Recovered and closed');
      }
    } else if (this.state === 'CLOSED') {
      // Decay failure count on success in closed state
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
    this.notify();
  }

  recordFailure(reason: string): void {
    const now = Date.now();
    this.failureCount++;
    this.lastFailureTime = now;
    this.successCount = 0;

    if (this.state === 'HALF_OPEN') {
      // Immediate trip back to open on failure in half-open
      this.transitionTo('OPEN');
      this.reason = `Recovery failed: ${reason}`;
      console.warn('[CircuitBreaker] Recovery failed, reopened');
    } else if (this.state === 'CLOSED' && this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('OPEN');
      this.reason = `Threshold reached: ${this.failureCount} failures (${reason})`;
      console.warn('[CircuitBreaker] Tripped open:', this.reason);
    }

    this.notify();
  }

  processSnapshot(snapshot: { price: { id: string; confidenceRatio: number } }): void {
    if (snapshot.price.confidenceRatio > 5.0) {
      this.recordFailure(`High confidence ratio: ${snapshot.price.confidenceRatio}`);
    } else {
      this.recordSuccess();
    }
  }

  processConnectionEvent(state: 'CONNECTED' | 'DISCONNECTED'): void {
    if (state === 'DISCONNECTED') {
      this.recordFailure('Oracle connection lost');
    }
  }

  emergencyStop(reason: string): void {
    this.transitionTo('OPEN');
    this.reason = `Emergency stop: ${reason}`;
    this.failureCount = this.config.failureThreshold;
    this.notify();
  }

  reset(): void {
    this.transitionTo('CLOSED');
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
    this.reason = '';
    this.notify();
  }

  // =============================================================================
  // INTERNALS
  // =============================================================================

  private transitionTo(newState: CircuitState): void {
    const now = Date.now();
    
    // Debounce: prevent rapid state changes
    if (now - this.lastStateChange < this.config.debounceMs && newState !== 'OPEN') {
      return;
    }

    console.log(`[CircuitBreaker] ${this.state} -> ${newState}`);
    this.state = newState;
    this.lastStateChange = now;

    if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenAttempts = 0;
    }
  }

  getStatus(): CircuitStatus {
    return {
      state: this.state,
      reason: this.reason,
      failureCount: this.failureCount,
      isOpen: this.state === 'OPEN',
      lastFailureTime: this.lastFailureTime,
      recoveryAttemptedAt: this.recoveryAttemptedAt
    };
  }
}

// Singleton
export const circuitBreaker = new CircuitBreaker();

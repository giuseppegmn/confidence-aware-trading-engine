/**
 * CATE - Decision Log & Observability
 * 
 * Production-grade logging and metrics for all trading decisions.
 * Every decision is:
 * - Persisted with full context
 * - Indexed for analysis
 * - Available for audit
 */

import type { RiskDecision, RiskFactor } from '../risk/engine';
import type { OracleSnapshot, OracleEvent } from '../oracle/types';
import type { ExecutionResult } from '../execution/jupiter';
import type { SignedDecision } from '../crypto/signing';

// ============================================
// TYPES
// ============================================

export interface DecisionLogEntry {
  /** Unique log ID */
  id: string;
  
  /** Timestamp */
  timestamp: number;
  
  /** Asset ID */
  assetId: string;
  
  /** Risk decision */
  decision: {
    action: string;
    riskScore: number;
    sizeMultiplier: number;
    explanation: string;
  };
  
  /** Triggered factors */
  triggeredFactors: string[];
  
  /** Oracle state at time of decision */
  oracleState: {
    price: number;
    confidence: number;
    confidenceRatio: number;
    dataFreshnessSeconds: number;
    source: string;
  };
  
  /** Signed decision hash */
  decisionHash: string;
  
  /** Signature */
  signature: string;
  
  /** Signer public key */
  signerPublicKey: string;
}

export interface ExecutionLogEntry {
  /** Unique log ID */
  id: string;
  
  /** Trade intent ID */
  tradeId: string;
  
  /** Timestamp */
  timestamp: number;
  
  /** Asset ID */
  assetId: string;
  
  /** Direction */
  direction: 'BUY' | 'SELL';
  
  /** Status */
  status: string;
  
  /** Intended amount */
  intendedAmount: string;
  
  /** Actual amount */
  actualAmount: string;
  
  /** Risk decision */
  riskDecision: {
    action: string;
    riskScore: number;
    sizeMultiplier: number;
  };
  
  /** Execution details */
  execution?: {
    price: number;
    slippageBps: number;
    txSignature?: string;
  };
  
  /** Error message */
  errorMessage?: string;
}

export interface OracleEventLogEntry {
  /** Unique log ID */
  id: string;
  
  /** Timestamp */
  timestamp: number;
  
  /** Event type */
  type: string;
  
  /** Asset ID */
  assetId?: string;
  
  /** Event data */
  data: any;
}

export interface SystemMetrics {
  /** Decisions in last hour */
  decisionsLastHour: number;
  
  /** Allow rate */
  allowRate: number;
  
  /** Scale rate */
  scaleRate: number;
  
  /** Block rate */
  blockRate: number;
  
  /** Average risk score */
  avgRiskScore: number;
  
  /** Most volatile assets */
  mostVolatileAssets: { assetId: string; volatility: number }[];
  
  /** Assets with confidence spikes */
  confidenceSpikeAssets: { assetId: string; confidenceRatio: number }[];
  
  /** Blocked trades count */
  blockedTradesCount: number;
  
  /** Executed trades count */
  executedTradesCount: number;
  
  /** Oracle health */
  oracleHealth: {
    connected: boolean;
    lastUpdate: number;
    staleAssets: string[];
  };
  
  /** System uptime */
  uptimeSeconds: number;
}

// ============================================
// LOG ID GENERATION
// ============================================

let logCounter = 0;

function generateLogId(prefix: string): string {
  logCounter++;
  const timestamp = Date.now().toString(36);
  const counter = logCounter.toString(36).padStart(6, '0');
  return `${prefix}-${timestamp}-${counter}`;
}

// ============================================
// DECISION LOGGER
// ============================================

export class DecisionLogger {
  private decisionLog: DecisionLogEntry[] = [];
  private executionLog: ExecutionLogEntry[] = [];
  private oracleEventLog: OracleEventLogEntry[] = [];
  private maxLogSize: number = 10000;
  private startTime: number;
  private subscribers: Set<(metrics: SystemMetrics) => void> = new Set();
  
  constructor() {
    this.startTime = Date.now();
  }
  
  // ==========================================
  // LOGGING METHODS
  // ==========================================
  
  logDecision(decision: RiskDecision): DecisionLogEntry {
    const entry: DecisionLogEntry = {
      id: generateLogId('DEC'),
      timestamp: decision.timestamp,
      assetId: decision.oracleSnapshot.price.assetId,
      decision: {
        action: decision.action,
        riskScore: decision.riskScore,
        sizeMultiplier: decision.sizeMultiplier,
        explanation: decision.explanation,
      },
      triggeredFactors: decision.factors
        .filter(f => f.triggered)
        .map(f => f.name),
      oracleState: {
        price: decision.oracleSnapshot.price.price,
        confidence: decision.oracleSnapshot.price.confidence,
        confidenceRatio: decision.oracleSnapshot.metrics.confidenceRatio,
        dataFreshnessSeconds: decision.oracleSnapshot.metrics.dataFreshnessSeconds,
        source: decision.oracleSnapshot.price.source,
      },
      decisionHash: decision.signedDecision.decisionHash,
      signature: decision.signedDecision.signature,
      signerPublicKey: decision.signedDecision.signerPublicKey,
    };
    
    this.addToLog(this.decisionLog, entry);
    this.notifySubscribers();
    
    return entry;
  }
  
  logExecution(result: ExecutionResult): ExecutionLogEntry {
    const entry: ExecutionLogEntry = {
      id: generateLogId('EXE'),
      tradeId: result.intent.id,
      timestamp: result.executedAt,
      assetId: result.intent.assetId,
      direction: result.intent.direction,
      status: result.status,
      intendedAmount: result.intent.inputAmount.toString(),
      actualAmount: result.actualInputAmount.toString(),
      riskDecision: {
        action: result.decision.action,
        riskScore: result.decision.riskScore,
        sizeMultiplier: result.decision.sizeMultiplier,
      },
      execution: result.executionPrice ? {
        price: result.executionPrice,
        slippageBps: result.actualSlippageBps || 0,
        txSignature: result.txSignature,
      } : undefined,
      errorMessage: result.errorMessage,
    };
    
    this.addToLog(this.executionLog, entry);
    this.notifySubscribers();
    
    return entry;
  }
  
  logOracleEvent(event: OracleEvent): OracleEventLogEntry {
    const entry: OracleEventLogEntry = {
      id: generateLogId('ORC'),
      timestamp: event.timestamp,
      type: event.type,
      assetId: event.assetId,
      data: event.data,
    };
    
    this.addToLog(this.oracleEventLog, entry);
    
    // Notify on critical events
    if (event.type === 'STALE_DATA' || event.type === 'ERROR') {
      this.notifySubscribers();
    }
    
    return entry;
  }
  
  // ==========================================
  // METRICS CALCULATION
  // ==========================================
  
  getMetrics(): SystemMetrics {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    
    // Decisions in last hour
    const recentDecisions = this.decisionLog.filter(d => d.timestamp > oneHourAgo);
    const totalRecent = recentDecisions.length || 1;
    
    const allowCount = recentDecisions.filter(d => d.decision.action === 'ALLOW').length;
    const scaleCount = recentDecisions.filter(d => d.decision.action === 'SCALE').length;
    const blockCount = recentDecisions.filter(d => d.decision.action === 'BLOCK').length;
    
    // Average risk score
    const avgRiskScore = recentDecisions.length > 0
      ? recentDecisions.reduce((sum, d) => sum + d.decision.riskScore, 0) / recentDecisions.length
      : 0;
    
    // Most volatile assets (by confidence ratio)
    const assetConfidence = new Map<string, number[]>();
    for (const d of recentDecisions) {
      const ratios = assetConfidence.get(d.assetId) || [];
      ratios.push(d.oracleState.confidenceRatio);
      assetConfidence.set(d.assetId, ratios);
    }
    
    const volatileAssets = Array.from(assetConfidence.entries())
      .map(([assetId, ratios]) => ({
        assetId,
        volatility: Math.max(...ratios),
      }))
      .sort((a, b) => b.volatility - a.volatility)
      .slice(0, 5);
    
    // Confidence spike assets
    const spikeAssets = Array.from(assetConfidence.entries())
      .filter(([_, ratios]) => ratios.some(r => r > 1))
      .map(([assetId, ratios]) => ({
        assetId,
        confidenceRatio: Math.max(...ratios),
      }))
      .sort((a, b) => b.confidenceRatio - a.confidenceRatio);
    
    // Execution stats
    const recentExecutions = this.executionLog.filter(e => e.timestamp > oneHourAgo);
    const blockedTrades = recentExecutions.filter(e => e.status === 'BLOCKED').length;
    const executedTrades = recentExecutions.filter(e => 
      e.status === 'EXECUTED' || e.status === 'SIMULATED'
    ).length;
    
    // Oracle health
    const latestDecision = this.decisionLog[this.decisionLog.length - 1];
    const staleEvents = this.oracleEventLog.filter(
      e => e.type === 'STALE_DATA' && e.timestamp > oneHourAgo
    );
    const staleAssets = [...new Set(staleEvents.map(e => e.assetId).filter(Boolean) as string[])];
    
    return {
      decisionsLastHour: recentDecisions.length,
      allowRate: allowCount / totalRecent,
      scaleRate: scaleCount / totalRecent,
      blockRate: blockCount / totalRecent,
      avgRiskScore,
      mostVolatileAssets: volatileAssets,
      confidenceSpikeAssets: spikeAssets,
      blockedTradesCount: blockedTrades,
      executedTradesCount: executedTrades,
      oracleHealth: {
        connected: latestDecision ? (now - latestDecision.timestamp) < 30000 : false,
        lastUpdate: latestDecision?.timestamp || 0,
        staleAssets,
      },
      uptimeSeconds: (now - this.startTime) / 1000,
    };
  }
  
  // ==========================================
  // QUERY METHODS
  // ==========================================
  
  getRecentDecisions(count: number = 50): DecisionLogEntry[] {
    return this.decisionLog.slice(-count).reverse();
  }
  
  getRecentExecutions(count: number = 50): ExecutionLogEntry[] {
    return this.executionLog.slice(-count).reverse();
  }
  
  getRecentOracleEvents(count: number = 100): OracleEventLogEntry[] {
    return this.oracleEventLog.slice(-count).reverse();
  }
  
  getDecisionsByAsset(assetId: string, count: number = 50): DecisionLogEntry[] {
    return this.decisionLog
      .filter(d => d.assetId === assetId)
      .slice(-count)
      .reverse();
  }
  
  getBlockedDecisions(count: number = 50): DecisionLogEntry[] {
    return this.decisionLog
      .filter(d => d.decision.action === 'BLOCK')
      .slice(-count)
      .reverse();
  }
  
  findDecisionByHash(hash: string): DecisionLogEntry | undefined {
    return this.decisionLog.find(d => d.decisionHash === hash);
  }
  
  // ==========================================
  // EXPORT METHODS
  // ==========================================
  
  exportDecisionLog(): string {
    return JSON.stringify(this.decisionLog, null, 2);
  }
  
  exportExecutionLog(): string {
    return JSON.stringify(this.executionLog, null, 2);
  }
  
  exportFullAuditLog(): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      decisions: this.decisionLog,
      executions: this.executionLog,
      oracleEvents: this.oracleEventLog,
      metrics: this.getMetrics(),
    }, null, 2);
  }
  
  // ==========================================
  // SUBSCRIPTION
  // ==========================================
  
  subscribe(callback: (metrics: SystemMetrics) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getMetrics());
    return () => this.subscribers.delete(callback);
  }
  
  // ==========================================
  // PRIVATE METHODS
  // ==========================================
  
  private addToLog<T>(log: T[], entry: T): void {
    log.push(entry);
    if (log.length > this.maxLogSize) {
      log.shift();
    }
  }
  
  private notifySubscribers(): void {
    const metrics = this.getMetrics();
    for (const callback of this.subscribers) {
      try {
        callback(metrics);
      } catch (error) {
        console.error('[DecisionLogger] Subscriber error:', error);
      }
    }
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const decisionLogger = new DecisionLogger();

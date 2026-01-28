/**
 * CATE - Execution Layer
 * 
 * Handles trade execution with mandatory risk checks.
 * No trade can bypass Risk Intelligence.
 * All trades are fully logged with decision context.
 * 
 * Initial: Simulated DEX environment
 * Future: Jupiter / Raydium integration
 */

import type {
  TradeIntent,
  ExecutionResult,
  ExecutionLog,
  ExecutionStatus,
  OracleSnapshot,
  RiskDecision,
} from './types';
import { riskEngine } from './riskIntelligence';
import { oracleService } from './oracleIngestion';

// ============================================
// EXECUTION ID GENERATION
// ============================================

let tradeCounter = 0;

function generateTradeId(): string {
  tradeCounter++;
  const timestamp = Date.now().toString(36);
  const counter = tradeCounter.toString(36).padStart(4, '0');
  const random = Math.random().toString(36).substring(2, 6);
  return `CATE-${timestamp}-${counter}-${random}`.toUpperCase();
}

// ============================================
// SIMULATED DEX EXECUTION
// ============================================

interface SimulatedMarket {
  liquidity: number;
  baseSlippage: number;
  volatilityImpact: number;
}

const simulatedMarkets: Record<string, SimulatedMarket> = {
  'SOL/USD': { liquidity: 50000000, baseSlippage: 0.001, volatilityImpact: 0.0005 },
  'BTC/USD': { liquidity: 200000000, baseSlippage: 0.0005, volatilityImpact: 0.0003 },
  'ETH/USD': { liquidity: 100000000, baseSlippage: 0.0008, volatilityImpact: 0.0004 },
  'JUP/USD': { liquidity: 10000000, baseSlippage: 0.002, volatilityImpact: 0.001 },
  'BONK/USD': { liquidity: 5000000, baseSlippage: 0.005, volatilityImpact: 0.002 },
};

function calculateSlippage(
  assetId: string,
  size: number,
  snapshot: OracleSnapshot
): number {
  const market = simulatedMarkets[assetId] || {
    liquidity: 1000000,
    baseSlippage: 0.002,
    volatilityImpact: 0.001,
  };
  
  // Size impact (larger trades = more slippage)
  const sizeValue = size * snapshot.price.price;
  const sizeImpact = (sizeValue / market.liquidity) * 0.1;
  
  // Volatility impact
  const volImpact = (snapshot.metrics.volatilityRealized / 100) * market.volatilityImpact;
  
  // Base slippage
  const baseSlip = market.baseSlippage;
  
  // Random factor (0.8 to 1.2)
  const randomFactor = 0.8 + Math.random() * 0.4;
  
  return (baseSlip + sizeImpact + volImpact) * randomFactor;
}

function simulateExecution(
  intent: TradeIntent,
  snapshot: OracleSnapshot,
  adjustedSize: number
): { price: number; slippage: number; success: boolean } {
  const slippage = calculateSlippage(intent.assetId, adjustedSize, snapshot);
  
  // Check if slippage exceeds max
  if (slippage > intent.maxSlippage) {
    return { price: 0, slippage, success: false };
  }
  
  // Calculate execution price
  const basePrice = snapshot.price.price;
  const slippageDirection = intent.side === 'BUY' ? 1 : -1;
  const executionPrice = basePrice * (1 + slippage * slippageDirection);
  
  return { price: executionPrice, slippage, success: true };
}

// ============================================
// EXECUTION ENGINE CLASS
// ============================================

export class ExecutionEngine {
  private executionLog: ExecutionResult[] = [];
  private maxLogLength: number = 1000;
  private subscribers = new Set<(result: ExecutionResult) => void>();
  
  /**
   * Submit a trade for execution
   * All trades go through Risk Intelligence first
   */
  async execute(intent: TradeIntent): Promise<ExecutionResult> {
    // Get current oracle state
    const snapshot = oracleService.getSnapshot(intent.assetId);
    
    if (!snapshot) {
      const result: ExecutionResult = {
        intent,
        decision: this.createBlockDecision('NO_ORACLE_DATA'),
        status: 'FAILED',
        executedSize: 0,
        errorMessage: `No oracle data available for ${intent.assetId}`,
        executedAt: Date.now(),
      };
      this.logResult(result);
      return result;
    }
    
    // MANDATORY: Evaluate risk
    const decision = riskEngine.evaluate(snapshot);
    
    // Handle blocked trades
    if (decision.action === 'BLOCK') {
      const result: ExecutionResult = {
        intent,
        decision,
        status: 'BLOCKED',
        executedSize: 0,
        errorMessage: this.extractBlockReason(decision),
        executedAt: Date.now(),
      };
      this.logResult(result);
      return result;
    }
    
    // Calculate adjusted size
    const adjustedSize = intent.intendedSize * decision.sizeMultiplier;
    
    // Simulate execution
    const execution = simulateExecution(intent, snapshot, adjustedSize);
    
    if (!execution.success) {
      const result: ExecutionResult = {
        intent,
        decision,
        status: 'FAILED',
        executedSize: 0,
        errorMessage: `Slippage ${(execution.slippage * 100).toFixed(2)}% exceeds max ${(intent.maxSlippage * 100).toFixed(2)}%`,
        executedAt: Date.now(),
      };
      this.logResult(result);
      return result;
    }
    
    // Success
    const result: ExecutionResult = {
      intent,
      decision,
      status: 'EXECUTED',
      executedSize: adjustedSize,
      executionPrice: execution.price,
      actualSlippage: execution.slippage,
      txHash: this.generateSimulatedTxHash(),
      executedAt: Date.now(),
    };
    
    this.logResult(result);
    return result;
  }
  
  /**
   * Create a trade intent
   */
  createIntent(
    assetId: string,
    side: 'BUY' | 'SELL',
    size: number,
    maxSlippage: number,
    trader: string
  ): TradeIntent {
    return {
      id: generateTradeId(),
      assetId,
      side,
      intendedSize: size,
      maxSlippage,
      timestamp: Date.now(),
      trader,
    };
  }
  
  /**
   * Get execution statistics
   */
  getStatistics(): {
    totalTrades: number;
    executedCount: number;
    blockedCount: number;
    failedCount: number;
    totalVolumeExecuted: number;
    averageSlippage: number;
    successRate: number;
  } {
    const total = this.executionLog.length;
    if (total === 0) {
      return {
        totalTrades: 0,
        executedCount: 0,
        blockedCount: 0,
        failedCount: 0,
        totalVolumeExecuted: 0,
        averageSlippage: 0,
        successRate: 0,
      };
    }
    
    const executed = this.executionLog.filter(r => r.status === 'EXECUTED');
    const blocked = this.executionLog.filter(r => r.status === 'BLOCKED').length;
    const failed = this.executionLog.filter(r => r.status === 'FAILED').length;
    
    const totalVolume = executed.reduce((sum, r) => {
      return sum + (r.executedSize * (r.executionPrice || 0));
    }, 0);
    
    const avgSlippage = executed.length > 0
      ? executed.reduce((sum, r) => sum + (r.actualSlippage || 0), 0) / executed.length
      : 0;
    
    return {
      totalTrades: total,
      executedCount: executed.length,
      blockedCount: blocked,
      failedCount: failed,
      totalVolumeExecuted: totalVolume,
      averageSlippage: avgSlippage,
      successRate: executed.length / total,
    };
  }
  
  /**
   * Get execution log
   */
  getLog(): ExecutionLog {
    const stats = this.getStatistics();
    const avgRisk = this.executionLog.length > 0
      ? this.executionLog.reduce((sum, r) => sum + r.decision.riskScore, 0) / this.executionLog.length
      : 0;
    
    return {
      results: [...this.executionLog],
      totalExecuted: stats.executedCount,
      totalBlocked: stats.blockedCount,
      totalFailed: stats.failedCount,
      averageRiskScore: avgRisk,
    };
  }
  
  /**
   * Get recent executions
   */
  getRecentExecutions(count: number = 10): ExecutionResult[] {
    return this.executionLog.slice(-count).reverse();
  }
  
  /**
   * Subscribe to execution results
   */
  subscribe(callback: (result: ExecutionResult) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
  
  /**
   * Clear execution log
   */
  clearLog(): void {
    this.executionLog = [];
  }
  
  // Private methods
  
  private logResult(result: ExecutionResult): void {
    this.executionLog.push(result);
    if (this.executionLog.length > this.maxLogLength) {
      this.executionLog.shift();
    }
    
    // Notify subscribers
    for (const callback of this.subscribers) {
      callback(result);
    }
  }
  
  private createBlockDecision(reason: string): RiskDecision {
    return {
      action: 'BLOCK',
      sizeMultiplier: 0,
      riskScore: 100,
      explanation: `TRADE BLOCKED: ${reason}`,
      factors: [{
        name: 'System',
        value: 0,
        threshold: 0,
        impact: -100,
        triggered: true,
        description: reason,
      }],
      timestamp: Date.now(),
      oracleState: null as any,
      parameters: null as any,
    };
  }
  
  private extractBlockReason(decision: RiskDecision): string {
    const triggeredFactors = decision.factors.filter(f => f.triggered);
    if (triggeredFactors.length === 0) return 'Risk threshold exceeded';
    return triggeredFactors.map(f => f.name).join(', ');
  }
  
  private generateSimulatedTxHash(): string {
    const chars = '0123456789abcdef';
    let hash = '';
    for (let i = 0; i < 64; i++) {
      hash += chars[Math.floor(Math.random() * chars.length)];
    }
    return hash;
  }
}

// Singleton instance
export const executionEngine = new ExecutionEngine();

// ============================================
// BATCH EXECUTION
// ============================================

export async function executeBatch(
  intents: TradeIntent[]
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  
  for (const intent of intents) {
    const result = await executionEngine.execute(intent);
    results.push(result);
    
    // Small delay between executions
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  return results;
}

// ============================================
// DEMO TRADE GENERATOR
// ============================================

export function generateDemoTrade(trader: string): TradeIntent {
  const assets = ['SOL/USD', 'BTC/USD', 'ETH/USD', 'JUP/USD', 'BONK/USD'];
  const assetId = assets[Math.floor(Math.random() * assets.length)];
  const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  
  // Size varies by asset
  const sizeBases: Record<string, number> = {
    'SOL/USD': 10,
    'BTC/USD': 0.1,
    'ETH/USD': 1,
    'JUP/USD': 1000,
    'BONK/USD': 10000000,
  };
  
  const baseSize = sizeBases[assetId] || 1;
  const size = baseSize * (0.5 + Math.random() * 2);
  const maxSlippage = 0.005 + Math.random() * 0.01; // 0.5% to 1.5%
  
  return executionEngine.createIntent(assetId, side, size, maxSlippage, trader);
}

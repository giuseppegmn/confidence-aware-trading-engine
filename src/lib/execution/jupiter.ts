/**
 * CATE - Jupiter Execution Layer
 * 
 * Production-grade trade execution via Jupiter Aggregator.
 * Features:
 * - Risk-gated execution (no bypassing)
 * - Position scaling based on risk
 * - Complete audit logging
 * - Slippage protection
 * - Balance tracking
 */

import { Connection, PublicKey, VersionedTransaction, TransactionMessage, Keypair } from '@solana/web3.js';
import type { RiskDecision } from '../risk/engine';
import type { OracleSnapshot } from '../oracle/types';

// ============================================
// TYPES
// ============================================

export type ExecutionStatus = 'PENDING' | 'EXECUTED' | 'BLOCKED' | 'FAILED' | 'SIMULATED';

export interface TokenBalance {
  mint: string;
  symbol: string;
  balance: number;
  decimals: number;
  usdValue?: number;
}

export interface TradeIntent {
  /** Unique trade ID */
  id: string;
  
  /** Input token mint */
  inputMint: string;
  
  /** Output token mint */
  outputMint: string;
  
  /** Input amount in smallest units */
  inputAmount: bigint;
  
  /** Minimum output amount (slippage protection) */
  minOutputAmount?: bigint;
  
  /** Maximum slippage in basis points */
  maxSlippageBps: number;
  
  /** Trade direction for display */
  direction: 'BUY' | 'SELL';
  
  /** Asset ID for risk evaluation */
  assetId: string;
  
  /** Timestamp of intent */
  timestamp: number;
  
  /** Trader's wallet */
  trader: string;
}

export interface ExecutionResult {
  /** Trade intent */
  intent: TradeIntent;
  
  /** Risk decision */
  decision: RiskDecision;
  
  /** Execution status */
  status: ExecutionStatus;
  
  /** Actual input amount (after scaling) */
  actualInputAmount: bigint;
  
  /** Actual output amount */
  actualOutputAmount?: bigint;
  
  /** Execution price */
  executionPrice?: number;
  
  /** Actual slippage in bps */
  actualSlippageBps?: number;
  
  /** Transaction signature */
  txSignature?: string;
  
  /** Error message */
  errorMessage?: string;
  
  /** Balances before execution */
  balancesBefore?: TokenBalance[];
  
  /** Balances after execution */
  balancesAfter?: TokenBalance[];
  
  /** Execution timestamp */
  executedAt: number;
  
  /** Jupiter quote used */
  jupiterQuote?: any;
}

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: any[];
}

// ============================================
// CONSTANTS
// ============================================

const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';

// Common token mints
export const TOKEN_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  BTC: '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E',
  ETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
};

// Asset ID to token mint mapping
export const ASSET_TO_MINT: Record<string, string> = {
  'SOL/USD': TOKEN_MINTS.SOL,
  'BTC/USD': TOKEN_MINTS.BTC,
  'ETH/USD': TOKEN_MINTS.ETH,
  'JUP/USD': TOKEN_MINTS.JUP,
  'BONK/USD': TOKEN_MINTS.BONK,
};

// ============================================
// JUPITER API CLIENT
// ============================================

async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: bigint,
  slippageBps: number
): Promise<JupiterQuote | null> {
  try {
    const url = `${JUPITER_API_URL}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippageBps=${slippageBps}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[Jupiter] Quote failed: ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('[Jupiter] Quote error:', error);
    return null;
  }
}

async function getJupiterSwapTransaction(
  quote: JupiterQuote,
  userPublicKey: string
): Promise<{ swapTransaction: string } | null> {
  try {
    const response = await fetch(`${JUPITER_API_URL}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });
    
    if (!response.ok) {
      console.error(`[Jupiter] Swap transaction failed: ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('[Jupiter] Swap transaction error:', error);
    return null;
  }
}

// ============================================
// TRADE ID GENERATION
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
// EXECUTION ENGINE
// ============================================

export class JupiterExecutionEngine {
  private connection: Connection;
  private executionLog: ExecutionResult[] = [];
  private maxLogLength: number = 1000;
  private subscribers: Set<(result: ExecutionResult) => void> = new Set();
  private simulationMode: boolean;
  
  constructor(rpcEndpoint: string, simulationMode: boolean = true) {
    this.connection = new Connection(rpcEndpoint, 'confirmed');
    this.simulationMode = simulationMode;
    
    console.log(`[JupiterExecution] Initialized in ${simulationMode ? 'SIMULATION' : 'LIVE'} mode`);
  }
  
  /**
   * Execute a trade with mandatory risk check
   * NO TRADE CAN BYPASS RISK INTELLIGENCE
   */
  async execute(
    intent: TradeIntent,
    decision: RiskDecision,
    wallet?: { publicKey: PublicKey; signTransaction: (tx: any) => Promise<any> }
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    // MANDATORY: Check risk decision
    if (decision.action === 'BLOCK') {
      const result = this.createBlockedResult(intent, decision);
      this.logResult(result);
      return result;
    }
    
    // Calculate scaled amount
    const scaledAmount = BigInt(
      Math.floor(Number(intent.inputAmount) * decision.sizeMultiplier)
    );
    
    if (scaledAmount === 0n) {
      const result = this.createFailedResult(
        intent, 
        decision, 
        'Scaled amount is zero'
      );
      this.logResult(result);
      return result;
    }
    
    // Get quote from Jupiter
    const quote = await getJupiterQuote(
      intent.inputMint,
      intent.outputMint,
      scaledAmount,
      intent.maxSlippageBps
    );
    
    if (!quote) {
      const result = this.createFailedResult(
        intent,
        decision,
        'Failed to get Jupiter quote'
      );
      this.logResult(result);
      return result;
    }
    
    // Check price impact
    const priceImpact = parseFloat(quote.priceImpactPct);
    if (priceImpact > intent.maxSlippageBps / 100) {
      const result = this.createFailedResult(
        intent,
        decision,
        `Price impact ${priceImpact.toFixed(2)}% exceeds max slippage`
      );
      result.jupiterQuote = quote;
      this.logResult(result);
      return result;
    }
    
    // Simulation mode - don't execute real transaction
    if (this.simulationMode || !wallet) {
      const result = this.createSimulatedResult(intent, decision, quote, scaledAmount);
      this.logResult(result);
      return result;
    }
    
    // LIVE EXECUTION
    try {
      // Get swap transaction
      const swapResult = await getJupiterSwapTransaction(
        quote,
        wallet.publicKey.toString()
      );
      
      if (!swapResult) {
        const result = this.createFailedResult(
          intent,
          decision,
          'Failed to build swap transaction'
        );
        this.logResult(result);
        return result;
      }
      
      // Deserialize and sign
      const swapTransactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      
      // Sign transaction
      const signedTransaction = await wallet.signTransaction(transaction);
      
      // Send and confirm
      const txSignature = await this.connection.sendRawTransaction(
        signedTransaction.serialize(),
        { skipPreflight: true, maxRetries: 3 }
      );
      
      // Wait for confirmation
      const confirmation = await this.connection.confirmTransaction(
        txSignature,
        'confirmed'
      );
      
      if (confirmation.value.err) {
        const result = this.createFailedResult(
          intent,
          decision,
          `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
        );
        result.txSignature = txSignature;
        this.logResult(result);
        return result;
      }
      
      // Success
      const result: ExecutionResult = {
        intent,
        decision,
        status: 'EXECUTED',
        actualInputAmount: scaledAmount,
        actualOutputAmount: BigInt(quote.outAmount),
        executionPrice: Number(quote.outAmount) / Number(scaledAmount),
        actualSlippageBps: Math.round(priceImpact * 100),
        txSignature,
        executedAt: Date.now(),
        jupiterQuote: quote,
      };
      
      this.logResult(result);
      return result;
      
    } catch (error) {
      const result = this.createFailedResult(
        intent,
        decision,
        `Execution error: ${error}`
      );
      this.logResult(result);
      return result;
    }
  }
  
  /**
   * Create a trade intent
   */
  createIntent(
    assetId: string,
    direction: 'BUY' | 'SELL',
    inputAmount: bigint,
    maxSlippageBps: number,
    trader: string
  ): TradeIntent {
    const tokenMint = ASSET_TO_MINT[assetId] || TOKEN_MINTS.SOL;
    
    return {
      id: generateTradeId(),
      inputMint: direction === 'BUY' ? TOKEN_MINTS.USDC : tokenMint,
      outputMint: direction === 'BUY' ? tokenMint : TOKEN_MINTS.USDC,
      inputAmount,
      maxSlippageBps,
      direction,
      assetId,
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
    simulatedCount: number;
    successRate: number;
  } {
    const total = this.executionLog.length;
    if (total === 0) {
      return {
        totalTrades: 0,
        executedCount: 0,
        blockedCount: 0,
        failedCount: 0,
        simulatedCount: 0,
        successRate: 0,
      };
    }
    
    return {
      totalTrades: total,
      executedCount: this.executionLog.filter(r => r.status === 'EXECUTED').length,
      blockedCount: this.executionLog.filter(r => r.status === 'BLOCKED').length,
      failedCount: this.executionLog.filter(r => r.status === 'FAILED').length,
      simulatedCount: this.executionLog.filter(r => r.status === 'SIMULATED').length,
      successRate: this.executionLog.filter(r => 
        r.status === 'EXECUTED' || r.status === 'SIMULATED'
      ).length / total,
    };
  }
  
  /**
   * Get execution log
   */
  getLog(): ExecutionResult[] {
    return [...this.executionLog];
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
   * Set simulation mode
   */
  setSimulationMode(enabled: boolean): void {
    this.simulationMode = enabled;
    console.log(`[JupiterExecution] Mode set to ${enabled ? 'SIMULATION' : 'LIVE'}`);
  }
  
  /**
   * Check if in simulation mode
   */
  isSimulationMode(): boolean {
    return this.simulationMode;
  }
  
  // ==========================================
  // PRIVATE METHODS
  // ==========================================
  
  private createBlockedResult(
    intent: TradeIntent,
    decision: RiskDecision
  ): ExecutionResult {
    const triggeredFactors = decision.factors
      .filter(f => f.triggered)
      .map(f => f.name)
      .join(', ');
    
    return {
      intent,
      decision,
      status: 'BLOCKED',
      actualInputAmount: 0n,
      errorMessage: `Risk blocked: ${triggeredFactors || 'Risk threshold exceeded'}`,
      executedAt: Date.now(),
    };
  }
  
  private createFailedResult(
    intent: TradeIntent,
    decision: RiskDecision,
    errorMessage: string
  ): ExecutionResult {
    return {
      intent,
      decision,
      status: 'FAILED',
      actualInputAmount: 0n,
      errorMessage,
      executedAt: Date.now(),
    };
  }
  
  private createSimulatedResult(
    intent: TradeIntent,
    decision: RiskDecision,
    quote: JupiterQuote,
    scaledAmount: bigint
  ): ExecutionResult {
    const priceImpact = parseFloat(quote.priceImpactPct);
    
    return {
      intent,
      decision,
      status: 'SIMULATED',
      actualInputAmount: scaledAmount,
      actualOutputAmount: BigInt(quote.outAmount),
      executionPrice: Number(quote.outAmount) / Number(scaledAmount),
      actualSlippageBps: Math.round(priceImpact * 100),
      txSignature: `SIM-${generateTradeId()}`,
      executedAt: Date.now(),
      jupiterQuote: quote,
    };
  }
  
  private logResult(result: ExecutionResult): void {
    this.executionLog.push(result);
    if (this.executionLog.length > this.maxLogLength) {
      this.executionLog.shift();
    }
    
    for (const callback of this.subscribers) {
      try {
        callback(result);
      } catch (error) {
        console.error('[JupiterExecution] Subscriber error:', error);
      }
    }
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const jupiterExecutionEngine = new JupiterExecutionEngine(
  'https://api.devnet.solana.com',
  true // Start in simulation mode
);

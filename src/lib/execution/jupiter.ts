/**
 * Jupiter Execution Engine
 * With transaction simulation and slippage protection
 */

import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { SOLANA_RPC } from '@/config/env';

// =============================================================================
// TYPES
// =============================================================================

export interface ExecutionIntent {
  assetId: string;
  direction: 'BUY' | 'SELL';
  amount: bigint;
  maxSlippageBps: number; // Basis points (100 = 1%)
}

export interface ExecutionResult {
  status: 'EXECUTED' | 'BLOCKED' | 'FAILED';
  signature?: string;
  reason?: string;
  assetId: string;
  timestamp: number;
  actualSlippageBps?: number;
  simulationError?: string;
}

interface JupiterRoute {
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  priceImpactPct: string;
  routePlan: any[];
}

// =============================================================================
// CONFIG
// =============================================================================

const JUPITER_API = 'https://quote-api.jup.ag/v6';
const MAX_PRICE_IMPACT = 5.0; // 5% max price impact
const MIN_LIQUIDITY = 1000; // Minimum $1000 liquidity
const SIMULATION_RETRIES = 3;

// =============================================================================
// EXECUTION ENGINE
// =============================================================================

export class JupiterExecutionEngine {
  private connection: Connection;
  private simulationMode: boolean = false;

  constructor() {
    this.connection = new Connection(SOLANA_RPC, 'confirmed');
  }

  setSimulationMode(enabled: boolean): void {
    this.simulationMode = enabled;
  }

  async execute(params: {
    assetId: string;
    direction: 'BUY' | 'SELL';
    amount: bigint;
    maxSlippageBps: number;
    wallet: { publicKey: PublicKey; signTransaction: (tx: any) => Promise<any> };
  }): Promise<ExecutionResult> {
    const { assetId, direction, amount, maxSlippageBps, wallet } = params;
    const startTime = Date.now();

    try {
      // 1. Get quote from Jupiter
      const inputMint = direction === 'BUY' 
        ? 'So11111111111111111111111111111111111111112' // WSOL
        : this.getMintForAsset(assetId);
      const outputMint = direction === 'BUY'
        ? this.getMintForAsset(assetId)
        : 'So11111111111111111111111111111111111111112';

      const quote = await this.getQuote(
        inputMint,
        outputMint,
        amount.toString(),
        maxSlippageBps
      );

      // 2. Validate quote
      const validation = this.validateQuote(quote, maxSlippageBps);
      if (!validation.valid) {
        return {
          status: 'BLOCKED',
          reason: validation.reason,
          assetId,
          timestamp: Date.now()
        };
      }

      // 3. Get swap transaction
      const swapTransaction = await this.getSwapTransaction(
        quote,
        wallet.publicKey.toString()
      );

      // 4. Simulate before executing (CRITICAL)
      const simulationResult = await this.simulateTransaction(swapTransaction);
      if (!simulationResult.success) {
        return {
          status: 'FAILED',
          reason: `Simulation failed: ${simulationResult.error}`,
          assetId,
          timestamp: Date.now(),
          simulationError: simulationResult.error
        };
      }

      // 5. Execute or simulate
      if (this.simulationMode) {
        return {
          status: 'EXECUTED',
          signature: 'SIMULATED_' + Date.now(),
          assetId,
          timestamp: Date.now(),
          actualSlippageBps: Math.floor(parseFloat(quote.priceImpactPct) * 100)
        };
      }

      // Deserialize and sign
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(swapTransaction.swapTransaction, 'base64')
      );

      const signed = await wallet.signTransaction(transaction);
      
      // Send and confirm
      const signature = await this.connection.sendRawTransaction(signed.serialize(), {
        maxRetries: 3,
        preflightCommitment: 'confirmed'
      });

      await this.connection.confirmTransaction(signature, 'confirmed');

      return {
        status: 'EXECUTED',
        signature,
        assetId,
        timestamp: Date.now(),
        actualSlippageBps: Math.floor(parseFloat(quote.priceImpactPct) * 100)
      };

    } catch (error) {
      console.error('[Jupiter] Execution error:', error);
      return {
        status: 'FAILED',
        reason: error instanceof Error ? error.message : 'Unknown error',
        assetId,
        timestamp: Date.now()
      };
    }
  }

  // =============================================================================
  // INTERNAL METHODS
  // =============================================================================

  private async getQuote(
    inputMint: string,
    outputMint: string,
    amount: string,
    slippageBps: number
  ): Promise<JupiterRoute> {
    const url = new URL(`${JUPITER_API}/quote`);
    url.searchParams.append('inputMint', inputMint);
    url.searchParams.append('outputMint', outputMint);
    url.searchParams.append('amount', amount);
    url.searchParams.append('slippageBps', slippageBps.toString());
    url.searchParams.append('onlyDirectRoutes', 'false');
    url.searchParams.append('asLegacyTransaction', 'false');

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`Jupiter API error: ${response.status}`);
    }

    return response.json();
  }

  private validateQuote(quote: JupiterRoute, maxSlippageBps: number): { valid: boolean; reason?: string } {
    // Check price impact
    const priceImpact = parseFloat(quote.priceImpactPct);
    if (priceImpact > MAX_PRICE_IMPACT) {
      return {
        valid: false,
        reason: `Price impact too high: ${priceImpact.toFixed(2)}% (max: ${MAX_PRICE_IMPACT}%)`
      };
    }

    // Check slippage tolerance
    if (priceImpact * 100 > maxSlippageBps) {
      return {
        valid: false,
        reason: `Slippage ${priceImpact.toFixed(2)}% exceeds tolerance ${(maxSlippageBps / 100).toFixed(2)}%`
      };
    }

    // Check if route exists
    if (!quote.routePlan || quote.routePlan.length === 0) {
      return { valid: false, reason: 'No valid route found' };
    }

    return { valid: true };
  }

  private async getSwapTransaction(quote: JupiterRoute, userPublicKey: string): Promise<any> {
    const response = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto'
      })
    });

    if (!response.ok) {
      throw new Error('Failed to get swap transaction');
    }

    return response.json();
  }

  private async simulateTransaction(swapTx: any): Promise<{ success: boolean; error?: string }> {
    try {
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(swapTx.swapTransaction, 'base64')
      );

      const result = await this.connection.simulateTransaction(transaction, {
        replaceRecentBlockhash: true,
        commitment: 'processed'
      });

      if (result.value.err) {
        return { success: false, error: JSON.stringify(result.value.err) };
      }

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Simulation failed' 
      };
    }
  }

  private getMintForAsset(assetId: string): string {
    // Map asset IDs to mint addresses
    const mappings: Record<string, string> = {
      'SOL/USD': 'So11111111111111111111111111111111111111112',
      'BTC/USD': '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
      'ETH/USD': '7vfCXTUXx5WJV5JkpCkYHV1h3p1P1N7zHZtpzF22npYN',
      'USDC/USD': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    };

    const mint = mappings[assetId];
    if (!mint) {
      throw new Error(`Unknown asset: ${assetId}`);
    }
    return mint;
  }
}

// Singleton
export const jupiterExecutionEngine = new JupiterExecutionEngine();

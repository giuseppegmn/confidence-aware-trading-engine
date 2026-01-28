/**
 * CATE - Solana Program Integration Hook
 * 
 * Provides React hooks for interacting with the CATE Trust Layer on-chain program.
 * Handles PDA derivation, transaction building, and status queries.
 */

import { useMemo, useCallback, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN, Idl } from '@coral-xyz/anchor';
import { PROGRAM_ID } from './configAddress';
import idl from '@/idl/workspaceIDL.json';

// ============================================
// TYPES
// ============================================

export interface OnChainRiskStatus {
  assetId: string;
  riskScore: number;
  isBlocked: boolean;
  lastUpdated: number;
  confidenceRatio: number;
  publisherCount: number;
}

export interface OnChainConfig {
  authority: PublicKey;
  isInitialized: boolean;
}

// ============================================
// PDA DERIVATION
// ============================================

const programId = new PublicKey(PROGRAM_ID);

export function getConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    programId
  );
}

export function getAssetRiskPDA(assetId: string): [PublicKey, number] {
  // Pad asset ID to 16 bytes
  const assetIdBuffer = Buffer.alloc(16);
  Buffer.from(assetId).copy(assetIdBuffer);
  
  return PublicKey.findProgramAddressSync(
    [Buffer.from('asset_risk'), assetIdBuffer],
    programId
  );
}

// ============================================
// PROGRAM HOOK
// ============================================

export function useCATEProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Create program instance
  const program = useMemo(() => {
    if (!wallet.publicKey) return null;
    
    const provider = new AnchorProvider(
      connection,
      wallet as any,
      { commitment: 'confirmed' }
    );
    
    return new Program(idl as Idl, programId, provider);
  }, [connection, wallet]);
  
  // Check if config is initialized
  const checkConfigInitialized = useCallback(async (): Promise<boolean> => {
    if (!program) return false;
    
    try {
      const [configPDA] = getConfigPDA();
      const config = await program.account.config.fetch(configPDA);
      return config?.isInitialized || false;
    } catch {
      return false;
    }
  }, [program]);
  
  // Initialize config
  const initializeConfig = useCallback(async (): Promise<string | null> => {
    if (!program || !wallet.publicKey) {
      setError('Wallet not connected');
      return null;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const [configPDA] = getConfigPDA();
      
      const tx = await program.methods
        .initializeConfig()
        .accounts({
          config: configPDA,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      return tx;
    } catch (err: any) {
      setError(err.message || 'Failed to initialize config');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [program, wallet.publicKey]);
  
  // Update risk status
  const updateRiskStatus = useCallback(async (
    assetId: string,
    riskScore: number,
    isBlocked: boolean,
    confidenceRatio: number,
    publisherCount: number
  ): Promise<string | null> => {
    if (!program || !wallet.publicKey) {
      setError('Wallet not connected');
      return null;
    }
    
    if (riskScore < 0 || riskScore > 100) {
      setError('Risk score must be between 0 and 100');
      return null;
    }
    
    if (assetId.length > 16) {
      setError('Asset ID must be 16 characters or less');
      return null;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const [configPDA] = getConfigPDA();
      const [assetRiskPDA] = getAssetRiskPDA(assetId);
      
      // Convert confidence ratio to basis points (u64)
      const confidenceRatioBps = new BN(Math.floor(confidenceRatio * 100));
      
      const tx = await program.methods
        .updateRiskStatus(
          assetId,
          riskScore,
          isBlocked,
          confidenceRatioBps,
          publisherCount
        )
        .accounts({
          config: configPDA,
          assetRiskStatus: assetRiskPDA,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      return tx;
    } catch (err: any) {
      setError(err.message || 'Failed to update risk status');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [program, wallet.publicKey]);
  
  // Get risk status for an asset
  const getRiskStatus = useCallback(async (
    assetId: string
  ): Promise<OnChainRiskStatus | null> => {
    if (!program) return null;
    
    try {
      const [assetRiskPDA] = getAssetRiskPDA(assetId);
      const status = await program.account.assetRiskStatus.fetch(assetRiskPDA);
      
      // Decode asset ID from bytes
      const assetIdDecoded = Buffer.from(status.assetId)
        .toString('utf8')
        .replace(/\0/g, '');
      
      return {
        assetId: assetIdDecoded,
        riskScore: status.riskScore,
        isBlocked: status.isBlocked,
        lastUpdated: status.lastUpdated.toNumber(),
        confidenceRatio: status.confidenceRatio.toNumber() / 100, // Convert from bps
        publisherCount: status.publisherCount,
      };
    } catch {
      return null;
    }
  }, [program]);
  
  // Get all risk statuses (requires knowing which assets exist)
  const getAllRiskStatuses = useCallback(async (
    assetIds: string[]
  ): Promise<Map<string, OnChainRiskStatus>> => {
    const statuses = new Map<string, OnChainRiskStatus>();
    
    for (const assetId of assetIds) {
      const status = await getRiskStatus(assetId);
      if (status) {
        statuses.set(assetId, status);
      }
    }
    
    return statuses;
  }, [getRiskStatus]);
  
  // Get config
  const getConfig = useCallback(async (): Promise<OnChainConfig | null> => {
    if (!program) return null;
    
    try {
      const [configPDA] = getConfigPDA();
      const config = await program.account.config.fetch(configPDA);
      
      return {
        authority: config.authority,
        isInitialized: config.isInitialized,
      };
    } catch {
      return null;
    }
  }, [program]);
  
  return {
    program,
    programId,
    isLoading,
    error,
    isConnected: !!wallet.publicKey,
    isAuthority: false, // Would need to check against config.authority
    
    // Actions
    initializeConfig,
    updateRiskStatus,
    
    // Queries
    checkConfigInitialized,
    getRiskStatus,
    getAllRiskStatuses,
    getConfig,
    
    // PDA helpers
    getConfigPDA,
    getAssetRiskPDA,
  };
}

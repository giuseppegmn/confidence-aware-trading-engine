/**
 * CATE - React Context Provider
 * 
 * Production-grade React integration for the CATE Engine.
 * Provides real-time state management for:
 * - Oracle feeds from Pyth Hermes
 * - Risk decisions with cryptographic signing
 * - Execution through Jupiter
 * - Circuit breaker status
 * - System observability
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  cateEngine,
  type EngineState,
  type EngineStatus,
  type OracleSnapshot,
  type RiskDecision,
  type ExecutionResult,
  type CircuitStatus,
  type SystemMetrics,
  SUPPORTED_ASSETS,
} from './CATEEngine';
import type { RiskParameters } from './risk/engine';
import { onChainTrustService } from './chain/onChainTrust';

// ============================================
// CONTEXT TYPES
// ============================================

interface CATEContextType {
  // Engine state
  isRunning: boolean;
  engineStatus: EngineStatus;
  
  // Oracle data
  snapshots: Map<string, OracleSnapshot>;
  selectedAsset: string;
  setSelectedAsset: (assetId: string) => void;
  
  // Risk decisions
  decisions: Map<string, RiskDecision>;
  
  // Execution
  recentExecutions: ExecutionResult[];
  executionStats: {
    totalTrades: number;
    executedCount: number;
    blockedCount: number;
    failedCount: number;
    simulatedCount: number;
    successRate: number;
  };
  
  // Circuit breaker
  circuitStatus: CircuitStatus;
  
  // Metrics
  metrics: SystemMetrics;
  
  // Risk parameters
  riskParams: RiskParameters;
  updateRiskParams: (params: Partial<RiskParameters>) => void;
  
  // Actions
  executeTrade: (assetId: string, side: 'BUY' | 'SELL', amount: bigint, maxSlippageBps: number) => Promise<ExecutionResult>;
  executeDemoTrade: () => Promise<ExecutionResult>;
  emergencyStop: (reason: string) => void;
  resetCircuitBreaker: () => void;
  
  // On-chain
  initializeOnChain: () => Promise<{ success: boolean; txSignature?: string; error?: string }>;
  publishToChain: (assetId: string) => Promise<{ success: boolean; txSignature?: string; error?: string }>;
  isChainInitialized: boolean;
  
  // Engine control
  startEngine: () => Promise<void>;
  stopEngine: () => void;
  
  // Mode
  isSimulationMode: boolean;
  setSimulationMode: (enabled: boolean) => void;
  
  // Signer info
  signerPublicKey: string;
  
  // Assets
  supportedAssets: typeof SUPPORTED_ASSETS;
}

const CATEContext = createContext<CATEContextType | null>(null);

// ============================================
// PROVIDER COMPONENT
// ============================================

export function CATEProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  
  // Engine state
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [selectedAsset, setSelectedAsset] = useState('SOL/USD');
  const [isChainInitialized, setIsChainInitialized] = useState(false);
  
  // Subscribe to engine updates
  useEffect(() => {
    const unsubscribe = cateEngine.subscribe((state) => {
      setEngineState(state);
    });
    
    return unsubscribe;
  }, []);
  
  // Auto-start engine
  useEffect(() => {
    cateEngine.start();
    return () => cateEngine.stop();
  }, []);
  
  // Initialize on-chain service when wallet connects
  useEffect(() => {
    if (wallet.publicKey && wallet.signTransaction) {
      onChainTrustService.initializeWithWallet(wallet as any);
      onChainTrustService.checkConfigInitialized().then(setIsChainInitialized);
    }
  }, [wallet.publicKey, wallet.signTransaction]);
  
  // Execute trade
  const executeTrade = useCallback(async (
    assetId: string,
    side: 'BUY' | 'SELL',
    amount: bigint,
    maxSlippageBps: number
  ): Promise<ExecutionResult> => {
    return cateEngine.executeTrade(
      assetId,
      side,
      amount,
      maxSlippageBps,
      wallet.publicKey && wallet.signTransaction ? wallet as any : undefined
    );
  }, [wallet]);
  
  // Execute demo trade
  const executeDemoTrade = useCallback(async (): Promise<ExecutionResult> => {
    return cateEngine.executeDemoTrade(
      wallet.publicKey && wallet.signTransaction ? wallet as any : undefined
    );
  }, [wallet]);
  
  // Initialize on-chain
  const initializeOnChain = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      return { success: false, error: 'Wallet not connected' };
    }
    
    const result = await cateEngine.initializeChainConfig(wallet as any);
    if (result.success) {
      setIsChainInitialized(true);
    }
    return result;
  }, [wallet]);
  
  // Publish to chain
  const publishToChain = useCallback(async (assetId: string) => {
    const decision = engineState?.decisions.get(assetId);
    if (!decision) {
      return { success: false, error: 'No decision for asset' };
    }
    return cateEngine.publishDecisionToChain(decision);
  }, [engineState?.decisions]);
  
  // Update risk params
  const updateRiskParams = useCallback((params: Partial<RiskParameters>) => {
    cateEngine.updateRiskParameters(params);
  }, []);
  
  // Emergency stop
  const emergencyStop = useCallback((reason: string) => {
    cateEngine.emergencyStop(reason);
  }, []);
  
  // Reset circuit breaker
  const resetCircuitBreaker = useCallback(() => {
    cateEngine.resetCircuitBreaker();
  }, []);
  
  // Start/stop engine
  const startEngine = useCallback(async () => {
    await cateEngine.start();
  }, []);
  
  const stopEngine = useCallback(() => {
    cateEngine.stop();
  }, []);
  
  // Set simulation mode
  const setSimulationMode = useCallback((enabled: boolean) => {
    cateEngine.setSimulationMode(enabled);
  }, []);
  
  // Memoized execution stats
  const executionStats = useMemo(() => {
    if (!engineState) {
      return {
        totalTrades: 0,
        executedCount: 0,
        blockedCount: 0,
        failedCount: 0,
        simulatedCount: 0,
        successRate: 0,
      };
    }
    
    const executions = engineState.recentExecutions;
    const total = executions.length || 1;
    
    return {
      totalTrades: executions.length,
      executedCount: executions.filter(e => e.status === 'EXECUTED').length,
      blockedCount: executions.filter(e => e.status === 'BLOCKED').length,
      failedCount: executions.filter(e => e.status === 'FAILED').length,
      simulatedCount: executions.filter(e => e.status === 'SIMULATED').length,
      successRate: executions.filter(e => e.status === 'EXECUTED' || e.status === 'SIMULATED').length / total,
    };
  }, [engineState?.recentExecutions]);
  
  const value: CATEContextType = {
    // Engine state
    isRunning: engineState?.isRunning ?? false,
    engineStatus: engineState?.status ?? {
      isRunning: false,
      oracleStatus: 'DISCONNECTED',
      circuitStatus: { state: 'CLOSED', failureCount: 0, successCount: 0, lastStateChange: 0, reason: '', assetStatus: new Map() },
      metrics: { decisionsLastHour: 0, allowRate: 0, scaleRate: 0, blockRate: 0, avgRiskScore: 0, mostVolatileAssets: [], confidenceSpikeAssets: [], blockedTradesCount: 0, executedTradesCount: 0, oracleHealth: { connected: false, lastUpdate: 0, staleAssets: [] }, uptimeSeconds: 0 },
      signerPublicKey: '',
      chainConfigInitialized: false,
      lastUpdate: 0,
    },
    
    // Oracle data
    snapshots: engineState?.snapshots ?? new Map(),
    selectedAsset,
    setSelectedAsset,
    
    // Risk decisions
    decisions: engineState?.decisions ?? new Map(),
    
    // Execution
    recentExecutions: engineState?.recentExecutions ?? [],
    executionStats,
    
    // Circuit breaker
    circuitStatus: engineState?.circuitStatus ?? { state: 'CLOSED', failureCount: 0, successCount: 0, lastStateChange: 0, reason: '', assetStatus: new Map() },
    
    // Metrics
    metrics: engineState?.metrics ?? { decisionsLastHour: 0, allowRate: 0, scaleRate: 0, blockRate: 0, avgRiskScore: 0, mostVolatileAssets: [], confidenceSpikeAssets: [], blockedTradesCount: 0, executedTradesCount: 0, oracleHealth: { connected: false, lastUpdate: 0, staleAssets: [] }, uptimeSeconds: 0 },
    
    // Risk parameters
    riskParams: cateEngine.getRiskParameters(),
    updateRiskParams,
    
    // Actions
    executeTrade,
    executeDemoTrade,
    emergencyStop,
    resetCircuitBreaker,
    
    // On-chain
    initializeOnChain,
    publishToChain,
    isChainInitialized,
    
    // Engine control
    startEngine,
    stopEngine,
    
    // Mode
    isSimulationMode: cateEngine.isSimulationMode(),
    setSimulationMode,
    
    // Signer info
    signerPublicKey: cateEngine.getSignerPublicKey(),
    
    // Assets
    supportedAssets: SUPPORTED_ASSETS,
  };
  
  return (
    <CATEContext.Provider value={value}>
      {children}
    </CATEContext.Provider>
  );
}

// ============================================
// HOOKS
// ============================================

export function useCATE(): CATEContextType {
  const context = useContext(CATEContext);
  if (!context) {
    throw new Error('useCATE must be used within a CATEProvider');
  }
  return context;
}

export function useAssetSnapshot(assetId: string): OracleSnapshot | undefined {
  const { snapshots } = useCATE();
  return snapshots.get(assetId);
}

export function useAssetDecision(assetId: string): RiskDecision | undefined {
  const { decisions } = useCATE();
  return decisions.get(assetId);
}

export function useSelectedAsset(): {
  assetId: string;
  snapshot: OracleSnapshot | undefined;
  decision: RiskDecision | undefined;
  setAsset: (assetId: string) => void;
} {
  const { selectedAsset, setSelectedAsset, snapshots, decisions } = useCATE();
  return {
    assetId: selectedAsset,
    snapshot: snapshots.get(selectedAsset),
    decision: decisions.get(selectedAsset),
    setAsset: setSelectedAsset,
  };
}

export function useCircuitBreaker() {
  const { circuitStatus, emergencyStop, resetCircuitBreaker } = useCATE();
  return {
    status: circuitStatus,
    emergencyStop,
    reset: resetCircuitBreaker,
    isOpen: circuitStatus.state === 'OPEN',
    isHalfOpen: circuitStatus.state === 'HALF_OPEN',
    isClosed: circuitStatus.state === 'CLOSED',
  };
}

export function useSystemMetrics() {
  const { metrics, engineStatus } = useCATE();
  return {
    metrics,
    oracleConnected: engineStatus.oracleStatus === 'CONNECTED',
    uptimeSeconds: metrics.uptimeSeconds,
    blockRate: metrics.blockRate,
    avgRiskScore: metrics.avgRiskScore,
  };
}

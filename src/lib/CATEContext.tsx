import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { CATEEngine, EngineState } from './CATEEngine';
import { CircuitStatus } from './failsafe/circuitBreaker';
import { RiskDecision, RiskParameters } from './risk/engine';
import { ExecutionResult } from './execution/jupiter';
import { toast } from '@/hooks/use-toast';

// =============================================================================
// TYPES
// =============================================================================

interface CATEContextType {
  isRunning: boolean;
  isLoading: boolean;
  engineState: EngineState | null;
  circuitStatus: CircuitStatus;
  selectedAsset: string | null;
  
  startEngine: () => Promise<void>;
  stopEngine: () => void;
  executeTrade: (assetId: string, direction: 'BUY' | 'SELL', amount: bigint, maxSlippageBps: number) => Promise<ExecutionResult | null>;
  updateRiskParams: (params: Partial<RiskParameters>) => void;
  selectAsset: (assetId: string | null) => void;
}

// =============================================================================
// CONTEXT
// =============================================================================

const CATEContext = createContext<CATEContextType | undefined>(undefined);

export function useCATE() {
  const context = useContext(CATEContext);
  if (!context) {
    throw new Error('useCATE must be used within CATEProvider');
  }
  return context;
}

// =============================================================================
// PROVIDER
// =============================================================================

export function CATEProvider({ children }: { children: React.ReactNode }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  
  // Engine instance (singleton)
  const engineRef = useRef<CATEEngine | null>(null);
  
  // State
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [circuitStatus, setCircuitStatus] = useState<CircuitStatus>({
    state: 'CLOSED',
    reason: '',
    failureCount: 0,
    isOpen: false
  });
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [riskParams, setRiskParams] = useState<RiskParameters>({
    maxConfidenceRatioScale: 1.0,
    maxConfidenceRatioBlock: 3.0,
    maxConfidenceZscore: 2.5,
    maxStalenessSeconds: 60,
    minDataQualityScore: 80
  });

  // Refs para cleanup
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Initialize engine
  useEffect(() => {
    if (!engineRef.current) {
      engineRef.current = new CATEEngine({
        simulationMode: false,
        publishToChain: true
      });
    }

    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      if (engineRef.current && isRunning) {
        engineRef.current.stop();
      }
    };
  }, []);

  // Subscribe to engine updates with cleanup
  useEffect(() => {
    if (!engineRef.current) return;

    const engine = engineRef.current;
    
    const handleStateChange = (state: EngineState) => {
      if (!isMountedRef.current) return;
      
      setEngineState(state);
      setCircuitStatus(state.circuitStatus);
      setIsRunning(state.isRunning);
    };

    const unsubscribe = engine.subscribe(handleStateChange);
    
    // Cleanup subscription on unmount
    return () => {
      unsubscribe();
    };
  }, []);

  // Start engine
  const startEngine = useCallback(async () => {
    if (!engineRef.current || isLoading) return;
    
    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    
    try {
      await engineRef.current.start();
      toast({
        title: "Engine Started",
        description: "CATE risk monitoring is now active"
      });
    } catch (error) {
      toast({
        title: "Failed to start engine",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [isLoading]);

  // Stop engine
  const stopEngine = useCallback(() => {
    if (!engineRef.current) return;
    
    abortControllerRef.current?.abort();
    engineRef.current.stop();
    
    toast({
      title: "Engine Stopped",
      description: "Risk monitoring paused"
    });
  }, []);

  // Execute trade with mutex protection
  const executeTrade = useCallback(async (
    assetId: string,
    direction: 'BUY' | 'SELL',
    amount: bigint,
    maxSlippageBps: number
  ): Promise<ExecutionResult | null> => {
    if (!engineRef.current || !wallet.publicKey) {
      toast({
        title: "Error",
        description: "Engine not running or wallet not connected",
        variant: "destructive"
      });
      return null;
    }

    setIsLoading(true);
    
    try {
      const result = await engineRef.current.executeTransaction(
        assetId,
        direction,
        amount,
        maxSlippageBps,
        wallet
      );
      
      if (result.status === 'EXECUTED') {
        toast({
          title: "Trade Executed",
          description: `${direction} ${assetId} - Tx: ${result.signature?.slice(0, 8)}...`
        });
      } else {
        toast({
          title: "Trade Blocked",
          description: result.reason || "Risk check failed",
          variant: "destructive"
        });
      }
      
      return result;
    } catch (error) {
      toast({
        title: "Execution Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
      return null;
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [wallet]);

  // Update risk parameters
  const updateRiskParams = useCallback((params: Partial<RiskParameters>) => {
    setRiskParams(prev => ({ ...prev, ...params }));
    if (engineRef.current) {
      engineRef.current.updateRiskParams({ ...riskParams, ...params });
    }
  }, [riskParams]);

  // Select asset
  const selectAsset = useCallback((assetId: string | null) => {
    setSelectedAsset(assetId);
  }, []);

  const value: CATEContextType = {
    isRunning,
    isLoading,
    engineState,
    circuitStatus,
    selectedAsset,
    startEngine,
    stopEngine,
    executeTrade,
    updateRiskParams,
    selectAsset
  };

  return (
    <CATEContext.Provider value={value}>
      {children}
    </CATEContext.Provider>
  );
}

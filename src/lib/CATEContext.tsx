import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { pythHermesService } from './oracle/pythHermes';
import { riskEngine } from './risk/engine';
import { circuitBreaker, CircuitStatus } from './failsafe/circuitBreaker';
import { decisionLogger } from './observability/decisionLog';
import { onChainTrustService } from './chain/onChainTrust';
import { requestRemoteSigning, DecisionPayload } from './crypto/signing';
import { PublicKey } from '@solana/web3.js';

// ... (interfaces mantidas) ...

export function CATEProvider({ children }: { children: React.ReactNode }) {
  const [isRunning, setIsRunning] = useState(false);
  const [snapshots, setSnapshots] = useState<Map<string, OracleSnapshot>>(new Map());
  const [decisions, setDecisions] = useState<Map<string, RiskDecision>>(new Map());
  const [metrics, setMetrics] = useState<SystemMetrics>({});
  const [circuitStatus, setCircuitStatus] = useState<CircuitStatus>({ 
    state: 'CLOSED', 
    reason: '', 
    failureCount: 0,
    isOpen: false 
  });
  
  // Ref para controlar nonce único por sessão
  const nonceRef = useRef(0);

  // ... (outros estados) ...

  /**
   * Atualização de risco com assinatura remota
   */
  const updateRiskStatus = useCallback(async (assetId: string, decision: RiskDecision) => {
    try {
      const snapshot = snapshots.get(assetId);
      if (!snapshot) {
        throw new Error('No snapshot available for signing');
      }

      // Prepara payload para API
      const payload: DecisionPayload = {
        assetId,
        price: snapshot.price.price,
        timestamp: Math.floor(Date.now() / 1000),
        confidenceRatio: Math.floor(snapshot.price.confidence * 100), // Converter para basis points
        riskScore: decision.score || 0,
        isBlocked: decision.action === 'BLOCK',
        publisherCount: snapshot.price.numPublishers || 0,
        nonce: ++nonceRef.current // Prevents replay attacks
      };

      // 🔐 ASSINATURA REMOTA (nunca local!)
      const signedDecision = await requestRemoteSigning(payload);

      // Envia para blockchain
      const tx = await onChainTrustService.submitDecision({
        assetId,
        riskScore: signedDecision.riskScore,
        isBlocked: signedDecision.isBlocked,
        confidenceRatio: signedDecision.confidenceRatio,
        publisherCount: signedDecision.publisherCount,
        timestamp: signedDecision.timestamp,
        decisionHash: new Uint8Array(signedDecision.decisionHash),
        signature: new Uint8Array(signedDecision.signature),
        signerPubkey: new Uint8Array(signedDecision.signerPublicKey)
      });

      decisionLogger.logExecution({
        assetId,
        decision,
        txSignature: tx,
        timestamp: Date.now()
      });

      return tx;
    } catch (error) {
      console.error('[CATEContext] Failed to update risk status:', error);
      circuitBreaker.recordFailure(`updateRiskStatus_${assetId}`);
      throw error;
    }
  }, [snapshots]);

  /**
   * Execução de trade (sem acesso a chaves privadas)
   */
  const executeTrade = useCallback(async (
    assetId: string,
    direction: 'BUY' | 'SELL',
    amount: bigint,
    maxSlippageBps: number,
    wallet: WalletContextState // Apenas para pagar gas, NUNCA para assinar decisões
  ) => {
    const decision = decisions.get(assetId);
    if (!decision) {
      throw new Error('No decision available');
    }

    // Se precisar atualizar o status na chain primeiro (com assinatura remota)
    if (decision.requiresUpdate) {
      await updateRiskStatus(assetId, decision);
    }

    // Executa trade via Jupiter (wallet do usuário paga gas, mas não assina decisão de risco)
    const result = await jupiterExecutionEngine.execute({
      assetId,
      direction,
      amount,
      maxSlippageBps,
      wallet // Apenas para transação Solana padrão (não para assinar CATE)
    });

    return result;
  }, [decisions, updateRiskStatus]);

  // ... (resto do provider) ...

  return (
    <CATEContext.Provider value={{
      isRunning,
      startEngine,
      stopEngine,
      executeTrade,
      updateRiskStatus,
      // ... outros valores
    }}>
      {children}
    </CATEContext.Provider>
  );
}

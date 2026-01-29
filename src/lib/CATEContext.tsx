import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { requestRemoteSigning } from './crypto/signing'

const CATEContext = createContext(null)

export function useCATE() {
  const context = useContext(CATEContext)
  if (!context) throw new Error('useCATE must be used within CATEProvider')
  return context
}

export function CATEProvider({ children }) {
  const [isRunning, setIsRunning] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [signerKey, setSignerKey] = useState(null)
  const [lastDecision, setLastDecision] = useState(null) // NOVO: guarda última decisão
  const intervalRef = useRef(null)

  // Buscar chave pública do backend
  useEffect(() => {
    fetch('http://localhost:3001/health')
      .then(r => r.json())
      .then(data => setSignerKey(data.publicKey))
      .catch(console.error)
  }, [])

  const startEngine = useCallback(() => {
    setIsRunning(true)
    setIsLoading(true)
    
    intervalRef.current = setInterval(() => {
      setLastUpdate(new Date().toLocaleTimeString())
    }, 3000)
    
    setTimeout(() => setIsLoading(false), 1000)
    console.log('✅ Engine iniciado')
  }, [])

  const stopEngine = useCallback(() => {
    setIsRunning(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
    setLastDecision(null)
    console.log('⏹️ Engine parado')
  }, [])

  // Função de decisão com size multiplier!
  const evaluateAndSign = useCallback(async (assetId = 'SOL/USD') => {
    try {
      // Simula snapshot do oracle
      const mockConfidence = 1.5 + Math.random() * 3 // 1.5% a 4.5% para demo
      const snapshot = {
        price: {
          id: assetId,
          price: 100 + Math.random() * 10,
          confidenceRatio: mockConfidence,
          publishTime: Math.floor(Date.now() / 1000) - 10, // 10s atrás
          numPublishers: 5
        }
      }

      // Importa e avalia risco
      const { riskEngine } = await import('./riskIntelligence')
      const decision = riskEngine.evaluate(snapshot)
      setLastDecision(decision)

      console.log('📊 Decisão de risco:', decision)

      // Se for BLOCK, não assina
      if (decision.action === 'BLOCK') {
        return { blocked: true, decision }
      }

      // Prepara payload para assinatura
      const payload = {
        assetId,
        price: snapshot.price.price,
        timestamp: Math.floor(Date.now() / 1000),
        confidenceRatio: Math.floor(mockConfidence * 100),
        riskScore: decision.score,
        isBlocked: false,
        publisherCount: 5,
        nonce: Date.now()
      }

      console.log('📡 Assinando com sizeMultiplier:', decision.sizeMultiplier)
      const signed = await requestRemoteSigning(payload)
      
      return { signed, decision }

    } catch (error) {
      console.error('❌ Erro:', error)
      throw error
    }
  }, [])

  const value = {
    isRunning,
    isLoading,
    lastUpdate,
    signerKey,
    lastDecision, // NOVO: expõe última decisão
    startEngine,
    stopEngine,
    evaluateAndSign, // NOVO: função unificada
    executeTrade: async () => null,
    updateRiskParams: () => {},
    selectAsset: () => {},
    engineState: null,
    circuitStatus: { state: 'CLOSED', reason: '', failureCount: 0, isOpen: false },
    selectedAsset: null,
    metrics: { totalDecisions: 0, blockedTrades: 0, executedTrades: 0 }
  }

  return (
    <CATEContext.Provider value={value}>
      {children}
    </CATEContext.Provider>
  )
}

export function useCircuitBreaker() {
  return { state: 'CLOSED', reason: '', failureCount: 0, isOpen: false }
}

export function useSelectedAsset() {
  return { assetId: null, setSelectedAsset: () => {}, asset: null }
}

export function useSystemMetrics() {
  return { totalDecisions: 0, blockedTrades: 0, executedTrades: 0, oracleStatus: 'CONNECTED', lastUpdate: Date.now() }
}

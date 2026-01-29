import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { requestRemoteSigning, DecisionPayload } from './crypto/signing'

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
  const intervalRef = useRef(null)

  // Buscar chave pública do backend ao iniciar
  useEffect(() => {
    fetch('http://localhost:3001/health')
      .then(r => r.json())
      .then(data => setSignerKey(data.publicKey))
      .catch(console.error)
  }, [])

  const startEngine = useCallback(() => {
    setIsRunning(true)
    setIsLoading(true)
    
    // Simula polling do oracle
    intervalRef.current = setInterval(() => {
      setLastUpdate(new Date().toLocaleTimeString())
    }, 3000)
    
    setTimeout(() => setIsLoading(false), 1000)
    console.log('✅ Engine iniciado - Conectado ao backend')
  }, [])

  const stopEngine = useCallback(() => {
    setIsRunning(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
    console.log('⏹️ Engine parado')
  }, [])

  // Função de assinatura real!
  const signDecision = useCallback(async (assetId = 'SOL/USD') => {
    try {
      const payload = {
        assetId,
        price: 100.50,
        timestamp: Math.floor(Date.now() / 1000),
        confidenceRatio: 9500,
        riskScore: 25,
        isBlocked: false,
        publisherCount: 5,
        nonce: Date.now()
      }

      console.log('📡 Enviando para assinatura...', payload)
      const signed = await requestRemoteSigning(payload)
      console.log('✅ Assinatura recebida!', signed)
      return signed
    } catch (error) {
      console.error('❌ Erro na assinatura:', error)
      throw error
    }
  }, [])

  const value = {
    isRunning,
    isLoading,
    lastUpdate,
    signerKey,
    startEngine,
    stopEngine,
    signDecision,
    executeTrade: async () => null,
    updateRiskParams: () => {},
    selectAsset: () => {},
    engineState: null,
    circuitStatus: { state: 'CLOSED', reason: 'Sistema operacional', failureCount: 0, isOpen: false },
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
  return { state: 'CLOSED', reason: 'Sistema operacional', failureCount: 0, isOpen: false }
}

export function useSelectedAsset() {
  return { assetId: null, setSelectedAsset: () => {}, asset: null }
}

export function useSystemMetrics() {
  return { totalDecisions: 0, blockedTrades: 0, executedTrades: 0, oracleStatus: 'CONNECTED', lastUpdate: Date.now() }
}

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { requestRemoteSigning } from './crypto/signing'
import { riskEngine } from './riskIntelligence'

const CATEContext = createContext(null)

export function useCATE() {
  const context = useContext(CATEContext)
  if (!context) throw new Error('useCATE must be used within CATEProvider')
  return context
}

// Simulador de volatilidade - mantém histórico entre chamadas
function createVolatilityTracker() {
  const prices = []
  const maxHistory = 20
  
  return {
    addPrice(price) {
      prices.push(price)
      if (prices.length > maxHistory) prices.shift()
    },
    getVolatility() {
      if (prices.length < 5) return 0
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length
      const squaredDiffs = prices.map(p => Math.pow(p - mean, 2))
      const variance = squaredDiffs.reduce((a, b) => a + b, 0) / prices.length
      const stdDev = Math.sqrt(variance)
      return parseFloat(((stdDev / mean) * 100).toFixed(2))
    },
    getCount() {
      return prices.length
    }
  }
}

export function CATEProvider({ children }) {
  const [isRunning, setIsRunning] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [signerKey, setSignerKey] = useState(null)
  const [lastDecision, setLastDecision] = useState(null)
  
  // useRef para manter o tracker entre renders
  const volTrackerRef = useRef(null)
  
  // Inicializa o tracker uma vez
  if (!volTrackerRef.current) {
    volTrackerRef.current = createVolatilityTracker()
  }
  
  const intervalRef = useRef(null)

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
  }, [])

  const stopEngine = useCallback(() => {
    setIsRunning(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
    setLastDecision(null)
    // Não reseta o volTracker para manter histórico
  }, [])

  const evaluateAndSign = useCallback(async (assetId = 'SOL/USD') => {
    try {
      // Gera preço com variação realista
      const basePrice = 100
      const variation = (Math.random() - 0.5) * 8 // ±4% de variação
      const price = Math.max(80, basePrice + variation)
      
      // Adiciona ao tracker (persistente!)
      volTrackerRef.current.addPrice(price)
      const volatility = volTrackerRef.current.getVolatility()
      const count = volTrackerRef.current.getCount()
      
      // Confidence aleatório
      const confidenceRatio = 0.5 + Math.random() * 3
      
      console.log(`[Vol] Preço: ${price.toFixed(2)} | Histórico: ${count} | Vol: ${volatility}%`)

      const snapshot = {
        price: {
          id: assetId,
          price: price,
          confidenceRatio: confidenceRatio,
          publishTime: Math.floor(Date.now() / 1000) - 10,
          numPublishers: 5,
          volatility24h: volatility
        }
      }

      const decision = riskEngine.evaluate(snapshot)
      setLastDecision(decision)

      if (decision.action === 'BLOCK') {
        return { blocked: true, decision }
      }

      const payload = {
        assetId,
        price: price,
        timestamp: Math.floor(Date.now() / 1000),
        confidenceRatio: Math.floor(confidenceRatio * 100),
        riskScore: decision.score,
        isBlocked: false,
        publisherCount: 5,
        nonce: Date.now()
      }

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
    lastDecision,
    startEngine,
    stopEngine,
    evaluateAndSign,
    circuitStatus: { state: 'CLOSED', reason: '', failureCount: 0, isOpen: false },
    metrics: {}
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

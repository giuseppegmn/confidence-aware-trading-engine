import { useState } from 'react'
import { useCATE } from './lib/CATEContext'

function App() {
  const { isRunning, isLoading, startEngine, stopEngine, lastUpdate, signerKey, signDecision } = useCATE()
  const [signatureResult, setSignatureResult] = useState(null)

  const handleSign = async () => {
    try {
      const result = await signDecision('SOL/USD')
      setSignatureResult(result.signerBase58.substring(0, 20) + '...')
      alert('✅ Assinatura bem-sucedida!\n\nAssinado por: ' + result.signerBase58.substring(0, 15) + '...')
    } catch (err) {
      alert('❌ Erro: ' + err.message)
    }
  }

  return (
    <div style={{padding: 20, fontFamily: 'Arial, sans-serif', maxWidth: '600px', margin: '0 auto'}}>
      <h1>🔒 CATE Engine</h1>
      <p style={{color: '#666'}}>Confidence-Aware Trading Engine</p>
      
      {/* Status Card */}
      <div style={{marginBottom: 20, padding: 15, background: '#f5f5f5', borderRadius: 8, border: '1px solid #ddd'}}>
        <h3 style={{marginTop: 0}}>Status do Sistema</h3>
        <p>
          <strong>Engine:</strong>{' '}
          <span style={{color: isRunning ? 'green' : 'red', fontWeight: 'bold'}}>
            {isLoading ? '⏳ INICIANDO...' : isRunning ? '🟢 RODANDO' : '🔴 PARADO'}
          </span>
        </p>
        <p>
          <strong>Circuit Breaker:</strong>{' '}
          <span style={{color: 'green', fontWeight: 'bold'}}>CLOSED</span>
        </p>
        {isRunning && lastUpdate && (
          <p style={{fontSize: '12px', color: '#666'}}>
            Última atualização: {lastUpdate}
          </p>
        )}
        {signerKey && (
          <p style={{fontSize: '11px', color: '#999'}}>
            Signer: {signerKey.substring(0, 20)}...
          </p>
        )}
      </div>

      {/* Controls */}
      <div style={{marginBottom: 20}}>
        <button 
          onClick={isRunning ? stopEngine : startEngine}
          disabled={isLoading}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            background: isRunning ? '#ff4444' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.7 : 1
          }}
        >
          {isLoading ? '⏳ CARREGANDO...' : isRunning ? '⏹️ PARAR ENGINE' : '▶️ INICIAR ENGINE'}
        </button>
      </div>

      {/* Teste de Assinatura */}
      {isRunning && (
        <div style={{padding: 15, background: '#e8f5e9', borderRadius: 8, border: '1px solid #4CAF50'}}>
          <h3 style={{marginTop: 0, color: '#2e7d32'}}>⚡ Funcionalidades</h3>
          
          <button 
            onClick={handleSign}
            style={{
              padding: '10px 20px',
              background: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            📝 Assinar Decisão de Risco
          </button>
          <p style={{fontSize: '12px', color: '#666', marginTop: 8}}>
            Envia dados para o backend assinar via Ed25519
          </p>
          
          {signatureResult && (
            <div style={{marginTop: 10, padding: 8, background: '#c8e6c9', borderRadius: 4, fontSize: '12px'}}>
              ✅ Última assinatura: {signatureResult}
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div style={{marginTop: 30, padding: 10, background: '#fafafa', borderRadius: 4, fontSize: '11px', color: '#999'}}>
        <p><strong>Configuração:</strong></p>
        <p>API: {import.meta.env.VITE_API_URL || 'http://localhost:3001'}</p>
        <p>Network: {import.meta.env.VITE_SOLANA_NETWORK || 'devnet'}</p>
        <p>Program ID: {(import.meta.env.VITE_PROGRAM_ID || '').substring(0, 20)}...</p>
      </div>
    </div>
  )
}

export default App

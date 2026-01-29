import { useState } from 'react'
import { useCATE } from './lib/CATEContext'

function App() {
  const { isRunning, isLoading, startEngine, stopEngine, lastUpdate, signerKey, lastDecision, evaluateAndSign } = useCATE()
  const [result, setResult] = useState(null)

  const handleEvaluate = async () => {
    try {
      const res = await evaluateAndSign('SOL/USD')
      setResult(res)
      
      if (res.blocked) {
        alert(`🚫 BLOCKED!\n\nRisco: ${res.decision.score}/100\n${res.decision.explanation}`)
      } else {
        alert(`✅ ${res.decision.action}!\n\nSize Multiplier: ${(res.decision.sizeMultiplier * 100).toFixed(0)}%\nRisco: ${res.decision.score}/100\n\n${res.decision.explanation.substring(0, 100)}...`)
      }
    } catch (err) {
      alert('❌ Erro: ' + err.message)
    }
  }

  // Cores baseadas na ação
  const getActionColor = (action) => {
    if (!action) return '#999'
    if (action === 'ALLOW') return '#4CAF50'
    if (action === 'SCALE') return '#FF9800'
    return '#f44336'
  }

  return (
    <div style={{padding: 20, fontFamily: 'Arial, sans-serif', maxWidth: '700px', margin: '0 auto'}}>
      <h1>🔒 CATE Engine</h1>
      <p style={{color: '#666'}}>Risk-Aware Trading with Size Multiplier</p>
      
      {/* Status Card */}
      <div style={{marginBottom: 20, padding: 15, background: '#f5f5f5', borderRadius: 8, border: '1px solid #ddd'}}>
        <h3 style={{marginTop: 0}}>Status do Sistema</h3>
        <p>
          <strong>Engine:</strong>{' '}
          <span style={{color: isRunning ? 'green' : 'red', fontWeight: 'bold'}}>
            {isLoading ? '⏳ INICIANDO...' : isRunning ? '🟢 RODANDO' : '🔴 PARADO'}
          </span>
        </p>
        <p><strong>Circuit:</strong> <span style={{color: 'green', fontWeight: 'bold'}}>CLOSED</span></p>
        {isRunning && lastUpdate && (
          <p style={{fontSize: '12px', color: '#666'}}>Update: {lastUpdate}</p>
        )}
        {signerKey && (
          <p style={{fontSize: '11px', color: '#999'}}>Signer: {signerKey.substring(0, 20)}...</p>
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
            opacity: isLoading ? 0.7 : 1,
            marginRight: 10
          }}
        >
          {isLoading ? '⏳...' : isRunning ? '⏹️ PARAR' : '▶️ INICIAR'}
        </button>
      </div>

      {/* ÁREA PRINCIPAL: Size Multiplier Demo */}
      {isRunning && (
        <div style={{padding: 20, background: '#e3f2fd', borderRadius: 8, border: '2px solid #2196F3'}}>
          <h3 style={{marginTop: 0, color: '#1976d2'}}>⚡ Size Multiplier Demo</h3>
          <p style={{fontSize: '14px', color: '#555'}}>
            O CATE não só decide ALLOW/SCALE/BLOCK, mas calcula <strong>quanto da posição executar</strong> baseado no risco.
          </p>

          <button 
            onClick={handleEvaluate}
            style={{
              padding: '12px 24px',
              background: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
              marginTop: 10
            }}
          >
            🎲 SIMULAR DECISÃO DE RISCO
          </button>
          <p style={{fontSize: '12px', color: '#666', marginTop: 8}}>
            Gera confidence ratio aleatório e calcula size multiplier
          </p>

          {/* RESULTADO DA ÚLTIMA DECISÃO */}
          {lastDecision && (
            <div style={{
              marginTop: 20,
              padding: 15,
              background: 'white',
              borderRadius: 8,
              borderLeft: `5px solid ${getActionColor(lastDecision.action)}`
            }}>
              <h4 style={{marginTop: 0, color: getActionColor(lastDecision.action)}}>
                Última Decisão: {lastDecision.action}
              </h4>
              
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: '14px'}}>
                <div>
                  <strong>Size Multiplier:</strong>
                  <div style={{fontSize: '24px', fontWeight: 'bold', color: '#333'}}>
                    {(lastDecision.sizeMultiplier * 100).toFixed(0)}%
                  </div>
                  <div style={{fontSize: '11px', color: '#666'}}>
                    {lastDecision.action === 'ALLOW' && 'Posição completa'}
                    {lastDecision.action === 'SCALE' && 'Posição reduzida'}
                    {lastDecision.action === 'BLOCK' && 'Nenhuma execução'}
                  </div>
                </div>
                
                <div>
                  <strong>Risk Score:</strong>
                  <div style={{fontSize: '24px', fontWeight: 'bold', color: lastDecision.score > 50 ? 'orange' : 'green'}}>
                    {lastDecision.score}/100
                  </div>
                  <div style={{fontSize: '11px', color: '#666'}}>
                    Confidence: {lastDecision.confidenceRatio.toFixed(2)}%
                  </div>
                </div>
              </div>

              <div style={{marginTop: 10, padding: 8, background: '#f5f5f5', borderRadius: 4, fontSize: '12px'}}>
                <strong>Explicação:</strong><br/>
                {lastDecision.explanation}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Explicação do Conceito */}
      <div style={{marginTop: 30, padding: 15, background: '#fafafa', borderRadius: 8, fontSize: '13px'}}>
        <h4 style={{marginTop: 0}}>📊 Como funciona o Size Multiplier</h4>
        <ul style={{paddingLeft: 20, lineHeight: '1.6'}}>
          <li><strong>ALLOW (1.0):</strong> Risco baixo → executa 100% da posição</li>
          <li><strong>SCALE (0.5-0.9):</strong> Risco moderado → reduz proporcionalmente</li>
          <li><strong>BLOCK (0.0):</strong> Risco alto → nenhuma execução</li>
        </ul>
        <p style={{color: '#666', fontSize: '12px'}}>
          Baseado em confidence ratio dos feeds Pyth + frescor dos dados + qualidade dos publishers.
        </p>
      </div>

      {/* Footer */}
      <div style={{marginTop: 20, padding: 10, fontSize: '11px', color: '#999', textAlign: 'center'}}>
        API: {import.meta.env.VITE_API_URL || 'localhost:3001'} | Network: {import.meta.env.VITE_SOLANA_NETWORK || 'devnet'}
      </div>
    </div>
  )
}

export default App

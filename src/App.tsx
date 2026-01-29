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
        alert(`🚫 BLOCKED!\n\nRisk: ${res.decision.score}/100\nVolatility: ${res.decision.volatility}%\n\n${res.decision.explanation.substring(0, 80)}...`)
      } else {
        alert(`✅ ${res.decision.action}!\n\nSize: ${(res.decision.sizeMultiplier * 100).toFixed(0)}%\nVol: ${res.decision.volatility}%\nRisk: ${res.decision.score}/100`)
      }
    } catch (err) {
      alert('❌ Error: ' + err.message)
    }
  }

  const getActionColor = (action) => {
    if (!action) return '#999'
    if (action === 'ALLOW') return '#4CAF50'
    if (action === 'SCALE') return '#FF9800'
    return '#f44336'
  }

  return (
    <div style={{padding: 20, fontFamily: 'Arial, sans-serif', maxWidth: '750px', margin: '0 auto'}}>
      <h1>🔒 CATE Engine</h1>
      <p style={{color: '#666'}}>Risk-Aware Trading with Volatility + Size Multiplier</p>
      
      {/* Status */}
      <div style={{marginBottom: 20, padding: 15, background: '#f5f5f5', borderRadius: 8}}>
        <h3 style={{marginTop: 0}}>System Status</h3>
        <p>
          <strong>Engine:</strong>{' '}
          <span style={{color: isRunning ? 'green' : 'red', fontWeight: 'bold'}}>
            {isLoading ? '⏳ STARTING...' : isRunning ? '🟢 RUNNING' : '🔴 STOPPED'}
          </span>
        </p>
        <p><strong>Circuit:</strong> <span style={{color: 'green'}}>CLOSED</span></p>
        {isRunning && lastUpdate && <p style={{fontSize: '12px', color: '#666'}}>Update: {lastUpdate}</p>}
        {signerKey && <p style={{fontSize: '11px', color: '#999'}}>Signer: {signerKey.substring(0, 20)}...</p>}
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
            cursor: isLoading ? 'not-allowed' : 'pointer'
          }}
        >
          {isLoading ? '⏳...' : isRunning ? '⏹️ STOP' : '▶️ START'}
        </button>
      </div>

      {/* Demo Area */}
      {isRunning && (
        <div style={{padding: 20, background: '#e3f2fd', borderRadius: 8, border: '2px solid #2196F3'}}>
          <h3 style={{marginTop: 0, color: '#1976d2'}}>⚡ Advanced Risk Engine</h3>
          <p style={{fontSize: '14px'}}>
            Now with <strong>volatility</strong> + <strong>confidence ratio</strong> + <strong>size multiplier</strong>
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
              fontWeight: 'bold'
            }}
          >
            🎲 SIMULATE RISK DECISION
          </button>

          {/* Result Card */}
          {lastDecision && (
            <div style={{
              marginTop: 20,
              padding: 15,
              background: 'white',
              borderRadius: 8,
              borderLeft: `5px solid ${getActionColor(lastDecision.action)}`
            }}>
              <h4 style={{marginTop: 0, color: getActionColor(lastDecision.action)}}>
                {lastDecision.action}
              </h4>
              
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: '14px'}}>
                <div>
                  <strong>Size Multiplier</strong>
                  <div style={{fontSize: '22px', fontWeight: 'bold'}}>
                    {(lastDecision.sizeMultiplier * 100).toFixed(0)}%
                  </div>
                </div>
                
                <div>
                  <strong>Volatility</strong>
                  <div style={{fontSize: '22px', fontWeight: 'bold', color: lastDecision.volatility > 2 ? 'orange' : 'green'}}>
                    {lastDecision.volatility.toFixed(2)}%
                  </div>
                </div>
                
                <div>
                  <strong>Risk Score</strong>
                  <div style={{fontSize: '22px', fontWeight: 'bold', color: lastDecision.score > 50 ? 'orange' : 'green'}}>
                    {lastDecision.score}/100
                  </div>
                </div>
              </div>

              <div style={{marginTop: 10, padding: 10, background: '#f5f5f5', borderRadius: 4, fontSize: '12px'}}>
                {lastDecision.explanation}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div style={{marginTop: 30, padding: 15, background: '#fafafa', borderRadius: 8, fontSize: '12px'}}>
        <h4>📊 Risk Engine Metrics</h4>
        <ul style={{paddingLeft: 20, lineHeight: '1.8'}}>
          <li><strong>Confidence Ratio:</strong> Pyth data quality (lower = better)</li>
          <li><strong>Volatility:</strong> Standard deviation of last 20 prices</li>
          <li><strong>Size Multiplier:</strong> Position size to execute (0-100%)</li>
        </ul>
      </div>
    </div>
  )
}

export default App

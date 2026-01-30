import { useState } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useCATE } from './lib/CATEContext'
import { SolanaPublisher } from './lib/solana/publisher'

const TOKENS = [
  { symbol: 'SOL', name: 'Solana', color: '#14F195' },
  { symbol: 'BTC', name: 'Bitcoin', color: '#F7931A' },
  { symbol: 'ETH', name: 'Ethereum', color: '#627EEA' }
]

function App() {
  const {
    isRunning,
    isLoading,
    startEngine,
    stopEngine,
    lastUpdate,
    signerKey,
    lastDecision,
    evaluateAndSign,
    selectedAsset,
    changeAsset
  } = useCATE()

  const { publicKey, wallet, connected } = useWallet()
  const { connection } = useConnection()
  
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [txId, setTxId] = useState(null)

  const handleEvaluate = async () => {
    try {
      setIsEvaluating(true)
      setTxId(null)
      await evaluateAndSign()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setIsEvaluating(false)
    }
  }

  const handlePublishOnChain = async () => {
    if (!connected || !wallet || !lastDecision || lastDecision.action === 'BLOCK') {
      alert('Connect wallet first and ensure decision is not BLOCK')
      return
    }

    try {
      setIsPublishing(true)
      
      const publisher = new SolanaPublisher(wallet.adapter)
      const signature = await publisher.publishDecision(
        selectedAsset,
        lastDecision.score,
        lastDecision.action === 'BLOCK',
        lastDecision.confidenceRatio,
        5,
        lastDecision.signature,
        lastDecision.decisionHash || 'hash_placeholder',
        lastDecision.signerPublicKey || signerKey || 'key_placeholder',
        Math.floor(Date.now() / 1000)
      )

      setTxId(signature)
      console.log('? Published to Devnet:', signature)
    } catch (err) {
      console.error('? Failed to publish:', err)
      alert('Failed to publish: ' + err.message)
    } finally {
      setIsPublishing(false)
    }
  }

  const handleTokenChange = (token) => {
    if (token !== selectedAsset) {
      changeAsset(token)
      setTxId(null)
    }
  }

  const getActionColor = (action) => {
    if (!action) return '#999'
    if (action === 'ALLOW') return '#4CAF50'
    if (action === 'SCALE') return '#FF9800'
    return '#f44336'
  }

  const getBorderColor = () => {
    if (!lastDecision?.action) return '#999'
    return getActionColor(lastDecision.action)
  }

  const currentToken = TOKENS.find(t => t.symbol === selectedAsset) || TOKENS[0]

  return (
    <div style={{padding: 20, fontFamily: 'Arial, sans-serif', maxWidth: '800px', margin: '0 auto', backgroundColor: '#ffffff', minHeight: '100vh'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20}}>
        <div>
          <h1 style={{margin: 0}}>CATE Engine</h1>
          <p style={{color: '#666', margin: '5px 0 0 0'}}>Risk-Aware Trading with Volatility + Size Multiplier</p>
        </div>
        <WalletMultiButton />
      </div>

      {/* System Status - sempre visível */}
      <div style={{marginBottom: 20, padding: 15, background: '#f5f5f5', borderRadius: 8}}>
        <h3 style={{marginTop: 0}}>System Status</h3>
        <p>
          <strong>Engine:</strong>{' '}
          <span style={{color: isRunning ? 'green' : 'red', fontWeight: 'bold'}}>
            {isLoading ? 'STARTING...' : isRunning ? 'RUNNING' : 'STOPPED'}
          </span>
        </p>
        <p><strong>Circuit:</strong> <span style={{color: 'green'}}>CLOSED</span></p>
        <p><strong>Wallet:</strong>{' '}
          <span style={{color: connected ? 'green' : 'orange'}}>
            {connected ? `Connected (${publicKey?.toBase58().substring(0, 20)}...)` : 'Not Connected'}
          </span>
        </p>
        {isRunning && lastUpdate && <p style={{fontSize: '12px', color: '#666'}}>Update: {lastUpdate}</p>}
        {signerKey && <p style={{fontSize: '11px', color: '#999'}}>Signer: {signerKey.substring(0, 20)}...</p>}
      </div>

      {/* Controls - START/STOP */}
      <div style={{marginBottom: 20, display: 'flex', gap: 10}}>
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
          {isLoading ? '...' : isRunning ? 'STOP' : 'START'}
        </button>
      </div>

      {/* Token Selector - SÓ APARECE DEPOIS DE INICIAR */}
      {isRunning && (
        <div style={{
          marginBottom: 20,
          padding: 15,
          background: '#f8f9fa',
          borderRadius: 8,
          border: '2px solid #e9ecef'
        }}>
          <h3 style={{marginTop: 0, marginBottom: 12, fontSize: '14px', color: '#495057'}}>
            Select Asset
          </h3>
          <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
            {TOKENS.map((token) => (
              <button
                key={token.symbol}
                onClick={() => handleTokenChange(token.symbol)}
                disabled={isEvaluating}
                style={{
                  padding: '8px 16px',
                  borderRadius: 20,
                  border: '2px solid ' + (selectedAsset === token.symbol ? token.color : '#dee2e6'),
                  background: selectedAsset === token.symbol ? token.color : 'white',
                  color: selectedAsset === token.symbol ? 'white' : '#495057',
                  cursor: isEvaluating ? 'not-allowed' : 'pointer',
                  opacity: isEvaluating ? 0.6 : 1,
                  fontWeight: 'bold',
                  fontSize: '13px',
                  transition: 'all 0.2s'
                }}
              >
                {token.symbol}
              </button>
            ))}
          </div>
          <p style={{marginTop: 10, marginBottom: 0, fontSize: '12px', color: '#6c757d'}}>
            Current: <strong>{currentToken.name}</strong> ({selectedAsset})
          </p>
        </div>
      )}

      {/* Risk Engine - SÓ APARECE DEPOIS DE INICIAR */}
      {isRunning && (
        <div style={{padding: 20, background: '#e3f2fd', borderRadius: 8, border: '2px solid #2196F3'}}>
          <h3 style={{marginTop: 0, color: '#1976d2'}}>Advanced Risk Engine</h3>
          <p style={{fontSize: '14px'}}>
            Asset: <strong>{currentToken.name}</strong> |
            Volatility + Confidence Ratio + Size Multiplier
          </p>

          <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
            <button
              onClick={handleEvaluate}
              disabled={isEvaluating}
              style={{
                padding: '12px 24px',
                background: isEvaluating ? '#ccc' : '#2196F3',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: isEvaluating ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                fontWeight: 'bold'
              }}
            >
              {isEvaluating ? 'EVALUATING...' : 'SIMULATE RISK DECISION'}
            </button>

            {connected && lastDecision && lastDecision.action !== 'BLOCK' && (
              <button
                onClick={handlePublishOnChain}
                disabled={isPublishing}
                style={{
                  padding: '12px 24px',
                  background: isPublishing ? '#ccc' : '#14F195',
                  color: '#000',
                  border: 'none',
                  borderRadius: 4,
                  cursor: isPublishing ? 'not-allowed' : 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold'
                }}
              >
                {isPublishing ? 'PUBLISHING...' : 'PUBLISH TO DEVNET'}
              </button>
            )}
          </div>

          {lastDecision && (
            <div style={{
              marginTop: 20,
              padding: 15,
              background: 'white',
              borderRadius: 8,
              borderLeft: '5px solid ' + getBorderColor()
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
                    {lastDecision.volatility?.toFixed(2) || '0.00'}%
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

              {lastDecision.signed && (
                <div style={{marginTop: 10, fontSize: '10px', color: '#4CAF50'}}>
                  Signed by backend
                </div>
              )}

              {txId && (
                <div style={{marginTop: 10, padding: 10, background: '#e8f5e9', borderRadius: 4}}>
                  <strong style={{color: '#2e7d32'}}>? Published to Devnet!</strong>
                  <div style={{fontSize: '11px', wordBreak: 'break-all', marginTop: 5}}>
                    TX: <a 
                      href={`https://explorer.solana.com/tx/${txId}?cluster=devnet`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{color: '#1976d2'}}
                    >
                      {txId}
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legend - sempre visível */}
      <div style={{marginTop: 30, padding: 15, background: '#fafafa', borderRadius: 8, fontSize: '12px'}}>
        <h4>Risk Engine Metrics</h4>
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

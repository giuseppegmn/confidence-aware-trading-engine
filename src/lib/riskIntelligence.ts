export type RiskAction = 'ALLOW' | 'SCALE' | 'BLOCK'

export interface RiskDecision {
  action: RiskAction
  score: number
  confidenceRatio: number
  volatility: number
  sizeMultiplier: number
  explanation: string
  timestamp: number
  requiresUpdate?: boolean
}

export interface RiskParameters {
  maxConfidenceRatioScale: number
  maxConfidenceRatioBlock: number
  maxStalenessSeconds: number
  scaleMinMultiplier: number
  scaleMaxMultiplier: number
  maxVolatilityScale: number
  maxVolatilityBlock: number
}

const DEFAULT_PARAMS: RiskParameters = {
  maxConfidenceRatioScale: 1.0,
  maxConfidenceRatioBlock: 3.0,
  maxStalenessSeconds: 60,
  scaleMinMultiplier: 0.5,
  scaleMaxMultiplier: 0.9,
  maxVolatilityScale: 2.0,
  maxVolatilityBlock: 5.0
}

export class RiskIntelligenceEngine {
  private params: RiskParameters

  constructor(params: Partial<RiskParameters> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params }
  }

  evaluate(snapshot: any): RiskDecision {
    const timestamp = Date.now()
    
    const confidenceRatio = snapshot.price?.confidenceRatio || 0
    const volatility = snapshot.price?.volatility24h || 0
    const publishTime = snapshot.price?.publishTime || 0
    const nowSeconds = Math.floor(timestamp / 1000)
    const staleness = nowSeconds - publishTime
    const numPublishers = snapshot.price?.numPublishers || 0

    if (confidenceRatio < 0 || staleness > this.params.maxStalenessSeconds || numPublishers < 3) {
      return {
        action: 'BLOCK',
        score: 100,
        confidenceRatio,
        volatility,
        sizeMultiplier: 0.0,
        explanation: `BLOCK: invalid data (staleness: ${staleness}s, publishers: ${numPublishers})`,
        timestamp,
        requiresUpdate: true
      }
    }

    const confidenceScore = Math.min(100, (confidenceRatio / this.params.maxConfidenceRatioBlock) * 100)
    const volScore = Math.min(100, (volatility / this.params.maxVolatilityBlock) * 100)
    const combinedScore = (confidenceScore * 0.7) + (volScore * 0.3)

    let action: RiskAction
    let sizeMultiplier: number
    let explanation: string

    if (combinedScore >= 80) {
      action = 'BLOCK'
      sizeMultiplier = 0.0
      explanation = `🚫 BLOCK: confidence ${confidenceRatio.toFixed(2)}%, vol ${volatility.toFixed(2)}%`
    } else if (combinedScore >= 40) {
      action = 'SCALE'
      const riskFactor = (combinedScore - 40) / 40
      sizeMultiplier = this.params.scaleMaxMultiplier - (riskFactor * (this.params.scaleMaxMultiplier - this.params.scaleMinMultiplier))
      sizeMultiplier = Math.max(this.params.scaleMinMultiplier, Math.min(this.params.scaleMaxMultiplier, sizeMultiplier))
      explanation = `⚠️ SCALE: confidence ${confidenceRatio.toFixed(2)}%, vol ${volatility.toFixed(2)}%. Execute ${(sizeMultiplier * 100).toFixed(0)}%`
    } else {
      action = 'ALLOW'
      sizeMultiplier = 1.0
      explanation = `✅ ALLOW: confidence ${confidenceRatio.toFixed(2)}%, vol ${volatility.toFixed(2)}%. Execute 100%`
    }

    return {
      action,
      score: Math.floor(combinedScore),
      confidenceRatio,
      volatility,
      sizeMultiplier: parseFloat(sizeMultiplier.toFixed(2)),
      explanation,
      timestamp,
      requiresUpdate: action !== 'ALLOW'
    }
  }
}

export const riskEngine = new RiskIntelligenceEngine()

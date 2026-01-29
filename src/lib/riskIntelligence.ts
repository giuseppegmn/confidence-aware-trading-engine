/**
 * Risk Intelligence Engine com Size Multiplier
 */

export type RiskAction = 'ALLOW' | 'SCALE' | 'BLOCK';

export interface RiskDecision {
  action: RiskAction;
  score: number; // 0-100
  confidenceRatio: number;
  sizeMultiplier: number; // NOVO: 0.0 a 1.0
  explanation: string;
  timestamp: number;
  requiresUpdate?: boolean;
}

export interface RiskParameters {
  maxConfidenceRatioScale: number;
  maxConfidenceRatioBlock: number;
  maxConfidenceZscore: number;
  maxStalenessSeconds: number;
  minDataQualityScore: number;
  // NOVO: Configurações de sizing
  scaleMinMultiplier: number; // ex: 0.5 (mínimo 50% da posição em SCALE)
  scaleMaxMultiplier: number; // ex: 0.9 (máximo 90% em SCALE baixo)
}

const DEFAULT_PARAMS: RiskParameters = {
  maxConfidenceRatioScale: 1.0,
  maxConfidenceRatioBlock: 3.0,
  maxConfidenceZscore: 2.5,
  maxStalenessSeconds: 60,
  minDataQualityScore: 80,
  // NOVOS defaults
  scaleMinMultiplier: 0.5,  // Em risco máximo, opera apenas 50%
  scaleMaxMultiplier: 0.9   // Em risco mínimo, opera 90%
};

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(value);
}

export class RiskIntelligenceEngine {
  private params: RiskParameters;

  constructor(params: Partial<RiskParameters> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
  }

  updateParameters(newParams: Partial<RiskParameters>): void {
    this.params = { ...this.params, ...newParams };
  }

  evaluate(snapshot: any): RiskDecision {
    const timestamp = Date.now();
    
    // Extrair métricas do snapshot
    const confidenceRatio = snapshot.price?.confidenceRatio || 0;
    const publishTime = snapshot.price?.publishTime || 0;
    const nowSeconds = Math.floor(timestamp / 1000);
    const staleness = nowSeconds - publishTime;
    const numPublishers = snapshot.price?.numPublishers || 0;

    // Validações básicas
    if (!isValidNumber(confidenceRatio) || confidenceRatio < 0) {
      return {
        action: 'BLOCK',
        score: 100,
        confidenceRatio: 0,
        sizeMultiplier: 0.0,
        explanation: 'Dados inválidos do oracle',
        timestamp,
        requiresUpdate: true
      };
    }

    // Check staleness
    if (staleness > this.params.maxStalenessSeconds) {
      return {
        action: 'BLOCK',
        score: 95,
        confidenceRatio,
        sizeMultiplier: 0.0,
        explanation: `Dado stale: ${staleness}s (max: ${this.params.maxStalenessSeconds}s)`,
        timestamp,
        requiresUpdate: true
      };
    }

    // Check publishers
    if (numPublishers < 3) {
      return {
        action: 'BLOCK',
        score: 90,
        confidenceRatio,
        sizeMultiplier: 0.0,
        explanation: `Publishers insuficientes: ${numPublishers}`,
        timestamp,
        requiresUpdate: true
      };
    }

    // LÓGICA PRINCIPAL COM SIZE MULTIPLIER
    let action: RiskAction;
    let score: number;
    let sizeMultiplier: number;
    let explanation: string;

    if (confidenceRatio > this.params.maxConfidenceRatioBlock) {
      // BLOCK: Risco crítico
      action = 'BLOCK';
      score = 100;
      sizeMultiplier = 0.0;
      explanation = `RISCO CRÍTICO: confidence ${confidenceRatio.toFixed(2)}% > ${this.params.maxConfidenceRatioBlock}% (BLOCK)`;

    } else if (confidenceRatio > this.params.maxConfidenceRatioScale) {
      // SCALE: Risco moderado - calcula multiplier proporcional
      action = 'SCALE';
      
      // Normaliza o risco entre 0 e 1 dentro da banda SCALE
      const scaleRange = this.params.maxConfidenceRatioBlock - this.params.maxConfidenceRatioScale;
      const currentInScale = confidenceRatio - this.params.maxConfidenceRatioScale;
      const riskFactor = currentInScale / scaleRange; // 0 = baixo risco, 1 = alto risco
      
      // Score: 50-100 baseado no risco
      score = 50 + (riskFactor * 50);
      
      // SIZE MULTIPLIER: inversamente proporcional ao risco
      // Risco baixo (0) → scaleMaxMultiplier (0.9)
      // Risco alto (1) → scaleMinMultiplier (0.5)
      sizeMultiplier = this.params.scaleMaxMultiplier - (riskFactor * (this.params.scaleMaxMultiplier - this.params.scaleMinMultiplier));
      
      explanation = `RISCO MODERADO: confidence ${confidenceRatio.toFixed(2)}% (SCALE). Posição reduzida para ${(sizeMultiplier * 100).toFixed(0)}% do tamanho original.`;

    } else {
      // ALLOW: Risco aceitável
      action = 'ALLOW';
      score = Math.min(50, (confidenceRatio / this.params.maxConfidenceRatioScale) * 25);
      sizeMultiplier = 1.0;
      explanation = `RISCO ACEITÁVEL: confidence ${confidenceRatio.toFixed(2)}% (ALLOW). Operação em tamanho total (100%).`;
    }

    // Garante bounds
    score = Math.min(100, Math.max(0, Math.floor(score)));
    sizeMultiplier = Math.min(1.0, Math.max(0.0, parseFloat(sizeMultiplier.toFixed(2))));

    return {
      action,
      score,
      confidenceRatio,
      sizeMultiplier,
      explanation,
      timestamp,
      requiresUpdate: action !== 'ALLOW'
    };
  }
}

export const riskEngine = new RiskIntelligenceEngine();

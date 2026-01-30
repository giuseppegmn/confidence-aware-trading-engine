export type RiskDecision = 'ALLOW' | 'BLOCK' | 'CAUTION';

export interface RiskEngineInput {
  price: number;
  confidenceInterval: number;
  volatility: number;
}

export interface RiskEngineOutput {
  decision: RiskDecision;
  riskScore: number;
  confidenceInterval: number;
  volatility: number;
}

const LOW_RISK_THRESHOLD = 30;
const HIGH_RISK_THRESHOLD = 70;

export function computeRiskScore(input: RiskEngineInput): number {
  const ciRatio = input.confidenceInterval / input.price;

  const weightedScore =
    ciRatio * 0.7 +
    input.volatility * 0.3;

  const normalized = Math.min(
    Math.max(weightedScore * 100, 0),
    100
  );

  return Number(normalized.toFixed(2));
}

export function evaluateRisk(input: RiskEngineInput): RiskEngineOutput {
  const riskScore = computeRiskScore(input);

  let decision: RiskDecision = 'CAUTION';

  if (riskScore <= LOW_RISK_THRESHOLD) {
    decision = 'ALLOW';
  }

  if (riskScore >= HIGH_RISK_THRESHOLD) {
    decision = 'BLOCK';
  }

  return {
    decision,
    riskScore,
    confidenceInterval: input.confidenceInterval,
    volatility: input.volatility
  };
}

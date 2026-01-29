/**
 * CATE - Risk Intelligence Engine
 *
 * Production-grade deterministic risk evaluation.
 * All decisions are:
 * - Reproducible (same inputs = same outputs)
 * - Explainable (every factor documented)
 * - Verifiable (cryptographically signed)
 *
 * Every trade must answer: "Is this data statistically trustworthy
 * enough to risk real capital?"
 */

import type { OracleSnapshot, OracleMetrics } from '../oracle/types';
import { getSigningEngine, type SignedDecision } from '../crypto/signing';

// ============================================
// TYPES
// ============================================

export type RiskAction = 'ALLOW' | 'SCALE' | 'BLOCK';

export interface RiskFactor {
  /** Factor name */
  name: string;

  /** Factor value */
  value: number;

  /** Threshold that triggered action */
  threshold: number;

  /** Impact on decision (negative = cautious) */
  impact: number;

  /** Whether this factor triggered a constraint */
  triggered: boolean;

  /** Human-readable description */
  description: string;

  /** Severity level */
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

export interface RiskParameters {
  /** Max confidence ratio before scaling (%) */
  maxConfidenceRatioScale: number;

  /** Max confidence ratio before blocking (%) */
  maxConfidenceRatioBlock: number;

  /** Max confidence z-score before blocking */
  maxConfidenceZscore: number;

  /** Max data staleness in seconds */
  maxStalenessSeconds: number;

  /** Max realized volatility (annualized %) before scaling */
  maxVolatilityScale: number;

  /** Max realized volatility before blocking */
  maxVolatilityBlock: number;

  /** Min data quality score required */
  minDataQualityScore: number;

  /** Volatility spike threshold */
  volatilitySpikeThreshold: number;

  /** Require real oracle data (fail if using fallback) */
  requireLiveOracle: boolean;
}

export interface RiskDecision {
  /** The action to take */
  action: RiskAction;

  /** Position size multiplier (0.0 to 1.0) */
  sizeMultiplier: number;

  /** Risk score (0 to 100, higher = riskier) */
  riskScore: number;

  /** Human-readable explanation */
  explanation: string;

  /** Detailed breakdown of factors */
  factors: RiskFactor[];

  /** Timestamp of decision */
  timestamp: number;

  /** Oracle snapshot at time of decision */
  oracleSnapshot: OracleSnapshot;

  /** Parameters used for decision */
  parameters: RiskParameters;

  /** Cryptographic signature */
  signedDecision: SignedDecision;
}

// ============================================
// DEFAULT PARAMETERS
// ============================================

export const DEFAULT_RISK_PARAMETERS: RiskParameters = {
  maxConfidenceRatioScale: 1.0,
  maxConfidenceRatioBlock: 3.0,
  maxConfidenceZscore: 3.0,
  maxStalenessSeconds: 30,
  maxVolatilityScale: 100,
  maxVolatilityBlock: 200,
  minDataQualityScore: 50,
  volatilitySpikeThreshold: 2.0,
  requireLiveOracle: true,
};

// ============================================
// FACTOR EVALUATORS
// ============================================

function evaluateConfidenceRatio(metrics: OracleMetrics, params: RiskParameters): RiskFactor {
  const value = metrics.confidenceRatio;
  const triggered = value > params.maxConfidenceRatioBlock;
  const warning = value > params.maxConfidenceRatioScale && !triggered;

  let impact = 0;
  let description = '';
  let severity: RiskFactor['severity'] = 'INFO';

  if (triggered) {
    impact = -40;
    severity = 'CRITICAL';
    description = `Confidence ratio ${value.toFixed(4)}% exceeds block threshold ${params.maxConfidenceRatioBlock}%. Oracle uncertainty is too high.`;
  } else if (warning) {
    impact = -20;
    severity = 'WARNING';
    description = `Confidence ratio ${value.toFixed(4)}% exceeds scale threshold ${params.maxConfidenceRatioScale}%.`;
  } else {
    impact = 10;
    description = `Confidence ratio ${value.toFixed(4)}% within acceptable bounds.`;
  }

  return {
    name: 'Confidence Ratio',
    value,
    threshold: triggered ? params.maxConfidenceRatioBlock : params.maxConfidenceRatioScale,
    impact,
    triggered,
    description,
    severity,
  };
}

function evaluateConfidenceZscore(metrics: OracleMetrics, params: RiskParameters): RiskFactor {
  const value = Math.abs(metrics.confidenceZscore);
  const triggered = value > params.maxConfidenceZscore;

  let impact = 0;
  let description = '';
  let severity: RiskFactor['severity'] = 'INFO';

  if (triggered) {
    impact = -35;
    severity = 'CRITICAL';
    description = `Z-score ${value.toFixed(2)} exceeds ${params.maxConfidenceZscore}σ. Statistical anomaly detected.`;
  } else if (value > params.maxConfidenceZscore * 0.7) {
    impact = -10;
    severity = 'WARNING';
    description = `Z-score ${value.toFixed(2)} approaching threshold.`;
  } else {
    impact = 5;
    description = `Z-score ${value.toFixed(2)} is statistically normal.`;
  }

  return {
    name: 'Confidence Z-Score',
    value,
    threshold: params.maxConfidenceZscore,
    impact,
    triggered,
    description,
    severity,
  };
}

function evaluateDataFreshness(metrics: OracleMetrics, params: RiskParameters): RiskFactor {
  const value = metrics.dataFreshnessSeconds;
  const triggered = value > params.maxStalenessSeconds;

  let impact = 0;
  let description = '';
  let severity: RiskFactor['severity'] = 'INFO';

  if (triggered) {
    impact = -50;
    severity = 'CRITICAL';
    description = `Data is ${value.toFixed(1)}s old, exceeding ${params.maxStalenessSeconds}s limit. STALE DATA BLOCKED.`;
  } else if (value > params.maxStalenessSeconds * 0.7) {
    impact = -15;
    severity = 'WARNING';
    description = `Data freshness ${value.toFixed(1)}s approaching staleness.`;
  } else {
    impact = 10;
    description = `Data is fresh (${value.toFixed(1)}s old).`;
  }

  return {
    name: 'Data Freshness',
    value,
    threshold: params.maxStalenessSeconds,
    impact,
    triggered,
    description,
    severity,
  };
}

function evaluateVolatility(metrics: OracleMetrics, params: RiskParameters): RiskFactor {
  const value = metrics.volatilityRealized;
  const triggered = value > params.maxVolatilityBlock;
  const warning = value > params.maxVolatilityScale && !triggered;

  let impact = 0;
  let description = '';
  let severity: RiskFactor['severity'] = 'INFO';

  if (triggered) {
    impact = -35;
    severity = 'CRITICAL';
    description = `Volatility ${value.toFixed(1)}% exceeds ${params.maxVolatilityBlock}%. Market too volatile.`;
  } else if (warning) {
    impact = -15;
    severity = 'WARNING';
    description = `Volatility ${value.toFixed(1)}% elevated above ${params.maxVolatilityScale}%.`;
  } else {
    impact = 5;
    description = `Volatility ${value.toFixed(1)}% within acceptable range.`;
  }

  return {
    name: 'Realized Volatility',
    value,
    threshold: triggered ? params.maxVolatilityBlock : params.maxVolatilityScale,
    impact,
    triggered,
    description,
    severity,
  };
}

function evaluateDataQuality(metrics: OracleMetrics, params: RiskParameters): RiskFactor {
  const value = metrics.dataQualityScore;
  const triggered = value < params.minDataQualityScore;

  let impact = 0;
  let description = '';
  let severity: RiskFactor['severity'] = 'INFO';

  if (triggered) {
    impact = -45;
    severity = 'CRITICAL';
    description = `Data quality ${value.toFixed(0)}/100 below minimum ${params.minDataQualityScore}. ORACLE DEGRADATION.`;
  } else if (value < params.minDataQualityScore * 1.2) {
    impact = -10;
    severity = 'WARNING';
    description = `Data quality ${value.toFixed(0)}/100 approaching threshold.`;
  } else {
    impact = 10;
    description = `Data quality ${value.toFixed(0)}/100 is good.`;
  }

  return {
    name: 'Data Quality',
    value,
    threshold: params.minDataQualityScore,
    impact,
    triggered,
    description,
    severity,
  };
}

function evaluateVolatilitySpike(metrics: OracleMetrics, params: RiskParameters): RiskFactor {
  const expected = metrics.volatilityExpected || 1;
  const ratio = metrics.volatilityRealized / expected;
  const triggered = ratio > params.volatilitySpikeThreshold && metrics.confidenceRatio > params.maxConfidenceRatioScale;

  let impact = 0;
  let description = '';
  let severity: RiskFactor['severity'] = 'INFO';

  if (triggered) {
    impact = -30;
    severity = 'CRITICAL';
    description = `Volatility spike: realized/expected ${ratio.toFixed(
      2
    )}x while confidence degraded. MARKET STRESS.`;
  } else if (ratio > params.volatilitySpikeThreshold) {
    impact = -10;
    severity = 'WARNING';
    description = `Elevated volatility ratio ${ratio.toFixed(2)}x.`;
  } else {
    impact = 5;
    description = `Volatility ratio ${ratio.toFixed(2)}x stable.`;
  }

  return {
    name: 'Volatility Spike',
    value: ratio,
    threshold: params.volatilitySpikeThreshold,
    impact,
    triggered,
    description,
    severity,
  };
}

function evaluateOracleSource(snapshot: OracleSnapshot, params: RiskParameters): RiskFactor {
  const isLive = snapshot.price.source === 'PYTH_HERMES';
  const triggered = params.requireLiveOracle && !isLive;

  let impact = 0;
  let description = '';
  let severity: RiskFactor['severity'] = 'INFO';

  if (triggered) {
    impact = -50;
    severity = 'CRITICAL';
    description = `Oracle source is ${snapshot.price.source}, live data required. FALLBACK DATA BLOCKED.`;
  } else if (!isLive) {
    impact = -20;
    severity = 'WARNING';
    description = `Using ${snapshot.price.source} data.`;
  } else {
    impact = 10;
    description = `Live Pyth Hermes data.`;
  }

  return {
    name: 'Oracle Source',
    value: isLive ? 1 : 0,
    threshold: 1,
    impact,
    triggered,
    description,
    severity,
  };
}

// ============================================
// DECISION CALCULATION
// ============================================

function calculateSizeMultiplier(factors: RiskFactor[], params: RiskParameters, metrics: OracleMetrics): number {
  let multiplier = 1.0;

  // Confidence ratio scaling
  if (metrics.confidenceRatio > params.maxConfidenceRatioScale) {
    const scaleFactor = Math.max(
      0.1,
      1 - (metrics.confidenceRatio - params.maxConfidenceRatioScale) / (params.maxConfidenceRatioBlock - params.maxConfidenceRatioScale)
    );
    multiplier *= scaleFactor;
  }

  // Volatility scaling
  if (metrics.volatilityRealized > params.maxVolatilityScale) {
    const scaleFactor = Math.max(
      0.2,
      1 - (metrics.volatilityRealized - params.maxVolatilityScale) / (params.maxVolatilityBlock - params.maxVolatilityScale)
    );
    multiplier *= scaleFactor;
  }

  // Z-score scaling
  const zscore = Math.abs(metrics.confidenceZscore);
  if (zscore > params.maxConfidenceZscore * 0.5) {
    const scaleFactor = Math.max(
      0.3,
      1 - (zscore - params.maxConfidenceZscore * 0.5) / (params.maxConfidenceZscore * 0.5)
    );
    multiplier *= scaleFactor;
  }

  return Math.max(0, Math.min(1, multiplier));
}

function calculateRiskScore(factors: RiskFactor[]): number {
  let score = 50;
  const totalImpact = factors.reduce((sum, f) => sum + f.impact, 0);
  score -= totalImpact;
  return Math.max(0, Math.min(100, score));
}

function generateExplanation(action: RiskAction, factors: RiskFactor[], riskScore: number, sizeMultiplier: number): string {
  const triggeredFactors = factors.filter((f) => f.triggered);
  const warningFactors = factors.filter((f) => f.severity === 'WARNING');

  let explanation = '';

  switch (action) {
    case 'BLOCK':
      explanation = `🛑 TRADE BLOCKED (Risk: ${riskScore.toFixed(0)}/100)\n\n`;
      explanation += `Critical Issues:\n`;
      for (const f of triggeredFactors) explanation += `• ${f.name}: ${f.description}\n`;
      explanation += `\nTo enable execution:\n`;
      for (const f of triggeredFactors) explanation += `• ${f.name} must improve to below ${f.threshold}\n`;
      break;

    case 'SCALE':
      explanation = `⚠️ POSITION SCALED TO ${(sizeMultiplier * 100).toFixed(0)}% (Risk: ${riskScore.toFixed(0)}/100)\n\n`;
      explanation += `Elevated Risk Factors:\n`;
      for (const f of warningFactors) explanation += `• ${f.name}: ${f.description}\n`;
      break;

    case 'ALLOW':
      explanation = `✅ TRADE ALLOWED (Risk: ${riskScore.toFixed(0)}/100)\n\n`;
      explanation += `All factors within bounds.`;
      break;
  }

  return explanation;
}

// ============================================
// RISK ENGINE CLASS
// ============================================

export class RiskEngine {
  private parameters: RiskParameters;
  private decisionHistory: RiskDecision[] = [];
  private maxHistoryLength: number = 1000;

  constructor(params: RiskParameters = DEFAULT_RISK_PARAMETERS) {
    this.parameters = { ...params };
  }

  /**
   * Evaluate risk for a given oracle snapshot
   * Returns a cryptographically signed decision
   */
  evaluate(snapshot: OracleSnapshot): RiskDecision {
    const metrics = snapshot.metrics;

    // Evaluate all risk factors
    const factors: RiskFactor[] = [
      evaluateConfidenceRatio(metrics, this.parameters),
      evaluateConfidenceZscore(metrics, this.parameters),
      evaluateDataFreshness(metrics, this.parameters),
      evaluateVolatility(metrics, this.parameters),
      evaluateDataQuality(metrics, this.parameters),
      evaluateVolatilitySpike(metrics, this.parameters),
      evaluateOracleSource(snapshot, this.parameters),
    ];

    // Check for blocking conditions
    const hasBlocker = factors.some((f) => f.triggered);

    // Calculate metrics
    const riskScore = calculateRiskScore(factors);
    const sizeMultiplier = hasBlocker ? 0 : calculateSizeMultiplier(factors, this.parameters, metrics);

    // Determine action
    let action: RiskAction;
    if (hasBlocker) action = 'BLOCK';
    else if (sizeMultiplier < 0.95) action = 'SCALE';
    else action = 'ALLOW';

    // Generate explanation
    const explanation = generateExplanation(action, factors, riskScore, sizeMultiplier);

    // Sign the decision (LAZY SINGLETON)
    const signedDecision = getSigningEngine().sign(
      snapshot.price.assetId,
      snapshot.price.price,
      snapshot.price.confidence,
      riskScore,
      action,
      hasBlocker ? 0 : sizeMultiplier,
      explanation
    );

    const decision: RiskDecision = {
      action,
      sizeMultiplier: hasBlocker ? 0 : sizeMultiplier,
      riskScore,
      explanation,
      factors,
      timestamp: Date.now(),
      oracleSnapshot: snapshot,
      parameters: this.parameters,
      signedDecision,
    };

    // Store in history
    this.decisionHistory.push(decision);
    if (this.decisionHistory.length > this.maxHistoryLength) this.decisionHistory.shift();

    return decision;
  }

  updateParameters(newParams: Partial<RiskParameters>): void {
    this.parameters = { ...this.parameters, ...newParams };
  }

  getParameters(): RiskParameters {
    return { ...this.parameters };
  }

  getHistory(): RiskDecision[] {
    return [...this.decisionHistory];
  }

  getRecentDecisions(count: number = 10): RiskDecision[] {
    return this.decisionHistory.slice(-count);
  }

  getStatistics(): {
    totalDecisions: number;
    allowedCount: number;
    scaledCount: number;
    blockedCount: number;
    averageRiskScore: number;
    averageSizeMultiplier: number;
  } {
    const total = this.decisionHistory.length;
    if (total === 0) {
      return {
        totalDecisions: 0,
        allowedCount: 0,
        scaledCount: 0,
        blockedCount: 0,
        averageRiskScore: 0,
        averageSizeMultiplier: 0,
      };
    }

    return {
      totalDecisions: total,
      allowedCount: this.decisionHistory.filter((d) => d.action === 'ALLOW').length,
      scaledCount: this.decisionHistory.filter((d) => d.action === 'SCALE').length,
      blockedCount: this.decisionHistory.filter((d) => d.action === 'BLOCK').length,
      averageRiskScore: this.decisionHistory.reduce((sum, d) => sum + d.riskScore, 0) / total,
      averageSizeMultiplier: this.decisionHistory.reduce((sum, d) => sum + d.sizeMultiplier, 0) / total,
    };
  }

  clearHistory(): void {
    this.decisionHistory = [];
  }

  getSignerPublicKey(): string {
    return getSigningEngine().getPublicKey();
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const riskEngine = new RiskEngine();

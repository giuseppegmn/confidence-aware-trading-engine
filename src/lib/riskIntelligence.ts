/**
 * CATE - Risk Intelligence Layer
 * 
 * Implements deterministic quantitative logic for trading decisions.
 * No black-box AI - all rules are explicit and auditable.
 * 
 * Every trade must answer: "Is this data statistically trustworthy 
 * enough to risk real capital?"
 */

import type {
  OracleSnapshot,
  RiskDecision,
  RiskAction,
  RiskFactor,
  RiskParameters,
} from './types';

// ============================================
// DEFAULT RISK PARAMETERS
// ============================================

export const DEFAULT_RISK_PARAMETERS: RiskParameters = {
  // Confidence ratio thresholds (as percentage)
  maxConfidenceRatioScale: 1.0,  // >1% confidence ratio → scale position
  maxConfidenceRatioBlock: 3.0,  // >3% confidence ratio → block trade
  
  // Z-score threshold for statistical anomaly
  maxConfidenceZscore: 3.0,  // >3 standard deviations → block
  
  // Data freshness
  maxStalenessSeconds: 30,  // >30 seconds old → block
  
  // Volatility thresholds (annualized %)
  maxVolatilityScale: 100,   // >100% annualized vol → scale
  maxVolatilityBlock: 200,   // >200% annualized vol → block
  
  // Publisher count
  minPublisherCount: 3,  // Need at least 3 publishers
  
  // Volatility spike detection
  volatilitySpikeThreshold: 2.0,  // Realized/Expected > 2x → concern
};

// ============================================
// RISK FACTOR EVALUATION
// ============================================

function evaluateConfidenceRatio(
  snapshot: OracleSnapshot,
  params: RiskParameters
): RiskFactor {
  const value = snapshot.metrics.confidenceRatio;
  const triggered = value > params.maxConfidenceRatioBlock;
  const scaling = value > params.maxConfidenceRatioScale && !triggered;
  
  let impact = 0;
  let description = '';
  
  if (triggered) {
    impact = -40;
    description = `Confidence ratio ${value.toFixed(3)}% exceeds block threshold ${params.maxConfidenceRatioBlock}%. Oracle uncertainty is too high for safe execution.`;
  } else if (scaling) {
    impact = -20;
    description = `Confidence ratio ${value.toFixed(3)}% exceeds scale threshold ${params.maxConfidenceRatioScale}%. Position should be reduced.`;
  } else {
    impact = 10;
    description = `Confidence ratio ${value.toFixed(3)}% is within acceptable bounds.`;
  }
  
  return {
    name: 'Confidence Ratio',
    value,
    threshold: triggered ? params.maxConfidenceRatioBlock : params.maxConfidenceRatioScale,
    impact,
    triggered,
    description,
  };
}

function evaluateConfidenceZscore(
  snapshot: OracleSnapshot,
  params: RiskParameters
): RiskFactor {
  const value = Math.abs(snapshot.metrics.confidenceZscore);
  const triggered = value > params.maxConfidenceZscore;
  
  let impact = 0;
  let description = '';
  
  if (triggered) {
    impact = -35;
    description = `Confidence z-score ${value.toFixed(2)} exceeds ${params.maxConfidenceZscore}σ. Statistical anomaly detected in oracle data.`;
  } else if (value > params.maxConfidenceZscore * 0.7) {
    impact = -10;
    description = `Confidence z-score ${value.toFixed(2)} approaching anomaly threshold.`;
  } else {
    impact = 5;
    description = `Confidence z-score ${value.toFixed(2)} is statistically normal.`;
  }
  
  return {
    name: 'Confidence Z-Score',
    value,
    threshold: params.maxConfidenceZscore,
    impact,
    triggered,
    description,
  };
}

function evaluateDataFreshness(
  snapshot: OracleSnapshot,
  params: RiskParameters
): RiskFactor {
  const value = snapshot.metrics.dataFreshnessSeconds;
  const triggered = value > params.maxStalenessSeconds;
  
  let impact = 0;
  let description = '';
  
  if (triggered) {
    impact = -50;
    description = `Data is ${value.toFixed(1)}s old, exceeding ${params.maxStalenessSeconds}s limit. Stale data cannot be trusted.`;
  } else if (value > params.maxStalenessSeconds * 0.7) {
    impact = -10;
    description = `Data freshness ${value.toFixed(1)}s approaching staleness threshold.`;
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
  };
}

function evaluateVolatility(
  snapshot: OracleSnapshot,
  params: RiskParameters
): RiskFactor {
  const value = snapshot.metrics.volatilityRealized;
  const triggered = value > params.maxVolatilityBlock;
  const scaling = value > params.maxVolatilityScale && !triggered;
  
  let impact = 0;
  let description = '';
  
  if (triggered) {
    impact = -35;
    description = `Realized volatility ${value.toFixed(1)}% exceeds block threshold ${params.maxVolatilityBlock}%. Market is too volatile.`;
  } else if (scaling) {
    impact = -15;
    description = `Realized volatility ${value.toFixed(1)}% exceeds scale threshold. Consider reducing position.`;
  } else {
    impact = 5;
    description = `Volatility ${value.toFixed(1)}% is within acceptable range.`;
  }
  
  return {
    name: 'Realized Volatility',
    value,
    threshold: triggered ? params.maxVolatilityBlock : params.maxVolatilityScale,
    impact,
    triggered,
    description,
  };
}

function evaluatePublisherCount(
  snapshot: OracleSnapshot,
  params: RiskParameters
): RiskFactor {
  const value = snapshot.price.publisherCount;
  const triggered = value < params.minPublisherCount;
  
  let impact = 0;
  let description = '';
  
  if (triggered) {
    impact = -45;
    description = `Only ${value} publishers reporting (minimum ${params.minPublisherCount} required). Insufficient data sources.`;
  } else if (value < params.minPublisherCount * 2) {
    impact = -5;
    description = `Publisher count ${value} is acceptable but below optimal levels.`;
  } else {
    impact = 10;
    description = `Strong publisher coverage with ${value} sources.`;
  }
  
  return {
    name: 'Publisher Count',
    value,
    threshold: params.minPublisherCount,
    impact,
    triggered,
    description,
  };
}

function evaluateVolatilitySpike(
  snapshot: OracleSnapshot,
  params: RiskParameters
): RiskFactor {
  const expected = snapshot.metrics.volatilityExpected || 1;
  const ratio = snapshot.metrics.volatilityRealized / expected;
  const triggered = ratio > params.volatilitySpikeThreshold && 
                   snapshot.metrics.confidenceRatio > params.maxConfidenceRatioScale;
  
  let impact = 0;
  let description = '';
  
  if (triggered) {
    impact = -30;
    description = `Volatility spike detected: realized/expected ratio ${ratio.toFixed(2)}x while confidence is degraded. Market stress signal.`;
  } else if (ratio > params.volatilitySpikeThreshold) {
    impact = -10;
    description = `Elevated volatility ratio ${ratio.toFixed(2)}x but confidence remains acceptable.`;
  } else {
    impact = 5;
    description = `Volatility ratio ${ratio.toFixed(2)}x indicates stable conditions.`;
  }
  
  return {
    name: 'Volatility Spike',
    value: ratio,
    threshold: params.volatilitySpikeThreshold,
    impact,
    triggered,
    description,
  };
}

// ============================================
// DECISION LOGIC
// ============================================

function calculateSizeMultiplier(factors: RiskFactor[], params: RiskParameters, metrics: any): number {
  // Start with full size
  let multiplier = 1.0;
  
  // Apply confidence ratio scaling
  const confRatio = metrics.confidenceRatio;
  if (confRatio > params.maxConfidenceRatioScale) {
    const scaleFactor = Math.max(0.1, 1 - (confRatio - params.maxConfidenceRatioScale) / 
                                      (params.maxConfidenceRatioBlock - params.maxConfidenceRatioScale));
    multiplier *= scaleFactor;
  }
  
  // Apply volatility scaling
  const vol = metrics.volatilityRealized;
  if (vol > params.maxVolatilityScale) {
    const scaleFactor = Math.max(0.2, 1 - (vol - params.maxVolatilityScale) / 
                                      (params.maxVolatilityBlock - params.maxVolatilityScale));
    multiplier *= scaleFactor;
  }
  
  // Apply z-score scaling
  const zscore = Math.abs(metrics.confidenceZscore);
  if (zscore > params.maxConfidenceZscore * 0.5) {
    const scaleFactor = Math.max(0.3, 1 - (zscore - params.maxConfidenceZscore * 0.5) / 
                                      (params.maxConfidenceZscore * 0.5));
    multiplier *= scaleFactor;
  }
  
  return Math.max(0, Math.min(1, multiplier));
}

function calculateRiskScore(factors: RiskFactor[]): number {
  // Base score of 50
  let score = 50;
  
  // Sum all impacts
  const totalImpact = factors.reduce((sum, f) => sum + f.impact, 0);
  
  // Apply impacts (negative impacts increase risk score)
  score -= totalImpact;
  
  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}

function generateExplanation(
  action: RiskAction,
  factors: RiskFactor[],
  riskScore: number,
  sizeMultiplier: number
): string {
  const triggeredFactors = factors.filter(f => f.triggered);
  const warningFactors = factors.filter(f => f.impact < 0 && !f.triggered);
  
  let explanation = '';
  
  switch (action) {
    case 'BLOCK':
      explanation = `TRADE BLOCKED (Risk Score: ${riskScore.toFixed(0)}/100)\n\n`;
      explanation += `Critical Issues:\n`;
      for (const factor of triggeredFactors) {
        explanation += `• ${factor.name}: ${factor.description}\n`;
      }
      explanation += `\nTo enable execution, the following must improve:\n`;
      for (const factor of triggeredFactors) {
        explanation += `• ${factor.name} must fall below ${factor.threshold}\n`;
      }
      break;
      
    case 'SCALE':
      explanation = `POSITION SCALED TO ${(sizeMultiplier * 100).toFixed(0)}% (Risk Score: ${riskScore.toFixed(0)}/100)\n\n`;
      explanation += `Risk Factors:\n`;
      for (const factor of warningFactors) {
        explanation += `• ${factor.name}: ${factor.description}\n`;
      }
      explanation += `\nFull position would be allowed if:\n`;
      for (const factor of warningFactors.slice(0, 2)) {
        explanation += `• ${factor.name} improves\n`;
      }
      break;
      
    case 'ALLOW':
      explanation = `TRADE ALLOWED (Risk Score: ${riskScore.toFixed(0)}/100)\n\n`;
      explanation += `All risk factors within acceptable bounds:\n`;
      for (const factor of factors.filter(f => f.impact > 0).slice(0, 3)) {
        explanation += `• ${factor.name}: ${factor.description}\n`;
      }
      break;
  }
  
  return explanation;
}

// ============================================
// MAIN EVALUATION FUNCTION
// ============================================

export function evaluateRisk(
  snapshot: OracleSnapshot,
  params: RiskParameters = DEFAULT_RISK_PARAMETERS
): RiskDecision {
  // Evaluate all risk factors
  const factors: RiskFactor[] = [
    evaluateConfidenceRatio(snapshot, params),
    evaluateConfidenceZscore(snapshot, params),
    evaluateDataFreshness(snapshot, params),
    evaluateVolatility(snapshot, params),
    evaluatePublisherCount(snapshot, params),
    evaluateVolatilitySpike(snapshot, params),
  ];
  
  // Check for blocking conditions
  const blockingFactors = factors.filter(f => f.triggered);
  const hasBlocker = blockingFactors.length > 0;
  
  // Calculate risk score
  const riskScore = calculateRiskScore(factors);
  
  // Calculate size multiplier
  const sizeMultiplier = hasBlocker ? 0 : calculateSizeMultiplier(factors, params, snapshot.metrics);
  
  // Determine action
  let action: RiskAction;
  if (hasBlocker) {
    action = 'BLOCK';
  } else if (sizeMultiplier < 0.95) {
    action = 'SCALE';
  } else {
    action = 'ALLOW';
  }
  
  // Generate explanation
  const explanation = generateExplanation(action, factors, riskScore, sizeMultiplier);
  
  return {
    action,
    sizeMultiplier: hasBlocker ? 0 : sizeMultiplier,
    riskScore,
    explanation,
    factors,
    timestamp: Date.now(),
    oracleState: snapshot,
    parameters: params,
  };
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
  
  evaluate(snapshot: OracleSnapshot): RiskDecision {
    const decision = evaluateRisk(snapshot, this.parameters);
    
    // Store in history
    this.decisionHistory.push(decision);
    if (this.decisionHistory.length > this.maxHistoryLength) {
      this.decisionHistory.shift();
    }
    
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
    
    const allowed = this.decisionHistory.filter(d => d.action === 'ALLOW').length;
    const scaled = this.decisionHistory.filter(d => d.action === 'SCALE').length;
    const blocked = this.decisionHistory.filter(d => d.action === 'BLOCK').length;
    
    const avgRisk = this.decisionHistory.reduce((sum, d) => sum + d.riskScore, 0) / total;
    const avgMultiplier = this.decisionHistory.reduce((sum, d) => sum + d.sizeMultiplier, 0) / total;
    
    return {
      totalDecisions: total,
      allowedCount: allowed,
      scaledCount: scaled,
      blockedCount: blocked,
      averageRiskScore: avgRisk,
      averageSizeMultiplier: avgMultiplier,
    };
  }
  
  clearHistory(): void {
    this.decisionHistory = [];
  }
}

// Singleton instance
export const riskEngine = new RiskEngine();

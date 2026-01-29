/**
 * Risk Intelligence Engine
 * Validates all inputs to prevent NaN/Infinity attacks
 */

import { OracleSnapshot } from './oracle/types';

// =============================================================================
// TYPES
// =============================================================================

export type RiskAction = 'ALLOW' | 'SCALE' | 'BLOCK';

export interface RiskDecision {
  action: RiskAction;
  score: number; // 0-100
  confidenceRatio: number;
  explanation: string;
  timestamp: number;
  requiresUpdate?: boolean;
}

export interface RiskParameters {
  maxConfidenceRatioScale: number; // e.g., 1.0%
  maxConfidenceRatioBlock: number; // e.g., 3.0%
  maxConfidenceZscore: number;
  maxStalenessSeconds: number;
  minDataQualityScore: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PARAMS: RiskParameters = {
  maxConfidenceRatioScale: 1.0,
  maxConfidenceRatioBlock: 3.0,
  maxConfidenceZscore: 2.5,
  maxStalenessSeconds: 60,
  minDataQualityScore: 80
};

// Sanitize defaults to prevent invalid states
Object.freeze(DEFAULT_PARAMS);

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' 
    && Number.isFinite(value) 
    && !Number.isNaN(value);
}

function sanitizeConfidenceRatio(ratio: unknown): number {
  if (!isValidNumber(ratio)) return Infinity; // Fail safe
  if (ratio < 0) return 0;
  if (ratio > 100) return 100;
  return ratio;
}

function sanitizePrice(price: unknown): number {
  if (!isValidNumber(price)) return -1; // Invalid marker
  if (price < 0) return -1;
  return price;
}

function sanitizePublishers(count: unknown): number {
  if (!isValidNumber(count) || count < 0) return 0;
  return Math.floor(count);
}

// =============================================================================
// RISK ENGINE
// =============================================================================

export class RiskIntelligenceEngine {
  private params: RiskParameters;

  constructor(params: Partial<RiskParameters> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.validateParams();
  }

  updateParameters(newParams: Partial<RiskParameters>): void {
    this.params = { ...this.params, ...newParams };
    this.validateParams();
  }

  private validateParams(): void {
    // Ensure all parameters are valid numbers
    const p = this.params;
    
    if (!isValidNumber(p.maxConfidenceRatioScale)) {
      throw new Error('Invalid maxConfidenceRatioScale');
    }
    if (!isValidNumber(p.maxConfidenceRatioBlock)) {
      throw new Error('Invalid maxConfidenceRatioBlock');
    }
    if (p.maxConfidenceRatioScale >= p.maxConfidenceRatioBlock) {
      throw new Error('Scale threshold must be less than block threshold');
    }
  }

  evaluate(snapshot: OracleSnapshot): RiskDecision {
    const timestamp = Date.now();
    
    // Sanitize all inputs from oracle
    const price = sanitizePrice(snapshot.price.price);
    const confidence = sanitizePrice(snapshot.price.confidence);
    const confidenceRatio = sanitizeConfidenceRatio(snapshot.price.confidenceRatio);
    const numPublishers = sanitizePublishers(snapshot.price.numPublishers);
    const publishTime = sanitizePublishers(snapshot.price.publishTime);

    // Check for invalid oracle data
    if (price < 0 || confidence < 0) {
      return {
        action: 'BLOCK',
        score: 100,
        confidenceRatio: 0,
        explanation: 'Invalid oracle data (NaN/Infinity/negative price)',
        timestamp,
        requiresUpdate: true
      };
    }

    // Check staleness
    const nowSeconds = Math.floor(timestamp / 1000);
    const staleness = nowSeconds - publishTime;
    if (!isValidNumber(staleness) || staleness > this.params.maxStalenessSeconds) {
      return {
        action: 'BLOCK',
        score: 95,
        confidenceRatio,
        explanation: `Stale data: ${staleness}s old (max ${this.params.maxStalenessSeconds}s)`,
        timestamp,
        requiresUpdate: true
      };
    }

    // Check publisher count
    if (numPublishers < 3) {
      return {
        action: 'BLOCK',
        score: 90,
        confidenceRatio,
        explanation: `Insufficient publishers: ${numPublishers} (min 3)`,
        timestamp,
        requiresUpdate: true
      };
    }

    // Calculate risk score based on confidence ratio
    let score = 0;
    let action: RiskAction = 'ALLOW';
    let explanation = 'Data within acceptable parameters';

    // Confidence ratio logic (lower is better)
    if (confidenceRatio > this.params.maxConfidenceRatioBlock) {
      score = 100;
      action = 'BLOCK';
      explanation = `Critical confidence ratio: ${confidenceRatio.toFixed(2)}% > ${this.params.maxConfidenceRatioBlock}%`;
    } else if (confidenceRatio > this.params.maxConfidenceRatioScale) {
      score = 50 + (confidenceRatio / this.params.maxConfidenceRatioBlock) * 50;
      action = 'SCALE';
      explanation = `Elevated confidence: ${confidenceRatio.toFixed(2)}% (threshold: ${this.params.maxConfidenceRatioScale}%)`;
    } else {
      score = (confidenceRatio / this.params.maxConfidenceRatioScale) * 25;
      action = 'ALLOW';
    }

    // Ensure score is valid
    score = Math.min(100, Math.max(0, isValidNumber(score) ? score : 100));

    return {
      action,
      score: Math.floor(score),
      confidenceRatio,
      explanation,
      timestamp,
      requiresUpdate: action !== 'ALLOW'
    };
  }

  // Batch evaluation for multiple assets
  evaluateBatch(snapshots: OracleSnapshot[]): Map<string, RiskDecision> {
    const results = new Map<string, RiskDecision>();
    
    for (const snapshot of snapshots) {
      try {
        const decision = this.evaluate(snapshot);
        results.set(snapshot.price.id, decision);
      } catch (error) {
        console.error(`[RiskEngine] Failed to evaluate ${snapshot.price.id}:`, error);
        results.set(snapshot.price.id, {
          action: 'BLOCK',
          score: 100,
          confidenceRatio: 0,
          explanation: 'Evaluation error',
          timestamp: Date.now(),
          requiresUpdate: true
        });
      }
    }
    
    return results;
  }
}

// Singleton instance
export const riskEngine = new RiskIntelligenceEngine();

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RiskEngine, DEFAULT_RISK_PARAMETERS } from './engine';
import type { OracleSnapshot } from '../oracle/types';

function makeSnapshot(overrides: Partial<OracleSnapshot['metrics']> = {},
  priceOverrides: Partial<OracleSnapshot['price']> = {}): OracleSnapshot {
  const now = Date.now();
  return {
    price: {
      assetId: 'SOL/USD',
      feedId: '0'.repeat(64),
      price: 100,
      confidence: 0.2,
      timestamp: now,
      publishTime: Math.floor(now / 1000),
      emaPrice: 100,
      emaConfidence: 0.2,
      exponent: -8,
      source: 'PYTH_HERMES',
      sequence: 1,
      ...priceOverrides,
    },
    metrics: {
      confidenceRatio: 0.2,
      confidenceZscore: 0,
      volatilityRealized: 10,
      volatilityExpected: 10,
      dataFreshnessSeconds: 1,
      avgConfidenceRatio1h: 0.2,
      avgConfidenceRatio24h: 0.2,
      priceChange1h: 0,
      priceChange24h: 0,
      updateFrequency1m: 10,
      dataQualityScore: 100,
      ...overrides,
    },
    rollingWindows: { '1m': [], '5m': [], '15m': [], '1h': [] },
    snapshotHash: 'test',
    createdAt: now,
  };
}

describe('risk/engine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-28T12:00:00Z'));
  });

  it('ALLOW when all factors within bounds', () => {
    const engine = new RiskEngine(DEFAULT_RISK_PARAMETERS);
    const d = engine.evaluate(makeSnapshot());
    expect(d.action).toBe('ALLOW');
    expect(d.sizeMultiplier).toBeGreaterThanOrEqual(0.95);
  });

  it('SCALE when confidence ratio above scale threshold but below block', () => {
    const engine = new RiskEngine({ ...DEFAULT_RISK_PARAMETERS, maxConfidenceRatioScale: 0.5, maxConfidenceRatioBlock: 3 });
    const d = engine.evaluate(makeSnapshot({ confidenceRatio: 1.0 }));
    expect(['SCALE', 'BLOCK']).toContain(d.action);
    expect(d.action).toBe('SCALE');
    expect(d.sizeMultiplier).toBeLessThan(0.95);
  });

  it('BLOCK on stale data', () => {
    const engine = new RiskEngine({ ...DEFAULT_RISK_PARAMETERS, maxStalenessSeconds: 30 });
    const d = engine.evaluate(makeSnapshot({ dataFreshnessSeconds: 120 }));
    expect(d.action).toBe('BLOCK');
    expect(d.sizeMultiplier).toBe(0);
    expect(d.explanation.toUpperCase()).toContain('BLOCKED');
  });

  it('BLOCK when requireLiveOracle and source is FALLBACK', () => {
    const engine = new RiskEngine({ ...DEFAULT_RISK_PARAMETERS, requireLiveOracle: true });
    const d = engine.evaluate(makeSnapshot({}, { source: 'FALLBACK' }));
    expect(d.action).toBe('BLOCK');
  });
});

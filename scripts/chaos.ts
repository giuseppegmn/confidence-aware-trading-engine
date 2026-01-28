import 'dotenv/config';
import { RiskEngine, DEFAULT_RISK_PARAMETERS } from '../src/lib/risk/engine';
import type { OracleSnapshot } from '../src/lib/oracle/types';

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function sampleSnapshot(i: number): OracleSnapshot {
  const now = Date.now();
  const price = rand(50, 150);
  const confidence = rand(0.01, 5); // sometimes huge relative to price
  const freshness = rand(0, 120);
  const src: OracleSnapshot['price']['source'] = Math.random() < 0.15 ? 'FALLBACK' : 'PYTH_HERMES';

  return {
    price: {
      assetId: 'SOL/USD',
      feedId: '0'.repeat(64),
      price,
      confidence,
      timestamp: now,
      publishTime: Math.floor(now / 1000 - freshness),
      emaPrice: price,
      emaConfidence: confidence,
      exponent: -8,
      source: src,
      sequence: i,
    },
    metrics: {
      confidenceRatio: (confidence / Math.abs(price)) * 100,
      confidenceZscore: rand(-5, 5),
      volatilityRealized: rand(0, 300),
      volatilityExpected: rand(0, 300),
      dataFreshnessSeconds: freshness,
      avgConfidenceRatio1h: rand(0, 5),
      avgConfidenceRatio24h: rand(0, 5),
      priceChange1h: rand(-10, 10),
      priceChange24h: rand(-30, 30),
      updateFrequency1m: rand(0, 30),
      dataQualityScore: rand(0, 100),
    },
    rollingWindows: { '1m': [], '5m': [], '15m': [], '1h': [] },
    snapshotHash: 'chaos',
    createdAt: now,
  };
}

async function main() {
  const n = Number(process.env.CATE_CHAOS_RUNS || 200);
  const engine = new RiskEngine(DEFAULT_RISK_PARAMETERS);

  const counts = { ALLOW: 0, SCALE: 0, BLOCK: 0 } as Record<string, number>;

  for (let i = 0; i < n; i++) {
    const d = engine.evaluate(sampleSnapshot(i));
    counts[d.action]++;
  }

  console.log(`\n[CATE chaos] runs: ${n}`);
  console.log(counts);
  console.log('\nTip: set CATE_CHAOS_RUNS=10000 to stress-test the engine.');
}

main().catch((err) => {
  console.error('\n[CATE chaos] FAILED');
  console.error(err);
  process.exit(1);
});

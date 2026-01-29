import 'dotenv/config';
import { HermesClient } from '@pythnetwork/hermes-client';
import { RiskEngine, DEFAULT_RISK_PARAMETERS } from '../src/lib/risk/engine';
import { SUPPORTED_ASSETS } from '../src/lib/oracle/pythHermes';
import type { OracleSnapshot, OraclePrice, OracleMetrics } from '../src/lib/oracle/types';
import { verifySignedDecision, SigningEngine } from '../src/lib/crypto/signing';

function fmt(n: number) {
  return Number.isFinite(n) ? n.toFixed(6) : String(n);
}

function buildSnapshot(params: {
  assetId: string;
  feedId: string;
  price: number;
  confidence: number;
  publishTime: number;
  exponent?: number;
}): OracleSnapshot {
  const now = Date.now();

  const priceObj: OraclePrice = {
    assetId: params.assetId,
    feedId: params.feedId,
    price: params.price,
    confidence: params.confidence,
    timestamp: now,
    publishTime: params.publishTime,
    emaPrice: params.price,
    emaConfidence: params.confidence,
    exponent: params.exponent ?? -8,
    source: 'PYTH_HERMES',
    sequence: 1,
  };

  const confidenceRatio = params.price === 0 ? 999 : (params.confidence / Math.abs(params.price)) * 100;
  const metrics: OracleMetrics = {
    confidenceRatio,
    confidenceZscore: 0,
    volatilityRealized: 0,
    volatilityExpected: 0,
    dataFreshnessSeconds: Math.max(0, (now / 1000) - params.publishTime),
    avgConfidenceRatio1h: confidenceRatio,
    avgConfidenceRatio24h: confidenceRatio,
    priceChange1h: 0,
    priceChange24h: 0,
    updateFrequency1m: 1,
    dataQualityScore: 100,
  };

  return {
    price: priceObj,
    metrics,
    rollingWindows: { '1m': [], '5m': [], '15m': [], '1h': [] },
    snapshotHash: 'demo',
    createdAt: now,
  };
}

async function main() {
  const endpoint = process.env.CATE_HERMES_ENDPOINT || 'https://hermes.pyth.network';
  const client = new HermesClient(endpoint);

  const asset = SUPPORTED_ASSETS.find(a => a.active) || SUPPORTED_ASSETS[0];
  if (!asset) throw new Error('No supported assets configured');

  console.log(`\n[CATE demo] Hermes endpoint: ${endpoint}`);
  console.log(`[CATE demo] Asset: ${asset.id} (${asset.pythFeedId})`);

  // ✅ FIX: use getPriceFeeds instead of getLatestPriceFeeds
  // This returns feed objects that include a `price` field compatible with your existing logic.
  const feeds = await client.getPriceFeeds({ ids: [asset.pythFeedId] });
  const feed = feeds?.[0];

  if (!feed?.price) {
    throw new Error(
      `No price data returned from Hermes for feedId=${asset.pythFeedId}. ` +
      `Check the feed id format and Hermes endpoint.`
    );
  }

  const expo = feed.price.expo;
  const px = Number(feed.price.price) * Math.pow(10, expo);
  const conf = Number(feed.price.conf) * Math.pow(10, expo);

  const snapshot = buildSnapshot({
    assetId: asset.id,
    feedId: asset.pythFeedId,
    price: px,
    confidence: conf,
    publishTime: feed.price.publishTime,
    exponent: expo,
  });

  const secret = process.env.CATE_TRUSTED_SIGNER_SECRET;
  const signer = new SigningEngine(secret);
  const engine = new RiskEngine(DEFAULT_RISK_PARAMETERS);

  const decision = engine.evaluate(snapshot);

  const signed = signer.sign(
    snapshot.price.assetId,
    snapshot.price.price,
    snapshot.price.confidence,
    decision.riskScore,
    decision.action,
    decision.sizeMultiplier,
    decision.explanation
  );

  const verification = verifySignedDecision(signed);

  console.log('\n=== ORACLE ===');
  console.log(`price:      ${fmt(snapshot.price.price)}`);
  console.log(`confidence: ${fmt(snapshot.price.confidence)} (±)`);
  console.log(`ratio:      ${fmt(snapshot.metrics.confidenceRatio)}%`);
  console.log(`publishTime:${snapshot.price.publishTime}`);

  console.log('\n=== DECISION ===');
  console.log(`action:         ${decision.action}`);
  console.log(`riskScore:       ${decision.riskScore.toFixed(0)}/100`);
  console.log(`sizeMultiplier:  ${(decision.sizeMultiplier * 100).toFixed(0)}%`);

  console.log('\n=== SIGNATURE ===');
  console.log(`signer:   ${signed.signerPublicKey}`);
  console.log(`hash:     ${signed.decisionHash}`);
  console.log(`sig:      ${signed.signature.slice(0, 12)}...`);
  console.log(`verified: ${verification.valid ? 'YES' : 'NO'}`);
  if (!verification.valid) console.log(`error:    ${verification.error}`);

  console.log('\n=== EXPLANATION ===');
  console.log(decision.explanation);
  console.log('');
}

main().catch((err) => {
  console.error('\n[CATE demo] FAILED');
  console.error(err);
  process.exit(1);
});

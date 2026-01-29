import dotenv from 'dotenv';
import fs from 'fs';
import crypto from 'crypto';

dotenv.config({ path: '.env' });

import { HermesClient } from '@pythnetwork/hermes-client'; // kept (not required anymore, but harmless)
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
    dataFreshnessSeconds: Math.max(0, now / 1000 - params.publishTime),
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

function ensure0x(id: string) {
  const trimmed = id.trim();
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

async function fetchLatestPriceFromHermes(params: { endpoint: string; feedId: string }) {
  const base = params.endpoint.replace(/\/+$/, '');
  const id0x = ensure0x(params.feedId);

  const url = `${base}/v2/updates/price/latest?ids%5B%5D=${encodeURIComponent(id0x)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Hermes HTTP ${res.status} fetching latest price. url=${url} body=${text.slice(0, 300)}`);
  }

  const body: any = await res.json();
  const parsed = body?.parsed?.[0];
  const priceObj = parsed?.price;

  if (!priceObj) {
    console.log('[DEBUG] Hermes response:', JSON.stringify(body, null, 2));
    throw new Error(`No parsed price found in Hermes response for id=${id0x}`);
  }

  const expo = Number(priceObj.expo);
  const price = Number(priceObj.price) * Math.pow(10, expo);
  const confidence = Number(priceObj.conf) * Math.pow(10, expo);
  const publishTime = Number(priceObj.publish_time);

  return { expo, price, confidence, publishTime, id0x };
}

function secretFingerprint(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  // fingerprint only (doesn't reveal key)
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

async function main() {
  // --- hard diagnostics ---
  const cwd = process.cwd();
  const envExists = fs.existsSync('.env');
  const b64 = process.env.CATE_TRUSTED_SIGNER_SECRET_B64;

  console.log('\n=== ENV DIAGNOSTICS ===');
  console.log('CWD:', cwd);
  console.log('.env exists:', envExists);
  console.log('B64 present:', !!b64);
  console.log('B64 length:', b64 ? b64.length : 0);
  console.log('B64 fingerprint:', b64 ? secretFingerprint(b64) : 'N/A');

  if (!b64) {
    throw new Error('Missing CATE_TRUSTED_SIGNER_SECRET_B64 in .env');
  }

  // use b64 directly (signing.ts supports "b64:<...>")
  const signer = new SigningEngine(`b64:${b64}`);

  const endpoint = process.env.CATE_HERMES_ENDPOINT || 'https://hermes.pyth.network';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const client = new HermesClient(endpoint);

  const asset = SUPPORTED_ASSETS.find((a) => a.active) || SUPPORTED_ASSETS[0];
  if (!asset) throw new Error('No supported assets configured');

  console.log(`\n[CATE demo] Hermes endpoint: ${endpoint}`);
  console.log(`[CATE demo] Asset: ${asset.id} (${asset.pythFeedId})`);

  const latest = await fetchLatestPriceFromHermes({
    endpoint,
    feedId: asset.pythFeedId,
  });

  const snapshot = buildSnapshot({
    assetId: asset.id,
    feedId: latest.id0x,
    price: latest.price,
    confidence: latest.confidence,
    publishTime: latest.publishTime,
    exponent: latest.expo,
  });

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

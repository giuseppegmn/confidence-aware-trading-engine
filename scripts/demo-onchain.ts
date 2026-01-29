import 'dotenv/config';

import fs from 'fs';
import os from 'os';
import path from 'path';

import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { HermesClient } from '@pythnetwork/hermes-client';
import { SUPPORTED_ASSETS } from '../src/lib/oracle/pythHermes';
import { RiskEngine, DEFAULT_RISK_PARAMETERS } from '../src/lib/risk/engine';
import { SigningEngine } from '../src/lib/crypto/signing';

function readJson(p: string) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadSolanaKeypair(): Keypair {
  const fromEnv = process.env.CATE_SOLANA_KEYPAIR;
  const defaultPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  const keypairPath = fromEnv || defaultPath;
  const secret = readJson(keypairPath);
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function getConfigPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
}

function getAssetRiskPDA(programId: PublicKey, assetId: string): [PublicKey, number] {
  // Must match on-chain seeds: [b"asset_risk", asset_id.as_bytes()]
  return PublicKey.findProgramAddressSync(
    [Buffer.from('asset_risk'), Buffer.from(assetId)],
    programId
  );
}

async function main() {
  const rpc = process.env.CATE_RPC_ENDPOINT || 'https://api.devnet.solana.com';
  const hermesEndpoint = process.env.CATE_HERMES_ENDPOINT || 'https://hermes.pyth.network';
  const keypair = loadSolanaKeypair();

  const idlPath = path.join('src', 'idl', 'workspaceIDL.json');
  const idl = readJson(idlPath);
  const programId = new PublicKey(idl.address);

  const connection = new Connection(rpc, 'confirmed');
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const program = new anchor.Program(idl as anchor.Idl, programId, provider);

  console.log(`\n[CATE on-chain demo] RPC: ${rpc}`);
  console.log(`[CATE on-chain demo] Program: ${programId.toBase58()}`);
  console.log(`[CATE on-chain demo] Authority: ${wallet.publicKey.toBase58()}`);

  // Pick a default asset
  const asset = SUPPORTED_ASSETS.find(a => a.active) || SUPPORTED_ASSETS[0];
  if (!asset) throw new Error('No supported assets configured');

  // Pull price from Hermes
  const hermes = new HermesClient(hermesEndpoint);
  const [feed] = await hermes.getLatestPriceFeeds([asset.pythFeedId]);
  if (!feed?.price) throw new Error('No price data returned from Hermes');

  const expo = feed.price.expo;
  const px = Number(feed.price.price) * Math.pow(10, expo);
  const conf = Number(feed.price.conf) * Math.pow(10, expo);

  // Risk engine decision
  const engine = new RiskEngine(DEFAULT_RISK_PARAMETERS);
  const snapshotNow = Date.now();
  const confidenceRatio = px === 0 ? 999 : (conf / Math.abs(px)) * 100;

  const snapshot = {
    price: {
      assetId: asset.id,
      feedId: asset.pythFeedId,
      price: px,
      confidence: conf,
      timestamp: snapshotNow,
      publishTime: feed.price.publishTime,
      emaPrice: px,
      emaConfidence: conf,
      exponent: -8,
      source: 'PYTH_HERMES' as const,
      sequence: 1,
    },
    metrics: {
      confidenceRatio,
      confidenceZscore: 0,
      volatilityRealized: 0,
      volatilityExpected: 0,
      dataFreshnessSeconds: Math.max(0, (snapshotNow / 1000) - feed.price.publishTime),
      avgConfidenceRatio1h: confidenceRatio,
      avgConfidenceRatio24h: confidenceRatio,
      priceChange1h: 0,
      priceChange24h: 0,
      updateFrequency1m: 1,
      dataQualityScore: 100,
    },
    rollingWindows: { '1m': [], '5m': [], '15m': [], '1h': [] },
    snapshotHash: 'demo',
    createdAt: snapshotNow,
  };

  const decision = engine.evaluate(snapshot as any);

  // Sign decision hash (32 bytes) for on-chain Ed25519 verification
  const signer = getSigningEngine();

  if (!b64) {
  throw new Error('Missing CATE_TRUSTED_SIGNER_SECRET_B64 in .env');
  }
  const signer = new SigningEngine(`b64:${b64}`);

  const signed = signer.sign(
    asset.id,
    px,
    conf,
    decision.riskScore,
    decision.action,
    decision.sizeMultiplier,
    decision.explanation
  );

  const decisionHashBytes = bs58.decode(signed.decisionHash);
  const signatureBytes = bs58.decode(signed.signature);
  const signerPubkeyBytes = bs58.decode(signed.signerPublicKey);

  const confidenceBps = new anchor.BN(Math.floor(confidenceRatio * 100));
  const publisherCount = 5; // demo placeholder

  const [configPDA] = getConfigPDA(programId);
  const [assetRiskPDA] = getAssetRiskPDA(programId, asset.id);

  // Ensure config exists (initialize if missing)
  const cfgInfo = await connection.getAccountInfo(configPDA);
  if (!cfgInfo) {
    console.log('[CATE on-chain demo] Config not found. Initializing...');
    const initSig = await (program.methods as any)
      .initializeConfig(new PublicKey(signed.signerPublicKey))
      .accounts({
        config: configPDA,
        authority: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`[CATE on-chain demo] Config initialized: ${initSig}`);
  }

  // Build tx: Ed25519 verify (pre-instruction) + update_risk_status
  const ed25519Ix = anchor.web3.Ed25519Program.createInstructionWithPublicKey({
    publicKey: signerPubkeyBytes,
    message: decisionHashBytes,
    signature: signatureBytes,
  });

  const ix = await (program.methods as any)
    .updateRiskStatus(
      asset.id,
      Math.floor(decision.riskScore),
      decision.action === 'BLOCK',
      confidenceBps,
      publisherCount,
      Array.from(decisionHashBytes),
      Array.from(signatureBytes),
      Array.from(signerPubkeyBytes)
    )
    .accounts({
      config: configPDA,
      assetRiskStatus: assetRiskPDA,
      authority: wallet.publicKey,
      instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(ed25519Ix).add(ix);
  const sig = await provider.sendAndConfirm(tx, [keypair]);

  console.log(`\n[CATE on-chain demo] Published decision for ${asset.id}`);
  console.log(`[CATE on-chain demo] tx: ${sig}`);
}

main().catch((err) => {
  console.error('\n[CATE on-chain demo] FAILED');
  console.error(err);
  process.exit(1);
});

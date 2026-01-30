import 'dotenv/config';

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

import { HermesClient } from '@pythnetwork/hermes-client';
import { SUPPORTED_ASSETS } from '../src/lib/oracleIngestion';
import { RiskEngine, DEFAULT_RISK_PARAMETERS } from '../src/lib/risk/engine';

// ============================================
// LOCAL SIGNING IMPLEMENTATION (replaces frontend signing.ts)
// ============================================

class LocalSigningEngine {
  private keypair: nacl.SignKeyPair;

  constructor(secretKeyBase64: string) {
    const secretKey = Buffer.from(secretKeyBase64, 'base64');
    this.keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
  }

  getPublicKey(): string {
    return bs58.encode(Buffer.from(this.keypair.publicKey));
  }

  sign(
    assetId: string,
    price: number,
    confidence: number,
    riskScore: number,
    action: string,
    sizeMultiplier: number,
    explanation: string
  ) {
    // Create decision hash (must match on-chain format)
    const decisionData = {
      assetId,
      price,
      confidence,
      riskScore,
      action,
      sizeMultiplier,
      explanation,
      timestamp: Date.now(),
    };

    const decisionHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(decisionData))
      .digest();

    // Sign with Ed25519
    const signature = nacl.sign.detached(decisionHash, this.keypair.secretKey);

    return {
      assetId,
      riskScore,
      isBlocked: action === 'BLOCK',
      confidenceRatio: confidence,
      publisherCount: 5, // demo placeholder
      timestamp: decisionData.timestamp,
      decisionHash: Array.from(decisionHash),
      signature: Array.from(signature),
      signerPublicKey: Array.from(this.keypair.publicKey),
      signerBase58: this.getPublicKey(),
    };
  }
}

// ============================================
// UTILS
// ============================================

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
  return PublicKey.findProgramAddressSync(
    [Buffer.from('asset_risk'), Buffer.from(assetId)],
    programId
  );
}

// ============================================
// MAIN
// ============================================

async function main() {
  const rpc = process.env.CATE_RPC_ENDPOINT || 'https://api.devnet.solana.com';
  const hermesEndpoint = process.env.CATE_HERMES_ENDPOINT || 'https://hermes.pyth.network';
  
  // Load signer's secret key from env (base64)
  const signerSecretB64 = process.env.CATE_TRUSTED_SIGNER_SECRET_B64;
  if (!signerSecretB64) {
    console.error('❌ Missing CATE_TRUSTED_SIGNER_SECRET_B64 in environment');
    process.exit(1);
  }

  const keypair = loadSolanaKeypair();
  const signer = new LocalSigningEngine(signerSecretB64);

  const idlPath = path.join('src', 'idl', 'workspaceIDL.json');
  const idl = readJson(idlPath);
  const programId = new PublicKey(idl.address);

  const connection = new Connection(rpc, 'confirmed');
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const program = new anchor.Program(idl, programId, provider);

  console.log(`\n[CATE on-chain demo] RPC: ${rpc}`);
  console.log(`[CATE on-chain demo] Program: ${programId.toBase58()}`);
  console.log(`[CATE on-chain demo] Authority: ${wallet.publicKey.toBase58()}`);
  console.log(`[CATE on-chain demo] Trusted Signer: ${signer.getPublicKey()}`);

  // Pick a default asset
  const asset = SUPPORTED_ASSETS.find((a: any) => a.active) || SUPPORTED_ASSETS[0];
  if (!asset) throw new Error('No supported assets configured');

  // Pull price from Hermes
  const hermes = new HermesClient(hermesEndpoint);
  const [feed] = await hermes.getLatestPriceFeeds([asset.pythFeedId]);
  if (!feed?.price) throw new Error('No price data returned from Hermes');

  const exp = feed.price.expo;
  const px = Number(feed.price.price) * Math.pow(10, exp);
  const conf = Number(feed.price.conf) * Math.pow(10, exp);

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

  console.log(`\n[ORACLE] ${asset.id} price: ${px.toFixed(2)}`);
  console.log(`[ORACLE] Confidence: ${confidenceRatio.toFixed(2)}%`);
  console.log(`[RISK] Score: ${decision.riskScore}, Action: ${decision.action}`);

  // Sign decision locally
  const signed = signer.sign(
    asset.id,
    px,
    conf,
    decision.riskScore,
    decision.action,
    decision.sizeMultiplier || 100,
    decision.explanation
  );

  console.log(`[SIGN] Decision hash: ${bs58.encode(Buffer.from(signed.decisionHash))}`);
  console.log(`[SIGN] Signature: ${bs58.encode(Buffer.from(signed.signature))}`);

  const decisionHashBytes = Buffer.from(signed.decisionHash);
  const signatureBytes = Buffer.from(signed.signature);
  const signerPubkeyBytes = Buffer.from(signed.signerPublicKey);

  const confidenceBps = new anchor.BN(Math.floor(confidenceRatio * 100));
  const publisherCount = 5;

  const [configPDA] = getConfigPDA(programId);
  const [assetRiskPDA] = getAssetRiskPDA(programId, asset.id);

  // Ensure config exists (initialize if missing)
  const cfgInfo = await connection.getAccountInfo(configPDA);
  if (!cfgInfo) {
    console.log('[CATE on-chain demo] Config not found. Initializing...');
    const initSig = await (program.methods as any)
      .initializeConfig(new PublicKey(signerPubkeyBytes))
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
      Math.floor(Date.now() / 1000),
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

  console.log(`\n✅ [CATE on-chain demo] Success!`);
  console.log(`   Asset: ${asset.id}`);
  console.log(`   Action: ${decision.action}`);
  console.log(`   Tx: ${sig}`);
  console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((err) => {
  console.error('\n❌ [CATE on-chain demo] FAILED');
  console.error(err);
  process.exit(1);
});

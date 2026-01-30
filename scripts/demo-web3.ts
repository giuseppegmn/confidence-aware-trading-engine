import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { HermesClient } from '@pythnetwork/hermes-client';
import { SUPPORTED_ASSETS } from '../src/lib/oracleIngestion';
import { RiskEngine, DEFAULT_RISK_PARAMETERS } from '../src/lib/risk/engine';

const PROGRAM_ID = new PublicKey('2CVGjnZ2BRebSeDHdo3VZknm5jVjxZmWu9m95M14sTN3');
const ED25519_PROGRAM_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111');

// Discriminators (8 bytes cada)
const DISCRIMINATORS = {
  initializeConfig: Buffer.from([206, 120, 40, 245, 102, 123, 178, 26]),
  updateRiskStatus: Buffer.from([100, 13, 144, 17, 97, 22, 91, 35]),
};

class LocalSigningEngine {
  private keypair: nacl.SignKeyPair;

  constructor(secretKeyBase64: string) {
    const secretKey = Buffer.from(secretKeyBase64, 'base64');
    this.keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
  }

  getPublicKey(): string {
    return bs58.encode(Buffer.from(this.keypair.publicKey));
  }

  signDecision(assetId: string, price: number, confidence: number, riskScore: number, action: string) {
    const timestamp = Math.floor(Date.now() / 1000);
    const decisionData = {
      assetId,
      price: Math.floor(price * 1000000),
      confidence: Math.floor(confidence * 1000000),
      riskScore,
      action,
      timestamp,
    };

    const decisionHash = crypto.createHash('sha256')
      .update(JSON.stringify(decisionData))
      .digest();

    const signature = nacl.sign.detached(decisionHash, this.keypair.secretKey);

    return {
      decisionHash,
      signature,
      signerPubkey: Buffer.from(this.keypair.publicKey),
      timestamp,
    };
  }
}

function loadSolanaKeypair(): Keypair {
  const defaultPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  const secret = JSON.parse(fs.readFileSync(process.env.CATE_SOLANA_KEYPAIR || defaultPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function getConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
}

function getAssetRiskPDA(assetId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('asset_risk'), Buffer.from(assetId)],
    PROGRAM_ID
  );
}

function getUsedDecisionsPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('used_decisions')], PROGRAM_ID);
}

async function main() {
  const rpc = process.env.CATE_RPC_ENDPOINT || 'https://api.devnet.solana.com';
  const hermesEndpoint = process.env.CATE_HERMES_ENDPOINT || 'https://hermes.pyth.network';
  
  const signerSecretB64 = process.env.CATE_TRUSTED_SIGNER_SECRET_B64;
  if (!signerSecretB64) {
    console.error('❌ Missing CATE_TRUSTED_SIGNER_SECRET_B64');
    process.exit(1);
  }

  const wallet = loadSolanaKeypair();
  const signer = new LocalSigningEngine(signerSecretB64);
  const connection = new Connection(rpc, 'confirmed');

  console.log(`\n[CATE Web3 Demo] RPC: ${rpc}`);
  console.log(`[CATE Web3 Demo] Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`[CATE Web3 Demo] Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`[CATE Web3 Demo] Trusted Signer: ${signer.getPublicKey()}`);

  // Get price from Pyth
  const asset = (SUPPORTED_ASSETS as any[]).find((a: any) => a.active) || (SUPPORTED_ASSETS as any[])[0];
  if (!asset) throw new Error('No supported assets');

  console.log(`\n[ORACLE] Fetching price for ${asset.id}...`);
  
  const hermes = new HermesClient(hermesEndpoint);
  const feedIdHex = '0x' + Buffer.from(bs58.decode(asset.pythFeedId)).toString('hex'); const feed = await hermes.getLatestPriceUpdates([feedIdHex]);
  if (!feed?.parsed?.[0]?.price) throw new Error('No price data from Hermes');

  const priceData = feed.parsed[0].price; const exp = priceData.expo;
  const px = Number(priceData.price) * Math.pow(10, exp);
  const conf = Number(priceData.conf) * Math.pow(10, exp);
  const confidenceRatio = px === 0 ? 999 : (conf / Math.abs(px)) * 100;

  console.log(`[ORACLE] Price: $${px.toFixed(2)}`);
  console.log(`[ORACLE] Confidence: ${confidenceRatio.toFixed(2)}%`);

  // Risk engine
  const engine = new RiskEngine(DEFAULT_RISK_PARAMETERS);
  const snapshot = {
    price: {
      assetId: asset.id,
      feedId: asset.pythFeedId,
      price: px,
      confidence: conf,
      timestamp: Date.now(),
      publishTime: priceData.publishTime || Math.floor(Date.now() / 1000),
      emaPrice: px,
      emaConfidence: conf,
      exponent: -8,
      source: 'PYTH_HERMES',
      sequence: 1,
    },
    metrics: {
      confidenceRatio,
      confidenceZscore: 0,
      volatilityRealized: 0,
      volatilityExpected: 0,
      dataFreshnessSeconds: 0,
      avgConfidenceRatio1h: confidenceRatio,
      avgConfidenceRatio24h: confidenceRatio,
      priceChange1h: 0,
      priceChange24h: 0,
      updateFrequency1m: 1,
      dataQualityScore: 100,
    },
    rollingWindows: { '1m': [], '5m': [], '15m': [], '1h': [] },
    snapshotHash: 'demo',
    createdAt: Date.now(),
  };

  const decision = engine.evaluate(snapshot as any);
  console.log(`[RISK] Score: ${decision.riskScore}, Action: ${decision.action}`);

  // Sign decision
  const signed = signer.signDecision(asset.id, px, conf, decision.riskScore, decision.action);
  console.log(`[SIGN] Hash: ${bs58.encode(signed.decisionHash)}`);
  console.log(`[SIGN] Signature: ${bs58.encode(signed.signature)}`);

  // Get PDAs
  const [configPDA] = getConfigPDA();
  const [assetRiskPDA] = getAssetRiskPDA(asset.id);
  const [usedDecisionsPDA] = getUsedDecisionsPDA();

  console.log(`\n[PDA] Config: ${configPDA.toBase58()}`);
  console.log(`[PDA] AssetRisk: ${assetRiskPDA.toBase58()}`);
  console.log(`[PDA] UsedDecisions: ${usedDecisionsPDA.toBase58()}`);

  // Check if config exists
  const configInfo = await connection.getAccountInfo(configPDA);
  
  if (!configInfo) {
    console.log(`\n[TX] Initializing config...`);
    
    // Initialize Config Instruction
    // data: discriminator + trusted_signer_pubkey (32 bytes)
    const initData = Buffer.concat([
      DISCRIMINATORS.initializeConfig,
      signed.signerPubkey,
    ]);

    const initIx = new TransactionInstruction({
      keys: [
        { pubkey: configPDA, isSigner: false, isWritable: true },
        { pubkey: usedDecisionsPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: initData,
    });

    const initTx = new Transaction().add(initIx);
    const initSig = await sendAndConfirmTransaction(connection, initTx, [wallet]);
    console.log(`[TX] Config initialized: ${initSig}`);
    console.log(`[TX] Explorer: https://explorer.solana.com/tx/${initSig}?cluster=devnet`);
  } else {
    console.log(`\n[TX] Config already initialized ✅`);
  }

  // Build Ed25519 verification instruction
  // Layout: num_signatures(1) + padding(1) + signature_offset(2) + signature_ix_idx(2) + 
  //         public_key_offset(2) + public_key_ix_idx(2) + message_offset(2) + message_size(2) + 
  //         message_ix_idx(2) + signature(64) + public_key(32) + message(32)
  const ed25519Data = Buffer.alloc(2 + 14 + 64 + 32 + 32);
  ed25519Data.writeUInt8(1, 0); // num_signatures
  ed25519Data.writeUInt8(0, 1); // padding
  ed25519Data.writeUInt16LE(14, 2); // signature_offset
  ed25519Data.writeUInt16LE(0, 4); // signature_instruction_index (0 = this instruction)
  ed25519Data.writeUInt16LE(78, 6); // public_key_offset (14 + 64)
  ed25519Data.writeUInt16LE(0, 8); // public_key_instruction_index
  ed25519Data.writeUInt16LE(110, 10); // message_data_offset (14 + 64 + 32)
  ed25519Data.writeUInt16LE(32, 12); // message_data_size
  ed25519Data.writeUInt16LE(0, 14); // message_instruction_index
  
  signed.signature.copy(ed25519Data, 14);
  signed.signerPubkey.copy(ed25519Data, 78);
  signed.decisionHash.copy(ed25519Data, 110);

  const ed25519Ix = new TransactionInstruction({
    keys: [],
    programId: ED25519_PROGRAM_ID,
    data: ed25519Data,
  });

  // Build Update Risk Status instruction
  // Args: asset_id (string), risk_score (u8), is_blocked (bool), confidence_ratio (u64), 
  //       publisher_count (u8), timestamp (i64), decision_hash ([u8;32]), 
  //       signature ([u8;64]), signer_pubkey ([u8;32])
  
  const assetIdBytes = Buffer.from(asset.id);
  const assetIdLen = Buffer.alloc(4);
  assetIdLen.writeUInt32LE(assetIdBytes.length, 0);

  const updateData = Buffer.concat([
    DISCRIMINATORS.updateRiskStatus,
    assetIdLen,
    assetIdBytes,
    Buffer.from([decision.riskScore]),
    Buffer.from([decision.action === 'BLOCK' ? 1 : 0]),
    Buffer.from(new BigUint64Array([BigInt(Math.floor(confidenceRatio * 100))]).buffer),
    Buffer.from([5]), // publisher_count
    Buffer.from(new BigInt64Array([BigInt(signed.timestamp)]).buffer),
    signed.decisionHash,
    signed.signature,
    signed.signerPubkey,
  ]);

  const updateIx = new TransactionInstruction({
    keys: [
      { pubkey: configPDA, isSigner: false, isWritable: false },
      { pubkey: usedDecisionsPDA, isSigner: false, isWritable: true },
      { pubkey: assetRiskPDA, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: updateData,
  });

  console.log(`\n[TX] Sending update_risk_status transaction...`);
  
  const tx = new Transaction().add(ed25519Ix).add(updateIx);
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);

  console.log(`\n✅ [CATE Web3 Demo] SUCCESS!`);
  console.log(`   Asset: ${asset.id}`);
  console.log(`   Action: ${decision.action}`);
  console.log(`   Risk Score: ${decision.riskScore}`);
  console.log(`   Tx: ${sig}`);
  console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((err) => {
  console.error('\n❌ [CATE Web3 Demo] FAILED');
  console.error(err);
  process.exit(1);
});

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

const PROGRAM_ID = new PublicKey('2CVGjnZ2BRebSeDHdo3VZknm5jVjxZmWu9m95M14sTN3');

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
    const decisionHash = crypto.createHash('sha256')
      .update(JSON.stringify({ assetId, price, confidence, riskScore, action, timestamp }))
      .digest();
    
    const signature = nacl.sign.detached(decisionHash, this.keypair.secretKey);

    return { decisionHash, signature, signerPubkey: Buffer.from(this.keypair.publicKey), timestamp };
  }
}

function loadSolanaKeypair(): Keypair {
  const defaultPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  const secret = JSON.parse(fs.readFileSync(process.env.CATE_SOLANA_KEYPAIR || defaultPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const rpc = process.env.CATE_RPC_ENDPOINT || 'https://api.devnet.solana.com';
  const signerSecretB64 = process.env.CATE_TRUSTED_SIGNER_SECRET_B64;
  
  if (!signerSecretB64) {
    console.error('❌ Missing CATE_TRUSTED_SIGNER_SECRET_B64');
    process.exit(1);
  }

  const wallet = loadSolanaKeypair();
  const signer = new LocalSigningEngine(signerSecretB64);
  const connection = new Connection(rpc, 'confirmed');

  console.log(`\n[CATE Web3 Demo] Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`[CATE Web3 Demo] Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`[CATE Web3 Demo] Trusted Signer: ${signer.getPublicKey()}`);

  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo) {
    console.error('❌ Program not found on devnet!');
    process.exit(1);
  }
  console.log(`[CATE Web3 Demo] Program exists! ✅`);

  const signed = signer.signDecision('BTCUSD', 50000, 100, 25, 'ALLOW');
  console.log(`[SIGN] Decision hash: ${bs58.encode(signed.decisionHash)}`);
  console.log(`[SIGN] Signature: ${bs58.encode(signed.signature)}`);
  console.log(`\n✅ Web3 demo completed successfully!`);
}

main().catch((err) => {
  console.error('\n❌ [CATE Web3 Demo] FAILED');
  console.error(err);
  process.exit(1);
});

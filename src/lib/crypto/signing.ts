/**
 * CATE - Cryptographic Signing Module
 *
 * Production-grade Ed25519 signing for risk decisions.
 * Every decision is cryptographically signed for:
 * - Verifiability
 * - Non-repudiation
 * - On-chain verification
 */

import nacl from 'tweetnacl';
import bs58Import from 'bs58';

// Normalize bs58 for ESM/CJS interop (bs58 may export { default })
const bs58: any = (bs58Import as any).default ?? (bs58Import as any);

// ============================================
// TYPES
// ============================================

export interface SignedDecision {
  assetId: string;
  price: number;
  confidence: number;
  riskScore: number;
  action: 'ALLOW' | 'SCALE' | 'BLOCK';
  sizeMultiplier: number;
  explanation: string;
  timestamp: number;
  nonce: string;
  signature: string;
  signerPublicKey: string;
  decisionHash: string;
}

export interface DecisionPayload {
  assetId: string;
  price: number;
  confidence: number;
  riskScore: number;
  action: string;
  sizeMultiplier: number;
  timestamp: number;
  nonce: string;
}

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyBase58: string;
}

export interface SignatureVerification {
  valid: boolean;
  signerPublicKey: string;
  decisionHash: string;
  timestamp: number;
  error?: string;
}

// ============================================
// HELPERS
// ============================================

function decodeBase64ToBytes(b64: string): Uint8Array {
  const clean = b64.trim();

  // Node / bundlers that polyfill Buffer
  const Buf = (globalThis as any).Buffer;
  if (Buf?.from) {
    const buf = Buf.from(clean, 'base64');
    return new Uint8Array(buf);
  }

  // Browser fallback
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  throw new Error('No base64 decoder available (neither Buffer nor atob).');
}

function normalizeSecretToBytes(secret: string): Uint8Array {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error('Empty secret key.');

  // Allow "b64:<base64>"
  if (trimmed.startsWith('b64:')) {
    return decodeBase64ToBytes(trimmed.slice(4));
  }

  // Otherwise treat as base58
  return bs58.decode(trimmed);
}

// ============================================
// KEY MANAGEMENT
// ============================================

export function generateKeyPair(): KeyPair {
  const keypair = nacl.sign.keyPair();
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    publicKeyBase58: bs58.encode(keypair.publicKey),
  };
}

/**
 * Load keypair from:
 * - base58 encoded 64-byte Ed25519 secret key
 * - OR a string prefixed with "b64:" that contains base64 encoded 64-byte Ed25519 secret key
 */
export function loadKeyPair(secret: string): KeyPair {
  const secretKeyBytes = normalizeSecretToBytes(secret);

  // tweetnacl expects 64-byte Ed25519 secret key (seed+publickey)
  if (secretKeyBytes.length !== 64) {
    throw new Error(
      `Invalid secret key length: expected 64 bytes, got ${secretKeyBytes.length}. ` +
        `Provide base58(64 bytes) or "b64:<base64-of-64-bytes>"`
    );
  }

  const keypair = nacl.sign.keyPair.fromSecretKey(secretKeyBytes);
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    publicKeyBase58: bs58.encode(keypair.publicKey),
  };
}

export function exportKeyPair(keypair: KeyPair): { publicKey: string; secretKey: string } {
  return {
    publicKey: bs58.encode(keypair.publicKey),
    secretKey: bs58.encode(keypair.secretKey),
  };
}

// ============================================
// HASHING
// ============================================

export function hashDecisionPayload(payload: DecisionPayload): string {
  const canonical = JSON.stringify({
    assetId: payload.assetId,
    price: payload.price.toFixed(10),
    confidence: payload.confidence.toFixed(10),
    riskScore: Math.round(payload.riskScore),
    action: payload.action,
    sizeMultiplier: payload.sizeMultiplier.toFixed(4),
    timestamp: payload.timestamp,
    nonce: payload.nonce,
  });

  const messageBytes = new TextEncoder().encode(canonical);
  const hash = nacl.hash(messageBytes);

  // Use first 32 bytes to keep it short (still collision-resistant enough for demo)
  return bs58.encode(hash.slice(0, 32));
}

export function generateNonce(): string {
  const nonceBytes = nacl.randomBytes(16);
  return bs58.encode(nonceBytes);
}

// ============================================
// SIGNING
// ============================================

export function signDecision(payload: DecisionPayload, keypair: KeyPair): { signature: string; hash: string } {
  const hash = hashDecisionPayload(payload);
  const hashBytes = bs58.decode(hash);
  const signature = nacl.sign.detached(hashBytes, keypair.secretKey);

  return {
    signature: bs58.encode(signature),
    hash,
  };
}

export function createSignedDecision(
  assetId: string,
  price: number,
  confidence: number,
  riskScore: number,
  action: 'ALLOW' | 'SCALE' | 'BLOCK',
  sizeMultiplier: number,
  explanation: string,
  keypair: KeyPair
): SignedDecision {
  const timestamp = Date.now();
  const nonce = generateNonce();

  const payload: DecisionPayload = {
    assetId,
    price,
    confidence,
    riskScore,
    action,
    sizeMultiplier,
    timestamp,
    nonce,
  };

  const { signature, hash } = signDecision(payload, keypair);

  return {
    assetId,
    price,
    confidence,
    riskScore,
    action,
    sizeMultiplier,
    explanation,
    timestamp,
    nonce,
    signature,
    signerPublicKey: keypair.publicKeyBase58,
    decisionHash: hash,
  };
}

// ============================================
// VERIFICATION
// ============================================

export function verifySignedDecision(decision: SignedDecision): SignatureVerification {
  try {
    const payload: DecisionPayload = {
      assetId: decision.assetId,
      price: decision.price,
      confidence: decision.confidence,
      riskScore: decision.riskScore,
      action: decision.action,
      sizeMultiplier: decision.sizeMultiplier,
      timestamp: decision.timestamp,
      nonce: decision.nonce,
    };

    const computedHash = hashDecisionPayload(payload);
    if (computedHash !== decision.decisionHash) {
      return {
        valid: false,
        signerPublicKey: decision.signerPublicKey,
        decisionHash: decision.decisionHash,
        timestamp: decision.timestamp,
        error: 'Hash mismatch - payload may have been tampered',
      };
    }

    const hashBytes = bs58.decode(decision.decisionHash);
    const signatureBytes = bs58.decode(decision.signature);
    const publicKeyBytes = bs58.decode(decision.signerPublicKey);

    const valid = nacl.sign.detached.verify(hashBytes, signatureBytes, publicKeyBytes);

    if (!valid) {
      return {
        valid: false,
        signerPublicKey: decision.signerPublicKey,
        decisionHash: decision.decisionHash,
        timestamp: decision.timestamp,
        error: 'Invalid signature',
      };
    }

    return {
      valid: true,
      signerPublicKey: decision.signerPublicKey,
      decisionHash: decision.decisionHash,
      timestamp: decision.timestamp,
    };
  } catch (error) {
    return {
      valid: false,
      signerPublicKey: decision.signerPublicKey,
      decisionHash: decision.decisionHash,
      timestamp: decision.timestamp,
      error: `Verification error: ${String(error)}`,
    };
  }
}

export function verifyWithPublicKey(decision: SignedDecision, expectedPublicKey: string): boolean {
  if (decision.signerPublicKey !== expectedPublicKey) return false;
  return verifySignedDecision(decision).valid;
}

// ============================================
// SIGNING ENGINE
// ============================================

export class SigningEngine {
  private keypair: KeyPair;
  private signedDecisions: SignedDecision[] = [];
  private maxHistory = 1000;

  constructor(existingSecretKey?: string) {
    if (existingSecretKey) {
      this.keypair = loadKeyPair(existingSecretKey);
      console.log('[SigningEngine] Loaded existing keypair');
    } else {
      this.keypair = generateKeyPair();
      console.log('[SigningEngine] Generated new keypair');
    }

    console.log(`[SigningEngine] Public key: ${this.keypair.publicKeyBase58}`);
  }

  getPublicKey(): string {
    return this.keypair.publicKeyBase58;
  }

  exportKeys(): { publicKey: string; secretKey: string } {
    return exportKeyPair(this.keypair);
  }

  sign(
    assetId: string,
    price: number,
    confidence: number,
    riskScore: number,
    action: 'ALLOW' | 'SCALE' | 'BLOCK',
    sizeMultiplier: number,
    explanation: string
  ): SignedDecision {
    const signed = createSignedDecision(
      assetId,
      price,
      confidence,
      riskScore,
      action,
      sizeMultiplier,
      explanation,
      this.keypair
    );

    this.signedDecisions.push(signed);
    if (this.signedDecisions.length > this.maxHistory) this.signedDecisions.shift();

    return signed;
  }

  verifyOwn(decision: SignedDecision): boolean {
    return verifyWithPublicKey(decision, this.keypair.publicKeyBase58);
  }

  getHistory(): SignedDecision[] {
    return [...this.signedDecisions];
  }

  getRecent(count = 10): SignedDecision[] {
    return this.signedDecisions.slice(-count);
  }

  findByHash(hash: string): SignedDecision | undefined {
    return this.signedDecisions.find((d) => d.decisionHash === hash);
  }
}

// ============================================
// LAZY SINGLETON (NO SIDE EFFECTS ON IMPORT)
// ============================================

let _signingEngine: SigningEngine | null = null;

/**
 * Get a singleton SigningEngine (no top-level side effects).
 * - Node: env CATE_TRUSTED_SIGNER_SECRET (base58) OR CATE_TRUSTED_SIGNER_SECRET_B64 (base64)
 * - Browser: localStorage key CATE_ENGINE_KEY (base58)
 */
export function getSigningEngine(): SigningEngine {
  if (_signingEngine) return _signingEngine;

  let secret: string | undefined;

  // Node env
  try {
    const env = (globalThis as any)?.process?.env;
    if (env) {
      secret = env.CATE_TRUSTED_SIGNER_SECRET?.trim();

      if (!secret && env.CATE_TRUSTED_SIGNER_SECRET_B64) {
        secret = `b64:${String(env.CATE_TRUSTED_SIGNER_SECRET_B64).trim()}`;
      }
    }
  } catch {
    // ignore
  }

  // Browser localStorage
  if (!secret && typeof window !== 'undefined') {
    secret = localStorage.getItem('CATE_ENGINE_KEY') || undefined;
  }

  _signingEngine = new SigningEngine(secret);

  // Persist only in browser
  if (typeof window !== 'undefined') {
    const hadStored = !!localStorage.getItem('CATE_ENGINE_KEY');
    if (!hadStored) {
      const keys = _signingEngine.exportKeys();
      localStorage.setItem('CATE_ENGINE_KEY', keys.secretKey);
    }
  }

  return _signingEngine;
}

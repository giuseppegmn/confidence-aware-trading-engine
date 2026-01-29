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
import bs58 from 'bs58';

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

export function loadKeyPair(secretKeyBase58: string): KeyPair {
  const secretKey = bs58.decode(secretKeyBase58);

  // tweetnacl expects 64-byte Ed25519 secret key (seed+publickey)
  if (secretKey.length !== 64) {
    throw new Error(
      `Invalid secret key length: expected 64 bytes base58-encoded Ed25519 secret key, got ${secretKey.length}`
    );
  }

  const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
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
      error: `Verification error: ${error}`,
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
      // Keep logs minimal (demo prints enough)
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
 * Get a singleton SigningEngine.
 * - In browser: tries localStorage (CATE_ENGINE_KEY) for persistence.
 * - In node: tries process.env.CATE_TRUSTED_SIGNER_SECRET if present.
 */
export function getSigningEngine(): SigningEngine {
  if (_signingEngine) return _signingEngine;

  let secret: string | undefined;

  // Node env
  if (typeof process !== 'undefined' && (process as any).env) {
    secret = (process as any).env.CATE_TRUSTED_SIGNER_SECRET;
  }

  // Browser localStorage
  if (!secret && typeof window !== 'undefined') {
    secret = localStorage.getItem('CATE_ENGINE_KEY') || undefined;
  }

  _signingEngine = new SigningEngine(secret);

  // Persist only in browser and only if we didn't have a stored key
  if (typeof window !== 'undefined') {
    const hadStored = !!localStorage.getItem('CATE_ENGINE_KEY');
    if (!hadStored) {
      const keys = _signingEngine.exportKeys();
      localStorage.setItem('CATE_ENGINE_KEY', keys.secretKey);
    }
  }

  return _signingEngine;
}

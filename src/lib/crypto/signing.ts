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
  /** Asset identifier */
  assetId: string;
  
  /** Price at decision time */
  price: number;
  
  /** Confidence interval */
  confidence: number;
  
  /** Risk score (0-100) */
  riskScore: number;
  
  /** Action taken */
  action: 'ALLOW' | 'SCALE' | 'BLOCK';
  
  /** Size multiplier (0-1) */
  sizeMultiplier: number;
  
  /** Human-readable explanation */
  explanation: string;
  
  /** Decision timestamp (Unix ms) */
  timestamp: number;
  
  /** Nonce for uniqueness */
  nonce: string;
  
  /** Ed25519 signature (base58) */
  signature: string;
  
  /** Public key of signer (base58) */
  signerPublicKey: string;
  
  /** Hash of decision payload */
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

/**
 * Generate a new Ed25519 keypair for the CATE engine
 */
export function generateKeyPair(): KeyPair {
  const keypair = nacl.sign.keyPair();
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    publicKeyBase58: bs58.encode(keypair.publicKey),
  };
}

/**
 * Load keypair from base58 secret key
 */
export function loadKeyPair(secretKeyBase58: string): KeyPair {
  const secretKey = bs58.decode(secretKeyBase58);
  const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    publicKeyBase58: bs58.encode(keypair.publicKey),
  };
}

/**
 * Export keypair to base58 (for storage)
 */
export function exportKeyPair(keypair: KeyPair): { publicKey: string; secretKey: string } {
  return {
    publicKey: bs58.encode(keypair.publicKey),
    secretKey: bs58.encode(keypair.secretKey),
  };
}

// ============================================
// HASHING
// ============================================

/**
 * Create deterministic hash of decision payload
 * Uses SHA-512 via nacl for consistency
 */
export function hashDecisionPayload(payload: DecisionPayload): string {
  // Create canonical JSON representation
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
  
  // Hash using nacl
  const messageBytes = new TextEncoder().encode(canonical);
  const hash = nacl.hash(messageBytes);
  
  return bs58.encode(hash.slice(0, 32)); // Use first 32 bytes
}

/**
 * Generate cryptographically secure nonce
 */
export function generateNonce(): string {
  const nonceBytes = nacl.randomBytes(16);
  return bs58.encode(nonceBytes);
}

// ============================================
// SIGNING
// ============================================

/**
 * Sign a decision payload
 */
export function signDecision(
  payload: DecisionPayload,
  keypair: KeyPair
): { signature: string; hash: string } {
  // Create hash
  const hash = hashDecisionPayload(payload);
  const hashBytes = bs58.decode(hash);
  
  // Sign the hash
  const signature = nacl.sign.detached(hashBytes, keypair.secretKey);
  
  return {
    signature: bs58.encode(signature),
    hash,
  };
}

/**
 * Create a fully signed decision from risk decision data
 */
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

/**
 * Verify a signed decision
 */
export function verifySignedDecision(decision: SignedDecision): SignatureVerification {
  try {
    // Reconstruct payload
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
    
    // Verify hash matches
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
    
    // Verify signature
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

/**
 * Verify signature against specific public key
 */
export function verifyWithPublicKey(
  decision: SignedDecision,
  expectedPublicKey: string
): boolean {
  if (decision.signerPublicKey !== expectedPublicKey) {
    return false;
  }
  
  const verification = verifySignedDecision(decision);
  return verification.valid;
}

// ============================================
// SIGNING ENGINE
// ============================================

/**
 * Signing engine that manages keys and signs decisions
 */
export class SigningEngine {
  private keypair: KeyPair;
  private signedDecisions: SignedDecision[] = [];
  private maxHistory: number = 1000;
  
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
  
  /**
   * Get the public key for verification
   */
  getPublicKey(): string {
    return this.keypair.publicKeyBase58;
  }
  
  /**
   * Export keypair for backup
   */
  exportKeys(): { publicKey: string; secretKey: string } {
    return exportKeyPair(this.keypair);
  }
  
  /**
   * Sign a risk decision
   */
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
    
    // Store in history
    this.signedDecisions.push(signed);
    if (this.signedDecisions.length > this.maxHistory) {
      this.signedDecisions.shift();
    }
    
    return signed;
  }
  
  /**
   * Verify a decision was signed by this engine
   */
  verifyOwn(decision: SignedDecision): boolean {
    return verifyWithPublicKey(decision, this.keypair.publicKeyBase58);
  }
  
  /**
   * Get signing history
   */
  getHistory(): SignedDecision[] {
    return [...this.signedDecisions];
  }
  
  /**
   * Get recent signed decisions
   */
  getRecent(count: number = 10): SignedDecision[] {
    return this.signedDecisions.slice(-count);
  }
  
  /**
   * Find decision by hash
   */
  findByHash(hash: string): SignedDecision | undefined {
    return this.signedDecisions.find(d => d.decisionHash === hash);
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

// Check for stored key in localStorage (browser only)
let storedKey: string | undefined;
if (typeof window !== 'undefined') {
  storedKey = localStorage.getItem('CATE_ENGINE_KEY') || undefined;
}

export const signingEngine = new SigningEngine(storedKey);

// Store generated key for persistence
if (typeof window !== 'undefined' && !storedKey) {
  const keys = signingEngine.exportKeys();
  localStorage.setItem('CATE_ENGINE_KEY', keys.secretKey);
}

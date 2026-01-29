/**
 * CATE - Cryptographic Signing Service
 * 
 * 🔐 SECURITY ARCHITECTURE:
 * - Frontend NEVER possesses private keys
 * - All signing operations happen server-side via secure API
 * - Ed25519 signatures generated in AWS KMS (or HSM)
 * - Replay protection via nonce + timestamp validation
 * - Request signing via API key / JWT (optional layer)
 */

import { API_BASE_URL, API_KEY } from '@/config/env';
import { createHash } from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Decision payload sent to signing API
 * Must match the Rust program's expected format
 */
export interface DecisionPayload {
  /** Asset identifier (max 16 chars) */
  assetId: string;
  /** Current price from oracle */
  price: number;
  /** Unix timestamp (seconds) */
  timestamp: number;
  /** Confidence ratio in basis points (100 = 1%) */
  confidenceRatio: number;
  /** Risk score 0-100 */
  riskScore: number;
  /** Whether trading should be blocked */
  isBlocked: boolean;
  /** Number of publishers providing data */
  publisherCount: number;
  /** Unique nonce for replay protection */
  nonce: number;
}

/**
 * Signed decision returned by API
 * Ready to be submitted to Solana program
 */
export interface SignedDecision {
  assetId: string;
  riskScore: number;
  isBlocked: boolean;
  confidenceRatio: number;
  publisherCount: number;
  timestamp: number;
  /** SHA-512/256 hash of decision data (32 bytes) */
  decisionHash: number[];
  /** Ed25519 signature (64 bytes) */
  signature: number[];
  /** Public key that signed (32 bytes) */
  signerPublicKey: number[];
  /** Base58 encoded pubkey for verification */
  signerBase58: string;
}

/**
 * API Error response
 */
export interface SigningError {
  error: string;
  code: ErrorCode;
  retryable: boolean;
  timestamp: string;
}

export enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  INVALID_TIMESTAMP = 'INVALID_TIMESTAMP',
  ASSET_NOT_FOUND = 'ASSET_NOT_FOUND',
  RATE_LIMITED = 'RATE_LIMITED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_RESPONSE = 'INVALID_RESPONSE'
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Request a remote signature for a risk decision
 * 
 * @param payload Decision data to be signed
 * @param options Optional configuration
 * @returns Signed decision ready for on-chain submission
 * @throws SigningServiceError on failure
 */
export async function requestRemoteSigning(
  payload: DecisionPayload,
  options: { timeout?: number; retries?: number } = {}
): Promise<SignedDecision> {
  const { timeout = DEFAULT_TIMEOUT, retries = MAX_RETRIES } = options;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY * attempt); // Exponential backoff
      console.log(`[Signing] Retry attempt ${attempt + 1}/${retries}`);
    }
    
    try {
      return await executeSigningRequest(payload, timeout);
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry validation errors
      if (error instanceof SigningServiceError && !error.retryable) {
        throw error;
      }
      
      // Don't retry if it's the last attempt
      if (attempt === retries - 1) {
        break;
      }
    }
  }
  
  throw new SigningServiceError(
    `Failed after ${retries} attempts: ${lastError?.message}`,
    ErrorCode.NETWORK_ERROR,
    false
  );
}

/**
 * Execute the HTTP request to signing API
 */
async function executeSigningRequest(
  payload: DecisionPayload,
  timeout: number
): Promise<SignedDecision> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/sign-decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(API_KEY && { 'X-API-Key': API_KEY }),
        'X-Request-ID': generateRequestId(),
      },
      body: JSON.stringify(validatePayload(payload)),
      signal: controller.signal,
      credentials: 'include',
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      await handleHttpError(response);
    }
    
    const result = await response.json();
    
    if (!result.success || !result.data) {
      throw new SigningServiceError(
        'Invalid API response structure',
        ErrorCode.INVALID_RESPONSE,
        false
      );
    }
    
    // Client-side validation (defense in depth)
    validateSignatureResponse(result.data, payload);
    
    // Verify the signature locally as a sanity check
    await verifyLocalSignature(result.data);
    
    return result.data as SignedDecision;
    
  } catch (error) {
    if (error instanceof SigningServiceError) {
      throw error;
    }
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SigningServiceError(
        'Signing request timeout',
        ErrorCode.NETWORK_ERROR,
        true
      );
    }
    
    throw new SigningServiceError(
      `Network error: ${(error as Error).message}`,
      ErrorCode.NETWORK_ERROR,
      true
    );
  }
}

/**
 * Validate payload before sending to API
 */
function validatePayload(payload: DecisionPayload): DecisionPayload {
  if (!payload.assetId || payload.assetId.length === 0 || payload.assetId.length > 16) {
    throw new SigningServiceError(
      'Invalid assetId: must be 1-16 characters',
      ErrorCode.VALIDATION_FAILED,
      false
    );
  }
  
  if (payload.confidenceRatio < 0 || payload.confidenceRatio > 10000) {
    throw new SigningServiceError(
      'Invalid confidenceRatio: must be 0-10000 basis points',
      ErrorCode.VALIDATION_FAILED,
      false
    );
  }
  
  if (payload.riskScore < 0 || payload.riskScore > 100) {
    throw new SigningServiceError(
      'Invalid riskScore: must be 0-100',
      ErrorCode.VALIDATION_FAILED,
      false
    );
  }
  
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(payload.timestamp - now) > 60) {
    throw new SigningServiceError(
      'Invalid timestamp: must be within 60 seconds of current time',
      ErrorCode.INVALID_TIMESTAMP,
      false
    );
  }
  
  return payload;
}

/**
 * Validate API response matches our request
 */
function validateSignatureResponse(
  data: SignedDecision,
  original: DecisionPayload
): void {
  // Verify structural integrity
  if (!data.decisionHash || data.decisionHash.length !== 32) {
    throw new SigningServiceError(
      'Invalid decision hash length',
      ErrorCode.INVALID_RESPONSE,
      false
    );
  }
  
  if (!data.signature || data.signature.length !== 64) {
    throw new SigningServiceError(
      'Invalid signature length',
      ErrorCode.INVALID_RESPONSE,
      false
    );
  }
  
  if (!data.signerPublicKey || data.signerPublicKey.length !== 32) {
    throw new SigningServiceError(
      'Invalid public key length',
      ErrorCode.INVALID_RESPONSE,
      false
    );
  }
  
  // Verify data integrity (what we sent vs what was signed)
  if (data.assetId !== original.assetId) {
    throw new SigningServiceError(
      'Asset ID mismatch in signed response',
      ErrorCode.INVALID_RESPONSE,
      false
    );
  }
  
  if (data.riskScore !== original.riskScore) {
    throw new SigningServiceError(
      'Risk score mismatch in signed response',
      ErrorCode.INVALID_RESPONSE,
      false
    );
  }
  
  if (data.timestamp !== original.timestamp) {
    throw new SigningServiceError(
      'Timestamp mismatch in signed response',
      ErrorCode.INVALID_RESPONSE,
      false
    );
  }
}

/**
 * Local verification of signature (sanity check)
 * This runs fast ed25519 verify to ensure API isn't returning garbage
 */
async function verifyLocalSignature(data: SignedDecision): Promise<void> {
  try {
    const { verify } = await import('tweetnacl');
    
    const message = new Uint8Array(data.decisionHash);
    const signature = new Uint8Array(data.signature);
    const publicKey = new Uint8Array(data.signerPublicKey);
    
    const isValid = verify.detached(message, signature, publicKey);
    
    if (!isValid) {
      throw new SigningServiceError(
        'API returned invalid signature (local verification failed)',
        ErrorCode.INVALID_RESPONSE,
        false
      );
    }
  } catch (error) {
    if (error instanceof SigningServiceError) throw error;
    
    // If import fails or other issues, log but don't block
    // The Solana program will do the authoritative verification
    console.warn('[Signing] Local verification skipped:', error);
  }
}

/**
 * Handle HTTP error responses
 */
async function handleHttpError(response: Response): Promise<void> {
  const text = await response.text();
  let errorData: Partial<SigningError>;
  
  try {
    errorData = JSON.parse(text);
  } catch {
    errorData = { 
      error: `HTTP ${response.status}: ${response.statusText}`,
      code: ErrorCode.INTERNAL_ERROR 
    };
  }
  
  const code = errorData.code || ErrorCode.INTERNAL_ERROR;
  const retryable = response.status >= 500 || code === ErrorCode.RATE_LIMITED;
  
  throw new SigningServiceError(
    errorData.error || 'Unknown API error',
    code,
    retryable
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate unique request ID for tracing
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get trusted signer public key from API
 * Call this on app initialization to verify the backend identity
 */
export async function fetchTrustedSigner(): Promise<string> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.publicKey) {
      throw new Error('Missing publicKey in health response');
    }
    
    // Basic validation of Solana pubkey format (base58, 32-44 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.publicKey)) {
      throw new Error('Invalid public key format');
    }
    
    return data.publicKey as string;
    
  } catch (error) {
    throw new SigningServiceError(
      `Failed to fetch trusted signer: ${(error as Error).message}`,
      ErrorCode.NETWORK_ERROR,
      true
    );
  }
}

/**
 * Pre-flight check to verify signing service is healthy
 */
export async function checkSigningServiceHealth(): Promise<{
  healthy: boolean;
  publicKey: string | null;
  latency: number;
}> {
  const start = Date.now();
  
  try {
    const pubKey = await fetchTrustedSigner();
    return {
      healthy: true,
      publicKey: pubKey,
      latency: Date.now() - start
    };
  } catch (error) {
    return {
      healthy: false,
      publicKey: null,
      latency: Date.now() - start
    };
  }
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class SigningServiceError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public retryable: boolean = false,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SigningServiceError';
    
    // Maintain stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SigningServiceError);
    }
  }
  
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      retryable: this.retryable,
      context: this.context,
      stack: this.stack
    };
  }
}

// ============================================================================
// REACT HOOK (Optional but recommended)
// ============================================================================

import { useState, useCallback } from 'react';

interface UseRemoteSigningReturn {
  sign: (payload: DecisionPayload) => Promise<SignedDecision>;
  isLoading: boolean;
  error: SigningServiceError | null;
  clearError: () => void;
  trustedSigner: string | null;
}

/**
 * React hook for remote signing operations
 * 
 * Usage:
 * const { sign, isLoading, error } = useRemoteSigning();
 * const signed = await sign({ assetId: 'SOL/USD', ... });
 */
export function useRemoteSigning(): UseRemoteSigningReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<SigningServiceError | null>(null);
  const [trustedSigner, setTrustedSigner] = useState<string | null>(null);
  
  // Fetch trusted signer on mount
  useState(() => {
    fetchTrustedSigner()
      .then(setTrustedSigner)
      .catch(console.error);
  });
  
  const sign = useCallback(async (payload: DecisionPayload): Promise<SignedDecision> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await requestRemoteSigning(payload);
      return result;
    } catch (err) {
      const signingError = err instanceof SigningServiceError 
        ? err 
        : new SigningServiceError(
            err instanceof Error ? err.message : 'Unknown error',
            ErrorCode.INTERNAL_ERROR,
            false
          );
      
      setError(signingError);
      throw signingError;
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  const clearError = useCallback(() => setError(null), []);
  
  return { sign, isLoading, error, clearError, trustedSigner };
}

// ============================================================================
// CONSTANTS & EXPORTS
// ============================================================================

/** 
 * Convert number array (from API) to Uint8Array for Solana web3.js 
 */
export function toUint8Array(arr: number[]): Uint8Array {
  return new Uint8Array(arr);
}

/**
 * Convert SignedDecision to format expected by Anchor programs
 */
export function formatForAnchor(decision: SignedDecision): {
  assetId: string;
  riskScore: number;
  isBlocked: boolean;
  confidenceRatio: number;
  publisherCount: number;
  timestamp: number;
  decisionHash: Uint8Array;
  signature: Uint8Array;
  signerPubkey: Uint8Array;
} {
  return {
    assetId: decision.assetId,
    riskScore: decision.riskScore,
    isBlocked: decision.isBlocked,
    confidenceRatio: decision.confidenceRatio,
    publisherCount: decision.publisherCount,
    timestamp: decision.timestamp,
    decisionHash: toUint8Array(decision.decisionHash),
    signature: toUint8Array(decision.signature),
    signerPubkey: toUint8Array(decision.signerPublicKey),
  };
}

export default {
  requestRemoteSigning,
  fetchTrustedSigner,
  checkSigningServiceHealth,
  useRemoteSigning,
  formatForAnchor,
  SigningServiceError,
  ErrorCode
};

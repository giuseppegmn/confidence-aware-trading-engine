import { API_BASE_URL, API_KEY } from '@/config/env';

export interface DecisionPayload {
  assetId: string;
  price: number;
  timestamp: number;
  confidenceRatio: number;
  riskScore: number;
  isBlocked: boolean;
  publisherCount: number;
  nonce: number;
}

export interface SignedDecision {
  assetId: string;
  riskScore: number;
  isBlocked: boolean;
  confidenceRatio: number;
  publisherCount: number;
  timestamp: number;
  decisionHash: number[];
  signature: number[];
  signerPublicKey: number[];
  signerBase58: string;
}

export class SigningServiceError extends Error {
  constructor(public code: string, public retryable: boolean = false) {
    super(code);
    this.name = 'SigningServiceError';
  }
}

export async function requestRemoteSigning(payload: DecisionPayload): Promise<SignedDecision> {
  try {
    const url = API_BASE_URL + "/api/v1/sign-decision";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new SigningServiceError(error.code || "UNKNOWN", false);
    }

    const result = await response.json();
    if (!result.success || !result.data) {
      throw new SigningServiceError("INVALID_RESPONSE", false);
    }
    return result.data as SignedDecision;
  } catch (error) {
    if (error instanceof SigningServiceError) throw error;
    throw new SigningServiceError("NETWORK_ERROR", true);
  }
}

export async function fetchTrustedSigner(): Promise<string> {
  const url = API_BASE_URL + "/health";
  const response = await fetch(url);
  const data = await response.json();
  return data.publicKey;
}

export function getSigningEngine() {
  return {
    getPublicKey: fetchTrustedSigner,
    sign: requestRemoteSigning
  };
}

export function toUint8Array(arr: number[]): Uint8Array {
  return new Uint8Array(arr);
}

export function formatForAnchor(decision: SignedDecision) {
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

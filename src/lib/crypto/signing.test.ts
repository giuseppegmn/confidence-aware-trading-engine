import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateKeyPair,
  hashDecisionPayload,
  signDecision,
  verifySignedDecision,
  createSignedDecision,
} from './signing';

describe('crypto/signing', () => {
  beforeEach(() => {
    // Make tests deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-28T12:00:00Z'));
  });

  it('hashDecisionPayload is deterministic for same payload', () => {
    const payload = {
      assetId: 'SOL/USD',
      price: 100.123456,
      confidence: 0.25,
      riskScore: 42,
      action: 'ALLOW',
      sizeMultiplier: 1,
      timestamp: Date.now(),
      nonce: 'nonce',
    };

    const h1 = hashDecisionPayload(payload);
    const h2 = hashDecisionPayload(payload);
    expect(h1).toEqual(h2);
  });

  it('signDecision produces a signature that verifies', () => {
    const kp = generateKeyPair();
    const payload = {
      assetId: 'BTC/USD',
      price: 50000,
      confidence: 10,
      riskScore: 10,
      action: 'ALLOW',
      sizeMultiplier: 1,
      timestamp: Date.now(),
      nonce: 'nonce',
    };

    const { signature, hash } = signDecision(payload, kp);
    const signed = {
      ...payload,
      action: 'ALLOW' as const,
      sizeMultiplier: 1,
      explanation: 'ok',
      signature,
      signerPublicKey: kp.publicKeyBase58,
      decisionHash: hash,
    };

    const res = verifySignedDecision(signed);
    expect(res.valid).toBe(true);
  });

  it('verifySignedDecision rejects tampered payload', () => {
    const kp = generateKeyPair();
    const signed = createSignedDecision(
      'ETH/USD',
      2000,
      2,
      15,
      'ALLOW',
      1,
      'ok',
      kp
    );

    // Tamper
    const tampered = { ...signed, price: signed.price + 1 };
    const res = verifySignedDecision(tampered);
    expect(res.valid).toBe(false);
    expect(res.error?.toLowerCase()).toContain('hash mismatch');
  });
});

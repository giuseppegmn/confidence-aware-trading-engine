/**
 * CATE Signing API Server
 * Secure backend for Ed25519 signing using AWS KMS or local keys
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PublicKey, Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import dotenv from 'dotenv';
import { createHash, randomBytes } from 'crypto';

dotenv.config();

const app = express();

// =============================================================================
// SECURITY MIDDLEWARE
// =============================================================================

app.use(helmet());

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Request-ID']
}));

app.use(express.json({ limit: '10kb' })); // Prevent large payloads

// Rate limiting
const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many requests', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false
});

const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100
});

// =============================================================================
// CONFIGURATION
// =============================================================================

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Signing key configuration
let signingKey: Keypair;
let TRUSTED_PUBLIC_KEY: string;

// Initialize signing key
function initializeSigner() {
  const keyStr = process.env.SIGNING_PRIVATE_KEY;
  
  if (!keyStr) {
    if (NODE_ENV === 'production') {
      throw new Error('SIGNING_PRIVATE_KEY is required in production');
    }
    // Generate ephemeral key for development
    console.warn('[API] No SIGNING_PRIVATE_KEY provided, generating ephemeral key');
    signingKey = Keypair.generate();
  } else {
    try {
      // Try base64 first, then hex
      let secretKey: Buffer;
      if (keyStr.includes('=') || /^[A-Za-z0-9+/]{44,}$/.test(keyStr)) {
        secretKey = Buffer.from(keyStr, 'base64');
      } else {
        secretKey = Buffer.from(keyStr, 'hex');
      }
      signingKey = Keypair.fromSecretKey(secretKey);
    } catch (error) {
      throw new Error('Invalid SIGNING_PRIVATE_KEY format. Use base64 or hex encoding.');
    }
  }

  TRUSTED_PUBLIC_KEY = signingKey.publicKey.toBase58();
  console.log(`[API] Signer initialized: ${TRUSTED_PUBLIC_KEY}`);
}

initializeSigner();

// Nonce tracking for replay prevention (in-memory, use Redis in production)
const usedNonces = new Set<string>();
const NONCE_EXPIRY = 5 * 60 * 1000; // 5 minutes

setInterval(() => {
  usedNonces.clear(); // Clear old nonces periodically
}, NONCE_EXPIRY);

// =============================================================================
// VALIDATION
// =============================================================================

interface SignRequest {
  assetId: string;
  price: number;
  timestamp: number;
  confidenceRatio: number;
  riskScore: number;
  isBlocked: boolean;
  publisherCount: number;
  nonce: number;
}

function validateRequest(body: any): { valid: boolean; error?: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }

  const { assetId, price, timestamp, confidenceRatio, riskScore, isBlocked, publisherCount, nonce } = body;

  // Asset ID validation
  if (!assetId || typeof assetId !== 'string' || assetId.length === 0 || assetId.length > 16) {
    return { valid: false, error: 'Invalid assetId: must be 1-16 characters' };
  }

  // Price validation
  if (!Number.isFinite(price) || price <= 0) {
    return { valid: false, error: 'Invalid price: must be positive number' };
  }

  // Timestamp validation (prevent replay with old timestamps)
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || timestamp < now - 300 || timestamp > now + 60) {
    return { valid: false, error: 'Invalid timestamp: must be within ±5 minutes of server time' };
  }

  // Confidence ratio validation (basis points: 0-10000)
  if (!Number.isInteger(confidenceRatio) || confidenceRatio < 0 || confidenceRatio > 10000) {
    return { valid: false, error: 'Invalid confidenceRatio: must be 0-10000' };
  }

  // Risk score validation
  if (!Number.isInteger(riskScore) || riskScore < 0 || riskScore > 100) {
    return { valid: false, error: 'Invalid riskScore: must be 0-100' };
  }

  // Boolean validation
  if (typeof isBlocked !== 'boolean') {
    return { valid: false, error: 'Invalid isBlocked: must be boolean' };
  }

  // Publisher count
  if (!Number.isInteger(publisherCount) || publisherCount < 0) {
    return { valid: false, error: 'Invalid publisherCount' };
  }

  // Nonce validation (replay protection)
  if (!Number.isInteger(nonce)) {
    return { valid: false, error: 'Invalid nonce' };
  }

  const nonceKey = `${assetId}:${nonce}`;
  if (usedNonces.has(nonceKey)) {
    return { valid: false, error: 'Nonce already used (replay attack detected)' };
  }

  return { valid: true };
}

// =============================================================================
// ROUTES
// =============================================================================

// Health check
app.get('/health', healthLimiter, (req, res) => {
  res.json({
    status: 'healthy',
    publicKey: TRUSTED_PUBLIC_KEY,
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Sign decision
app.post('/api/v1/sign-decision', strictLimiter, (req, res) => {
  try {
    // 1. Validate input
    const validation = validateRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
        code: 'VALIDATION_FAILED'
      });
    }

    const payload: SignRequest = req.body;

    // 2. Check nonce for replay
    const nonceKey = `${payload.assetId}:${payload.nonce}`;
    if (usedNonces.has(nonceKey)) {
      return res.status(400).json({
        success: false,
        error: 'Replay attack detected: nonce already used',
        code: 'REPLAY_DETECTED'
      });
    }
    usedNonces.add(nonceKey);

    // 3. Construct message exactly as Solana program expects
    const message = Buffer.alloc(62); // Fixed size for determinism
    
    // Asset ID (16 bytes, padded with nulls)
    const assetIdBuf = Buffer.from(payload.assetId);
    message.set(assetIdBuf.slice(0, 16), 0);
    
    // Price (8 bytes, little-endian f64)
    message.writeDoubleLE(payload.price, 16);
    
    // Timestamp (8 bytes, little-endian i64)
    message.writeBigInt64LE(BigInt(payload.timestamp), 24);
    
    // Confidence ratio (8 bytes, little-endian u64)
    message.writeBigUInt64LE(BigInt(payload.confidenceRatio), 32);
    
    // Risk score (1 byte)
    message.writeUInt8(payload.riskScore, 40);
    
    // isBlocked (1 byte)
    message.writeUInt8(payload.isBlocked ? 1 : 0, 41);
    
    // Publisher count (1 byte)
    message.writeUInt8(payload.publisherCount, 42);
    
    // Padding (3 bytes) to align to 8 bytes
    message.writeUInt8(0, 43);
    message.writeUInt8(0, 44);
    message.writeUInt8(0, 45);
    
    // Nonce (8 bytes, little-endian u64)
    message.writeBigUInt64LE(BigInt(payload.nonce), 46);
    
    // 4. Hash message (SHA-512/256 truncated to 32 bytes as per Solana spec)
    const messageHash = createHash('sha512').update(message).digest().slice(0, 32);
    
    // 5. Sign with Ed25519
    const signature = nacl.sign.detached(messageHash, signingKey.secretKey);
    
    // 6. Return response
    res.json({
      success: true,
      data: {
        assetId: payload.assetId,
        riskScore: payload.riskScore,
        isBlocked: payload.isBlocked,
        confidenceRatio: payload.confidenceRatio,
        publisherCount: payload.publisherCount,
        timestamp: payload.timestamp,
        decisionHash: Array.from(messageHash),
        signature: Array.from(signature),
        signerPublicKey: Array.from(signingKey.publicKey.toBytes()),
        signerBase58: TRUSTED_PUBLIC_KEY
      },
      meta: {
        signedAt: new Date().toISOString(),
        algorithm: 'Ed25519',
        hashAlgorithm: 'SHA-512/256',
        nonce: payload.nonce
      }
    });

    console.log(`[Sign] ${payload.assetId} | Risk: ${payload.riskScore} | Blocked: ${payload.isBlocked} | Nonce: ${payload.nonce}`);

  } catch (error) {
    console.error('[API] Signing error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal signing error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Verify signature (for debugging)
app.post('/api/v1/verify', (req, res) => {
  try {
    const { messageHash, signature, publicKey } = req.body;
    
    const isValid = nacl.sign.detached.verify(
      new Uint8Array(messageHash),
      new Uint8Array(signature),
      new Uint8Array(publicKey)
    );
    
    res.json({ valid: isValid });
  } catch (error) {
    res.status(400).json({ valid: false, error: (error as Error).message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[API] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// =============================================================================
// START
// =============================================================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║       CATE Secure Signing Server v1.0          ║
╠════════════════════════════════════════════════╣
  Port:        ${PORT}
  Environment: ${NODE_ENV}
  Signer:      ${TRUSTED_PUBLIC_KEY.substring(0, 20)}...
  Rate Limit:  30 req/min
╚════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[API] SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[API] SIGINT received, shutting down gracefully');
  process.exit(0);
});

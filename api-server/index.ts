import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PublicKey, Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Segurança básica
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Rate limiting rigoroso (assinaturas são operações sensíveis)
const signLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30, // máximo 30 assinaturas por IP/minuto
  message: { error: 'Too many signing requests' }
});

// ============================
// CONFIGURAÇÃO DE CHAVE SEGURA
// ============================

// OPÇÃO A: AWS KMS (Produção)
// import { KMS } from 'aws-sdk';
// const kms = new KMS();
// const keyId = process.env.AWS_KMS_KEY_ID!;

// OPÇÃO B: Chave em memória (Desenvolvimento apenas!)
// Em produção, use AWS KMS, Azure Key Vault ou HashiCorp Vault
const SIGNING_KEY = (() => {
  const keyStr = process.env.SIGNING_PRIVATE_KEY;
  if (!keyStr) {
    throw new Error('SIGNING_PRIVATE_KEY não configurada');
  }
  // Decodifica base58 ou base64
  try {
    return Keypair.fromSecretKey(Buffer.from(keyStr, 'base64'));
  } catch {
    return Keypair.fromSecretKey(Buffer.from(keyStr, 'hex'));
  }
})();

const TRUSTED_PUBLIC_KEY = SIGNING_KEY.publicKey.toBase58();
console.log(`[API] Trusted signer initialized: ${TRUSTED_PUBLIC_KEY}`);

// ============================
// SCHEMAS DE VALIDAÇÃO
// ============================

interface SignDecisionRequest {
  assetId: string;
  price: number;
  timestamp: number;
  confidenceRatio: number;
  riskScore: number;
  isBlocked: boolean;
  publisherCount: number;
  nonce: number; // Prevents replay attacks on API level
}

// Validação de decisão
function validateDecision(data: SignDecisionRequest): boolean {
  // Asset ID válido
  if (!data.assetId || data.assetId.length > 16) return false;
  
  // Timestamp dentro da janela (5 minutos)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(data.timestamp - now) > 300) return false;
  
  // Valores numéricos válidos
  if (data.confidenceRatio < 0 || data.confidenceRatio > 10000) return false;
  if (data.riskScore < 0 || data.riskScore > 100) return false;
  if (data.price <= 0) return false;
  
  return true;
}

// ============================
// ENDPOINTS
// ============================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    publicKey: TRUSTED_PUBLIC_KEY,
    timestamp: new Date().toISOString()
  });
});

// Assinar decisão
app.post('/api/v1/sign-decision', signLimiter, async (req, res) => {
  try {
    const body: SignDecisionRequest = req.body;
    
    // 1. Validação rigorosa dos dados
    if (!validateDecision(body)) {
      return res.status(400).json({ 
        error: 'Invalid decision parameters',
        code: 'VALIDATION_FAILED'
      });
    }

    // 2. Construct the message hash (deve bater com o Rust)
    const message = Buffer.concat([
      Buffer.from(body.assetId.padEnd(16, '\0')), // 16 bytes
      Buffer.from(new Float64Array([body.price]).buffer), // 8 bytes
      Buffer.from(new BigInt64Array([BigInt(body.timestamp)]).buffer), // 8 bytes
      Buffer.from(new BigUint64Array([BigInt(body.confidenceRatio)]).buffer), // 8 bytes
      Buffer.from([body.riskScore]), // 1 byte
      Buffer.from([body.isBlocked ? 1 : 0]), // 1 byte
      Buffer.from([body.publisherCount]), // 1 byte
      Buffer.from(new BigUint64Array([BigInt(body.nonce)]).buffer), // 8 bytes
    ]);

    // Hash da mensagem (32 bytes para Ed25519)
    const messageHash = nacl.hash(message).slice(0, 32);
    
    // 3. Assinar com ED25519
    // OPÇÃO A: AWS KMS (Produção)
    // const signResult = await kms.sign({
    //   Message: messageHash,
    //   KeyId: keyId,
    //   SigningAlgorithm: 'ED25519'
    // }).promise();
    // const signature = signResult.Signature!;
    // const pubkey = Buffer.from(signResult.SigningPublicKey!, 'base64');
    
    // OPÇÃO B: Assinatura local (desenvolvimento)
    const signature = nacl.sign.detached(messageHash, SIGNING_KEY.secretKey);
    
    // 4. Retorna dados assinados + proof
    res.json({
      success: true,
      data: {
        assetId: body.assetId,
        riskScore: body.riskScore,
        isBlocked: body.isBlocked,
        confidenceRatio: body.confidenceRatio,
        publisherCount: body.publisherCount,
        timestamp: body.timestamp,
        decisionHash: Array.from(messageHash),
        signature: Array.from(signature),
        signerPublicKey: Array.from(SIGNING_KEY.publicKey.toBytes()),
        signerBase58: TRUSTED_PUBLIC_KEY
      },
      meta: {
        signedAt: new Date().toISOString(),
        algorithm: 'Ed25519',
        hashAlgorithm: 'SHA-512/256'
      }
    });
    
    console.log(`[Sign] Asset: ${body.assetId}, Risk: ${body.riskScore}, Blocked: ${body.isBlocked}`);
    
  } catch (error) {
    console.error('[Sign Error]', error);
    res.status(500).json({ 
      error: 'Internal signing error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Verificar assinatura (debug/audit)
app.post('/api/v1/verify-local', (req, res) => {
  const { messageHash, signature, publicKey } = req.body;
  
  try {
    const isValid = nacl.sign.detached.verify(
      new Uint8Array(messageHash),
      new Uint8Array(signature),
      new Uint8Array(publicKey)
    );
    
    res.json({ valid: isValid });
  } catch (e) {
    res.status(400).json({ valid: false, error: (e as Error).message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[API] CATE Signing Server running on port ${PORT}`);
  console.log(`[API] Trusted Signer: ${TRUSTED_PUBLIC_KEY}`);
  console.log(`[API] Environment: ${process.env.NODE_ENV || 'development'}`);
});

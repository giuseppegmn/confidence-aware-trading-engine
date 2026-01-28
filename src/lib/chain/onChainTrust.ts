/**
 * CATE - On-Chain Trust Layer Integration
 * 
 * Integrates with the Solana program for:
 * - Publishing signed risk decisions on-chain
 * - Verifying signatures
 * - Querying risk status
 * 
 * The on-chain program is ONLY a trust anchor:
 * - No business logic
 * - No risk calculation
 * - Just verification and registry
 */

import { 
  Connection, 
  PublicKey, 
  SystemProgram,
  TransactionInstruction,
  Ed25519Program,
} from '@solana/web3.js';
import { Program, AnchorProvider, BN, Idl } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import type { SignedDecision } from '../crypto/signing';
import idl from '@/idl/workspaceIDL.json';

// ============================================
// CONSTANTS
// ============================================

export const PROGRAM_ID = '77kRa7xJb2SQpPC1fdFGj8edzm5MJxhq2j54BxMWtPe6';
export const NETWORK = 'devnet';
export const RPC_ENDPOINT = 'https://api.devnet.solana.com';

const programId = new PublicKey(PROGRAM_ID);

// ============================================
// TYPES
// ============================================

export interface OnChainRiskStatus {
  assetId: string;
  riskScore: number;
  isBlocked: boolean;
  lastUpdated: number;
  confidenceRatio: number;
  publisherCount: number;
  decisionHash: string;
  signature: string;
  signerPubkey: string;
}

export interface OnChainConfig {
  authority: PublicKey;
  isInitialized: boolean;
  trustedSigner: PublicKey;
}

export interface PublishResult {
  success: boolean;
  txSignature?: string;
  error?: string;
}

// ============================================
// PDA DERIVATION
// ============================================

export function getConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    programId
  );
}

export function getAssetRiskPDA(assetId: string): [PublicKey, number] {
  // Must match on-chain PDA seeds: [b"asset_risk", asset_id.as_bytes()]
  return PublicKey.findProgramAddressSync(
    [Buffer.from('asset_risk'), Buffer.from(assetId)],
    programId
  );
}

// ============================================
// ED25519 INSTRUCTION BUILDER
// ============================================

function createEd25519Instruction(
  decisionHash: Uint8Array,
  signature: Uint8Array,
  signerPubkey: Uint8Array
): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: signerPubkey,
    message: decisionHash,
    signature: signature,
  });
}

// ============================================
// ON-CHAIN TRUST SERVICE
// ============================================

export class OnChainTrustService {
  private connection: Connection;
  private program: Program | null = null;
  private isInitialized: boolean = false;
  private trustedSigner: string | null = null;
  
  constructor(rpcEndpoint: string = RPC_ENDPOINT) {
    this.connection = new Connection(rpcEndpoint, 'confirmed');
  }
  
  // ==========================================
  // INITIALIZATION
  // ==========================================
  
  /**
   * Initialize with wallet provider
   */
  initializeWithWallet(
    wallet: { publicKey: PublicKey; signTransaction: (tx: any) => Promise<any> }
  ): void {
    const provider = new AnchorProvider(
      this.connection,
      wallet as any,
      { commitment: 'confirmed' }
    );
    
    this.program = new Program(idl as Idl, programId, provider);
    console.log('[OnChainTrust] Program initialized');
  }
  
  /**
   * Check if config is initialized on-chain
   */
  async checkConfigInitialized(): Promise<boolean> {
    try {
      const [configPDA] = getConfigPDA();
      const config = await this.connection.getAccountInfo(configPDA);
      this.isInitialized = config !== null;
      return this.isInitialized;
    } catch {
      return false;
    }
  }
  
  /**
   * Get on-chain config
   */
  async getConfig(): Promise<OnChainConfig | null> {
    if (!this.program) return null;
    
    try {
      const [configPDA] = getConfigPDA();
      const config = await (this.program.account as any).config.fetch(configPDA);
      
      this.trustedSigner = config.trustedSigner.toString();
      
      return {
        authority: config.authority,
        isInitialized: config.isInitialized,
        trustedSigner: config.trustedSigner,
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Initialize config with trusted signer
   */
  async initializeConfig(
    trustedSignerPubkey: string
  ): Promise<PublishResult> {
    if (!this.program) {
      return { success: false, error: 'Program not initialized' };
    }
    
    try {
      const [configPDA] = getConfigPDA();
      const trustedSigner = new PublicKey(trustedSignerPubkey);
      
      const tx = await (this.program.methods as any)
        .initializeConfig(trustedSigner)
        .accounts({
          config: configPDA,
          authority: (this.program.provider as any).wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      this.trustedSigner = trustedSignerPubkey;
      this.isInitialized = true;
      
      return { success: true, txSignature: tx };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  
  // ==========================================
  // PUBLISH SIGNED DECISION
  // ==========================================
  
  /**
   * Publish a signed risk decision to the blockchain
   */
  async publishDecision(
    signedDecision: SignedDecision,
    confidenceRatio: number,
    publisherCount: number
  ): Promise<PublishResult> {
    if (!this.program) {
      return { success: false, error: 'Program not initialized' };
    }
    
    try {
      const [configPDA] = getConfigPDA();
      const [assetRiskPDA] = getAssetRiskPDA(signedDecision.assetId);
      
      // Decode the signature and decision hash from base58
      const signatureBytes = bs58.decode(signedDecision.signature);
      const decisionHashBytes = bs58.decode(signedDecision.decisionHash);
      const signerPubkeyBytes = bs58.decode(signedDecision.signerPublicKey);
      
      // Create Ed25519 verification instruction
      const ed25519Ix = createEd25519Instruction(
        decisionHashBytes,
        signatureBytes,
        signerPubkeyBytes
      );
      
      // Convert confidence ratio to basis points
      const confidenceRatioBps = new BN(Math.floor(confidenceRatio * 100));
      
      // Build transaction with Ed25519 verification first
      const tx = await (this.program.methods as any)
        .updateRiskStatus(
          signedDecision.assetId,
          Math.floor(signedDecision.riskScore),
          signedDecision.action === 'BLOCK',
          confidenceRatioBps,
          publisherCount,
          Array.from(decisionHashBytes),
          Array.from(signatureBytes),
          Array.from(signerPubkeyBytes)
        )
        .accounts({
          config: configPDA,
          assetRiskStatus: assetRiskPDA,
          authority: (this.program.provider as any).wallet.publicKey,
          systemProgram: SystemProgram.programId,
          instructionsSysvar: new PublicKey('Sysvar1nstructions1111111111111111111111111'),
        })
        .preInstructions([ed25519Ix])
        .rpc();
      
      console.log(`[OnChainTrust] Published decision for ${signedDecision.assetId}: ${tx}`);
      
      return { success: true, txSignature: tx };
    } catch (error: any) {
      console.error('[OnChainTrust] Publish failed:', error);
      return { success: false, error: error.message };
    }
  }
  
  // ==========================================
  // QUERY METHODS
  // ==========================================
  
  /**
   * Get risk status for an asset from chain
   */
  async getRiskStatus(assetId: string): Promise<OnChainRiskStatus | null> {
    if (!this.program) return null;
    
    try {
      const [assetRiskPDA] = getAssetRiskPDA(assetId);
      const status = await (this.program.account as any).assetRiskStatus.fetch(assetRiskPDA);
      
      // Decode asset ID
      const assetIdDecoded = Buffer.from(status.assetId)
        .toString('utf8')
        .replace(/\0/g, '');
      
      return {
        assetId: assetIdDecoded,
        riskScore: status.riskScore,
        isBlocked: status.isBlocked,
        lastUpdated: status.lastUpdated.toNumber() * 1000,
        confidenceRatio: status.confidenceRatio.toNumber() / 100,
        publisherCount: status.publisherCount,
        decisionHash: bs58.encode(Buffer.from(status.decisionHash)),
        signature: bs58.encode(Buffer.from(status.signature)),
        signerPubkey: bs58.encode(Buffer.from(status.signerPubkey)),
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Get all asset risk statuses
   */
  async getAllRiskStatuses(assetIds: string[]): Promise<Map<string, OnChainRiskStatus>> {
    const statuses = new Map<string, OnChainRiskStatus>();
    
    for (const assetId of assetIds) {
      const status = await this.getRiskStatus(assetId);
      if (status) {
        statuses.set(assetId, status);
      }
    }
    
    return statuses;
  }
  
  /**
   * Verify a decision on-chain matches expected
   */
  async verifyOnChainDecision(
    assetId: string,
    expectedHash: string
  ): Promise<{ valid: boolean; onChainHash?: string }> {
    const status = await this.getRiskStatus(assetId);
    
    if (!status) {
      return { valid: false };
    }
    
    return {
      valid: status.decisionHash === expectedHash,
      onChainHash: status.decisionHash,
    };
  }
  
  // ==========================================
  // GETTERS
  // ==========================================
  
  isConnected(): boolean {
    return this.program !== null;
  }
  
  isConfigInitialized(): boolean {
    return this.isInitialized;
  }
  
  getTrustedSigner(): string | null {
    return this.trustedSigner;
  }
  
  getConnection(): Connection {
    return this.connection;
  }
  
  getProgramId(): string {
    return PROGRAM_ID;
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const onChainTrustService = new OnChainTrustService();

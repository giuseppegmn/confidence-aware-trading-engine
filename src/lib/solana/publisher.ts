import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { AnchorWallet } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import idl from '../../idl/workspaceIDL.json';

const PROGRAM_ID = new PublicKey("77kRa7xJb2SQpPC1fdFGj8edzm5MJxhq2j54BxMWtPe6");
const RPC = "https://api.devnet.solana.com ";

export class SolanaPublisher {
  private program: anchor.Program;
  private connection: Connection;

  constructor(wallet: AnchorWallet) {
    this.connection = new Connection(RPC, 'confirmed');
    const provider = new anchor.AnchorProvider(this.connection, wallet, { 
      commitment: 'confirmed' 
    });
    this.program = new anchor.Program(idl as any, PROGRAM_ID, provider);
  }

  async publishDecision(
    assetId: string,
    riskScore: number,
    isBlocked: boolean,
    confidenceRatio: number,
    publisherCount: number,
    signature: string,
    decisionHash: string,
    signerPubkey: string,
    timestamp: number
  ): Promise<string> {
    // Converte base58 para bytes
    const sigBytes = bs58.decode(signature);
    const hashBytes = bs58.decode(decisionHash);
    const pubBytes = bs58.decode(signerPubkey);

    // PDA addresses
    const [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')], 
      PROGRAM_ID
    );
    const [assetPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('asset_risk'), Buffer.from(assetId)], 
      PROGRAM_ID
    );

    // Instrução Ed25519 nativa do Solana
    const ed25519Ix = anchor.web3.Ed25519Program.createInstructionWithPublicKey({
      publicKey: pubBytes,
      message: hashBytes,
      signature: sigBytes,
    });

    // Chama seu programa CATE
    const ix = await (this.program.methods as any)
      .updateRiskStatus(
        assetId,
        riskScore,
        isBlocked,
        new anchor.BN(Math.floor(confidenceRatio * 100)), // basis points
        publisherCount,
        new anchor.BN(timestamp),
        Array.from(hashBytes),
        Array.from(sigBytes),
        Array.from(pubBytes)
      )
      .accounts({
        config: configPDA,
        usedDecisions: PublicKey.findProgramAddressSync([Buffer.from('used_decisions')], PROGRAM_ID)[0],
        assetRiskStatus: assetPDA,
        authority: this.program.provider.publicKey,
        instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix).add(ix);
    const sig = await this.program.provider.sendAndConfirm(tx);
    
    return sig;
  }

  async getRiskStatus(assetId: string): Promise<any> {
    const [assetPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('asset_risk'), Buffer.from(assetId)], 
      PROGRAM_ID
    );
    
    try {
      return await this.program.account.assetRiskStatus.fetch(assetPDA);
    } catch (e) {
      return null; // Não existe ainda
    }
  }
}

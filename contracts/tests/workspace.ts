import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Workspace } from "../target/types/workspace";
import { PublicKey, Keypair, SystemProgram, Transaction, Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { expect } from "chai";
import nacl from "tweetnacl";

describe("CATE Workspace", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Workspace as Program<Workspace>;
  
  // Test accounts
  const authority = Keypair.generate();
  const trustedSigner = Keypair.generate();
  const attacker = Keypair.generate();
  
  // PDAs
  let configPda: PublicKey;
  let usedDecisionsPda: PublicKey;
  let configBump: number;
  let usedDecisionsBump: number;

  before(async () => {
    // Airdrop SOL to authority
    await provider.connection.requestAirdrop(
      authority.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );

    // Find PDAs
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    [usedDecisionsPda, usedDecisionsBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("used_decisions")],
      program.programId
    );
  });

  describe("Initialization", () => {
    it("Should initialize config with trusted signer", async () => {
      await program.methods
        .initializeConfig(trustedSigner.publicKey)
        .accounts({
          config: configPda,
          usedDecisions: usedDecisionsPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const config = await program.account.config.fetch(configPda);
      expect(config.authority.toString()).to.equal(authority.publicKey.toString());
      expect(config.trustedSigner.toString()).to.equal(trustedSigner.publicKey.toString());
      expect(config.isInitialized).to.be.true;
    });

    it("Should fail to initialize twice", async () => {
      try {
        await program.methods
          .initializeConfig(trustedSigner.publicKey)
          .accounts({
            config: configPda,
            usedDecisions: usedDecisionsPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (error) {
        expect(error.toString()).to.include("already in use");
      }
    });
  });

  describe("Risk Status Update", () => {
    const assetId = "SOL/USD";
    let assetRiskPda: PublicKey;
    let assetBump: number;

    before(() => {
      [assetRiskPda, assetBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );
    });

    it("Should update risk status with valid signature", async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const decisionHash = Buffer.from(nacl.hash(Buffer.from("test")), 0, 32);
      
      // Create Ed25519 signature
      const signature = nacl.sign.detached(decisionHash, trustedSigner.secretKey);
      
      // Create Ed25519 instruction
      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: trustedSigner.publicKey.toBytes(),
        message: decisionHash,
        signature: signature,
      });

      await program.methods
        .updateRiskStatus(
          assetId,
          25, // risk_score
          false, // is_blocked
          9500, // confidence_ratio (95%)
          5, // publisher_count
          timestamp,
          Array.from(decisionHash),
          Array.from(signature),
          Array.from(trustedSigner.publicKey.toBytes())
        )
        .accounts({
          config: configPda,
          usedDecisions: usedDecisionsPda,
          assetRiskStatus: assetRiskPda,
          authority: authority.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .preInstructions([ed25519Ix])
        .rpc();

      const riskStatus = await program.account.assetRiskStatus.fetch(assetRiskPda);
      expect(riskStatus.assetId.slice(0, 7)).to.deep.equal(Buffer.from("SOL/USD"));
      expect(riskStatus.riskScore).to.equal(25);
      expect(riskStatus.isBlocked).to.be.false;
      expect(riskStatus.confidenceRatio.toNumber()).to.equal(9500);
    });

    it("Should reject replay attack (same hash)", async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const decisionHash = Buffer.from(nacl.hash(Buffer.from("test")), 0, 32);
      const signature = nacl.sign.detached(decisionHash, trustedSigner.secretKey);
      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: trustedSigner.publicKey.toBytes(),
        message: decisionHash,
        signature: signature,
      });

      try {
        await program.methods
          .updateRiskStatus(
            assetId,
            50,
            true,
            5000,
            3,
            timestamp,
            Array.from(decisionHash),
            Array.from(signature),
            Array.from(trustedSigner.publicKey.toBytes())
          )
          .accounts({
            config: configPda,
            usedDecisions: usedDecisionsPda,
            assetRiskStatus: assetRiskPda,
            authority: authority.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .preInstructions([ed25519Ix])
          .rpc();
        expect.fail("Should have rejected replay");
      } catch (error) {
        expect(error.toString()).to.include("DecisionAlreadyUsed");
      }
    });

    it("Should reject invalid timestamp (too old)", async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 1000; // 1000 seconds ago
      const decisionHash = Buffer.from(nacl.hash(Buffer.from("old")), 0, 32);
      const signature = nacl.sign.detached(decisionHash, trustedSigner.secretKey);
      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: trustedSigner.publicKey.toBytes(),
        message: decisionHash,
        signature: signature,
      });

      try {
        await program.methods
          .updateRiskStatus(
            assetId,
            25,
            false,
            9500,
            5,
            oldTimestamp,
            Array.from(decisionHash),
            Array.from(signature),
            Array.from(trustedSigner.publicKey.toBytes())
          )
          .accounts({
            config: configPda,
            usedDecisions: usedDecisionsPda,
            assetRiskStatus: assetRiskPda,
            authority: authority.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .preInstructions([ed25519Ix])
          .rpc();
        expect.fail("Should have rejected old timestamp");
      } catch (error) {
        expect(error.toString()).to.include("InvalidTimestamp");
      }
    });

    it("Should reject unauthorized signer", async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const decisionHash = Buffer.from(nacl.hash(Buffer.from("unauthorized")), 0, 32);
      const signature = nacl.sign.detached(decisionHash, attacker.secretKey);
      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: attacker.publicKey.toBytes(),
        message: decisionHash,
        signature: signature,
      });

      try {
        await program.methods
          .updateRiskStatus(
            assetId,
            25,
            false,
            9500,
            5,
            timestamp,
            Array.from(decisionHash),
            Array.from(signature),
            Array.from(attacker.publicKey.toBytes())
          )
          .accounts({
            config: configPda,
            usedDecisions: usedDecisionsPda,
            assetRiskStatus: assetRiskPda,
            authority: authority.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .preInstructions([ed25519Ix])
          .rpc();
        expect.fail("Should have rejected unauthorized signer");
      } catch (error) {
        expect(error.toString()).to.include("InvalidSigner");
      }
    });
  });

  describe("Input Validation", () => {
    it("Should reject asset_id too long", async () => {
      const longAssetId = "A".repeat(17);
      const timestamp = Math.floor(Date.now() / 1000);
      const decisionHash = Buffer.alloc(32, 1);
      const signature = Buffer.alloc(64, 1);

      try {
        await program.methods
          .updateRiskStatus(
            longAssetId,
            25,
            false,
            9500,
            5,
            timestamp,
            Array.from(decisionHash),
            Array.from(signature),
            Array.from(trustedSigner.publicKey.toBytes())
          )
          .accounts({
            config: configPda,
            usedDecisions: usedDecisionsPda,
            assetRiskStatus: Keypair.generate().publicKey,
            authority: authority.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
        expect.fail("Should have rejected long asset_id");
      } catch (error) {
        expect(error.toString()).to.include("AssetIdTooLong");
      }
    });

    it("Should reject invalid risk score", async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const decisionHash = Buffer.alloc(32, 1);
      const signature = Buffer.alloc(64, 1);

      try {
        await program.methods
          .updateRiskStatus(
            "BTC/USD",
            101, // Invalid: > 100
            false,
            950

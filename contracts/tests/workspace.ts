import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Workspace } from "../target/types/workspace";
import { expect } from "chai";
import { 
  PublicKey, 
  SystemProgram, 
  Keypair, 
  LAMPORTS_PER_SOL,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import * as nacl from "tweetnacl";
import { createHash } from "crypto";

describe("CATE Trust Layer v2", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Workspace as Program<Workspace>;
  
  let authority: Keypair;
  let unauthorizedUser: Keypair;
  let trustedSigner: Keypair;
  let newTrustedSigner: Keypair;
  let configPDA: PublicKey;
  let configBump: number;

  // Helper function to create Ed25519 signature
  function signMessage(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
    return nacl.sign.detached(message, secretKey);
  }

  // Helper function to create decision hash
  function createDecisionHash(data: string): Uint8Array {
    const hash = createHash("sha256").update(data).digest();
    return new Uint8Array(hash);
  }

  // Helper to create Ed25519 verification instruction
  function createEd25519Instruction(
    pubkey: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array
  ): TransactionInstruction {
    return Ed25519Program.createInstructionWithPublicKey({
      publicKey: pubkey,
      message: message,
      signature: signature,
    });
  }

  before(async () => {
    // Generate keypairs
    authority = Keypair.generate();
    unauthorizedUser = Keypair.generate();
    trustedSigner = Keypair.generate();
    newTrustedSigner = Keypair.generate();

    // Fund accounts with 100 SOL each
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(unauthorizedUser.publicKey, 100 * LAMPORTS_PER_SOL)
    );

    // Derive config PDA
    [configPDA, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
  });

  // ============================================================================
  // INITIAL TEST CASES (MUST PASS - MAIN PRIORITY)
  // ============================================================================

  describe("Initialization Tests", () => {
    it("should initialize config with trusted signer successfully", async () => {
      await program.methods
        .initializeConfig(trustedSigner.publicKey)
        .accounts({
          config: configPDA,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const config = await program.account.config.fetch(configPDA);
      expect(config.authority.toString()).to.equal(authority.publicKey.toString());
      expect(config.isInitialized).to.be.true;
      expect(config.bump).to.equal(configBump);
      expect(config.trustedSigner.toString()).to.equal(trustedSigner.publicKey.toString());
    });

    it("should fail to initialize config twice", async () => {
      try {
        await program.methods
          .initializeConfig(trustedSigner.publicKey)
          .accounts({
            config: configPDA,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("already in use");
      }
    });
  });

  // ============================================================================
  // TRUSTED SIGNER MANAGEMENT TESTS
  // ============================================================================

  describe("Trusted Signer Management Tests", () => {
    it("should update trusted signer by authority", async () => {
      await program.methods
        .updateTrustedSigner(newTrustedSigner.publicKey)
        .accounts({
          config: configPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const config = await program.account.config.fetch(configPDA);
      expect(config.trustedSigner.toString()).to.equal(newTrustedSigner.publicKey.toString());

      // Revert back to original trusted signer for subsequent tests
      await program.methods
        .updateTrustedSigner(trustedSigner.publicKey)
        .accounts({
          config: configPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
    });

    it("should fail to update trusted signer by unauthorized user", async () => {
      try {
        await program.methods
          .updateTrustedSigner(newTrustedSigner.publicKey)
          .accounts({
            config: configPDA,
            authority: unauthorizedUser.publicKey,
          })
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("Unauthorized");
      }
    });
  });

  // ============================================================================
  // UPDATE RISK STATUS WITH SIGNATURE VERIFICATION TESTS
  // ============================================================================

  describe("Update Risk Status with Ed25519 Signature Tests", () => {
    const assetId = "SOL/USD";
    let assetRiskPDA: PublicKey;

    before(() => {
      [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );
    });

    it("should update risk status with valid Ed25519 signature", async () => {
      const riskScore = 25;
      const isBlocked = false;
      const confidenceRatio = new BN(9500);
      const publisherCount = 5;

      // Create decision hash
      const decisionData = `${assetId}:${riskScore}:${isBlocked}:${confidenceRatio}:${publisherCount}`;
      const decisionHash = createDecisionHash(decisionData);

      // Sign the decision hash with trusted signer
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      // Create Ed25519 verification instruction
      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        decisionHash,
        signature
      );

      // Build transaction with Ed25519 instruction first
      const tx = new Transaction();
      tx.add(ed25519Ix);
      tx.add(
        await program.methods
          .updateRiskStatus(
            assetId,
            riskScore,
            isBlocked,
            confidenceRatio,
            publisherCount,
            Array.from(decisionHash) as any,
            Array.from(signature) as any,
            Array.from(trustedSigner.publicKey.toBytes()) as any
          )
          .accounts({
            config: configPDA,
            assetRiskStatus: assetRiskPDA,
            authority: authority.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );

      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
      tx.sign(authority);

      await provider.connection.sendRawTransaction(tx.serialize());
      await new Promise(resolve => setTimeout(resolve, 1000));

      const assetRisk = await program.account.assetRiskStatus.fetch(assetRiskPDA);
      expect(assetRisk.riskScore).to.equal(riskScore);
      expect(assetRisk.isBlocked).to.equal(isBlocked);
      expect(Number(assetRisk.confidenceRatio)).to.equal(9500);
      expect(assetRisk.publisherCount).to.equal(publisherCount);
      expect(Number(assetRisk.lastUpdated)).to.be.greaterThan(0);
      
      // Verify cryptographic proof is stored
      expect(Array.from(assetRisk.decisionHash)).to.deep.equal(Array.from(decisionHash));
      expect(Array.from(assetRisk.signature)).to.deep.equal(Array.from(signature));
      expect(Array.from(assetRisk.signerPubkey)).to.deep.equal(Array.from(trustedSigner.publicKey.toBytes()));
    });

    it("should update existing risk status with new signature", async () => {
      const newRiskScore = 75;
      const newIsBlocked = true;
      const newConfidenceRatio = new BN(8000);
      const newPublisherCount = 3;

      const decisionData = `${assetId}:${newRiskScore}:${newIsBlocked}:${newConfidenceRatio}:${newPublisherCount}`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        decisionHash,
        signature
      );

      const tx = new Transaction();
      tx.add(ed25519Ix);
      tx.add(
        await program.methods
          .updateRiskStatus(
            assetId,
            newRiskScore,
            newIsBlocked,
            newConfidenceRatio,
            newPublisherCount,
            Array.from(decisionHash) as any,
            Array.from(signature) as any,
            Array.from(trustedSigner.publicKey.toBytes()) as any
          )
          .accounts({
            config: configPDA,
            assetRiskStatus: assetRiskPDA,
            authority: authority.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );

      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
      tx.sign(authority);

      await provider.connection.sendRawTransaction(tx.serialize());
      await new Promise(resolve => setTimeout(resolve, 1000));

      const assetRisk = await program.account.assetRiskStatus.fetch(assetRiskPDA);
      expect(assetRisk.riskScore).to.equal(newRiskScore);
      expect(assetRisk.isBlocked).to.equal(newIsBlocked);
      expect(Number(assetRisk.confidenceRatio)).to.equal(8000);
      expect(assetRisk.publisherCount).to.equal(newPublisherCount);
    });

    it("should create risk status for multiple assets with signatures", async () => {
      const assets = [
        { id: "BTC/USD", score: 15, blocked: false, confidence: 9800, publishers: 8 },
        { id: "ETH/USD", score: 20, blocked: false, confidence: 9600, publishers: 7 },
      ];

      for (const asset of assets) {
        const [pda] = PublicKey.findProgramAddressSync(
          [Buffer.from("asset_risk"), Buffer.from(asset.id)],
          program.programId
        );

        const decisionData = `${asset.id}:${asset.score}:${asset.blocked}:${asset.confidence}:${asset.publishers}`;
        const decisionHash = createDecisionHash(decisionData);
        const signature = signMessage(decisionHash, trustedSigner.secretKey);

        const ed25519Ix = createEd25519Instruction(
          trustedSigner.publicKey.toBytes(),
          decisionHash,
          signature
        );

        const tx = new Transaction();
        tx.add(ed25519Ix);
        tx.add(
          await program.methods
            .updateRiskStatus(
              asset.id,
              asset.score,
              asset.blocked,
              new BN(asset.confidence),
              asset.publishers,
              Array.from(decisionHash) as any,
              Array.from(signature) as any,
              Array.from(trustedSigner.publicKey.toBytes()) as any
            )
            .accounts({
              config: configPDA,
              assetRiskStatus: pda,
              authority: authority.publicKey,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .instruction()
        );

        tx.feePayer = authority.publicKey;
        tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
        tx.sign(authority);

        await provider.connection.sendRawTransaction(tx.serialize());
        await new Promise(resolve => setTimeout(resolve, 1000));

        const assetRisk = await program.account.assetRiskStatus.fetch(pda);
        expect(assetRisk.riskScore).to.equal(asset.score);
        expect(assetRisk.isBlocked).to.equal(asset.blocked);
      }
    });
  });

  // ============================================================================
  // SIGNATURE VERIFICATION FAILURE TESTS
  // ============================================================================

  describe("Signature Verification Failure Tests", () => {
    const assetId = "FAIL/USD";
    let assetRiskPDA: PublicKey;

    before(() => {
      [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );
    });

    it("should fail with untrusted signer pubkey", async () => {
      const riskScore = 50;
      const isBlocked = false;
      const confidenceRatio = new BN(7000);
      const publisherCount = 4;

      const decisionData = `${assetId}:${riskScore}:${isBlocked}:${confidenceRatio}:${publisherCount}`;
      const decisionHash = createDecisionHash(decisionData);
      
      // Sign with unauthorized signer
      const fakeSignerKeypair = Keypair.generate();
      const signature = signMessage(decisionHash, fakeSignerKeypair.secretKey);

      const ed25519Ix = createEd25519Instruction(
        fakeSignerKeypair.publicKey.toBytes(),
        decisionHash,
        signature
      );

      try {
        const tx = new Transaction();
        tx.add(ed25519Ix);
        tx.add(
          await program.methods
            .updateRiskStatus(
              assetId,
              riskScore,
              isBlocked,
              confidenceRatio,
              publisherCount,
              Array.from(decisionHash) as any,
              Array.from(signature) as any,
              Array.from(fakeSignerKeypair.publicKey.toBytes()) as any
            )
            .accounts({
              config: configPDA,
              assetRiskStatus: assetRiskPDA,
              authority: authority.publicKey,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .instruction()
        );

        tx.feePayer = authority.publicKey;
        tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
        tx.sign(authority);

        await provider.connection.sendRawTransaction(tx.serialize());
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("InvalidSigner");
      }
    });

    it("should fail without Ed25519 verification instruction", async () => {
      const riskScore = 50;
      const isBlocked = false;
      const confidenceRatio = new BN(7000);
      const publisherCount = 4;

      const decisionData = `${assetId}:${riskScore}:${isBlocked}:${confidenceRatio}:${publisherCount}`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      try {
        // Try to call without Ed25519 instruction
        await program.methods
          .updateRiskStatus(
            assetId,
            riskScore,
            isBlocked,
            confidenceRatio,
            publisherCount,
            Array.from(decisionHash) as any,
            Array.from(signature) as any,
            Array.from(trustedSigner.publicKey.toBytes()) as any
          )
          .accounts({
            config: configPDA,
            assetRiskStatus: assetRiskPDA,
            authority: authority.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("MissingEd25519Instruction");
      }
    });

    it("should fail with mismatched signature data", async () => {
      const riskScore = 50;
      const isBlocked = false;
      const confidenceRatio = new BN(7000);
      const publisherCount = 4;

      const decisionData = `${assetId}:${riskScore}:${isBlocked}:${confidenceRatio}:${publisherCount}`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      // Create Ed25519 instruction with different message
      const differentHash = createDecisionHash("different_data");
      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        differentHash,
        signMessage(differentHash, trustedSigner.secretKey)
      );

      try {
        const tx = new Transaction();
        tx.add(ed25519Ix);
        tx.add(
          await program.methods
            .updateRiskStatus(
              assetId,
              riskScore,
              isBlocked,
              confidenceRatio,
              publisherCount,
              Array.from(decisionHash) as any,
              Array.from(signature) as any,
              Array.from(trustedSigner.publicKey.toBytes()) as any
            )
            .accounts({
              config: configPDA,
              assetRiskStatus: assetRiskPDA,
              authority: authority.publicKey,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .instruction()
        );

        tx.feePayer = authority.publicKey;
        tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
        tx.sign(authority);

        await provider.connection.sendRawTransaction(tx.serialize());
        expect.fail("Should have thrown an error");
      } catch (error) {
        // Should fail due to message mismatch
        expect(error.message).to.satisfy((msg: string) => 
          msg.includes("MessageMismatch") || msg.includes("SignatureMismatch") || msg.includes("custom program error")
        );
      }
    });
  });

  // ============================================================================
  // VERIFY DECISION TESTS
  // ============================================================================

  describe("Verify Decision Tests", () => {
    const assetId = "VERIFY/USD";

    it("should verify valid decision signature", async () => {
      const decisionData = `${assetId}:50:false:8000:5`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        decisionHash,
        signature
      );

      const tx = new Transaction();
      tx.add(ed25519Ix);
      tx.add(
        await program.methods
          .verifyDecision(
            assetId,
            Array.from(decisionHash) as any,
            Array.from(signature) as any,
            Array.from(trustedSigner.publicKey.toBytes()) as any
          )
          .accounts({
            config: configPDA,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .instruction()
      );

      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
      tx.sign(authority);

      const txSig = await provider.connection.sendRawTransaction(tx.serialize());
      await provider.connection.confirmTransaction(txSig);
      // If we reach here without error, verification passed
    });

    it("should fail to verify with untrusted signer", async () => {
      const decisionData = `${assetId}:50:false:8000:5`;
      const decisionHash = createDecisionHash(decisionData);
      
      const fakeSignerKeypair = Keypair.generate();
      const signature = signMessage(decisionHash, fakeSignerKeypair.secretKey);

      const ed25519Ix = createEd25519Instruction(
        fakeSignerKeypair.publicKey.toBytes(),
        decisionHash,
        signature
      );

      try {
        const tx = new Transaction();
        tx.add(ed25519Ix);
        tx.add(
          await program.methods
            .verifyDecision(
              assetId,
              Array.from(decisionHash) as any,
              Array.from(signature) as any,
              Array.from(fakeSignerKeypair.publicKey.toBytes()) as any
            )
            .accounts({
              config: configPDA,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            })
            .instruction()
        );

        tx.feePayer = authority.publicKey;
        tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
        tx.sign(authority);

        await provider.connection.sendRawTransaction(tx.serialize());
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("InvalidSigner");
      }
    });
  });

  // ============================================================================
  // GET RISK STATUS TESTS
  // ============================================================================

  describe("Get Risk Status Tests", () => {
    it("should get risk status for existing asset", async () => {
      const assetId = "SOL/USD";
      const [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );

      await program.methods
        .getRiskStatus(assetId)
        .accounts({
          assetRiskStatus: assetRiskPDA,
        })
        .rpc();

      const assetRisk = await program.account.assetRiskStatus.fetch(assetRiskPDA);
      expect(assetRisk.riskScore).to.be.lessThanOrEqual(100);
      expect(Number(assetRisk.confidenceRatio)).to.be.lessThanOrEqual(10000);
      
      // Verify signature data is present
      expect(assetRisk.decisionHash).to.not.deep.equal(new Array(32).fill(0));
      expect(assetRisk.signature).to.not.deep.equal(new Array(64).fill(0));
      expect(assetRisk.signerPubkey).to.not.deep.equal(new Array(32).fill(0));
    });

    it("should fail to get risk status for non-existent asset", async () => {
      const assetId = "FAKE/USD";
      const [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );

      try {
        await program.methods
          .getRiskStatus(assetId)
          .accounts({
            assetRiskStatus: assetRiskPDA,
          })
          .rpc();
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("AccountNotInitialized");
      }
    });
  });

  // ============================================================================
  // SECURITY TESTS
  // ============================================================================

  describe("Security Tests", () => {
    it("should fail when unauthorized user tries to update risk status", async () => {
      const assetId = "HACK/USD";
      const [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );

      const decisionData = `${assetId}:50:false:5000:1`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        decisionHash,
        signature
      );

      try {
        const tx = new Transaction();
        tx.add(ed25519Ix);
        tx.add(
          await program.methods
            .updateRiskStatus(
              assetId,
              50,
              false,
              new BN(5000),
              1,
              Array.from(decisionHash) as any,
              Array.from(signature) as any,
              Array.from(trustedSigner.publicKey.toBytes()) as any
            )
            .accounts({
              config: configPDA,
              assetRiskStatus: assetRiskPDA,
              authority: unauthorizedUser.publicKey,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .instruction()
        );

        tx.feePayer = unauthorizedUser.publicKey;
        tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
        tx.sign(unauthorizedUser);

        await provider.connection.sendRawTransaction(tx.serialize());
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("Unauthorized");
      }
    });
  });

  // ============================================================================
  // INPUT VALIDATION TESTS
  // ============================================================================

  describe("Input Validation Tests", () => {
    it("should fail with risk score > 100", async () => {
      const assetId = "TEST1/USD";
      const [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );

      const decisionData = `${assetId}:101:false:5000:1`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        decisionHash,
        signature
      );

      try {
        const tx = new Transaction();
        tx.add(ed25519Ix);
        tx.add(
          await program.methods
            .updateRiskStatus(
              assetId,
              101,
              false,
              new BN(5000),
              1,
              Array.from(decisionHash) as any,
              Array.from(signature) as any,
              Array.from(trustedSigner.publicKey.toBytes()) as any
            )
            .accounts({
              config: configPDA,
              assetRiskStatus: assetRiskPDA,
              authority: authority.publicKey,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .instruction()
        );

        tx.feePayer = authority.publicKey;
        tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
        tx.sign(authority);

        await provider.connection.sendRawTransaction(tx.serialize());
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("InvalidRiskScore");
      }
    });

    it("should fail with confidence ratio > 10000", async () => {
      const assetId = "TEST2/USD";
      const [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );

      const decisionData = `${assetId}:50:false:10001:1`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        decisionHash,
        signature
      );

      try {
        const tx = new Transaction();
        tx.add(ed25519Ix);
        tx.add(
          await program.methods
            .updateRiskStatus(
              assetId,
              50,
              false,
              new BN(10001),
              1,
              Array.from(decisionHash) as any,
              Array.from(signature) as any,
              Array.from(trustedSigner.publicKey.toBytes()) as any
            )
            .accounts({
              config: configPDA,
              assetRiskStatus: assetRiskPDA,
              authority: authority.publicKey,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .instruction()
        );

        tx.feePayer = authority.publicKey;
        tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
        tx.sign(authority);

        await provider.connection.sendRawTransaction(tx.serialize());
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("InvalidConfidenceRatio");
      }
    });

    it("should fail with empty asset ID", async () => {
      const assetId = "";
      const [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );

      const decisionData = `${assetId}:50:false:5000:1`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        decisionHash,
        signature
      );

      try {
        const tx = new Transaction();
        tx.add(ed25519Ix);
        tx.add(
          await program.methods
            .updateRiskStatus(
              assetId,
              50,
              false,
              new BN(5000),
              1,
              Array.from(decisionHash) as any,
              Array.from(signature) as any,
              Array.from(trustedSigner.publicKey.toBytes()) as any
            )
            .accounts({
              config: configPDA,
              assetRiskStatus: assetRiskPDA,
              authority: authority.publicKey,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .instruction()
        );

        tx.feePayer = authority.publicKey;
        tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
        tx.sign(authority);

        await provider.connection.sendRawTransaction(tx.serialize());
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("AssetIdEmpty");
      }
    });

    it("should fail with asset ID > 16 characters", async () => {
      const assetId = "VERYLONGASSETID123";
      const [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );

      const decisionData = `${assetId}:50:false:5000:1`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        decisionHash,
        signature
      );

      try {
        const tx = new Transaction();
        tx.add(ed25519Ix);
        tx.add(
          await program.methods
            .updateRiskStatus(
              assetId,
              50,
              false,
              new BN(5000),
              1,
              Array.from(decisionHash) as any,
              Array.from(signature) as any,
              Array.from(trustedSigner.publicKey.toBytes()) as any
            )
            .accounts({
              config: configPDA,
              assetRiskStatus: assetRiskPDA,
              authority: authority.publicKey,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .instruction()
        );

        tx.feePayer = authority.publicKey;
        tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
        tx.sign(authority);

        await provider.connection.sendRawTransaction(tx.serialize());
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("AssetIdTooLong");
      }
    });
  });

  // ============================================================================
  // EDGE CASE TESTS
  // ============================================================================

  describe("Edge Case Tests", () => {
    it("should handle boundary risk score of 0", async () => {
      const assetId = "ZERO/USD";
      const [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );

      const decisionData = `${assetId}:0:false:10000:10`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        decisionHash,
        signature
      );

      const tx = new Transaction();
      tx.add(ed25519Ix);
      tx.add(
        await program.methods
          .updateRiskStatus(
            assetId,
            0,
            false,
            new BN(10000),
            10,
            Array.from(decisionHash) as any,
            Array.from(signature) as any,
            Array.from(trustedSigner.publicKey.toBytes()) as any
          )
          .accounts({
            config: configPDA,
            assetRiskStatus: assetRiskPDA,
            authority: authority.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );

      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
      tx.sign(authority);

      await provider.connection.sendRawTransaction(tx.serialize());
      await new Promise(resolve => setTimeout(resolve, 1000));

      const assetRisk = await program.account.assetRiskStatus.fetch(assetRiskPDA);
      expect(assetRisk.riskScore).to.equal(0);
    });

    it("should handle boundary risk score of 100", async () => {
      const assetId = "MAX/USD";
      const [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );

      const decisionData = `${assetId}:100:true:0:1`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        decisionHash,
        signature
      );

      const tx = new Transaction();
      tx.add(ed25519Ix);
      tx.add(
        await program.methods
          .updateRiskStatus(
            assetId,
            100,
            true,
            new BN(0),
            1,
            Array.from(decisionHash) as any,
            Array.from(signature) as any,
            Array.from(trustedSigner.publicKey.toBytes()) as any
          )
          .accounts({
            config: configPDA,
            assetRiskStatus: assetRiskPDA,
            authority: authority.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );

      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
      tx.sign(authority);

      await provider.connection.sendRawTransaction(tx.serialize());
      await new Promise(resolve => setTimeout(resolve, 1000));

      const assetRisk = await program.account.assetRiskStatus.fetch(assetRiskPDA);
      expect(assetRisk.riskScore).to.equal(100);
      expect(assetRisk.isBlocked).to.be.true;
    });

    it("should handle exactly 16 character asset ID", async () => {
      const assetId = "1234567890123456"; // Exactly 16 chars
      const [assetRiskPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("asset_risk"), Buffer.from(assetId)],
        program.programId
      );

      const decisionData = `${assetId}:50:false:5000:5`;
      const decisionHash = createDecisionHash(decisionData);
      const signature = signMessage(decisionHash, trustedSigner.secretKey);

      const ed25519Ix = createEd25519Instruction(
        trustedSigner.publicKey.toBytes(),
        decisionHash,
        signature
      );

      const tx = new Transaction();
      tx.add(ed25519Ix);
      tx.add(
        await program.methods
          .updateRiskStatus(
            assetId,
            50,
            false,
            new BN(5000),
            5,
            Array.from(decisionHash) as any,
            Array.from(signature) as any,
            Array.from(trustedSigner.publicKey.toBytes()) as any
          )
          .accounts({
            config: configPDA,
            assetRiskStatus: assetRiskPDA,
            authority: authority.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );

      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
      tx.sign(authority);

      await provider.connection.sendRawTransaction(tx.serialize());
      await new Promise(resolve => setTimeout(resolve, 1000));

      const assetRisk = await program.account.assetRiskStatus.fetch(assetRiskPDA);
      expect(assetRisk.riskScore).to.equal(50);
    });
  });
});

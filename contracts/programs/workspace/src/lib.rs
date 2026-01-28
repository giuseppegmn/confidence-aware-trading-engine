use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions::{self, load_instruction_at_checked};

declare_id!("77kRa7xJb2SQpPC1fdFGj8edzm5MJxhq2j54BxMWtPe6");

#[program]
pub mod workspace {
    use super::*;

    // trusted_signer: Pubkey, The CATE engine's public key allowed to sign decisions, 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin
    pub fn initialize_config(ctx: Context<InitializeConfig>, trusted_signer: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.bump = ctx.bumps.config;
        config.authority = ctx.accounts.authority.key();
        config.is_initialized = true;
        config.trusted_signer = trusted_signer;
        
        msg!("CATE Trust Layer v2 initialized with authority: {}, trusted_signer: {}", 
            config.authority, config.trusted_signer);
        Ok(())
    }

    // new_signer: Pubkey, New trusted signer public key, 8xY3pLm9N2kQr4tVbW5cH6jF1dS9uE7vA2mK3nP4xRqJ
    pub fn update_trusted_signer(ctx: Context<UpdateTrustedSigner>, new_signer: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let old_signer = config.trusted_signer;
        config.trusted_signer = new_signer;
        
        msg!("Trusted signer updated from {} to {}", old_signer, new_signer);
        Ok(())
    }

    // asset_id: String, Asset identifier (max 16 chars), SOL/USD
    // risk_score: u8, Risk score 0-100 (higher = riskier), 25
    // is_blocked: bool, Whether trading is blocked, false
    // confidence_ratio: u64, Confidence ratio in basis points (100 = 1%), 9500
    // publisher_count: u8, Number of publishers providing data, 5
    // decision_hash: [u8; 32], Hash of the off-chain decision, [0u8; 32]
    // signature: [u8; 64], Ed25519 signature of decision_hash, [0u8; 64]
    // signer_pubkey: [u8; 32], Public key that signed the decision, [0u8; 32]
    pub fn update_risk_status(
        ctx: Context<UpdateRiskStatus>,
        asset_id: String,
        risk_score: u8,
        is_blocked: bool,
        confidence_ratio: u64,
        publisher_count: u8,
        decision_hash: [u8; 32],
        signature: [u8; 64],
        signer_pubkey: [u8; 32],
    ) -> Result<()> {
        // Validate asset_id length
        require!(asset_id.len() <= 16, ErrorCode::AssetIdTooLong);
        require!(asset_id.len() > 0, ErrorCode::AssetIdEmpty);
        
        // Validate risk_score range
        require!(risk_score <= 100, ErrorCode::InvalidRiskScore);
        
        // Validate confidence_ratio (max 10000 basis points = 100%)
        require!(confidence_ratio <= 10000, ErrorCode::InvalidConfidenceRatio);
        
        // Verify signer_pubkey matches config.trusted_signer
        let config = &ctx.accounts.config;
        let signer_pubkey_key = Pubkey::new_from_array(signer_pubkey);
        require!(
            signer_pubkey_key == config.trusted_signer,
            ErrorCode::InvalidSigner
        );
        
        // Verify Ed25519 signature
        verify_ed25519_signature(
            &ctx.accounts.instructions_sysvar,
            &signer_pubkey,
            &decision_hash,
            &signature,
        )?;
        
        let asset_risk = &mut ctx.accounts.asset_risk_status;
        
        // Set asset_id (padded to 16 bytes)
        let mut asset_id_bytes = [0u8; 16];
        let bytes = asset_id.as_bytes();
        asset_id_bytes[..bytes.len()].copy_from_slice(bytes);
        asset_risk.asset_id = asset_id_bytes;
        
        asset_risk.bump = ctx.bumps.asset_risk_status;
        asset_risk.risk_score = risk_score;
        asset_risk.is_blocked = is_blocked;
        asset_risk.last_updated = Clock::get()?.unix_timestamp;
        asset_risk.confidence_ratio = confidence_ratio;
        asset_risk.publisher_count = publisher_count;
        
        // Store cryptographic proof
        asset_risk.decision_hash = decision_hash;
        asset_risk.signature = signature;
        asset_risk.signer_pubkey = signer_pubkey;
        
        msg!(
            "Updated risk status for {}: score={}, blocked={}, confidence={}bps, publishers={}, signature verified",
            asset_id,
            risk_score,
            is_blocked,
            confidence_ratio,
            publisher_count
        );
        
        Ok(())
    }

    // asset_id: String, Asset identifier to verify, SOL/USD
    // decision_hash: [u8; 32], Hash of the decision to verify, [0u8; 32]
    // signature: [u8; 64], Ed25519 signature to verify, [0u8; 64]
    // signer_pubkey: [u8; 32], Public key that signed, [0u8; 32]
    pub fn verify_decision(
        ctx: Context<VerifyDecision>,
        _asset_id: String,
        decision_hash: [u8; 32],
        signature: [u8; 64],
        signer_pubkey: [u8; 32],
    ) -> Result<()> {
        // Verify signer_pubkey matches config.trusted_signer
        let config = &ctx.accounts.config;
        let signer_pubkey_key = Pubkey::new_from_array(signer_pubkey);
        
        if signer_pubkey_key != config.trusted_signer {
            msg!("Verification failed: signer is not trusted");
            return Err(ErrorCode::InvalidSigner.into());
        }
        
        // Verify Ed25519 signature
        match verify_ed25519_signature(
            &ctx.accounts.instructions_sysvar,
            &signer_pubkey,
            &decision_hash,
            &signature,
        ) {
            Ok(_) => {
                msg!("Signature verification: VALID");
                Ok(())
            }
            Err(_) => {
                msg!("Signature verification: INVALID");
                Err(ErrorCode::InvalidSignature.into())
            }
        }
    }

    // asset_id: String, Asset identifier to query, SOL/USD
    pub fn get_risk_status(ctx: Context<GetRiskStatus>, _asset_id: String) -> Result<()> {
        let asset_risk = &ctx.accounts.asset_risk_status;
        
        // Convert stored bytes back to string for logging
        let asset_id_str = String::from_utf8_lossy(&asset_risk.asset_id)
            .trim_end_matches('\0')
            .to_string();
        
        msg!(
            "Risk Status for {}: score={}, blocked={}, confidence={}bps, publishers={}, last_updated={}",
            asset_id_str,
            asset_risk.risk_score,
            asset_risk.is_blocked,
            asset_risk.confidence_ratio,
            asset_risk.publisher_count,
            asset_risk.last_updated
        );
        
        // Log signature verification data
        msg!("Decision hash present: {}", asset_risk.decision_hash != [0u8; 32]);
        msg!("Signature present: {}", asset_risk.signature != [0u8; 64]);
        
        Ok(())
    }
}

// ============================================================================
// Ed25519 Signature Verification Helper
// ============================================================================

fn verify_ed25519_signature(
    instructions_sysvar: &AccountInfo,
    pubkey: &[u8; 32],
    message: &[u8; 32],
    signature: &[u8; 64],
) -> Result<()> {
    // Check if there's an Ed25519 signature verification instruction
    // The Ed25519 program must be called in the same transaction before this instruction
    
    let current_index = instructions::load_current_index_checked(instructions_sysvar)?;
    
    // Look for Ed25519 verification instruction before current instruction
    if current_index == 0 {
        return Err(ErrorCode::MissingEd25519Instruction.into());
    }
    
    // Check the previous instruction for Ed25519 program
    let ed25519_ix = load_instruction_at_checked((current_index - 1) as usize, instructions_sysvar)?;
    
    // Verify it's the Ed25519 program
    require!(
        ed25519_ix.program_id == ed25519_program::ID,
        ErrorCode::InvalidEd25519Program
    );
    
    // Parse and verify the Ed25519 instruction data
    // Ed25519 instruction format:
    // - 1 byte: number of signatures
    // - 1 byte: padding
    // - For each signature:
    //   - 2 bytes: signature offset
    //   - 2 bytes: signature instruction index
    //   - 2 bytes: public key offset
    //   - 2 bytes: public key instruction index
    //   - 2 bytes: message data offset
    //   - 2 bytes: message data size
    //   - 2 bytes: message instruction index
    
    let ix_data = &ed25519_ix.data;
    require!(ix_data.len() >= 2, ErrorCode::InvalidEd25519Data);
    
    let num_signatures = ix_data[0];
    require!(num_signatures >= 1, ErrorCode::InvalidEd25519Data);
    
    // For simplicity, we verify the first signature matches our expected values
    // The Ed25519 program will have already verified the signature is valid
    // We just need to ensure the correct pubkey, message, and signature were used
    
    // Extract offsets from instruction data (little-endian u16 values)
    let sig_offset = u16::from_le_bytes([ix_data[2], ix_data[3]]) as usize;
    let pubkey_offset = u16::from_le_bytes([ix_data[6], ix_data[7]]) as usize;
    let msg_offset = u16::from_le_bytes([ix_data[10], ix_data[11]]) as usize;
    let msg_size = u16::from_le_bytes([ix_data[12], ix_data[13]]) as usize;
    
    // Verify the signature data matches what we expect
    require!(
        ix_data.len() >= sig_offset + 64,
        ErrorCode::InvalidEd25519Data
    );
    require!(
        ix_data.len() >= pubkey_offset + 32,
        ErrorCode::InvalidEd25519Data
    );
    require!(
        ix_data.len() >= msg_offset + msg_size,
        ErrorCode::InvalidEd25519Data
    );
    
    // Verify pubkey matches
    let ix_pubkey = &ix_data[pubkey_offset..pubkey_offset + 32];
    require!(
        ix_pubkey == pubkey,
        ErrorCode::SignerMismatch
    );
    
    // Verify signature matches
    let ix_signature = &ix_data[sig_offset..sig_offset + 64];
    require!(
        ix_signature == signature,
        ErrorCode::SignatureMismatch
    );
    
    // Verify message (decision_hash) matches
    let ix_message = &ix_data[msg_offset..msg_offset + msg_size];
    require!(
        msg_size == 32 && ix_message == message,
        ErrorCode::MessageMismatch
    );
    
    msg!("Ed25519 signature verified successfully");
    Ok(())
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
pub struct Config {
    pub bump: u8,
    pub authority: Pubkey,
    pub is_initialized: bool,
    pub trusted_signer: Pubkey,
}

impl Config {
    pub const LEN: usize = 1 + 32 + 1 + 32; // bump + authority + is_initialized + trusted_signer
}

#[account]
pub struct AssetRiskStatus {
    pub bump: u8,
    pub asset_id: [u8; 16],
    pub risk_score: u8,
    pub is_blocked: bool,
    pub last_updated: i64,
    pub confidence_ratio: u64,
    pub publisher_count: u8,
    pub decision_hash: [u8; 32],
    pub signature: [u8; 64],
    pub signer_pubkey: [u8; 32],
}

impl AssetRiskStatus {
    pub const LEN: usize = 1 + 16 + 1 + 1 + 8 + 8 + 1 + 32 + 64 + 32;
    // bump + asset_id + risk_score + is_blocked + last_updated + confidence_ratio + publisher_count + decision_hash + signature + signer_pubkey
}

// ============================================================================
// Context Structs
// ============================================================================

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        seeds = [b"config"],
        bump,
        payer = authority,
        space = 8 + Config::LEN
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateTrustedSigner<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.is_initialized @ ErrorCode::NotInitialized,
        constraint = config.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(asset_id: String)]
pub struct UpdateRiskStatus<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.is_initialized @ ErrorCode::NotInitialized,
        constraint = config.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, Config>,
    
    #[account(
        init_if_needed,
        seeds = [b"asset_risk", asset_id.as_bytes()],
        bump,
        payer = authority,
        space = 8 + AssetRiskStatus::LEN
    )]
    pub asset_risk_status: Account<'info, AssetRiskStatus>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// CHECK: Instructions sysvar for Ed25519 verification
    #[account(address = instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(asset_id: String)]
pub struct VerifyDecision<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.is_initialized @ ErrorCode::NotInitialized
    )]
    pub config: Account<'info, Config>,
    
    /// CHECK: Instructions sysvar for Ed25519 verification
    #[account(address = instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(asset_id: String)]
pub struct GetRiskStatus<'info> {
    #[account(
        seeds = [b"asset_risk", asset_id.as_bytes()],
        bump = asset_risk_status.bump
    )]
    pub asset_risk_status: Account<'info, AssetRiskStatus>,
}

// ============================================================================
// Error Codes
// ============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Asset ID exceeds maximum length of 16 characters")]
    AssetIdTooLong,
    #[msg("Asset ID cannot be empty")]
    AssetIdEmpty,
    #[msg("Risk score must be between 0 and 100")]
    InvalidRiskScore,
    #[msg("Confidence ratio must be between 0 and 10000 basis points")]
    InvalidConfidenceRatio,
    #[msg("Program has not been initialized")]
    NotInitialized,
    #[msg("Unauthorized: caller is not the authority")]
    Unauthorized,
    #[msg("Invalid signer: does not match trusted signer")]
    InvalidSigner,
    #[msg("Invalid Ed25519 signature")]
    InvalidSignature,
    #[msg("Missing Ed25519 verification instruction")]
    MissingEd25519Instruction,
    #[msg("Invalid Ed25519 program")]
    InvalidEd25519Program,
    #[msg("Invalid Ed25519 instruction data")]
    InvalidEd25519Data,
    #[msg("Signer pubkey mismatch")]
    SignerMismatch,
    #[msg("Signature mismatch")]
    SignatureMismatch,
    #[msg("Message hash mismatch")]
    MessageMismatch,
}
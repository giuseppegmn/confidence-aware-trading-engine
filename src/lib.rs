use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions::{self, load_instruction_at_checked};

declare_id!("77kRa7xJb2SQpPC1fdFGj8edzm5MJxhq2j54BxMWtPe6");

/// Headers da instrução Ed25519
const ED25519_SIG_LEN: usize = 64;
const ED25519_PUBKEY_LEN: usize = 32;
const ED25519_INSTRUCTION_LEN: usize = 2; // num_signatures + padding
const SIGNATURE_OFFSETS_LEN: usize = 14; // 7 campos de u16 = 14 bytes

#[program]
pub mod workspace {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, trusted_signer: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.bump = ctx.bumps.config;
        config.authority = ctx.accounts.authority.key();
        config.is_initialized = true;
        config.trusted_signer = trusted_signer;
        config.nonce = 0;
        
        // Inicializar contador de decisões usadas
        let used_decisions = &mut ctx.accounts.used_decisions;
        used_decisions.bump = ctx.bumps.used_decisions;
        used_decisions.decisions = Vec::new();
        used_decisions.max_size = 1000;
        
        msg!("CATE Trust Layer initialized. Authority: {}, Signer: {}", 
            config.authority, config.trusted_signer);
        Ok(())
    }

    pub fn update_trusted_signer(ctx: Context<UpdateTrustedSigner>, new_signer: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.authority == ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );
        
        let old_signer = config.trusted_signer;
        config.trusted_signer = new_signer;
        config.nonce = config.nonce.checked_add(1).unwrap_or(0);
        
        msg!("Trusted signer updated: {} -> {}", old_signer, new_signer);
        Ok(())
    }

    pub fn update_risk_status(
        ctx: Context<UpdateRiskStatus>,
        asset_id: String,
        risk_score: u8,
        is_blocked: bool,
        confidence_ratio: u64,
        publisher_count: u8,
        timestamp: i64,
        decision_hash: [u8; 32],
        signature: [u8; 64],
        signer_pubkey: [u8; 32],
    ) -> Result<()> {
        // Validações básicas
        require!(asset_id.len() <= 16, ErrorCode::AssetIdTooLong);
        require!(!asset_id.is_empty(), ErrorCode::AssetIdEmpty);
        require!(risk_score <= 100, ErrorCode::InvalidRiskScore);
        require!(confidence_ratio <= 10000, ErrorCode::InvalidConfidenceRatio);
        
        // Anti-replay: verificar timestamp (5 minutos de tolerância)
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            timestamp >= current_time - 300 && timestamp <= current_time + 60,
            ErrorCode::InvalidTimestamp
        );
        
        // Verificar signer autorizado
        let config = &ctx.accounts.config;
        let signer_pubkey_key = Pubkey::new_from_array(signer_pubkey);
        require!(
            signer_pubkey_key == config.trusted_signer,
            ErrorCode::InvalidSigner
        );
        
        // Verificar se decisão já foi usada (replay protection)
        let used_decisions = &mut ctx.accounts.used_decisions;
        require!(
            !used_decisions.is_used(decision_hash),
            ErrorCode::DecisionAlreadyUsed
        );
        
        // Verificar Ed25519 de forma segura
        verify_ed25519_instruction(
            &ctx.accounts.instructions_sysvar,
            &signer_pubkey,
            &decision_hash,
            &signature,
        )?;
        
        // Marcar como usada
        used_decisions.mark_used(decision_hash, timestamp)?;
        
        // Atualizar estado
        let asset_risk = &mut ctx.accounts.asset_risk_status;
        let mut asset_id_bytes = [0u8; 16];
        let bytes = asset_id.as_bytes();
        asset_id_bytes[..bytes.len().min(16)].copy_from_slice(&bytes[..bytes.len().min(16)]);
        
        asset_risk.asset_id = asset_id_bytes;
        asset_risk.bump = ctx.bumps.asset_risk_status;
        asset_risk.risk_score = risk_score;
        asset_risk.is_blocked = is_blocked;
        asset_risk.last_updated = current_time;
        asset_risk.timestamp = timestamp;
        asset_risk.confidence_ratio = confidence_ratio;
        asset_risk.publisher_count = publisher_count;
        asset_risk.decision_hash = decision_hash;
        asset_risk.signature = signature;
        asset_risk.signer_pubkey = signer_pubkey;
        
        msg!("Risk updated: {} | Score: {} | Blocked: {}", asset_id, risk_score, is_blocked);
        Ok(())
    }

    pub fn verify_decision(
        ctx: Context<VerifyDecision>,
        _asset_id: String,
        timestamp: i64,
        decision_hash: [u8; 32],
        signature: [u8; 64],
        signer_pubkey: [u8; 32],
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let signer_pubkey_key = Pubkey::new_from_array(signer_pubkey);
        
        require!(
            signer_pubkey_key == config.trusted_signer,
            ErrorCode::InvalidSigner
        );
        
        verify_ed25519_instruction(
            &ctx.accounts.instructions_sysvar,
            &signer_pubkey,
            &decision_hash,
            &signature,
        )?;
        
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            timestamp >= current_time - 300,
            ErrorCode::DecisionExpired
        );

        msg!("Verification: VALID");
        Ok(())
    }

    pub fn get_risk_status(ctx: Context<GetRiskStatus>, _asset_id: String) -> Result<AssetRiskStatus> {
        Ok(ctx.accounts.asset_risk_status.clone())
    }
}

// ============================================================================
// Ed25519 Verificação Segura
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct Ed25519SignatureOffsets {
    pub signature_offset: u16,
    pub signature_instruction_index: u16,
    pub public_key_offset: u16,
    pub public_key_instruction_index: u16,
    pub message_data_offset: u16,
    pub message_data_size: u16,
    pub message_instruction_index: u16,
}

impl Ed25519SignatureOffsets {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < SIGNATURE_OFFSETS_LEN {
            return Err(ErrorCode::InvalidEd25519Data.into());
        }
        
        Ok(Self {
            signature_offset: u16::from_le_bytes([bytes[0], bytes[1]]),
            signature_instruction_index: u16::from_le_bytes([bytes[2], bytes[3]]),
            public_key_offset: u16::from_le_bytes([bytes[4], bytes[5]]),
            public_key_instruction_index: u16::from_le_bytes([bytes[6], bytes[7]]),
            message_data_offset: u16::from_le_bytes([bytes[8], bytes[9]]),
            message_data_size: u16::from_le_bytes([bytes[10], bytes[11]]),
            message_instruction_index: u16::from_le_bytes([bytes[12], bytes[13]]),
        })
    }
}

fn verify_ed25519_instruction(
    instructions_sysvar: &AccountInfo,
    expected_pubkey: &[u8; 32],
    expected_message: &[u8; 32],
    expected_signature: &[u8; 64],
) -> Result<()> {
    let current_index = instructions::load_current_index_checked(instructions_sysvar)? as usize;
    require!(current_index > 0, ErrorCode::MissingEd25519Instruction);
    
    let ed25519_ix = load_instruction_at_checked(current_index - 1, instructions_sysvar)?;
    require!(
        ed25519_ix.program_id == ed25519_program::ID,
        ErrorCode::InvalidEd25519Program
    );
    
    let data = &ed25519_ix.data;
    require!(data.len() >= ED25519_INSTRUCTION_LEN, ErrorCode::InvalidEd25519Data);
    
    let num_signatures = data[0] as usize;
    let padding = data[1];
    require!(num_signatures >= 1, ErrorCode::InvalidEd25519Data);
    require!(padding == 0, ErrorCode::InvalidEd25519Data);
    
    let expected_min_len = ED25519_INSTRUCTION_LEN + (SIGNATURE_OFFSETS_LEN * num_signatures);
    require!(data.len() >= expected_min_len, ErrorCode::InvalidEd25519Data);
    
    // Verificar cada assinatura
    for i in 0..num_signatures {
        let offset_start = ED25519_INSTRUCTION_LEN + (SIGNATURE_OFFSETS_LEN * i);
        let offsets = Ed25519SignatureOffsets::from_bytes(&data[offset_start..offset_start + SIGNATURE_OFFSETS_LEN])?;
        
        // Bounds checking seguro (usando checked_add)
        let sig_start = offsets.signature_offset as usize;
        let sig_end = sig_start.checked_add(ED25519_SIG_LEN).ok_or(ErrorCode::SignatureOffsetOverflow)?;
        require!(sig_end <= data.len(), ErrorCode::SignatureOffsetOverflow);
        
        let pubkey_start = offsets.public_key_offset as usize;
        let pubkey_end = pubkey_start.checked_add(ED25519_PUBKEY_LEN).ok_or(ErrorCode::PubkeyOffsetOverflow)?;
        require!(pubkey_end <= data.len(), ErrorCode::PubkeyOffsetOverflow);
        
        let msg_start = offsets.message_data_offset as usize;
        let msg_size = offsets.message_data_size as usize;
        require!(msg_size == 32, ErrorCode::InvalidMessageSize);
        let msg_end = msg_start.checked_add(msg_size).ok_or(ErrorCode::MessageOffsetOverflow)?;
        require!(msg_end <= data.len(), ErrorCode::MessageOffsetOverflow);
        
        // Verificar dados (comparação constant-time)
        let ix_pubkey = &data[pubkey_start..pubkey_end];
        let ix_signature = &data[sig_start..sig_end];
        let ix_message = &data[msg_start..msg_end];
        
        if secure_compare(ix_pubkey, expected_pubkey) 
            && secure_compare(ix_signature, expected_signature)
            && secure_compare(ix_message, expected_message) {
            return Ok(());
        }
    }
    
    Err(ErrorCode::SignatureVerificationFailed.into())
}

/// Comparação constant-time para prevenir timing attacks
fn secure_compare(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut result = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }
    result == 0
}

// ============================================================================
// Accounts
// ============================================================================

#[account]
pub struct Config {
    pub bump: u8,
    pub authority: Pubkey,
    pub is_initialized: bool,
    pub trusted_signer: Pubkey,
    pub nonce: u64,
}

impl Config {
    pub const LEN: usize = 1 + 32 + 1 + 32 + 8;
}

#[account]
#[derive(Clone)]
pub struct AssetRiskStatus {
    pub bump: u8,
    pub asset_id: [u8; 16],
    pub risk_score: u8,
    pub is_blocked: bool,
    pub last_updated: i64,
    pub timestamp: i64,
    pub confidence_ratio: u64,
    pub publisher_count: u8,
    pub decision_hash: [u8; 32],
    pub signature: [u8; 64],
    pub signer_pubkey: [u8; 32],
}

impl AssetRiskStatus {
    pub const LEN: usize = 1 + 16 + 1 + 1 + 8 + 8 + 8 + 1 + 32 + 64 + 32;
}

#[account]
pub struct UsedDecisions {
    pub bump: u8,
    pub decisions: Vec<DecisionRecord>,
    pub max_size: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct DecisionRecord {
    pub hash: [u8; 32],
    pub timestamp: i64,
}

impl UsedDecisions {
    pub const LEN: usize = 1 + 4 + (34 * 1000); // bump + vec + 1000 records
    
    pub fn is_used(&self, hash: [u8; 32]) -> bool {
        self.decisions.iter().any(|d| d.hash == hash)
    }
    
    pub fn mark_used(&mut self, hash: [u8; 32], timestamp: i64) -> Result<()> {
        // Cleanup: remover entradas antigas (> 1 hora)
        let current_time = timestamp;
        self.decisions.retain(|d| current_time - d.timestamp < 3600);
        
        require!(
            (self.decisions.len() as u16) < self.max_size,
            ErrorCode::DecisionHistoryFull
        );
        
        self.decisions.push(DecisionRecord { hash, timestamp });
        Ok(())
    }
}

// ============================================================================
// Contexts
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
    
    #[account(
        init,
        payer = authority,
        seeds = [b"used_decisions"],
        bump,
        space = 8 + UsedDecisions::LEN
    )]
    pub used_decisions: Account<'info, UsedDecisions>,
    
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
#[instruction(asset_id: String, timestamp: i64, decision_hash: [u8; 32])]
pub struct UpdateRiskStatus<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.is_initialized @ ErrorCode::NotInitialized,
        constraint = config.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, Config>,
    
    #[account(
        mut,
        seeds = [b"used_decisions"],
        bump = used_decisions.bump
    )]
    pub used_decisions: Account<'info, UsedDecisions>,
    
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
    
    #[account(address = instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifyDecision<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.is_initialized @ ErrorCode::NotInitialized
    )]
    pub config: Account<'info, Config>,
    
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
// Errors
// ============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Asset ID exceeds 16 characters")]
    AssetIdTooLong,
    #[msg("Asset ID cannot be empty")]
    AssetIdEmpty,
    #[msg("Risk score must be 0-100")]
    InvalidRiskScore,
    #[msg("Confidence ratio must be 0-10000 basis points")]
    InvalidConfidenceRatio,
    #[msg("Invalid timestamp")]
    InvalidTimestamp,
    #[msg("Program not initialized")]
    NotInitialized,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid signer")]
    InvalidSigner,
    #[msg("Invalid Ed25519 signature")]
    InvalidSignature,
    #[msg("Missing Ed25519 instruction")]
    MissingEd25519Instruction,
    #[msg("Invalid Ed25519 program")]
    InvalidEd25519Program,
    #[msg("Invalid Ed25519 data")]
    InvalidEd25519Data,
    #[msg("Signature offset overflow")]
    SignatureOffsetOverflow,
    #[msg("Pubkey offset overflow")]
    PubkeyOffsetOverflow,
    #[msg("Message offset overflow")]
    MessageOffsetOverflow,
    #[msg("Invalid message size")]
    InvalidMessageSize,
    #[msg("Signature verification failed")]
    SignatureVerificationFailed,
    #[msg("Decision already used")]
    DecisionAlreadyUsed,
    #[msg("Decision history full")]
    DecisionHistoryFull,
    #[msg("Decision expired")]
    DecisionExpired,
}

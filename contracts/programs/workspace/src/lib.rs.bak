use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions::{self, load_instruction_at_checked};

declare_id!("2CVGjnZ2BRebSeDHdo3VZknm5jVjxZmWu9m95M14sTN3");

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
        config.nonce = 0; // Inicializa nonce para replay protection
        
        msg!("CATE Trust Layer v2 initialized with authority: {}, trusted_signer: {}", 
            config.authority, config.trusted_signer);
        Ok(())
    }

    pub fn update_trusted_signer(ctx: Context<UpdateTrustedSigner>, new_signer: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let old_signer = config.trusted_signer;
        config.trusted_signer = new_signer;
        
        msg!("Trusted signer updated from {} to {}", old_signer, new_signer);
        Ok(())
    }

    pub fn update_risk_status(
        ctx: Context<UpdateRiskStatus>,
        asset_id: String,
        risk_score: u8,
        is_blocked: bool,
        confidence_ratio: u64,
        publisher_count: u8,
        timestamp: i64, // NOVO: Previne replay attacks
        decision_hash: [u8; 32],
        signature: [u8; 64],
        signer_pubkey: [u8; 32],
    ) -> Result<()> {
        // Validations básicas
        require!(asset_id.len() <= 16, ErrorCode::AssetIdTooLong);
        require!(!asset_id.is_empty(), ErrorCode::AssetIdEmpty);
        require!(risk_score <= 100, ErrorCode::InvalidRiskScore);
        require!(confidence_ratio <= 10000, ErrorCode::InvalidConfidenceRatio);
        
        // Verifica timestamp (evita assinaturas muito antigas)
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            timestamp >= current_time - 300 && timestamp <= current_time + 60,
            ErrorCode::InvalidTimestamp
        );

        // Verifica signer
        let config = &ctx.accounts.config;
        let signer_pubkey_key = Pubkey::new_from_array(signer_pubkey);
        require!(
            signer_pubkey_key == config.trusted_signer,
            ErrorCode::InvalidSigner
        );
        
        // Verifica Ed25519 de forma SEGURA via CPI check
        // A instrução Ed25519 deve estar em current_index - 1
        verify_ed25519_instruction(
            &ctx.accounts.instructions_sysvar,
            &signer_pubkey,
            &decision_hash,
            &signature,
        )?;

        // Replay protection: verifica se este hash já foi usado
        require!(
            !ctx.accounts.used_decisions.is_used(decision_hash),
            ErrorCode::DecisionAlreadyUsed
        );
        
        // Marca como usado
        ctx.accounts.used_decisions.mark_used(decision_hash, timestamp)?;

        let asset_risk = &mut ctx.accounts.asset_risk_status;
        
        // Asset ID com padding seguro
        let mut asset_id_bytes = [0u8; 16];
        let bytes = asset_id.as_bytes();
        asset_id_bytes[..bytes.len().min(16)].copy_from_slice(&bytes[..bytes.len().min(16)]);
        asset_risk.asset_id = asset_id_bytes;
        
        asset_risk.bump = ctx.bumps.asset_risk_status;
        asset_risk.risk_score = risk_score;
        asset_risk.is_blocked = is_blocked;
        asset_risk.last_updated = current_time;
        asset_risk.confidence_ratio = confidence_ratio;
        asset_risk.publisher_count = publisher_count;
        asset_risk.timestamp = timestamp; // Armazena para auditoria
        
        asset_risk.decision_hash = decision_hash;
        asset_risk.signature = signature;
        asset_risk.signer_pubkey = signer_pubkey;
        
        msg!(
            "Updated risk status for {}: score={}, blocked={}, confidence={}bps, publishers={}, ts={}",
            asset_id, risk_score, is_blocked, confidence_ratio, publisher_count, timestamp
        );
        
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
        
        // Verifica se não está expirado (5 minutos de tolerância)
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            timestamp >= current_time - 300,
            ErrorCode::DecisionExpired
        );

        msg!("Decision verification: VALID for timestamp {}", timestamp);
        Ok(())
    }

    pub fn get_risk_status(ctx: Context<GetRiskStatus>, _asset_id: String) -> Result<AssetRiskStatus> {
        let asset_risk = &ctx.accounts.asset_risk_status;
        Ok(asset_risk.clone().into_inner())
    }
}

// ============================================================================
// Verificação Segura de Ed25519
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
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
    
    // Deve haver uma instrução anterior
    require!(current_index > 0, ErrorCode::MissingEd25519Instruction);
    
    // Carrega a instrução anterior
    let ed25519_ix = load_instruction_at_checked(current_index - 1, instructions_sysvar)?;
    
    // Verifica se é o programa Ed25519 oficial
    require!(
        ed25519_ix.program_id == ed25519_program::ID,
        ErrorCode::InvalidEd25519Program
    );
    
    // Parse dos dados da instrução Ed25519
    let data = &ed25519_ix.data;
    require!(data.len() >= ED25519_INSTRUCTION_LEN, ErrorCode::InvalidEd25519Data);
    
    let num_signatures = data[0] as usize;
    let padding = data[1];
    
    require!(num_signatures >= 1, ErrorCode::InvalidEd25519Data);
    require!(padding == 0, ErrorCode::InvalidEd25519Data);
    
    // Calcula o tamanho esperado: header + (offsets * num_signatures) + dados
    let expected_min_len = ED25519_INSTRUCTION_LEN + (SIGNATURE_OFFSETS_LEN * num_signatures);
    require!(data.len() >= expected_min_len, ErrorCode::InvalidEd25519Data);
    
    // Para cada assinatura, verifica se os dados correspondem ao esperado
    for i in 0..num_signatures {
        let offset_start = ED25519_INSTRUCTION_LEN + (SIGNATURE_OFFSETS_LEN * i);
        let offset_end = offset_start + SIGNATURE_OFFSETS_LEN;
        
        let offsets = Ed25519SignatureOffsets::from_bytes(&data[offset_start..offset_end])?;
        
        // Verifica se os dados estão na instrução atual (índice = u16::MAX significa dados na mesma instrução)
        require!(
            offsets.signature_instruction_index == u16::MAX ||
            offsets.signature_instruction_index == (current_index - 1) as u16,
            ErrorCode::InvalidInstructionIndex
        );
        
        // Verifica bounds dos offsets
        let sig_start = offsets.signature_offset as usize;
        let sig_end = sig_start.checked_add(ED25519_SIG_LEN)
            .ok_or(ErrorCode::InvalidEd25519Data)?;
        require!(sig_end <= data.len(), ErrorCode::SignatureOffsetOverflow);
        
        let pubkey_start = offsets.public_key_offset as usize;
        let pubkey_end = pubkey_start.checked_add(ED25519_PUBKEY_LEN)
            .ok_or(ErrorCode::InvalidEd25519Data)?;
        require!(pubkey_end <= data.len(), ErrorCode::PubkeyOffsetOverflow);
        
        let msg_start = offsets.message_data_offset as usize;
        let msg_size = offsets.message_data_size as usize;
        let msg_end = msg_start.checked_add(msg_size)
            .ok_or(ErrorCode::InvalidEd25519Data)?;
        require!(msg_end <= data.len(), ErrorCode::MessageOffsetOverflow);
        require!(msg_size == 32, ErrorCode::InvalidMessageSize);
        
        // Verifica se os dados batem com o esperado
        let ix_signature = &data[sig_start..sig_end];
        let ix_pubkey = &data[pubkey_start..pubkey_end];
        let ix_message = &data[msg_start..msg_end];
        
        // Comparação constant-time (mitiga timing attacks)
        if secure_compare(ix_pubkey, expected_pubkey) 
            && secure_compare(ix_signature, expected_signature)
            && secure_compare(ix_message, expected_message) {
            msg!("Ed25519 signature {} verified successfully", i);
            return Ok(());
        }
    }
    
    // Se chegou aqui, nenhuma assinatura correspondeu
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
// Conta para Replay Protection
// ============================================================================

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
    pub const LEN: usize = 1 + 4 + (34 * 100); // bump + vec len + 100 records
    
    pub fn is_used(&self, hash: [u8; 32]) -> bool {
        self.decisions.iter().any(|d| d.hash == hash)
    }
    
    pub fn mark_used(&mut self, hash: [u8; 32], timestamp: i64) -> Result<()> {
        // Remove entradas antigas (mais de 1 hora) para economizar espaço
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
// Accounts
// ============================================================================

#[account]
pub struct Config {
    pub bump: u8,
    pub authority: Pubkey,
    pub is_initialized: bool,
    pub trusted_signer: Pubkey,
    pub nonce: u64, // Para tracking de operações
}

impl Config {
    pub const LEN: usize = 1 + 32 + 1 + 32 + 8; // + nonce
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
    pub timestamp: i64, // NOVO: quando foi assinado
    pub decision_hash: [u8; 32],
    pub signature: [u8; 64],
    pub signer_pubkey: [u8; 32],
}

impl AssetRiskStatus {
    pub const LEN: usize = 1 + 16 + 1 + 1 + 8 + 8 + 1 + 8 + 32 + 64 + 32; // + timestamp
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
    
    /// CHECK: Instructions sysvar verification
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
    
    /// CHECK: Instructions sysvar verification
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
    #[msg("Asset ID exceeds maximum length of 16 characters")]
    AssetIdTooLong,
    #[msg("Asset ID cannot be empty")]
    AssetIdEmpty,
    #[msg("Risk score must be between 0 and 100")]
    InvalidRiskScore,
    #[msg("Confidence ratio must be between 0 and 10000 basis points")]
    InvalidConfidenceRatio,
    #[msg("Invalid timestamp")]
    InvalidTimestamp,
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
    #[msg("Invalid instruction index in Ed25519 data")]
    InvalidInstructionIndex,
    #[msg("Signature offset overflow")]
    SignatureOffsetOverflow,
    #[msg("Public key offset overflow")]
    PubkeyOffsetOverflow,
    #[msg("Message offset overflow")]
    MessageOffsetOverflow,
    #[msg("Invalid message size")]
    InvalidMessageSize,
    #[msg("Signature verification failed")]
    SignatureVerificationFailed,
    #[msg("Decision hash already used")]
    DecisionAlreadyUsed,
    #[msg("Decision history full")]
    DecisionHistoryFull,
    #[msg("Decision expired")]
    DecisionExpired,
}

use anchor_lang::prelude::*;

declare_id!("E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq");

#[program]
pub mod flux_mandate_registry {
    use super::*;

    pub fn initialize_company(ctx: Context<InitializeCompany>, company_id: [u8; 32]) -> Result<()> {
        let registry = &mut ctx.accounts.company_registry;
        registry.authority = ctx.accounts.authority.key();
        registry.company_id = company_id;
        registry.contract_count = 0;
        registry.mandate_count = 0;
        registry.bump = ctx.bumps.company_registry;
        Ok(())
    }

    pub fn commit_contract(
        ctx: Context<CommitContract>,
        contract_id: [u8; 32],
        document_commitment: [u8; 32],
        terms_commitment: [u8; 32],
        version: u32,
    ) -> Result<()> {
        require!(version > 0, FluxError::InvalidVersion);
        let commitment = &mut ctx.accounts.contract_commitment;
        commitment.company = ctx.accounts.company_registry.key();
        commitment.contract_id = contract_id;
        commitment.document_commitment = document_commitment;
        commitment.terms_commitment = terms_commitment;
        commitment.version = version;
        commitment.approver = ctx.accounts.authority.key();
        commitment.created_at = Clock::get()?.unix_timestamp;
        commitment.status = ContractCommitmentStatus::Active;
        commitment.bump = ctx.bumps.contract_commitment;
        ctx.accounts.company_registry.contract_count = ctx.accounts.company_registry.contract_count.checked_add(1).ok_or(FluxError::Overflow)?;
        Ok(())
    }

    pub fn link_mandate(
        ctx: Context<LinkMandate>,
        mandate_id: [u8; 32],
        obligation_id: [u8; 32],
        agent: Pubkey,
        vendor: Pubkey,
        delegation: Pubkey,
        asset_mint: Pubkey,
        period_cap: u64,
        starts_at: i64,
        expires_at: i64,
    ) -> Result<()> {
        require!(period_cap > 0, FluxError::InvalidCap);
        require!(expires_at > starts_at, FluxError::InvalidWindow);
        let mandate = &mut ctx.accounts.mandate_link;
        mandate.company = ctx.accounts.company_registry.key();
        mandate.contract_commitment = ctx.accounts.contract_commitment.key();
        mandate.mandate_id = mandate_id;
        mandate.obligation_id = obligation_id;
        mandate.agent = agent;
        mandate.vendor = vendor;
        mandate.delegation = delegation;
        mandate.asset_mint = asset_mint;
        mandate.period_cap = period_cap;
        mandate.starts_at = starts_at;
        mandate.expires_at = expires_at;
        mandate.status = MandateStatus::Draft;
        mandate.bump = ctx.bumps.mandate_link;
        ctx.accounts.company_registry.mandate_count = ctx.accounts.company_registry.mandate_count.checked_add(1).ok_or(FluxError::Overflow)?;
        Ok(())
    }

    pub fn set_mandate_status(ctx: Context<SetMandateStatus>, status: MandateStatus) -> Result<()> {
        let mandate = &mut ctx.accounts.mandate_link;
        require!(mandate.status != MandateStatus::Revoked, FluxError::AlreadyRevoked);
        require!(mandate.status != status, FluxError::InvalidTransition);

        let valid_transition = matches!(
            (mandate.status, status),
            (MandateStatus::Draft, MandateStatus::Active)
                | (MandateStatus::Draft, MandateStatus::Revoked)
                | (MandateStatus::Active, MandateStatus::Paused)
                | (MandateStatus::Active, MandateStatus::Expired)
                | (MandateStatus::Active, MandateStatus::Revoked)
                | (MandateStatus::Paused, MandateStatus::Active)
                | (MandateStatus::Paused, MandateStatus::Expired)
                | (MandateStatus::Paused, MandateStatus::Revoked)
                | (MandateStatus::Expired, MandateStatus::Revoked)
        );
        require!(valid_transition, FluxError::InvalidTransition);

        if status == MandateStatus::Active {
            let now = Clock::get()?.unix_timestamp;
            require!(now >= mandate.starts_at && now < mandate.expires_at, FluxError::OutsideActiveWindow);
        }

        mandate.status = status;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(company_id: [u8; 32])]
pub struct InitializeCompany<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + CompanyRegistry::INIT_SPACE, seeds = [b"company", authority.key().as_ref(), company_id.as_ref()], bump)]
    pub company_registry: Account<'info, CompanyRegistry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(contract_id: [u8; 32])]
pub struct CommitContract<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    #[account(mut, has_one = authority)] pub company_registry: Account<'info, CompanyRegistry>,
    #[account(init, payer = authority, space = 8 + ContractCommitment::INIT_SPACE, seeds = [b"contract", company_registry.key().as_ref(), contract_id.as_ref()], bump)]
    pub contract_commitment: Account<'info, ContractCommitment>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(mandate_id: [u8; 32])]
pub struct LinkMandate<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    #[account(mut, has_one = authority)] pub company_registry: Account<'info, CompanyRegistry>,
    #[account(constraint = contract_commitment.company == company_registry.key())]
    pub contract_commitment: Account<'info, ContractCommitment>,
    #[account(init, payer = authority, space = 8 + MandateLink::INIT_SPACE, seeds = [b"mandate", company_registry.key().as_ref(), mandate_id.as_ref()], bump)]
    pub mandate_link: Account<'info, MandateLink>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetMandateStatus<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = authority)] pub company_registry: Account<'info, CompanyRegistry>,
    #[account(mut, constraint = mandate_link.company == company_registry.key())]
    pub mandate_link: Account<'info, MandateLink>,
}

#[account]
#[derive(InitSpace)]
pub struct CompanyRegistry {
    pub authority: Pubkey,
    pub company_id: [u8; 32],
    pub contract_count: u64,
    pub mandate_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ContractCommitment {
    pub company: Pubkey,
    pub contract_id: [u8; 32],
    pub document_commitment: [u8; 32],
    pub terms_commitment: [u8; 32],
    pub version: u32,
    pub approver: Pubkey,
    pub created_at: i64,
    pub status: ContractCommitmentStatus,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MandateLink {
    pub company: Pubkey,
    pub contract_commitment: Pubkey,
    pub mandate_id: [u8; 32],
    pub obligation_id: [u8; 32],
    pub agent: Pubkey,
    pub vendor: Pubkey,
    pub delegation: Pubkey,
    pub asset_mint: Pubkey,
    pub period_cap: u64,
    pub starts_at: i64,
    pub expires_at: i64,
    pub status: MandateStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum ContractCommitmentStatus { Active, Superseded, Revoked }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum MandateStatus { Draft, Active, Paused, Expired, Revoked }

#[error_code]
pub enum FluxError {
    #[msg("Contract version must be positive.")] InvalidVersion,
    #[msg("Period cap must be positive.")] InvalidCap,
    #[msg("Mandate expiry must be after its start.")] InvalidWindow,
    #[msg("The mandate is already revoked.")] AlreadyRevoked,
    #[msg("The requested mandate status transition is not allowed.")] InvalidTransition,
    #[msg("The mandate cannot be activated outside its authorized window.")] OutsideActiveWindow,
    #[msg("Counter overflow.")] Overflow,
}


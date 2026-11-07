use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

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
        period_seconds: i64,
        starts_at: i64,
        expires_at: i64,
    ) -> Result<()> {
        require!(period_cap > 0, FluxError::InvalidCap);
        require!(period_seconds > 0, FluxError::InvalidPeriod);
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
        mandate.period_seconds = period_seconds;
        mandate.starts_at = starts_at;
        mandate.expires_at = expires_at;
        mandate.period_index = 0;
        mandate.spent_in_period = 0;
        mandate.payment_count = 0;
        mandate.status = MandateStatus::Draft;
        mandate.bump = ctx.bumps.mandate_link;
        ctx.accounts.company_registry.mandate_count = ctx.accounts.company_registry.mandate_count.checked_add(1).ok_or(FluxError::Overflow)?;
        Ok(())
    }

    pub fn set_mandate_status(ctx: Context<SetMandateStatus>, status: MandateStatus) -> Result<()> {
        let mandate = &mut ctx.accounts.mandate_link;
        require!(mandate.status != MandateStatus::Revoked, FluxError::AlreadyRevoked);
        require!(mandate.status != status, FluxError::InvalidTransition);

        require!(
            valid_mandate_transition(mandate.status, status),
            FluxError::InvalidTransition
        );

        if status == MandateStatus::Active {
            let now = Clock::get()?.unix_timestamp;
            require!(now >= mandate.starts_at && now < mandate.expires_at, FluxError::OutsideActiveWindow);
        }

        mandate.status = status;
        Ok(())
    }

    pub fn execute_payment(ctx: Context<ExecutePayment>, payment_id: [u8; 32], amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let transition = next_spend_state(&ctx.accounts.mandate_link, now, amount).map_err(spend_rule_error)?;

        let mandate_key = ctx.accounts.mandate_link.key();
        let company = ctx.accounts.mandate_link.company;
        let mandate_id = ctx.accounts.mandate_link.mandate_id;
        let bump = ctx.accounts.mandate_link.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"mandate", company.as_ref(), mandate_id.as_ref(), &[bump]]];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source_token.to_account_info(),
                    mint: ctx.accounts.asset_mint.to_account_info(),
                    to: ctx.accounts.vendor_token.to_account_info(),
                    authority: ctx.accounts.mandate_link.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            ctx.accounts.asset_mint.decimals,
        )?;

        let mandate = &mut ctx.accounts.mandate_link;
        mandate.period_index = transition.period_index;
        mandate.spent_in_period = transition.spent_in_period;
        mandate.payment_count = mandate.payment_count.checked_add(1).ok_or(FluxError::Overflow)?;

        let receipt = &mut ctx.accounts.payment_receipt;
        receipt.mandate = mandate_key;
        receipt.payment_id = payment_id;
        receipt.agent = ctx.accounts.agent.key();
        receipt.vendor = mandate.vendor;
        receipt.asset_mint = mandate.asset_mint;
        receipt.amount = amount;
        receipt.period_index = transition.period_index;
        receipt.executed_at = now;
        receipt.bump = ctx.bumps.payment_receipt;

        emit!(PaymentExecuted {
            mandate: mandate_key,
            payment_receipt: receipt.key(),
            payment_id,
            agent: receipt.agent,
            vendor: receipt.vendor,
            asset_mint: receipt.asset_mint,
            amount,
            period_index: transition.period_index,
            executed_at: now,
        });
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
    #[account(
        constraint = contract_commitment.company == company_registry.key(),
        constraint = contract_commitment.status == ContractCommitmentStatus::Active @ FluxError::ContractInactive
    )]
    pub contract_commitment: Account<'info, ContractCommitment>,
    #[account(init, payer = authority, space = 8 + MandateLink::INIT_SPACE, seeds = [b"mandate", company_registry.key().as_ref(), mandate_id.as_ref()], bump)]
    pub mandate_link: Account<'info, MandateLink>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32], amount: u64)]
pub struct ExecutePayment<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(
        mut,
        has_one = agent @ FluxError::WrongAgent,
        constraint = mandate_link.status == MandateStatus::Active @ FluxError::MandateInactive
    )]
    pub mandate_link: Account<'info, MandateLink>,
    #[account(
        mut,
        constraint = source_token.key() == mandate_link.delegation @ FluxError::WrongSource,
        constraint = source_token.mint == mandate_link.asset_mint @ FluxError::WrongAsset,
        constraint = source_token.delegate.as_ref().map_or(false, |delegate| *delegate == mandate_link.key()) @ FluxError::MissingDelegation,
        constraint = source_token.delegated_amount >= amount @ FluxError::InsufficientDelegatedAllowance,
        constraint = source_token.amount >= amount @ FluxError::InsufficientSourceBalance
    )]
    pub source_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vendor_token.owner == mandate_link.vendor @ FluxError::WrongVendor,
        constraint = vendor_token.mint == mandate_link.asset_mint @ FluxError::WrongAsset
    )]
    pub vendor_token: Account<'info, TokenAccount>,
    #[account(constraint = asset_mint.key() == mandate_link.asset_mint @ FluxError::WrongAsset)]
    pub asset_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = agent,
        space = 8 + PaymentReceipt::INIT_SPACE,
        seeds = [b"payment", mandate_link.key().as_ref(), payment_id.as_ref()],
        bump
    )]
    pub payment_receipt: Account<'info, PaymentReceipt>,
    pub token_program: Program<'info, Token>,
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
    pub period_seconds: i64,
    pub starts_at: i64,
    pub expires_at: i64,
    pub period_index: u64,
    pub spent_in_period: u64,
    pub payment_count: u64,
    pub status: MandateStatus,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PaymentReceipt {
    pub mandate: Pubkey,
    pub payment_id: [u8; 32],
    pub agent: Pubkey,
    pub vendor: Pubkey,
    pub asset_mint: Pubkey,
    pub amount: u64,
    pub period_index: u64,
    pub executed_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum ContractCommitmentStatus { Active, Superseded, Revoked }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum MandateStatus { Draft, Active, Paused, Expired, Revoked }

#[event]
pub struct PaymentExecuted {
    pub mandate: Pubkey,
    pub payment_receipt: Pubkey,
    pub payment_id: [u8; 32],
    pub agent: Pubkey,
    pub vendor: Pubkey,
    pub asset_mint: Pubkey,
    pub amount: u64,
    pub period_index: u64,
    pub executed_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SpendTransition { period_index: u64, spent_in_period: u64 }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SpendRuleError { ZeroAmount, Inactive, OutsideWindow, InvalidPeriod, CapExceeded, Overflow }

fn valid_mandate_transition(current: MandateStatus, requested: MandateStatus) -> bool {
    matches!(
        (current, requested),
        (MandateStatus::Draft, MandateStatus::Active)
            | (MandateStatus::Draft, MandateStatus::Revoked)
            | (MandateStatus::Active, MandateStatus::Paused)
            | (MandateStatus::Active, MandateStatus::Expired)
            | (MandateStatus::Active, MandateStatus::Revoked)
            | (MandateStatus::Paused, MandateStatus::Active)
            | (MandateStatus::Paused, MandateStatus::Expired)
            | (MandateStatus::Paused, MandateStatus::Revoked)
            | (MandateStatus::Expired, MandateStatus::Revoked)
    )
}

fn next_spend_state(mandate: &MandateLink, now: i64, amount: u64) -> core::result::Result<SpendTransition, SpendRuleError> {
    if amount == 0 { return Err(SpendRuleError::ZeroAmount); }
    if mandate.status != MandateStatus::Active { return Err(SpendRuleError::Inactive); }
    if now < mandate.starts_at || now >= mandate.expires_at { return Err(SpendRuleError::OutsideWindow); }
    if mandate.period_seconds <= 0 { return Err(SpendRuleError::InvalidPeriod); }
    let elapsed = now.checked_sub(mandate.starts_at).ok_or(SpendRuleError::Overflow)?;
    let raw_index = elapsed.checked_div(mandate.period_seconds).ok_or(SpendRuleError::InvalidPeriod)?;
    let period_index = u64::try_from(raw_index).map_err(|_| SpendRuleError::Overflow)?;
    let already_spent = if period_index == mandate.period_index { mandate.spent_in_period } else { 0 };
    let spent_in_period = already_spent.checked_add(amount).ok_or(SpendRuleError::Overflow)?;
    if spent_in_period > mandate.period_cap { return Err(SpendRuleError::CapExceeded); }
    Ok(SpendTransition { period_index, spent_in_period })
}

fn spend_rule_error(error: SpendRuleError) -> anchor_lang::error::Error {
    match error {
        SpendRuleError::ZeroAmount => error!(FluxError::InvalidAmount),
        SpendRuleError::Inactive => error!(FluxError::MandateInactive),
        SpendRuleError::OutsideWindow => error!(FluxError::OutsideActiveWindow),
        SpendRuleError::InvalidPeriod => error!(FluxError::InvalidPeriod),
        SpendRuleError::CapExceeded => error!(FluxError::CapExceeded),
        SpendRuleError::Overflow => error!(FluxError::Overflow),
    }
}

#[error_code]
pub enum FluxError {
    #[msg("Contract version must be positive.")] InvalidVersion,
    #[msg("Period cap must be positive.")] InvalidCap,
    #[msg("Period duration must be positive.")] InvalidPeriod,
    #[msg("Payment amount must be positive.")] InvalidAmount,
    #[msg("Mandate expiry must be after its start.")] InvalidWindow,
    #[msg("The mandate is already revoked.")] AlreadyRevoked,
    #[msg("The requested mandate status transition is not allowed.")] InvalidTransition,
    #[msg("The mandate cannot be activated outside its authorized window.")] OutsideActiveWindow,
    #[msg("The contract commitment is not active.")] ContractInactive,
    #[msg("The mandate is not active.")] MandateInactive,
    #[msg("The signer is not the mandate's authorized agent.")] WrongAgent,
    #[msg("The source token account is not bound to this mandate.")] WrongSource,
    #[msg("The payment uses an unauthorized asset mint.")] WrongAsset,
    #[msg("The destination token account is not owned by the authorized vendor.")] WrongVendor,
    #[msg("The mandate PDA is not the approved token-account delegate.")] MissingDelegation,
    #[msg("The SPL delegation allowance is insufficient.")] InsufficientDelegatedAllowance,
    #[msg("The delegated source token account balance is insufficient.")] InsufficientSourceBalance,
    #[msg("The payment exceeds the current period cap.")] CapExceeded,
    #[msg("Counter overflow.")] Overflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mandate() -> MandateLink {
        MandateLink {
            company: Pubkey::new_unique(), contract_commitment: Pubkey::new_unique(), mandate_id: [7; 32], obligation_id: [8; 32],
            agent: Pubkey::new_unique(), vendor: Pubkey::new_unique(), delegation: Pubkey::new_unique(), asset_mint: Pubkey::new_unique(),
            period_cap: 4_000_000, period_seconds: 30 * 24 * 60 * 60, starts_at: 1_000,
            expires_at: 1_000 + (90 * 24 * 60 * 60), period_index: 0, spent_in_period: 0, payment_count: 0,
            status: MandateStatus::Active, bump: 255,
        }
    }

    #[test]
    fn accumulates_inside_period() {
        let mut m = mandate(); m.spent_in_period = 1_260_000;
        assert_eq!(next_spend_state(&m, 2_000, 2_000_000), Ok(SpendTransition { period_index: 0, spent_in_period: 3_260_000 }));
    }

    #[test]
    fn rejects_cap_excess_without_mutation() {
        let m = mandate();
        assert_eq!(next_spend_state(&m, 2_000, 4_000_001), Err(SpendRuleError::CapExceeded));
        assert_eq!(m.spent_in_period, 0);
    }

    #[test]
    fn resets_at_fixed_period_boundary() {
        let mut m = mandate(); m.spent_in_period = m.period_cap;
        assert_eq!(next_spend_state(&m, m.starts_at + m.period_seconds, 500_000), Ok(SpendTransition { period_index: 1, spent_in_period: 500_000 }));
    }

    #[test]
    fn rejects_zero_inactive_and_outside_window() {
        let mut m = mandate();
        assert_eq!(next_spend_state(&m, 2_000, 0), Err(SpendRuleError::ZeroAmount));
        m.status = MandateStatus::Paused;
        assert_eq!(next_spend_state(&m, 2_000, 1), Err(SpendRuleError::Inactive));
        m.status = MandateStatus::Active;
        assert_eq!(next_spend_state(&m, m.expires_at, 1), Err(SpendRuleError::OutsideWindow));
    }

    #[test]
    fn lifecycle_allows_pause_resume_and_terminal_revoke_only() {
        assert!(valid_mandate_transition(MandateStatus::Draft, MandateStatus::Active));
        assert!(valid_mandate_transition(MandateStatus::Active, MandateStatus::Paused));
        assert!(valid_mandate_transition(MandateStatus::Paused, MandateStatus::Active));
        assert!(valid_mandate_transition(MandateStatus::Expired, MandateStatus::Revoked));
        assert!(!valid_mandate_transition(MandateStatus::Draft, MandateStatus::Paused));
        assert!(!valid_mandate_transition(MandateStatus::Revoked, MandateStatus::Active));
        assert!(!valid_mandate_transition(MandateStatus::Active, MandateStatus::Active));
    }
}


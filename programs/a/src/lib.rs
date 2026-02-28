use anchor_lang::prelude::*;

declare_id!("3Dt3BQ2YmiCy6cwqYV8en1i1ES7GduUHsFd6QNmRPNev");

#[program]
pub mod a {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let pda = &mut ctx.accounts.pda;
        pda.user = ctx.accounts.user.key();
        pda.state_root = [0; 32];
        pda.bump = ctx.bumps.pda;
        Ok(())
    }

    pub fn update_state(ctx: Context<UpdateState>, new_root: [u8; 32]) -> Result<()> {
        let pda = &mut ctx.accounts.pda;
        pda.state_root = new_root;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + 32 + 32 + 1, // discriminator (8) + pubkey (32) + hash (32) + bump (1)
        seeds = [b"sovereign_ai", user.key().as_ref()],
        bump
    )]
    pub pda: Account<'info, AiState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateState<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"sovereign_ai", user.key().as_ref()],
        bump = pda.bump,
        has_one = user
    )]
    pub pda: Account<'info, AiState>,
}

#[account]
pub struct AiState {
    pub user: Pubkey,
    pub state_root: [u8; 32],
    pub bump: u8,
}
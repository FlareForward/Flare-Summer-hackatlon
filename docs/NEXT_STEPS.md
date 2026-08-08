# Next Steps

## Before Final Submission

- Record an updated short demo that includes the working Spectra buy and portfolio flow.
- Run `npm run build` after the final docs/app changes.
- Run `npm run lint` after the final docs/app changes.
- Do one final small-value D'CENT, Bifrost, or Xaman demo against the intended Spectra market.
- Execute and record a small PT-to-stXRP sale so the exit path has the same public evidence as the verified buy.

Completed submission items:

- Public demo and presentation links are in `README.md` and `docs/SUBMISSION.md`.
- Production app and GitHub repository URLs are documented.
- A successful mainnet Spectra buy transaction is linked in `docs/SPECTRA.md`.
- The PersonalAccount portfolio displays PT balances by maturity and the latest XRPL-to-Flare execution status.

## Demo Hardening

- Keep the two-minute demo focused on one user, one problem, and one full working flow: XRP wallet to Flare PersonalAccount to Spectra PT.
- Use the verified Spectra market for the clearest multi-protocol story.
- Use the FXRP Carry Vault as the secondary managed-strategy example.
- Use the FXRP/USDT0 LP Carry Vault only if you want to show the advanced live metrics: LP range, leaf value, pool price, debt, and LTV.
- Keep test amounts small and make sure the demo wallet has enough XRP for direct minting fees.
- Confirm the Xaman Developer Console has redirect URIs for the deployed app and local fallback URL.

## Engineering Follow-Ups

- Persist a multi-transaction history; the current dashboard tracks the latest Spectra action with both XRPL and Flare links.
- Add a retry/recovery control for executor failures; the current dashboard displays the typed failure and preserves the operation state.
- Add clearer APY provenance labels for each live APR component.
- Add automated tests for direct-mint memo sizing, split-mode behavior, and Xaman route validation.
- Keep LP vault caps conservative until repeated small Smart Account deposits and withdrawals pass.

## Out Of Scope For This Hackathon Repo

- Publishing private keeper logic.
- Publishing production secrets or `.env.local` files.
- Supporting arbitrary Spectra assets, YT trading, or automated PT trading.
- Requiring the target XRP user to connect an EVM wallet for the main flow.

# Next Steps

## Before Final Submission

- Add the public demo video link to `README.md` and `docs/SUBMISSION.md`.
- Add the public presentation link to `README.md` and `docs/SUBMISSION.md`.
- Add the production app URL if the project is deployed before submission.
- Run `npm run build` after the final docs/app changes.
- Run `npm run lint` after the final docs/app changes.
- Do one final small-value Xaman or D'CENT demo against the intended vault and account.

## Demo Hardening

- Keep the two-minute demo focused on one user, one problem, and one full working flow: XRP wallet to Flare Smart Account to vault shares.
- Use the FXRP Carry Vault for the clearest beginner story.
- Use the FXRP/USDT0 LP Carry Vault only if you want to show the advanced live metrics: LP range, leaf value, pool price, debt, and LTV.
- Keep test amounts small and make sure the demo wallet has enough XRP for direct minting fees.
- Confirm the Xaman Developer Console has redirect URIs for the deployed app and local fallback URL.

## Engineering Follow-Ups

- Add production recovery UI for stuck `0xFE` committed UserOps.
- Add richer transaction history so users can see the XRPL tx and eventual Flare execution together.
- Add clearer APY provenance labels for each live APR component.
- Add automated tests for direct-mint memo sizing, split-mode behavior, and Xaman route validation.
- Keep LP vault caps conservative until repeated small Smart Account deposits and withdrawals pass.

## Out Of Scope For This Hackathon Repo

- Publishing private keeper logic.
- Publishing production secrets or `.env.local` files.
- Turning the UI into a general-purpose vault dashboard.
- Requiring the target XRP user to connect an EVM wallet for the main flow.

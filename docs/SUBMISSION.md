# Submission Guide

## Links To Fill In

- Demo video: add public link here.
- Presentation: add public link here.
- Live app: add deployed URL here, if available.
- Repository: add GitHub URL here, if needed by the submission form.

## One-Sentence Pitch

Flare Vault Gateway lets XRP holders use Xaman or D'CENT to direct-mint FXRP and enter Flare yield vaults through Flare Smart Accounts, without setting up a separate Flare wallet.

## Two-Minute Demo Script

1. Show the problem: the user has an XRPL wallet and wants Flare DeFi access without EVM wallet setup.
2. Connect Xaman or D'CENT.
3. Show the resolved Flare Smart Account and balances.
4. Select the FXRP Carry Vault.
5. Enter a small XRP amount.
6. Sign the XRPL Payment to the FXRP Core Vault.
7. Show the transaction dialog and XRPL transaction result.
8. Show balances updating on Flare, especially vault shares.
9. Briefly open the LP Carry Vault card to show live Flare metrics if time remains.

## What Judges Should Notice

- The user signs from an XRPL wallet, not an EVM wallet.
- The XRPL payment direct-mints FXRP through FAssets.
- The memo carries a Smart Account UserOp for Flare execution.
- The app reads and displays live Flare vault state.
- The product has one clear working flow: XRP capital into a Flare vault position.

## Verification Checklist

- `npm install` completes.
- `npm run build` completes.
- `npm run lint` completes.
- `apps/web/.env.example` lists required and optional configuration.
- Xaman OAuth redirect URI is registered for the demo URL.
- Xaman payload credentials are configured server-side for sign requests.
- Demo wallet has enough XRP for the intended direct-mint payment and fees.
- Demo account resolves to a non-zero Flare PersonalAccount.
- At least one small-value vault entry has been recorded or verified before submission.

## Submission Copy

Use or adapt this text in the hackathon form:

Flare Vault Gateway is an XRPL-to-Flare vault entry app. It lets an XRP holder connect Xaman or D'CENT, resolve their Flare Smart Account, direct-mint FXRP from an XRP payment, and deposit that FXRP into Flare carry vaults. The product uses FAssets for XRP-to-FXRP minting, Flare Smart Accounts for XRPL-controlled execution, FDC-enabled relay semantics for the signed XRPL payment, and live Flare reads for vault APR, TVL, debt, LTV, LP range, and balances.

# Submission Guide

## Submission Links

- Demo video: https://youtu.be/RA7R3PjkLA0
- Full presentation: https://www.youtube.com/watch?v=epECZjT5so4
- Live app: https://flaresummer.flareforward.com
- Repository: https://github.com/FlareForward/Flare-Summer-hackatlon
- Verified Spectra transaction: https://flare-explorer.flare.network/tx/0xd6aa8a2d7d1e5103c0faf1a8f2ef7bcddbe78a67db140082ef1d28877ac42e5e

## One-Sentence Pitch

Flare Vault Gateway lets XRP holders use D'CENT, Bifrost, or Xaman to direct-mint FXRP, buy Spectra fixed-rate Principal Tokens, and access Flare yield vaults through Flare Smart Accounts without setting up a separate EVM wallet.

## Two-Minute Demo Script

1. Show the problem: the user has an XRPL wallet and wants Flare DeFi access without EVM wallet setup.
2. Connect D'CENT, Bifrost, or Xaman.
3. Show the resolved Flare PersonalAccount and Spectra portfolio.
4. Open an eligible Spectra stXRP Principal Token market.
5. Enter a small XRP amount and show the live quote, minimum received, price impact, pool-use limit, and maturity.
6. Sign the XRPL Payment to the FXRP Core Vault.
7. Show the execution status moving from XRPL confirmation to the Flare transaction.
8. Show the PT appearing in the portfolio under the correct maturity.
9. Open the position's Sell action and explain that selling returns stXRP to the PersonalAccount.
10. If time remains, show the FXRP vault cards and their live Flare metrics.

## What Judges Should Notice

- The user signs from an XRPL wallet, not an EVM wallet.
- The XRPL payment direct-mints FXRP through FAssets.
- The memo carries a Smart Account UserOp for Flare execution.
- The app performs a real multi-protocol route: FAssets FXRP to Firelight stXRP to Spectra PT.
- The app reads live Spectra pools, quotes, safeguards, PersonalAccount balances, and transaction receipts.
- A successful mainnet transaction delivered `5.330458 PT-stXRP(FXRP)-2027/09/30` to the user's PersonalAccount.

## Verification Checklist

- `npm install` completes.
- `npm run build` completes.
- `npm run lint` completes.
- `apps/web/.env.example` lists required and optional configuration.
- Xaman OAuth redirect URI is registered for the demo URL.
- Xaman payload credentials are configured server-side for sign requests.
- WalletConnect project ID is configured if Bifrost is used in the demo.
- Direct-mint executor health check succeeds for the one-signature Spectra route.
- Demo wallet has enough XRP for the intended direct-mint payment and fees.
- Demo account resolves to a non-zero Flare PersonalAccount.
- Verified Spectra buy transaction is linked in `docs/SPECTRA.md`.
- Demo account still holds or can display the verified PT position.

## Submission Copy

Use or adapt this text in the hackathon form:

Flare Vault Gateway is an XRPL-native gateway to Flare DeFi. An XRP holder connects D'CENT, Bifrost, or Xaman, resolves an XRPL-controlled Flare PersonalAccount, and authorizes protocol actions with an XRPL payment instead of a separate EVM wallet. The working Spectra flow direct-mints XRP into FXRP through FAssets, deposits FXRP into Firelight stXRP, and exchanges stXRP for a chosen Spectra Principal Token. The app discovers and validates eligible markets, enforces liquidity, pool-use, price-impact, and slippage limits, and displays the resulting PT by maturity in an on-chain portfolio with XRPL and Flare transaction status. The same Smart Account interface also exposes the project's FXRP carry and LP vaults.

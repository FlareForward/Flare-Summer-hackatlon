# Flare Summer Vault Gateway

XRPL users can enter Flare yield vaults without first learning EVM wallets, bridges, or transaction routing. The app connects a Xaman or D'CENT XRPL wallet, resolves the user's Flare Smart Account, direct-mints FXRP from an XRP payment, and executes vault calls from that Smart Account.

This repository is the public hackathon submission surface. It includes the user-facing app, the vault contracts needed to understand the strategy, and documentation for judges. It intentionally excludes private keeper code, private deployment secrets, and production runtime services.

## Submission

- Demo video: https://youtu.be/RA7R3PjkLA0
- Full presentation: https://www.youtube.com/watch?v=epECZjT5so4
- Submission checklist and demo script: [docs/SUBMISSION.md](docs/SUBMISSION.md)
- Architecture notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Remaining work: [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md)

## Product

Flare Vault Gateway solves one problem: an XRP holder should be able to put XRP capital to work in Flare DeFi from the wallet they already use.

The main working flow is:

1. Connect Xaman or D'CENT, or paste an XRPL address for read-only inspection.
2. Resolve the XRPL account to its Flare Smart Account through `MasterAccountController`.
3. Read XRPL XRP, Smart Account FXRP, USDT0, vault shares, surplus, live APR, TVL, debt, LTV, and LP status.
4. Select a vault and enter an XRP amount.
5. Sign an XRPL Payment to the FXRP Core Vault.
6. The payment memo carries a Flare Smart Account UserOp that approves and deposits the newly minted FXRP.
7. The UI polls Xaman/D'CENT result state, then polls Flare balances until the Smart Account position updates.

## Flare Integration

The project depends on Flare primitives in the product path, not as a passive add-on:

- **FAssets / FXRP:** native XRP is direct-minted into FXRP through the FXRP AssetManager and Core Vault.
- **Flare Smart Accounts:** XRPL signatures control a Flare `PersonalAccount`, so the user does not need a separate Flare wallet for the demo flow.
- **FDC-enabled execution:** the signed XRPL payment is the source event that the Smart Account operator can prove and relay on Flare.
- **Flare DeFi:** the Smart Account deposits FXRP into deployed carry vaults and manages withdrawals, surplus claims, swaps, and redemption.
- **Live on-chain reads:** the UI reads vault state, Kinetic/Morpho borrow state, SparkDEX pool price, and ERC-4626 LP leaf performance directly from Flare.

## Vaults In Scope

| Vault | Status | Demo Actions |
| --- | --- | --- |
| FXRP Carry Vault | Live | Mint and enter, deposit existing FXRP, withdraw shares to FXRP, claim USDT0 surplus, swap surplus to FXRP, redeem FXRP to XRPL XRP |
| FXRP/USDT0 LP Carry Vault | Live for small tests | Mint and enter, deposit existing FXRP, withdraw shares, inspect LP range, leaf value, pool price, debt, and LTV |

The LP vault is higher risk and more complex than the plain carry vault. It is enabled for the hackathon demo, but the README and UI frame it as a more advanced opportunity.

## Repository Layout

```text
apps/web/          Next.js app for the hackathon UI
contracts/src/     Solidity vault contracts relevant to the public demo
contracts/script/  Reference deployment scripts
docs/              Submission, architecture, and next-step notes
```

## Run Locally

```bash
npm install
npm run dev
```

Then open the local Next.js URL, usually `http://localhost:3000`.

Useful scripts:

```bash
npm run build
npm run lint
```

`npm run lint` is currently a TypeScript check (`tsc --noEmit`) for the web app.

## Environment

Create `apps/web/.env.local` from [apps/web/.env.example](apps/web/.env.example).

Required for the full Xaman demo:

- `NEXT_PUBLIC_XUMM_API_KEY` - public Xaman OAuth key for connecting the wallet.
- `XUMM_API_KEY` / `XUMM_API_SECRET` - server-only credentials for creating Xaman sign requests.

Optional overrides:

- `NEXT_PUBLIC_FLARE_RPC_URL` - Flare RPC, defaults to the public Flare RPC.
- `XRPL_RPC_URL` / `NEXT_PUBLIC_XRPL_RPC_URL` - XRPL JSON-RPC endpoint for XRP balance reads.
- `NEXT_PUBLIC_MASTER_ACCOUNT_CONTROLLER` - Flare Smart Accounts controller.
- `NEXT_PUBLIC_ASSET_MANAGER_FXRP` - FXRP AssetManager.
- `NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL` - executor endpoint for compact `0xFE` direct-mint UserOps when inline memos are too large.
- `NEXT_PUBLIC_FLARE_CONTRACT_REGISTRY` - registry override for future reads.
- `NEXT_PUBLIC_CARRY_FXRP_VAULT` - FXRP Carry Vault override.
- `NEXT_PUBLIC_CARRY_FXRP_USDT0_LP_VAULT` - FXRP/USDT0 LP Carry Vault override.

For Xaman OAuth, register each app origin in the Xaman Developer Console, including `http://localhost:3000` for local demos and the deployed production URL.

## Verification Path

For judges or reviewers:

1. Run `npm install` and `npm run build`.
2. Start the web app with the env vars above.
3. Connect Xaman or D'CENT.
4. Confirm the app resolves a Flare Smart Account from the XRPL address.
5. Select a vault, enter a small XRP amount, and sign the direct-mint payment.
6. Watch the transaction dialog show the XRPL signature result.
7. Refresh/poll balances until FXRP, vault shares, USDT0, or surplus state changes on Flare.

The app never asks the target user to connect MetaMask, Rabby, Bifrost, or another EVM wallet for the main flow.

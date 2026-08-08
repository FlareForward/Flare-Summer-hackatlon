# Flare Summer Vault Gateway

XRPL users can access Flare DeFi without first learning EVM wallets, bridges, or transaction routing. The app connects D'CENT, Bifrost, or Xaman, resolves the user's Flare Smart Account, direct-mints FXRP from an XRP payment, and executes user-approved protocol calls from that account.

This repository is the public hackathon submission surface. It includes the user-facing app, the vault contracts needed to understand the strategy, and documentation for judges. It intentionally excludes private keeper code, private deployment secrets, and production runtime services.

## Submission

- Demo video: https://youtu.be/RA7R3PjkLA0
- Full presentation: https://www.youtube.com/watch?v=epECZjT5so4
- Live app: https://flaresummer.flareforward.com
- Repository: https://github.com/FlareForward/Flare-Summer-hackatlon
- Submission checklist and demo script: [docs/SUBMISSION.md](docs/SUBMISSION.md)
- Architecture notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Spectra implementation and verification: [docs/SPECTRA.md](docs/SPECTRA.md)
- Landing-page fixed-yield upgrade plan: [docs/LANDING_PAGE_FIXED_YIELD_PLAN.md](docs/LANDING_PAGE_FIXED_YIELD_PLAN.md)
- Remaining work: [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md)
- Steer on SparkDEX plan: [docs/STEER_SPARKDEX_SMART_ACCOUNT_PLAN.md](docs/STEER_SPARKDEX_SMART_ACCOUNT_PLAN.md)

## Product

Flare Vault Gateway solves one problem: an XRP holder should be able to put XRP capital to work in Flare DeFi from the wallet they already use. The working app combines managed FXRP vault access with direct Spectra Principal Token trading.

The main working flow is:

1. Connect D'CENT, Bifrost, or Xaman, or paste an XRPL address for read-only inspection.
2. Resolve the XRPL account to its Flare Smart Account through `MasterAccountController`.
3. Choose a managed FXRP vault or an eligible Spectra PT market.
4. Review live Flare balances, protocol state, quotes, limits, and the exact expected output.
5. Sign an XRPL Payment containing the Flare Smart Account UserOperation.
6. Follow the operation through XRPL confirmation, Flare submission, and final portfolio balance changes.

### Working Spectra flow

The Spectra marketplace discovers active Flare pools with at least `$100,000` liquidity, verifies their token ordering on-chain, and quotes buys and sells using the pool's live `get_dy` result. Users can direct-mint XRP into FXRP, deposit into Firelight stXRP, and buy PT in one Smart Account operation. The portfolio then displays PT holdings by maturity and provides a sell path back to stXRP.

Verified mainnet buy: [`0xd6aa8a2d7d1e5103c0faf1a8f2ef7bcddbe78a67db140082ef1d28877ac42e5e`](https://flare-explorer.flare.network/tx/0xd6aa8a2d7d1e5103c0faf1a8f2ef7bcddbe78a67db140082ef1d28877ac42e5e), which delivered `5.330458 PT-stXRP(FXRP)-2027/09/30` to the user's PersonalAccount.

## Flare Integration

The project depends on Flare primitives in the product path, not as a passive add-on:

- **FAssets / FXRP:** native XRP is direct-minted into FXRP through the FXRP AssetManager and Core Vault.
- **Flare Smart Accounts:** XRPL signatures control a Flare `PersonalAccount`, so the user does not need a separate Flare wallet for the demo flow.
- **FDC-enabled execution:** the signed XRPL payment is the source event that the Smart Account operator can prove and relay on Flare.
- **Flare DeFi:** the Smart Account can enter managed FXRP vaults or interact directly with Spectra PT pools and Firelight stXRP.
- **Live on-chain reads:** the UI reads vault state, Kinetic/Morpho borrow state, SparkDEX pool price, Spectra quotes, token balances, allowances, and PT positions directly from Flare.

## Spectra Marketplace

| Capability | Status |
| --- | --- |
| Discover and validate eligible Flare PT pools | Working |
| XRP/FXRP to stXRP to PT buy | Working; mainnet transaction verified |
| PersonalAccount PT portfolio by maturity | Working |
| XRPL-to-Flare execution progress and explorer links | Working |
| PT sell to stXRP | Implemented in the UI |

See [docs/SPECTRA.md](docs/SPECTRA.md) for the call plan, safeguards, code map, and mainnet verification evidence.

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
direct-mint-executor/ Allow-listed 0xFE UserOp executor and status service
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
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` - WalletConnect project ID used by Bifrost's XRPL connection.
- `NEXT_PUBLIC_FLARE_CONTRACT_REGISTRY` - registry override for future reads.
- `NEXT_PUBLIC_CARRY_FXRP_VAULT` - FXRP Carry Vault override.
- `NEXT_PUBLIC_CARRY_FXRP_USDT0_LP_VAULT` - FXRP/USDT0 LP Carry Vault override.

For Xaman OAuth, register each app origin in the Xaman Developer Console, including `http://localhost:3000` for local demos and the deployed production URL.

Configure `NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL` for the one-signature Spectra direct-mint route. Without it, the app can fall back to multiple inline instruction signatures only when every individual call fits XRPL's memo limit.

## Verification Path

For judges or reviewers:

1. Run `npm install` and `npm run build`.
2. Start the web app with the env vars above.
3. Connect D'CENT, Bifrost, or Xaman.
4. Confirm the app resolves a Flare Smart Account from the XRPL address.
5. Open the Spectra marketplace and select an eligible PT maturity.
6. Enter a small XRP amount, review the quote and limits, and sign the direct-mint payment.
7. Watch the portfolio show the XRPL stage, Flare transaction, and final PT balance.
8. Use the position's Sell action to prepare a PT-to-stXRP exit quote.

The app never asks the target user to connect an EVM account. Bifrost support uses its XRPL WalletConnect namespace, not an EVM signature.

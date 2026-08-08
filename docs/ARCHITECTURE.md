# Architecture

## Product Boundary

Flare Vault Gateway is a hackathon app for XRPL wallet holders who want to use Flare DeFi without operating a separate Flare EVM wallet. The app turns an XRPL wallet signature into Flare Smart Account execution, then uses that account for direct protocol interactions and managed FXRP vault positions.

The repository contains only the public submission surface:

- Next.js web app for the D'CENT, Bifrost, and Xaman Smart Account flow.
- Allow-listed direct-mint executor for large hash-committed UserOperations.
- Public vault contracts needed to understand the carry and LP strategies.
- Reference deployment scripts.
- Documentation for judges and reviewers.

It does not include private keeper code, production automation, private deployment environment files, or private strategy repositories.

## Spectra Main Flow

1. User connects D'CENT, Bifrost, or Xaman.
2. The UI calls `MasterAccountController.getPersonalAccount(xrplAddress)` on Flare.
3. The UI reads the PersonalAccount's PT, FXRP, and stXRP balances and loads active Spectra Flare markets.
4. Market parsing filters for unexpired FXRP-underlying pools with at least `$100,000` liquidity.
5. The UI independently verifies `coins(0)` and `coins(1)` on Flare and obtains a live `get_dy` quote.
6. User selects a maturity, enters XRP or existing FXRP, and reviews minimum output, average price, price impact, pool usage, and slippage.
7. The UI builds the Flare call plan: approve FXRP if needed, deposit into Firelight stXRP, approve stXRP if needed, and exchange stXRP for PT.
8. The UI reads direct-mint fees and the FXRP Core Vault destination from `AssetManagerFXRP`.
9. D'CENT, Bifrost, or Xaman signs the XRPL Payment carrying or committing to the Smart Account UserOperation.
10. The Smart Account operator proves/relays the XRPL event and executes the calls atomically on Flare.
11. The portfolio follows XRPL and Flare status and refreshes the PT balance under the correct maturity.

The verified transaction and exact code map are documented in [SPECTRA.md](SPECTRA.md).

## Vault Flow

The existing vault path uses the same wallet, PersonalAccount, fee discovery, memo encoding, and execution rail. Its call plan normally approves FXRP and deposits it into the selected vault. The UI then reads FXRP, USDT0, vault shares, surplus, APR, debt, LTV, and LP state directly from Flare.

## Direct-Mint Memo Modes

The entry path uses Flare Smart Account direct-mint UserOps, not a separate EVM wallet transaction.

- `0xFF` inline memo: used when the packed UserOp fits inside XRPL memo limits.
- `0xFE` hash-committed memo: used when the UserOp is too large and `NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL` is configured.
- Split inline mode: fallback when individual calls fit but a single combined memo does not.

For `0xFE`, the browser registers the complete UserOperation before wallet signing. The executor recomputes the hash, decodes the calls, enforces its address/function allow-list, watches for the matching XRPL payment, obtains the FDC proof, submits the Flare transaction, and exposes a status endpoint to the UI.

The older `encodeCustomInstruction` reference path remains useful for some memo-only management actions and debugging, but the main vault entry path is direct mint from XRP into FXRP plus Smart Account vault execution.

## Wallet Support

- **D'CENT:** direct XRPL signing when the wallet injects `window.xrpl`, especially in the D'CENT in-app browser.
- **Bifrost:** XRPL signing through WalletConnect's `xrpl:0` namespace. It does not request an EVM account.
- **Xaman:** OAuth connection plus server-created Payment payloads and status polling. Xaman credentials stay on the server API route.
- **Manual XRPL address:** read-only fallback for vault Smart Account and balance inspection.
- **EVM wallets:** not required for the target user flow. They are only useful for operator, contract, or debugging work outside the normal demo.

## Vault Layer

The app presents two live vault opportunities:

- **FXRP Carry Vault:** borrows USDT0 against FXRP collateral and seeks carry yield through configured venues.
- **FXRP/USDT0 LP Carry Vault:** adds concentrated LP exposure on top of the carry trade and displays LP range, leaf value, current pool price, debt, and LTV.

Both vaults use FXRP as the user entry asset in the app. Management actions are generated as Smart Account calls, including deposit existing FXRP, withdraw shares, claim surplus, swap USDT0 surplus to FXRP, and redeem FXRP back to XRPL XRP.

## Direct Protocol Layer

Spectra is deliberately independent of the managed vault layer. The app discovers eligible PT pools, verifies pool token ordering, obtains live quotes, and builds direct pool interactions from the user's PersonalAccount. There is no project keeper, strategy vault, or automatic entry/exit between the user and Spectra.

The buy route composes three Flare systems in one user-authorized operation:

1. FAssets direct-mints XRP into FXRP.
2. Firelight deposits FXRP and issues stXRP.
3. Spectra exchanges stXRP for the selected maturity's PT.

Selling reverses only the Spectra leg and returns stXRP to the PersonalAccount.

## Server Routes

The app has only minimal server-side routes:

- `POST /api/xaman/payload` creates a Xaman Payment payload with the destination, amount, and memo supplied by the UI.
- `GET /api/xaman/payload/[uuid]` polls Xaman payload status.
- `GET /api/xrpl/account?account=r...` reads the XRPL XRP balance from a JSON-RPC endpoint.
- `GET /api/spectra/markets` fetches Spectra's Flare market data and applies the submission's eligibility filters.

The separately deployed `direct-mint-executor` service provides:

- `POST /` to validate and register a hash-committed UserOperation;
- `GET /status?userOpHash=0x...` to report registration, Flare submission, transaction hash, or a typed failure;
- `GET /health` for deployment health checks.

There is no keeper backend in this repo. The keeper and production automation live outside the public hackathon submission.

## Product Readiness Rules

A vault should stay enabled only when all of these remain true:

- vault address is final for the demo network;
- deposits are open for the intended test size;
- keeper/operator behavior is stable enough for a recorded demo;
- expected share and balance changes are visible on Flare after execution;
- UI claims match the deployed vault risk and runtime state.

A Spectra market is displayed only when it is active, uses the supported FXRP underlying, meets the liquidity floor, and its on-chain pool tokens match the API metadata. Trades are additionally blocked above the configured pool-use or price-impact limits.

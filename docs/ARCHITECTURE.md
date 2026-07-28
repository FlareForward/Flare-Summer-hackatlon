# Architecture

## Product Boundary

Flare Vault Gateway is a hackathon app for XRPL wallet holders who want to use Flare DeFi without operating a separate Flare EVM wallet. The app turns an XRPL wallet signature into Flare Smart Account execution, then uses that account to enter and manage FXRP vault positions.

The repository contains only the public submission surface:

- Next.js web app for the Xaman/D'CENT Smart Account flow.
- Public vault contracts needed to understand the carry and LP strategies.
- Reference deployment scripts.
- Documentation for judges and reviewers.

It does not include private keeper code, production automation, private deployment environment files, or private strategy repositories.

## Main Flow

1. User connects Xaman or D'CENT, or pastes an XRPL address for read-only lookup.
2. The UI calls `MasterAccountController.getPersonalAccount(xrplAddress)` on Flare.
3. The UI reads the PersonalAccount's FXRP, USDT0, vault share, and surplus balances.
4. The UI reads live vault metrics directly on chain: total assets, debt, LTV, borrow state, LP leaf state, and SparkDEX FXRP/USDT0 pool price.
5. User selects a vault and enters an XRP amount.
6. The UI builds the Flare call plan, usually:
   - `FXRP.approve(vault, amount)`
   - `vault.deposit(amount)`
7. The UI reads FXRP direct-mint fees and destination from `AssetManagerFXRP`.
8. The UI encodes a `PersonalAccount.executeUserOp` call into a direct-mint memo.
9. Xaman or D'CENT signs an XRPL Payment to the FXRP Core Vault.
10. The Smart Account operator proves/relays the XRPL event and executes the UserOp on Flare.
11. The UI polls balances until FXRP, shares, USDT0, or surplus changes.

## Direct-Mint Memo Modes

The entry path uses Flare Smart Account direct-mint UserOps, not a separate EVM wallet transaction.

- `0xFF` inline memo: used when the packed UserOp fits inside XRPL memo limits.
- `0xFE` hash-committed memo: used when the UserOp is too large and `NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL` is configured.
- Split inline mode: fallback for D'CENT when separate approve/deposit memos fit but a single combined memo does not.

The older `encodeCustomInstruction` reference path remains useful for some memo-only management actions and debugging, but the main vault entry path is direct mint from XRP into FXRP plus Smart Account vault execution.

## Wallet Support

- **Xaman:** OAuth account connection plus server-side payload creation for signing XRPL Payments. Xaman credentials stay on the server API route.
- **D'CENT:** direct XRPL signing when the wallet injects `window.xrpl`, especially in the D'CENT in-app browser.
- **Manual XRPL address:** read-only fallback for Smart Account and balance inspection.
- **EVM wallets:** not required for the target user flow. They are only useful for operator, contract, or debugging work outside the normal demo.

## Vault Layer

The app presents two live vault opportunities:

- **FXRP Carry Vault:** borrows USDT0 against FXRP collateral and seeks carry yield through configured venues.
- **FXRP/USDT0 LP Carry Vault:** adds concentrated LP exposure on top of the carry trade and displays LP range, leaf value, current pool price, debt, and LTV.

Both vaults use FXRP as the user entry asset in the app. Management actions are generated as Smart Account calls, including deposit existing FXRP, withdraw shares, claim surplus, swap USDT0 surplus to FXRP, and redeem FXRP back to XRPL XRP.

## Server Routes

The app has only minimal server-side routes:

- `POST /api/xaman/payload` creates a Xaman Payment payload with the destination, amount, and memo supplied by the UI.
- `GET /api/xaman/payload/[uuid]` polls Xaman payload status.
- `GET /api/xrpl/account?account=r...` reads the XRPL XRP balance from a JSON-RPC endpoint.

There is no keeper backend in this repo. The keeper and production automation live outside the public hackathon submission.

## Product Readiness Rules

A vault should stay enabled only when all of these remain true:

- vault address is final for the demo network;
- deposits are open for the intended test size;
- keeper/operator behavior is stable enough for a recorded demo;
- expected share and balance changes are visible on Flare after execution;
- UI claims match the deployed vault risk and runtime state.

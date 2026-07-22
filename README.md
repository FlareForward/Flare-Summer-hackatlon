# Flare Summer Vault Gateway

Hackathon UI for XRP users who want to access Flare vault products through Flare Smart Accounts.

This repo intentionally includes only the public hackathon surface:

- FXRP carry vault contracts
- FXRP carry and FXRP/USDT0 carry LP vault contracts
- A UI focused on Xaman/FSA vault interaction

It intentionally excludes keeper code, backend runtime services, and private strategy vaults.

## Product State

The product is an XRPL-to-Flare vault gateway. The first production-ready lane is the FXRP Carry Vault. The FXRP/USDT0 LP Carry Vault remains visible as a candidate opportunity, but Smart Account entry is disabled until LP vault testing is complete.

Current readiness:

- `FXRP Carry Vault`: active entry target, pending final operator-fee and runtime-state confirmation.
- `FXRP/USDT0 LP Carry Vault`: candidate only, blocked until LP vault testing is complete.

## Current Scope

1. Show the FXRP Carry Vault as the active Smart Account entry path and the FXRP/USDT0 LP Carry Vault as a candidate opportunity.
2. Connect a Xaman account with client-side OAuth2 PKCE sign-in or paste an XRPL address manually, then resolve it to its Flare Smart Account (`PersonalAccount`).
3. Read FXRP, USDT0, and vault share balances from that PersonalAccount.
4. Build approve, deposit, withdraw, claim-surplus, and surplus-swap call plans for supported vault actions.
5. Resolve Smart Account state, read the current memo nonce, encode an inline `0xFF` direct-mint `PackedUserOperation`, and ask the XRPL wallet to pay the FXRP Core Vault with that memo so minted FXRP is deposited by the PersonalAccount.
6. Create real Xaman sign requests for the resulting XRPL payments through server-side API routes so Xaman credentials never reach the browser.
7. Poll the Xaman payload for signature, then poll on-chain balances to detect when the operator has relayed the FDC proof and executed the instruction on Flare.

The existing keeper remains in the original vault repository. This app never talks to the keeper directly. The FSA operator service is what turns a signed XRPL payment into a Flare transaction. The visible UI uses Xaman only and does not ask the user to connect a Flare wallet.

### Connecting Xaman

"Connect Xaman" uses `xumm-oauth2-pkce`, a client-side-only sign-in flow. It needs the app's API Key only, exposed to the browser as `NEXT_PUBLIC_XUMM_API_KEY`. Two things must be true for it to work:

1. `NEXT_PUBLIC_XUMM_API_KEY` is set.
2. The app's Redirect URIs are registered in the Xaman Developer Console (https://apps.xumm.dev) for every origin you run from, such as `http://localhost:3000` for local dev and your production URL.

This is separate from the sign-request flow: connecting resolves who the user is, while `createXamanPayload` and `/api/xaman/payload` later ask them to sign the specific vault instruction payment. That sign request still requires the server-side `XUMM_API_KEY` and `XUMM_API_SECRET` pair.

### Connecting D'CENT

D'CENT support uses the wallet's XRPL provider when it is injected as `window.xrpl`. The same code path should work in D'CENT's in-app browser. If the Chrome extension exposes the same provider, it can be used for a desktop demo; if it does not inject `window.xrpl`, the app will show a provider-not-found message and Xaman remains the fallback.

The D'CENT path signs and submits the XRPL Payment directly through `xrpl_signTransaction`. For vault entry, the payment goes to the FXRP Core Vault and carries the Smart Accounts direct-mint UserOp memo.

### Direct Mint Fees

Vault entry reads `directMintingPaymentAddress()`, `getDirectMintingExecutorFeeUBA()`, `getDirectMintingFeeBIPS()`, and `getDirectMintingMinimumFeeUBA()` from `AssetManagerFXRP`, then adds the required fees to the requested net FXRP mint amount. Advanced non-entry actions still use the older operator payment-reference prototype and should be migrated before public use.

## Run

```bash
cd apps/web
npm install
npm run dev
```

Environment variables (`apps/web/.env.local`):

- `NEXT_PUBLIC_FLARE_RPC_URL` - override the default public Flare RPC.
- `NEXT_PUBLIC_MASTER_ACCOUNT_CONTROLLER` - override the default MasterAccountController address.
- `NEXT_PUBLIC_ASSET_MANAGER_FXRP` - override the default FXRP AssetManager used for direct-mint fee and Core Vault reads.
- `NEXT_PUBLIC_FLARE_CONTRACT_REGISTRY` - override the default FlareContractRegistry address if needed by future registry reads.
- `NEXT_PUBLIC_CARRY_FXRP_VAULT` - override the FXRP Carry Vault address.
- `NEXT_PUBLIC_CARRY_FXRP_USDT0_LP_VAULT` - override the candidate FXRP/USDT0 LP Carry Vault address.
- `XUMM_API_KEY` / `XUMM_API_SECRET` - server-only Xaman Developer Console credentials, used by the `/api/xaman/payload` routes.
- `NEXT_PUBLIC_XUMM_API_KEY` - public Xaman OAuth API key for the connect button.

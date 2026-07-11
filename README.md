# Flare Summer Vault Gateway

Hackathon UI for XRP users who want to access Flare vault products through Flare Smart Accounts.

This repo intentionally includes only the public hackathon surface:

- FXRP carry vault contracts
- FXRP carry and FXRP/USDT0 carry LP vault contracts
- A UI focused on Xaman/FSA vault interaction

It intentionally excludes keeper code, backend runtime services, and private strategy vaults.

## Current Scope

1. Show only the live FXRP Carry Vault and FXRP/USDT0 LP Carry Vault opportunities.
2. Connect a Xaman account (client-side OAuth2 PKCE sign-in) or paste an XRPL address manually, then resolve it to its Flare Smart Account (`PersonalAccount`).
3. Read FXRP and vault share balances from that PersonalAccount.
4. Build the approve + deposit call plan for the selected vault.
5. Encode that call plan into a real `0xff` custom instruction reference via `MasterAccountController.encodeCustomInstruction`.
6. Create a real Xaman (XUMM) sign request for the resulting XRPL payment, via a server-side API route so the app's Xaman credentials never reach the browser.
7. Poll the Xaman payload for signature, then poll the vault's on-chain share balance to detect when the operator has relayed the FDC proof and executed the instruction on Flare.

The existing keeper remains in the original vault repository. This app never talks to the keeper directly - the FSA operator service (external, run by Flare) is what turns a signed XRPL payment into a Flare transaction. The visible UI uses Xaman only and no longer asks the user to connect a Flare wallet.

### Connecting Xaman

"Connect Xaman" uses `xumm-oauth2-pkce`, a client-side-only sign-in flow. It needs the app's **API Key only** (not the secret) exposed to the browser as `NEXT_PUBLIC_XUMM_API_KEY`. Two things must be true for it to work:

1. `NEXT_PUBLIC_XUMM_API_KEY` is set (same value as `XUMM_API_KEY`, just under the public prefix so Next.js inlines it into the client bundle).
2. The app's **Redirect URIs** are registered in the Xaman Developer Console (https://apps.xumm.dev) for every origin you run from, such as `http://localhost:3000` for local dev and your production URL. Without a matching redirect URI the sign-in popup fails.

This is separate from the sign-request flow: connecting resolves *who the user is* (their XRPL address), while `createXamanPayload`/`/api/xaman/payload` later asks them to *sign the specific deposit payment*, which still requires the server-side `XUMM_API_KEY`/`XUMM_API_SECRET` pair.

### Instruction fee

The XRPL payment amount sent to the operator (the "instruction fee") is currently fixed at 12 drops in the UI. Confirm the real fee with the operator before using this on mainnet.

## Run

```bash
cd apps/web
npm install
npm run dev
```

Environment variables (`apps/web/.env.local`):

- `NEXT_PUBLIC_FLARE_RPC_URL` - override the default public Flare RPC.
- `XUMM_API_KEY` / `XUMM_API_SECRET` - server-only Xaman Developer Console credentials (from https://apps.xumm.dev), used by the `/api/xaman/payload` route to create and poll sign requests. Required for the Xaman sign request step to work.
- `NEXT_PUBLIC_XUMM_API_KEY` - same value as `XUMM_API_KEY`, exposed to the browser for the "Connect Xaman" sign-in button. See [Connecting Xaman](#connecting-xaman) above for the redirect-URI requirement.

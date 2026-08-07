# Direct-Mint Executor

Implements the service `apps/web/src/components/SpectraTradePanel.tsx` expects at
`NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL`: register a hash-committed userOp, watch XRPL mainnet for
the matching payment, drive it through Flare's Data Connector (FDC), and call
`AssetManagerFXRP.executeDirectMintingWithData` once proven.

Flare mainnet (chain 14) only. Relocated here from `apex-trading-platform/hackathon/xrpl-rail`
because its only consumer (this repo's `apps/web`) lives here, not there - apex-trading-platform
keeps its own separate, unrelated `xrpl-rail` package (Coston2 FAssets-onboarding demo, used by
`hackathon/demo-web` there).

## What's verified vs. what isn't

- `npm run build` (tsc --noEmit) and `npm test` (vitest, 34/34) pass. Tests cover: XRPL
  memo-matching logic, the FDC request/proof encoding and decoding (pure functions, tested
  against fixture data shaped like the DA Layer's real response), the full allow-list +
  register/poll/submit state machine (fake chain client), and the HTTP server's request handling
  (fake executor).
- **Not verified**: any call through the live Flare mainnet RPC, the live FDC verifier, the live
  DA Layer, or the live XRPL network. Those need real credentials and real funds. The mainnet
  verifier/DA-Layer hostnames baked in as defaults
  (`fdc-verifiers-mainnet.flare.network`, `flr-data-availability.flare.network`) and the
  `XRPPayment`/`XRP` attestation type/source id are independently confirmed correct - they match
  what `fassets-direct-mint`, an already-live bot on the Hetzner box, uses in production - but the
  request/response flow this package builds around them hasn't been exercised live yet.

## 1. Get a mainnet FDC API key

Start with the public placeholder `00000000-0000-0000-0000-000000000000` - it's what the
already-live `fassets-direct-mint` bot on Hetzner defaults to in production. It's rate-limited; if
you hit that limit, Flare's documented path is opening an "API Key Request" issue on the
[flare-foundation GitHub](https://github.com/flare-foundation).

## 2. Fund an executor key

Generate a fresh EVM private key. It needs FLR on Flare mainnet to pay `FdcHub.requestAttestation`
fees and gas for `executeDirectMintingWithData`. **Never share this key with an AI assistant or
paste it into a chat** - put it directly into wherever you deploy this (Railway's variable editor,
or a `.env` file on your own server with `chmod 600`). This is standing authority to execute
pre-registered calls against Smart Accounts the moment a matching payment lands - treat it like a
hot wallet, and start with an amount you'd be fine losing entirely while this is unproven.

## 3. Required environment variables

```bash
# Optional: defaults to Flare's public mainnet RPC. Set a dedicated HTTPS endpoint for production.
FLARE_RPC_URL=https://flare-api.flare.network/ext/C/rpc
ASSET_MANAGER_FXRP=0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8   # matches apps/web/src/config/vaults.ts
FXRP_ADDRESS=0xAd552A648C74D49E10027AB8a618A3ad4901c5bE          # matches apps/web/src/config/vaults.ts
MASTER_ACCOUNT_CONTROLLER=0x434936d47503353f06750Db1A444DBDC5F0AD37c
DIRECT_MINT_EXECUTOR_PRIVATE_KEY=0x...  # the key funded in step 2 - never share this
FDC_API_KEY_MAINNET=00000000-0000-0000-0000-000000000000

# Optional - sensible defaults are baked in, override only if you have a reason to:
FLARE_CONTRACT_REGISTRY=0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019
FDC_VERIFIER_BASE_URL=https://fdc-verifiers-mainnet.flare.network
FDC_DA_LAYER_BASE_URL=https://flr-data-availability.flare.network
XRPL_RPC_URL=https://xrplcluster.com/
DIRECT_MINT_MAX_ATTEMPTS=240            # x pollIntervalMs = how long it waits before giving up
DIRECT_MINT_POLL_INTERVAL_MS=15000

# Optional - comma-separated vault addresses this executor is allowed to drive deposits into,
# beyond the default Spectra pool flow. Unset means only the Spectra flow is allow-listed.
DIRECT_MINT_ERC4626_VAULTS=0xadb3f75c01eda514d476998f96523c1031dda25b   # ConcentratedLpVault (FXRP/USDT0 LP leaf) - matches vaults.ts FXRP_USDT0_LP_LEAF
DIRECT_MINT_CARRY_VAULTS=0x92613ec8058fbf6991f176a48cba2e2e7d8ba60c    # CarryTradeVaultV2 (FXRP/USDT0 LP Carry Vault) - matches vaults.ts NEXT_PUBLIC_CARRY_FXRP_USDT0_LP_VAULT
```

Don't set a port var - it falls back to `PORT` automatically if your host injects one (Railway
does).

Double-check `ASSET_MANAGER_FXRP`/`FXRP_ADDRESS`/`MASTER_ACCOUNT_CONTROLLER`/`DIRECT_MINT_ERC4626_VAULTS`/
`DIRECT_MINT_CARRY_VAULTS` against the current values in `apps/web/src/config/vaults.ts` before
running - copy them from there, don't retype them.

Adding a vault address to one of these two lists is what lets the executor accept a single
hash-committed UserOp for that vault's approve+deposit sequence (one XRPL signature) instead of
falling back to two separate XRPL payments. The frontend also needs
`NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL` pointed at this server, or it never attempts the
hash-committed path at all.

## 4. Install, build, test, run

```bash
cd direct-mint-executor
npm install
npm run build
npm test
npm run serve
```

Logs the executor's derived address on startup - confirm it matches the key you funded before
sending any real XRP at it.

## 5. Point the frontend at it

```bash
NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL=https://<wherever-this-is-deployed>/
```

Whatever host you use, it must be a real HTTPS endpoint reachable from the browser - the call
comes from client-side JS in `SpectraTradePanel.tsx`, not from `apps/web`'s server, so plain HTTP
or an internal-only network won't work (browser mixed-content policy blocks HTTPS pages calling
HTTP endpoints).

## 6. Watch a live attempt

```bash
curl "https://<host>/status?userOpHash=0x..."
```

returns `{ ok, state, attempts, sender, txHash, error }`. `state` moves `registered` →
`submitted` (success) or `registered` → `error` (see `error.code`/`error.message`). Server logs
also print each stage: XRPL payment observed, FDC fee paid + round id, submission tx hash.

Transient failures while polling (XRPL RPC hiccups, FDC verifier/DA layer transport errors) are
retried automatically up to `DIRECT_MINT_MAX_ATTEMPTS` - they don't move the record to `error`.
Only a genuine correctness failure (`MINT_RECIPIENT_MISMATCH`, `ATTESTED_MEMO_MISMATCH`) or
exhausting all attempts (`EXECUTOR_TIMEOUT`) ends in `error`.

If a userOp still lands in `error` (e.g. the RPC endpoint was down for the entire attempt window,
or the same process later recovers), you don't need the original XRPL payment resent - the
executor already has the validated calls in memory. Resurrect it and resume polling with:

```bash
curl -X POST "https://<host>/retry" -H "Content-Type: application/json" -d '{"userOpHash":"0x..."}'
```

This only works against the same running process that registered the userOp - if the service has
restarted since, the record is gone and the deposit has to be resubmitted from the frontend.

## Safety notes

- **Allow-list is closed by construction.** `MainnetDirectMintExecutor.registerUserOperation`
  (`src/executor.ts`) decodes every call and rejects the whole registration if any call carries
  nonzero value, targets a contract other than FXRP / the declared Spectra pool / that pool's
  on-chain-read `coins(0)` ibt, doesn't decode as exactly
  `approve(address,uint256)`/`deposit(uint256,address)`/`exchange(int128,int128,uint256,uint256)`,
  is an `approve` whose spender isn't itself allow-listed, or is a `deposit` whose receiver isn't
  the userOp's own sender.
- **Recipient is re-derived on-chain, not trusted from the request.** After a proof is assembled,
  the client calls `MasterAccountController.getPersonalAccount` on the XRPL address the FDC proof
  actually attests paid - not anything the HTTP caller claimed - before ever submitting.
- Start with `DIRECT_MINT_MAX_ATTEMPTS`/`DIRECT_MINT_POLL_INTERVAL_MS` low enough for a fast test
  run once, confirm the flow end-to-end, then raise them back up for real usage (FDC finalization
  is typically a few voting rounds, ~minutes).

# Spectra Principal Token Marketplace

## Status

The Spectra buy path is working on Flare mainnet through an XRPL-controlled Flare Smart Account. The transaction below was verified on August 7, 2026.

Verified Flare transaction:

- Transaction: [`0xd6aa8a2d7d1e5103c0faf1a8f2ef7bcddbe78a67db140082ef1d28877ac42e5e`](https://flare-explorer.flare.network/tx/0xd6aa8a2d7d1e5103c0faf1a8f2ef7bcddbe78a67db140082ef1d28877ac42e5e)
- Method: `executeDirectMintingWithData`
- Result: success
- Market: `PT-stXRP(FXRP)-2027/09/30`
- PT received by the user's PersonalAccount: `5.330458 PT`

The transaction direct-minted FXRP, deposited FXRP into Firelight stXRP, and exchanged stXRP for Spectra PT. The resulting PT balance is visible in the app's Spectra portfolio.

## User Flow

1. Connect an XRPL wallet using D'CENT, Bifrost, or Xaman.
2. Resolve the wallet's Flare `PersonalAccount` through `MasterAccountController`.
3. Load active Spectra Flare pools from the Spectra API.
4. Reject expired pools, pools below `$100,000` liquidity, non-FXRP markets, and pools whose on-chain token ordering does not match the API response.
5. Choose a market and enter XRP or existing FXRP.
6. Review the on-chain quote, minimum PT received, average price, pool usage, price impact, and slippage.
7. Sign the XRPL payment containing the Smart Account instruction.
8. Follow the execution from wallet signature to XRPL submission, Flare submission, confirmation, and updated PT balance.

## Buy Call Plan

The app builds the minimum necessary calls based on current allowances:

1. `FXRP.approve(stXRP, amount)` when needed.
2. `stXRP.deposit(fxrpAmount, personalAccount)`.
3. `stXRP.approve(spectraPool, amount)` when needed.
4. `spectraPool.exchange(0, 1, stXrpAmount, minimumPtReceived)`.

The calls execute from the user's Flare PersonalAccount. The user authorizes them with an XRPL signature rather than a separate EVM wallet transaction.

## Memo And Executor Modes

- `0xFF`: the complete packed UserOperation is carried inline when it fits the XRPL memo limit.
- `0xFE`: a compact hash commitment is used for larger operations. The browser registers the complete allow-listed UserOperation with `direct-mint-executor` before asking the user to sign.
- Split inline: if no executor is configured, individually safe calls can be submitted as sequential XRPL instruction payments.

The executor accepts only the expected FXRP, stXRP, and declared Spectra pool calls. Its status endpoint lets the portfolio show the eventual Flare transaction hash or a concrete error.

## Portfolio And Exit

The portfolio reads the PersonalAccount directly on Flare and shows:

- PT balances grouped by market and maturity;
- estimated FXRP value using the market PT price;
- available FXRP and stXRP;
- latest Spectra action and its XRPL/Flare explorer links.

The sell path is implemented as `PT.approve(pool, amount)` when required followed by `pool.exchange(1, 0, ptAmount, minimumStXrpReceived)`. A sale returns **stXRP to the Flare PersonalAccount**; it does not return native XRP directly.

## Safeguards

- Minimum pool liquidity: `$100,000`
- Maximum pool usage per trade: `1%`
- Maximum displayed/accepted price impact: `0.50%`
- Default slippage: `0.50%`
- Fresh on-chain `get_dy` quote before execution
- On-chain `coins(0)` and `coins(1)` verification
- Balance and allowance checks before selling
- Persisted XRPL-to-Flare execution state with receipt confirmation

## Relevant Code

- `apps/web/src/components/FlareDefiPanel.tsx`
- `apps/web/src/components/SpectraMarketList.tsx`
- `apps/web/src/components/SpectraTradePanel.tsx`
- `apps/web/src/components/SpectraPortfolio.tsx`
- `apps/web/src/lib/spectra/`
- `apps/web/src/app/api/spectra/markets/route.ts`
- `direct-mint-executor/`

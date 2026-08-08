# `/vault` landing page: fixed-term yield upgrade plan

Status: planned; no landing-page code changes are being made in this phase.

## Goal

The `/vault` landing page currently presents the product almost entirely through the FXRP/USDT0 LP and its automated range-management story. Add a second, equally clear route for users who want fixed-term yield through Spectra Principal Tokens, while preserving the current LP/carry explanation and page structure.

The page should communicate two choices:

- **Managed yield:** the FXRP/USDT0 carry/LP vault manages borrowing, liquidity, and range risk over time.
- **Fixed-term yield:** a user buys a Spectra PT for a selected maturity and sees the implied rate before signing. This is a market-priced fixed-term position, not a guaranteed APY promise.

## Scope boundary

Keep the change limited to the `/vault` landing surface:

- `apps/web/src/app/vault/page.tsx`
- `apps/web/src/components/landing/`
- `apps/web/src/app/landing.css`
- `apps/web/src/app/layout.tsx` metadata

Do not restructure `/app`, the Spectra trade panel, vault contracts, executor behavior, or the root `/` combined Flare Summer Signal page.

## Proposed page changes

### 1. Hero: introduce two yield lanes

Keep the existing hero composition and live LP HUD. Change the framing from “Flare Vault” to “Flare yield, two ways” and add a compact second readout beside or below the LP readout:

- `Managed LP/carry` — live range, price, APR, and LTV remain the existing readout.
- `Fixed-term PT` — selected/most-liquid eligible Spectra market, maturity, implied APY, and liquidity.

Use a link to `/app` for the action rather than introducing a second transaction flow on the landing page.

### 2. Add one focused fixed-yield section

Insert a small section between `Solution` and `Start`, or extend `Solution` with a second card. The section should explain:

1. Choose a maturity.
2. Review the live PT price, implied APY, slippage, and minimum received.
3. Sign once from the XRPL wallet already connected to the app.
4. Track the PT balance in the PersonalAccount portfolio until maturity or sell it back to stXRP.

The copy must say **fixed-term** or **rate at purchase**, not “guaranteed yield.” Selling PT returns stXRP to the Flare PersonalAccount.

### 3. Add lightweight live Spectra metadata

Create a landing-only hook/provider alongside `useLandingVaultReadout` that fetches `/api/spectra/markets` once, selects the first eligible market returned by the existing liquidity/maturity filters, and exposes:

- market symbol/name;
- maturity date;
- implied APY;
- liquidity;
- loading/fallback state.

This is read-only metadata. Do not quote a user amount or build a UserOperation on the landing page. If the API is unavailable, render a truthful fallback such as “Explore live maturities in the app” instead of stale or invented numbers.

### 4. Navigation and copy tuning

- Add a `Fixed-term` node to the existing `ScrollRail` only if the new section is added as its own section.
- Update `Start` and `Final` CTA copy from only “start earning” to “Explore both yield paths” or similar, while keeping the same `/app` destination.
- Update `Curious` with one Spectra/Principal Token card; retain the existing FAssets, Smart Account, lending, and DEX/LP explanations.
- Update page metadata from “carry and LP vaults” to “managed LP/carry and fixed-term Spectra yield.”

## Visual direction

Reuse existing landing tokens and card styles. Give the fixed-term card a distinct but compatible accent (violet/blue) so it reads as a second lane, not a new product. No new global styles, animation system, chart library, or page-level layout replacement.

## Acceptance criteria

- A first-time visitor can distinguish managed LP/carry from fixed-term Spectra PT within the hero and one scroll.
- Existing live LP range/APR/LTV readouts continue to render unchanged.
- Fixed-term metadata comes from the existing Spectra markets API when available and has a clear fallback when unavailable.
- No landing-page element asks for a wallet signature or implies automatic PT trading.
- All CTAs still route to `/app`.
- Root `/` combined landing page remains unchanged.
- `npm run lint` and `npm run build` pass, including mobile-width rendering.

## Suggested implementation order

1. Add the read-only Spectra landing hook/provider and types.
2. Add the fixed-term card/section using existing landing CSS primitives.
3. Update hero, rail, CTA, Curious copy, and metadata.
4. Check copy against `docs/SPECTRA.md` so maturity/APY/exit language stays accurate.
5. Run the web type check/build and inspect `/vault` at desktop and mobile widths.


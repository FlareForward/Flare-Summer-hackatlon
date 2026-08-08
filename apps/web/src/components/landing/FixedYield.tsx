'use client';

import Link from 'next/link';
import { useLandingSpectraReadout } from './useLandingVaultReadout';

function maturityLabel(timestamp?: number) {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp * 1000));
}

function formatApy(value?: number) {
  return value != null && value > 0 ? `${value.toFixed(2)}%` : 'Live in app';
}

function formatLiquidity(value?: number) {
  if (value == null || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

export function FixedYieldCard({ compact = false }: { compact?: boolean }) {
  const { market, loading, error } = useLandingSpectraReadout();

  return (
    <div className={`landing-fixed-yield-card ${compact ? 'compact' : ''}`}>
      <div className="landing-fixed-yield-topline">
        <span className="landing-fixed-yield-label">Fixed-term yield</span>
        <span className="landing-fixed-yield-live">{loading ? 'Loading' : market ? 'Live market' : 'Explore'}</span>
      </div>
      <h3>{market?.symbol || 'Spectra Principal Tokens'}</h3>
      <p className="landing-fixed-yield-copy">
        Choose a maturity, review the rate implied by the market, and keep control from your XRPL wallet.
      </p>
      <div className="landing-fixed-yield-stats">
        <div><span>Implied APY</span><strong>{formatApy(market?.impliedApy)}</strong></div>
        <div><span>Maturity</span><strong>{maturityLabel(market?.maturityTs)}</strong></div>
        <div><span>Liquidity</span><strong>{formatLiquidity(market?.liquidityUsd)}</strong></div>
      </div>
      {error && !market ? <p className="landing-fixed-yield-fallback">Live maturities are available in the app.</p> : null}
      {!compact ? (
        <>
          <p className="landing-fixed-yield-note">The rate is fixed at purchase for the selected maturity; selling returns stXRP to your Flare PersonalAccount.</p>
          <Link className="btn-text" href="/app">Explore fixed-term yield&nbsp;→</Link>
        </>
      ) : null}
    </div>
  );
}

export function FixedYieldSection() {
  return (
    <section id="fixed-term" className="landing-section landing-fixed-yield">
      <div className="landing-section-inner landing-split">
        <FixedYieldCard />
        <div className="landing-kicker">
          <p className="landing-eyebrow">A second way to earn</p>
          <h2>Lock in a rate for a term you choose.</h2>
          <p className="landing-lede">
            Prefer a defined maturity instead of an actively managed position? Spectra Principal Tokens let you choose a date, see the implied yield before you sign, and track the position in your Flare portfolio.
          </p>
        </div>
      </div>
    </section>
  );
}

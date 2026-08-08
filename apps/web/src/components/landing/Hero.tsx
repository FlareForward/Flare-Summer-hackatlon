'use client';

import Link from 'next/link';
import { RangeGlyph } from './RangeGlyph';
import { FixedYieldCard } from './FixedYield';
import { useLandingVaultReadout } from './useLandingVaultReadout';

export function Hero() {
  const readout = useLandingVaultReadout();

  return (
    <section id="hero" className="landing-section landing-hero">
      <div className="landing-section-inner landing-hero-grid">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">Flare yield &middot; choose your lane</p>
          <h1>Your XRP, working while you don&rsquo;t.</h1>
          <p className="landing-lede">
            Choose a managed LP position that keeps working in the background, or choose a fixed-term Principal Token with a rate visible before you sign.
          </p>
          <div className="landing-hero-actions">
            <Link className="btn btn-primary" href="/app">
              Explore yield paths
            </Link>
            <a className="btn-text" href="https://youtu.be/RA7R3PjkLA0" target="_blank" rel="noreferrer">
              Watch the 90-second story
            </a>
          </div>
        </div>

        <div className="landing-hero-hud">
          <div className="landing-hero-hud-label">
            <span>Managed LP / carry readout</span>
            <span className="landing-hud-live">Live</span>
          </div>
          <div className="landing-range-figure">
            <RangeGlyph variant={readout.inZone === false ? 'drifted' : 'centered'} />
          </div>
          <div className="landing-hud-rows">
            <div className="landing-hud-row">
              <span>Its earning zone</span>
              <span>{readout.rangeLabel}</span>
            </div>
            <div className="landing-hud-row">
              <span>Current XRP price</span>
              <span>{readout.currentPriceLabel}</span>
            </div>
            <div className="landing-hud-row">
              <span>Estimated APR</span>
              <span style={{ color: 'var(--l-good)' }}>{readout.aprLabel}</span>
            </div>
          </div>
          <FixedYieldCard compact />
        </div>
      </div>
    </section>
  );
}

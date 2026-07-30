'use client';

import Link from 'next/link';

export function Header() {
  return (
    <header className="shell header">
      <div className="brand-mark">F</div>
      <div>
        <p className="eyebrow">Flare FXRP Gateway</p>
        <h1>FXRP Yield Console</h1>
      </div>
      <div className="header-actions">
        <Link href="/" className="ghost-button compact-button back-link">
          &larr; Story
        </Link>
        <div className="network-pill">Flare Mainnet</div>
      </div>
    </header>
  );
}


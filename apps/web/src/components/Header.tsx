'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';

export function Header() {
  return (
    <header className="shell header">
      <div>
        <p className="eyebrow">Flare Summer Signal</p>
        <h1>Vault Gateway</h1>
      </div>
      <ConnectButton showBalance={false} />
    </header>
  );
}

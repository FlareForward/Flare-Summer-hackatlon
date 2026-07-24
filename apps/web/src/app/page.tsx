'use client';

import { useState } from 'react';
import { Header } from '@/components/Header';
import { SmartAccountPanel } from '@/components/SmartAccountPanel';
import { VaultCard } from '@/components/VaultCard';
import { VAULTS } from '@/config/vaults';

export default function Home() {
  const [selectedVault, setSelectedVault] = useState(VAULTS[0]);

  return (
    <div className="app-shell">
      <Header />
      <main className="shell page-stack">
        <section className="hero">
          <div>
            <p className="eyebrow">Smart Account Vaults</p>
            <h2>Deploy XRP into Flare strategies from one console.</h2>
          </div>
          <div className="hero-stats">
            <div>
              <span>Asset</span>
              <strong>FXRP</strong>
            </div>
            <div>
              <span>Execution</span>
              <strong>XRPL signed</strong>
            </div>
            <div>
              <span>Network</span>
              <strong>Flare</strong>
            </div>
          </div>
        </section>

        <section className="strategy-panel panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Markets</p>
              <h2>Vault opportunities</h2>
            </div>
            <p>Estimated APR is a directional signal, not a guarantee.</p>
          </div>
          <div className="vault-list" aria-label="Vaults">
            {VAULTS.map((vault) => (
              <VaultCard
                key={vault.id}
                vault={vault}
                selected={vault.id === selectedVault.id}
                onSelect={setSelectedVault}
              />
            ))}
          </div>
        </section>

        <SmartAccountPanel vault={selectedVault} />
      </main>
    </div>
  );
}


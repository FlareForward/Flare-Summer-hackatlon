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
        <section className="hero panel-strong">
          <div>
            <p className="eyebrow">No DeFi setup required</p>
            <h2>Put FXRP to work from Xaman.</h2>
          </div>
          <p>
            Choose one managed strategy, enter an FXRP amount, and sign in Xaman. The vault handles the lending, borrowing, LP routing, and rebalancing behind the scenes.
          </p>
        </section>

        <section className="strategy-panel panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>Pick an opportunity</h2>
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

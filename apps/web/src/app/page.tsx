'use client';

import { useState } from 'react';
import { Header } from '@/components/Header';
import { SmartAccountPanel } from '@/components/SmartAccountPanel';
import { VaultCard } from '@/components/VaultCard';
import { VAULTS } from '@/config/vaults';

export default function Home() {
  const [selectedVault, setSelectedVault] = useState(VAULTS[0]);

  return (
    <>
      <Header />
      <main className="shell main-grid">
        <section className="hero">
          <p className="eyebrow">Xaman entry</p>
          <h2>Deposit FXRP into the live carry vaults.</h2>
          <p>
            Connect Xaman, pick a vault, enter an amount, and sign the generated XRPL payment. No separate Flare wallet step is required.
          </p>
        </section>

        <section className="vault-list" aria-label="Vaults">
          {VAULTS.map((vault) => (
            <VaultCard
              key={vault.id}
              vault={vault}
              selected={vault.id === selectedVault.id}
              onSelect={setSelectedVault}
            />
          ))}
        </section>

        <SmartAccountPanel vault={selectedVault} />
      </main>
    </>
  );
}

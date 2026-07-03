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
          <div>
            <p className="eyebrow">Interoperable Asset Products</p>
            <h2>XRP users can enter Flare vaults without holding FLR.</h2>
          </div>
          <p>
            The hackathon build focuses on carry and LP products only. Users connect with an XRPL
            wallet, resolve their Flare Smart Account, and prepare vault actions that can be signed
            through Xaman.
          </p>
        </section>

        <section className="vault-list">
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

        <section className="panel evidence">
          <div>
            <p className="eyebrow">What is new here</p>
            <h2>Hackathon contribution</h2>
          </div>
          <div className="evidence-grid">
            <div>
              <h3>XRPL entry</h3>
              <p>Smart Account lookup, PersonalAccount balances, and Xaman-ready payment templates.</p>
            </div>
            <div>
              <h3>Vault gateway</h3>
              <p>Deposit call generation for FXRP carry and ERC-4626 LP vaults.</p>
            </div>
            <div>
              <h3>Scoped release</h3>
              <p>No keeper code, no private strategy backend, and no unrelated vaults included.</p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}


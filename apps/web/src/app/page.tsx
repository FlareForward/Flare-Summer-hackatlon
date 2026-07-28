'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { SmartAccountPanel } from '@/components/SmartAccountPanel';
import { VaultCard } from '@/components/VaultCard';
import { VAULTS } from '@/config/vaults';

const DEFAULT_VAULT_ID = 'carry-lp-fxrp-usdt0';

function vaultById(id: string | null) {
  return VAULTS.find((vault) => vault.id === id) ?? null;
}

export default function Home() {
  const [selectedVault, setSelectedVault] = useState(vaultById(DEFAULT_VAULT_ID) ?? VAULTS[0]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedVault = vaultById(params.get('vault'));
    if (requestedVault) setSelectedVault(requestedVault);
  }, []);

  function selectVault(vault: typeof selectedVault) {
    setSelectedVault(vault);
    const url = new URL(window.location.href);
    url.searchParams.set('vault', vault.id);
    window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  }

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
                onSelect={selectVault}
              />
            ))}
          </div>
        </section>

        <SmartAccountPanel vault={selectedVault} />
      </main>
    </div>
  );
}
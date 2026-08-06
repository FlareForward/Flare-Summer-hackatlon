'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { FlareDefiPanel } from '@/components/FlareDefiPanel';
import { SmartAccountPanel } from '@/components/SmartAccountPanel';
import { VaultCard } from '@/components/VaultCard';
import { VAULTS } from '@/config/vaults';

const DEFAULT_VAULT_ID = 'lp-fxrp-usdt0';
type ProductView = 'experimental' | 'defi';

function vaultById(id: string | null) {
  return VAULTS.find((vault) => vault.id === id) ?? null;
}

export default function AppPage() {
  const [selectedVault, setSelectedVault] = useState(vaultById(DEFAULT_VAULT_ID) ?? VAULTS[0]);
  const [view, setView] = useState<ProductView>('experimental');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedVault = vaultById(params.get('vault'));
    if (requestedVault) setSelectedVault(requestedVault);
    if (params.get('view') === 'defi') setView('defi');
  }, []);

  function selectView(nextView: ProductView) {
    setView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextView);
    if (nextView === 'defi') url.searchParams.delete('vault');
    else url.searchParams.set('vault', selectedVault.id);
    window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  }

  function selectVault(vault: typeof selectedVault) {
    setSelectedVault(vault);
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'experimental');
    url.searchParams.set('vault', vault.id);
    window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  }

  return (
    <div className="app-shell">
      <Header />
      <main className="shell page-stack">
        <nav className="product-tabs" aria-label="Product areas" role="tablist">
          <button type="button" className={view === 'experimental' ? 'product-tab active' : 'product-tab'} aria-selected={view === 'experimental'} role="tab" onClick={() => selectView('experimental')}>
            <span>Experimental Vaults</span>
            <small>Managed strategies</small>
          </button>
          <button type="button" className={view === 'defi' ? 'product-tab active' : 'product-tab'} aria-selected={view === 'defi'} role="tab" onClick={() => selectView('defi')}>
            <span>Flare DeFi</span>
            <small>Direct protocol access</small>
          </button>
        </nav>

        {view === 'experimental' ? (
          <>
        <section className="hero experimental-hero">
          <div>
            <p className="eyebrow">Experimental Smart Account Vaults</p>
            <h2>LP made easy &mdash; with leverage, or without.</h2>
            <p className="hero-description">Early-stage strategies built by us. These vault contracts are experimental and should be used only with funds you can afford to put at risk.</p>
          </div>
          <div className="hero-stats">
            <div>
              <span>Product stage</span>
              <strong>Experimental</strong>
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

        <aside className="product-notice experimental-notice" aria-label="Experimental vault warning">
          <strong>Experimental product</strong>
          <span>These vaults add strategy and smart-contract risk beyond the underlying protocols. They are not part of the audited third-party protocol category.</span>
        </aside>

        <section className="strategy-panel panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Experimental markets</p>
              <h2>Vault opportunities</h2>
            </div>
            <p>Estimated APR is a directional signal, not a guarantee.</p>
          </div>
          <div className="vault-list" aria-label="Experimental vaults">
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
          </>
        ) : (
          <FlareDefiPanel />
        )}
      </main>
    </div>
  );
}

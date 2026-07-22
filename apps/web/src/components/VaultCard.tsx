'use client';

import type { VaultConfig } from '@/config/vaults';
import { FLARE_EXPLORER } from '@/config/vaults';
import { isZeroAddress, shortAddress } from '@/lib/format';
import { useCarryVaultApr } from '@/lib/useCarryVaultApr';

type Props = {
  vault: VaultConfig;
  selected: boolean;
  onSelect: (vault: VaultConfig) => void;
};

// Only the FXRP Carry Vault is live on chain today; the LP carry vault (status: 'candidate')
// falls back to its static estimate until it's deployed. See the TODO on that vault entry in
// config/vaults.ts for what live wiring it needs once ready.
function useLiveOpportunity(vault: VaultConfig) {
  const canReadLive = vault.kind === 'carry' && vault.status === 'live' && !isZeroAddress(vault.address);
  const live = useCarryVaultApr(vault.address, canReadLive);
  if (live.netAprPct == null) {
    return { display: vault.opportunityApr, sub: null as string | null, isLive: false };
  }
  return {
    display: `${live.netAprPct.toFixed(2)}%`,
    sub: live.spreadPct != null ? `Live · spread ${live.spreadPct.toFixed(2)}%` : 'Live',
    isLive: true,
  };
}

export function VaultCard({ vault, selected, onSelect }: Props) {
  const opportunity = useLiveOpportunity(vault);

  return (
    <button
      className={`vault-card ${selected ? 'selected' : ''}`}
      style={{ '--vault-accent': vault.accent } as React.CSSProperties}
      onClick={() => onSelect(vault)}
      type="button"
    >
      <div className="vault-card-main">
        <div>
          <div className="pill-row">
            <span className="pill accent-pill">{vault.opportunityLabel}</span>
            <span className="pill muted-pill">{vault.status}</span>
          </div>
          <h3>{vault.name}</h3>
          <p>{vault.summary}</p>
        </div>
        <div className="apr-block">
          <span>Opportunity</span>
          <strong>{opportunity.display}</strong>
          {opportunity.sub ? <em>{opportunity.sub}</em> : null}
        </div>
      </div>

      <div className="vault-metrics">
        <div>
          <span>Why enter</span>
          <strong>{vault.opportunityReason}</strong>
        </div>
        <div>
          <span>Risk</span>
          <strong>{vault.riskLabel}</strong>
        </div>
        <div>
          <span>Exit</span>
          <strong>{vault.exit}</strong>
        </div>
      </div>

      <div className="card-footer">
        <span>{vault.bestFor}</span>
        {!isZeroAddress(vault.address) ? (
          <a href={`${FLARE_EXPLORER}/address/${vault.address}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            {shortAddress(vault.address)}
          </a>
        ) : (
          <span>Not deployed</span>
        )}
      </div>
    </button>
  );
}

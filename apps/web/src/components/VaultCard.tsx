'use client';

import type { VaultConfig } from '@/config/vaults';
import { FLARE_EXPLORER } from '@/config/vaults';
import { isZeroAddress, shortAddress } from '@/lib/format';

type Props = {
  vault: VaultConfig;
  selected: boolean;
  onSelect: (vault: VaultConfig) => void;
};

export function VaultCard({ vault, selected, onSelect }: Props) {
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
          <strong>{vault.opportunityApr}</strong>
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

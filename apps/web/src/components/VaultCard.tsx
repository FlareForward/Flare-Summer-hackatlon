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
      style={{ borderColor: selected ? vault.accent : undefined }}
      onClick={() => onSelect(vault)}
      type="button"
    >
      <span className="vault-kind" style={{ color: vault.accent }}>
        {vault.kind.toUpperCase()}
      </span>
      <div className="vault-card-title">
        <h3>{vault.name}</h3>
        <span>{vault.token}</span>
      </div>
      <p>{vault.summary}</p>
      <div className="vault-meta">
        <span>{vault.asset} entry</span>
        {vault.range ? <span>{vault.range} range</span> : null}
        <span>{vault.status}</span>
      </div>
      <div className="address-row">
        <span>{shortAddress(vault.address)}</span>
        {!isZeroAddress(vault.address) ? (
          <a href={`${FLARE_EXPLORER}/address/${vault.address}`} target="_blank" rel="noreferrer">
            Explorer
          </a>
        ) : (
          <span>Not deployed</span>
        )}
      </div>
    </button>
  );
}

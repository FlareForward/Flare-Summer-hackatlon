'use client';

import type { VaultConfig } from '@/config/vaults';
import { formatToken, isZeroAddress } from '@/lib/format';
import { useCarryVaultApr } from '@/lib/useCarryVaultApr';

type Props = {
  vault: VaultConfig;
  selected: boolean;
  onSelect: (vault: VaultConfig) => void;
};

function formatMetricPct(value: number | null): string {
  return value == null ? '-' : `${value.toFixed(2)}%`;
}

function formatUsd(value: bigint | null): string {
  return value == null ? '-' : `$${formatToken(value, 6)}`;
}

function useLiveOpportunity(vault: VaultConfig) {
  const canReadLive = vault.kind === 'carry' && vault.status === 'live' && !isZeroAddress(vault.address);
  const live = useCarryVaultApr(vault.address, canReadLive);
  if (live.netAprPct == null) {
    return {
      display: vault.opportunityApr,
      sub: null as string | null,
      totalAssets: null as bigint | null,
      collateralValue: null as bigint | null,
      debt: null as bigint | null,
      ltvPct: null as number | null,
    };
  }
  return {
    display: `${live.netAprPct.toFixed(2)}%`,
    sub: live.spreadPct != null ? `Live spread ${live.spreadPct.toFixed(2)}%` : 'Live',
    totalAssets: live.totalAssets,
    collateralValue: live.collateralValue,
    debt: live.debt,
    ltvPct: live.ltvPct,
  };
}

export function VaultCard({ vault, selected, onSelect }: Props) {
  const opportunity = useLiveOpportunity(vault);
  const tvlDisplay = opportunity.totalAssets == null ? '-' : formatToken(opportunity.totalAssets, vault.assetDecimals, vault.asset);
  const tvlUsdDisplay = formatUsd(opportunity.collateralValue);
  const debtDisplay = opportunity.debt == null ? '-' : `${formatToken(opportunity.debt, 6, 'USDT0')} debt`;

  return (
    <button
      className={`vault-card ${selected ? 'selected' : ''}`}
      style={{ '--vault-accent': vault.accent } as React.CSSProperties}
      onClick={() => onSelect(vault)}
      type="button"
    >
      <div className="vault-card-topline">
        <div className="pill-row">
          <span className="pill accent-pill">{vault.opportunityLabel}</span>
          <span className="pill muted-pill">{vault.status}</span>
        </div>
        <span className="select-indicator">{selected ? 'Selected' : 'Choose'}</span>
      </div>

      <div className="vault-card-main">
        <div>
          <h3>{vault.name}</h3>
          <p>{vault.bestFor}</p>
        </div>
      </div>

      <div className="vault-snapshot" aria-label={`${vault.name} metrics`}>
        <div>
          <span>Est. APR</span>
          <strong>{opportunity.display}</strong>
          {opportunity.sub ? <em>{opportunity.sub}</em> : null}
        </div>
        <div>
          <span>TVL</span>
          <strong>{tvlDisplay}</strong>
          <em>{tvlUsdDisplay}</em>
        </div>
        <div>
          <span>LTV</span>
          <strong>{formatMetricPct(opportunity.ltvPct)}</strong>
          <em>{debtDisplay}</em>
        </div>
      </div>

      <div className="vault-metrics">
        <div>
          <span>Strategy</span>
          <strong>{vault.summary}</strong>
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
    </button>
  );
}

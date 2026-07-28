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

function formatPrice(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '-' : `$${value.toFixed(4)}`;
}

function isLpCarryVault(vault: VaultConfig): boolean {
  return vault.id === 'carry-lp-fxrp-usdt0';
}

function useLiveOpportunity(vault: VaultConfig) {
  const canReadLive = vault.kind === 'carry' && vault.status === 'live' && !isZeroAddress(vault.address);
  const live = useCarryVaultApr(vault.address, canReadLive, vault.leafAddress, vault.targetLtvBps);

  return {
    display: live.ltvAdjustedLeafAprPct != null
      ? `${live.ltvAdjustedLeafAprPct.toFixed(2)}%`
      : live.netAprPct == null ? vault.opportunityApr : `${live.netAprPct.toFixed(2)}%`,
    sub: live.spreadPct != null ? `Live spread ${live.spreadPct.toFixed(2)}%` : live.error ? 'Live APR unavailable' : null,
    totalAssets: live.totalAssets,
    collateralValue: live.collateralValue,
    debt: live.debt,
    ltvPct: live.ltvPct,
    maxLtvPct: live.maxLtvPct,
    leafAprPct: live.leafAprPct,
    ltvAdjustedLeafAprPct: live.ltvAdjustedLeafAprPct,
    effectiveEstimateLtvPct: live.effectiveEstimateLtvPct,
    idleCollateral: live.idleCollateral,
    postedCollateral: live.postedCollateral,
    leafValue: live.leafValue,
    leafShares: live.leafShares,
    idleUsdt0: live.idleUsdt0,
    totalCollateral: live.totalCollateral,
    totalRecoverable: live.totalRecoverable,
    currentPoolPrice: live.currentPoolPrice,
  };
}

export function VaultCard({ vault, selected, onSelect }: Props) {
  const opportunity = useLiveOpportunity(vault);
  const lpCarry = isLpCarryVault(vault);
  const tvlDisplay = opportunity.totalAssets == null ? '-' : formatToken(opportunity.totalAssets, vault.assetDecimals, vault.asset);
  const tvlUsdDisplay = formatUsd(opportunity.collateralValue);
  const debtAmount = opportunity.debt == null ? '-' : formatToken(opportunity.debt, 6, 'USDT0');
  const debtDisplay = opportunity.debt == null ? '-' : `${debtAmount} debt`;
  const ltvContext = opportunity.ltvPct == null || opportunity.maxLtvPct == null
    ? 'Debt is denominated in USDT0'
    : `${opportunity.ltvPct.toFixed(1)}% LTV / ${opportunity.maxLtvPct.toFixed(1)}% keeper max`;
  const lpStatus = opportunity.leafValue && opportunity.leafValue > BigInt(0)
    ? 'LP deployed'
    : opportunity.idleUsdt0 && opportunity.idleUsdt0 > BigInt(0) ? 'Borrow window' : 'Seeded';
  const lpStatusDetail = opportunity.leafValue == null
    ? vault.readinessNote ?? vault.exit
    : `${formatToken(opportunity.leafValue, vault.assetDecimals, vault.asset)} in LP leaf`;
  const lpRangeDisplay = vault.lpRangeLowerPrice && vault.lpRangeUpperPrice
    ? `$${vault.lpRangeLowerPrice} - $${vault.lpRangeUpperPrice}`
    : vault.range ? `${vault.range} range` : '-';

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
          {vault.range ? <span className="pill muted-pill">{vault.range} range</span> : null}
        </div>
        <span className="select-indicator">{selected ? 'Selected' : 'Choose'}</span>
      </div>

      <div className="vault-card-main">
        <div>
          <h3>{vault.name}</h3>
          <p>{vault.bestFor}</p>
        </div>
      </div>

      {lpCarry ? (
        <>
          <div className="vault-snapshot lp-carry-snapshot" aria-label={`${vault.name} key metrics`}>
            <div>
              <span>Est. APR</span>
              <strong>{opportunity.display}</strong>
            </div>
            <div>
              <span>TVL</span>
              <strong>{tvlDisplay}</strong>
              <em>Net shareholder NAV</em>
            </div>
            <div>
              <span>Debt / LTV</span>
              <strong>{debtAmount}</strong>
              <em>{ltvContext}</em>
            </div>
            <div>
              <span>LP status</span>
              <strong>{lpStatus}</strong>
              <em>{lpStatusDetail}</em>
            </div>
          </div>

          <div className="vault-live-stats lp-carry-footer" aria-label={`${vault.name} LP details`}>
            <div>
              <span>Opened range</span>
              <strong>{lpRangeDisplay}</strong>
              <em>USDT0 / FXRP</em>
            </div>
            <div>
              <span>Current price</span>
              <strong>{formatPrice(opportunity.currentPoolPrice)}</strong>
              <em>USDT0 / FXRP</em>
            </div>
            <div>
              <span>LP leaf value</span>
              <strong>{opportunity.leafValue == null ? '-' : formatToken(opportunity.leafValue, vault.assetDecimals, vault.asset)}</strong>
            </div>
            <div>
              <span>Morpho collateral</span>
              <strong>{opportunity.postedCollateral == null ? '-' : formatToken(opportunity.postedCollateral, vault.assetDecimals, vault.asset)}</strong>
              <em>{opportunity.idleCollateral == null ? 'Idle vault collateral unavailable' : `${formatToken(opportunity.idleCollateral, vault.assetDecimals, vault.asset)} idle`}</em>
            </div>
            <div>
              <span>Idle USDT0</span>
              <strong>{opportunity.idleUsdt0 == null ? '-' : formatToken(opportunity.idleUsdt0, 6, 'USDT0')}</strong>
            </div>
          </div>
        </>
      ) : (
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
      )}

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
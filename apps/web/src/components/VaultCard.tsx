'use client';

import type { VaultConfig } from '@/config/vaults';
import { formatToken } from '@/lib/format';
import { useLiveVaultOpportunity } from '@/lib/useLiveVaultOpportunity';

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

export function VaultCard({ vault, selected, onSelect }: Props) {
  const opportunity = useLiveVaultOpportunity(vault);
  const lpCarry = isLpCarryVault(vault);
  const directLp = vault.kind === 'lp';
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
    : `${formatToken(opportunity.leafValue, vault.assetDecimals, vault.asset)} in the LP position`;
  const lpRangeDisplay = vault.lpRangeLowerPrice && vault.lpRangeUpperPrice
    ? `$${vault.lpRangeLowerPrice} - $${vault.lpRangeUpperPrice}`
    : vault.range ? `${vault.range} range` : '-';

  let statusHeadline: string;
  if (lpCarry) {
    if (lpStatus === 'LP deployed') statusHeadline = 'In range — earning LP fees + carry';
    else if (lpStatus === 'Borrow window') statusHeadline = 'Building position — capital borrowed, opening LP next';
    else statusHeadline = 'Warming up — seeded, waiting for capital';
  } else if (opportunity.debt == null) {
    statusHeadline = vault.readinessNote ?? 'Preparing this vault';
  } else if (opportunity.debt > BigInt(0)) {
    statusHeadline = 'Active — earning the carry spread';
  } else {
    statusHeadline = 'Warming up — no debt open yet';
  }

  return (
    <div
      className={`vault-card ${selected ? 'selected' : ''}`}
      style={{ '--vault-accent': vault.accent } as React.CSSProperties}
      onClick={() => onSelect(vault)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(vault);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="vault-card-topline">
        <div className="pill-row">
          <span className="pill experimental-pill">Experimental</span>
          <span className="pill accent-pill">{vault.opportunityLabel}</span>
          <span className="pill muted-pill">{vault.status}</span>
          {vault.range ? <span className="pill muted-pill">{vault.range} range</span> : null}
        </div>
        <span className="select-indicator">{selected ? 'Selected' : 'Choose'}</span>
      </div>

      <div className="vault-card-main">
        <div>
          <h3>{vault.name}</h3>
          <p className="vault-value-line">{vault.summary}</p>
          <p className="vault-status-line">
            <span className="status-dot" />
            {statusHeadline}
          </p>
        </div>
        <div className="apr-block">
          <span>Est. APR</span>
          <strong>{opportunity.display}</strong>
          {!lpCarry && opportunity.sub ? <em>{opportunity.sub}</em> : null}
        </div>
      </div>

      <details className="advanced-box vault-advanced" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <summary>On-chain details</summary>
        <div className="advanced-content">
          {lpCarry ? (
            <>
              <div className="vault-snapshot lp-carry-snapshot" aria-label={`${vault.name} key metrics`}>
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
                  <span>LP position value</span>
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
          ) : directLp ? (
            <div className="vault-snapshot" aria-label={`${vault.name} metrics`}>
              <div>
                <span>TVL</span>
                <strong>{tvlDisplay}</strong>
                <em>No borrowing, no leverage</em>
              </div>
              <div>
                <span>Range</span>
                <strong>{lpRangeDisplay}</strong>
                <em>FXRP / USDT0 pool</em>
              </div>
              <div>
                <span>Deposit asset</span>
                <strong>{vault.asset}</strong>
                <em>Withdraw as FXRP + USDT0</em>
              </div>
            </div>
          ) : (
            <div className="vault-snapshot" aria-label={`${vault.name} metrics`}>
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
              <span>Best for</span>
              <strong>{vault.bestFor}</strong>
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
        </div>
      </details>
    </div>
  );
}

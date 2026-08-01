'use client';

import type { VaultConfig } from '@/config/vaults';
import { isZeroAddress } from '@/lib/format';
import { useCarryVaultApr } from '@/lib/useCarryVaultApr';
import { useLpVaultStats } from '@/lib/useLpVaultStats';

export function useLiveVaultOpportunity(vault: VaultConfig) {
  const isLive = vault.status === 'live' && !isZeroAddress(vault.address);
  const canReadCarry = vault.kind === 'carry' && isLive;
  const canReadLp = vault.kind === 'lp' && isLive;

  const live = useCarryVaultApr(vault.address, canReadCarry, vault.leafAddress, vault.targetLtvBps);
  const lp = useLpVaultStats(vault.address, canReadLp, vault.shareDecimals);

  if (vault.kind === 'lp') {
    return {
      display: lp.aprPct != null ? `${lp.aprPct.toFixed(2)}%` : vault.opportunityApr,
      sub: lp.aprPct != null ? '7-day LP fee APR' : lp.error ? 'Live APR unavailable' : null,
      totalAssets: lp.totalAssets,
      collateralValue: null,
      debt: null,
      ltvPct: null,
      maxLtvPct: null,
      leafAprPct: lp.aprPct,
      ltvAdjustedLeafAprPct: null,
      effectiveEstimateLtvPct: null,
      idleCollateral: null,
      postedCollateral: null,
      leafValue: lp.totalAssets,
      leafShares: null,
      idleUsdt0: null,
      totalCollateral: null,
      totalRecoverable: null,
      currentPoolPrice: null,
    };
  }

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

'use client';

import type { VaultConfig } from '@/config/vaults';
import { isZeroAddress } from '@/lib/format';
import { useCarryVaultApr } from '@/lib/useCarryVaultApr';

export function useLiveVaultOpportunity(vault: VaultConfig) {
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

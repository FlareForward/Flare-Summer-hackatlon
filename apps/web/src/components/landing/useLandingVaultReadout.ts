'use client';

import { VAULTS } from '@/config/vaults';
import { formatToken, isZeroAddress } from '@/lib/format';
import { useCarryVaultApr } from '@/lib/useCarryVaultApr';

const LP_CARRY_VAULT = VAULTS.find((vault) => vault.id === 'carry-lp-fxrp-usdt0')!;

export function useLandingVaultReadout() {
  const canRead = LP_CARRY_VAULT.kind === 'carry' && LP_CARRY_VAULT.status === 'live' && !isZeroAddress(LP_CARRY_VAULT.address);
  const live = useCarryVaultApr(LP_CARRY_VAULT.address, canRead, LP_CARRY_VAULT.leafAddress, LP_CARRY_VAULT.targetLtvBps);

  const lowerPrice = LP_CARRY_VAULT.lpRangeLowerPrice ? Number(LP_CARRY_VAULT.lpRangeLowerPrice) : null;
  const upperPrice = LP_CARRY_VAULT.lpRangeUpperPrice ? Number(LP_CARRY_VAULT.lpRangeUpperPrice) : null;

  const rangeLabel = LP_CARRY_VAULT.lpRangeLowerPrice && LP_CARRY_VAULT.lpRangeUpperPrice
    ? `$${LP_CARRY_VAULT.lpRangeLowerPrice} – $${LP_CARRY_VAULT.lpRangeUpperPrice}`
    : '—';

  const currentPrice = live.currentPoolPrice != null && Number.isFinite(live.currentPoolPrice) ? live.currentPoolPrice : null;
  const currentPriceLabel = currentPrice != null ? `$${currentPrice.toFixed(4)}` : '—';

  const inZone = currentPrice != null && lowerPrice != null && upperPrice != null && currentPrice >= lowerPrice && currentPrice <= upperPrice;
  const statusLabel = currentPrice == null ? 'Warming up' : inZone ? 'In its zone' : 'Drifting out';

  const ltvLabel = live.ltvPct != null ? `${live.ltvPct.toFixed(1)}%` : '—';
  const borrowedLabel = live.debt != null ? formatToken(live.debt, 6, 'USDT0') : '—';

  return { rangeLabel, currentPriceLabel, statusLabel, ltvLabel, borrowedLabel, inZone: currentPrice == null ? null : inZone };
}

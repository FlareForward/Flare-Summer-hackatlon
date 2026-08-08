'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { VAULTS } from '@/config/vaults';
import { formatToken } from '@/lib/format';
import { useLiveVaultOpportunity } from '@/lib/useLiveVaultOpportunity';
import type { SpectraMarket } from '@/lib/spectra/markets';

const LP_CARRY_VAULT = VAULTS.find((vault) => vault.id === 'carry-lp-fxrp-usdt0')!;

function useResolvedLandingVaultReadout() {
  // Use the same resolver as VaultCard so landing metrics cannot drift from the card. The LP
  // Carry vault is the only remaining leveraged vault, so it supplies both the live APR/LTV/debt
  // reads and the LP range it opened — those numbers describe the same contract.
  const opportunity = useLiveVaultOpportunity(LP_CARRY_VAULT);
  const lowerPrice = LP_CARRY_VAULT.lpRangeLowerPrice ? Number(LP_CARRY_VAULT.lpRangeLowerPrice) : null;
  const upperPrice = LP_CARRY_VAULT.lpRangeUpperPrice ? Number(LP_CARRY_VAULT.lpRangeUpperPrice) : null;
  const rangeLabel = LP_CARRY_VAULT.lpRangeLowerPrice && LP_CARRY_VAULT.lpRangeUpperPrice
    ? `$${LP_CARRY_VAULT.lpRangeLowerPrice} - $${LP_CARRY_VAULT.lpRangeUpperPrice}`
    : '-';
  const currentPrice = opportunity.currentPoolPrice != null && Number.isFinite(opportunity.currentPoolPrice)
    ? opportunity.currentPoolPrice
    : null;
  const inZone = currentPrice != null && lowerPrice != null && upperPrice != null
    && currentPrice >= lowerPrice && currentPrice <= upperPrice;

  return {
    rangeLabel,
    currentPriceLabel: currentPrice != null ? `$${currentPrice.toFixed(4)}` : '-',
    aprLabel: opportunity.display,
    ltvLabel: opportunity.ltvPct != null ? `${opportunity.ltvPct.toFixed(1)}%` : '-',
    borrowedLabel: opportunity.debt != null ? formatToken(opportunity.debt, 6, 'USDT0') : '-',
    maxLtvLabel: opportunity.maxLtvPct != null ? `${opportunity.maxLtvPct.toFixed(1)}%` : '-',
    inZone: currentPrice == null ? null : inZone,
  };
}

type LandingVaultReadout = ReturnType<typeof useResolvedLandingVaultReadout>;
const LandingVaultReadoutContext = createContext<LandingVaultReadout | null>(null);

type LandingSpectraReadout = {
  market?: SpectraMarket;
  loading: boolean;
  error?: string;
};

function useResolvedLandingSpectraReadout(): LandingSpectraReadout {
  const [market, setMarket] = useState<SpectraMarket>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    async function loadMarket() {
      try {
        const response = await fetch('/api/spectra/markets', { cache: 'no-store' });
        const data = await response.json().catch(() => null) as { markets?: SpectraMarket[]; error?: string } | null;
        if (!response.ok || !Array.isArray(data?.markets)) {
          throw new Error(data?.error || 'Live fixed-term markets are temporarily unavailable.');
        }
        if (!cancelled) setMarket(data.markets[0]);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Live fixed-term markets are temporarily unavailable.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMarket();
    return () => {
      cancelled = true;
    };
  }, []);

  return { market, loading, error };
}

const LandingSpectraReadoutContext = createContext<LandingSpectraReadout | null>(null);

export function LandingVaultReadoutProvider({ children }: { children: ReactNode }) {
  const readout = useResolvedLandingVaultReadout();
  const spectra = useResolvedLandingSpectraReadout();
  return (
    <LandingVaultReadoutContext.Provider value={readout}>
      <LandingSpectraReadoutContext.Provider value={spectra}>{children}</LandingSpectraReadoutContext.Provider>
    </LandingVaultReadoutContext.Provider>
  );
}

export function useLandingVaultReadout() {
  const readout = useContext(LandingVaultReadoutContext);
  if (!readout) throw new Error('useLandingVaultReadout must be used inside LandingVaultReadoutProvider.');
  return readout;
}

export function useLandingSpectraReadout() {
  const readout = useContext(LandingSpectraReadoutContext);
  if (!readout) throw new Error('useLandingSpectraReadout must be used inside LandingVaultReadoutProvider.');
  return readout;
}

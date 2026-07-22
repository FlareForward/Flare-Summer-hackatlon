'use client';

import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { flarePublicClient } from '@/config/wagmi';
import {
  carryVaultAprAbi,
  erc4626VaultAbi,
  irmBorrowRateAbi,
  ktokenSupplyRateAbi,
  morphoMarketAbi,
} from '@/config/abis';
import { USDT0_ADDRESS } from '@/config/vaults';

// Ports the live-APR methodology from the STFLR VAULT dashboard's useCarryVaultOnChain
// (ui/src/lib/hooks.ts): read the vault's Morpho Blue borrow rate and its lending venues'
// supply rates directly on chain, then net them against posted collateral value.

const MORPHO_BLUE = '0xF4346F5132e810f80a28487a79c7559d9797E8B0' as const;
const SECONDS_PER_YEAR = 31_536_000;
const FLARE_BLOCKS_PER_DAY = BigInt(48_000);
const ERC4626_LOOKBACK_UNIT = BigInt(1_000_000); // 1 USDT0 (6 decimals), used as the price probe
const POLL_INTERVAL_MS = 30_000;
const MAX_VENUES = 5;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const BPS_DENOMINATOR = BigInt(10_000);

export type CarryVaultApr = {
  // Net APR on posted collateral, accounting for LTV dilution — this is the number to show as "Opportunity".
  netAprPct: number | null;
  // Raw supply-minus-borrow spread on a full-leverage basis (informational subtext).
  spreadPct: number | null;
  ltvPct: number | null;
  maxLtvPct: number | null;
  isLoading: boolean;
  error: string | null;
};

const INITIAL_STATE: CarryVaultApr = {
  netAprPct: null,
  spreadPct: null,
  ltvPct: null,
  maxLtvPct: null,
  isLoading: true,
  error: null,
};

function perSecondRateToAprPct(ratePerSecond: bigint): number {
  return (Number(ratePerSecond) / 1e18) * SECONDS_PER_YEAR * 100;
}

export function useCarryVaultApr(vaultAddress: Address, enabled: boolean): CarryVaultApr {
  const [state, setState] = useState<CarryVaultApr>(enabled ? INITIAL_STATE : { ...INITIAL_STATE, isLoading: false });

  useEffect(() => {
    if (!enabled) {
      setState({ ...INITIAL_STATE, isLoading: false });
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const rc = <T,>(functionName: string, args: readonly unknown[] = []) =>
          flarePublicClient.readContract({
            address: vaultAddress,
            abi: carryVaultAprAbi,
            functionName: functionName as never,
            args: args as never,
          }) as Promise<T>;

        const [debt, ltvBps, maxBorrowLtvBps, irm, oracle, lltv, marketId, collateralToken] = await Promise.all([
          rc<bigint>('debt'),
          rc<bigint>('ltvBps'),
          rc<number>('maxBorrowLtvBps'),
          rc<Address>('irm'),
          rc<Address>('oracle'),
          rc<bigint>('lltv'),
          rc<`0x${string}`>('marketId'),
          rc<Address>('collateralToken'),
        ]);
        const collateralValueRaw = await rc<bigint>('collateralValue').catch(() => ZERO);
        const effectiveCollateralValue = collateralValueRaw > ZERO
          ? collateralValueRaw
          : ltvBps > ZERO
            ? (debt * BPS_DENOMINATOR) / ltvBps
            : ZERO;

        const market = await flarePublicClient.readContract({
          address: MORPHO_BLUE,
          abi: morphoMarketAbi,
          functionName: 'market',
          args: [marketId],
        });

        const borrowRatePerSecond = await flarePublicClient.readContract({
          address: irm,
          abi: irmBorrowRateAbi,
          functionName: 'borrowRateView',
          args: [
            { loanToken: USDT0_ADDRESS, collateralToken, oracle, irm, lltv },
            market,
          ],
        });
        const borrowAprPct = perSecondRateToAprPct(borrowRatePerSecond);

        const deployedUsdt0 = await rc<bigint>('totalVenueAssets').catch(() => ZERO);
        const venueCount = await rc<bigint>('venueCount').catch(() => ZERO);

        let supplyWeighted = 0;
        let supplyCovered = ZERO;
        let bestSupplyAprPct: number | null = null;
        let pastBlockNumber: bigint | null = null;

        for (let i = ZERO; i < venueCount && i < BigInt(MAX_VENUES); i += ONE) {
          const venue = await rc<{ kToken: Address; enabled: boolean; kind: number }>('getVenue', [i]).catch(() => null);
          if (!venue || !venue.kToken || !venue.enabled) continue;
          const assets = await rc<bigint>('venueAssets', [i]).catch(() => ZERO);

          let aprPct: number | null = null;
          if (venue.kind === 1) {
            // ERC4626 venue: infer APR from the 7-day change in its share price.
            if (pastBlockNumber === null) {
              const blockNumber = await flarePublicClient.getBlockNumber();
              const sevenDaysOfBlocks = FLARE_BLOCKS_PER_DAY * BigInt(7);
              pastBlockNumber = blockNumber > sevenDaysOfBlocks ? blockNumber - sevenDaysOfBlocks : ONE;
            }
            try {
              const [priceNow, pricePast] = await Promise.all([
                flarePublicClient.readContract({
                  address: venue.kToken,
                  abi: erc4626VaultAbi,
                  functionName: 'convertToAssets',
                  args: [ERC4626_LOOKBACK_UNIT],
                }),
                flarePublicClient.readContract({
                  address: venue.kToken,
                  abi: erc4626VaultAbi,
                  functionName: 'convertToAssets',
                  args: [ERC4626_LOOKBACK_UNIT],
                  blockNumber: pastBlockNumber,
                }),
              ]);
              if (pricePast > ZERO) {
                aprPct = ((Number(priceNow) - Number(pricePast)) / Number(pricePast)) * (365 / 7) * 100;
              }
            } catch {
              // venue price history unavailable; skip it
            }
          } else {
            const rate = await flarePublicClient.readContract({
              address: venue.kToken,
              abi: ktokenSupplyRateAbi,
              functionName: 'supplyRatePerTimestamp',
            }).catch(() => null);
            if (rate !== null) aprPct = perSecondRateToAprPct(rate);
          }

          if (aprPct === null) continue;
          bestSupplyAprPct = bestSupplyAprPct === null ? aprPct : Math.max(bestSupplyAprPct, aprPct);
          if (assets > ZERO) {
            supplyWeighted += aprPct * Number(assets);
            supplyCovered += assets;
          }
        }

        const supplyAprPct = supplyCovered > ZERO ? supplyWeighted / Number(supplyCovered) : bestSupplyAprPct;
        if (supplyAprPct === null) throw new Error('No readable lending-venue rate.');

        const spreadPct = supplyAprPct - borrowAprPct;
        // Net APR on total posted collateral, accounting for LTV dilution:
        // (interest earned on deployed USDT0 - interest paid on debt) / collateral value.
        const netAprPct = (deployedUsdt0 > ZERO || debt > ZERO) && effectiveCollateralValue > ZERO
          ? (((supplyAprPct / 100) * Number(deployedUsdt0) - (borrowAprPct / 100) * Number(debt)) / Number(effectiveCollateralValue)) * 100
          : spreadPct * (Number(maxBorrowLtvBps) / 10_000);

        if (!cancelled) {
          setState({
            netAprPct,
            spreadPct,
            ltvPct: Number(ltvBps) / 100,
            maxLtvPct: Number(maxBorrowLtvBps) / 100,
            isLoading: false,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Unable to read live APR.',
          }));
        }
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [vaultAddress, enabled]);

  return state;
}

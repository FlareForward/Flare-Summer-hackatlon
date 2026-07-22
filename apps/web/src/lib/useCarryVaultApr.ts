'use client';

import { useEffect, useState } from 'react';
import { encodeAbiParameters, keccak256, type Address } from 'viem';
import { flarePublicClient } from '@/config/wagmi';
import {
  carryVaultAprAbi,
  erc4626VaultAbi,
  irmBorrowRateAbi,
  ktokenPositionAbi,
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
const EXCHANGE_RATE_SCALE = BigInt(10) ** BigInt(18);

// This vault's `_venues` array lives at storage slot 23. Its `getVenue`/`venueAssets` view
// helpers revert on the deployment behind this hackathon's FXRP Carry Vault (confirmed against
// the live contract), so — same as STFLR VAULT's dashboard does for pre-helper deployments —
// fall back to decoding the packed struct straight out of storage when the helper calls fail.
const CARRY_VENUES_STORAGE_SLOT = BigInt(23);

function storageSlot(slot: bigint): `0x${string}` {
  return `0x${slot.toString(16).padStart(64, '0')}` as `0x${string}`;
}

function wordToAddress(word: `0x${string}` | undefined): Address {
  return `0x${(word || '0x0').slice(-40)}` as Address;
}

function carryVenueBaseSlot(): bigint {
  const encoded = encodeAbiParameters([{ type: 'uint256' }], [CARRY_VENUES_STORAGE_SLOT]);
  return BigInt(keccak256(encoded));
}

// Struct layout: { kToken: address, comptroller: address, redeemable: bool, enabled: bool,
// maxAllocationBps: uint16, kind: uint8 } packed across two 32-byte slots.
function decodeCarryVenueStorage(slot0: `0x${string}` | undefined, slot1: `0x${string}` | undefined) {
  const packed = BigInt(slot1 || '0x0');
  return {
    target: wordToAddress(slot0),
    enabled: ((packed >> BigInt(168)) & BigInt(0xff)) !== ZERO,
    kind: Number((packed >> BigInt(192)) & BigInt(0xff)),
  };
}

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

        const venueBaseSlot = carryVenueBaseSlot();

        for (let i = ZERO; i < venueCount && i < BigInt(MAX_VENUES); i += ONE) {
          const viaHelper = await rc<{ kToken: Address; enabled: boolean; kind: number }>('getVenue', [i]).catch(() => null);
          let venue: { target: Address; enabled: boolean; kind: number };
          if (viaHelper) {
            venue = { target: viaHelper.kToken, enabled: viaHelper.enabled, kind: viaHelper.kind };
          } else {
            const slotIndex = venueBaseSlot + i * BigInt(2);
            const [slot0, slot1] = await Promise.all([
              flarePublicClient.getStorageAt({ address: vaultAddress, slot: storageSlot(slotIndex) }),
              flarePublicClient.getStorageAt({ address: vaultAddress, slot: storageSlot(slotIndex + ONE) }),
            ]);
            venue = decodeCarryVenueStorage(slot0, slot1);
          }
          if (!venue.target || venue.target === '0x0000000000000000000000000000000000000000' || !venue.enabled) continue;

          let aprPct: number | null = null;
          let assets = await rc<bigint>('venueAssets', [i]).catch(() => null);

          if (venue.kind === 1) {
            // ERC4626 venue: infer APR from the 7-day change in its share price.
            if (pastBlockNumber === null) {
              const blockNumber = await flarePublicClient.getBlockNumber();
              const sevenDaysOfBlocks = FLARE_BLOCKS_PER_DAY * BigInt(7);
              pastBlockNumber = blockNumber > sevenDaysOfBlocks ? blockNumber - sevenDaysOfBlocks : ONE;
            }
            if (assets === null) {
              const shares = await flarePublicClient.readContract({
                address: venue.target,
                abi: erc4626VaultAbi,
                functionName: 'balanceOf',
                args: [vaultAddress],
              }).catch(() => ZERO);
              assets = shares > ZERO
                ? await flarePublicClient.readContract({
                  address: venue.target,
                  abi: erc4626VaultAbi,
                  functionName: 'convertToAssets',
                  args: [shares],
                }).catch(() => ZERO)
                : ZERO;
            }
            try {
              const [priceNow, pricePast] = await Promise.all([
                flarePublicClient.readContract({
                  address: venue.target,
                  abi: erc4626VaultAbi,
                  functionName: 'convertToAssets',
                  args: [ERC4626_LOOKBACK_UNIT],
                }),
                flarePublicClient.readContract({
                  address: venue.target,
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
            if (assets === null) {
              const [shares, exchangeRate] = await Promise.all([
                flarePublicClient.readContract({
                  address: venue.target,
                  abi: ktokenPositionAbi,
                  functionName: 'balanceOf',
                  args: [vaultAddress],
                }).catch(() => ZERO),
                flarePublicClient.readContract({
                  address: venue.target,
                  abi: ktokenPositionAbi,
                  functionName: 'exchangeRateStored',
                }).catch(() => ZERO),
              ]);
              assets = (shares * exchangeRate) / EXCHANGE_RATE_SCALE;
            }
            const rate = await flarePublicClient.readContract({
              address: venue.target,
              abi: ktokenSupplyRateAbi,
              functionName: 'supplyRatePerTimestamp',
            }).catch(() => null);
            if (rate !== null) aprPct = perSecondRateToAprPct(rate);
          }

          assets = assets ?? ZERO;
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

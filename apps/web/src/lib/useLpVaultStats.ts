'use client';

import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { flarePublicClient } from '@/config/wagmi';
import { erc4626VaultAbi } from '@/config/abis';

// Live stats for a direct-entry (no-leverage) LP vault: the leaf contract itself, read the same
// way the STFLR VAULT dashboard reads every 'clamm_lp' vault (totalAssets/convertToAssets are
// exposed on-chain even though the hackathon's minimal ABI omits them). APR uses the same 7-day
// share-price-change methodology as useCarryVaultApr's leafAprPct, since it's the same leaf.

const FLARE_BLOCKS_PER_DAY = BigInt(48_000);
const POLL_INTERVAL_MS = 30_000;
const ZERO = BigInt(0);
const ONE = BigInt(1);

export type LpVaultStats = {
  totalAssets: bigint | null;
  aprPct: number | null;
  isLoading: boolean;
  error: string | null;
};

const INITIAL_STATE: LpVaultStats = {
  totalAssets: null,
  aprPct: null,
  isLoading: true,
  error: null,
};

export function useLpVaultStats(vaultAddress: Address, enabled: boolean, shareDecimals: number): LpVaultStats {
  const [state, setState] = useState<LpVaultStats>(enabled ? INITIAL_STATE : { ...INITIAL_STATE, isLoading: false });

  useEffect(() => {
    if (!enabled) {
      setState({ ...INITIAL_STATE, isLoading: false });
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const oneShare = BigInt(10) ** BigInt(shareDecimals);
        const blockNumber = await flarePublicClient.getBlockNumber();
        const sevenDaysOfBlocks = FLARE_BLOCKS_PER_DAY * BigInt(7);
        const pastBlockNumber = blockNumber > sevenDaysOfBlocks ? blockNumber - sevenDaysOfBlocks : ONE;

        const [totalAssets, assetsNow, assetsPast] = await Promise.all([
          flarePublicClient.readContract({ address: vaultAddress, abi: erc4626VaultAbi, functionName: 'totalAssets' }),
          flarePublicClient.readContract({ address: vaultAddress, abi: erc4626VaultAbi, functionName: 'convertToAssets', args: [oneShare] }),
          flarePublicClient
            .readContract({ address: vaultAddress, abi: erc4626VaultAbi, functionName: 'convertToAssets', args: [oneShare], blockNumber: pastBlockNumber })
            .catch(() => null),
        ]);

        const aprPct = assetsPast !== null && assetsPast > ZERO
          ? ((Number(assetsNow) - Number(assetsPast)) / Number(assetsPast)) * (365 / 7) * 100
          : null;

        if (!cancelled) {
          setState({ totalAssets, aprPct, isLoading: false, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Unable to read live LP vault stats.',
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
  }, [vaultAddress, enabled, shareDecimals]);

  return state;
}

import { formatUnits, type Address, type PublicClient } from 'viem';
import { erc20Abi, spectraPoolAbi } from '@/config/abis';
import type { SpectraMarket } from '@/lib/spectra/markets';

export type SpectraTradeSide = 'buy' | 'sell';

export type SpectraPoolState = {
  ibtBalance: bigint;
  ptBalance: bigint;
  coinsVerified: boolean;
};

export type SpectraQuote = {
  side: SpectraTradeSide;
  amountIn: bigint;
  expectedOut: bigint;
  minimumReceived: bigint;
  averagePrice: number;
  priceImpactBps: number;
  quotedAt: number;
};

export const DEFAULT_SPECTRA_SLIPPAGE_BPS = 50;
export const MAX_SPECTRA_POOL_USAGE_BPS = 100;
export const MAX_SPECTRA_PRICE_IMPACT_BPS = 50;
export const SPECTRA_QUOTE_TTL_MS = 30_000;

export function bigintToNumber(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}

export function isSpectraQuoteStale(quotedAt?: number, now = Date.now()) {
  return !quotedAt || now - quotedAt > SPECTRA_QUOTE_TTL_MS;
}

export async function readSpectraPoolState(client: PublicClient, market: SpectraMarket): Promise<SpectraPoolState> {
  const [coin0, coin1, ibtBalance, ptBalance] = await Promise.all([
    client.readContract({ address: market.pool, abi: spectraPoolAbi, functionName: 'coins', args: [BigInt(0)] }),
    client.readContract({ address: market.pool, abi: spectraPoolAbi, functionName: 'coins', args: [BigInt(1)] }),
    client.readContract({ address: market.pool, abi: spectraPoolAbi, functionName: 'balances', args: [BigInt(0)] }),
    client.readContract({ address: market.pool, abi: spectraPoolAbi, functionName: 'balances', args: [BigInt(1)] }),
  ]);

  return {
    ibtBalance,
    ptBalance,
    coinsVerified: coin0.toLowerCase() === market.ibt.toLowerCase() && coin1.toLowerCase() === market.pt.toLowerCase(),
  };
}

export async function readTokenBalance(client: PublicClient, token: Address, account: Address): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account],
  });
}

export async function quoteSpectraPool(client: PublicClient, market: SpectraMarket, side: SpectraTradeSide, amountIn: bigint): Promise<bigint> {
  return client.readContract({
    address: market.pool,
    abi: spectraPoolAbi,
    functionName: 'get_dy',
    args: side === 'buy' ? [BigInt(0), BigInt(1), amountIn] : [BigInt(1), BigInt(0), amountIn],
  });
}

export function buildSpectraQuote(args: {
  side: SpectraTradeSide;
  amountIn: bigint;
  expectedOut: bigint;
  decimals: number;
  referencePrice: number;
  slippageBps?: number;
  quotedAt?: number;
}): SpectraQuote {
  const slippageBps = args.slippageBps ?? DEFAULT_SPECTRA_SLIPPAGE_BPS;
  const amountIn = bigintToNumber(args.amountIn, args.decimals);
  const expectedOut = bigintToNumber(args.expectedOut, args.decimals);
  const averagePrice = expectedOut > 0 && amountIn > 0
    ? args.side === 'buy'
      ? amountIn / expectedOut
      : expectedOut / amountIn
    : 0;
  const rawImpact = args.referencePrice > 0 && averagePrice > 0
    ? args.side === 'buy'
      ? (averagePrice - args.referencePrice) / args.referencePrice
      : (args.referencePrice - averagePrice) / args.referencePrice
    : 0;

  return {
    side: args.side,
    amountIn: args.amountIn,
    expectedOut: args.expectedOut,
    minimumReceived: (args.expectedOut * BigInt(10_000 - slippageBps)) / BigInt(10_000),
    averagePrice,
    priceImpactBps: Math.max(0, Math.round(rawImpact * 10_000)),
    quotedAt: args.quotedAt ?? Date.now(),
  };
}

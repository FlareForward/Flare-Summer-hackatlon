import type { SpectraTradeSide } from '@/lib/spectra/quotes';
import { buildSpectraQuote, MAX_SPECTRA_POOL_USAGE_BPS, MAX_SPECTRA_PRICE_IMPACT_BPS, type SpectraQuote } from '@/lib/spectra/quotes';

export const POOL_USAGE_CANDIDATES_BPS = [5, 10, 25, 50, 100] as const;

export type SpectraSuggestion = SpectraQuote & {
  poolUsageBps: number;
  cappedByBalance: boolean;
  withinLimits: boolean;
};

export type SpectraSuggestionCandidate = {
  usageBps: number;
  amountIn: bigint;
  expectedOut: bigint;
};

export function createSpectraCandidates(poolBalance: bigint, userBalance?: bigint): SpectraSuggestionCandidate[] {
  return POOL_USAGE_CANDIDATES_BPS
    .map((usageBps) => {
      const poolSizedAmount = (poolBalance * BigInt(usageBps)) / BigInt(10_000);
      const amountIn = userBalance != null && userBalance < poolSizedAmount ? userBalance : poolSizedAmount;
      return {
        usageBps,
        amountIn,
        expectedOut: BigInt(0),
      };
    })
    .filter((candidate) => candidate.amountIn > BigInt(0));
}

export function selectSpectraSuggestion(args: {
  side: SpectraTradeSide;
  candidates: SpectraSuggestionCandidate[];
  poolBalance: bigint;
  userBalance?: bigint;
  decimals: number;
  referencePrice: number;
  slippageBps?: number;
}): SpectraSuggestion | null {
  const suggestions = args.candidates.map((candidate) => {
    const quote = buildSpectraQuote({
      side: args.side,
      amountIn: candidate.amountIn,
      expectedOut: candidate.expectedOut,
      decimals: args.decimals,
      referencePrice: args.referencePrice,
      slippageBps: args.slippageBps,
    });
    const poolUsageBps = args.poolBalance > BigInt(0)
      ? Number((candidate.amountIn * BigInt(10_000)) / args.poolBalance)
      : 0;
    const cappedByBalance = args.userBalance != null && candidate.amountIn >= args.userBalance;

    return {
      ...quote,
      poolUsageBps,
      cappedByBalance,
      withinLimits: poolUsageBps <= MAX_SPECTRA_POOL_USAGE_BPS && quote.priceImpactBps <= MAX_SPECTRA_PRICE_IMPACT_BPS,
    };
  });

  return suggestions.filter((suggestion) => suggestion.withinLimits).at(-1) ?? suggestions[0] ?? null;
}

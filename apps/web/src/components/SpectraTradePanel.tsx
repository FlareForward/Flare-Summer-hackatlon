'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPublicClient, formatUnits, http, parseUnits } from 'viem';
import { flare } from '@/config/wagmi';
import type { SpectraMarket } from '@/lib/spectra/markets';
import {
  DEFAULT_SPECTRA_SLIPPAGE_BPS,
  MAX_SPECTRA_POOL_USAGE_BPS,
  MAX_SPECTRA_PRICE_IMPACT_BPS,
  bigintToNumber,
  buildSpectraQuote,
  quoteSpectraPool,
  readSpectraPoolState,
  type SpectraPoolState,
  type SpectraQuote,
  type SpectraTradeSide,
} from '@/lib/spectra/quotes';
import { createSpectraCandidates, selectSpectraSuggestion, type SpectraSuggestion } from '@/lib/spectra/suggestions';

type Props = {
  market?: SpectraMarket;
};

type Suggestions = {
  buy: SpectraSuggestion | null;
  sell: SpectraSuggestion | null;
};

type ReferencePrices = {
  buy: number;
  sell: number;
};

function formatAmount(value?: bigint, decimals = 18, symbol = '') {
  if (value == null) return '-';
  const [whole, fraction = ''] = formatUnits(value, decimals).split('.');
  const trimmed = fraction.slice(0, 4).replace(/0+$/, '');
  return `${trimmed ? `${whole}.${trimmed}` : whole}${symbol ? ` ${symbol}` : ''}`;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function formatBps(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

function formatPrice(value?: number) {
  return value && value > 0 ? value.toFixed(6) : '-';
}

function tokenLabel(side: SpectraTradeSide, market: SpectraMarket) {
  return side === 'buy' ? 'stXRP' : 'PT';
}

function receiveLabel(side: SpectraTradeSide) {
  return side === 'buy' ? 'PT' : 'stXRP';
}

function averagePrice(side: SpectraTradeSide, amountIn: bigint, expectedOut: bigint, decimals: number) {
  const amount = bigintToNumber(amountIn, decimals);
  const out = bigintToNumber(expectedOut, decimals);
  if (amount <= 0 || out <= 0) return 0;
  return side === 'buy' ? amount / out : out / amount;
}

function referencePriceFromFirstQuote(
  side: SpectraTradeSide,
  candidates: Array<{ amountIn: bigint; expectedOut: bigint }>,
  decimals: number,
  fallback: number,
) {
  const first = candidates.find((candidate) => candidate.amountIn > BigInt(0) && candidate.expectedOut > BigInt(0));
  return first ? averagePrice(side, first.amountIn, first.expectedOut, decimals) : fallback;
}

function maturityLabel(maturityTs: number) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(maturityTs * 1000));
}

export function SpectraTradePanel({ market }: Props) {
  const [side, setSide] = useState<SpectraTradeSide>('buy');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SPECTRA_SLIPPAGE_BPS);
  const [poolState, setPoolState] = useState<SpectraPoolState | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestions>({ buy: null, sell: null });
  const [referencePrices, setReferencePrices] = useState<ReferencePrices>({ buy: 0, sell: 0 });
  const [quote, setQuote] = useState<SpectraQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: flare,
        transport: http(process.env.NEXT_PUBLIC_FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc'),
      }),
    [],
  );

  const refreshMarket = useCallback(async (nextSide = side, nextAmount = amount) => {
    if (!market) return;
    setBusy(true);
    setStatus('Refreshing quote...');
    try {
      const state = await readSpectraPoolState(publicClient, market);
      setPoolState(state);
      if (!state.coinsVerified) {
        setStatus('This pool failed token verification and cannot be quoted.');
        setSuggestions({ buy: null, sell: null });
        setQuote(null);
        return;
      }

      const buyCandidates = createSpectraCandidates(state.ibtBalance);
      const sellCandidates = createSpectraCandidates(state.ptBalance);
      const [quotedBuyCandidates, quotedSellCandidates] = await Promise.all([
        Promise.all(buyCandidates.map(async (candidate) => ({
          ...candidate,
          expectedOut: await quoteSpectraPool(publicClient, market, 'buy', candidate.amountIn),
        }))),
        Promise.all(sellCandidates.map(async (candidate) => ({
          ...candidate,
          expectedOut: await quoteSpectraPool(publicClient, market, 'sell', candidate.amountIn),
        }))),
      ]);

      const nextReferencePrices = {
        buy: referencePriceFromFirstQuote('buy', quotedBuyCandidates, market.decimals, market.ptPriceUnderlying),
        sell: referencePriceFromFirstQuote('sell', quotedSellCandidates, market.decimals, market.ptPriceUnderlying),
      };
      setReferencePrices(nextReferencePrices);

      const nextSuggestions = {
        buy: selectSpectraSuggestion({
          side: 'buy',
          candidates: quotedBuyCandidates,
          poolBalance: state.ibtBalance,
          decimals: market.decimals,
          referencePrice: nextReferencePrices.buy,
          slippageBps,
        }),
        sell: selectSpectraSuggestion({
          side: 'sell',
          candidates: quotedSellCandidates,
          poolBalance: state.ptBalance,
          decimals: market.decimals,
          referencePrice: nextReferencePrices.sell,
          slippageBps,
        }),
      };
      setSuggestions(nextSuggestions);

      const typedAmount = nextAmount.trim();
      const fallback = nextSuggestions[nextSide]?.amountIn;
      const amountIn = typedAmount ? parseUnits(typedAmount, market.decimals) : fallback;
      if (amountIn && amountIn > BigInt(0)) {
        const expectedOut = await quoteSpectraPool(publicClient, market, nextSide, amountIn);
        const nextQuote = buildSpectraQuote({
          side: nextSide,
          amountIn,
          expectedOut,
          decimals: market.decimals,
          referencePrice: nextReferencePrices[nextSide],
          slippageBps,
        });
        setQuote(nextQuote);
        if (!typedAmount && fallback) setAmount(formatUnits(fallback, market.decimals));
      } else {
        setQuote(null);
      }
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to quote Spectra market.');
      setQuote(null);
    } finally {
      setBusy(false);
    }
  }, [amount, market, publicClient, side, slippageBps]);

  useEffect(() => {
    setPoolState(null);
    setSuggestions({ buy: null, sell: null });
    setQuote(null);
    setAmount('');
    if (market) void refreshMarket('buy', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.pool]);

  useEffect(() => {
    if (!market) return;
    const timeout = setTimeout(() => {
      void refreshMarket(side, amount);
    }, 450);
    return () => clearTimeout(timeout);
  }, [amount, side, slippageBps, market, refreshMarket]);

  if (!market) {
    return (
      <section className="panel spectra-trade-panel simplified">
        <div className="section-heading">
          <div><p className="eyebrow">Trade</p><h2>Select a market</h2></div>
        </div>
      </section>
    );
  }

  const activeSuggestion = suggestions[side];
  const quotePoolBalance = side === 'buy' ? poolState?.ibtBalance : poolState?.ptBalance;
  const selectedUsageBps = quote && quotePoolBalance && quotePoolBalance > BigInt(0)
    ? Number((quote.amountIn * BigInt(10_000)) / quotePoolBalance)
    : 0;
  const exceedsUsage = selectedUsageBps > MAX_SPECTRA_POOL_USAGE_BPS;
  const exceedsImpact = Boolean(quote && quote.priceImpactBps > MAX_SPECTRA_PRICE_IMPACT_BPS);

  return (
    <section className="panel spectra-trade-panel simplified">
      <div className="spectra-simple-header">
        <div>
          <p className="eyebrow">Trade</p>
          <h2>{side === 'buy' ? 'Buy PT' : 'Sell PT'}</h2>
          <p>{market.symbol}</p>
        </div>
        <div className="spectra-market-mini">
          <span>{formatUsd(market.liquidityUsd)} liquidity</span>
          <span>{maturityLabel(market.maturityTs)} maturity</span>
        </div>
      </div>

      <div className="spectra-order-box simple">
        <div className="trade-side-tabs" role="tablist" aria-label="Trade side">
          <button type="button" className={side === 'buy' ? 'active' : ''} onClick={() => setSide('buy')}>Buy</button>
          <button type="button" className={side === 'sell' ? 'active' : ''} onClick={() => setSide('sell')}>Sell</button>
        </div>
        <label className="amount-control spectra-amount">
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label="Spectra trade amount" />
          <span>{tokenLabel(side, market)}</span>
        </label>
        <button
          type="button"
          className="ghost-button compact-button"
          onClick={() => {
            if (activeSuggestion) setAmount(formatUnits(activeSuggestion.amountIn, market.decimals));
          }}
          disabled={!activeSuggestion || busy}
        >
          Use suggested
        </button>
      </div>

      <div className="spectra-quote-summary">
        <div>
          <span>You receive</span>
          <strong>{formatAmount(quote?.expectedOut, market.decimals, receiveLabel(side))}</strong>
        </div>
        <div>
          <span>Minimum</span>
          <strong>{formatAmount(quote?.minimumReceived, market.decimals, receiveLabel(side))}</strong>
        </div>
        <div>
          <span>Avg price</span>
          <strong>{formatPrice(quote?.averagePrice)}</strong>
        </div>
        <div className={exceedsImpact ? 'danger' : ''}>
          <span>Price impact</span>
          <strong>{quote ? formatBps(quote.priceImpactBps) : '-'}</strong>
        </div>
      </div>

      <div className="spectra-limit-line">
        <span>Max impact: {formatBps(MAX_SPECTRA_PRICE_IMPACT_BPS)}</span>
        <span>Max pool use: {formatBps(MAX_SPECTRA_POOL_USAGE_BPS)}</span>
        <span>Slippage: {formatBps(slippageBps)}</span>
      </div>

      <details className="advanced-box spectra-advanced compact">
        <summary>Slippage</summary>
        <label className="position-input">
          <span>Basis points</span>
          <input value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value) || 0)} inputMode="numeric" />
        </label>
      </details>

      {exceedsImpact ? <p className="status-line warning">Reduce size. Price impact must stay at or below 50 bps.</p> : null}
      {exceedsUsage ? <p className="status-line warning">Reduce size. Pool usage must stay at or below 1%.</p> : null}
      {status ? <p className="status-line">{status}</p> : null}
    </section>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPublicClient, formatUnits, http, isAddress, parseUnits, type Address } from 'viem';
import { flare } from '@/config/wagmi';
import { shortAddress } from '@/lib/format';
import type { FsaCall } from '@/lib/fsa';
import { buildSpectraTradeCalls } from '@/lib/spectra/calls';
import type { SpectraMarket } from '@/lib/spectra/markets';
import {
  DEFAULT_SPECTRA_SLIPPAGE_BPS,
  MAX_SPECTRA_POOL_USAGE_BPS,
  MAX_SPECTRA_PRICE_IMPACT_BPS,
  bigintToNumber,
  buildSpectraQuote,
  isSpectraQuoteStale,
  quoteSpectraPool,
  readSpectraPoolState,
  readTokenBalance,
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

function formatAmount(value?: bigint, decimals = 18, symbol = '') {
  if (value == null) return '-';
  const [whole, fraction = ''] = formatUnits(value, decimals).split('.');
  const trimmed = fraction.slice(0, 4).replace(/0+$/, '');
  return `${trimmed ? `${whole}.${trimmed}` : whole}${symbol ? ` ${symbol}` : ''}`;
}

function formatPrice(value: number) {
  return value > 0 ? value.toFixed(6) : '-';
}

function formatBps(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

function marketToken(side: SpectraTradeSide, market: SpectraMarket) {
  return side === 'buy' ? 'stXRP' : market.symbol;
}

export function SpectraTradePanel({ market }: Props) {
  const [side, setSide] = useState<SpectraTradeSide>('buy');
  const [personalAccountInput, setPersonalAccountInput] = useState('');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SPECTRA_SLIPPAGE_BPS);
  const [poolState, setPoolState] = useState<SpectraPoolState | null>(null);
  const [balances, setBalances] = useState<{ ibt?: bigint; pt?: bigint }>({});
  const [suggestions, setSuggestions] = useState<Suggestions>({ buy: null, sell: null });
  const [quote, setQuote] = useState<SpectraQuote | null>(null);
  const [calls, setCalls] = useState<FsaCall[]>([]);
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

  const personalAccount = isAddress(personalAccountInput) ? personalAccountInput as Address : undefined;

  const refreshMarket = useCallback(async (nextSide = side, nextAmount = amount) => {
    if (!market) return;
    setBusy(true);
    setStatus('Reading Spectra pool on Flare...');
    try {
      const state = await readSpectraPoolState(publicClient, market);
      setPoolState(state);
      if (!state.coinsVerified) {
        setStatus('Pool token check failed. This market is blocked because coins(0/1) do not match the API addresses.');
        setSuggestions({ buy: null, sell: null });
        setQuote(null);
        setCalls([]);
        return;
      }

      const [ibtBalance, ptBalance] = personalAccount
        ? await Promise.all([
            readTokenBalance(publicClient, market.ibt, personalAccount),
            readTokenBalance(publicClient, market.pt, personalAccount),
          ])
        : [undefined, undefined];
      setBalances({ ibt: ibtBalance, pt: ptBalance });

      const buyCandidates = createSpectraCandidates(state.ibtBalance, ibtBalance);
      const sellCandidates = createSpectraCandidates(state.ptBalance, ptBalance);
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

      const nextSuggestions = {
        buy: selectSpectraSuggestion({
          side: 'buy',
          candidates: quotedBuyCandidates,
          poolBalance: state.ibtBalance,
          userBalance: ibtBalance,
          decimals: market.decimals,
          referencePrice: market.ptPriceUnderlying,
          slippageBps,
        }),
        sell: selectSpectraSuggestion({
          side: 'sell',
          candidates: quotedSellCandidates,
          poolBalance: state.ptBalance,
          userBalance: ptBalance,
          decimals: market.decimals,
          referencePrice: market.ptPriceUnderlying,
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
          referencePrice: market.ptPriceUnderlying,
          slippageBps,
        });
        setQuote(nextQuote);
        setCalls(buildSpectraTradeCalls({ market, side: nextSide, amountIn, minimumReceived: nextQuote.minimumReceived }));
        if (!typedAmount && fallback) setAmount(formatUnits(fallback, market.decimals));
      } else {
        setQuote(null);
        setCalls([]);
      }
      setStatus('Quote refreshed from the selected Spectra pool.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to quote Spectra market.');
      setQuote(null);
      setCalls([]);
    } finally {
      setBusy(false);
    }
  }, [amount, market, personalAccount, publicClient, side, slippageBps]);

  useEffect(() => {
    setPoolState(null);
    setBalances({});
    setSuggestions({ buy: null, sell: null });
    setQuote(null);
    setCalls([]);
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
  }, [amount, side, slippageBps, personalAccountInput, market, refreshMarket]);

  if (!market) {
    return (
      <section className="panel spectra-trade-panel">
        <div className="section-heading">
          <div><p className="eyebrow">Trade panel</p><h2>Select a PT market</h2></div>
        </div>
        <p className="muted-note">Choose an eligible Spectra pool to load balances, suggestions, and a fresh on-chain quote.</p>
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
  const stale = isSpectraQuoteStale(quote?.quotedAt);
  const canSign = Boolean(quote && poolState?.coinsVerified && !exceedsUsage && !exceedsImpact && !stale);

  return (
    <section className="panel spectra-trade-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Spectra trade panel</p>
          <h2>{market.symbol}</h2>
        </div>
        <button type="button" className="ghost-button compact-button" onClick={() => refreshMarket(side, amount)} disabled={busy}>
          {busy ? 'Refreshing...' : 'Refresh quote'}
        </button>
      </div>

      <div className="account-strip">
        <div><span>Maturity</span><strong>{new Date(market.maturityTs * 1000).toLocaleDateString()}</strong></div>
        <div><span>Pool liquidity</span><strong>${market.liquidityUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
        <div><span>Pool stXRP</span><strong>{formatAmount(poolState?.ibtBalance, market.decimals, 'stXRP')}</strong></div>
        <div><span>Pool PT</span><strong>{formatAmount(poolState?.ptBalance, market.decimals, market.symbol)}</strong></div>
      </div>

      <label className="manual-address">
        Personal Account balance check
        <input
          value={personalAccountInput}
          onChange={(event) => setPersonalAccountInput(event.target.value)}
          placeholder="0x..."
        />
      </label>

      <div className="account-strip">
        <div><span>Smart Account stXRP</span><strong>{formatAmount(balances.ibt, market.decimals, 'stXRP')}</strong></div>
        <div><span>Smart Account PT</span><strong>{formatAmount(balances.pt, market.decimals, market.symbol)}</strong></div>
        <div><span>Pool token check</span><strong>{poolState ? poolState.coinsVerified ? 'Verified' : 'Blocked' : '-'}</strong></div>
        <div><span>Quote age</span><strong>{quote ? `${Math.floor((Date.now() - quote.quotedAt) / 1000)}s` : '-'}</strong></div>
      </div>

      <div className="spectra-suggestions">
        {(['buy', 'sell'] as const).map((suggestionSide) => {
          const suggestion = suggestions[suggestionSide];
          return (
            <button
              type="button"
              key={suggestionSide}
              className={side === suggestionSide ? 'spectra-suggestion-card selected' : 'spectra-suggestion-card'}
              onClick={() => {
                setSide(suggestionSide);
                if (suggestion) setAmount(formatUnits(suggestion.amountIn, market.decimals));
              }}
            >
              <span className="position-label">Suggested {suggestionSide}</span>
              <strong>{formatAmount(suggestion?.amountIn, market.decimals, marketToken(suggestionSide, market))}</strong>
              <p>Receive {formatAmount(suggestion?.expectedOut, market.decimals, suggestionSide === 'buy' ? market.symbol : 'stXRP')}</p>
              <em>{suggestion ? `${formatBps(suggestion.priceImpactBps)} impact, ${formatBps(suggestion.poolUsageBps)} pool usage` : 'Waiting for quote'}</em>
            </button>
          );
        })}
      </div>

      <div className="spectra-order-box">
        <div className="trade-side-tabs" role="tablist" aria-label="Trade side">
          <button type="button" className={side === 'buy' ? 'active' : ''} onClick={() => setSide('buy')}>Buy PT</button>
          <button type="button" className={side === 'sell' ? 'active' : ''} onClick={() => setSide('sell')}>Sell PT</button>
        </div>
        <label className="amount-control spectra-amount">
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label="Spectra trade amount" />
          <span>{marketToken(side, market)}</span>
        </label>
        <details className="advanced-box spectra-advanced">
          <summary>Advanced settings</summary>
          <label className="position-input">
            <span>Slippage bps</span>
            <input value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value) || 0)} inputMode="numeric" />
          </label>
        </details>
      </div>

      <div className="protocol-facts compact-facts">
        <div><span>Expected out</span><strong>{formatAmount(quote?.expectedOut, market.decimals, side === 'buy' ? market.symbol : 'stXRP')}</strong></div>
        <div><span>Minimum received</span><strong>{formatAmount(quote?.minimumReceived, market.decimals, side === 'buy' ? market.symbol : 'stXRP')}</strong></div>
        <div><span>Average price</span><strong>{quote ? formatPrice(quote.averagePrice) : '-'}</strong></div>
        <div><span>Price impact</span><strong>{quote ? formatBps(quote.priceImpactBps) : '-'}</strong></div>
      </div>

      {activeSuggestion?.cappedByBalance ? <p className="status-line warning">Suggestion is capped by the Personal Account balance.</p> : null}
      {exceedsUsage ? <p className="status-line warning">Amount exceeds the 1% pool-usage limit.</p> : null}
      {exceedsImpact ? <p className="status-line warning">Amount exceeds the 0.50% price-impact limit.</p> : null}
      {stale && quote ? <p className="status-line warning">Quote is older than 30 seconds. Refresh before signing.</p> : null}
      {status ? <p className="status-line">{status}</p> : null}

      {calls.length > 0 ? (
        <div className="call-plan">
          <h3>Call plan</h3>
          {calls.map((call) => (
            <div className="call-row" key={`${call.label}-${call.target}`}>
              <span>{call.label}</span>
              <code>{shortAddress(call.target)}</code>
            </div>
          ))}
        </div>
      ) : null}

      <button type="button" disabled className="spectra-sign-button">
        {canSign ? 'Signing integration pending' : 'Reduce amount or refresh quote'}
      </button>
    </section>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPublicClient, formatUnits, http, parseUnits, type Address, type Hex } from 'viem';
import { assetManagerAbi, erc20Abi, masterAccountControllerAbi, stakedXrpAbi } from '@/config/abis';
import { flare } from '@/config/wagmi';
import { ASSET_MANAGER_FXRP, FXRP_ADDRESS, MASTER_ACCOUNT_CONTROLLER } from '@/config/vaults';
import { buildHashCommittedUserOp, buildMemoFieldUserOp, computeDirectMintingPaymentDrops } from '@/lib/fsa';
import { createXamanPayload, getXamanPayloadStatus, type XamanPayload, type XamanPayloadStatus } from '@/lib/xaman';
import { useXamanConnect } from '@/lib/xamanConnect';
import { signDcentInstructionPayment, useDcentXrplConnect } from '@/lib/dcent';
import { signBifrostInstructionPayment, useBifrostConnect } from '@/lib/bifrostConnect';
import { buildSpectraDirectMintBuyCalls } from '@/lib/spectra/calls';
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

type BuyInputAsset = 'xrp' | 'fxrp';

type SpectraPayment = { memo: Hex; paymentDrops: string; label: string };

const XRPL_MEMO_HEX_LIMIT = 2048;

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

function tokenLabel(side: SpectraTradeSide, inputAsset: BuyInputAsset) {
  return side === 'buy' ? inputAsset.toUpperCase() : 'PT';
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
  const [buyInputAsset, setBuyInputAsset] = useState<BuyInputAsset>('xrp');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SPECTRA_SLIPPAGE_BPS);
  const [poolState, setPoolState] = useState<SpectraPoolState | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestions>({ buy: null, sell: null });
  const [referencePrices, setReferencePrices] = useState<ReferencePrices>({ buy: 0, sell: 0 });
  const [quote, setQuote] = useState<SpectraQuote | null>(null);
  const [quoteFxrpIn, setQuoteFxrpIn] = useState<bigint | null>(null);
  const [xamanPayload, setXamanPayload] = useState<XamanPayload | null>(null);
  const [xamanStatus, setXamanStatus] = useState<XamanPayloadStatus | null>(null);
  const [xamanSequence, setXamanSequence] = useState<{ payments: SpectraPayment[]; destination: string; currentIndex: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const { account: xamanAccount, connecting: xamanConnecting, error: xamanError, connect: connectXaman } = useXamanConnect();
  const { account: dcentAccount, connecting: dcentConnecting, error: dcentError, connect: connectDcent } = useDcentXrplConnect();
  const { account: bifrostAccount, topic: bifrostTopic, connecting: bifrostConnecting, error: bifrostError, connect: connectBifrost } = useBifrostConnect();

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
      const typedAmountIn = typedAmount ? parseUnits(typedAmount, market.decimals) : undefined;
      if (typedAmountIn && typedAmountIn > BigInt(0)) {
        const amountIn = nextSide === 'buy'
          ? await publicClient.readContract({
              address: market.ibt,
              abi: stakedXrpAbi,
              functionName: 'previewDeposit',
              args: [typedAmountIn],
            })
          : typedAmountIn;
        const conservativeAmountIn = nextSide === 'buy' ? (amountIn * BigInt(9_995)) / BigInt(10_000) : amountIn;
        const expectedOut = await quoteSpectraPool(publicClient, market, nextSide, conservativeAmountIn);
        const nextQuote = buildSpectraQuote({
          side: nextSide,
          amountIn: conservativeAmountIn,
          expectedOut,
          decimals: market.decimals,
          referencePrice: nextReferencePrices[nextSide],
          slippageBps,
        });
        setQuote(nextQuote);
        setQuoteFxrpIn(nextSide === 'buy' ? typedAmountIn : null);
      } else {
        setQuote(null);
        setQuoteFxrpIn(null);
      }
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to quote Spectra market.');
      setQuote(null);
    } finally {
      setBusy(false);
    }
  }, [amount, market, publicClient, side, slippageBps]);

  async function submitHashCommittedDirectMint(args: {
    memo: Hex;
    packedUserOperation: Hex;
    userOpHash: Hex;
    sender: Address;
    nonce: bigint;
    destination: string;
    amountDrops: string;
  }) {
    const executorUrl = process.env.NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL;
    if (!executorUrl) throw new Error('Hash-committed Spectra buys require NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL.');
    const response = await fetch(executorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'directMintUserOp',
        memo: args.memo,
        packedUserOperation: args.packedUserOperation,
        userOpHash: args.userOpHash,
        sender: args.sender,
        nonce: args.nonce.toString(),
        destination: args.destination,
        amountDrops: args.amountDrops,
        vault: market?.pool,
      }),
    });
    if (!response.ok) throw new Error(await response.text().catch(() => 'Executor did not accept the committed UserOp.'));
  }

  async function createSpectraXamanPayload(payments: SpectraPayment[], destination: string, index: number) {
    const payment = payments[index];
    setStatus(`Creating Xaman request ${index + 1} of ${payments.length}: ${payment.label}...`);
    const payload = await createXamanPayload(destination, payment.paymentDrops, payment.memo);
    setXamanPayload(payload);
    setXamanStatus(null);
    setXamanSequence({ payments, destination, currentIndex: index });
    setStatus(`Open Xaman and sign payment ${index + 1} of ${payments.length}: ${payment.label}.`);
  }

  async function signSplitBuyWithXaman(payments: SpectraPayment[], destination: string) {
    try {
      await createSpectraXamanPayload(payments, destination, 0);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create Xaman direct-mint payment.');
      setXamanSequence(null);
    }
  }

  async function signSplitBuyWithDcent(payments: SpectraPayment[], destination: string, account: string) {
    const signedTxids: string[] = [];
    for (let i = 0; i < payments.length; i += 1) {
      const payment = payments[i];
      setStatus(`Confirm D'CENT payment ${i + 1} of ${payments.length}: ${payment.label}.`);
      const result = await signDcentInstructionPayment({ account, destination, amountDrops: payment.paymentDrops, memoHex: payment.memo });
      if (!result.txid) throw new Error('Wallet completed but did not return an XRPL transaction hash. Check D\'CENT activity before trying again.');
      signedTxids.push(result.txid);
    }
    setStatus(`Signed ${payments.length} payments in D'CENT. Waiting for Smart Account execution.`);
  }

  async function signSplitBuyWithBifrost(payments: SpectraPayment[], destination: string, account: string, topic: string) {
    const signedTxids: string[] = [];
    for (let i = 0; i < payments.length; i += 1) {
      const payment = payments[i];
      setStatus(`Confirm Bifrost payment ${i + 1} of ${payments.length}: ${payment.label}.`);
      const result = await signBifrostInstructionPayment({ topic, account, destination, amountDrops: payment.paymentDrops, memoHex: payment.memo });
      if (!result.txid) throw new Error('Wallet completed but did not return an XRPL transaction hash. Check Bifrost activity before trying again.');
      signedTxids.push(result.txid);
    }
    setStatus(`Signed ${payments.length} payments in Bifrost. Waiting for Smart Account execution.`);
  }

  async function buyPtWithXaman() {
    if (!market || !quote || !quoteFxrpIn) return;
    const xrplAccount = dcentAccount ?? bifrostAccount ?? xamanAccount;
    if (!xrplAccount) return;
    setBusy(true);
    setStatus('Preparing XRP mint, stXRP stake, and PT buy...');
    try {
      const personalAccount = await publicClient.readContract({
        address: MASTER_ACCOUNT_CONTROLLER,
        abi: masterAccountControllerAbi,
        functionName: 'getPersonalAccount',
        args: [xrplAccount],
      });
      const [nonce, coreVaultXrplAddress, executorFeeDrops, feeBips, minimumFeeDrops, fxrpAllowance, stXrpAllowance] = await Promise.all([
        publicClient.readContract({
          address: MASTER_ACCOUNT_CONTROLLER,
          abi: masterAccountControllerAbi,
          functionName: 'getNonce',
          args: [personalAccount],
        }),
        publicClient.readContract({ address: ASSET_MANAGER_FXRP, abi: assetManagerAbi, functionName: 'directMintingPaymentAddress', args: [] }),
        publicClient.readContract({ address: ASSET_MANAGER_FXRP, abi: assetManagerAbi, functionName: 'getDirectMintingExecutorFeeUBA', args: [] }),
        publicClient.readContract({ address: ASSET_MANAGER_FXRP, abi: assetManagerAbi, functionName: 'getDirectMintingFeeBIPS', args: [] }),
        publicClient.readContract({ address: ASSET_MANAGER_FXRP, abi: assetManagerAbi, functionName: 'getDirectMintingMinimumFeeUBA', args: [] }),
        publicClient.readContract({ address: FXRP_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [personalAccount, market.ibt] }).catch(() => BigInt(0)),
        publicClient.readContract({ address: market.ibt, abi: erc20Abi, functionName: 'allowance', args: [personalAccount, market.pool] }).catch(() => BigInt(0)),
      ]);

      const calls = buildSpectraDirectMintBuyCalls({
        market,
        fxrpAmount: quoteFxrpIn,
        stXrpAmount: quote.amountIn,
        minimumPtReceived: quote.minimumReceived,
        personalAccount,
        fxrpAllowance,
        stXrpAllowance,
      });
      const fullPaymentDrops = computeDirectMintingPaymentDrops({
        netMintDrops: buyInputAsset === 'xrp' ? quoteFxrpIn : BigInt(0),
        feeBips,
        minimumFeeDrops,
        executorFeeDrops,
      }).toString();

      const inlineMemo = buildMemoFieldUserOp({ calls, sender: personalAccount, nonce });
      let payments: SpectraPayment[] = [{ memo: inlineMemo, paymentDrops: fullPaymentDrops, label: 'buy PT' }];

      if (inlineMemo.length - 2 > XRPL_MEMO_HEX_LIMIT) {
        const executorUrl = process.env.NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL;
        if (executorUrl) {
          const committed = buildHashCommittedUserOp({ calls, sender: personalAccount, nonce });
          await submitHashCommittedDirectMint({
            memo: committed.memo,
            packedUserOperation: committed.packedUserOperation,
            userOpHash: committed.userOpHash,
            sender: personalAccount,
            nonce,
            destination: coreVaultXrplAddress,
            amountDrops: fullPaymentDrops,
          });
          payments = [{ memo: committed.memo, paymentDrops: fullPaymentDrops, label: 'buy PT' }];
        } else {
          const memoOnlyPaymentDrops = computeDirectMintingPaymentDrops({
            netMintDrops: BigInt(0),
            feeBips,
            minimumFeeDrops,
            executorFeeDrops,
          }).toString();
          payments = calls.map((call, index) => {
            const memo = buildMemoFieldUserOp({ calls: [call], sender: personalAccount, nonce: nonce + BigInt(index) });
            if (memo.length - 2 > XRPL_MEMO_HEX_LIMIT) {
              throw new Error(`${call.label} exceeds XRPL's 1024-byte memo limit by itself. Configure NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL for this operation.`);
            }
            return { memo, paymentDrops: index === 0 ? fullPaymentDrops : memoOnlyPaymentDrops, label: call.label };
          });
          setStatus(`Inline memo is too large, so this buy needs ${payments.length} signatures instead of one.`);
        }
      }

      if (dcentAccount) {
        await signSplitBuyWithDcent(payments, coreVaultXrplAddress, dcentAccount);
        return;
      }
      if (bifrostAccount && bifrostTopic) {
        await signSplitBuyWithBifrost(payments, coreVaultXrplAddress, bifrostAccount, bifrostTopic);
        return;
      }
      if (payments.length > 1) {
        await signSplitBuyWithXaman(payments, coreVaultXrplAddress);
        return;
      }
      const payload = await createXamanPayload(coreVaultXrplAddress, payments[0].paymentDrops, payments[0].memo);
      setXamanPayload(payload);
      setXamanStatus(null);
      setXamanSequence(null);
      setStatus(
        buyInputAsset === 'xrp'
          ? `Open Xaman to mint ${formatUnits(quoteFxrpIn, 6)} FXRP, stake to stXRP, and buy PT.`
          : `Open Xaman to stake ${formatUnits(quoteFxrpIn, 6)} FXRP to stXRP and buy PT.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to prepare PT buy.');
    } finally {
      setBusy(false);
    }
  }

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

  useEffect(() => {
    if (!xamanPayload || xamanStatus?.resolved) return undefined;
    const interval = setInterval(async () => {
      try {
        const result = await getXamanPayloadStatus(xamanPayload.uuid);
        setXamanStatus(result);
        if (!result.resolved) return;
        if (result.signed) {
          if (xamanSequence && xamanSequence.currentIndex + 1 < xamanSequence.payments.length) {
            const nextIndex = xamanSequence.currentIndex + 1;
            await createSpectraXamanPayload(xamanSequence.payments, xamanSequence.destination, nextIndex);
          } else {
            setStatus(result.txid ? `Xaman signed (${result.txid}). Waiting for Smart Account execution.` : 'Xaman signed, but no XRPL tx hash was returned.');
            setXamanSequence(null);
          }
        } else if (result.cancelled) {
          setStatus('Xaman request was cancelled.');
          setXamanSequence(null);
        } else if (result.expired) {
          setStatus('Xaman request expired. Try again.');
          setXamanSequence(null);
        }
      } catch {
        // transient polling error, retry on next tick
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [xamanPayload, xamanStatus?.resolved, xamanSequence]);

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
  const tradeBlocked = busy || !quote || exceedsImpact || exceedsUsage || !poolState?.coinsVerified || side !== 'buy';
  const connectedWallet = dcentAccount ? "D'CENT" : bifrostAccount ? 'Bifrost' : xamanAccount ? 'Xaman' : '';
  const maxSafeLabel = activeSuggestion
    ? formatAmount(activeSuggestion.amountIn, market.decimals, side === 'buy' ? 'stXRP after conversion' : 'PT')
    : '-';

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
          <span>{tokenLabel(side, buyInputAsset)}</span>
        </label>
        {side === 'buy' ? (
          <div className="trade-side-tabs input-token-tabs" role="tablist" aria-label="Buy input asset">
            <button type="button" className={buyInputAsset === 'xrp' ? 'active' : ''} onClick={() => setBuyInputAsset('xrp')}>XRP</button>
            <button type="button" className={buyInputAsset === 'fxrp' ? 'active' : ''} onClick={() => setBuyInputAsset('fxrp')}>FXRP</button>
          </div>
        ) : null}
        <button
          type="button"
          className="spectra-action-button"
          disabled={tradeBlocked || (!dcentAccount && !bifrostAccount && !xamanAccount)}
          onClick={buyPtWithXaman}
        >
          {side === 'sell' ? 'Sell later' : connectedWallet ? 'Buy PT' : 'Connect wallet'}
        </button>
      </div>

      {!connectedWallet && side === 'buy' ? (
        <div className="wallet-actions spectra-wallet-actions">
          <button type="button" onClick={connectDcent} disabled={dcentConnecting || bifrostConnecting || xamanConnecting}>{dcentConnecting ? 'Waiting...' : "D'CENT"}</button>
          <button type="button" className="ghost-button" onClick={connectBifrost} disabled={dcentConnecting || bifrostConnecting || xamanConnecting}>{bifrostConnecting ? 'Waiting...' : 'Bifrost'}</button>
          <button type="button" className="ghost-button" onClick={connectXaman} disabled={dcentConnecting || bifrostConnecting || xamanConnecting}>{xamanConnecting ? 'Waiting...' : 'Xaman'}</button>
        </div>
      ) : null}

      <div className="spectra-capacity-line">
        <span>Max safe {side}: {maxSafeLabel}</span>
        <span>{side === 'buy' ? `${buyInputAsset.toUpperCase()} converts to stXRP before PT purchase.` : 'Sell returns stXRP.'}</span>
        <span>This is a liquidity limit, not a default trade size.</span>
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
      {dcentError ? <p className="status-line warning">{dcentError}</p> : null}
      {bifrostError ? <p className="status-line warning">{bifrostError}</p> : null}
      {xamanError ? <p className="status-line warning">{xamanError}</p> : null}
      {status ? <p className="status-line">{status}</p> : null}
      {connectedWallet ? <p className="status-line">{connectedWallet} connected: {dcentAccount ?? bifrostAccount ?? xamanAccount}</p> : null}
      {xamanPayload ? (
        <div className="sign-box spectra-sign-box">
          <div>
            <h3>Sign in Xaman</h3>
            <p>
              {xamanSequence
                ? `Payment ${xamanSequence.currentIndex + 1} of ${xamanSequence.payments.length}: ${xamanSequence.payments[xamanSequence.currentIndex].label}.`
                : buyInputAsset === 'xrp'
                  ? 'Approve the XRP payment. The memo instructs the Smart Account to mint FXRP, stake stXRP, and buy PT.'
                  : 'Approve the XRPL instruction payment. The memo instructs the Smart Account to stake FXRP and buy PT.'}
            </p>
            {xamanPayload.deeplink ? <a href={xamanPayload.deeplink} target="_blank" rel="noreferrer" className="primary-link">Open in Xaman</a> : null}
          </div>
          {xamanPayload.qrPng ? <img src={xamanPayload.qrPng} alt="Xaman sign QR code" width={132} height={132} /> : null}
        </div>
      ) : null}
    </section>
  );
}

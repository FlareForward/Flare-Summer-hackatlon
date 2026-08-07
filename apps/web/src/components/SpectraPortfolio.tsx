'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPublicClient, formatUnits, http, isAddress, zeroAddress, type Address, type Hex } from 'viem';
import { erc20Abi, masterAccountControllerAbi } from '@/config/abis';
import { flare } from '@/config/wagmi';
import { FXRP_ADDRESS, MASTER_ACCOUNT_CONTROLLER } from '@/config/vaults';
import { readXrplWalletState } from '@/lib/xrplWalletState';
import type { SpectraMarket } from '@/lib/spectra/markets';
import {
  readSpectraExecution,
  SPECTRA_EXECUTION_EVENT,
  updateSpectraExecution,
  type SpectraExecutionState,
} from '@/lib/spectra/executionState';

type Position = { market: SpectraMarket; balance: bigint };

type Props = {
  markets: SpectraMarket[];
  onSell: (market: SpectraMarket, balance: bigint) => void;
};

function connectedXrplAccount() {
  return readXrplWalletState('dcent').account
    ?? readXrplWalletState('bifrost').account
    ?? readXrplWalletState('xaman').account;
}

function compactAddress(value?: string) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : '-';
}

function formatToken(value: bigint, decimals: number, maximumFractionDigits = 4) {
  const numeric = Number(formatUnits(value, decimals));
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(numeric);
}

function maturityLabel(maturityTs: number) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(maturityTs * 1000));
}

function stageLabel(execution: SpectraExecutionState) {
  if (execution.stage === 'complete') return 'Complete on Flare';
  if (execution.stage === 'flare_submitted') return 'Submitted on Flare';
  if (execution.stage === 'xrpl_submitted') return 'XRPL confirmed · waiting for Flare';
  if (execution.stage === 'awaiting_signature') return 'Waiting for wallet signature';
  if (execution.stage === 'error') return 'Needs attention';
  return 'Preparing';
}

export function SpectraPortfolio({ markets, onSell }: Props) {
  const [xrplAccount, setXrplAccount] = useState<string | undefined>();
  const [personalAccount, setPersonalAccount] = useState<Address>();
  const [positions, setPositions] = useState<Position[]>([]);
  const [fxrpBalance, setFxrpBalance] = useState<bigint>(BigInt(0));
  const [stXrpBalance, setStXrpBalance] = useState<bigint>(BigInt(0));
  const [execution, setExecution] = useState<SpectraExecutionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const publicClient = useMemo(() => createPublicClient({
    chain: flare,
    transport: http(process.env.NEXT_PUBLIC_FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc'),
  }), []);

  const refresh = useCallback(async () => {
    const account = connectedXrplAccount();
    setXrplAccount(account);
    setExecution(readSpectraExecution());
    if (!account || markets.length === 0) {
      setPersonalAccount(undefined);
      setPositions([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resolved = await publicClient.readContract({
        address: MASTER_ACCOUNT_CONTROLLER,
        abi: masterAccountControllerAbi,
        functionName: 'getPersonalAccount',
        args: [account],
      });
      if (!isAddress(resolved) || resolved.toLowerCase() === zeroAddress) {
        setPersonalAccount(undefined);
        setPositions([]);
        setError('This XRPL wallet does not have a Flare PersonalAccount yet.');
        return;
      }
      setPersonalAccount(resolved);
      const uniqueIbts = [...new Set(markets.map((market) => market.ibt.toLowerCase()))];
      const [nextFxrp, nextStXrp, ...ptBalances] = await Promise.all([
        publicClient.readContract({ address: FXRP_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [resolved] }).catch(() => BigInt(0)),
        uniqueIbts.length > 0
          ? publicClient.readContract({ address: markets[0].ibt, abi: erc20Abi, functionName: 'balanceOf', args: [resolved] }).catch(() => BigInt(0))
          : Promise.resolve(BigInt(0)),
        ...markets.map((market) => publicClient.readContract({ address: market.pt, abi: erc20Abi, functionName: 'balanceOf', args: [resolved] }).catch(() => BigInt(0))),
      ]);
      setFxrpBalance(nextFxrp);
      setStXrpBalance(nextStXrp);
      setPositions(markets.map((market, index) => ({ market, balance: ptBalances[index] })).filter((position) => position.balance > BigInt(0)));

      const pending = readSpectraExecution();
      if (pending?.personalAccount?.toLowerCase() === resolved.toLowerCase() && pending.expectedNonce && !['complete', 'error'].includes(pending.stage)) {
        if (pending.flareTxHash) {
          const receipt = await publicClient.getTransactionReceipt({ hash: pending.flareTxHash }).catch(() => null);
          if (receipt?.status === 'reverted') {
            updateSpectraExecution({ stage: 'error', message: 'The Flare transaction reverted. No portfolio change was recorded.' });
            setExecution(readSpectraExecution());
            return;
          }
          if (receipt?.status === 'success') {
            updateSpectraExecution({ stage: 'complete', message: `${pending.action === 'buy' ? 'PT purchase' : 'PT sale'} confirmed on Flare.` });
            setExecution(readSpectraExecution());
            return;
          }
        }
        const currentNonce = await publicClient.readContract({
          address: MASTER_ACCOUNT_CONTROLLER,
          abi: masterAccountControllerAbi,
          functionName: 'getNonce',
          args: [resolved],
        });
        if (currentNonce > BigInt(pending.expectedNonce)) {
          updateSpectraExecution({ stage: 'complete', message: `${pending.action === 'buy' ? 'PT purchase' : 'PT sale'} completed on Flare.` });
          setExecution(readSpectraExecution());
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the Spectra portfolio.');
    } finally {
      setLoading(false);
    }
  }, [markets, publicClient]);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener('flare:xrpl-wallet', onChange);
    window.addEventListener(SPECTRA_EXECUTION_EVENT, onChange);
    const interval = window.setInterval(() => void refresh(), 12_000);
    return () => {
      window.removeEventListener('flare:xrpl-wallet', onChange);
      window.removeEventListener(SPECTRA_EXECUTION_EVENT, onChange);
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    const userOpHash = execution?.userOpHash;
    const executorUrl = process.env.NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL;
    if (!userOpHash || !executorUrl || ['complete', 'error', 'flare_submitted'].includes(execution.stage)) return;
    const poll = async () => {
      try {
        const response = await fetch(`${executorUrl}/status?userOpHash=${encodeURIComponent(userOpHash)}`, { cache: 'no-store' });
        const result = await response.json().catch(() => null) as { state?: string; txHash?: Hex; error?: { message?: string } } | null;
        if (!response.ok || !result) return;
        if (result.state === 'submitted' && result.txHash) {
          updateSpectraExecution({ stage: 'flare_submitted', flareTxHash: result.txHash, message: 'Flare transaction submitted. Confirming balances…' });
        } else if (result.state === 'error') {
          updateSpectraExecution({ stage: 'error', message: result.error?.message || 'The Flare executor failed this operation.' });
        }
      } catch {
        // A transient executor status failure should not hide or fail an otherwise pending operation.
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 5_000);
    return () => window.clearInterval(interval);
  }, [execution?.stage, execution?.userOpHash]);

  const estimatedValue = positions.reduce((total, position) => total + Number(formatUnits(position.balance, position.market.decimals)) * position.market.ptPriceUnderlying, 0);

  return (
    <section className="strategy-panel panel spectra-portfolio-panel">
      <div className="section-heading spectra-portfolio-heading">
        <div><p className="eyebrow">Your portfolio</p><h2>Spectra positions</h2></div>
        <button type="button" className="ghost-button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {!xrplAccount ? <p className="status-line">Connect an XRPL wallet below to load its Flare PersonalAccount and PT positions.</p> : null}
      {personalAccount ? (
        <div className="spectra-account-line">
          <span>XRPL <strong>{compactAddress(xrplAccount)}</strong></span>
          <span>Flare PersonalAccount <strong>{compactAddress(personalAccount)}</strong></span>
        </div>
      ) : null}
      {error ? <p className="status-line warning">{error}</p> : null}

      {personalAccount ? (
        <div className="spectra-portfolio-summary">
          <div><span>PT positions</span><strong>{positions.length}</strong></div>
          <div><span>Estimated value</span><strong>{estimatedValue.toFixed(4)} FXRP</strong></div>
          <div><span>Available FXRP</span><strong>{formatToken(fxrpBalance, 6)} FXRP</strong></div>
          <div><span>Available stXRP</span><strong>{formatToken(stXrpBalance, markets[0]?.decimals ?? 18)} stXRP</strong></div>
        </div>
      ) : null}

      {execution ? (
        <div className={`spectra-execution-card ${execution.stage}`}>
          <div>
            <span>Latest Spectra action</span>
            <strong>{execution.action === 'buy' ? 'Buy' : 'Sell'} · {execution.marketSymbol}</strong>
            <p>{execution.message}</p>
          </div>
          <div className="spectra-execution-state">
            <strong>{stageLabel(execution)}</strong>
            {execution.xrplTxHash ? <a href={`https://livenet.xrpl.org/transactions/${execution.xrplTxHash}`} target="_blank" rel="noreferrer">XRPL transaction</a> : null}
            {execution.flareTxHash ? <a href={`https://flare-explorer.flare.network/tx/${execution.flareTxHash}`} target="_blank" rel="noreferrer">Flare transaction</a> : null}
          </div>
        </div>
      ) : null}

      {personalAccount && positions.length === 0 && !loading ? <div className="spectra-empty"><strong>No PT positions found</strong><p>PT bought by this PersonalAccount will appear here after the Flare transaction confirms.</p></div> : null}
      {positions.length > 0 ? (
        <div className="spectra-position-list">
          {positions.map(({ market, balance }) => (
            <article className="spectra-position-card" key={market.pt}>
              <div><span>Principal Token</span><strong>{market.symbol}</strong><p>Matures {maturityLabel(market.maturityTs)}</p></div>
              <div><span>Balance</span><strong>{formatToken(balance, market.decimals)} PT</strong><p>≈ {(Number(formatUnits(balance, market.decimals)) * market.ptPriceUnderlying).toFixed(4)} FXRP</p></div>
              <button type="button" onClick={() => onSell(market, balance)}>Sell</button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

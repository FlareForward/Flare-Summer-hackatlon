'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, http, isAddress, type Address, type Hex } from 'viem';
import { flare } from '@/config/wagmi';
import { algebraPoolAbi, erc20Abi, masterAccountControllerAbi } from '@/config/abis';
import {
  FXRP_ADDRESS,
  FXRP_USDT0_POOL,
  MASTER_ACCOUNT_CONTROLLER,
  USDT0_ADDRESS,
  type VaultConfig,
} from '@/config/vaults';
import {
  buildClaimSurplusCalls,
  buildCustomInstructionReference,
  buildDepositCalls,
  buildSwapUsdt0ToFxrpCalls,
  buildWithdrawCalls,
  buildXamanPaymentTemplate,
  toCustomCalls,
  type FsaCall,
} from '@/lib/fsa';
import { createXamanPayload, getXamanPayloadStatus, type XamanPayload, type XamanPayloadStatus } from '@/lib/xaman';
import { useXamanConnect } from '@/lib/xamanConnect';
import { formatToken, isZeroAddress, shortAddress } from '@/lib/format';

type Props = {
  vault: VaultConfig;
};

const EXECUTION_POLL_LIMIT = 60;
const DEFAULT_FEE_DROPS = '12';

export function SmartAccountPanel({ vault }: Props) {
  const [xrplAddress, setXrplAddress] = useState('');
  const [amount, setAmount] = useState('0.01');
  const [withdrawShares, setWithdrawShares] = useState('0.01');
  const [personalAccount, setPersonalAccount] = useState<Address | undefined>();
  const [operatorAddress, setOperatorAddress] = useState('');
  const [fxrpBalance, setFxrpBalance] = useState<bigint | undefined>();
  const [shareBalance, setShareBalance] = useState<bigint | undefined>();
  const [usdt0Balance, setUsdt0Balance] = useState<bigint | undefined>();
  const [calls, setCalls] = useState<FsaCall[]>([]);
  const [callHash, setCallHash] = useState<Hex | undefined>();
  const [paymentReference, setPaymentReference] = useState<Hex | undefined>();
  const [xamanPayload, setXamanPayload] = useState<XamanPayload | undefined>();
  const [xamanStatus, setXamanStatus] = useState<XamanPayloadStatus | undefined>();
  const [baseline, setBaseline] = useState<{ fxrp?: bigint; shares?: bigint; usdt0?: bigint } | undefined>();
  const [executing, setExecuting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const executionAttempts = useRef(0);
  const { account: xamanAccount, connecting: xamanConnecting, error: xamanConnectError, connect: connectXaman, disconnect: disconnectXaman } = useXamanConnect();

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: flare,
        transport: http(process.env.NEXT_PUBLIC_FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc'),
      }),
    [],
  );

  async function refreshBalances(account = personalAccount) {
    if (!account || !isAddress(account)) return;
    try {
      const [fxrp, shares, usdt0] = await Promise.all([
        publicClient.readContract({
          address: FXRP_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        }),
        publicClient.readContract({
          address: vault.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        }),
        publicClient.readContract({
          address: USDT0_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        }),
      ]);
      setFxrpBalance(fxrp);
      setShareBalance(shares);
      setUsdt0Balance(usdt0);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to read balances.');
    }
  }

  async function createPayment(reference: Hex, operator: string) {
    setStatus('Creating Xaman request...');
    try {
      const payload = await createXamanPayload(operator, DEFAULT_FEE_DROPS, reference);
      setXamanPayload(payload);
      setXamanStatus(undefined);
      setExecuting(false);
      setStatus('Open Xaman and sign the payment to submit your vault instruction.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create Xaman payment.');
    } finally {
      setBusy(false);
    }
  }

  async function prepareInstruction(
    buildCalls: (account: Address) => FsaCall[],
  ): Promise<{ account: Address; operator: string; calls: FsaCall[]; reference: Hex } | null> {
    if (!vault.entryEnabled) {
      setStatus(vault.readinessNote || 'This vault is not accepting Smart Account instructions yet.');
      return null;
    }
    if (!xrplAddress) {
      setStatus('Connect Xaman or paste your XRPL address first.');
      return null;
    }
    setXamanPayload(undefined);
    setXamanStatus(undefined);
    setStatus('Finding your Flare Smart Account...');

    let account = personalAccount;
    let operator = operatorAddress;
    try {
      if (!account || !isAddress(account)) {
        account = await publicClient.readContract({
          address: MASTER_ACCOUNT_CONTROLLER,
          abi: masterAccountControllerAbi,
          functionName: 'getPersonalAccount',
          args: [xrplAddress],
        });
        const operators = await publicClient.readContract({
          address: MASTER_ACCOUNT_CONTROLLER,
          abi: masterAccountControllerAbi,
          functionName: 'getXrplProviderWallets',
          args: [],
        });
        operator = operators[0] || '';
        setPersonalAccount(account);
        setOperatorAddress(operator);
      }
      await refreshBalances(account);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to resolve smart account.');
      return null;
    }

    if (!account || isZeroAddress(account)) {
      setStatus('No Flare Smart Account was found for that XRPL address.');
      return null;
    }
    if (!operator) {
      setStatus('No operator XRPL address found on MasterAccountController.');
      return null;
    }

    setStatus('Preparing your vault instruction...');
    const nextCalls = buildCalls(account);
    setCalls(nextCalls);

    try {
      const hash = await publicClient.readContract({
        address: MASTER_ACCOUNT_CONTROLLER,
        abi: masterAccountControllerAbi,
        functionName: 'encodeCustomInstruction',
        args: [toCustomCalls(nextCalls)],
      });
      const reference = buildCustomInstructionReference(0, hash);
      setCallHash(hash);
      setPaymentReference(reference);
      return { account, operator, calls: nextCalls, reference };
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to encode instruction hash.');
      return null;
    }
  }

  async function enterVault() {
    setBusy(true);
    const prepared = await prepareInstruction((account) => buildDepositCalls(vault, amount, account));
    if (!prepared) {
      setBusy(false);
      return;
    }
    const { operator, reference } = prepared;
    await createPayment(reference, operator);
  }

  async function withdrawVault() {
    setBusy(true);
    const prepared = await prepareInstruction(() => buildWithdrawCalls(vault, withdrawShares));
    if (!prepared) {
      setBusy(false);
      return;
    }
    const { operator, reference } = prepared;
    await createPayment(reference, operator);
  }

  async function claimSurplus() {
    setBusy(true);
    const prepared = await prepareInstruction(() => buildClaimSurplusCalls(vault));
    if (!prepared) {
      setBusy(false);
      return;
    }
    const { operator, reference } = prepared;
    await createPayment(reference, operator);
  }

  async function swapUsdt0ToFxrp() {
    if (!personalAccount || !usdt0Balance || usdt0Balance === BigInt(0)) {
      setStatus('No USDT0 surplus to swap.');
      return;
    }
    setBusy(true);
    setStatus('Reading live pool price...');
    let amountOutMinimum: bigint;
    try {
      const [sqrtPriceX96] = await publicClient.readContract({
        address: FXRP_USDT0_POOL,
        abi: algebraPoolAbi,
        functionName: 'globalState',
      });
      const q192 = BigInt(1) << BigInt(192);
      const expectedFxrpOut = (usdt0Balance * q192) / (sqrtPriceX96 * sqrtPriceX96);
      amountOutMinimum = (expectedFxrpOut * BigInt(99)) / BigInt(100);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to read pool price.');
      setBusy(false);
      return;
    }

    const prepared = await prepareInstruction((account) => buildSwapUsdt0ToFxrpCalls(account, usdt0Balance, amountOutMinimum));
    if (!prepared) {
      setBusy(false);
      return;
    }
    const { operator, reference } = prepared;
    await createPayment(reference, operator);
  }

  useEffect(() => {
    if (!xamanAccount) return;
    setXrplAddress(xamanAccount);
    setStatus('Xaman connected. Finding your Smart Account...');
    (async () => {
      try {
        const account = await publicClient.readContract({
          address: MASTER_ACCOUNT_CONTROLLER,
          abi: masterAccountControllerAbi,
          functionName: 'getPersonalAccount',
          args: [xamanAccount],
        });
        const operators = await publicClient.readContract({
          address: MASTER_ACCOUNT_CONTROLLER,
          abi: masterAccountControllerAbi,
          functionName: 'getXrplProviderWallets',
          args: [],
        });
        setPersonalAccount(account);
        setOperatorAddress(operators[0] || '');
        setStatus('Ready. Enter an amount and sign with Xaman.');
        await refreshBalances(account);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Unable to resolve smart account.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xamanAccount]);

  useEffect(() => {
    if (!xamanPayload || xamanStatus?.resolved) return undefined;
    const interval = setInterval(async () => {
      try {
        const result = await getXamanPayloadStatus(xamanPayload.uuid);
        setXamanStatus(result);
        if (result.resolved) {
          if (result.signed) {
            setStatus(`Signed in Xaman${result.txid ? ` (${shortAddress(result.txid)})` : ''}. Waiting for execution on Flare...`);
            setBaseline({ fxrp: fxrpBalance, shares: shareBalance, usdt0: usdt0Balance });
            executionAttempts.current = 0;
            setExecuting(true);
          } else if (result.cancelled) {
            setStatus('Xaman request was cancelled.');
          } else if (result.expired) {
            setStatus('Xaman request expired. Try again.');
          }
        }
      } catch {
        // transient polling error, retry on next tick
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [xamanPayload, xamanStatus?.resolved, fxrpBalance, shareBalance, usdt0Balance]);

  useEffect(() => {
    if (!executing || !personalAccount) return undefined;
    const interval = setInterval(async () => {
      executionAttempts.current += 1;
      await refreshBalances(personalAccount);
      if (executionAttempts.current >= EXECUTION_POLL_LIMIT) {
        clearInterval(interval);
        setExecuting(false);
        setStatus('Still waiting on the operator. Check balances again in a few minutes.');
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executing, personalAccount]);

  useEffect(() => {
    if (!executing || !baseline) return;
    const changed =
      (baseline.fxrp !== undefined && fxrpBalance !== undefined && fxrpBalance !== baseline.fxrp) ||
      (baseline.shares !== undefined && shareBalance !== undefined && shareBalance !== baseline.shares) ||
      (baseline.usdt0 !== undefined && usdt0Balance !== undefined && usdt0Balance !== baseline.usdt0);
    if (changed) {
      setExecuting(false);
      setStatus('Done. Your balances updated on Flare.');
    }
  }, [executing, baseline, fxrpBalance, shareBalance, usdt0Balance]);

  const xamanTemplate =
    paymentReference && operatorAddress ? buildXamanPaymentTemplate(operatorAddress, paymentReference, DEFAULT_FEE_DROPS) : undefined;

  return (
    <section className="panel action-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Step 2</p>
          <h2>Enter with Xaman</h2>
        </div>
        <span className="selected-chip" style={{ borderColor: vault.accent, color: vault.accent }}>
          {vault.name}
        </span>
      </div>

      <div className="selected-summary">
        <div>
          <span>Estimated APR</span>
          <strong>{vault.opportunityApr}</strong>
        </div>
        <p>{vault.bestFor}</p>
      </div>

      <div className="step-list">
        <div className={xamanAccount ? 'flow-step done' : 'flow-step'}>
          <span>1</span>
          <div>
            <strong>Connect Xaman</strong>
            <p>{xamanAccount ? shortAddress(xamanAccount) : 'Use your XRPL wallet. No FLR wallet needed.'}</p>
          </div>
          {xamanAccount ? (
            <button type="button" className="ghost-button" onClick={disconnectXaman}>Disconnect</button>
          ) : (
            <button type="button" onClick={connectXaman} disabled={xamanConnecting}>
              {xamanConnecting ? 'Waiting...' : 'Connect'}
            </button>
          )}
        </div>

        <div className="flow-step">
          <span>2</span>
          <div>
            <strong>Choose amount</strong>
            <p>Deposit FXRP into the selected managed vault.</p>
          </div>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label="Deposit amount" />
        </div>

        <div className="flow-step">
          <span>3</span>
          <div>
            <strong>Sign once</strong>
            <p>Xaman signs the payment memo that tells the operator what to execute.</p>
          </div>
          <button type="button" onClick={enterVault} disabled={busy || !vault.entryEnabled}>
            {busy ? 'Preparing...' : vault.entryEnabled ? 'Enter vault' : 'Waiting for vault'}
          </button>
        </div>
      </div>

      {!xamanAccount ? (
        <label className="manual-address">
          Paste XRPL address instead
          <input
            value={xrplAddress}
            onChange={(event) => setXrplAddress(event.target.value)}
            placeholder="r..."
          />
        </label>
      ) : null}

      {xamanConnectError ? <p className="status-line warning">{xamanConnectError}</p> : null}
      {status ? <p className="status-line">{status}</p> : null}

      {xamanPayload ? (
        <div className="sign-box">
          <div>
            <h3>Sign in Xaman</h3>
            <p>
              {xamanStatus?.signed
                ? `Signed. XRPL tx: ${xamanStatus.txid ?? 'pending'}`
                : xamanStatus?.cancelled
                  ? 'Cancelled in Xaman.'
                  : xamanStatus?.expired
                    ? 'Expired.'
                    : 'Waiting for signature...'}
            </p>
            {xamanPayload.deeplink ? (
              <a href={xamanPayload.deeplink} target="_blank" rel="noreferrer" className="primary-link">
                Open in Xaman
              </a>
            ) : null}
          </div>
          {xamanPayload.qrPng ? <img src={xamanPayload.qrPng} alt="Xaman sign QR code" width={156} height={156} /> : null}
        </div>
      ) : null}

      <div className="account-strip">
        <div>
          <span>Smart Account</span>
          <strong>{shortAddress(personalAccount)}</strong>
        </div>
        <div>
          <span>FXRP</span>
          <strong>{formatToken(fxrpBalance, 6, 'FXRP')}</strong>
        </div>
        <div>
          <span>Vault shares</span>
          <strong>{formatToken(shareBalance, vault.shareDecimals)}</strong>
        </div>
      </div>

      <details className="advanced-box">
        <summary>Advanced actions and technical details</summary>
        <div className="advanced-content">
          <div className="manage-grid">
            <label>
              Withdraw amount ({vault.token})
              <input value={withdrawShares} onChange={(event) => setWithdrawShares(event.target.value)} inputMode="decimal" />
            </label>
            <button type="button" onClick={() => refreshBalances()}>Refresh balances</button>
            <button type="button" onClick={withdrawVault} disabled={busy || !vault.entryEnabled}>{busy ? 'Preparing...' : 'Withdraw'}</button>
            <button type="button" onClick={claimSurplus} disabled={busy || !vault.entryEnabled}>{busy ? 'Preparing...' : 'Claim surplus'}</button>
            <button type="button" onClick={swapUsdt0ToFxrp} disabled={busy || !vault.entryEnabled || !usdt0Balance}>{busy ? 'Preparing...' : 'Swap surplus to FXRP'}</button>
          </div>

          <div className="account-strip">
            <div>
              <span>USDT0 surplus</span>
              <strong>{formatToken(usdt0Balance, 6, 'USDT0')}</strong>
            </div>
            <div>
              <span>Operator</span>
              <strong>{operatorAddress || '-'}</strong>
            </div>
          </div>

          {calls.length > 0 ? (
            <div className="call-plan">
              <h3>Generated calls</h3>
              {calls.map((call) => (
                <div className="call-row" key={`${call.label}-${call.target}`}>
                  <span>{call.label}</span>
                  <code>{shortAddress(call.target)}</code>
                </div>
              ))}
              {callHash ? <div className="call-row"><span>Call hash</span><code>{shortAddress(callHash)}</code></div> : null}
              {paymentReference ? <div className="call-row"><span>Memo reference</span><code>{shortAddress(paymentReference)}</code></div> : null}
            </div>
          ) : null}

          {xamanTemplate ? <pre>{JSON.stringify(xamanTemplate, null, 2)}</pre> : null}
        </div>
      </details>
    </section>
  );
}

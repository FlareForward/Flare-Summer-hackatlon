'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, formatUnits, http, isAddress, parseUnits, type Address, type Hex } from 'viem';
import { flare } from '@/config/wagmi';
import { algebraPoolAbi, assetManagerAbi, erc20Abi, masterAccountControllerAbi } from '@/config/abis';
import {
  ASSET_MANAGER_FXRP,
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
  buildMemoFieldUserOp,
  buildSwapUsdt0ToFxrpCalls,
  buildWithdrawCalls,
  buildXamanPaymentTemplate,
  computeDirectMintingPaymentDrops,
  toCustomCalls,
  type FsaCall,
} from '@/lib/fsa';
import { signDcentInstructionPayment, useDcentXrplConnect } from '@/lib/dcent';
import { createXamanPayload, getXamanPayloadStatus, type XamanPayload, type XamanPayloadStatus } from '@/lib/xaman';
import { useXamanConnect } from '@/lib/xamanConnect';
import { formatToken, isZeroAddress, shortAddress } from '@/lib/format';
import { useCarryVaultApr } from '@/lib/useCarryVaultApr';

type Props = {
  vault: VaultConfig;
};

const EXECUTION_POLL_LIMIT = 60;
const DEFAULT_FEE_DROPS = '12';
const XRPL_MEMO_HEX_LIMIT = 2048;

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
  const [directMintPaymentDrops, setDirectMintPaymentDrops] = useState<string | undefined>();
  const [directMintDestination, setDirectMintDestination] = useState('');
  const [xamanPayload, setXamanPayload] = useState<XamanPayload | undefined>();
  const [xamanStatus, setXamanStatus] = useState<XamanPayloadStatus | undefined>();
  const [baseline, setBaseline] = useState<{ fxrp?: bigint; shares?: bigint; usdt0?: bigint } | undefined>();
  const [executing, setExecuting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const executionAttempts = useRef(0);
  const { account: xamanAccount, connecting: xamanConnecting, error: xamanConnectError, connect: connectXaman, disconnect: disconnectXaman } = useXamanConnect();
  const { account: dcentAccount, connecting: dcentConnecting, error: dcentError, connect: connectDcent, disconnect: disconnectDcent } = useDcentXrplConnect();

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: flare,
        transport: http(process.env.NEXT_PUBLIC_FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc'),
      }),
    [],
  );

  // Same live-APR read as the vault cards; only the FXRP Carry Vault has this on chain today.
  const liveApr = useCarryVaultApr(vault.address, vault.kind === 'carry' && vault.status === 'live' && !isZeroAddress(vault.address));
  const estimatedAprDisplay = liveApr.netAprPct != null ? `${liveApr.netAprPct.toFixed(2)}%` : vault.opportunityApr;

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

  async function createXamanPayment(reference: Hex, operator: string) {
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

  async function signWithDcent(reference: Hex, operator: string, account: string) {
    setStatus('Confirm the XRPL Payment in D\'CENT to submit your vault instruction.');
    try {
      const result = await signDcentInstructionPayment({
        account,
        destination: operator,
        amountDrops: DEFAULT_FEE_DROPS,
        memoHex: reference,
      });
      setBaseline({ fxrp: fxrpBalance, shares: shareBalance, usdt0: usdt0Balance });
      executionAttempts.current = 0;
      setExecuting(true);
      setStatus(`Signed in D'CENT${result.txid ? ` (${shortAddress(result.txid)})` : ''}. Waiting for execution on Flare...`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'D\'CENT signing failed.');
    } finally {
      setBusy(false);
    }
  }

  async function createDirectMintXamanPayment(memo: Hex, destination: string, amountDrops: string) {
    setStatus('Creating Xaman direct-mint request...');
    try {
      const payload = await createXamanPayload(destination, amountDrops, memo);
      setXamanPayload(payload);
      setXamanStatus(undefined);
      setExecuting(false);
      setStatus('Open Xaman and sign the direct-mint payment to mint FXRP and enter the vault.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create Xaman direct-mint payment.');
    } finally {
      setBusy(false);
    }
  }

  async function signDirectMintWithDcent(memo: Hex, destination: string, amountDrops: string, account: string) {
    setStatus('Confirm the XRPL direct-mint Payment in D\'CENT.');
    try {
      const result = await signDcentInstructionPayment({
        account,
        destination,
        amountDrops,
        memoHex: memo,
      });
      setBaseline({ fxrp: fxrpBalance, shares: shareBalance, usdt0: usdt0Balance });
      executionAttempts.current = 0;
      setExecuting(true);
      setStatus(`Signed direct mint in D'CENT${result.txid ? ` (${shortAddress(result.txid)})` : ''}. Waiting for the executor on Flare...`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'D\'CENT direct-mint signing failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPreparedInstruction(reference: Hex, operator: string) {
    if (dcentAccount) {
      await signWithDcent(reference, operator, dcentAccount);
      return;
    }
    await createXamanPayment(reference, operator);
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
    setXamanPayload(undefined);
    setXamanStatus(undefined);
    setCallHash(undefined);
    setPaymentReference(undefined);
    setDirectMintPaymentDrops(undefined);
    setDirectMintDestination('');

    const prepared = await prepareDirectMintEntry();
    if (!prepared) {
      setBusy(false);
      return;
    }

    const { memo, coreVaultXrplAddress, paymentDrops } = prepared;
    if (dcentAccount) {
      await signDirectMintWithDcent(memo, coreVaultXrplAddress, paymentDrops, dcentAccount);
      return;
    }
    await createDirectMintXamanPayment(memo, coreVaultXrplAddress, paymentDrops);
  }

  async function prepareDirectMintEntry(): Promise<{ memo: Hex; coreVaultXrplAddress: string; paymentDrops: string } | null> {
    if (!vault.entryEnabled) {
      setStatus(vault.readinessNote || 'This vault is not accepting Smart Account instructions yet.');
      return null;
    }
    if (!xrplAddress) {
      setStatus('Connect D\'CENT or Xaman first.');
      return null;
    }

    let netMintDrops: bigint;
    try {
      netMintDrops = parseUnits(amount || '0', vault.assetDecimals);
    } catch {
      setStatus('Enter a valid XRP amount.');
      return null;
    }
    if (netMintDrops <= BigInt(0)) {
      setStatus('Enter an XRP amount greater than zero.');
      return null;
    }

    setStatus('Resolving Smart Account, nonce, and direct-mint fees...');
    try {
      const account =
        personalAccount && isAddress(personalAccount)
          ? personalAccount
          : await publicClient.readContract({
              address: MASTER_ACCOUNT_CONTROLLER,
              abi: masterAccountControllerAbi,
              functionName: 'getPersonalAccount',
              args: [xrplAddress],
            });
      setPersonalAccount(account);
      await refreshBalances(account);

      const [nonce, coreVaultXrplAddress, executorFeeDrops, feeBips, minimumFeeDrops] = await Promise.all([
        publicClient.readContract({
          address: MASTER_ACCOUNT_CONTROLLER,
          abi: masterAccountControllerAbi,
          functionName: 'getNonce',
          args: [account],
        }),
        publicClient.readContract({
          address: ASSET_MANAGER_FXRP,
          abi: assetManagerAbi,
          functionName: 'directMintingPaymentAddress',
          args: [],
        }),
        publicClient.readContract({
          address: ASSET_MANAGER_FXRP,
          abi: assetManagerAbi,
          functionName: 'getDirectMintingExecutorFeeUBA',
          args: [],
        }),
        publicClient.readContract({
          address: ASSET_MANAGER_FXRP,
          abi: assetManagerAbi,
          functionName: 'getDirectMintingFeeBIPS',
          args: [],
        }),
        publicClient.readContract({
          address: ASSET_MANAGER_FXRP,
          abi: assetManagerAbi,
          functionName: 'getDirectMintingMinimumFeeUBA',
          args: [],
        }),
      ]);

      const nextCalls = buildDepositCalls(vault, amount, account);
      const memo = buildMemoFieldUserOp({
        calls: nextCalls,
        sender: account,
        nonce,
      });
      const memoHexLength = memo.length - 2;
      setCalls(nextCalls);
      setPaymentReference(memo);
      if (memoHexLength > XRPL_MEMO_HEX_LIMIT) {
        setStatus(`The inline UserOp memo is ${memoHexLength / 2} bytes, over XRPL's 1024-byte memo limit. Use the 0xFE hash-commitment executor path for this call batch.`);
        return null;
      }

      const paymentDrops = computeDirectMintingPaymentDrops({
        netMintDrops,
        feeBips,
        minimumFeeDrops,
        executorFeeDrops,
      }).toString();

      setDirectMintPaymentDrops(paymentDrops);
      setDirectMintDestination(coreVaultXrplAddress);
      return { memo, coreVaultXrplAddress, paymentDrops };
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to prepare direct-mint UserOp.');
      return null;
    }
  }

  async function withdrawVault() {
    setBusy(true);
    const prepared = await prepareInstruction(() => buildWithdrawCalls(vault, withdrawShares));
    if (!prepared) {
      setBusy(false);
      return;
    }
    const { operator, reference } = prepared;
    await submitPreparedInstruction(reference, operator);
  }

  async function claimSurplus() {
    setBusy(true);
    const prepared = await prepareInstruction(() => buildClaimSurplusCalls(vault));
    if (!prepared) {
      setBusy(false);
      return;
    }
    const { operator, reference } = prepared;
    await submitPreparedInstruction(reference, operator);
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
    await submitPreparedInstruction(reference, operator);
  }

  async function resolveConnectedAccount(accountAddress: string, walletName: string) {
    setXrplAddress(accountAddress);
    setStatus(`${walletName} connected. Finding your Smart Account...`);
    try {
      const account = await publicClient.readContract({
        address: MASTER_ACCOUNT_CONTROLLER,
        abi: masterAccountControllerAbi,
        functionName: 'getPersonalAccount',
        args: [accountAddress],
      });
      const operators = await publicClient.readContract({
        address: MASTER_ACCOUNT_CONTROLLER,
        abi: masterAccountControllerAbi,
        functionName: 'getXrplProviderWallets',
        args: [],
      });
      setPersonalAccount(account);
      setOperatorAddress(operators[0] || '');
      setStatus(`Ready. Enter an amount and sign with ${walletName}.`);
      await refreshBalances(account);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to resolve smart account.');
    }
  }

  useEffect(() => {
    if (!xamanAccount) return;
    resolveConnectedAccount(xamanAccount, 'Xaman');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xamanAccount]);

  useEffect(() => {
    if (!dcentAccount) return;
    resolveConnectedAccount(dcentAccount, "D'CENT");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dcentAccount]);

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
          <h2>Enter with XRPL wallet</h2>
        </div>
        <span className="selected-chip" style={{ borderColor: vault.accent, color: vault.accent }}>
          {vault.name}
        </span>
      </div>

      <div className="selected-summary">
        <div>
          <span>Estimated APR</span>
          <strong>{estimatedAprDisplay}</strong>
        </div>
        <p>{vault.bestFor}</p>
      </div>

      <div className="step-list">
        <div className={xamanAccount || dcentAccount ? 'flow-step done' : 'flow-step'}>
          <span>1</span>
          <div>
            <strong>Connect wallet</strong>
            <p>{dcentAccount ? `D'CENT ${shortAddress(dcentAccount)}` : xamanAccount ? `Xaman ${shortAddress(xamanAccount)}` : 'Use your XRPL wallet. No FLR wallet needed.'}</p>
          </div>
          {dcentAccount ? (
            <button type="button" className="ghost-button" onClick={disconnectDcent}>Disconnect</button>
          ) : xamanAccount ? (
            <button type="button" className="ghost-button" onClick={disconnectXaman}>Disconnect</button>
          ) : (
            <div className="wallet-actions">
              <button type="button" onClick={connectDcent} disabled={dcentConnecting || xamanConnecting}>
                {dcentConnecting ? 'Waiting...' : "D'CENT"}
              </button>
              <button type="button" className="ghost-button" onClick={connectXaman} disabled={xamanConnecting || dcentConnecting}>
                {xamanConnecting ? 'Waiting...' : 'Xaman'}
              </button>
            </div>
          )}
        </div>

        <div className="flow-step">
          <span>2</span>
          <div>
            <strong>Choose amount</strong>
            <p>XRP entry requires direct minting into the Smart Account, then vault execution.</p>
          </div>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label="Deposit amount" />
        </div>

        <div className="flow-step">
          <span>3</span>
          <div>
            <strong>Sign once</strong>
            <p>Pay XRP to the FXRP Core Vault with a Smart Account UserOp memo.</p>
          </div>
          <button type="button" onClick={enterVault} disabled={busy || !vault.entryEnabled}>
            {busy ? 'Preparing...' : vault.entryEnabled ? 'Mint and enter' : 'Waiting for vault'}
          </button>
        </div>
      </div>

      {!xamanAccount && !dcentAccount ? (
        <label className="manual-address">
          Paste XRPL address instead
          <input
            value={xrplAddress}
            onChange={(event) => setXrplAddress(event.target.value)}
            placeholder="r..."
          />
        </label>
      ) : null}

      {dcentError ? <p className="status-line warning">{dcentError}</p> : null}
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
            <div>
              <span>Core Vault</span>
              <strong>{directMintDestination || '-'}</strong>
            </div>
            <div>
              <span>XRP payment</span>
              <strong>{directMintPaymentDrops ? `${formatUnits(BigInt(directMintPaymentDrops), 6)} XRP` : '-'}</strong>
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

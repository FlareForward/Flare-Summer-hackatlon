'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, http, isAddress, type Address, type Hex } from 'viem';
import { useAccount, useWriteContract } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { flare } from '@/config/wagmi';
import { erc20Abi, masterAccountControllerAbi } from '@/config/abis';
import { FXRP_ADDRESS, MASTER_ACCOUNT_CONTROLLER, type VaultConfig } from '@/config/vaults';
import {
  buildCustomInstructionReference,
  buildDepositCalls,
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
  const [amount, setAmount] = useState('10');
  const [personalAccount, setPersonalAccount] = useState<Address | undefined>();
  const [operatorAddress, setOperatorAddress] = useState('');
  const [fxrpBalance, setFxrpBalance] = useState<bigint | undefined>();
  const [shareBalance, setShareBalance] = useState<bigint | undefined>();
  const [calls, setCalls] = useState<FsaCall[]>([]);
  const [callHash, setCallHash] = useState<Hex | undefined>();
  const [paymentReference, setPaymentReference] = useState<Hex | undefined>();
  const [registerTxHash, setRegisterTxHash] = useState<Hex | undefined>();
  const [xamanPayload, setXamanPayload] = useState<XamanPayload | undefined>();
  const [xamanStatus, setXamanStatus] = useState<XamanPayloadStatus | undefined>();
  const [baselineShareBalance, setBaselineShareBalance] = useState<bigint | undefined>();
  const [executing, setExecuting] = useState(false);
  const [entering, setEntering] = useState(false);
  const [status, setStatus] = useState('');
  const executionAttempts = useRef(0);
  const pendingRegistration = useRef<{ calls: FsaCall[]; reference: Hex } | null>(null);
  const [awaitingWalletConnect, setAwaitingWalletConnect] = useState(false);

  const { address: connectedAddress } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { openConnectModal } = useConnectModal();
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
      const [fxrp, shares] = await Promise.all([
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
      ]);
      setFxrpBalance(fxrp);
      setShareBalance(shares);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to read balances.');
    }
  }

  async function registerAndPay(callsForRegistration: FsaCall[], reference: Hex, operator: string) {
    setStatus('Registering instruction on Flare (small FLR gas fee, one signature)...');
    try {
      const txHash = await writeContractAsync({
        address: MASTER_ACCOUNT_CONTROLLER,
        abi: masterAccountControllerAbi,
        functionName: 'registerCustomInstruction',
        args: [toCustomCalls(callsForRegistration)],
        chainId: flare.id,
      });
      setRegisterTxHash(txHash);
      setStatus('Registration submitted. Waiting for confirmation...');
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Instruction registration failed.');
      setEntering(false);
      return;
    }

    setStatus('Creating Xaman payment...');
    try {
      const payload = await createXamanPayload(operator, DEFAULT_FEE_DROPS, reference);
      setXamanPayload(payload);
      setXamanStatus(undefined);
      setExecuting(false);
      setStatus('Scan the QR code or open in Xaman to sign the payment.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create Xaman payment.');
    } finally {
      setEntering(false);
    }
  }

  async function enterVault() {
    if (!xrplAddress) {
      setStatus('Connect Xaman or enter an XRPL address first.');
      return;
    }
    setEntering(true);
    setXamanPayload(undefined);
    setXamanStatus(undefined);
    setStatus('Resolving smart account...');

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
      setEntering(false);
      return;
    }

    if (!account || isZeroAddress(account)) {
      setStatus('Unable to resolve a PersonalAccount for that XRPL address.');
      setEntering(false);
      return;
    }
    if (!operator) {
      setStatus('No operator XRPL address found on MasterAccountController.');
      setEntering(false);
      return;
    }

    setStatus('Building deposit plan...');
    const nextCalls = buildDepositCalls(vault, amount, account);
    setCalls(nextCalls);

    setStatus('Encoding instruction hash on MasterAccountController...');
    let reference: Hex;
    try {
      const hash = await publicClient.readContract({
        address: MASTER_ACCOUNT_CONTROLLER,
        abi: masterAccountControllerAbi,
        functionName: 'encodeCustomInstruction',
        args: [toCustomCalls(nextCalls)],
      });
      reference = buildCustomInstructionReference(0, hash);
      setCallHash(hash);
      setPaymentReference(reference);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to encode instruction hash.');
      setEntering(false);
      return;
    }

    if (!connectedAddress) {
      pendingRegistration.current = { calls: nextCalls, reference };
      setAwaitingWalletConnect(true);
      setStatus('Connect a Flare wallet to authorize registering this instruction (small FLR gas fee, does not touch your deposit funds)...');
      openConnectModal?.();
      return;
    }

    await registerAndPay(nextCalls, reference, operator);
  }

  useEffect(() => {
    if (!xamanAccount) return;
    setXrplAddress(xamanAccount);
    setStatus('Xaman connected. Resolving smart account...');
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
        setStatus('Smart account resolved. Set an amount and click Enter Vault.');
        await refreshBalances(account);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Unable to resolve smart account.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xamanAccount]);

  useEffect(() => {
    if (awaitingWalletConnect && connectedAddress && pendingRegistration.current) {
      const { calls: c, reference: r } = pendingRegistration.current;
      pendingRegistration.current = null;
      setAwaitingWalletConnect(false);
      registerAndPay(c, r, operatorAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAddress, awaitingWalletConnect]);

  useEffect(() => {
    if (!xamanPayload || xamanStatus?.resolved) return undefined;
    const interval = setInterval(async () => {
      try {
        const result = await getXamanPayloadStatus(xamanPayload.uuid);
        setXamanStatus(result);
        if (result.resolved) {
          if (result.signed) {
            setStatus(
              `Signed on XRPL${result.txid ? ` (${shortAddress(result.txid)})` : ''}. Waiting for the operator to submit proof and execute on Flare...`,
            );
            setBaselineShareBalance(shareBalance);
            executionAttempts.current = 0;
            setExecuting(true);
          } else if (result.cancelled) {
            setStatus('Xaman payload was cancelled.');
          } else if (result.expired) {
            setStatus('Xaman payload expired. Click Enter Vault to try again.');
          }
        }
      } catch {
        // transient polling error, retry on next tick
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [xamanPayload, xamanStatus?.resolved, shareBalance]);

  useEffect(() => {
    if (!executing || !personalAccount) return undefined;
    const interval = setInterval(async () => {
      executionAttempts.current += 1;
      await refreshBalances(personalAccount);
      if (executionAttempts.current >= EXECUTION_POLL_LIMIT) {
        clearInterval(interval);
        setExecuting(false);
        setStatus('Still waiting on the operator after several minutes. Check the vault balance manually.');
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executing, personalAccount]);

  useEffect(() => {
    if (!executing || baselineShareBalance === undefined || shareBalance === undefined) return;
    if (shareBalance !== baselineShareBalance) {
      setExecuting(false);
      setStatus('Execution complete — vault shares updated on Flare.');
    }
  }, [executing, baselineShareBalance, shareBalance]);

  const xamanTemplate =
    paymentReference && operatorAddress ? buildXamanPaymentTemplate(operatorAddress, paymentReference, DEFAULT_FEE_DROPS) : undefined;

  return (
    <section className="panel smart-panel">
      <div>
        <p className="eyebrow">XRPL access</p>
        <h2>Xaman to Flare Smart Account</h2>
      </div>

      <div className="actions">
        {xamanAccount ? (
          <>
            <button type="button" disabled>
              Connected: {shortAddress(xamanAccount)}
            </button>
            <button type="button" onClick={disconnectXaman}>
              Disconnect Xaman
            </button>
          </>
        ) : (
          <button type="button" onClick={connectXaman} disabled={xamanConnecting}>
            {xamanConnecting ? 'Waiting for Xaman...' : 'Connect Xaman'}
          </button>
        )}
      </div>
      {xamanConnectError ? <p className="status-line">{xamanConnectError}</p> : null}

      <div className="form-grid">
        <label>
          XRPL address
          <input
            value={xrplAddress}
            onChange={(event) => setXrplAddress(event.target.value)}
            placeholder="r... (or use Connect Xaman above)"
          />
        </label>
        <label>
          Deposit amount
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
        </label>
      </div>

      <div className="actions">
        <button type="button" onClick={enterVault} disabled={entering}>
          {entering ? 'Working...' : `Enter ${vault.name}`}
        </button>
        <button type="button" onClick={() => refreshBalances()}>
          Refresh balances
        </button>
      </div>

      <div className="stats-grid">
        <div>
          <span>PersonalAccount</span>
          <strong>{shortAddress(personalAccount)}</strong>
        </div>
        <div>
          <span>FXRP balance</span>
          <strong>{formatToken(fxrpBalance, 6, 'FXRP')}</strong>
        </div>
        <div>
          <span>{vault.token} shares</span>
          <strong>{formatToken(shareBalance, vault.depositMode === 'erc4626' ? 18 : 6)}</strong>
        </div>
        <div>
          <span>Operator XRPL</span>
          <strong>{operatorAddress || '-'}</strong>
        </div>
      </div>

      {status ? <p className="status-line">{status}</p> : null}

      {calls.length > 0 ? (
        <div className="call-plan">
          <h3>Generated Flare calls</h3>
          {calls.map((call) => (
            <div className="call-row" key={`${call.label}-${call.target}`}>
              <span>{call.label}</span>
              <code>{shortAddress(call.target)}</code>
            </div>
          ))}
          {callHash ? (
            <div className="call-row">
              <span>Instruction call hash</span>
              <code>{shortAddress(callHash)}</code>
            </div>
          ) : null}
          {paymentReference ? (
            <div className="call-row">
              <span>Payment reference (memo)</span>
              <code>{shortAddress(paymentReference)}</code>
            </div>
          ) : null}
          {registerTxHash ? (
            <div className="call-row">
              <span>Registration tx</span>
              <code>{shortAddress(registerTxHash)}</code>
            </div>
          ) : null}
        </div>
      ) : null}

      {xamanTemplate ? (
        <div className="payload-box">
          <h3>Xaman Payment template</h3>
          <p>This is the XRPL Payment that gets signed. Instruction fee is a placeholder — confirm the real fee with the operator before mainnet use.</p>
          <pre>{JSON.stringify(xamanTemplate, null, 2)}</pre>
        </div>
      ) : null}

      {xamanPayload ? (
        <div className="payload-box">
          <h3>Sign with Xaman</h3>
          {xamanPayload.qrPng ? <img src={xamanPayload.qrPng} alt="Xaman sign QR code" width={200} height={200} /> : null}
          {xamanPayload.deeplink ? (
            <a href={xamanPayload.deeplink} target="_blank" rel="noreferrer">
              Open in Xaman
            </a>
          ) : null}
          <p>
            {xamanStatus?.signed
              ? `Signed. XRPL tx: ${xamanStatus.txid ?? 'pending'}`
              : xamanStatus?.cancelled
                ? 'Cancelled in Xaman.'
                : xamanStatus?.expired
                  ? 'Expired.'
                  : 'Waiting for signature...'}
          </p>
        </div>
      ) : null}
    </section>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, formatUnits, http, isAddress, parseUnits, type Address, type Hex } from 'viem';
import QRCode from 'qrcode';
import { flare } from '@/config/wagmi';
import { algebraPoolAbi, assetManagerAbi, carryVaultAbi, erc20Abi, masterAccountControllerAbi } from '@/config/abis';
import {
  ASSET_MANAGER_FXRP,
  FXRP_ADDRESS,
  FXRP_USDT0_POOL,
  MASTER_ACCOUNT_CONTROLLER,
  USDT0_ADDRESS,
  type VaultConfig,
} from '@/config/vaults';
import {
  buildApproveAssetCall,
  buildClaimSurplusCalls,
  buildCustomInstructionReference,
  buildDepositOnlyCall,
  buildHashCommittedUserOp,
  buildMemoFieldUserOp,
  buildRedeemFxrpToXrplCalls,
  buildSwapUsdt0ToFxrpCalls,
  buildWithdrawCalls,
  buildXamanPaymentTemplate,
  computeDirectMintingPaymentDrops,
  toCustomCalls,
  type FsaCall,
} from '@/lib/fsa';
import { signDcentInstructionPayment, useDcentXrplConnect } from '@/lib/dcent';
import { signBifrostInstructionPayment, useBifrostConnect } from '@/lib/bifrostConnect';
import { createXamanPayload, getXamanPayloadStatus, type XamanPayload, type XamanPayloadStatus } from '@/lib/xaman';
import { useXamanConnect } from '@/lib/xamanConnect';
import { formatToken, isZeroAddress, shortAddress } from '@/lib/format';
import { useLiveVaultOpportunity } from '@/lib/useLiveVaultOpportunity';

type Props = {
  vault: VaultConfig;
};

const EXECUTION_POLL_LIMIT = 60;
const DEFAULT_FEE_DROPS = '12';
const XRPL_MEMO_HEX_LIMIT = 2048;
const DIRECT_MINT_EXECUTOR_URL = process.env.NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL;

type DirectMintMode = 'inline' | 'hash' | 'split';

type DirectMintPayment = {
  memo: Hex;
  paymentDrops: string;
  mode: DirectMintMode;
  label: string;
};

type TxDialogItem = {
  id: string;
  label: string;
  amountDrops: string;
  destination: string;
  status: 'pending' | 'signed' | 'failed';
  txid?: string;
  error?: string;
};

export function SmartAccountPanel({ vault }: Props) {
  const [xrplAddress, setXrplAddress] = useState('');
  const [amount, setAmount] = useState('0.01');
  const [withdrawShares, setWithdrawShares] = useState('0.01');
  const [redeemFxrpAmount, setRedeemFxrpAmount] = useState('0.01');
  const [personalAccount, setPersonalAccount] = useState<Address | undefined>();
  const [operatorAddress, setOperatorAddress] = useState('');
  const [fxrpBalance, setFxrpBalance] = useState<bigint | undefined>();
  const [shareBalance, setShareBalance] = useState<bigint | undefined>();
  const [usdt0Balance, setUsdt0Balance] = useState<bigint | undefined>();
  const [pendingSurplus, setPendingSurplus] = useState<bigint | undefined>();
  const [xrpBalance, setXrpBalance] = useState<bigint | undefined>();
  const [calls, setCalls] = useState<FsaCall[]>([]);
  const [callHash, setCallHash] = useState<Hex | undefined>();
  const [paymentReference, setPaymentReference] = useState<Hex | undefined>();
  const [directMintPaymentDrops, setDirectMintPaymentDrops] = useState<string | undefined>();
  const [directMintDestination, setDirectMintDestination] = useState('');
  const [directMintUserOp, setDirectMintUserOp] = useState<Hex | undefined>();
  const [directMintMode, setDirectMintMode] = useState<DirectMintMode | undefined>();
  const [xamanPayload, setXamanPayload] = useState<XamanPayload | undefined>();
  const [xamanStatus, setXamanStatus] = useState<XamanPayloadStatus | undefined>();
  const [activeXamanTxItemId, setActiveXamanTxItemId] = useState<string | undefined>();
  const [xamanSequence, setXamanSequence] = useState<{ payments: DirectMintPayment[]; destination: string; currentIndex: number } | undefined>();
  const [baseline, setBaseline] = useState<{ fxrp?: bigint; shares?: bigint; usdt0?: bigint } | undefined>();
  const [executing, setExecuting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [txDialogTitle, setTxDialogTitle] = useState('Transaction result');
  const [txDialogMessage, setTxDialogMessage] = useState('');
  const [txDialogItems, setTxDialogItems] = useState<TxDialogItem[]>([]);
  const [bifrostQr, setBifrostQr] = useState<string | undefined>();
  const executionAttempts = useRef(0);
  const { account: xamanAccount, connecting: xamanConnecting, error: xamanConnectError, connect: connectXaman, disconnect: disconnectXaman } = useXamanConnect();
  const { account: dcentAccount, connecting: dcentConnecting, error: dcentError, connect: connectDcent, disconnect: disconnectDcent } = useDcentXrplConnect();
  const {
    account: bifrostAccount,
    topic: bifrostTopic,
    uri: bifrostUri,
    connecting: bifrostConnecting,
    error: bifrostError,
    connect: connectBifrost,
    disconnect: disconnectBifrost,
  } = useBifrostConnect();

  function openTxDialog(title: string, message: string, items: TxDialogItem[]) {
    setTxDialogTitle(title);
    setTxDialogMessage(message);
    setTxDialogItems(items);
    setTxDialogOpen(true);
  }

  function updateTxDialogItem(id: string, patch: Partial<TxDialogItem>) {
    setTxDialogItems((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function xrplTxUrl(txid: string) {
    return `https://xrpscan.com/tx/${txid}`;
  }
  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: flare,
        transport: http(process.env.NEXT_PUBLIC_FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc'),
      }),
    [],
  );

  // Same live-data hook as the vault cards, so this panel's numbers can't drift from them.
  const opportunity = useLiveVaultOpportunity(vault);
  const estimatedAprDisplay = opportunity.display;

  async function refreshBalances(account = personalAccount) {
    if (!account || !isAddress(account)) return;
    try {
      const [fxrp, shares, usdt0, surplus] = await Promise.all([
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
        publicClient.readContract({
          address: vault.address,
          abi: carryVaultAbi,
          functionName: 'pendingSurplus',
          args: [account],
        }).catch(() => BigInt(0)),
      ]);
      setFxrpBalance(fxrp);
      setShareBalance(shares);
      setUsdt0Balance(usdt0);
      setPendingSurplus(surplus);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to read balances.');
    }
  }
  async function refreshXrpBalance(accountAddress = xrplAddress) {
    if (!accountAddress || !accountAddress.startsWith('r')) {
      setXrpBalance(undefined);
      return;
    }
    try {
      const response = await fetch(`/api/xrpl/account?account=${encodeURIComponent(accountAddress)}`);
      const data = await response.json().catch(() => null);
      if (!response.ok || typeof data?.balanceDrops !== 'string') throw new Error(data?.error || 'Unable to read XRPL balance.');
      setXrpBalance(BigInt(data.balanceDrops));
    } catch {
      setXrpBalance(undefined);
    }
  }

  async function createXamanPayment(reference: Hex, operator: string) {
    setStatus('Creating Xaman request...');
    try {
      const payload = await createXamanPayload(operator, DEFAULT_FEE_DROPS, reference);
      setXamanPayload(payload);
      setXamanStatus(undefined);
      setActiveXamanTxItemId(`xaman-${payload.uuid}`);
      setXamanSequence(undefined);
      setExecuting(false);
      openTxDialog('Xaman XRPL payment', 'Open Xaman and sign the payment. The result will update here.', [
        { id: `xaman-${payload.uuid}`, label: 'Submit vault instruction', amountDrops: DEFAULT_FEE_DROPS, destination: operator, status: 'pending' },
      ]);
      setStatus('Open Xaman and sign the payment to submit your vault instruction.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create Xaman payment.');
    } finally {
      setBusy(false);
    }
  }

  async function signWithDcent(reference: Hex, operator: string, account: string) {
    const txItemId = 'operator-payment-0';
    openTxDialog('XRPL payment', 'Confirm the payment in D\'CENT. The result will update here.', [
      {
        id: txItemId,
        label: 'Submit vault instruction',
        amountDrops: DEFAULT_FEE_DROPS,
        destination: operator,
        status: 'pending',
      },
    ]);
    setStatus('Confirm the XRPL Payment in D\'CENT to submit your vault instruction.');
    try {
      const result = await signDcentInstructionPayment({
        account,
        destination: operator,
        amountDrops: DEFAULT_FEE_DROPS,
        memoHex: reference,
      });
      if (!result.txid) throw new Error('Wallet completed but did not return an XRPL transaction hash. Check D\'CENT activity before trying again.');
      updateTxDialogItem(txItemId, { status: 'signed', txid: result.txid });
      setTxDialogMessage('XRPL transaction submitted. Waiting for the Smart Account balances to update on Flare.');
      setBaseline({ fxrp: fxrpBalance, shares: shareBalance, usdt0: usdt0Balance });
      executionAttempts.current = 0;
      setExecuting(true);
      setStatus(`Signed in D'CENT (${shortAddress(result.txid)}). Waiting for execution on Flare...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'D\'CENT signing failed.';
      updateTxDialogItem(txItemId, { status: 'failed', error: message });
      setTxDialogMessage('The wallet did not return a submitted XRPL transaction. No Flare execution can start until an XRPL hash exists.');
      setStatus(message);
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
      setActiveXamanTxItemId(`xaman-${payload.uuid}`);
      setXamanSequence(undefined);
      setExecuting(false);
      openTxDialog('Xaman direct-mint payment', 'Open Xaman and sign the payment. The result will update here.', [
        { id: `xaman-${payload.uuid}`, label: 'Direct-mint vault instruction', amountDrops, destination, status: 'pending' },
      ]);
      setStatus('Open Xaman and sign the direct-mint payment.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create Xaman direct-mint payment.');
    } finally {
      setBusy(false);
    }
  }

  async function createXamanSequencePayload(payments: DirectMintPayment[], destination: string, index: number) {
    const payment = payments[index];
    const itemId = `xaman-direct-${index}`;
    setStatus(`Creating Xaman request ${index + 1} of ${payments.length}...`);
    const payload = await createXamanPayload(destination, payment.paymentDrops, payment.memo);
    setXamanPayload(payload);
    setXamanStatus(undefined);
    setActiveXamanTxItemId(itemId);
    setXamanSequence({ payments, destination, currentIndex: index });
    setExecuting(false);
    setTxDialogMessage(`Open Xaman and sign payment ${index + 1} of ${payments.length}.`);
    setStatus(`Open Xaman and sign payment ${index + 1} of ${payments.length}: ${payment.label}.`);
  }

  async function signDirectMintWithXaman(payments: DirectMintPayment[], destination: string) {
    openTxDialog('Xaman direct-mint payments', 'Open Xaman and sign each payment when prompted.', payments.map((payment, index) => ({
      id: `xaman-direct-${index}`,
      label: payment.label,
      amountDrops: payment.paymentDrops,
      destination,
      status: 'pending' as const,
    })));
    try {
      await createXamanSequencePayload(payments, destination, 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create Xaman direct-mint payment.';
      updateTxDialogItem('xaman-direct-0', { status: 'failed', error: message });
      setTxDialogMessage(message);
      setStatus(message);
      setXamanSequence(undefined);
    } finally {
      setBusy(false);
    }
  }
  async function submitHashCommittedUserOp(args: {
    memo: Hex;
    packedUserOperation: Hex;
    userOpHash: Hex;
    sender: Address;
    nonce: bigint;
    destination: string;
    amountDrops: string;
  }) {
    if (!DIRECT_MINT_EXECUTOR_URL) {
      throw new Error('This call needs the 0xFE executor path. Set NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL so the committed UserOp can be delivered before signing.');
    }
    const response = await fetch(DIRECT_MINT_EXECUTOR_URL, {
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
        vault: vault.address,
      }),
    });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(message || 'Executor did not accept the committed UserOp.');
    }
  }

  async function signDirectMintWithDcent(payments: DirectMintPayment[], destination: string, account: string) {
    const signedTxids: string[] = [];
    let currentPaymentId = '';
    openTxDialog('Direct-mint XRPL payment', 'Confirm each D\'CENT payment. Submitted hashes and failures will update here.', payments.map((payment, index) => ({
      id: `direct-mint-${index}`,
      label: payment.label,
      amountDrops: payment.paymentDrops,
      destination,
      status: 'pending' as const,
    })));
    try {
      for (let i = 0; i < payments.length; i += 1) {
        const payment = payments[i];
        currentPaymentId = `direct-mint-${i}`;
        setStatus(`Confirm D'CENT payment ${i + 1} of ${payments.length}: ${formatUnits(BigInt(payment.paymentDrops), 6)} XRP for ${payment.label}.`);
        const result = await signDcentInstructionPayment({
          account,
          destination,
          amountDrops: payment.paymentDrops,
          memoHex: payment.memo,
        });
        if (!result.txid) throw new Error('Wallet completed but did not return an XRPL transaction hash. Check D\'CENT activity before trying again.');
        signedTxids.push(result.txid);
        updateTxDialogItem(currentPaymentId, { status: 'signed', txid: result.txid });
      }
      setBaseline({ fxrp: fxrpBalance, shares: shareBalance, usdt0: usdt0Balance });
      executionAttempts.current = 0;
      setExecuting(true);
      const txSummary = signedTxids.length > 0 ? ` (${signedTxids.map(shortAddress).join(', ')})` : '';
      setTxDialogMessage('XRPL payment submitted. Waiting for Smart Account balances to update on Flare.');
      setStatus(`Signed ${payments.length} direct-mint payment${payments.length > 1 ? 's' : ''} in D'CENT${txSummary}. Waiting for execution on Flare...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'D\'CENT direct-mint signing failed.';
      const partial = signedTxids.length > 0 ? ' One payment was already submitted; refresh balances before trying again.' : '';
      if (currentPaymentId) updateTxDialogItem(currentPaymentId, { status: 'failed', error: message });
      setTxDialogMessage(`${message}${partial}`);
      setStatus(`${message}${partial}`);
    } finally {
      setBusy(false);
    }
  }
  async function signWithBifrost(reference: Hex, operator: string, account: string, topic: string) {
    const txItemId = 'operator-payment-0';
    openTxDialog('XRPL payment', 'Confirm the payment in Bifrost. The result will update here.', [
      {
        id: txItemId,
        label: 'Submit vault instruction',
        amountDrops: DEFAULT_FEE_DROPS,
        destination: operator,
        status: 'pending',
      },
    ]);
    setStatus('Confirm the XRPL Payment in Bifrost to submit your vault instruction.');
    try {
      const result = await signBifrostInstructionPayment({
        topic,
        account,
        destination: operator,
        amountDrops: DEFAULT_FEE_DROPS,
        memoHex: reference,
      });
      if (!result.txid) throw new Error('Wallet completed but did not return an XRPL transaction hash. Check Bifrost activity before trying again.');
      updateTxDialogItem(txItemId, { status: 'signed', txid: result.txid });
      setTxDialogMessage('XRPL transaction submitted. Waiting for the Smart Account balances to update on Flare.');
      setBaseline({ fxrp: fxrpBalance, shares: shareBalance, usdt0: usdt0Balance });
      executionAttempts.current = 0;
      setExecuting(true);
      setStatus(`Signed in Bifrost (${shortAddress(result.txid)}). Waiting for execution on Flare...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bifrost signing failed.';
      updateTxDialogItem(txItemId, { status: 'failed', error: message });
      setTxDialogMessage('The wallet did not return a submitted XRPL transaction. No Flare execution can start until an XRPL hash exists.');
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  async function signDirectMintWithBifrost(payments: DirectMintPayment[], destination: string, account: string, topic: string) {
    const signedTxids: string[] = [];
    let currentPaymentId = '';
    openTxDialog('Direct-mint XRPL payment', 'Confirm each Bifrost payment. Submitted hashes and failures will update here.', payments.map((payment, index) => ({
      id: `direct-mint-${index}`,
      label: payment.label,
      amountDrops: payment.paymentDrops,
      destination,
      status: 'pending' as const,
    })));
    try {
      for (let i = 0; i < payments.length; i += 1) {
        const payment = payments[i];
        currentPaymentId = `direct-mint-${i}`;
        setStatus(`Confirm Bifrost payment ${i + 1} of ${payments.length}: ${formatUnits(BigInt(payment.paymentDrops), 6)} XRP for ${payment.label}.`);
        const result = await signBifrostInstructionPayment({
          topic,
          account,
          destination,
          amountDrops: payment.paymentDrops,
          memoHex: payment.memo,
        });
        if (!result.txid) throw new Error('Wallet completed but did not return an XRPL transaction hash. Check Bifrost activity before trying again.');
        signedTxids.push(result.txid);
        updateTxDialogItem(currentPaymentId, { status: 'signed', txid: result.txid });
      }
      setBaseline({ fxrp: fxrpBalance, shares: shareBalance, usdt0: usdt0Balance });
      executionAttempts.current = 0;
      setExecuting(true);
      const txSummary = signedTxids.length > 0 ? ` (${signedTxids.map(shortAddress).join(', ')})` : '';
      setTxDialogMessage('XRPL payment submitted. Waiting for Smart Account balances to update on Flare.');
      setStatus(`Signed ${payments.length} direct-mint payment${payments.length > 1 ? 's' : ''} in Bifrost${txSummary}. Waiting for execution on Flare...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bifrost direct-mint signing failed.';
      const partial = signedTxids.length > 0 ? ' One payment was already submitted; refresh balances before trying again.' : '';
      if (currentPaymentId) updateTxDialogItem(currentPaymentId, { status: 'failed', error: message });
      setTxDialogMessage(`${message}${partial}`);
      setStatus(`${message}${partial}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitPreparedInstruction(reference: Hex, operator: string) {
    if (dcentAccount) {
      await signWithDcent(reference, operator, dcentAccount);
      return;
    }
    if (bifrostAccount && bifrostTopic) {
      await signWithBifrost(reference, operator, bifrostAccount, bifrostTopic);
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
      await Promise.all([refreshBalances(account), refreshXrpBalance(xrplAddress)]);
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
    setDirectMintUserOp(undefined);
    setDirectMintMode(undefined);

    const prepared = await prepareDirectMintEntry();
    if (!prepared) {
      setBusy(false);
      return;
    }

    const { payments, coreVaultXrplAddress } = prepared;
    if (dcentAccount) {
      await signDirectMintWithDcent(payments, coreVaultXrplAddress, dcentAccount);
      return;
    }
    if (bifrostAccount && bifrostTopic) {
      await signDirectMintWithBifrost(payments, coreVaultXrplAddress, bifrostAccount, bifrostTopic);
      return;
    }
    if (payments.length > 1) {
      await signDirectMintWithXaman(payments, coreVaultXrplAddress);
      return;
    }
    await createDirectMintXamanPayment(payments[0].memo, coreVaultXrplAddress, payments[0].paymentDrops);
  }

  async function prepareDirectMintEntry(): Promise<{ payments: DirectMintPayment[]; coreVaultXrplAddress: string } | null> {
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
      await Promise.all([refreshBalances(account), refreshXrpBalance(xrplAddress)]);

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

      const allowance = await publicClient.readContract({
        address: FXRP_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account, vault.address],
      }).catch(() => BigInt(0));
      const depositCall = buildDepositOnlyCall(vault, netMintDrops, account);
      const nextCalls = allowance >= netMintDrops ? [depositCall] : [buildApproveAssetCall(vault), depositCall];
      const inlineMemo = buildMemoFieldUserOp({
        calls: nextCalls,
        sender: account,
        nonce,
      });
      const memoHexLength = inlineMemo.length - 2;
      setCalls(nextCalls);

      const fullPaymentDrops = computeDirectMintingPaymentDrops({
        netMintDrops,
        feeBips,
        minimumFeeDrops,
        executorFeeDrops,
      }).toString();
      const memoOnlyPaymentDrops = computeDirectMintingPaymentDrops({
        netMintDrops: BigInt(0),
        feeBips,
        minimumFeeDrops,
        executorFeeDrops,
      }).toString();

      let payments: DirectMintPayment[] = [
        { memo: inlineMemo, paymentDrops: fullPaymentDrops, mode: 'inline', label: 'mint amount plus fees' },
      ];
      let packedUserOperation: Hex | undefined;
      let userOpHash: Hex | undefined;
      let memoMode: DirectMintMode = 'inline';

      if (memoHexLength > XRPL_MEMO_HEX_LIMIT) {
        if (DIRECT_MINT_EXECUTOR_URL) {
          const committed = buildHashCommittedUserOp({
            calls: nextCalls,
            sender: account,
            nonce,
          });
          payments = [{ memo: committed.memo, paymentDrops: fullPaymentDrops, mode: 'hash', label: 'mint amount plus fees' }];
          packedUserOperation = committed.packedUserOperation;
          userOpHash = committed.userOpHash;
          memoMode = 'hash';
        } else {
          const [approveCall, depositCall] = nextCalls;
          const approveMemo = buildMemoFieldUserOp({ calls: [approveCall], sender: account, nonce });
          const depositMemo = buildMemoFieldUserOp({ calls: [depositCall], sender: account, nonce: nonce + BigInt(1) });
          if (approveMemo.length - 2 > XRPL_MEMO_HEX_LIMIT || depositMemo.length - 2 > XRPL_MEMO_HEX_LIMIT) {
            throw new Error('The split inline memo path still exceeds XRPL\'s 1024-byte memo limit. Configure NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL for the 0xFE executor path.');
          }
          payments = [
            { memo: approveMemo, paymentDrops: fullPaymentDrops, mode: 'split', label: `mint FXRP and approve ${vault.name}` },
            { memo: depositMemo, paymentDrops: memoOnlyPaymentDrops, mode: 'split', label: `deposit into ${vault.name}` },
          ];
          memoMode = 'split';
        }
      }

      setPaymentReference(payments[0].memo);
      setDirectMintUserOp(packedUserOperation);
      setDirectMintMode(memoMode);
      setCallHash(userOpHash);
      const totalPaymentDrops = payments.reduce((sum, payment) => sum + BigInt(payment.paymentDrops), BigInt(0)).toString();
      setDirectMintPaymentDrops(totalPaymentDrops);
      setDirectMintDestination(coreVaultXrplAddress);

      if (memoMode === 'hash') {
        setStatus('Submitting the 0xFE committed UserOp to the executor before wallet signing...');
        await submitHashCommittedUserOp({
          memo: payments[0].memo,
          packedUserOperation: packedUserOperation!,
          userOpHash: userOpHash!,
          sender: account,
          nonce,
          destination: coreVaultXrplAddress,
          amountDrops: payments[0].paymentDrops,
        });
        setStatus('Executor accepted the committed UserOp. Sign the compact 0xFE direct-mint payment.');
      } else if (memoMode === 'split') {
        setStatus(`Inline memo is too large, so this will use two D'CENT signatures. Payment 2 is fee-only: ${formatUnits(BigInt(memoOnlyPaymentDrops), 6)} XRP.`);
      }
      return { payments, coreVaultXrplAddress };
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to prepare direct-mint UserOp.');
      return null;
    }
  }

  async function prepareMemoOnlyDirectMintInstruction(
    instructionLabel: string,
    buildCalls: (account: Address) => FsaCall[] | Promise<FsaCall[]>,
  ): Promise<{ payments: DirectMintPayment[]; coreVaultXrplAddress: string } | null> {
    if (!vault.entryEnabled) {
      setStatus(vault.readinessNote || 'This vault is not accepting Smart Account instructions yet.');
      return null;
    }
    if (!xrplAddress) {
      setStatus('Connect D\'CENT or Xaman first.');
      return null;
    }

    setXamanPayload(undefined);
    setXamanStatus(undefined);
    setCallHash(undefined);
    setPaymentReference(undefined);
    setDirectMintPaymentDrops(undefined);
    setDirectMintDestination('');
    setDirectMintUserOp(undefined);
    setDirectMintMode(undefined);
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
      await Promise.all([refreshBalances(account), refreshXrpBalance(xrplAddress)]);

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

      const nextCalls = await buildCalls(account);
      if (nextCalls.length === 0) {
        setStatus('No vault instruction is needed.');
        return null;
      }
      setCalls(nextCalls);

      const memoOnlyPaymentDrops = computeDirectMintingPaymentDrops({
        netMintDrops: BigInt(0),
        feeBips,
        minimumFeeDrops,
        executorFeeDrops,
      }).toString();

      const inlineMemo = buildMemoFieldUserOp({ calls: nextCalls, sender: account, nonce });
      let payments: DirectMintPayment[];
      if (inlineMemo.length - 2 <= XRPL_MEMO_HEX_LIMIT) {
        payments = [{ memo: inlineMemo, paymentDrops: memoOnlyPaymentDrops, mode: 'inline', label: instructionLabel }];
      } else {
        payments = nextCalls.map((call, index) => {
          const memo = buildMemoFieldUserOp({ calls: [call], sender: account, nonce: nonce + BigInt(index) });
          if (memo.length - 2 > XRPL_MEMO_HEX_LIMIT) {
            throw new Error(`${call.label} exceeds XRPL's 1024-byte memo limit by itself. Configure NEXT_PUBLIC_DIRECT_MINT_EXECUTOR_URL for this operation.`);
          }
          return { memo, paymentDrops: memoOnlyPaymentDrops, mode: 'split' as const, label: call.label };
        });
      }

      setPaymentReference(payments[0].memo);
      setDirectMintMode(payments.length > 1 ? 'split' : 'inline');
      setDirectMintDestination(coreVaultXrplAddress);
      setDirectMintPaymentDrops(payments.reduce((sum, payment) => sum + BigInt(payment.paymentDrops), BigInt(0)).toString());
      if (payments.length > 1) {
        setStatus(`This ${instructionLabel} needs ${payments.length} fee-only D'CENT signatures of ${formatUnits(BigInt(memoOnlyPaymentDrops), 6)} XRP each.`);
      }
      return { payments, coreVaultXrplAddress };
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Unable to prepare ${instructionLabel}.`);
      return null;
    }
  }

  async function submitDirectMintInstruction(prepared: { payments: DirectMintPayment[]; coreVaultXrplAddress: string } | null) {
    if (!prepared) {
      setBusy(false);
      return;
    }
    const { payments, coreVaultXrplAddress } = prepared;
    if (dcentAccount) {
      await signDirectMintWithDcent(payments, coreVaultXrplAddress, dcentAccount);
      return;
    }
    if (bifrostAccount && bifrostTopic) {
      await signDirectMintWithBifrost(payments, coreVaultXrplAddress, bifrostAccount, bifrostTopic);
      return;
    }
    if (payments.length > 1) {
      await signDirectMintWithXaman(payments, coreVaultXrplAddress);
      return;
    }
    await createDirectMintXamanPayment(payments[0].memo, coreVaultXrplAddress, payments[0].paymentDrops);
  }
  async function withdrawVault() {
    let shareAmount: bigint;
    try {
      shareAmount = parseUnits(withdrawShares || '0', vault.shareDecimals);
    } catch {
      setStatus('Enter a valid share amount to withdraw.');
      return;
    }
    if (shareAmount <= BigInt(0)) {
      setStatus('Enter a share amount greater than zero.');
      return;
    }
    if (shareBalance !== undefined && shareAmount > shareBalance) {
      setStatus('Withdraw amount is greater than your vault shares.');
      return;
    }
    setBusy(true);
    const prepared = await prepareMemoOnlyDirectMintInstruction(`withdraw ${withdrawShares} shares`, (account) => buildWithdrawCalls(vault, withdrawShares, account));
    await submitDirectMintInstruction(prepared);
  }

  async function depositExistingFxrp() {
    if (!fxrpBalance || fxrpBalance === BigInt(0)) {
      setStatus('No FXRP in the Smart Account to deposit.');
      return;
    }
    setBusy(true);
    const depositAssets = fxrpBalance;
    const depositLabel = `deposit ${formatUnits(depositAssets, vault.assetDecimals)} FXRP`;
    const prepared = await prepareMemoOnlyDirectMintInstruction(depositLabel, async (account) => {
      const allowance = await publicClient.readContract({
        address: FXRP_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account, vault.address],
      });
      const depositCall = buildDepositOnlyCall(vault, depositAssets, account);
      return allowance >= depositAssets ? [depositCall] : [buildApproveAssetCall(vault), depositCall];
    });
    await submitDirectMintInstruction(prepared);
  }

  async function withdrawAllVault() {
    if (!shareBalance || shareBalance === BigInt(0)) {
      setStatus('No vault shares to withdraw yet. Refresh after the deposit executes.');
      return;
    }
    const shareAmount = formatUnits(shareBalance, vault.shareDecimals);
    setWithdrawShares(shareAmount);
    setBusy(true);
    const prepared = await prepareMemoOnlyDirectMintInstruction(`withdraw ${shareAmount} shares`, (account) => buildWithdrawCalls(vault, shareAmount, account));
    await submitDirectMintInstruction(prepared);
  }

  async function redeemFxrpToXrpl(redeemAll = false) {
    if (!xrplAddress) {
      setStatus('Connect D\'CENT or Xaman first so we know the XRPL redemption address.');
      return;
    }
    if (!fxrpBalance || fxrpBalance === BigInt(0)) {
      setStatus('No FXRP in the Smart Account to redeem. Withdraw from the vault first, or leave FXRP on Flare for another vault.');
      return;
    }

    let amountUBA: bigint;
    try {
      amountUBA = redeemAll ? fxrpBalance : parseUnits(redeemFxrpAmount || '0', vault.assetDecimals);
    } catch {
      setStatus('Enter a valid FXRP amount to redeem.');
      return;
    }
    if (amountUBA <= BigInt(0)) {
      setStatus('Enter an FXRP amount greater than zero.');
      return;
    }
    if (amountUBA > fxrpBalance) {
      setStatus('Redeem amount is greater than your Smart Account FXRP balance.');
      return;
    }

    setBusy(true);
    setStatus('Checking FAssets redemption minimum...');
    try {
      const minimumRedeemAmount = await publicClient.readContract({
        address: ASSET_MANAGER_FXRP,
        abi: assetManagerAbi,
        functionName: 'minimumRedeemAmountUBA',
        args: [],
      });
      if (amountUBA < minimumRedeemAmount) {
        setStatus(`Minimum FXRP redemption is ${formatUnits(minimumRedeemAmount, vault.assetDecimals)} FXRP.`);
        setBusy(false);
        return;
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to read minimum redemption amount.');
      setBusy(false);
      return;
    }

    const label = `redeem ${formatUnits(amountUBA, vault.assetDecimals)} FXRP to XRPL`;
    const prepared = await prepareMemoOnlyDirectMintInstruction(label, () => buildRedeemFxrpToXrplCalls(amountUBA, xrplAddress));
    await submitDirectMintInstruction(prepared);
  }
  async function refreshAllBalances() {
    await Promise.all([refreshBalances(), refreshXrpBalance()]);
  }

  async function claimSurplus() {
    setBusy(true);
    const prepared = await prepareMemoOnlyDirectMintInstruction('claim surplus', () => buildClaimSurplusCalls(vault));
    await submitDirectMintInstruction(prepared);
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

    const prepared = await prepareMemoOnlyDirectMintInstruction('swap surplus to FXRP', (account) => buildSwapUsdt0ToFxrpCalls(account, usdt0Balance, amountOutMinimum));
    await submitDirectMintInstruction(prepared);
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
      await Promise.all([refreshBalances(account), refreshXrpBalance(accountAddress)]);
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
    if (!bifrostAccount) return;
    resolveConnectedAccount(bifrostAccount, 'Bifrost');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bifrostAccount]);

  useEffect(() => {
    if (!bifrostUri) {
      setBifrostQr(undefined);
      return undefined;
    }
    let cancelled = false;
    QRCode.toDataURL(bifrostUri, { margin: 1, width: 220 })
      .then((dataUrl) => {
        if (!cancelled) setBifrostQr(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setBifrostQr(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [bifrostUri]);

  useEffect(() => {
    if (!xamanPayload || xamanStatus?.resolved) return undefined;
    const interval = setInterval(async () => {
      try {
        const result = await getXamanPayloadStatus(xamanPayload.uuid);
        setXamanStatus(result);
        if (result.resolved) {
          const txItemId = activeXamanTxItemId || `xaman-${xamanPayload.uuid}`;
          if (result.signed) {
            updateTxDialogItem(txItemId, { status: 'signed', txid: result.txid });
            if (xamanSequence && xamanSequence.currentIndex + 1 < xamanSequence.payments.length) {
              const nextIndex = xamanSequence.currentIndex + 1;
              setTxDialogMessage(`Payment ${xamanSequence.currentIndex + 1} signed. Preparing payment ${nextIndex + 1}.`);
              await createXamanSequencePayload(xamanSequence.payments, xamanSequence.destination, nextIndex);
            } else {
              setTxDialogMessage(result.txid ? 'XRPL transaction submitted. Waiting for Smart Account balances to update on Flare.' : 'Xaman signed, but no XRPL transaction hash is available yet.');
              setStatus(`Signed in Xaman${result.txid ? ` (${shortAddress(result.txid)})` : ''}. Waiting for execution on Flare...`);
              setXamanSequence(undefined);
              setBaseline({ fxrp: fxrpBalance, shares: shareBalance, usdt0: usdt0Balance });
              executionAttempts.current = 0;
              setExecuting(true);
            }
          } else if (result.cancelled) {
            updateTxDialogItem(txItemId, { status: 'failed', error: 'Cancelled in Xaman.' });
            setTxDialogMessage('Xaman request was cancelled.');
            setStatus('Xaman request was cancelled.');
            setXamanSequence(undefined);
          } else if (result.expired) {
            updateTxDialogItem(txItemId, { status: 'failed', error: 'Xaman request expired.' });
            setTxDialogMessage('Xaman request expired. Try again.');
            setStatus('Xaman request expired. Try again.');
            setXamanSequence(undefined);
          }
        }
      } catch {
        // transient polling error, retry on next tick
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [xamanPayload, xamanStatus?.resolved, activeXamanTxItemId, xamanSequence, fxrpBalance, shareBalance, usdt0Balance]);

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
      setTxDialogMessage('Done. Your balances updated on Flare.');
      setStatus('Done. Your balances updated on Flare.');
    }
  }, [executing, baseline, fxrpBalance, shareBalance, usdt0Balance]);

  const paymentTemplateDestination = directMintDestination || operatorAddress;
  const paymentTemplateDrops = directMintPaymentDrops || DEFAULT_FEE_DROPS;
  const xamanTemplate =
    paymentReference && paymentTemplateDestination ? buildXamanPaymentTemplate(paymentTemplateDestination, paymentReference, paymentTemplateDrops) : undefined;
  const hasVaultShares = Boolean(shareBalance && shareBalance > BigInt(0));
  const hasSmartFxrp = Boolean(fxrpBalance && fxrpBalance > BigInt(0));
  const hasPendingSurplus = Boolean(pendingSurplus && pendingSurplus > BigInt(0));
  const entryButtonDisabled = busy || !vault.entryEnabled;
  const entryButtonLabel = busy ? 'Preparing...' : !vault.entryEnabled ? 'Waiting for vault' : hasVaultShares ? 'Add XRP capital' : 'Mint and enter';

  return (
    <section className="panel action-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Execute</p>
          <h2>Mint, deposit, redeem</h2>
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

      <p className="behind-the-click">
        {vault.kind === 'carry'
          ? "Behind this one signature, the vault can borrow, swap, and manage an LP position across several Flare protocols. You don't need to understand lending, borrowing, swaps, or rebalancing to use it."
          : "Behind this one signature, your FXRP is deposited straight into the FXRP/USDT0 LP leaf. No borrowing, no leverage — just the pool position."}
      </p>

      <div className="step-list">
        <div className={xamanAccount || dcentAccount || bifrostAccount ? 'flow-step done' : 'flow-step'}>
          <span>1</span>
          <div>
            <strong>Connect wallet</strong>
            <p>
              {dcentAccount
                ? `D'CENT ${shortAddress(dcentAccount)}`
                : bifrostAccount
                  ? `Bifrost ${shortAddress(bifrostAccount)}`
                  : xamanAccount
                    ? `Xaman ${shortAddress(xamanAccount)}`
                    : 'Use your XRPL wallet. No FLR wallet needed.'}
            </p>
          </div>
          {dcentAccount ? (
            <button type="button" className="ghost-button" onClick={disconnectDcent}>Disconnect</button>
          ) : bifrostAccount ? (
            <button type="button" className="ghost-button" onClick={disconnectBifrost}>Disconnect</button>
          ) : xamanAccount ? (
            <button type="button" className="ghost-button" onClick={disconnectXaman}>Disconnect</button>
          ) : (
            <div className="wallet-actions">
              <button type="button" onClick={connectDcent} disabled={dcentConnecting || xamanConnecting || bifrostConnecting}>
                {dcentConnecting ? 'Waiting...' : "D'CENT"}
              </button>
              <button type="button" className="ghost-button" onClick={connectBifrost} disabled={bifrostConnecting || dcentConnecting || xamanConnecting}>
                {bifrostConnecting ? 'Waiting...' : 'Bifrost'}
              </button>
              <button type="button" className="ghost-button" onClick={connectXaman} disabled={xamanConnecting || dcentConnecting || bifrostConnecting}>
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
          <label className="amount-control">
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label="Deposit amount" />
            <span>XRP</span>
          </label>
        </div>

        <div className="flow-step">
          <span>3</span>
          <div>
            <strong>Sign once</strong>
            <p>Pay XRP to the FXRP Core Vault with a Smart Account UserOp memo.</p>
          </div>
          <button type="button" onClick={enterVault} disabled={entryButtonDisabled}>
            {entryButtonLabel}
          </button>
        </div>
      </div>

      {!xamanAccount && !dcentAccount && !bifrostAccount ? (
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
      {bifrostError ? <p className="status-line warning">{bifrostError}</p> : null}
      {xamanConnectError ? <p className="status-line warning">{xamanConnectError}</p> : null}
      {status ? <p className="status-line">{status}</p> : null}

      {txDialogOpen ? (
        <div className="tx-dialog" role="dialog" aria-modal="false" aria-labelledby="tx-dialog-title">
          <div className="tx-dialog-header">
            <div>
              <h3 id="tx-dialog-title">{txDialogTitle}</h3>
              <p>{txDialogMessage}</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setTxDialogOpen(false)}>Close</button>
          </div>
          <div className="tx-dialog-list">
            {txDialogItems.map((item) => (
              <div className={`tx-dialog-row ${item.status}`} key={item.id}>
                <div>
                  <span>{item.status}</span>
                  <strong>{item.label}</strong>
                  <p>{formatUnits(BigInt(item.amountDrops), 6)} XRP to {shortAddress(item.destination)}</p>
                  {item.error ? <p className="tx-error">{item.error}</p> : null}
                </div>
                {item.txid ? (
                  <a href={xrplTxUrl(item.txid)} target="_blank" rel="noreferrer" className="primary-link">
                    {shortAddress(item.txid)}
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
      {bifrostUri && !bifrostAccount ? (
        <div className="sign-box">
          <div>
            <h3>Scan with Bifrost</h3>
            <p>Open Bifrost Wallet and scan this code, or open it directly on mobile.</p>
            <a href={bifrostUri} target="_blank" rel="noreferrer" className="primary-link">
              Open in Bifrost
            </a>
          </div>
          {bifrostQr ? <img src={bifrostQr} alt="Bifrost connect QR code" width={156} height={156} /> : null}
        </div>
      ) : null}

      <div className="account-strip">
        <div>
          <span>XRPL XRP</span>
          <strong>{formatToken(xrpBalance, 6, 'XRP')}</strong>
        </div>
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
        <div>
          <span>USDT0 profit</span>
          <strong>{formatToken(pendingSurplus, 6, 'USDT0')}</strong>
        </div>
      </div>

      <div className="position-panel">
        <div className="position-panel-header">
          <div>
            <p className="eyebrow">Position</p>
            <h3>Manage Smart Account assets</h3>
          </div>
          <button type="button" className="ghost-button compact-button" onClick={refreshAllBalances}>Refresh</button>
        </div>

        <div className="position-grid">
          <div className="position-card">
            <div>
              <span className="position-label">Vault entry</span>
              <strong>Deposit existing FXRP</strong>
              <p>Move FXRP already held by the Smart Account into the selected vault.</p>
            </div>
            <button type="button" onClick={depositExistingFxrp} disabled={busy || !vault.entryEnabled || !hasSmartFxrp}>{busy ? 'Preparing...' : 'Deposit FXRP'}</button>
          </div>

          <div className="position-card">
            <div>
              <span className="position-label">Withdraw</span>
              <strong>Shares to FXRP</strong>
              <p>Withdraw keeps FXRP on Flare inside your Smart Account.</p>
            </div>
            <label className="amount-control">
              <input value={withdrawShares} onChange={(event) => setWithdrawShares(event.target.value)} inputMode="decimal" aria-label="Withdraw shares" />
              <span>shares</span>
            </label>
            <div className="button-row">
              <button type="button" onClick={withdrawVault} disabled={busy || !vault.entryEnabled || !hasVaultShares}>{busy ? 'Preparing...' : 'Withdraw'}</button>
              <button type="button" className="ghost-button" onClick={withdrawAllVault} disabled={busy || !vault.entryEnabled || !hasVaultShares}>{busy ? 'Preparing...' : 'Max'}</button>
            </div>
          </div>

          <div className="position-card">
            <div>
              <span className="position-label">Redeem</span>
              <strong>FXRP to XRPL XRP</strong>
              <p>Burn Smart Account FXRP and request native XRP back to the connected XRPL wallet.</p>
            </div>
            <label className="amount-control">
              <input value={redeemFxrpAmount} onChange={(event) => setRedeemFxrpAmount(event.target.value)} inputMode="decimal" aria-label="Redeem FXRP" />
              <span>FXRP</span>
            </label>
            <div className="button-row">
              <button type="button" onClick={() => redeemFxrpToXrpl(false)} disabled={busy || !vault.entryEnabled || !hasSmartFxrp}>{busy ? 'Preparing...' : 'Redeem'}</button>
              <button type="button" className="ghost-button" onClick={() => redeemFxrpToXrpl(true)} disabled={busy || !vault.entryEnabled || !hasSmartFxrp}>{busy ? 'Preparing...' : 'Max'}</button>
            </div>
          </div>

          <div className="position-card">
            <div>
              <span className="position-label">Surplus</span>
              <strong>Harvest or compound</strong>
              <p>Claim USDT0 surplus or swap it back into FXRP when available.</p>
            </div>
            <div className="button-row">
              {vault.supportsCarryWithdrawals ? (
                <button type="button" className="ghost-button" onClick={claimSurplus} disabled={busy || !vault.entryEnabled || !hasPendingSurplus}>{busy ? 'Preparing...' : 'Claim'}</button>
              ) : null}
              <button type="button" className="ghost-button" onClick={swapUsdt0ToFxrp} disabled={busy || !vault.entryEnabled || !usdt0Balance}>{busy ? 'Preparing...' : 'Swap to FXRP'}</button>
            </div>
          </div>
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
            <button type="button" onClick={refreshAllBalances}>Refresh balances</button>
            <button type="button" onClick={withdrawVault} disabled={busy || !vault.entryEnabled}>{busy ? 'Preparing...' : 'Withdraw'}</button>
            {vault.supportsCarryWithdrawals ? (
              <button type="button" onClick={claimSurplus} disabled={busy || !vault.entryEnabled || !hasPendingSurplus}>{busy ? 'Preparing...' : 'Claim surplus'}</button>
            ) : null}
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
              {directMintMode ? <div className="call-row"><span>Memo mode</span><code>{directMintMode === 'hash' ? '0xFE hash' : '0xFF inline'}</code></div> : null}
              {paymentReference ? <div className="call-row"><span>Memo reference</span><code>{shortAddress(paymentReference)}</code></div> : null}
              {directMintUserOp ? <div className="call-row"><span>UserOp bytes</span><code>{shortAddress(directMintUserOp)}</code></div> : null}
            </div>
          ) : null}

          {xamanTemplate ? <pre>{JSON.stringify(xamanTemplate, null, 2)}</pre> : null}
        </div>
      </details>
    </section>
  );
}


'use client';

import { useState } from 'react';
import type { Hex } from 'viem';

export type DcentWalletInfo = {
  name?: string;
  icon?: string;
  version?: string;
  chainId?: string;
};

type DcentXrplProvider = {
  getWalletInfo?: () => DcentWalletInfo | Promise<DcentWalletInfo> | string | Promise<string>;
  request: <T = unknown>(args: { method: string; params?: unknown[] | object }) => Promise<T>;
};

type DcentSignResponse = {
  tx_json?: {
    hash?: string;
    date?: number;
    ledger_index?: number;
  };
  hash?: string;
};

declare global {
  interface Window {
    xrpl?: DcentXrplProvider;
  }
}

const XRPL_MAINNET_CHAIN_ID = 'xrpl:0';

export function getDcentXrplProvider() {
  if (typeof window === 'undefined') return undefined;
  return window.xrpl;
}

export function useDcentXrplConnect() {
  const [account, setAccount] = useState<string | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [walletInfo, setWalletInfo] = useState<DcentWalletInfo | undefined>();

  async function connect() {
    const provider = getDcentXrplProvider();
    if (!provider) {
      setError('D\'CENT XRPL provider was not found. Open this page in D\'CENT in-app browser, or try the D\'CENT extension if it injects window.xrpl.');
      return;
    }

    setConnecting(true);
    setError(undefined);
    try {
      const info = await provider.getWalletInfo?.();
      if (typeof info === 'object') setWalletInfo(info);

      if (typeof info === 'object' && info.chainId && info.chainId !== XRPL_MAINNET_CHAIN_ID) {
        await provider.request({ method: 'xrpl_switchChain', params: [{ chainId: XRPL_MAINNET_CHAIN_ID }] });
      }

      const accounts = await provider.request<string[]>({ method: 'xrpl_accounts' });
      const nextAccount = accounts[0];
      if (!nextAccount) throw new Error('D\'CENT did not return an XRPL account.');
      setAccount(nextAccount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'D\'CENT connection failed.');
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    setAccount(undefined);
    setWalletInfo(undefined);
    setError(undefined);
  }

  return { account, connecting, error, walletInfo, connect, disconnect };
}

export async function signDcentInstructionPayment(args: {
  account: string;
  destination: string;
  amountDrops: string;
  memoHex: Hex;
}) {
  const provider = getDcentXrplProvider();
  if (!provider) throw new Error('D\'CENT XRPL provider was not found.');

  const response = await provider.request<DcentSignResponse>({
    method: 'xrpl_signTransaction',
    params: [
      {
        tx_json: {
          TransactionType: 'Payment',
          Account: args.account,
          Destination: args.destination,
          Amount: args.amountDrops,
          Memos: [
            {
              Memo: {
                MemoData: args.memoHex.replace(/^0x/, '').toUpperCase(),
              },
            },
          ],
        },
        submit: true,
        chainId: XRPL_MAINNET_CHAIN_ID,
        autofill: true,
      },
    ],
  });

  return {
    txid: response.hash || response.tx_json?.hash,
    ledgerIndex: response.tx_json?.ledger_index,
  };
}
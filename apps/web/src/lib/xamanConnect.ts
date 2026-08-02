'use client';

import { useEffect, useRef, useState } from 'react';
import { XummPkce } from 'xumm-oauth2-pkce';
import { clearXrplWalletState, readXrplWalletState, writeXrplWalletState } from '@/lib/xrplWalletState';

export function useXamanConnect() {
  const clientRef = useRef<XummPkce | null>(null);
  const [account, setAccount] = useState<string | undefined>(readXrplWalletState('xaman').account);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    function onWalletEvent(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.wallet !== 'xaman') return;
      setAccount(detail.state?.account);
    }
    window.addEventListener('flare:xrpl-wallet', onWalletEvent);
    return () => window.removeEventListener('flare:xrpl-wallet', onWalletEvent);
  }, []);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_XUMM_API_KEY;
    if (!apiKey) return;

    const client = new XummPkce(apiKey);
    clientRef.current = client;

    client.on('retrieved', async () => {
      const state = await client.state();
      if (state?.me?.account) {
        setAccount(state.me.account);
        writeXrplWalletState('xaman', { account: state.me.account });
      }
    });
    client.on('success', async () => {
      const state = await client.state();
      if (state?.me?.account) {
        setAccount(state.me.account);
        writeXrplWalletState('xaman', { account: state.me.account });
      }
      setConnecting(false);
    });
    client.on('error', (err) => {
      setError(err.message || 'Xaman sign-in failed.');
      setConnecting(false);
    });
    client.on('loggedout', () => {
      setAccount(undefined);
      clearXrplWalletState('xaman');
    });
  }, []);

  async function connect() {
    if (!clientRef.current) {
      setError('Xaman connect is not configured (missing NEXT_PUBLIC_XUMM_API_KEY).');
      return;
    }
    setError(undefined);
    setConnecting(true);
    try {
      await clientRef.current.authorize();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xaman sign-in failed.');
      setConnecting(false);
    }
  }

  function disconnect() {
    clientRef.current?.logout();
    setAccount(undefined);
    clearXrplWalletState('xaman');
  }

  return { account, connecting, error, connect, disconnect };
}

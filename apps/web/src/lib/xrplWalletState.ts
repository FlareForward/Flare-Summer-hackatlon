'use client';

type WalletKey = 'bifrost' | 'dcent' | 'xaman';

type WalletState = {
  account?: string;
  topic?: string;
};

const PREFIX = 'flare.xrplWallet.';

function key(wallet: WalletKey) {
  return `${PREFIX}${wallet}`;
}

export function readXrplWalletState(wallet: WalletKey): WalletState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key(wallet));
    return raw ? JSON.parse(raw) as WalletState : {};
  } catch {
    return {};
  }
}

export function writeXrplWalletState(wallet: WalletKey, state: WalletState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key(wallet), JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('flare:xrpl-wallet', { detail: { wallet, state } }));
}

export function clearXrplWalletState(wallet: WalletKey) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(key(wallet));
  window.dispatchEvent(new CustomEvent('flare:xrpl-wallet', { detail: { wallet, state: {} } }));
}

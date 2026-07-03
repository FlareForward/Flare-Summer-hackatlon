'use client';

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  bifrostWallet,
  braveWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { http, type Chain } from 'viem';

const flareRpcUrl =
  process.env.NEXT_PUBLIC_FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';

export const flare: Chain = {
  id: 14,
  name: 'Flare',
  nativeCurrency: { name: 'Flare', symbol: 'FLR', decimals: 18 },
  rpcUrls: {
    default: { http: [flareRpcUrl] },
  },
  blockExplorers: {
    default: { name: 'Flare Explorer', url: 'https://flare-explorer.flare.network' },
  },
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
      blockCreated: 3002461,
    },
  },
};

export const config = getDefaultConfig({
  appName: 'Flare Vault Gateway',
  appDescription: 'XRPL to Flare vault access through Flare Smart Accounts.',
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || '07e1641a93dda596717dfb0ed5d2445f',
  wallets: [
    {
      groupName: 'Flare',
      wallets: [bifrostWallet, rabbyWallet, braveWallet, metaMaskWallet, walletConnectWallet],
    },
  ],
  chains: [flare],
  transports: {
    [flare.id]: http(flareRpcUrl),
  },
  ssr: true,
});

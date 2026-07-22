'use client';

import { createPublicClient, http, type Chain } from 'viem';

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

export const flareTransport = http(flareRpcUrl);

export const flarePublicClient = createPublicClient({
  chain: flare,
  transport: flareTransport,
});

'use client';

import { useEffect, useRef, useState } from 'react';
import SignClient from '@walletconnect/sign-client';
import type { Hex } from 'viem';

const XRPL_MAINNET_CHAIN_ID = 'xrpl:0';
const XRPL_NAMESPACE = 'xrpl';
const REQUIRED_METHODS = ['xrpl_signTransaction'];

const APP_METADATA = {
  name: 'Flare Vault Gateway',
  description: 'Use XRP wallets to access Flare carry and LP vaults through Flare Smart Accounts.',
  url: 'https://flaresummer.flareforward.com',
  icons: ['https://flaresummer.flareforward.com/images/flareforward.png'],
};

let signClientPromise: Promise<InstanceType<typeof SignClient>> | undefined;

async function getSignClient() {
  if (!signClientPromise) {
    const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    if (!projectId) {
      throw new Error('Bifrost connect is not configured (missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID).');
    }
    signClientPromise = SignClient.init({ projectId, metadata: APP_METADATA }).catch((err) => {
      signClientPromise = undefined;
      throw err;
    });
  }
  return signClientPromise;
}

function parseXrplAccount(caip10Account: string) {
  // CAIP-10 format: "xrpl:0:rExampleAddress..." -> "rExampleAddress..."
  return caip10Account.split(':').pop() || '';
}

export function useBifrostConnect() {
  const [account, setAccount] = useState<string | undefined>();
  const [topic, setTopic] = useState<string | undefined>();
  const [uri, setUri] = useState<string | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const restoreAttempted = useRef(false);

  useEffect(() => {
    if (restoreAttempted.current) return;
    restoreAttempted.current = true;
    (async () => {
      try {
        const client = await getSignClient();
        const sessions = client.session.getAll().filter((session) => session.namespaces[XRPL_NAMESPACE]?.accounts?.length);
        const existing = sessions[sessions.length - 1];
        if (existing) {
          const caip10Account = existing.namespaces[XRPL_NAMESPACE].accounts[0];
          setAccount(parseXrplAccount(caip10Account));
          setTopic(existing.topic);
        }
      } catch {
        // No project id configured yet, or no persisted session - user can still connect manually.
      }
    })();
  }, []);

  async function connect() {
    setError(undefined);
    setConnecting(true);
    setUri(undefined);
    try {
      const client = await getSignClient();
      const { uri: pairingUri, approval } = await client.connect({
        requiredNamespaces: {
          [XRPL_NAMESPACE]: {
            methods: REQUIRED_METHODS,
            chains: [XRPL_MAINNET_CHAIN_ID],
            events: [],
          },
        },
      });
      if (pairingUri) setUri(pairingUri);
      const session = await approval();
      const caip10Account = session.namespaces[XRPL_NAMESPACE]?.accounts?.[0];
      if (!caip10Account) throw new Error('Bifrost did not return an XRPL account.');
      setAccount(parseXrplAccount(caip10Account));
      setTopic(session.topic);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bifrost connection failed.');
    } finally {
      setConnecting(false);
      setUri(undefined);
    }
  }

  async function disconnect() {
    if (topic) {
      try {
        const client = await getSignClient();
        await client.disconnect({ topic, reason: { code: 6000, message: 'User disconnected.' } });
      } catch {
        // Session may already be gone on the wallet side - ignore.
      }
    }
    setAccount(undefined);
    setTopic(undefined);
    setUri(undefined);
    setError(undefined);
  }

  return { account, topic, uri, connecting, error, connect, disconnect };
}

type BifrostSignResponse = {
  tx_json?: {
    hash?: string;
    date?: number;
    ledger_index?: number;
  };
  hash?: string;
};

export async function signBifrostInstructionPayment(args: {
  topic: string;
  account: string;
  destination: string;
  amountDrops: string;
  memoHex: Hex;
}) {
  const client = await getSignClient();
  const response = await client.request<BifrostSignResponse>({
    topic: args.topic,
    chainId: XRPL_MAINNET_CHAIN_ID,
    request: {
      method: 'xrpl_signTransaction',
      params: {
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
        autofill: true,
        submit: true,
      },
    },
  });

  return {
    txid: response.hash || response.tx_json?.hash,
    ledgerIndex: response.tx_json?.ledger_index,
  };
}

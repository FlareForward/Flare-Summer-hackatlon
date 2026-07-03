export type XamanPayload = {
  uuid: string;
  deeplink?: string;
  qrPng?: string;
  websocketUrl?: string;
  pushed: boolean;
};

export type XamanPayloadStatus = {
  resolved: boolean;
  signed: boolean;
  cancelled: boolean;
  expired: boolean;
  txid?: string;
  account?: string;
};

async function readJsonOrThrow(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Xaman request failed (${response.status}).`);
  }
  return data;
}

export async function createXamanPayload(destination: string, amountDrops: string, memoHex: string): Promise<XamanPayload> {
  const response = await fetch('/api/xaman/payload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination, amountDrops, memoHex }),
  });
  return readJsonOrThrow(response);
}

export async function getXamanPayloadStatus(uuid: string): Promise<XamanPayloadStatus> {
  const response = await fetch(`/api/xaman/payload/${uuid}`);
  return readJsonOrThrow(response);
}

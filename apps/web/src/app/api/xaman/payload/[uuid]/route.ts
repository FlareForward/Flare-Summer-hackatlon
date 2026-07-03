import { NextResponse } from 'next/server';

const XAMAN_API_BASE = 'https://xumm.app/api/v1/platform/payload';

export async function GET(_request: Request, { params }: { params: Promise<{ uuid: string }> }) {
  const apiKey = process.env.XUMM_API_KEY;
  const apiSecret = process.env.XUMM_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'Xaman API credentials are not configured. Set XUMM_API_KEY and XUMM_API_SECRET on the server.' },
      { status: 500 },
    );
  }

  const { uuid } = await params;

  const xamanResponse = await fetch(`${XAMAN_API_BASE}/${uuid}`, {
    headers: {
      'X-API-Key': apiKey,
      'X-API-Secret': apiSecret,
    },
  });

  const data = await xamanResponse.json().catch(() => null);

  if (!xamanResponse.ok || !data?.meta) {
    return NextResponse.json({ error: data?.message || 'Unable to fetch payload status.' }, { status: xamanResponse.status || 502 });
  }

  return NextResponse.json({
    resolved: Boolean(data.meta.resolved),
    signed: Boolean(data.meta.signed),
    cancelled: Boolean(data.meta.cancelled),
    expired: Boolean(data.meta.expired),
    txid: data.response?.txid as string | undefined,
    account: data.response?.account as string | undefined,
  });
}

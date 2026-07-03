import { NextResponse } from 'next/server';

const XAMAN_API_BASE = 'https://xumm.app/api/v1/platform/payload';

export async function POST(request: Request) {
  const apiKey = process.env.XUMM_API_KEY;
  const apiSecret = process.env.XUMM_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'Xaman API credentials are not configured. Set XUMM_API_KEY and XUMM_API_SECRET on the server.' },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const destination = typeof body?.destination === 'string' ? body.destination : '';
  const amountDrops = typeof body?.amountDrops === 'string' ? body.amountDrops : '';
  const memoHex = typeof body?.memoHex === 'string' ? body.memoHex : '';

  if (!destination || !amountDrops || !memoHex) {
    return NextResponse.json({ error: 'destination, amountDrops, and memoHex are required.' }, { status: 400 });
  }

  const xamanResponse = await fetch(XAMAN_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'X-API-Secret': apiSecret,
    },
    body: JSON.stringify({
      txjson: {
        TransactionType: 'Payment',
        Destination: destination,
        Amount: amountDrops,
        Memos: [{ Memo: { MemoData: memoHex.replace(/^0x/, '').toUpperCase() } }],
      },
    }),
  });

  const data = await xamanResponse.json().catch(() => null);

  if (!xamanResponse.ok || !data?.uuid) {
    return NextResponse.json(
      { error: data?.error?.reference || data?.message || 'Xaman payload creation failed.' },
      { status: xamanResponse.status || 502 },
    );
  }

  return NextResponse.json({
    uuid: data.uuid,
    deeplink: data.next?.always,
    qrPng: data.refs?.qr_png,
    websocketUrl: data.refs?.websocket_status,
    pushed: Boolean(data.pushed),
  });
}

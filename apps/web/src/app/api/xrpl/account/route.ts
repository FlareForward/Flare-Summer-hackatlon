import { NextResponse } from 'next/server';

const XRPL_RPC_URL = process.env.XRPL_RPC_URL || process.env.NEXT_PUBLIC_XRPL_RPC_URL || 'https://s1.ripple.com:51234/';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const account = searchParams.get('account') || '';

  if (!account.startsWith('r')) {
    return NextResponse.json({ error: 'A valid XRPL account is required.' }, { status: 400 });
  }

  const xrplResponse = await fetch(XRPL_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'account_info',
      params: [{ account, ledger_index: 'validated' }],
    }),
  });

  const data = await xrplResponse.json().catch(() => null);
  if (data?.result?.error === 'actNotFound') {
    return NextResponse.json({ balanceDrops: '0' });
  }

  const balance = data?.result?.account_data?.Balance;
  if (!xrplResponse.ok || typeof balance !== 'string') {
    return NextResponse.json({ error: data?.result?.error_message || 'Unable to read XRPL account balance.' }, { status: 502 });
  }

  return NextResponse.json({ balanceDrops: balance });
}

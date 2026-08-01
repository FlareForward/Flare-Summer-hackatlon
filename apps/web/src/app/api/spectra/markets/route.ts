import { NextResponse } from 'next/server';
import { parseSpectraMarkets, SPECTRA_MARKETS_URL } from '@/lib/spectra/markets';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const response = await fetch(SPECTRA_MARKETS_URL, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Spectra API returned ${response.status}` }, { status: 502 });
    }

    const payload = await response.json();
    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      markets: parseSpectraMarkets(payload),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to fetch Spectra markets.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

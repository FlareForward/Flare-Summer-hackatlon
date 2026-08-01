import { getAddress, isAddress, type Address } from 'viem';

export const SPECTRA_FLARE_CHAIN_ID = 14;
export const MIN_SPECTRA_POOL_LIQUIDITY_USD = 100_000;
export const SPECTRA_MARKETS_URL = 'https://api.spectra.finance/v1/flare/pools';
export const SPECTRA_FXRP_UNDERLYING = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE' as const;

export type SpectraMarket = {
  pool: Address;
  pt: Address;
  ibt: Address;
  underlying: Address;
  name: string;
  symbol: string;
  maturityTs: number;
  liquidityUsd: number;
  ptPriceUnderlying: number;
  impliedApy: number;
  baseApy: number;
  decimals: number;
};

type SpectraApiObject = Record<string, unknown>;

function asObject(value: unknown): SpectraApiObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as SpectraApiObject) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObjectArray(value: unknown): SpectraApiObject[] {
  return asArray(value).reduce<SpectraApiObject[]>((items, item) => {
    const object = asObject(item);
    if (object) items.push(object);
    return items;
  }, []);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asAddress(value: unknown): Address | null {
  return typeof value === 'string' && isAddress(value) ? getAddress(value) : null;
}

function normalizeApy(value: number | null): number {
  if (value == null) return 0;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function nestedAddress(parent: SpectraApiObject | null, key: string): Address | null {
  const child = asObject(parent?.[key]);
  return asAddress(child?.address);
}

function nestedNumber(parent: SpectraApiObject | null, path: string[]): number | null {
  let current: unknown = parent;
  for (const key of path) {
    const object = asObject(current);
    if (!object) return null;
    current = object[key];
  }
  return asNumber(current);
}

function readMarkets(payload: unknown): SpectraApiObject[] {
  if (Array.isArray(payload)) return asObjectArray(payload);
  const object = asObject(payload);
  if (!object) return [];
  for (const key of ['markets', 'data', 'pools']) {
    const candidates = asObjectArray(object[key]);
    if (candidates.length > 0) return candidates;
  }
  return [];
}

function normalizePoolMarket(market: SpectraApiObject, pool: SpectraApiObject, nowTs: number): SpectraMarket | null {
  const chainId = asNumber(market.chainId ?? pool.chainId);
  const maturityTs = asNumber(market.maturity ?? market.maturityTs ?? market.expiry ?? pool.maturity);
  const liquidityUsd = nestedNumber(pool, ['liquidity', 'usd']) ?? asNumber(pool.liquidityUsd);
  const poolAddress = asAddress(pool.address ?? pool.pool);

  // Current Spectra API exposes the PT at top-level `market.address`; older shapes may nest it.
  const pt = nestedAddress(market, 'pt') ?? asAddress(market.address) ?? nestedAddress(pool, 'pt');
  const ibt = nestedAddress(market, 'ibt') ?? asAddress(market.ibt) ?? nestedAddress(pool, 'ibt');
  const underlying =
    nestedAddress(market, 'underlying') ??
    asAddress(market.underlying) ??
    nestedAddress(pool, 'underlying') ??
    ibt;

  if (
    chainId !== SPECTRA_FLARE_CHAIN_ID ||
    !maturityTs ||
    maturityTs <= nowTs ||
    liquidityUsd == null ||
    liquidityUsd < MIN_SPECTRA_POOL_LIQUIDITY_USD ||
    !poolAddress ||
    !pt ||
    !ibt ||
    !underlying ||
    underlying.toLowerCase() !== SPECTRA_FXRP_UNDERLYING.toLowerCase()
  ) {
    return null;
  }

  const impliedApy =
    asNumber(market.impliedApy) ??
    asNumber(market.impliedAPY) ??
    asNumber(pool.impliedApy) ??
    asNumber(pool.impliedAPY);
  const baseApy =
    asNumber(market.baseApy) ??
    asNumber(market.baseAPY) ??
    asNumber(pool.baseApy) ??
    asNumber(pool.baseAPY);

  return {
    pool: poolAddress,
    pt,
    ibt,
    underlying,
    name: String(market.name ?? pool.name ?? market.symbol ?? 'Spectra PT'),
    symbol: String(market.symbol ?? pool.symbol ?? 'PT'),
    maturityTs,
    liquidityUsd,
    ptPriceUnderlying:
      asNumber(market.ptPriceUnderlying) ??
      nestedNumber(market, ['pt', 'price', 'underlying']) ??
      nestedNumber(pool, ['pt', 'price', 'underlying']) ??
      asNumber(pool.ptPriceUnderlying) ??
      0,
    impliedApy: normalizeApy(impliedApy),
    baseApy: normalizeApy(baseApy),
    decimals:
      asNumber(market.decimals) ??
      nestedNumber(market, ['pt', 'decimals']) ??
      nestedNumber(pool, ['pt', 'decimals']) ??
      18,
  };
}

export function parseSpectraMarkets(payload: unknown, nowTs = Math.floor(Date.now() / 1000)): SpectraMarket[] {
  const markets = readMarkets(payload);
  const normalized = markets.flatMap((market) => {
    const pools = asObjectArray(market.pools);
    const poolLikeMarket = asAddress(market.pool ?? market.address) ? [market] : [];
    return (pools.length > 0 ? pools : poolLikeMarket)
      .map((pool) => normalizePoolMarket(market, pool, nowTs))
      .filter((marketResult): marketResult is SpectraMarket => Boolean(marketResult));
  });

  return normalized.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
}

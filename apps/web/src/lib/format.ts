import { formatUnits } from 'viem';

export function shortAddress(value?: string) {
  if (!value) return 'Not resolved';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function formatToken(value?: bigint, decimals = 6, symbol = '') {
  if (value === undefined) return '-';
  const raw = formatUnits(value, decimals);
  const [whole, fraction = ''] = raw.split('.');
  const trimmed = fraction.slice(0, 4).replace(/0+$/, '');
  return `${whole}${trimmed ? `.${trimmed}` : ''}${symbol ? ` ${symbol}` : ''}`;
}

export function isZeroAddress(value: string) {
  return value.toLowerCase() === '0x0000000000000000000000000000000000000000';
}

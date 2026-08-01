import { encodeFunctionData, type Address } from 'viem';
import { erc20Abi, spectraPoolAbi } from '@/config/abis';
import type { FsaCall } from '@/lib/fsa';
import type { SpectraMarket } from '@/lib/spectra/markets';
import type { SpectraTradeSide } from '@/lib/spectra/quotes';

export function buildSpectraTradeCalls(args: {
  market: SpectraMarket;
  side: SpectraTradeSide;
  amountIn: bigint;
  minimumReceived: bigint;
}): FsaCall[] {
  const tokenIn: Address = args.side === 'buy' ? args.market.ibt : args.market.pt;
  const approve = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [args.market.pool, args.amountIn],
  });
  const exchange = encodeFunctionData({
    abi: spectraPoolAbi,
    functionName: 'exchange',
    args: args.side === 'buy'
      ? [BigInt(0), BigInt(1), args.amountIn, args.minimumReceived]
      : [BigInt(1), BigInt(0), args.amountIn, args.minimumReceived],
  });

  return [
    {
      target: tokenIn,
      value: BigInt(0),
      data: approve,
      label: `Approve ${args.side === 'buy' ? 'stXRP' : 'PT'} for Spectra pool`,
    },
    {
      target: args.market.pool,
      value: BigInt(0),
      data: exchange,
      label: args.side === 'buy' ? 'Buy Spectra PT' : 'Sell Spectra PT',
    },
  ];
}

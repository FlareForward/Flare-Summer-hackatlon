import { encodeFunctionData, type Address } from 'viem';
import { erc20Abi, spectraPoolAbi, stakedXrpAbi } from '@/config/abis';
import { FXRP_ADDRESS } from '@/config/vaults';
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

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);

export function buildSpectraDirectMintBuyCalls(args: {
  market: SpectraMarket;
  fxrpAmount: bigint;
  stXrpAmount: bigint;
  minimumPtReceived: bigint;
  personalAccount: Address;
  fxrpAllowance: bigint;
  stXrpAllowance: bigint;
}): FsaCall[] {
  const stakeFxrp = encodeFunctionData({
    abi: stakedXrpAbi,
    functionName: 'deposit',
    args: [args.fxrpAmount, args.personalAccount],
  });
  const buyPt = encodeFunctionData({
    abi: spectraPoolAbi,
    functionName: 'exchange',
    args: [BigInt(0), BigInt(1), args.stXrpAmount, args.minimumPtReceived],
  });

  const calls: FsaCall[] = [];

  // Approve max once so repeat buys skip re-approval and stay small enough for a single inline memo.
  if (args.fxrpAllowance < args.fxrpAmount) {
    calls.push({
      target: FXRP_ADDRESS,
      value: BigInt(0),
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [args.market.ibt, MAX_UINT256] }),
      label: 'Approve FXRP for stXRP staking',
    });
  }
  calls.push({
    target: args.market.ibt,
    value: BigInt(0),
    data: stakeFxrp,
    label: 'Stake FXRP into stXRP',
  });
  if (args.stXrpAllowance < args.stXrpAmount) {
    calls.push({
      target: args.market.ibt,
      value: BigInt(0),
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [args.market.pool, MAX_UINT256] }),
      label: 'Approve stXRP for Spectra pool',
    });
  }
  calls.push({
    target: args.market.pool,
    value: BigInt(0),
    data: buyPt,
    label: 'Buy Spectra PT',
  });

  return calls;
}

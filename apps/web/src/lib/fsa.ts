import { encodeAbiParameters, encodeFunctionData, parseUnits, zeroAddress, type Address, type Hex } from 'viem';
import { carryVaultAbi, erc20Abi, erc4626VaultAbi, personalAccountAbi, swapRouterAbi } from '@/config/abis';
import { FXRP_ADDRESS, FXRP_USDT0_SWAP_ROUTER, USDT0_ADDRESS, type VaultConfig } from '@/config/vaults';

export type FsaCall = {
  target: Address;
  value: bigint;
  data: Hex;
  label: string;
};

export type CustomCall = {
  targetContract: Address;
  value: bigint;
  data: Hex;
};

export type XamanPaymentTemplate = {
  TransactionType: 'Payment';
  Destination: string;
  Amount: string;
  Memos: Array<{
    Memo: {
      MemoData: string;
    };
  }>;
};

const PACKED_USER_OPERATION_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'sender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'initCode', type: 'bytes' },
    { name: 'callData', type: 'bytes' },
    { name: 'accountGasLimits', type: 'bytes32' },
    { name: 'preVerificationGas', type: 'uint256' },
    { name: 'gasFees', type: 'bytes32' },
    { name: 'paymasterAndData', type: 'bytes' },
    { name: 'signature', type: 'bytes' },
  ],
} as const;

const ZERO_BYTES32 = `0x${'00'.repeat(32)}` as const;

export function buildDepositCalls(vault: VaultConfig, amount: string, personalAccount: Address): FsaCall[] {
  const assets = parseUnits(amount || '0', vault.assetDecimals);

  const approve = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [vault.address, assets],
  });

  const deposit =
    vault.depositMode === 'erc4626'
      ? encodeFunctionData({
          abi: erc4626VaultAbi,
          functionName: 'deposit',
          args: [assets, personalAccount],
        })
      : encodeFunctionData({
          abi: carryVaultAbi,
          functionName: 'deposit',
          args: [assets],
        });

  return [
    {
      target: vault.assetAddress,
      value: BigInt(0),
      data: approve,
      label: `Approve ${vault.asset}`,
    },
    {
      target: vault.address,
      value: BigInt(0),
      data: deposit,
      label: `Deposit into ${vault.name}`,
    },
  ];
}

/**
 * Withdrawal is wired for carry-style FXRP vaults: `requestWithdrawal(shares)` is a single
 * atomic call that burns shares and pays FXRP straight to the caller (the PersonalAccount).
 * ERC-4626 LP vaults still redeem in-kind and are intentionally not supported here.
 */
export function buildWithdrawCalls(vault: VaultConfig, shares: string): FsaCall[] {
  if (vault.depositMode !== 'erc20-vault') {
    throw new Error('Withdrawals are only wired up for carry-style FXRP vaults right now.');
  }
  const shareAmount = parseUnits(shares || '0', vault.shareDecimals);

  const withdraw = encodeFunctionData({
    abi: carryVaultAbi,
    functionName: 'requestWithdrawal',
    args: [shareAmount],
  });

  return [
    {
      target: vault.address,
      value: BigInt(0),
      data: withdraw,
      label: `Withdraw from ${vault.name}`,
    },
  ];
}

/** Pays out accrued USDT0 surplus to the PersonalAccount without withdrawing FXRP principal. */
export function buildClaimSurplusCalls(vault: VaultConfig): FsaCall[] {
  if (vault.depositMode !== 'erc20-vault') {
    throw new Error('Surplus claiming is only wired up for carry-style FXRP vaults right now.');
  }
  const claim = encodeFunctionData({
    abi: carryVaultAbi,
    functionName: 'claimSurplus',
  });

  return [
    {
      target: vault.address,
      value: BigInt(0),
      data: claim,
      label: `Claim USDT0 surplus from ${vault.name}`,
    },
  ];
}

/**
 * Swaps a known USDT0 amount into FXRP via the SparkDEX SwapRouter, sending the output back to
 * the PersonalAccount. `amountIn` must be an already-known, on-chain-read balance (not an
 * estimate), because the registered calldata is fixed.
 */
export function buildSwapUsdt0ToFxrpCalls(personalAccount: Address, amountIn: bigint, amountOutMinimum: bigint): FsaCall[] {
  const approve = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [FXRP_USDT0_SWAP_ROUTER, amountIn],
  });

  const swap = encodeFunctionData({
    abi: swapRouterAbi,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: USDT0_ADDRESS,
        tokenOut: FXRP_ADDRESS,
        deployer: zeroAddress,
        recipient: personalAccount,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        amountIn,
        amountOutMinimum,
        limitSqrtPrice: BigInt(0),
      },
    ],
  });

  return [
    {
      target: USDT0_ADDRESS,
      value: BigInt(0),
      data: approve,
      label: 'Approve USDT0 for swap',
    },
    {
      target: FXRP_USDT0_SWAP_ROUTER,
      value: BigInt(0),
      data: swap,
      label: 'Swap USDT0 -> FXRP',
    },
  ];
}

export function toCustomCalls(calls: FsaCall[]): CustomCall[] {
  return calls.map((call) => ({
    targetContract: call.target,
    value: call.value,
    data: call.data,
  }));
}

export function encodePackedUserOperation(args: {
  calls: FsaCall[];
  sender: Address;
  nonce: bigint;
}): Hex {
  const callData = encodeFunctionData({
    abi: personalAccountAbi,
    functionName: 'executeUserOp',
    args: [args.calls],
  });

  return encodeAbiParameters(
    [PACKED_USER_OPERATION_TUPLE],
    [
      {
        sender: args.sender,
        nonce: args.nonce,
        initCode: '0x',
        callData,
        accountGasLimits: ZERO_BYTES32,
        preVerificationGas: BigInt(0),
        gasFees: ZERO_BYTES32,
        paymasterAndData: '0x',
        signature: '0x',
      },
    ],
  );
}

export function buildMemoFieldUserOp(args: {
  calls: FsaCall[];
  sender: Address;
  nonce: bigint;
  walletId?: number;
  executorFeeUBA?: bigint;
}): Hex {
  const walletId = args.walletId ?? 0;
  if (!Number.isInteger(walletId) || walletId < 0 || walletId > 255) {
    throw new Error('walletId must fit in one byte.');
  }
  const executorFeeUBA = args.executorFeeUBA ?? BigInt(0);
  if (executorFeeUBA < BigInt(0) || executorFeeUBA > BigInt('0xffffffffffffffff')) {
    throw new Error('executorFeeUBA must fit in uint64.');
  }
  const packedUserOperation = encodePackedUserOperation(args).slice(2);
  const walletHex = walletId.toString(16).padStart(2, '0');
  const feeHex = executorFeeUBA.toString(16).padStart(16, '0');
  return `0xff${walletHex}${feeHex}${packedUserOperation}` as Hex;
}

export function computeDirectMintingPaymentDrops(args: {
  netMintDrops: bigint;
  feeBips: bigint;
  minimumFeeDrops: bigint;
  executorFeeDrops: bigint;
}): bigint {
  const proportionalFee = (args.netMintDrops * args.feeBips) / BigInt(10_000);
  const mintingFee = proportionalFee > args.minimumFeeDrops ? proportionalFee : args.minimumFeeDrops;
  return args.netMintDrops + mintingFee + args.executorFeeDrops;
}

/**
 * Payment reference layout (32 bytes): 0xff marker | walletId (1 byte) | callHash (30 bytes).
 * `callHash` is the bytes32 returned by MasterAccountController.encodeCustomInstruction,
 * which is pre-masked to 30 bytes (its top 2 bytes are always zero), so we drop them here.
 */
export function buildCustomInstructionReference(walletId: number, callHash: Hex): Hex {
  if (callHash.length !== 66) {
    throw new Error('callHash must be a 32-byte (bytes32) hex value.');
  }
  const walletHex = walletId.toString(16).padStart(2, '0');
  const truncatedHash = callHash.slice(6);
  return `0xff${walletHex}${truncatedHash}` as Hex;
}

export function buildXamanPaymentTemplate(
  operatorAddress: string,
  memoHex: Hex,
  amountDrops: string,
): XamanPaymentTemplate {
  return {
    TransactionType: 'Payment',
    Destination: operatorAddress || 'rOPERATOR_XRPL_ADDRESS_FROM_MASTER_ACCOUNT_CONTROLLER',
    Amount: amountDrops || '1',
    Memos: [
      {
        Memo: {
          MemoData: memoHex.replace(/^0x/, '').toUpperCase(),
        },
      },
    ],
  };
}

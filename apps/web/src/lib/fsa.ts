import { encodeFunctionData, parseUnits, type Address, type Hex } from 'viem';
import { carryVaultAbi, erc20Abi, erc4626VaultAbi } from '@/config/abis';
import type { VaultConfig } from '@/config/vaults';

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

export function buildDepositCalls(vault: VaultConfig, amount: string, personalAccount: Address): FsaCall[] {
  const assets = parseUnits(amount || '0', vault.asset === 'FXRP' ? 6 : 18);

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

export function toCustomCalls(calls: FsaCall[]): CustomCall[] {
  return calls.map((call) => ({
    targetContract: call.target,
    value: call.value,
    data: call.data,
  }));
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

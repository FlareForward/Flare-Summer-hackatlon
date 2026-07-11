import type { Address } from 'viem';

export type VaultKind = 'carry' | 'lp';
export type VaultDepositMode = 'erc20-vault' | 'erc4626';

export type VaultConfig = {
  id: string;
  name: string;
  token: string;
  kind: VaultKind;
  depositMode: VaultDepositMode;
  asset: 'FXRP' | 'WFLR';
  assetDecimals: number;
  shareDecimals: number;
  assetAddress: Address;
  address: Address;
  accent: string;
  range?: string;
  status: 'live' | 'candidate';
  supportsCarryWithdrawals?: boolean;
  summary: string;
};

export const FXRP_ADDRESS = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE' as const;
export const WFLR_ADDRESS = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d' as const;
export const USDT0_ADDRESS = '0xe7cd86e13AC4309349F30B3435a9d337750fC82D' as const;

// SparkDEX (Algebra Integral) FXRP/USDT0 pool + its SwapRouter. Verified on-chain: the router's
// factory() matches the pool's factory(), and the pool is the factory's default (non-custom) pool
// for this pair — see swapRouterAbi in abis.ts for the verification notes.
export const FXRP_USDT0_POOL = '0x927485d88a66253c63Af9163dca5f21c25A57393' as const;
export const FXRP_USDT0_SWAP_ROUTER = '0x69D57B9D705eaD73a5d2f2476C30c55bD755cc2F' as const;

export const VAULTS: VaultConfig[] = [
  {
    id: 'fxrp-carry',
    name: 'FXRP Carry Vault',
    token: 'cvFXRP',
    kind: 'carry',
    depositMode: 'erc20-vault',
    asset: 'FXRP',
    assetDecimals: 6,
    shareDecimals: 6,
    assetAddress: FXRP_ADDRESS,
    address: (process.env.NEXT_PUBLIC_CARRY_FXRP_VAULT || '0x8005380999F6024CBbAe0c82d616F6a801F437fB') as Address,
    accent: '#F4BC62',
    status: 'live',
    supportsCarryWithdrawals: true,
    summary: 'Posts FXRP collateral, borrows USDT0, and routes borrow liquidity into yield venues. User deposits and withdrawals stay FXRP-denominated.',
  },
  {
    id: 'carry-lp-fxrp-usdt0',
    name: 'FXRP/USDT0 LP Carry Vault',
    token: 'clpFXRP',
    kind: 'carry',
    depositMode: 'erc20-vault',
    asset: 'FXRP',
    assetDecimals: 6,
    shareDecimals: 6,
    assetAddress: FXRP_ADDRESS,
    address: (process.env.NEXT_PUBLIC_CARRY_FXRP_USDT0_LP_VAULT || '0x57efbbc0a8d33f9c859d0213de38d3a311658c97') as Address,
    accent: '#3FB7A4',
    range: '10%',
    status: 'live',
    supportsCarryWithdrawals: true,
    summary: 'Direct FXRP entry into the live carry LP vault. The keeper targets 40% LTV, swaps borrowed USDT0 through SparkDEX V4, and deploys into the Enosys FXRP/USDT0 10% leaf.',
  },
];

export const MASTER_ACCOUNT_CONTROLLER =
  (process.env.NEXT_PUBLIC_MASTER_ACCOUNT_CONTROLLER || '0x434936d47503353f06750Db1A444DBDC5F0AD37c') as Address;

export const FLARE_EXPLORER = 'https://flare-explorer.flare.network';

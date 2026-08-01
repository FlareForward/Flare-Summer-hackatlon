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
  leafLabel?: string;
  leafAddress?: Address;
  targetLtvBps?: number;
  lpRangeLowerPrice?: string;
  lpRangeUpperPrice?: string;
  status: 'live' | 'candidate';
  entryEnabled: boolean;
  readinessNote?: string;
  supportsCarryWithdrawals?: boolean;
  summary: string;
  opportunityApr: string;
  opportunityLabel: string;
  opportunityReason: string;
  riskLabel: string;
  riskSummary: string;
  bestFor: string;
  exit: string;
};

export const FXRP_ADDRESS = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE' as const;
export const WFLR_ADDRESS = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d' as const;
export const USDT0_ADDRESS = '0xe7cd86e13AC4309349F30B3435a9d337750fC82D' as const;

// SparkDEX (Algebra Integral) FXRP/USDT0 pool + its SwapRouter. Verified on-chain: the router's
// factory() matches the pool's factory(), and the pool is the factory's default pool for this pair.
export const FXRP_USDT0_POOL = '0x927485d88a66253c63Af9163dca5f21c25A57393' as const;
export const FXRP_USDT0_SWAP_ROUTER = '0x69D57B9D705eaD73a5d2f2476C30c55bD755cc2F' as const;

// ConcentratedLpVault.sol — the FXRP/USDT0 10% LP leaf. This is a single deployed contract that
// is enterable two ways: directly (plain deposit/redeemInKind, no leverage) or indirectly through
// the FXRP/USDT0 LP Carry Vault below, which borrows against it. Same leaf, two entry points.
export const FXRP_USDT0_LP_LEAF = '0xadb3f75c01eda514d476998f96523c1031dda25b' as const;

export const VAULTS: VaultConfig[] = [
  {
    id: 'lp-fxrp-usdt0',
    name: 'FXRP/USDT0 LP Vault',
    token: 'lp-FXUS-N',
    kind: 'lp',
    depositMode: 'erc4626',
    asset: 'FXRP',
    assetDecimals: 6,
    shareDecimals: 18,
    assetAddress: FXRP_ADDRESS,
    address: FXRP_USDT0_LP_LEAF,
    accent: '#7C9EF2',
    range: '10%',
    leafLabel: 'FXRP/USDT0 10% LP leaf',
    leafAddress: FXRP_USDT0_LP_LEAF,
    lpRangeLowerPrice: '1.0618',
    lpRangeUpperPrice: '1.1688',
    status: 'live',
    entryEnabled: true,
    readinessNote: 'Live — deposit FXRP directly into the FXRP/USDT0 pool. No borrowing involved.',
    supportsCarryWithdrawals: false,
    summary: 'Deposit FXRP straight into the FXRP/USDT0 pool — no borrowing, no leverage.',
    opportunityApr: 'LP fees only',
    opportunityLabel: 'LP fees',
    opportunityReason: 'Earns FXRP/USDT0 pool trading fees directly, without borrowing or leverage.',
    riskLabel: 'Lower',
    riskSummary: 'Only LP range and price movement risk — no borrowing, no liquidation risk.',
    bestFor: 'Users who want the LP position without taking on leverage.',
    exit: 'Withdraw as FXRP + USDT0 (redeemInKind)',
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
    address: (process.env.NEXT_PUBLIC_CARRY_FXRP_USDT0_LP_VAULT || '0x92613ec8058fbf6991f176a48cba2e2e7d8ba60c') as Address,
    accent: '#3FB7A4',
    range: '10%',
    leafLabel: 'FXRP/USDT0 10% LP leaf',
    leafAddress: FXRP_USDT0_LP_LEAF,
    targetLtvBps: 4000,
    lpRangeLowerPrice: '1.0618',
    lpRangeUpperPrice: '1.1688',
    status: 'live',
    entryEnabled: true,
    readinessNote: "Seeded and enabled for small D'CENT/Xaman Smart Account deposit tests.",
    supportsCarryWithdrawals: true,
    summary: 'A higher-touch strategy: the vault borrows USDT0, pairs it with FXRP exposure, and manages LP deployment for you.',
    opportunityApr: 'Est. 12-22%',
    opportunityLabel: 'Fees + carry',
    opportunityReason: 'Designed to stack LP trading fees with the carry trade when the FXRP/USDT0 pool is active.',
    riskLabel: 'Higher',
    riskSummary: 'Adds LP range and price movement risk on top of borrowing. Better upside, less beginner-safe than plain carry.',
    bestFor: 'Users who want more upside and accept more moving parts.',
    exit: 'Withdraw back to FXRP',
  },
];

export const MASTER_ACCOUNT_CONTROLLER =
  (process.env.NEXT_PUBLIC_MASTER_ACCOUNT_CONTROLLER || '0x434936d47503353f06750Db1A444DBDC5F0AD37c') as Address;

export const FLARE_CONTRACT_REGISTRY =
  (process.env.NEXT_PUBLIC_FLARE_CONTRACT_REGISTRY || '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019') as Address;

export const ASSET_MANAGER_FXRP =
  (process.env.NEXT_PUBLIC_ASSET_MANAGER_FXRP || '0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8') as Address;

export const FLARE_EXPLORER = 'https://flare-explorer.flare.network';

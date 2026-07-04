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
  assetAddress: Address;
  address: Address;
  accent: string;
  range?: string;
  status: 'live' | 'candidate';
  summary: string;
};

export const FXRP_ADDRESS = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE' as const;
export const WFLR_ADDRESS = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d' as const;

export const VAULTS: VaultConfig[] = [
  {
    id: 'fxrp-carry',
    name: 'FXRP Carry Vault',
    token: 'cvFXRP',
    kind: 'carry',
    depositMode: 'erc20-vault',
    asset: 'FXRP',
    assetAddress: FXRP_ADDRESS,
    address: (process.env.NEXT_PUBLIC_CARRY_FXRP_VAULT || '0x8005380999F6024CBbAe0c82d616F6a801F437fB') as Address,
    accent: '#F4BC62',
    status: 'live',
    summary: 'Posts FXRP collateral, borrows USDT0, and routes borrow liquidity into yield venues. User deposits and withdrawals stay FXRP-denominated.',
  },
  {
    id: 'lp-fxrp-wflr',
    name: 'FXRP/WFLR LP Vault',
    token: 'sdvLP-XW8',
    kind: 'lp',
    depositMode: 'erc4626',
    asset: 'FXRP',
    assetAddress: FXRP_ADDRESS,
    address: (process.env.NEXT_PUBLIC_LP_FXRP_WFLR_VAULT || '0x05b9ee17ebb2667ad56ca52279346756b5969aec') as Address,
    accent: '#22C55E',
    range: '8%',
    status: 'live',
    summary: 'Single-sided FXRP entry into a managed Enosys V3 FXRP/WFLR concentrated liquidity range.',
  },
  {
    id: 'lp-fxrp-usdt0-25',
    name: 'FXRP/USDT0 25% LP Candidate',
    token: 'sdvLP-XU25',
    kind: 'lp',
    depositMode: 'erc4626',
    asset: 'FXRP',
    assetAddress: FXRP_ADDRESS,
    address: (process.env.NEXT_PUBLIC_LP_FXRP_USDT0_25_VAULT || '0x0000000000000000000000000000000000000000') as Address,
    accent: '#7AA2FF',
    range: '25%',
    status: 'candidate',
    summary: 'Placeholder for a hackathon-specific wider FXRP/USDT0 LP vault. Deploy after the UI flow is ready.',
  },
];

export const MASTER_ACCOUNT_CONTROLLER =
  (process.env.NEXT_PUBLIC_MASTER_ACCOUNT_CONTROLLER || '0x434936d47503353f06750Db1A444DBDC5F0AD37c') as Address;

export const FLARE_EXPLORER = 'https://flare-explorer.flare.network';

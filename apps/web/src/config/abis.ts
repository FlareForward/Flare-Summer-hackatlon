export const erc20Abi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const customCallComponents = [
  { name: 'targetContract', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' },
] as const;

const personalAccountCallComponents = [
  { name: 'target', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' },
] as const;

export const masterAccountControllerAbi = [
  {
    type: 'function',
    name: 'getPersonalAccount',
    stateMutability: 'view',
    inputs: [{ name: 'xrplAddress', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getXrplProviderWallets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string[]' }],
  },
  {
    type: 'function',
    name: 'registerCustomInstruction',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'calls', type: 'tuple[]', components: customCallComponents }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'encodeCustomInstruction',
    stateMutability: 'view',
    inputs: [{ name: 'calls', type: 'tuple[]', components: customCallComponents }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getNonce',
    stateMutability: 'view',
    inputs: [{ name: 'personalAccount', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const personalAccountAbi = [
  {
    type: 'function',
    name: 'executeUserOp',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'calls', type: 'tuple[]', components: personalAccountCallComponents }],
    outputs: [],
  },
] as const;

export const assetManagerAbi = [
  {
    type: 'function',
    name: 'directMintingPaymentAddress',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'getDirectMintingExecutorFeeUBA',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getDirectMintingFeeBIPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getDirectMintingMinimumFeeUBA',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const carryVaultAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    // Single atomic call: burns `shares`, pays out pro-rata FXRP (collateralToken) plus any
    // accrued USDT0 surplus to msg.sender. There is no separate claim step on this contract.
    type: 'function',
    name: 'requestWithdrawal',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: 'requestId', type: 'uint256' }],
  },
  {
    // Pays out accrued USDT0 surplus to msg.sender without touching share balance / FXRP principal.
    type: 'function',
    name: 'claimSurplus',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ name: 'usdt0Paid', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalAssets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// SparkDEX (Algebra Integral) SwapRouter at 0x69D57B9D705eaD73a5d2f2476C30c55bD755cc2F.
// Verified on-chain: this router's factory() == the FXRP/USDT0 pool's factory(), and the
// factory's poolByPair(FXRP, USDT0) resolves to that exact pool, confirming `deployer` should
// be the zero address (the pool is the default/non-custom pool for this pair, not a plugin pool).
export const swapRouterAbi = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'deployer', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'limitSqrtPrice', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

// Minimal Algebra pool ABI, used only to read a live spot price for slippage protection.
export const algebraPoolAbi = [
  {
    type: 'function',
    name: 'globalState',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'price', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'lastFee', type: 'uint16' },
      { name: 'pluginConfig', type: 'uint8' },
      { name: 'communityFee', type: 'uint16' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
] as const;

export const erc4626VaultAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalAssets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'convertToAssets',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// Read-only surface of the carry vault used to compute a live net APR: current debt/LTV plus
// the Morpho market + lending-venue pointers needed to price the borrow/supply spread on chain.
// Mirrors CARRY_ONCHAIN_ABI in the STFLR VAULT dashboard (same vault contract).
export const carryVaultAprAbi = [
  { type: 'function', name: 'debt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ltvBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maxBorrowLtvBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
  { type: 'function', name: 'collateralValue', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'collateralToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'irm', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'oracle', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'lltv', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'marketId', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'venueCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalVenueAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'venueAssets', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'getVenue',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'kToken', type: 'address' },
          { name: 'comptroller', type: 'address' },
          { name: 'redeemable', type: 'bool' },
          { name: 'enabled', type: 'bool' },
          { name: 'maxAllocationBps', type: 'uint16' },
          { name: 'kind', type: 'uint8' },
        ],
      },
    ],
  },
] as const;

// Morpho Blue market accessor â€” vault's collateral/debt market lives here.
export const morphoMarketAbi = [
  {
    type: 'function',
    name: 'market',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'totalSupplyAssets', type: 'uint128' },
          { name: 'totalSupplyShares', type: 'uint128' },
          { name: 'totalBorrowAssets', type: 'uint128' },
          { name: 'totalBorrowShares', type: 'uint128' },
          { name: 'lastUpdate', type: 'uint128' },
          { name: 'fee', type: 'uint128' },
        ],
      },
    ],
  },
] as const;

// Morpho Blue interest-rate model â€” used to price the vault's current borrow rate.
export const irmBorrowRateAbi = [
  {
    type: 'function',
    name: 'borrowRateView',
    stateMutability: 'view',
    inputs: [
      {
        name: 'marketParams',
        type: 'tuple',
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
      },
      {
        name: 'market',
        type: 'tuple',
        components: [
          { name: 'totalSupplyAssets', type: 'uint128' },
          { name: 'totalSupplyShares', type: 'uint128' },
          { name: 'totalBorrowAssets', type: 'uint128' },
          { name: 'totalBorrowShares', type: 'uint128' },
          { name: 'lastUpdate', type: 'uint128' },
          { name: 'fee', type: 'uint128' },
        ],
      },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// kToken (Kinetic/Compound-style) lending venue â€” used to price the vault's supply rate.
export const ktokenSupplyRateAbi = [
  { type: 'function', name: 'supplyRatePerTimestamp', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

// kToken position accessors, used to size how much the vault has deployed into a given venue
// (shares * exchangeRateStored / 1e18), for vaults whose venueAssets() helper isn't deployed.
export const ktokenPositionAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'exchangeRateStored', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

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
] as const;

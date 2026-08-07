/**
 * Minimal ABI fragments for the Flare mainnet direct-mint executor. Signatures are copied
 * verbatim from apps/web/src/config/abis.ts (the frontend that already calls these contracts)
 * so the executor decodes/encodes exactly what SpectraTradePanel.tsx built.
 */

export const flareContractRegistryAbi = [
  {
    type: 'function',
    name: 'getContractAddressByName',
    stateMutability: 'view',
    inputs: [{ name: '_name', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export const fdcRequestFeeConfigurationsAbi = [
  {
    type: 'function',
    name: 'getRequestFee',
    stateMutability: 'view',
    inputs: [{ name: '_data', type: 'bytes' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const fdcHubAbi = [
  {
    type: 'function',
    name: 'requestAttestation',
    stateMutability: 'payable',
    inputs: [{ name: '_data', type: 'bytes' }],
    outputs: [],
  },
] as const

/**
 * getCurrentVotingEpochId() is read at the exact block the requestAttestation tx landed in, so
 * the FDC voting round id is derived on-chain instead of hardcoding a network's
 * firstVotingRoundStartTs/votingEpochDurationSeconds (those differ between Coston2 and mainnet).
 */
export const flareSystemsManagerAbi = [
  {
    type: 'function',
    name: 'getCurrentVotingEpochId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

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
    name: 'getNonce',
    stateMutability: 'view',
    inputs: [{ name: 'personalAccount', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const assetManagerDirectMintAbi = [
  {
    type: 'function',
    name: 'directMintingPaymentAddress',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'executeDirectMintingWithData',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'proof',
        type: 'tuple',
        components: [
          { name: 'merkleProof', type: 'bytes32[]' },
          {
            name: 'data',
            type: 'tuple',
            components: [
              { name: 'attestationType', type: 'bytes32' },
              { name: 'sourceId', type: 'bytes32' },
              { name: 'votingRound', type: 'uint64' },
              { name: 'lowestUsedTimestamp', type: 'uint64' },
              {
                name: 'requestBody',
                type: 'tuple',
                components: [
                  { name: 'transactionId', type: 'bytes32' },
                  { name: 'proofOwner', type: 'address' },
                ],
              },
              {
                name: 'responseBody',
                type: 'tuple',
                components: [
                  { name: 'blockNumber', type: 'uint64' },
                  { name: 'blockTimestamp', type: 'uint64' },
                  { name: 'sourceAddress', type: 'string' },
                  { name: 'sourceAddressHash', type: 'bytes32' },
                  { name: 'receivingAddressHash', type: 'bytes32' },
                  { name: 'intendedReceivingAddressHash', type: 'bytes32' },
                  { name: 'spentAmount', type: 'int256' },
                  { name: 'intendedSpentAmount', type: 'int256' },
                  { name: 'receivedAmount', type: 'int256' },
                  { name: 'intendedReceivedAmount', type: 'int256' },
                  { name: 'hasMemoData', type: 'bool' },
                  { name: 'firstMemoData', type: 'bytes' },
                  { name: 'hasDestinationTag', type: 'bool' },
                  { name: 'destinationTag', type: 'uint256' },
                  { name: 'status', type: 'uint8' },
                ],
              },
            ],
          },
        ],
      },
      { name: 'userOpBytes', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

export const erc20ApproveAbi = [
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
] as const

export const stakedXrpDepositAbi = [
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
] as const

export const spectraPoolAbi = [
  {
    type: 'function',
    name: 'coins',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'exchange',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'i', type: 'int128' },
      { name: 'j', type: 'int128' },
      { name: 'dx', type: 'uint256' },
      { name: 'min_dy', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  type AbiParameter,
  type Address,
  type Hex,
} from 'viem'
import { InvalidInputError, UserOperationHashMismatchError } from './errors.js'

/**
 * Trimmed from the Coston2 xrpl-rail package's memoBuilder.ts - keeps only the userOp
 * pack/unpack machinery the mainnet direct-mint executor needs (hash verification, decode).
 * The deposit-and-create-strategy call builders, StrategyParams, and 0xFE memo builder are
 * Coston2-deployment-specific and live only in apex-trading-platform/hackathon/xrpl-rail.
 */

type BigNumberish = bigint | number | string

export interface UserOperationCall {
  target: Address
  value: bigint
  data: Hex
}

export interface UserOperationCallInput {
  target: Address | string
  value?: BigNumberish
  data: Hex | string
}

export interface PackedUserOperation {
  sender: Address
  nonce: bigint
  initCode: Hex
  callData: Hex
  accountGasLimits: Hex
  preVerificationGas: bigint
  gasFees: Hex
  paymasterAndData: Hex
  signature: Hex
}

export interface PackedUserOperationOverrides {
  initCode?: Hex | string
  accountGasLimits?: Hex | string
  preVerificationGas?: BigNumberish
  gasFees?: Hex | string
  paymasterAndData?: Hex | string
  signature?: Hex | string
}

export interface BuildPackedUserOperationInput extends PackedUserOperationOverrides {
  sender: Address | string
  nonce: BigNumberish
  calls: readonly UserOperationCallInput[]
}

export interface BuildPackedUserOperationResult {
  calls: UserOperationCall[]
  userOp: PackedUserOperation
  userOpBytes: Hex
  userOpHash: Hex
}

const zeroBytes32 = `0x${'00'.repeat(32)}` as Hex

export const personalAccountAbi = parseAbi([
  'function executeUserOp((address target, uint256 value, bytes data)[] calls) external',
])

/**
 * EIP-4337 v0.7 PackedUserOperation as the Flare 0xFE memo commits it:
 * struct PackedUserOperation {
 *   address sender
 *   uint256 nonce
 *   bytes initCode
 *   bytes callData
 *   bytes32 accountGasLimits
 *   uint256 preVerificationGas
 *   bytes32 gasFees
 *   bytes paymasterAndData
 *   bytes signature
 * }
 */
export const packedUserOperationAbiParameters = [
  {
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
  },
] as const satisfies readonly AbiParameter[]

export function buildPackedUserOperation(input: BuildPackedUserOperationInput): BuildPackedUserOperationResult {
  const calls = normalizeCalls(input.calls)
  const userOp: PackedUserOperation = {
    sender: readAddress(input.sender, 'sender'),
    nonce: readUint(input.nonce, 'nonce'),
    initCode: readBytes(input.initCode ?? '0x', 'initCode'),
    callData: encodeExecuteUserOpCallData(calls),
    accountGasLimits: readBytes32(input.accountGasLimits ?? zeroBytes32, 'accountGasLimits'),
    preVerificationGas: readUint(input.preVerificationGas ?? 0n, 'preVerificationGas'),
    gasFees: readBytes32(input.gasFees ?? zeroBytes32, 'gasFees'),
    paymasterAndData: readBytes(input.paymasterAndData ?? '0x', 'paymasterAndData'),
    signature: readBytes(input.signature ?? '0x', 'signature'),
  }
  const userOpBytes = encodePackedUserOperation(userOp)
  const userOpHash = keccak256(userOpBytes)
  return {
    calls,
    userOp,
    userOpBytes,
    userOpHash,
  }
}

export function encodeExecuteUserOpCallData(calls: readonly UserOperationCallInput[]): Hex {
  const normalized = normalizeCalls(calls)
  return encodeFunctionData({
    abi: personalAccountAbi,
    functionName: 'executeUserOp',
    args: [normalized],
  })
}

export function encodePackedUserOperation(userOp: PackedUserOperation): Hex {
  return encodeAbiParameters(packedUserOperationAbiParameters, [userOp])
}

export function decodePackedUserOperation(userOpBytes: Hex): PackedUserOperation {
  const [decoded] = decodeAbiParameters(packedUserOperationAbiParameters, userOpBytes)
  const record = decoded as Record<string, unknown>
  return {
    sender: readAddress(record.sender, 'userOp.sender'),
    nonce: readUint(record.nonce as BigNumberish, 'userOp.nonce'),
    initCode: readBytes(record.initCode, 'userOp.initCode'),
    callData: readBytes(record.callData, 'userOp.callData'),
    accountGasLimits: readBytes32(record.accountGasLimits, 'userOp.accountGasLimits'),
    preVerificationGas: readUint(record.preVerificationGas as BigNumberish, 'userOp.preVerificationGas'),
    gasFees: readBytes32(record.gasFees, 'userOp.gasFees'),
    paymasterAndData: readBytes(record.paymasterAndData, 'userOp.paymasterAndData'),
    signature: readBytes(record.signature, 'userOp.signature'),
  }
}

export function decodeExecuteUserOpCalls(callData: Hex): UserOperationCall[] {
  const decoded = decodeFunctionData({
    abi: personalAccountAbi,
    data: callData,
  })
  if (decoded.functionName !== 'executeUserOp') {
    throw new InvalidInputError('userOp.callData', 'must call executeUserOp')
  }
  const [calls] = decoded.args
  return normalizeCalls(calls as readonly UserOperationCallInput[])
}

export function sumCallValues(calls: readonly UserOperationCall[]): bigint {
  return calls.reduce((total, call) => total + call.value, 0n)
}

export function assertUserOperationHash(userOpBytes: Hex, expectedHash: Hex): Hex {
  const actualHash = keccak256(userOpBytes)
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new UserOperationHashMismatchError(expectedHash, actualHash)
  }
  return actualHash
}

function normalizeCalls(calls: readonly UserOperationCallInput[]): UserOperationCall[] {
  if (!Array.isArray(calls) || calls.length === 0) {
    throw new InvalidInputError('calls', 'must contain at least one call')
  }

  return calls.map((call, index) => ({
    target: readAddress(call.target, `calls[${index}].target`),
    value: readUint(call.value ?? 0n, `calls[${index}].value`),
    data: readBytes(call.data, `calls[${index}].data`),
  }))
}

function readAddress(value: unknown, field: string): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new InvalidInputError(field, 'must be an EVM address')
  }
  return getAddress(value)
}

function readBytes(value: unknown, field: string): Hex {
  if (typeof value !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(value)) {
    throw new InvalidInputError(field, 'must be even-length hex bytes')
  }
  return value as Hex
}

function readBytes32(value: unknown, field: string): Hex {
  const hex = readBytes(value, field)
  if (hexByteLength(hex) !== 32) {
    throw new InvalidInputError(field, 'must be exactly 32 bytes')
  }
  return hex
}

function readUint(value: BigNumberish, field: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new InvalidInputError(field, 'must be non-negative')
    }
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new InvalidInputError(field, 'must be a non-negative safe integer')
    }
    return BigInt(value)
  }

  if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value.trim())) {
    const parsed = BigInt(value)
    if (parsed < 0n) {
      throw new InvalidInputError(field, 'must be non-negative')
    }
    return parsed
  }

  throw new InvalidInputError(field, 'must be a uint string, number, or bigint')
}

function hexByteLength(hex: Hex): number {
  return (hex.length - 2) / 2
}

import { decodeFunctionData, type Address, type Hex } from 'viem'
import {
  assertUserOperationHash,
  decodeExecuteUserOpCalls,
  decodePackedUserOperation,
  sumCallValues,
  type UserOperationCall,
} from './memoBuilder.js'
import {
  ExecutorClientFailureError,
  ExecutorTimeoutError,
  MintRecipientMismatchError,
  UserOperationNotRegisteredError,
  XrplRailError,
} from './errors.js'
import { CallNotAllowedError, TooManyCallsError } from './mainnetErrors.js'
import { carryVaultDepositAbi, erc20ApproveAbi, spectraPoolAbi, stakedXrpDepositAbi } from './abi.js'
import type { DirectMintChainClient, MainnetClientLogger } from './fdcClient.js'
import type { MainnetDirectMintConfig } from './config.js'

export type MainnetExecutorState = 'registered' | 'submitted' | 'error'

export interface MainnetExecutorRecord {
  attempts: number
  callValueSum: bigint
  calls: UserOperationCall[]
  error?: XrplRailError
  sender: Address
  state: MainnetExecutorState
  txHash?: Hex
  userOpBytes: Hex
  userOpHash: Hex
}

export interface RegisterMainnetUserOperationInput {
  userOpBytes: Hex
  userOpHash: Hex
  /** The Spectra pool address the frontend declared as `vault` in its POST body. */
  declaredVault: Address
}

export interface MainnetDirectMintExecutorOptions {
  client: DirectMintChainClient
  config: MainnetDirectMintConfig
  logger?: MainnetClientLogger
}

/** The subset of MainnetDirectMintExecutor that server.ts depends on - lets tests inject a fake. */
export interface DirectMintExecutorLike {
  registerUserOperation(input: RegisterMainnetUserOperationInput): Promise<MainnetExecutorRecord>
  getRecord(userOpHash: Hex): MainnetExecutorRecord | undefined
  runUntilSubmitted(userOpHash: Hex): Promise<MainnetExecutorRecord>
}

const MAX_CALLS = 4
const spectraAllowedAbi = [...erc20ApproveAbi, ...stakedXrpDepositAbi, ...spectraPoolAbi] as const
const erc4626VaultAllowedAbi = [...erc20ApproveAbi, ...stakedXrpDepositAbi] as const
const carryVaultAllowedAbi = [...erc20ApproveAbi, ...carryVaultDepositAbi] as const
const silentLogger: MainnetClientLogger = { info() {}, error() {} }

export class MainnetDirectMintExecutor implements DirectMintExecutorLike {
  private readonly client: DirectMintChainClient
  private readonly config: MainnetDirectMintConfig
  private readonly logger: MainnetClientLogger
  private readonly records = new Map<string, MainnetExecutorRecord>()

  constructor(options: MainnetDirectMintExecutorOptions) {
    this.client = options.client
    this.config = options.config
    this.logger = options.logger ?? silentLogger
  }

  /**
   * Verifies the hash, decodes the calls, and allow-lists every call before ever recording the
   * userOp. Registration fails closed: nothing is queued for the FDC/XRPL watch loop unless the
   * calls are exactly the FXRP-approve / stXRP-stake / Spectra-pool-exchange pattern this rail
   * exists to serve.
   */
  async registerUserOperation(input: RegisterMainnetUserOperationInput): Promise<MainnetExecutorRecord> {
    assertUserOperationHash(input.userOpBytes, input.userOpHash)
    const userOp = decodePackedUserOperation(input.userOpBytes)
    const calls = decodeExecuteUserOpCalls(userOp.callData)

    await this.assertCallsAreAllowed(calls, input.declaredVault, userOp.sender)

    const record: MainnetExecutorRecord = {
      attempts: 0,
      callValueSum: sumCallValues(calls),
      calls,
      sender: userOp.sender,
      state: 'registered',
      userOpBytes: input.userOpBytes,
      userOpHash: input.userOpHash,
    }
    this.records.set(input.userOpHash.toLowerCase(), record)
    this.logger.info('[direct-mint] registered userOp', { sender: record.sender, userOpHash: input.userOpHash })
    return cloneRecord(record)
  }

  getRecord(userOpHash: Hex): MainnetExecutorRecord | undefined {
    const record = this.records.get(userOpHash.toLowerCase())
    return record ? cloneRecord(record) : undefined
  }

  async pollOnce(userOpHash: Hex): Promise<MainnetExecutorRecord> {
    const record = this.requireRecord(userOpHash)
    if (record.state !== 'registered') {
      return cloneRecord(record)
    }

    record.attempts += 1
    let observation
    try {
      observation = await this.client.findMintingProof({ userOpHash: record.userOpHash })
    } catch (error) {
      return this.fail(record, wrapError('findMintingProof', error))
    }

    if (!observation) {
      return cloneRecord(record)
    }

    if (observation.recipient.toLowerCase() !== record.sender.toLowerCase()) {
      return this.fail(record, new MintRecipientMismatchError(record.sender, observation.recipient))
    }

    let txHash: Hex
    try {
      txHash = await this.client.submitExecuteDirectMintingWithData({
        data: record.userOpBytes,
        proof: observation.proof,
        value: record.callValueSum,
      })
    } catch (error) {
      return this.fail(record, wrapError('submitExecuteDirectMintingWithData', error))
    }

    record.state = 'submitted'
    record.txHash = txHash
    this.logger.info('[direct-mint] executeDirectMintingWithData submitted', {
      paymentId: observation.paymentId,
      txHash,
      userOpHash: record.userOpHash,
      value: record.callValueSum.toString(),
    })
    return cloneRecord(record)
  }

  async runUntilSubmitted(userOpHash: Hex): Promise<MainnetExecutorRecord> {
    let attempt = 0
    while (attempt < this.config.maxAttempts) {
      const record = await this.pollOnce(userOpHash)
      if (record.state === 'submitted' || record.state === 'error') {
        return record
      }
      if (attempt + 1 < this.config.maxAttempts) {
        await sleep(this.config.pollIntervalMs)
      }
      attempt += 1
    }

    const record = this.requireRecord(userOpHash)
    return this.fail(record, new ExecutorTimeoutError(record.userOpHash, this.config.maxAttempts))
  }

  private async assertCallsAreAllowed(calls: UserOperationCall[], declaredVault: Address, personalAccount: Address): Promise<void> {
    if (calls.length === 0 || calls.length > MAX_CALLS) {
      throw new TooManyCallsError(calls.length, MAX_CALLS)
    }

    const knownVaultKind = this.config.knownVaults.get(declaredVault.toLowerCase())

    let allowedTargets: Set<string>
    let allowedAbi: typeof spectraAllowedAbi | typeof erc4626VaultAllowedAbi | typeof carryVaultAllowedAbi
    let checkDepositReceiver: boolean

    if (knownVaultKind === 'erc4626') {
      allowedTargets = new Set([this.config.fxrpToken.toLowerCase(), declaredVault.toLowerCase()])
      allowedAbi = erc4626VaultAllowedAbi
      checkDepositReceiver = true
    } else if (knownVaultKind === 'carry') {
      allowedTargets = new Set([this.config.fxrpToken.toLowerCase(), declaredVault.toLowerCase()])
      allowedAbi = carryVaultAllowedAbi
      checkDepositReceiver = false
    } else {
      const ibt = await this.client.resolvePoolIbt(declaredVault)
      allowedTargets = new Set([this.config.fxrpToken.toLowerCase(), declaredVault.toLowerCase(), ibt.toLowerCase()])
      allowedAbi = spectraAllowedAbi
      checkDepositReceiver = true
    }

    calls.forEach((call, index) => {
      if (call.value !== 0n) {
        throw new CallNotAllowedError(index, 'non-zero call value is not allowed for the direct-mint flow')
      }
      if (!allowedTargets.has(call.target.toLowerCase())) {
        throw new CallNotAllowedError(index, `target ${call.target} is not an allow-listed target for this vault`)
      }

      let decoded
      try {
        decoded = decodeFunctionData({ abi: allowedAbi, data: call.data })
      } catch {
        throw new CallNotAllowedError(index, 'calldata does not match approve/deposit/exchange')
      }

      if (decoded.functionName === 'approve') {
        const [spender] = decoded.args as [Address, bigint]
        if (!allowedTargets.has(spender.toLowerCase())) {
          throw new CallNotAllowedError(index, `approve spender ${spender} is not an allow-listed target`)
        }
      }
      if (decoded.functionName === 'deposit' && checkDepositReceiver) {
        const [, receiver] = decoded.args as [bigint, Address]
        if (receiver.toLowerCase() !== personalAccount.toLowerCase()) {
          throw new CallNotAllowedError(index, `deposit receiver ${receiver} is not the registered PersonalAccount`)
        }
      }
    })
  }

  private requireRecord(userOpHash: Hex): MainnetExecutorRecord {
    const record = this.records.get(userOpHash.toLowerCase())
    if (!record) {
      throw new UserOperationNotRegisteredError(userOpHash)
    }
    return record
  }

  private fail(record: MainnetExecutorRecord, error: XrplRailError): MainnetExecutorRecord {
    record.state = 'error'
    record.error = error
    this.records.set(record.userOpHash.toLowerCase(), record)
    this.logger.error('[direct-mint] executor entered error state', {
      code: error.code,
      message: error.message,
      userOpHash: record.userOpHash,
    })
    return cloneRecord(record)
  }
}

function wrapError(action: string, error: unknown): XrplRailError {
  return error instanceof XrplRailError ? error : new ExecutorClientFailureError(action, error)
}

function cloneRecord(record: MainnetExecutorRecord): MainnetExecutorRecord {
  return { ...record, calls: record.calls.map((call) => ({ ...call })) }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

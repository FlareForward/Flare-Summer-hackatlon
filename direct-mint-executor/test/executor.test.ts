import { describe, expect, it } from 'vitest'
import { encodeFunctionData, getAddress, keccak256, stringToHex, type Address, type Hex } from 'viem'
import { buildPackedUserOperation, type UserOperationCallInput } from '../src/memoBuilder.js'
import {
  CallNotAllowedError,
  TooManyCallsError,
} from '../src/mainnetErrors.js'
import { UserOperationHashMismatchError, MintRecipientMismatchError, ExecutorTimeoutError } from '../src/errors.js'
import { carryVaultDepositAbi, erc20ApproveAbi, spectraPoolAbi, stakedXrpDepositAbi } from '../src/abi.js'
import { MainnetDirectMintExecutor } from '../src/executor.js'
import type { DirectMintChainClient, DirectMintingProof, MintingProofResult } from '../src/fdcClient.js'
import type { MainnetDirectMintConfig } from '../src/config.js'

const FXRP = addressFromLabel('fxrp-token')
const POOL = addressFromLabel('spectra-pool')
const IBT = addressFromLabel('spectra-ibt')
const SENDER = addressFromLabel('personal-account')
const OTHER = addressFromLabel('someone-else')
const LP_VAULT = addressFromLabel('concentrated-lp-vault')
const CARRY_VAULT = addressFromLabel('carry-trade-vault')

function addressFromLabel(label: string): Address {
  return getAddress(`0x${keccak256(stringToHex(label)).slice(-40)}`)
}

function approveCall(target: Address, spender: Address, amount = 1000n): UserOperationCallInput {
  return { target, value: 0n, data: encodeFunctionData({ abi: erc20ApproveAbi, functionName: 'approve', args: [spender, amount] }) }
}

function depositCall(receiver: Address, assets = 1000n): UserOperationCallInput {
  return { target: IBT, value: 0n, data: encodeFunctionData({ abi: stakedXrpDepositAbi, functionName: 'deposit', args: [assets, receiver] }) }
}

function exchangeCall(dx = 1000n, minDy = 1n): UserOperationCallInput {
  return { target: POOL, value: 0n, data: encodeFunctionData({ abi: spectraPoolAbi, functionName: 'exchange', args: [0n, 1n, dx, minDy] }) }
}

function validSpectraCalls(): UserOperationCallInput[] {
  return [approveCall(FXRP, IBT), depositCall(SENDER), approveCall(IBT, POOL), exchangeCall()]
}

function erc4626DepositCall(receiver: Address, assets = 1000n): UserOperationCallInput {
  return { target: LP_VAULT, value: 0n, data: encodeFunctionData({ abi: stakedXrpDepositAbi, functionName: 'deposit', args: [assets, receiver] }) }
}

function carryDepositCall(assets = 1000n): UserOperationCallInput {
  return { target: CARRY_VAULT, value: 0n, data: encodeFunctionData({ abi: carryVaultDepositAbi, functionName: 'deposit', args: [assets] }) }
}

function buildUserOp(calls: UserOperationCallInput[], nonce = 1n) {
  const { userOpBytes, userOpHash } = buildPackedUserOperation({ sender: SENDER, nonce, calls })
  return { userOpBytes, userOpHash }
}

class FakeClient implements DirectMintChainClient {
  ibt: Address = IBT
  observation: MintingProofResult | null = null
  submittedTxHash: Hex = ('0x' + 'aa'.repeat(32)) as Hex
  findMintingProofCalls = 0

  async resolvePoolIbt(): Promise<Address> {
    return this.ibt
  }

  async findMintingProof(): Promise<MintingProofResult | null> {
    this.findMintingProofCalls += 1
    return this.observation
  }

  async submitExecuteDirectMintingWithData(): Promise<Hex> {
    return this.submittedTxHash
  }
}

function fixtureConfig(overrides: Partial<MainnetDirectMintConfig> = {}): MainnetDirectMintConfig {
  return {
    rpcUrl: 'https://example.invalid/',
    flareContractRegistry: addressFromLabel('registry'),
    assetManagerFXRP: addressFromLabel('asset-manager'),
    fxrpToken: FXRP,
    masterAccountController: addressFromLabel('master-account-controller'),
    executorPrivateKey: `0x${'11'.repeat(32)}` as Hex,
    fdcVerifierBaseUrl: 'https://fdc-verifiers-mainnet.flare.network',
    fdcApiKey: 'test-key',
    daLayerBaseUrl: 'https://flr-data-availability.flare.network',
    fdcAttestationType: 'XRPPayment',
    fdcSourceId: 'XRP',
    xrplRpcUrl: 'https://xrplcluster.com/',
    maxAttempts: 3,
    pollIntervalMs: 1,
    httpPort: 8787,
    knownVaults: new Map(),
    ...overrides,
  }
}

const silentLogger = { info() {}, error() {} }

describe('MainnetDirectMintExecutor.registerUserOperation allow-list', () => {
  it('registers the canonical FXRP-approve / stake / approve / exchange call pattern', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig(), logger: silentLogger })
    const { userOpBytes, userOpHash } = buildUserOp(validSpectraCalls())

    const record = await executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: POOL })

    expect(record.state).toBe('registered')
    expect(record.sender).toBe(SENDER)
    expect(record.callValueSum).toBe(0n)
    expect(record.calls).toHaveLength(4)
  })

  it('rejects a userOp whose bytes do not hash to the declared userOpHash', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig(), logger: silentLogger })
    const { userOpBytes } = buildUserOp(validSpectraCalls())

    await expect(
      executor.registerUserOperation({ userOpBytes, userOpHash: `0x${'bb'.repeat(32)}` as Hex, declaredVault: POOL }),
    ).rejects.toBeInstanceOf(UserOperationHashMismatchError)
  })

  it('rejects more than the max allowed calls', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig(), logger: silentLogger })
    const calls = [...validSpectraCalls(), approveCall(FXRP, IBT)]
    const { userOpBytes, userOpHash } = buildUserOp(calls)

    await expect(executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: POOL })).rejects.toBeInstanceOf(TooManyCallsError)
  })

  it('rejects a call targeting a contract outside FXRP/pool/ibt', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig(), logger: silentLogger })
    const calls = [approveCall(OTHER, IBT)]
    const { userOpBytes, userOpHash } = buildUserOp(calls)

    await expect(executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: POOL })).rejects.toBeInstanceOf(CallNotAllowedError)
  })

  it('rejects calldata that is not approve/deposit/exchange', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig(), logger: silentLogger })
    const notAllowedSelector: UserOperationCallInput = { target: FXRP, value: 0n, data: '0xa9059cbb' }
    const { userOpBytes, userOpHash } = buildUserOp([notAllowedSelector])

    await expect(executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: POOL })).rejects.toBeInstanceOf(CallNotAllowedError)
  })

  it('rejects an approve whose spender is not an allow-listed target', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig(), logger: silentLogger })
    const calls = [approveCall(FXRP, OTHER)]
    const { userOpBytes, userOpHash } = buildUserOp(calls)

    await expect(executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: POOL })).rejects.toBeInstanceOf(CallNotAllowedError)
  })

  it('rejects a deposit whose receiver is not the registered PersonalAccount', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig(), logger: silentLogger })
    const calls = [depositCall(OTHER)]
    const { userOpBytes, userOpHash } = buildUserOp(calls)

    await expect(executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: POOL })).rejects.toBeInstanceOf(CallNotAllowedError)
  })

  it('rejects a call carrying non-zero value', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig(), logger: silentLogger })
    const calls: UserOperationCallInput[] = [{ ...approveCall(FXRP, IBT), value: 1n }]
    const { userOpBytes, userOpHash } = buildUserOp(calls)

    await expect(executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: POOL })).rejects.toBeInstanceOf(CallNotAllowedError)
  })
})

describe('MainnetDirectMintExecutor.registerUserOperation allow-list (erc4626 vault)', () => {
  function fixtureConfigWithLpVault(overrides: Partial<MainnetDirectMintConfig> = {}): MainnetDirectMintConfig {
    return fixtureConfig({ knownVaults: new Map([[LP_VAULT.toLowerCase(), 'erc4626']]), ...overrides })
  }

  it('registers a single-signature approve + deposit into a known erc4626 vault, with no ibt lookup', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfigWithLpVault(), logger: silentLogger })
    const calls = [approveCall(FXRP, LP_VAULT), erc4626DepositCall(SENDER)]
    const { userOpBytes, userOpHash } = buildUserOp(calls)

    const record = await executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: LP_VAULT })

    expect(record.state).toBe('registered')
    expect(record.calls).toHaveLength(2)
  })

  it('rejects a deposit whose receiver is not the registered PersonalAccount', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfigWithLpVault(), logger: silentLogger })
    const calls = [erc4626DepositCall(OTHER)]
    const { userOpBytes, userOpHash } = buildUserOp(calls)

    await expect(executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: LP_VAULT })).rejects.toBeInstanceOf(CallNotAllowedError)
  })

  it('rejects a call targeting a contract outside FXRP/the declared vault', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfigWithLpVault(), logger: silentLogger })
    const calls = [approveCall(FXRP, OTHER)]
    const { userOpBytes, userOpHash } = buildUserOp(calls)

    await expect(executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: LP_VAULT })).rejects.toBeInstanceOf(CallNotAllowedError)
  })
})

describe('MainnetDirectMintExecutor.registerUserOperation allow-list (carry vault)', () => {
  function fixtureConfigWithCarryVault(overrides: Partial<MainnetDirectMintConfig> = {}): MainnetDirectMintConfig {
    return fixtureConfig({ knownVaults: new Map([[CARRY_VAULT.toLowerCase(), 'carry']]), ...overrides })
  }

  it('registers a single-signature approve + deposit into a known carry vault (single-arg deposit)', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfigWithCarryVault(), logger: silentLogger })
    const calls = [approveCall(FXRP, CARRY_VAULT), carryDepositCall()]
    const { userOpBytes, userOpHash } = buildUserOp(calls)

    const record = await executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: CARRY_VAULT })

    expect(record.state).toBe('registered')
    expect(record.calls).toHaveLength(2)
  })

  it('rejects calldata that does not decode as approve/deposit for the carry vault', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfigWithCarryVault(), logger: silentLogger })
    const calls = [exchangeCall()]
    const { userOpBytes, userOpHash } = buildUserOp(calls)

    await expect(executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: CARRY_VAULT })).rejects.toBeInstanceOf(CallNotAllowedError)
  })

  it('rejects a call targeting a contract outside FXRP/the declared vault', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfigWithCarryVault(), logger: silentLogger })
    const calls = [approveCall(FXRP, OTHER)]
    const { userOpBytes, userOpHash } = buildUserOp(calls)

    await expect(executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: CARRY_VAULT })).rejects.toBeInstanceOf(CallNotAllowedError)
  })
})

describe('MainnetDirectMintExecutor poll/submit state machine', () => {
  function fixtureProof(): DirectMintingProof {
    return {
      merkleProof: [],
      data: {
        attestationType: `0x${'00'.repeat(32)}` as Hex,
        sourceId: `0x${'00'.repeat(32)}` as Hex,
        votingRound: 1n,
        lowestUsedTimestamp: 1n,
        requestBody: { transactionId: `0x${'00'.repeat(32)}` as Hex, proofOwner: OTHER },
        responseBody: {
          blockNumber: 1n,
          blockTimestamp: 1n,
          sourceAddress: 'rSourceAccount',
          sourceAddressHash: `0x${'00'.repeat(32)}` as Hex,
          receivingAddressHash: `0x${'00'.repeat(32)}` as Hex,
          intendedReceivingAddressHash: `0x${'00'.repeat(32)}` as Hex,
          spentAmount: 1n,
          intendedSpentAmount: 1n,
          receivedAmount: 1n,
          intendedReceivedAmount: 1n,
          hasMemoData: true,
          firstMemoData: '0x' as Hex,
          hasDestinationTag: false,
          destinationTag: 0n,
          status: 0,
        },
      },
    }
  }

  it('submits once a matching, recipient-correct proof is observed', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig(), logger: silentLogger })
    const { userOpBytes, userOpHash } = buildUserOp(validSpectraCalls())
    await executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: POOL })

    client.observation = { paymentId: 'txid-1', recipient: SENDER, proof: fixtureProof() }
    const record = await executor.pollOnce(userOpHash)

    expect(record.state).toBe('submitted')
    expect(record.txHash).toBe(client.submittedTxHash)
  })

  it('stays registered (keeps polling) while no observation is available', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig(), logger: silentLogger })
    const { userOpBytes, userOpHash } = buildUserOp(validSpectraCalls())
    await executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: POOL })

    const record = await executor.pollOnce(userOpHash)
    expect(record.state).toBe('registered')
    expect(record.attempts).toBe(1)
  })

  it('enters an error state when the observed recipient does not match the registered sender', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig(), logger: silentLogger })
    const { userOpBytes, userOpHash } = buildUserOp(validSpectraCalls())
    await executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: POOL })

    client.observation = { paymentId: 'txid-1', recipient: OTHER, proof: fixtureProof() }
    const record = await executor.pollOnce(userOpHash)

    expect(record.state).toBe('error')
    expect(record.error).toBeInstanceOf(MintRecipientMismatchError)
  })

  it('times out after maxAttempts with no observation', async () => {
    const client = new FakeClient()
    const executor = new MainnetDirectMintExecutor({ client, config: fixtureConfig({ maxAttempts: 2, pollIntervalMs: 1 }), logger: silentLogger })
    const { userOpBytes, userOpHash } = buildUserOp(validSpectraCalls())
    await executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault: POOL })

    const record = await executor.runUntilSubmitted(userOpHash)

    expect(record.state).toBe('error')
    expect(record.error).toBeInstanceOf(ExecutorTimeoutError)
    expect(client.findMintingProofCalls).toBe(2)
  })
})

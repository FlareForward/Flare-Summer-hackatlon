import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  pad,
  stringToHex,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  assetManagerDirectMintAbi,
  fdcHubAbi,
  fdcRequestFeeConfigurationsAbi,
  flareContractRegistryAbi,
  flareSystemsManagerAbi,
  masterAccountControllerAbi,
  spectraPoolAbi,
} from './abi.js'
import { FLARE_MAINNET_CHAIN_ID, type MainnetDirectMintConfig } from './config.js'
import { ExecutorClientFailureError } from './errors.js'
import { findXrplPaymentByUserOpHash } from './xrplWatcher.js'

export interface DirectMintingProof {
  merkleProof: Hex[]
  data: {
    attestationType: Hex
    sourceId: Hex
    votingRound: bigint
    lowestUsedTimestamp: bigint
    requestBody: {
      transactionId: Hex
      proofOwner: Address
    }
    responseBody: {
      blockNumber: bigint
      blockTimestamp: bigint
      sourceAddress: string
      sourceAddressHash: Hex
      receivingAddressHash: Hex
      intendedReceivingAddressHash: Hex
      spentAmount: bigint
      intendedSpentAmount: bigint
      receivedAmount: bigint
      intendedReceivedAmount: bigint
      hasMemoData: boolean
      firstMemoData: Hex
      hasDestinationTag: boolean
      destinationTag: bigint
      status: number
    }
  }
}

export interface MintingProofResult {
  paymentId: string
  recipient: Address
  proof: DirectMintingProof
}

export interface MainnetClientLogger {
  info(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

export interface MainnetDirectMintClientDeps {
  config: MainnetDirectMintConfig
  fetchImpl?: typeof fetch
  logger?: MainnetClientLogger
}

/**
 * The subset of MainnetDirectMintClient that MainnetDirectMintExecutor depends on. Exists so
 * tests can inject a fake client without satisfying the concrete class's private fields.
 */
export interface DirectMintChainClient {
  resolvePoolIbt(pool: Address): Promise<Address>
  findMintingProof(input: { userOpHash: Hex }): Promise<MintingProofResult | null>
  submitExecuteDirectMintingWithData(input: { data: Hex, proof: DirectMintingProof, value: bigint }): Promise<Hex>
}

interface FdcRequestState {
  abiEncodedRequest: Hex
  roundId?: bigint
  txHash: string
}

const silentLogger: MainnetClientLogger = { info() {}, error() {} }

export class MainnetDirectMintClient implements DirectMintChainClient {
  private readonly config: MainnetDirectMintConfig
  private readonly fetchImpl: typeof fetch
  private readonly logger: MainnetClientLogger
  private readonly publicClient
  private readonly walletClient
  private readonly account
  private fdcHubAddress?: Address
  private feeConfigAddress?: Address
  private flareSystemsManagerAddress?: Address
  private directMintingAddressCache?: string
  private readonly requestState = new Map<string, FdcRequestState>()

  constructor(deps: MainnetDirectMintClientDeps) {
    this.config = deps.config
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.logger = deps.logger ?? silentLogger
    this.account = privateKeyToAccount(this.config.executorPrivateKey)
    const chain = {
      id: FLARE_MAINNET_CHAIN_ID,
      name: 'Flare',
      nativeCurrency: { name: 'Flare', symbol: 'FLR', decimals: 18 },
      rpcUrls: { default: { http: [this.config.rpcUrl] } },
    } as const
    this.publicClient = createPublicClient({ chain, transport: http(this.config.rpcUrl) })
    this.walletClient = createWalletClient({ chain, transport: http(this.config.rpcUrl), account: this.account })
  }

  get executorAddress(): Address {
    return this.account.address
  }

  async resolvePersonalAccount(xrplAddress: string): Promise<Address> {
    return this.publicClient.readContract({
      address: this.config.masterAccountController,
      abi: masterAccountControllerAbi,
      functionName: 'getPersonalAccount',
      args: [xrplAddress],
    })
  }

  async getDirectMintingPaymentAddress(): Promise<string> {
    if (!this.directMintingAddressCache) {
      this.directMintingAddressCache = await this.publicClient.readContract({
        address: this.config.assetManagerFXRP,
        abi: assetManagerDirectMintAbi,
        functionName: 'directMintingPaymentAddress',
      })
    }
    return this.directMintingAddressCache
  }

  /** Reads a Spectra pool's coins(0) (its IBT, e.g. stXRP) directly on-chain for allow-listing. */
  async resolvePoolIbt(pool: Address): Promise<Address> {
    return this.publicClient.readContract({
      address: pool,
      abi: spectraPoolAbi,
      functionName: 'coins',
      args: [0n],
    })
  }

  /**
   * Looks for a matching XRPL payment, then drives it through the FDC verifier -> FdcHub ->
   * DA Layer pipeline (state checkpointed per userOpHash so repeat polls don't re-pay the
   * attestation fee). Returns null while any stage is still pending - callers should keep polling.
   */
  async findMintingProof(input: { userOpHash: Hex }): Promise<MintingProofResult | null> {
    const key = input.userOpHash.toLowerCase()
    let state = this.requestState.get(key)

    if (!state) {
      const destination = await this.getDirectMintingPaymentAddress()
      const match = await findXrplPaymentByUserOpHash(
        { rpcUrl: this.config.xrplRpcUrl, fetchImpl: this.fetchImpl },
        { destinationAddress: destination, expectedUserOpHash: input.userOpHash },
      )
      if (!match) return null
      this.logger.info('[direct-mint] observed matching XRPL payment', { txHash: match.txHash, userOpHash: input.userOpHash })

      const abiEncodedRequest = await this.prepareVerifierRequest(match.txHash)
      // XRPL RPC nodes and the FDC verifier do not always index a newly validated transaction at
      // the same time. Keep the job registered and retry instead of permanently stranding a
      // payment that the XRPL watcher has already confirmed.
      if (!abiEncodedRequest) return null
      state = { abiEncodedRequest, txHash: match.txHash }
      this.requestState.set(key, state)
    }

    if (state.roundId === undefined) {
      state.roundId = await this.payForAttestation(state.abiEncodedRequest)
      this.logger.info('[direct-mint] paid FDC attestation fee', { roundId: state.roundId.toString(), userOpHash: input.userOpHash })
    }

    const daResult = await this.pollDaLayerOnce(state.roundId, state.abiEncodedRequest)
    if (!daResult) return null

    const attestedTail = extractHashTail(daResult.data.responseBody.firstMemoData)
    if (attestedTail !== key.slice(2)) {
      throw new ExecutorClientFailureError('findMintingProof', new Error('attested memo does not match registered userOpHash'))
    }

    const recipient = await this.resolvePersonalAccount(daResult.data.responseBody.sourceAddress)

    return { paymentId: state.txHash, recipient, proof: daResult }
  }

  async submitExecuteDirectMintingWithData(input: {
    data: Hex
    proof: DirectMintingProof
    value: bigint
  }): Promise<Hex> {
    const calldata = encodeFunctionData({
      abi: assetManagerDirectMintAbi,
      functionName: 'executeDirectMintingWithData',
      args: [input.proof, input.data],
    })
    const hash = await this.walletClient.sendTransaction({
      account: this.account,
      chain: this.walletClient.chain,
      to: this.config.assetManagerFXRP,
      data: calldata,
      value: input.value,
    })
    await this.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  private async resolveRegistryAddress(name: string): Promise<Address> {
    return this.publicClient.readContract({
      address: this.config.flareContractRegistry,
      abi: flareContractRegistryAbi,
      functionName: 'getContractAddressByName',
      args: [name],
    })
  }

  private async prepareVerifierRequest(txId: string): Promise<Hex | null> {
    const url = buildVerifierRequestUrl(this.config.fdcVerifierBaseUrl, this.config.fdcAttestationType)
    const body = buildVerifierRequestBody({
      txId,
      proofOwner: this.account.address,
      attestationType: this.config.fdcAttestationType,
      sourceId: this.config.fdcSourceId,
    })
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.fdcApiKey },
      body: JSON.stringify(body),
    })
    const json = (await response.json().catch(() => null)) as { status?: string, abiEncodedRequest?: Hex } | null
    if (response.ok && isVerifierTransactionPending(json)) {
      this.logger.info('[direct-mint] verifier has not indexed XRPL transaction yet; retrying', { txHash: txId })
      return null
    }
    if (!response.ok || json?.status !== 'VALID' || !json.abiEncodedRequest) {
      throw new ExecutorClientFailureError('prepareVerifierRequest', new Error(`verifier rejected request: HTTP ${response.status} ${JSON.stringify(json)}`))
    }
    return json.abiEncodedRequest
  }

  private async payForAttestation(abiEncodedRequest: Hex): Promise<bigint> {
    if (!this.fdcHubAddress) this.fdcHubAddress = await this.resolveRegistryAddress('FdcHub')
    if (!this.feeConfigAddress) this.feeConfigAddress = await this.resolveRegistryAddress('FdcRequestFeeConfigurations')
    if (!this.flareSystemsManagerAddress) this.flareSystemsManagerAddress = await this.resolveRegistryAddress('FlareSystemsManager')

    const fee = await this.publicClient.readContract({
      address: this.feeConfigAddress,
      abi: fdcRequestFeeConfigurationsAbi,
      functionName: 'getRequestFee',
      args: [abiEncodedRequest],
    })

    const calldata = encodeFunctionData({ abi: fdcHubAbi, functionName: 'requestAttestation', args: [abiEncodedRequest] })
    const hash = await this.walletClient.sendTransaction({
      account: this.account,
      chain: this.walletClient.chain,
      to: this.fdcHubAddress,
      data: calldata,
      value: fee,
    })
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })

    // Read the voting round at the exact block the request landed in, rather than hardcoding a
    // network's firstVotingRoundStartTs/votingEpochDurationSeconds (those differ per network).
    return this.publicClient.readContract({
      address: this.flareSystemsManagerAddress,
      abi: flareSystemsManagerAbi,
      functionName: 'getCurrentVotingEpochId',
      blockNumber: receipt.blockNumber,
    })
  }

  private async pollDaLayerOnce(roundId: bigint, abiEncodedRequest: Hex): Promise<DirectMintingProof | null> {
    const url = buildDaLayerUrl(this.config.daLayerBaseUrl)
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.fdcApiKey },
      body: JSON.stringify({ votingRoundId: Number(roundId), requestBytes: abiEncodedRequest }),
    })
    if (!response.ok) return null
    const json = (await response.json().catch(() => null)) as DaLayerResponse | null
    return parseDaLayerProofResponse(json)
  }
}

/** The verifier can lag a validated XRPL node briefly; this response is not a terminal failure. */
export function isVerifierTransactionPending(json: { status?: string } | null): boolean {
  return json?.status?.toUpperCase().includes('TRANSACTION DOES NOT EXIST') ?? false
}

/** Exported for unit testing without spinning up a viem client - pure URL construction. */
export function buildVerifierRequestUrl(baseUrl: string, attestationType: string): string {
  return `${baseUrl.replace(/\/$/, '')}/verifier/xrp/${attestationType}/prepareRequest`
}

export function buildDaLayerUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/v1/fdc/proof-by-request-round`
}

export function buildVerifierRequestBody(params: {
  txId: string
  proofOwner: Address
  attestationType: string
  sourceId: string
}): { attestationType: Hex, sourceId: Hex, requestBody: { transactionId: string, proofOwner: Address } } {
  return {
    attestationType: stringToHex(params.attestationType, { size: 32 }),
    sourceId: stringToHex(params.sourceId, { size: 32 }),
    requestBody: {
      transactionId: params.txId.startsWith('0x') ? params.txId : `0x${params.txId}`,
      proofOwner: params.proofOwner,
    },
  }
}

/**
 * Maps a raw DA Layer proof-by-request-round response into the exact IXRPPayment.Proof shape
 * executeDirectMintingWithData expects. Field order mirrors scripts/fdc_live_executor.py's
 * proven-live PROOF_TYPE (apex-trading-platform) - a misordered field silently fails the
 * on-chain Merkle check.
 */
export function parseDaLayerProofResponse(json: DaLayerResponse | null): DirectMintingProof | null {
  if (!json?.response) return null
  const resp = json.response
  return {
    merkleProof: (json.proof ?? []).map((node) => pad(asHex(node), { size: 32 })),
    data: {
      attestationType: pad(asHex(resp.attestationType), { size: 32 }),
      sourceId: pad(asHex(resp.sourceId), { size: 32 }),
      votingRound: BigInt(resp.votingRound),
      lowestUsedTimestamp: BigInt(resp.lowestUsedTimestamp),
      requestBody: {
        transactionId: pad(asHex(resp.requestBody.transactionId), { size: 32 }),
        proofOwner: getAddress(resp.requestBody.proofOwner),
      },
      responseBody: {
        blockNumber: BigInt(resp.responseBody.blockNumber),
        blockTimestamp: BigInt(resp.responseBody.blockTimestamp),
        sourceAddress: resp.responseBody.sourceAddress,
        sourceAddressHash: pad(asHex(resp.responseBody.sourceAddressHash), { size: 32 }),
        receivingAddressHash: pad(asHex(resp.responseBody.receivingAddressHash), { size: 32 }),
        intendedReceivingAddressHash: pad(asHex(resp.responseBody.intendedReceivingAddressHash), { size: 32 }),
        spentAmount: BigInt(resp.responseBody.spentAmount),
        intendedSpentAmount: BigInt(resp.responseBody.intendedSpentAmount),
        receivedAmount: BigInt(resp.responseBody.receivedAmount),
        intendedReceivedAmount: BigInt(resp.responseBody.intendedReceivedAmount),
        hasMemoData: Boolean(resp.responseBody.hasMemoData),
        firstMemoData: asHex(resp.responseBody.firstMemoData ?? '0x'),
        hasDestinationTag: Boolean(resp.responseBody.hasDestinationTag),
        destinationTag: BigInt(resp.responseBody.destinationTag ?? 0),
        status: Number(resp.responseBody.status),
      },
    },
  }
}

export function extractHashTail(memoHex: Hex): string {
  const hex = memoHex.startsWith('0x') ? memoHex.slice(2) : memoHex
  return hex.slice(-64).toLowerCase()
}

function asHex(value: string): Hex {
  return (value.startsWith('0x') ? value : `0x${value}`) as Hex
}

export interface DaLayerResponse {
  response?: {
    attestationType: string
    sourceId: string
    votingRound: string | number
    lowestUsedTimestamp: string | number
    requestBody: { transactionId: string, proofOwner: string }
    responseBody: {
      blockNumber: string | number
      blockTimestamp: string | number
      sourceAddress: string
      sourceAddressHash: string
      receivingAddressHash: string
      intendedReceivingAddressHash: string
      spentAmount: string | number
      intendedSpentAmount: string | number
      receivedAmount: string | number
      intendedReceivedAmount: string | number
      hasMemoData: boolean
      firstMemoData: string
      hasDestinationTag: boolean
      destinationTag?: string | number
      status: string | number
    }
  }
  proof?: string[]
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { getAddress, keccak256, stringToHex, type Hex } from 'viem'
import { createServer } from '../src/server.js'
import { CallNotAllowedError } from '../src/mainnetErrors.js'
import type { DirectMintExecutorLike, MainnetExecutorRecord, RegisterMainnetUserOperationInput } from '../src/executor.js'

const SENDER = getAddress(`0x${keccak256(stringToHex('personal-account')).slice(-40)}`)
const VAULT = getAddress(`0x${keccak256(stringToHex('spectra-pool')).slice(-40)}`)
const silentLogger = { info() {}, error() {} }

class FakeExecutor implements DirectMintExecutorLike {
  registerCalls: RegisterMainnetUserOperationInput[] = []
  runUntilSubmittedCalls: Hex[] = []
  registerImpl: (input: RegisterMainnetUserOperationInput) => Promise<MainnetExecutorRecord> = async (input) => baseRecord(input)
  records = new Map<string, MainnetExecutorRecord>()

  async registerUserOperation(input: RegisterMainnetUserOperationInput): Promise<MainnetExecutorRecord> {
    this.registerCalls.push(input)
    const record = await this.registerImpl(input)
    this.records.set(record.userOpHash.toLowerCase(), record)
    return record
  }

  getRecord(userOpHash: Hex): MainnetExecutorRecord | undefined {
    return this.records.get(userOpHash.toLowerCase())
  }

  async runUntilSubmitted(userOpHash: Hex): Promise<MainnetExecutorRecord> {
    this.runUntilSubmittedCalls.push(userOpHash)
    const record = this.records.get(userOpHash.toLowerCase())
    if (!record) throw new Error('not registered')
    return record
  }
}

function baseRecord(input: RegisterMainnetUserOperationInput): MainnetExecutorRecord {
  return {
    attempts: 0,
    callValueSum: 0n,
    calls: [],
    sender: SENDER,
    state: 'registered',
    userOpBytes: input.userOpBytes,
    userOpHash: input.userOpHash,
  }
}

function validBody() {
  return {
    type: 'directMintUserOp',
    memo: `0x${'fe'.padEnd(84, '0')}`,
    packedUserOperation: `0x${'ab'.repeat(64)}`,
    userOpHash: `0x${'cd'.repeat(32)}`,
    sender: SENDER,
    nonce: '1',
    destination: 'rDestination',
    amountDrops: '1000000',
    vault: VAULT,
  }
}

describe('mainnet direct-mint HTTP server', () => {
  let executor: FakeExecutor
  let baseUrl: string
  let close: () => Promise<void>

  beforeEach(async () => {
    executor = new FakeExecutor()
    const server = createServer(executor, silentLogger)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as AddressInfo).port
    baseUrl = `http://127.0.0.1:${port}`
    close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  })

  afterEach(async () => {
    await close()
  })

  it('GET /health returns ok', async () => {
    const response = await fetch(`${baseUrl}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('GET /status with an unknown userOpHash returns 404', async () => {
    const response = await fetch(`${baseUrl}/status?userOpHash=0x${'00'.repeat(32)}`)
    expect(response.status).toBe(404)
  })

  it('GET /status with a malformed userOpHash returns 400', async () => {
    const response = await fetch(`${baseUrl}/status?userOpHash=not-hex`)
    expect(response.status).toBe(400)
  })

  it('unknown routes return 404', async () => {
    const response = await fetch(`${baseUrl}/nope`)
    expect(response.status).toBe(404)
  })

  it('rejects a POST body with the wrong type field', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody(), type: 'somethingElse' }),
    })
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.ok).toBe(false)
  })

  it('rejects a POST body missing required fields', async () => {
    const body = validBody() as Record<string, unknown>
    delete body.vault
    const response = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect(response.status).toBe(400)
  })

  it('registers a valid POST, returns 2xx immediately, and kicks off background polling', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    })
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(json.sender).toBe(SENDER)
    expect(executor.registerCalls).toHaveLength(1)
    expect(executor.registerCalls[0].declaredVault).toBe(VAULT)

    // runUntilSubmitted is fire-and-forget - give the microtask queue a tick to observe it fired.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(executor.runUntilSubmittedCalls).toHaveLength(1)
  })

  it('surfaces allow-list rejection as a 400 with the underlying error code', async () => {
    executor.registerImpl = async () => {
      throw new CallNotAllowedError(0, 'target not allowed')
    }
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    })
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe('INVALID_INPUT')
  })

  it('GET /status returns the record after registration', async () => {
    const body = validBody()
    await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const response = await fetch(`${baseUrl}/status?userOpHash=${body.userOpHash}`)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.state).toBe('registered')
    expect(json.sender).toBe(SENDER)
  })
})

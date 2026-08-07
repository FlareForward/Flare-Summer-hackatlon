import { describe, expect, it } from 'vitest'
import { getAddress, keccak256, stringToHex, type Address, type Hex } from 'viem'
import {
  buildDaLayerUrl,
  buildVerifierRequestBody,
  buildVerifierRequestUrl,
  extractHashTail,
  isVerifierTransactionPending,
  parseDaLayerProofResponse,
  type DaLayerResponse,
} from '../src/fdcClient.js'

function addressFromLabel(label: string): Address {
  return getAddress(`0x${keccak256(stringToHex(label)).slice(-40)}`)
}

const PROOF_OWNER = addressFromLabel('executor-key')

describe('buildVerifierRequestUrl / buildDaLayerUrl', () => {
  it('builds the mainnet XRP verifier path regardless of trailing slash', () => {
    expect(buildVerifierRequestUrl('https://fdc-verifiers-mainnet.flare.network', 'XRPPayment')).toBe(
      'https://fdc-verifiers-mainnet.flare.network/verifier/xrp/XRPPayment/prepareRequest',
    )
    expect(buildVerifierRequestUrl('https://fdc-verifiers-mainnet.flare.network/', 'XRPPayment')).toBe(
      'https://fdc-verifiers-mainnet.flare.network/verifier/xrp/XRPPayment/prepareRequest',
    )
  })

  it('builds the DA Layer proof endpoint regardless of trailing slash', () => {
    expect(buildDaLayerUrl('https://flr-data-availability.flare.network')).toBe(
      'https://flr-data-availability.flare.network/api/v1/fdc/proof-by-request-round',
    )
  })
})

describe('buildVerifierRequestBody', () => {
  it('right-pads attestationType/sourceId to bytes32 and 0x-prefixes the transaction id', () => {
    const body = buildVerifierRequestBody({
      txId: 'ABCDEF',
      proofOwner: PROOF_OWNER,
      attestationType: 'XRPPayment',
      sourceId: 'XRP',
    })
    expect(body.attestationType).toBe(`0x${Buffer.from('XRPPayment').toString('hex')}${'0'.repeat(64 - Buffer.from('XRPPayment').toString('hex').length)}`)
    expect(body.sourceId).toBe(`0x${Buffer.from('XRP').toString('hex')}${'0'.repeat(64 - Buffer.from('XRP').toString('hex').length)}`)
    expect(body.requestBody.transactionId).toBe('0xABCDEF')
    expect(body.requestBody.proofOwner).toBe(PROOF_OWNER)
  })

  it('leaves an already 0x-prefixed transaction id untouched', () => {
    const body = buildVerifierRequestBody({
      txId: '0xABCDEF',
      proofOwner: PROOF_OWNER,
      attestationType: 'XRPPayment',
      sourceId: 'XRP',
    })
    expect(body.requestBody.transactionId).toBe('0xABCDEF')
  })
})

describe('isVerifierTransactionPending', () => {
  it('classifies verifier indexing lag as retryable', () => {
    expect(isVerifierTransactionPending({ status: 'INVALID: TRANSACTION DOES NOT EXIST' })).toBe(true)
  })

  it('does not hide other invalid verifier responses', () => {
    expect(isVerifierTransactionPending({ status: 'INVALID: MALFORMED REQUEST' })).toBe(false)
    expect(isVerifierTransactionPending(null)).toBe(false)
  })
})

describe('extractHashTail', () => {
  it('extracts the last 32 bytes of a 0xfe memo as the userOpHash', () => {
    const userOpHash = keccak256(stringToHex('some userOp bytes')) as Hex
    const memo = `0xfe00${'00'.repeat(8)}${userOpHash.slice(2)}` as Hex
    expect(extractHashTail(memo)).toBe(userOpHash.slice(2).toLowerCase())
  })
})

describe('parseDaLayerProofResponse', () => {
  const userOpHash = keccak256(stringToHex('some userOp bytes')) as Hex

  function fixtureResponse(): DaLayerResponse {
    return {
      proof: ['0xaa'.padEnd(66, '0'), '0xbb'.padEnd(66, '0')],
      response: {
        attestationType: `0x${Buffer.from('XRPPayment').toString('hex')}`,
        sourceId: `0x${Buffer.from('XRP').toString('hex')}`,
        votingRound: '123456',
        lowestUsedTimestamp: '1700000000',
        requestBody: {
          transactionId: '0xabcdef',
          proofOwner: PROOF_OWNER,
        },
        responseBody: {
          blockNumber: '1000',
          blockTimestamp: '1700000001',
          sourceAddress: 'rSourceAccount',
          sourceAddressHash: '0x01',
          receivingAddressHash: '0x02',
          intendedReceivingAddressHash: '0x03',
          spentAmount: '1000000',
          intendedSpentAmount: '1000000',
          receivedAmount: '999000',
          intendedReceivedAmount: '999000',
          hasMemoData: true,
          firstMemoData: `0xfe00${'00'.repeat(8)}${userOpHash.slice(2)}`,
          hasDestinationTag: false,
          destinationTag: '0',
          status: '0',
        },
      },
    }
  }

  it('returns null when the response has no `response` field (not finalized yet)', () => {
    expect(parseDaLayerProofResponse({})).toBeNull()
    expect(parseDaLayerProofResponse(null)).toBeNull()
  })

  it('maps a finalized DA Layer response into the executeDirectMintingWithData proof shape', () => {
    const proof = parseDaLayerProofResponse(fixtureResponse())
    expect(proof).not.toBeNull()
    expect(proof?.merkleProof).toHaveLength(2)
    expect(proof?.data.votingRound).toBe(123456n)
    expect(proof?.data.responseBody.sourceAddress).toBe('rSourceAccount')
    expect(proof?.data.responseBody.receivedAmount).toBe(999000n)
    expect(extractHashTail(proof!.data.responseBody.firstMemoData)).toBe(userOpHash.slice(2).toLowerCase())
  })
})

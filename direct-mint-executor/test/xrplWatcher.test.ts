import { describe, expect, it, vi } from 'vitest'
import { keccak256, stringToHex, type Hex } from 'viem'
import { findXrplPaymentByUserOpHash } from '../src/xrplWatcher.js'

function accountTxResponse(transactions: unknown[]) {
  return {
    ok: true,
    json: async () => ({ result: { transactions } }),
  } as Response
}

function paymentEntry(opts: { memoHex: string, result?: string, account?: string, hash?: string }) {
  return {
    tx: {
      TransactionType: 'Payment',
      Account: opts.account ?? 'rSourceAccount',
      hash: opts.hash ?? 'ABCDEF',
      ledger_index: 100,
      Amount: '1000000',
      Memos: [{ Memo: { MemoData: opts.memoHex } }],
    },
    meta: { TransactionResult: opts.result ?? 'tesSUCCESS', delivered_amount: '1000000' },
  }
}

describe('findXrplPaymentByUserOpHash', () => {
  const userOpHash = keccak256(stringToHex('some userOp bytes')) as Hex
  const memoHex = `fe00${'00'.repeat(8)}${userOpHash.slice(2)}` // 0xfe | walletId | fee(8) | hash(32)

  it('finds a successful payment whose 0xfe memo tail matches the userOpHash', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(accountTxResponse([paymentEntry({ memoHex })]))
    const match = await findXrplPaymentByUserOpHash(
      { rpcUrl: 'https://example.invalid/', fetchImpl },
      { destinationAddress: 'rDest', expectedUserOpHash: userOpHash },
    )
    expect(match).toEqual({ txHash: 'ABCDEF', sourceAddress: 'rSourceAccount', ledgerIndex: 100, deliveredDrops: '1000000' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('ignores a failed payment even if the memo matches', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(accountTxResponse([paymentEntry({ memoHex, result: 'tecPATH_DRY' })]))
    const match = await findXrplPaymentByUserOpHash(
      { rpcUrl: 'https://example.invalid/', fetchImpl },
      { destinationAddress: 'rDest', expectedUserOpHash: userOpHash },
    )
    expect(match).toBeNull()
  })

  it('ignores a payment whose memo hash does not match', async () => {
    const otherHash = keccak256(stringToHex('a different userOp')) as Hex
    const mismatchedMemo = `fe00${'00'.repeat(8)}${otherHash.slice(2)}`
    const fetchImpl = vi.fn().mockResolvedValue(accountTxResponse([paymentEntry({ memoHex: mismatchedMemo })]))
    const match = await findXrplPaymentByUserOpHash(
      { rpcUrl: 'https://example.invalid/', fetchImpl },
      { destinationAddress: 'rDest', expectedUserOpHash: userOpHash },
    )
    expect(match).toBeNull()
  })

  it('ignores memos that are not the 0xfe hash-committed format', async () => {
    const inlineMemo = 'ff00aabbccdd'
    const fetchImpl = vi.fn().mockResolvedValue(accountTxResponse([paymentEntry({ memoHex: inlineMemo })]))
    const match = await findXrplPaymentByUserOpHash(
      { rpcUrl: 'https://example.invalid/', fetchImpl },
      { destinationAddress: 'rDest', expectedUserOpHash: userOpHash },
    )
    expect(match).toBeNull()
  })

  it('returns null when no transactions are present', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(accountTxResponse([]))
    const match = await findXrplPaymentByUserOpHash(
      { rpcUrl: 'https://example.invalid/', fetchImpl },
      { destinationAddress: 'rDest', expectedUserOpHash: userOpHash },
    )
    expect(match).toBeNull()
  })

  it('throws when the RPC endpoint returns a non-OK HTTP status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response)
    await expect(
      findXrplPaymentByUserOpHash(
        { rpcUrl: 'https://example.invalid/', fetchImpl },
        { destinationAddress: 'rDest', expectedUserOpHash: userOpHash },
      ),
    ).rejects.toThrow(/HTTP 503/)
  })
})

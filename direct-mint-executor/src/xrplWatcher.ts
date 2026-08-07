import type { Hex } from 'viem'
import { InvalidInputError } from './errors.js'

export interface XrplTxMemoMatch {
  txHash: string
  sourceAddress: string
  ledgerIndex: number
  deliveredDrops: string
}

export interface XrplWatcherDeps {
  rpcUrl: string
  fetchImpl?: typeof fetch
}

export interface FindXrplPaymentParams {
  destinationAddress: string
  expectedUserOpHash: Hex
  ledgerIndexMin?: number
}

/**
 * Scans recent transactions to `destinationAddress` for a successful Payment whose memo is a
 * 42-byte 0xFE reference (0xfe | walletId | executorFeeUBA(8) | userOpHash(32)) carrying
 * `expectedUserOpHash` in its last 32 bytes. Uses the public XRPL JSON-RPC `account_tx` method
 * with classic (api_version 1) field names.
 */
export async function findXrplPaymentByUserOpHash(
  deps: XrplWatcherDeps,
  params: FindXrplPaymentParams,
): Promise<XrplTxMemoMatch | null> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const requestBody = {
    method: 'account_tx',
    params: [
      {
        account: params.destinationAddress,
        ledger_index_min: params.ledgerIndexMin ?? -1,
        ledger_index_max: -1,
        limit: 50,
        forward: false,
        api_version: 1,
      },
    ],
  }

  const response = await fetchImpl(deps.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  if (!response.ok) {
    throw new InvalidInputError('xrplRpcUrl', `account_tx request failed with HTTP ${response.status}`)
  }

  const payload = await response.json() as XrplAccountTxResponse
  const transactions = payload?.result?.transactions ?? []
  const expectedTail = params.expectedUserOpHash.slice(2).toLowerCase()

  for (const entry of transactions) {
    const tx = entry.tx
    if (!tx || tx.TransactionType !== 'Payment' || !tx.hash || !tx.Account) continue
    if (entry.meta?.TransactionResult !== 'tesSUCCESS') continue

    const memoHex = tx.Memos?.[0]?.Memo?.MemoData
    if (!memoHex) continue
    const normalized = memoHex.toLowerCase()
    if (normalized.length !== 84 || !normalized.startsWith('fe')) continue // 42 bytes = 84 hex chars

    const tail = normalized.slice(20) // bytes 10..41 = userOpHash, hex char offset 2*10
    if (tail !== expectedTail) continue

    return {
      txHash: tx.hash,
      sourceAddress: tx.Account,
      ledgerIndex: tx.ledger_index ?? -1,
      deliveredDrops: String(entry.meta?.delivered_amount ?? tx.Amount ?? '0'),
    }
  }

  return null
}

interface XrplAccountTxResponse {
  result?: {
    transactions?: Array<{
      tx?: {
        TransactionType?: string
        Account?: string
        hash?: string
        ledger_index?: number
        Amount?: string
        Memos?: Array<{ Memo?: { MemoData?: string } }>
      }
      meta?: {
        TransactionResult?: string
        delivered_amount?: string
      }
    }>
  }
}

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isAddress, isHex, getAddress, type Address, type Hex } from 'viem'
import { messageOf, XrplRailError } from './errors.js'
import { MainnetDirectMintExecutor, type DirectMintExecutorLike } from './executor.js'
import { MainnetDirectMintClient, type MainnetClientLogger } from './fdcClient.js'
import { readMainnetConfigFromEnv, type MainnetDirectMintConfig } from './config.js'

const MAX_BODY_BYTES = 64 * 1024

export function createServer(executor: DirectMintExecutorLike, logger: MainnetClientLogger) {
  return createHttpServer((req, res) => {
    handleRequest(req, res, executor, logger).catch((error) => {
      logger.error('[direct-mint] unhandled request error', { message: messageOf(error) })
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, code: 'INTERNAL_ERROR', message: 'Unexpected server error' })
      }
    })
  })
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, executor: DirectMintExecutorLike, logger: MainnetClientLogger): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  // This endpoint is called directly from the browser (SpectraTradePanel.tsx), which is always a
  // different origin than the executor's own host - the browser needs an explicit CORS grant or
  // the preflight fails before any of the routes below ever run. No cookies/session state are
  // used here (every request is validated by hash + allow-list on content, not by caller
  // identity), so a wildcard origin doesn't weaken anything this server actually protects.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    const userOpHash = url.searchParams.get('userOpHash')
    if (!userOpHash || !isHex(userOpHash) || hexByteLength(userOpHash) !== 32) {
      sendJson(res, 400, { ok: false, code: 'INVALID_INPUT', field: 'userOpHash', message: 'userOpHash must be a 32-byte hex query param' })
      return
    }
    const record = executor.getRecord(userOpHash as Hex)
    if (!record) {
      sendJson(res, 404, { ok: false, code: 'USER_OP_NOT_REGISTERED', message: 'no record for this userOpHash' })
      return
    }
    sendJson(res, 200, {
      ok: true,
      state: record.state,
      attempts: record.attempts,
      sender: record.sender,
      txHash: record.txHash,
      error: record.error ? { code: record.error.code, message: record.error.message } : undefined,
    })
    return
  }

  if (req.method !== 'POST' || url.pathname !== '/') {
    sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: 'unknown route' })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, code: 'INVALID_INPUT', field: 'body', message: messageOf(error) })
    return
  }

  if (!isRecord(body)) {
    sendJson(res, 400, { ok: false, code: 'INVALID_INPUT', field: 'body', message: 'request body must be a JSON object' })
    return
  }

  if (body.type !== 'directMintUserOp') {
    sendJson(res, 400, { ok: false, code: 'INVALID_INPUT', field: 'type', message: 'type must be "directMintUserOp"' })
    return
  }

  let userOpBytes: Hex
  let userOpHash: Hex
  let declaredVault: Address
  try {
    userOpBytes = readHex(body, 'packedUserOperation')
    userOpHash = readHex(body, 'userOpHash')
    if (hexByteLength(userOpHash) !== 32) throw new Error('userOpHash must be 32 bytes')
    declaredVault = readAddress(body, 'vault')
  } catch (error) {
    sendJson(res, 400, { ok: false, code: 'INVALID_INPUT', message: messageOf(error) })
    return
  }

  let record
  try {
    record = await executor.registerUserOperation({ userOpBytes, userOpHash, declaredVault })
  } catch (error) {
    const typed = error instanceof XrplRailError ? error : undefined
    logger.error('[direct-mint] registration rejected', { message: messageOf(error), userOpHash })
    sendJson(res, 400, {
      ok: false,
      code: typed?.code ?? 'INVALID_INPUT',
      field: typed?.field,
      message: messageOf(error),
    })
    return
  }

  sendJson(res, 200, { ok: true, userOpHash: record.userOpHash, sender: record.sender })

  // Fire-and-forget: the frontend already got its 2xx and will now sign the XRPL payment. The
  // XRPL payment doesn't exist yet at this point, so watching for it has to happen in the
  // background regardless of how long it takes.
  executor.runUntilSubmitted(record.userOpHash).catch((error) => {
    logger.error('[direct-mint] runUntilSubmitted threw', { message: messageOf(error), userOpHash: record.userOpHash })
  })
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('request body must be valid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readHex(record: Record<string, unknown>, field: string): Hex {
  const value = record[field]
  if (typeof value !== 'string' || !isHex(value)) {
    throw new Error(`${field} must be a hex string`)
  }
  return value as Hex
}

function readAddress(record: Record<string, unknown>, field: string): Address {
  const value = record[field]
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(`${field} must be an EVM address`)
  }
  return getAddress(value)
}

function hexByteLength(hex: string): number {
  return (hex.length - 2) / 2
}

export async function main(): Promise<void> {
  const config: MainnetDirectMintConfig = readMainnetConfigFromEnv()
  const logger: MainnetClientLogger = {
    info(message, context) {
      console.log(message, context ?? {})
    },
    error(message, context) {
      console.error(message, context ?? {})
    },
  }
  const client = new MainnetDirectMintClient({ config, logger })
  const executor = new MainnetDirectMintExecutor({ client, config, logger })
  const server = createServer(executor, logger)
  server.listen(config.httpPort, () => {
    logger.info('[direct-mint] listening', { port: config.httpPort, executor: client.executorAddress })
  })
}

const isDirectlyExecuted = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
if (isDirectlyExecuted) {
  main().catch((error) => {
    console.error(messageOf(error))
    process.exitCode = 1
  })
}

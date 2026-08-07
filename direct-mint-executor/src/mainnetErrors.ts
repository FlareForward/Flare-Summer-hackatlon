import { XrplRailError } from './errors.js'

export class CallNotAllowedError extends XrplRailError {
  constructor(index: number, reason: string) {
    super(`[direct-mint] call[${index}] rejected by allow-list: ${reason}`, {
      code: 'INVALID_INPUT',
      field: `calls[${index}]`,
    })
  }
}

export class TooManyCallsError extends XrplRailError {
  constructor(count: number, max: number) {
    super(`[direct-mint] userOp has ${count} calls, max allowed is ${max}`, {
      code: 'INVALID_INPUT',
      field: 'calls',
    })
  }
}

export class XrplPaymentWatchTimeoutError extends XrplRailError {
  constructor(userOpHash: string) {
    super(`[direct-mint] no matching XRPL payment observed for ${userOpHash}`, {
      code: 'EXECUTOR_TIMEOUT',
      field: 'userOpHash',
    })
  }
}

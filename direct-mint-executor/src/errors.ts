export type XrplRailErrorCode =
  | 'INVALID_INPUT'
  | 'DESTINATION_TAG_REFUSED'
  | 'DEPLOYMENT_CONFIG'
  | 'USER_OP_HASH_MISMATCH'
  | 'USER_OP_NOT_REGISTERED'
  | 'MINT_RECIPIENT_MISMATCH'
  | 'MISSING_FDC_PROOF'
  | 'EXECUTOR_CLIENT_FAILURE'
  | 'EXECUTOR_TIMEOUT'
  | 'ATTESTED_MEMO_MISMATCH'

export interface XrplRailErrorOptions {
  code: XrplRailErrorCode
  field?: string
  cause?: unknown
}

export class XrplRailError extends Error {
  readonly code: XrplRailErrorCode
  readonly field?: string
  readonly cause?: unknown

  constructor(message: string, options: XrplRailErrorOptions) {
    super(message)
    this.name = new.target.name
    this.code = options.code
    this.field = options.field
    this.cause = options.cause
  }
}

export class InvalidInputError extends XrplRailError {
  constructor(field: string, message: string, cause?: unknown) {
    super(`[xrpl-rail] invalid ${field}: ${message}`, {
      code: 'INVALID_INPUT',
      field,
      cause,
    })
  }
}

export class DestinationTagRefusedError extends XrplRailError {
  constructor() {
    super('[xrpl-rail] XRPL destination tags are forbidden for smart-account payments', {
      code: 'DESTINATION_TAG_REFUSED',
      field: 'destinationTag',
    })
  }
}

export class DeploymentConfigError extends XrplRailError {
  constructor(message: string, cause?: unknown) {
    super(`[xrpl-rail] deployment config error: ${message}`, {
      code: 'DEPLOYMENT_CONFIG',
      cause,
    })
  }
}

export class UserOperationHashMismatchError extends XrplRailError {
  constructor(expected: string, actual: string) {
    super(`[xrpl-rail] userOp hash mismatch: expected ${expected}, got ${actual}`, {
      code: 'USER_OP_HASH_MISMATCH',
      field: 'userOpHash',
    })
  }
}

export class UserOperationNotRegisteredError extends XrplRailError {
  constructor(userOpHash: string) {
    super(`[xrpl-rail] userOp hash is not registered: ${userOpHash}`, {
      code: 'USER_OP_NOT_REGISTERED',
      field: 'userOpHash',
    })
  }
}

export class MintRecipientMismatchError extends XrplRailError {
  constructor(expected: string, actual: string) {
    super(`[xrpl-rail] mint recipient mismatch: expected ${expected}, got ${actual}`, {
      code: 'MINT_RECIPIENT_MISMATCH',
      field: 'recipient',
    })
  }
}

export class MissingFdcProofError extends XrplRailError {
  constructor(userOpHash: string) {
    super(`[xrpl-rail] FDC payment proof is unavailable for ${userOpHash}`, {
      code: 'MISSING_FDC_PROOF',
      field: 'proof',
    })
  }
}

/**
 * The FDC-attested payment memo doesn't tail-match the userOpHash we registered. This is a real
 * correctness violation, not a flaky RPC/network blip - unlike other findMintingProof failures,
 * it will not resolve itself on retry, so callers should treat it as terminal.
 */
export class AttestedMemoMismatchError extends XrplRailError {
  constructor(userOpHash: string) {
    super(`[xrpl-rail] attested memo does not match registered userOpHash: ${userOpHash}`, {
      code: 'ATTESTED_MEMO_MISMATCH',
      field: 'userOpHash',
    })
  }
}

export class ExecutorClientFailureError extends XrplRailError {
  constructor(action: string, cause: unknown) {
    super(`[xrpl-rail] executor client failed during ${action}: ${messageOf(cause)}`, {
      code: 'EXECUTOR_CLIENT_FAILURE',
      cause,
    })
  }
}

export class ExecutorTimeoutError extends XrplRailError {
  constructor(userOpHash: string, attempts: number) {
    super(`[xrpl-rail] executor timed out waiting for ${userOpHash} after ${attempts} attempts`, {
      code: 'EXECUTOR_TIMEOUT',
      field: 'userOpHash',
    })
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

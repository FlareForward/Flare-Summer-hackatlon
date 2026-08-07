import { isAddress, getAddress, type Address, type Hex } from 'viem'
import { InvalidInputError } from './errors.js'

/** Flare mainnet chain id. This package only ever targets mainnet. */
export const FLARE_MAINNET_CHAIN_ID = 14

/** Vault kinds the executor can allow-list calls for, beyond the default Spectra pool flow. */
export type KnownVaultKind = 'erc4626' | 'carry'

export interface MainnetDirectMintConfig {
  rpcUrl: string
  flareContractRegistry: Address
  assetManagerFXRP: Address
  fxrpToken: Address
  masterAccountController: Address
  executorPrivateKey: Hex
  fdcVerifierBaseUrl: string
  fdcApiKey: string
  daLayerBaseUrl: string
  fdcAttestationType: string
  fdcSourceId: string
  xrplRpcUrl: string
  maxAttempts: number
  pollIntervalMs: number
  httpPort: number
  /** Lowercased vault address -> kind. Populated from DIRECT_MINT_ERC4626_VAULTS / DIRECT_MINT_CARRY_VAULTS. */
  knownVaults: Map<string, KnownVaultKind>
}

const DEFAULTS = {
  // This is Flare's public mainnet endpoint. It keeps a missing deployment variable from
  // turning into an invalid URL at the first customer request.
  flareRpcUrl: 'https://flare-api.flare.network/ext/C/rpc',
  flareContractRegistry: '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019',
  fdcVerifierBaseUrl: 'https://fdc-verifiers-mainnet.flare.network',
  daLayerBaseUrl: 'https://flr-data-availability.flare.network',
  xrplRpcUrl: 'https://xrplcluster.com/',
  fdcAttestationType: 'XRPPayment',
  fdcSourceId: 'XRP',
  maxAttempts: '240',
  pollIntervalMs: '15000',
  httpPort: '8787',
}

export function readMainnetConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MainnetDirectMintConfig {
  return {
    rpcUrl: readRpcUrl(env.FLARE_RPC_URL ?? DEFAULTS.flareRpcUrl),
    flareContractRegistry: readAddress(env.FLARE_CONTRACT_REGISTRY ?? DEFAULTS.flareContractRegistry, 'FLARE_CONTRACT_REGISTRY'),
    assetManagerFXRP: readAddress(readRequiredEnv(env, 'ASSET_MANAGER_FXRP'), 'ASSET_MANAGER_FXRP'),
    fxrpToken: readAddress(readRequiredEnv(env, 'FXRP_ADDRESS'), 'FXRP_ADDRESS'),
    masterAccountController: readAddress(readRequiredEnv(env, 'MASTER_ACCOUNT_CONTROLLER'), 'MASTER_ACCOUNT_CONTROLLER'),
    executorPrivateKey: readPrivateKey(readRequiredEnv(env, 'DIRECT_MINT_EXECUTOR_PRIVATE_KEY'), 'DIRECT_MINT_EXECUTOR_PRIVATE_KEY'),
    fdcVerifierBaseUrl: env.FDC_VERIFIER_BASE_URL?.trim() || DEFAULTS.fdcVerifierBaseUrl,
    fdcApiKey: readRequiredEnv(env, 'FDC_API_KEY_MAINNET'),
    daLayerBaseUrl: env.FDC_DA_LAYER_BASE_URL?.trim() || DEFAULTS.daLayerBaseUrl,
    fdcAttestationType: env.FDC_ATTESTATION_TYPE?.trim() || DEFAULTS.fdcAttestationType,
    fdcSourceId: env.FDC_SOURCE_ID?.trim() || DEFAULTS.fdcSourceId,
    xrplRpcUrl: env.XRPL_RPC_URL?.trim() || DEFAULTS.xrplRpcUrl,
    maxAttempts: readPositiveInteger(env.DIRECT_MINT_MAX_ATTEMPTS ?? DEFAULTS.maxAttempts, 'DIRECT_MINT_MAX_ATTEMPTS'),
    pollIntervalMs: readPositiveInteger(env.DIRECT_MINT_POLL_INTERVAL_MS ?? DEFAULTS.pollIntervalMs, 'DIRECT_MINT_POLL_INTERVAL_MS'),
    // Railway (and most PaaS hosts) inject PORT and expect the app to bind to it.
    httpPort: readPositiveInteger(env.DIRECT_MINT_HTTP_PORT ?? env.PORT ?? DEFAULTS.httpPort, 'DIRECT_MINT_HTTP_PORT'),
    knownVaults: readKnownVaults(env),
  }
}

function readKnownVaults(env: NodeJS.ProcessEnv): Map<string, KnownVaultKind> {
  const vaults = new Map<string, KnownVaultKind>()
  addKnownVaults(vaults, env.DIRECT_MINT_ERC4626_VAULTS, 'erc4626', 'DIRECT_MINT_ERC4626_VAULTS')
  addKnownVaults(vaults, env.DIRECT_MINT_CARRY_VAULTS, 'carry', 'DIRECT_MINT_CARRY_VAULTS')
  return vaults
}

function addKnownVaults(vaults: Map<string, KnownVaultKind>, raw: string | undefined, kind: KnownVaultKind, field: string): void {
  if (!raw?.trim()) return
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    vaults.set(readAddress(trimmed, field).toLowerCase(), kind)
  }
}

function readRpcUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || /^<.*>$/.test(trimmed)) {
    throw new InvalidInputError('FLARE_RPC_URL', 'must be a valid HTTPS Flare RPC URL, not a placeholder')
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') throw new Error('URL must use HTTPS')
    return url.toString()
  } catch (error) {
    throw new InvalidInputError('FLARE_RPC_URL', 'must be a valid HTTPS Flare RPC URL', error)
  }
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) {
    throw new InvalidInputError(name, 'missing required environment variable')
  }
  return value
}

function readAddress(value: string, field: string): Address {
  if (!isAddress(value)) {
    throw new InvalidInputError(field, 'must be an EVM address')
  }
  return getAddress(value)
}

function readPrivateKey(value: string, field: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value.trim())) {
    throw new InvalidInputError(field, 'must be a 32-byte hex private key supplied by environment')
  }
  return value.trim() as Hex
}

function readPositiveInteger(value: string, field: string): number {
  if (!/^[0-9]+$/.test(value.trim())) {
    throw new InvalidInputError(field, 'must be a positive integer')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidInputError(field, 'must be a positive safe integer')
  }
  return parsed
}

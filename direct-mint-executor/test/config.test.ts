import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import { readMainnetConfigFromEnv } from '../src/config.js'

const requiredEnv = {
  ASSET_MANAGER_FXRP: '0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8',
  FXRP_ADDRESS: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE',
  MASTER_ACCOUNT_CONTROLLER: '0x434936d47503353f06750Db1A444DBDC5F0AD37c',
  DIRECT_MINT_EXECUTOR_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
  FDC_API_KEY_MAINNET: 'test-key',
}

describe('readMainnetConfigFromEnv', () => {
  it('uses the public Flare mainnet RPC when FLARE_RPC_URL is not set', () => {
    expect(readMainnetConfigFromEnv(requiredEnv).rpcUrl).toBe('https://flare-api.flare.network/ext/C/rpc')
  })

  it('rejects a documentation placeholder instead of accepting customer requests', () => {
    expect(() => readMainnetConfigFromEnv({ ...requiredEnv, FLARE_RPC_URL: '<your Flare mainnet RPC>' }))
      .toThrow('FLARE_RPC_URL')
  })

  it('defaults to an empty known-vault registry when the vault env vars are unset', () => {
    expect(readMainnetConfigFromEnv(requiredEnv).knownVaults.size).toBe(0)
  })

  it('parses comma-separated erc4626 and carry vault addresses into the known-vault registry', () => {
    const lpVault = getAddress('0xadb3f75c01eda514d476998f96523c1031dda25b')
    const carryVault = getAddress('0x92613ec8058fbf6991f176a48cba2e2e7d8ba60c')
    const config = readMainnetConfigFromEnv({
      ...requiredEnv,
      DIRECT_MINT_ERC4626_VAULTS: lpVault,
      DIRECT_MINT_CARRY_VAULTS: ` ${carryVault} `,
    })

    expect(config.knownVaults.get(lpVault.toLowerCase())).toBe('erc4626')
    expect(config.knownVaults.get(carryVault.toLowerCase())).toBe('carry')
  })
})

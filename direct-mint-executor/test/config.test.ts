import { describe, expect, it } from 'vitest'
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
})

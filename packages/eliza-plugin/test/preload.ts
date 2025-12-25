/**
 * Preload script to patch zod with .loose() method
 * This is needed because @elizaos/core v1.6.x uses zod's .loose() method
 * which only exists in zod v4, but it's bundled with an older version.
 */

import { mock } from 'bun:test'
import { z } from 'zod'

// Add .loose() method to ZodObject if it doesn't exist
const ZodObjectProto = Object.getPrototypeOf(z.object({}))
if (!ZodObjectProto.loose) {
  ZodObjectProto.loose = function () {
    return this.passthrough()
  }
}

// Mock @jejunetwork/sdk to avoid build dependency during unit tests
mock.module('@jejunetwork/sdk', () => ({
  createJejuClient: async () => ({
    address: '0x0000000000000000000000000000000000000000',
    network: 'testnet',
    chainId: 1,
    isSmartAccount: false,
    getBalance: async () => 0n,
  }),
}))

// Note: @jejunetwork/config is NOT mocked - tests need the real exports
// including INFRA_PORTS, getCoreAppUrl, etc.

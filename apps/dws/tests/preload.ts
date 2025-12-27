/**
 * Test Preload
 *
 * This file is loaded before all tests and sets up the test environment.
 * It starts anvil, deploys contracts, and starts the inference node.
 */

import { afterAll, beforeAll } from 'bun:test'
import { getTestEnv, setup, teardown } from './setup'

// Set test environment
process.env.BUN_TEST = 'true'

// Set up environment variables
const env = getTestEnv()
process.env.L2_RPC_URL = env.rpcUrl
process.env.JEJU_RPC_URL = env.rpcUrl
process.env.DWS_URL = env.dwsUrl
process.env.INFERENCE_URL = env.inferenceUrl

// Global setup/teardown
beforeAll(async () => {
  await setup()
})

afterAll(async () => {
  await teardown()
})

console.log('[Preload] Test environment configured')

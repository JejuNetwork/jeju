/**
 * Test Environment Setup
 *
 * Provides test utilities and environment configuration for DWS integration tests.
 */

import { getDWSUrl } from '@jejunetwork/config'

interface TestEnv {
  dwsUrl: string
  testAddr: string
}

/**
 * Get test environment configuration
 */
export function getTestEnv(): TestEnv {
  const dwsUrl = process.env.DWS_URL ?? getDWSUrl() ?? 'http://localhost:4030'

  const testAddr =
    process.env.TEST_ADDRESS ?? '0x1234567890123456789012345678901234567890'

  return {
    dwsUrl,
    testAddr,
  }
}

/**
 * Check if DWS server is available
 */
export async function isDWSAvailable(): Promise<boolean> {
  const { dwsUrl } = getTestEnv()
  try {
    const response = await fetch(`${dwsUrl}/health`, { method: 'GET' })
    return response.ok
  } catch {
    return false
  }
}

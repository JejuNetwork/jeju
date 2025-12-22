/**
 * Synpress config for wallet smoke tests
 *
 * CLI:
 *   jeju test synpress --smoke
 *
 * Direct:
 *   bunx playwright test --config packages/tests/smoke/synpress.config.ts
 */

import { createSmokeTestConfig } from '../shared/synpress.config.base'

export default createSmokeTestConfig({
  testMatch: 'wallet-smoke.spec.ts',
})

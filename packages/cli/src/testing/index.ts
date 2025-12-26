/**
 * Testing infrastructure for Jeju CLI
 *
 * Provides smoke tests, visual verification, and E2E test orchestration.
 */

export { SMOKE_TEST_HTML, SMOKE_TEST_PORT, startSmokeTestServer } from './smoke-test-page'
export {
  runSmokeTests,
  quickSmokeCheck,
  type SmokeTestResult,
  type SmokeTestConfig,
} from './smoke-test-runner'


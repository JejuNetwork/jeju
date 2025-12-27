/**
 * Infrastructure availability for tests
 *
 * IMPORTANT: The Jeju CLI test orchestrator now uses a FAIL-FAST approach.
 * If you're running tests via `jeju test`, all infrastructure is guaranteed
 * to be available - the test run will crash before reaching tests if not.
 *
 * These exports are DEPRECATED and exist only for backward compatibility.
 * DO NOT add new skipIf patterns. Tests that need infrastructure should:
 * 1. Be run via `jeju test` which ensures infrastructure
 * 2. Crash with a clear error if infrastructure is missing
 *
 * @deprecated Use `jeju test` CLI instead of manual infrastructure checks
 */

// Helper to get boolean from env
function envBool(key: string): boolean {
  return process.env[key] === 'true'
}

// Infrastructure is available if running via jeju test
const infraReady = envBool('INFRA_READY')

// DEPRECATED: Skip flags - all should be false when running via jeju test
// These remain for backward compatibility but should not be used
export const SKIP = {
  CQL: false,
  ANVIL: false,
  DWS: false,
  DOCKER: false,
  K8S: !envBool('K8S_AVAILABLE'), // K8S is optional even in jeju test
  IPFS: false,
  STORAGE: false,
  NO_CHAIN: false,
  NO_INFRA: !infraReady,
  NO_K8S: !envBool('K8S_AVAILABLE'),
  NO_DISTRIBUTED: false,
} as const

// Status flags - should all be true when running via jeju test
export const INFRA_STATUS = {
  cql: true,
  anvil: true,
  dws: true,
  docker: true,
  k8s: envBool('K8S_AVAILABLE'),
  ipfs: true,
  storage: true,
}

/**
 * Require infrastructure to be available or crash
 * Use this at the start of test files that need infrastructure
 */
export function requireInfrastructure(): void {
  if (!infraReady) {
    throw new Error(
      'FATAL: Infrastructure not available. ' +
        'Run tests with `jeju test` to ensure infrastructure is started. ' +
        'Or set INFRA_READY=true if you have manually started services.',
    )
  }
}

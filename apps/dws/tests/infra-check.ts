/**
 * Infrastructure availability checks for tests
 *
 * These skip flags are computed at module load time based on
 * environment variables that are set either by:
 * 1. The jeju test CLI (which starts services and sets vars)
 * 2. Manual configuration (e.g., CQL_AVAILABLE=true)
 * 3. The preload.ts file (if services are already running)
 *
 * Usage:
 *   import { SKIP } from './infra-check'
 *   describe.skipIf(SKIP.STORAGE)('Storage Tests', () => { ... })
 *   test.skipIf(SKIP.K8S)('should deploy to k8s', () => { ... })
 *
 * When running standalone without jeju test:
 *   INFRA_READY=true bun test tests/integration.test.ts
 *   K8S_AVAILABLE=true bun test tests/infrastructure-k8s.test.ts
 */

// Helper to get boolean from env
function envBool(key: string): boolean {
  return process.env[key] === 'true'
}

// These are set by jeju test or manually
// By default, assume not available unless explicitly set
const cql = envBool('CQL_AVAILABLE')
const anvil = envBool('ANVIL_AVAILABLE')
const dws = envBool('DWS_AVAILABLE')
const docker = envBool('DOCKER_AVAILABLE')
const k8s = envBool('K8S_AVAILABLE')
const ipfs = envBool('IPFS_AVAILABLE')

// Or use INFRA_READY as a shortcut for core services
const infraReady = envBool('INFRA_READY')
const allInfra = infraReady || (cql && anvil)

// Computed status
const storage = cql && ipfs

// Export skip conditions (true = skip, false = run)
// Skip when service is NOT available
export const SKIP = {
  // Service unavailable conditions
  CQL: !cql && !infraReady,
  ANVIL: !anvil && !infraReady,
  DWS: !dws,
  DOCKER: !docker,
  K8S: !k8s,
  IPFS: !ipfs,
  STORAGE: !storage && !infraReady,

  // Composite conditions
  NO_CHAIN: !anvil && !infraReady,
  NO_INFRA: !allInfra,
  NO_K8S: !k8s || !docker,
  NO_DISTRIBUTED: (!cql && !infraReady) || !ipfs,
} as const

// For backward compatibility
export const INFRA_STATUS = {
  cql: cql || infraReady,
  anvil: anvil || infraReady,
  dws,
  docker,
  k8s,
  ipfs,
  storage: storage || infraReady,
}

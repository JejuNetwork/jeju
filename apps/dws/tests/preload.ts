/**
 * Test Preload - Run before all tests
 *
 * This file is loaded before tests run via `--preload ./tests/preload.ts`
 * It ensures proper test environment setup and validates infrastructure.
 *
 * For full integration tests, use: `jeju test --target-app dws --mode integration`
 * This spins up CQL, Anvil, contracts, and all required services.
 */

import { CORE_PORTS, getCQLBlockProducerUrl, getL2RpcUrl } from '@jejunetwork/config'

const CQL_URL = getCQLBlockProducerUrl()
const RPC_URL = getL2RpcUrl()
const DWS_PORT = CORE_PORTS.DWS_API.get()
const DWS_URL = `http://127.0.0.1:${DWS_PORT}`
const IPFS_PORT = CORE_PORTS.IPFS_API.get()
const IPFS_URL = `http://127.0.0.1:${IPFS_PORT}`

async function checkService(url: string, path = '/health'): Promise<boolean> {
  try {
    const response = await fetch(`${url}${path}`, {
      signal: AbortSignal.timeout(1000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function checkRpc(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(1000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function checkDocker(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['docker', 'info'], { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    return code === 0
  } catch {
    return false
  }
}

async function checkK8s(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['kubectl', 'cluster-info'], { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    return code === 0
  } catch {
    return false
  }
}

// Run infrastructure check
const [cqlReady, anvilReady, dwsReady, dockerReady, k8sReady, ipfsReady] = await Promise.all([
  checkService(CQL_URL, '/health'),
  checkRpc(RPC_URL),
  checkService(DWS_URL, '/health'),
  checkDocker(),
  checkK8s(),
  checkService(IPFS_URL, '/api/v0/version'),
])

// Set environment for tests
process.env.CQL_URL = CQL_URL
process.env.L2_RPC_URL = RPC_URL
process.env.JEJU_RPC_URL = RPC_URL
process.env.DWS_URL = DWS_URL
process.env.PORT = String(DWS_PORT)

// Track what's available (used by infra-check.ts)
process.env.CQL_AVAILABLE = cqlReady ? 'true' : 'false'
process.env.ANVIL_AVAILABLE = anvilReady ? 'true' : 'false'
process.env.DWS_AVAILABLE = dwsReady ? 'true' : 'false'
process.env.DOCKER_AVAILABLE = dockerReady ? 'true' : 'false'
process.env.K8S_AVAILABLE = k8sReady ? 'true' : 'false'
process.env.IPFS_AVAILABLE = ipfsReady ? 'true' : 'false'
process.env.INFRA_READY = (cqlReady && anvilReady) ? 'true' : 'false'

// Log status
console.log(`\n[Test Preload] Infrastructure Status:`)
console.log(`  CQL (${CQL_URL}): ${cqlReady ? '✓' : '✗'}`)
console.log(`  Anvil (${RPC_URL}): ${anvilReady ? '✓' : '✗'}`)
console.log(`  DWS (${DWS_URL}): ${dwsReady ? '✓' : '✗'}`)
console.log(`  Docker: ${dockerReady ? '✓' : '✗'}`)
console.log(`  K8s: ${k8sReady ? '✓' : '✗'}`)
console.log(`  IPFS (${IPFS_URL}): ${ipfsReady ? '✓' : '✗'}`)

if (!cqlReady || !anvilReady) {
  console.log(`\n[Test Preload] WARNING: Infrastructure not fully available.`)
  console.log(`  Integration tests will be skipped.`)
  console.log(`  Run 'jeju test --target-app dws --mode integration' for full test suite.\n`)
}

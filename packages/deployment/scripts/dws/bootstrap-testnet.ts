/**
 * DWS Testnet Bootstrap Script
 *
 * Provisions all DWS-native services for testnet deployment.
 * This replaces the Kubernetes Helm chart deployments with DWS control plane provisioning.
 *
 * Services deployed:
 * - OAuth3 (2-of-3 MPC threshold signing)
 * - Data Availability (IPFS-backed, Keccak256 commitments)
 * - Email (decentralized email infrastructure)
 * - Farcaster Hubble (permissionless hub node)
 * - x402 Facilitator (payment protocol)
 * - RPC Gateway (load balancer with rate limiting)
 * - SQLit Adapter (HTTP API for SQLite)
 *
 * Usage:
 *   bun run packages/deployment/scripts/dws/bootstrap-testnet.ts
 *
 * Environment:
 *   DWS_URL - DWS API endpoint (default: https://dws.testnet.jejunetwork.org)
 *   DEPLOYER_PRIVATE_KEY - Private key for deployment transactions
 *   DEPLOYER_ADDRESS - Address derived from private key
 */

import { getCurrentNetwork, getDWSUrl, getRpcUrl } from '@jejunetwork/config'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ============================================================================
// Configuration
// ============================================================================

const NETWORK = getCurrentNetwork()
const DWS_URL =
  process.env.DWS_URL ??
  getDWSUrl(NETWORK) ??
  'https://dws.testnet.jejunetwork.org'
const RPC_URL = getRpcUrl(NETWORK)

// Deployment configuration for testnet
const TESTNET_CONFIG = {
  oauth3: {
    name: 'jeju-oauth3',
    replicas: 3,
    mpcThreshold: 2, // 2-of-3 for testnet
    providers: ['google', 'github', 'twitter', 'discord', 'farcaster'] as const,
    teeRequired: false, // TEE optional for testnet
  },
  da: {
    name: 'jeju-da',
    replicas: 3,
    commitmentScheme: 'keccak256' as const,
    archiveBackend: 'ipfs' as const,
    retentionDays: 30,
  },
  email: {
    name: 'jeju-email',
    replicas: 2,
    domain: 'jeju.mail',
    stakeTier: 'staked' as const,
  },
  hubble: {
    name: 'jeju-hubble',
    replicas: 1,
    syncMode: 'full' as const,
    bootstrapPeers: [
      '/dns4/hoyt.farcaster.xyz/tcp/2282',
      '/dns4/lamia.farcaster.xyz/tcp/2282',
    ],
  },
  workers: {
    x402: {
      name: 'jeju-x402',
      replicas: 2,
    },
    rpcGateway: {
      name: 'jeju-rpc-gateway',
      replicas: 3,
    },
    sqlitAdapter: {
      name: 'jeju-sqlit-adapter',
      replicas: 2,
    },
  },
}

// ============================================================================
// DWS API Client
// ============================================================================

interface DWSClient {
  deployOAuth3(config: typeof TESTNET_CONFIG.oauth3): Promise<DeploymentResult>
  deployDA(config: typeof TESTNET_CONFIG.da): Promise<DeploymentResult>
  deployEmail(config: typeof TESTNET_CONFIG.email): Promise<DeploymentResult>
  deployHubble(config: typeof TESTNET_CONFIG.hubble): Promise<DeploymentResult>
  deployWorker(
    type: string,
    config: { name: string; replicas: number },
  ): Promise<DeploymentResult>
  getServiceStatus(serviceId: string): Promise<ServiceStatus>
  waitForReady(serviceId: string, timeoutMs: number): Promise<boolean>
}

interface DeploymentResult {
  service: {
    id: string
    name: string
    status: string
    replicas: number
    endpoints: string[]
  }
}

interface ServiceStatus {
  id: string
  status: 'provisioning' | 'running' | 'degraded' | 'failed'
  replicas: {
    ready: number
    total: number
  }
  endpoints: string[]
}

function createDWSClient(baseUrl: string, address: Address): DWSClient {
  const headers = {
    'Content-Type': 'application/json',
    'x-jeju-address': address,
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`DWS API error: ${response.status} - ${error}`)
    }
    return response.json() as Promise<T>
  }

  async function get<T>(path: string): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, { headers })
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`DWS API error: ${response.status} - ${error}`)
    }
    return response.json() as Promise<T>
  }

  return {
    async deployOAuth3(config) {
      return post('/dws-services/oauth3', config)
    },
    async deployDA(config) {
      return post('/dws-services/da', config)
    },
    async deployEmail(config) {
      return post('/dws-services/email', config)
    },
    async deployHubble(config) {
      return post('/dws-services/hubble', config)
    },
    async deployWorker(type, config) {
      return post('/dws-services/workers', { type, ...config })
    },
    async getServiceStatus(serviceId) {
      return get(`/dws-services/status/${serviceId}`)
    },
    async waitForReady(serviceId, timeoutMs) {
      const startTime = Date.now()
      while (Date.now() - startTime < timeoutMs) {
        const status = await this.getServiceStatus(serviceId)
        if (
          status.status === 'running' &&
          status.replicas.ready === status.replicas.total
        ) {
          return true
        }
        if (status.status === 'failed') {
          throw new Error(`Service ${serviceId} failed to start`)
        }
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
      return false
    },
  }
}

// ============================================================================
// Deployment Functions
// ============================================================================

interface DeployedService {
  name: string
  id: string
  status: string
  endpoints: string[]
}

async function deployOAuth3(client: DWSClient): Promise<DeployedService> {
  console.log('🔐 Deploying OAuth3 (2-of-3 MPC)...')
  const result = await client.deployOAuth3(TESTNET_CONFIG.oauth3)
  console.log(`   ✓ OAuth3 deployed: ${result.service.id}`)
  console.log(`   Endpoints: ${result.service.endpoints.join(', ')}`)
  return {
    name: TESTNET_CONFIG.oauth3.name,
    id: result.service.id,
    status: result.service.status,
    endpoints: result.service.endpoints,
  }
}

async function deployDA(client: DWSClient): Promise<DeployedService> {
  console.log('📦 Deploying Data Availability Layer...')
  const result = await client.deployDA(TESTNET_CONFIG.da)
  console.log(`   ✓ DA deployed: ${result.service.id}`)
  console.log(`   Endpoints: ${result.service.endpoints.join(', ')}`)
  return {
    name: TESTNET_CONFIG.da.name,
    id: result.service.id,
    status: result.service.status,
    endpoints: result.service.endpoints,
  }
}

async function deployEmail(client: DWSClient): Promise<DeployedService> {
  console.log('📧 Deploying Email Service...')
  const result = await client.deployEmail(TESTNET_CONFIG.email)
  console.log(`   ✓ Email deployed: ${result.service.id}`)
  console.log(`   Endpoints: ${result.service.endpoints.join(', ')}`)
  return {
    name: TESTNET_CONFIG.email.name,
    id: result.service.id,
    status: result.service.status,
    endpoints: result.service.endpoints,
  }
}

async function deployHubble(client: DWSClient): Promise<DeployedService> {
  console.log('🟣 Deploying Farcaster Hubble...')
  const result = await client.deployHubble(TESTNET_CONFIG.hubble)
  console.log(`   ✓ Hubble deployed: ${result.service.id}`)
  console.log(`   Endpoints: ${result.service.endpoints.join(', ')}`)
  return {
    name: TESTNET_CONFIG.hubble.name,
    id: result.service.id,
    status: result.service.status,
    endpoints: result.service.endpoints,
  }
}

async function deployWorkers(client: DWSClient): Promise<DeployedService[]> {
  const workers: DeployedService[] = []

  console.log('⚡ Deploying x402 Facilitator...')
  const x402Result = await client.deployWorker(
    'x402-facilitator',
    TESTNET_CONFIG.workers.x402,
  )
  console.log(`   ✓ x402 deployed: ${x402Result.service.id}`)
  workers.push({
    name: TESTNET_CONFIG.workers.x402.name,
    id: x402Result.service.id,
    status: x402Result.service.status,
    endpoints: x402Result.service.endpoints,
  })

  console.log('🌐 Deploying RPC Gateway...')
  const rpcResult = await client.deployWorker(
    'rpc-gateway',
    TESTNET_CONFIG.workers.rpcGateway,
  )
  console.log(`   ✓ RPC Gateway deployed: ${rpcResult.service.id}`)
  workers.push({
    name: TESTNET_CONFIG.workers.rpcGateway.name,
    id: rpcResult.service.id,
    status: rpcResult.service.status,
    endpoints: rpcResult.service.endpoints,
  })

  console.log('🗄️ Deploying SQLit Adapter...')
  const sqlitResult = await client.deployWorker(
    'sqlit-adapter',
    TESTNET_CONFIG.workers.sqlitAdapter,
  )
  console.log(`   ✓ SQLit Adapter deployed: ${sqlitResult.service.id}`)
  workers.push({
    name: TESTNET_CONFIG.workers.sqlitAdapter.name,
    id: sqlitResult.service.id,
    status: sqlitResult.service.status,
    endpoints: sqlitResult.service.endpoints,
  })

  return workers
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(
    '╔═══════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║        DWS Testnet Bootstrap - Decentralized Service Deployment   ║',
  )
  console.log(
    '╚═══════════════════════════════════════════════════════════════════╝',
  )
  console.log()
  console.log(`Network: ${NETWORK}`)
  console.log(`DWS URL: ${DWS_URL}`)
  console.log(`RPC URL: ${RPC_URL}`)
  console.log()

  // Get deployer credentials
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined
  if (!privateKey) {
    console.error('Error: DEPLOYER_PRIVATE_KEY environment variable required')
    process.exit(1)
  }

  const account = privateKeyToAccount(privateKey)
  const deployerAddress = account.address
  console.log(`Deployer: ${deployerAddress}`)
  console.log()

  // Create DWS client
  const client = createDWSClient(DWS_URL, deployerAddress)

  // Track all deployed services
  const deployedServices: DeployedService[] = []

  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )
  console.log(
    '                     Deploying DWS Services                        ',
  )
  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )
  console.log()

  // Deploy all services
  deployedServices.push(await deployOAuth3(client))
  console.log()

  deployedServices.push(await deployDA(client))
  console.log()

  deployedServices.push(await deployEmail(client))
  console.log()

  deployedServices.push(await deployHubble(client))
  console.log()

  const workers = await deployWorkers(client)
  deployedServices.push(...workers)
  console.log()

  // Wait for all services to be ready
  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )
  console.log(
    '                   Waiting for Services to Start                   ',
  )
  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )
  console.log()

  const STARTUP_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

  for (const service of deployedServices) {
    console.log(`⏳ Waiting for ${service.name}...`)
    const ready = await client.waitForReady(service.id, STARTUP_TIMEOUT_MS)
    if (ready) {
      console.log(`   ✓ ${service.name} is ready`)
    } else {
      console.log(`   ⚠ ${service.name} is not ready (timeout)`)
    }
  }

  console.log()
  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )
  console.log(
    '                        Deployment Summary                         ',
  )
  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )
  console.log()
  console.log('Deployed Services:')
  console.log()

  for (const service of deployedServices) {
    console.log(`  ${service.name}`)
    console.log(`    ID: ${service.id}`)
    console.log(`    Status: ${service.status}`)
    if (service.endpoints.length > 0) {
      console.log(`    Endpoints:`)
      for (const endpoint of service.endpoints) {
        console.log(`      - ${endpoint}`)
      }
    }
    console.log()
  }

  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )
  console.log(
    '             DWS Testnet Bootstrap Complete                        ',
  )
  console.log(
    '═══════════════════════════════════════════════════════════════════',
  )
  console.log()
  console.log('All services are now deployed via DWS control plane.')
  console.log('The following K8s Helm charts are NO LONGER NEEDED:')
  console.log('  - packages/deployment/kubernetes/helm/oauth3 (DELETED)')
  console.log('  - packages/deployment/kubernetes/helm/jeju-da (DELETED)')
  console.log('  - packages/deployment/kubernetes/helm/email (DELETED)')
  console.log(
    '  - packages/deployment/kubernetes/helm/farcaster-hubble (DELETED)',
  )
  console.log(
    '  - packages/deployment/kubernetes/helm/x402-facilitator (DELETED)',
  )
  console.log('  - packages/deployment/kubernetes/helm/rpc-gateway (DELETED)')
  console.log('  - packages/deployment/kubernetes/helm/sqlit-adapter (DELETED)')
  console.log('  - packages/deployment/kubernetes/helm/sqlit (DELETED)')
  console.log('  - packages/deployment/kubernetes/helm/subsquid (DELETED)')
  console.log()
}

main().catch(console.error)

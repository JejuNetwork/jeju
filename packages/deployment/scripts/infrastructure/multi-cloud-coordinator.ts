#!/usr/bin/env bun
/**
 * Multi-Cloud Coordinator
 *
 * Enables AWS and GCP deployments to work together with:
 * - Shared state via on-chain contracts
 * - Cross-cloud service discovery
 * - Failover between clouds
 * - Unified monitoring
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      JEJU CHAIN (L2)                            │
 * │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
 * │  │NodeRegistry │  │DWSProvider  │  │ExternalChain│             │
 * │  │             │  │Registry     │  │Provider     │             │
 * │  └─────────────┘  └─────────────┘  └─────────────┘             │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *              ┌───────────────┴───────────────┐
 *              │                               │
 *       ┌──────▼──────┐                 ┌──────▼──────┐
 *       │    AWS      │                 │    GCP      │
 *       │ EKS Cluster │                 │ GKE Cluster │
 *       ├─────────────┤                 ├─────────────┤
 *       │ DWS Nodes   │◄───────────────►│ DWS Nodes   │
 *       │ Chain Nodes │                 │ Chain Nodes │
 *       │ Storage     │                 │ Storage     │
 *       └─────────────┘                 └─────────────┘
 *
 * Cross-cloud features:
 * 1. Service discovery via on-chain registry
 * 2. Health monitoring across clouds
 * 3. Automatic failover
 * 4. Load balancing via anycast/geo-routing
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { getRequiredNetwork, type NetworkType } from '../shared'

const ROOT = join(import.meta.dir, '../../../..')
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments')

interface CloudConfig {
  provider: 'aws' | 'gcp'
  region: string
  clusterName: string
  kubeContext: string
  endpoints: {
    rpc: string
    dws: string
    api: string
  }
  nodeCount: number
  healthy: boolean
}

interface MultiCloudState {
  network: NetworkType
  clouds: CloudConfig[]
  primaryCloud: 'aws' | 'gcp'
  lastSync: string
  healthyNodes: number
  totalNodes: number
}

// Node Registry ABI for cross-cloud coordination
const NODE_REGISTRY_ABI = [
  {
    name: 'registerNode',
    type: 'function',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'region', type: 'string' },
      { name: 'cloudProvider', type: 'string' },
      { name: 'services', type: 'uint8[]' },
    ],
    outputs: [{ name: 'nodeId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'heartbeat',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getActiveNodes',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getNodesByRegion',
    type: 'function',
    inputs: [{ name: 'region', type: 'string' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
] as const

class MultiCloudCoordinator {
  private network: NetworkType
  private state: MultiCloudState
  private stateFile: string

  constructor(network: NetworkType) {
    this.network = network
    this.stateFile = join(DEPLOYMENTS_DIR, `${network}-multicloud-state.json`)
    this.state = this.loadState()
  }

  private loadState(): MultiCloudState {
    if (existsSync(this.stateFile)) {
      return JSON.parse(readFileSync(this.stateFile, 'utf-8'))
    }
    return {
      network: this.network,
      clouds: [],
      primaryCloud: 'aws',
      lastSync: '',
      healthyNodes: 0,
      totalNodes: 0,
    }
  }

  private saveState(): void {
    if (!existsSync(DEPLOYMENTS_DIR)) {
      mkdirSync(DEPLOYMENTS_DIR, { recursive: true })
    }
    this.state.lastSync = new Date().toISOString()
    writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2))
  }

  /**
   * Discover and register cloud deployments
   */
  async discoverClouds(): Promise<void> {
    console.log('🔍 Discovering cloud deployments...\n')

    const clouds: CloudConfig[] = []

    // Check AWS
    try {
      const awsCluster = this.getAWSCluster()
      if (awsCluster) {
        console.log(
          `   ✅ AWS: ${awsCluster.clusterName} in ${awsCluster.region}`,
        )
        clouds.push(awsCluster)
      }
    } catch {
      console.log('   ⏭️  AWS: No cluster found')
    }

    // Check GCP
    try {
      const gcpCluster = this.getGCPCluster()
      if (gcpCluster) {
        console.log(
          `   ✅ GCP: ${gcpCluster.clusterName} in ${gcpCluster.region}`,
        )
        clouds.push(gcpCluster)
      }
    } catch {
      console.log('   ⏭️  GCP: No cluster found')
    }

    this.state.clouds = clouds
    this.saveState()

    console.log(`\n   Found ${clouds.length} cloud deployment(s)`)
  }

  private getAWSCluster(): CloudConfig | null {
    try {
      const clusterName = `jeju-${this.network}`
      const region = process.env.AWS_REGION ?? 'us-east-1'

      // Check if cluster exists
      execSync(
        `aws eks describe-cluster --name ${clusterName} --region ${region}`,
        { stdio: 'pipe' },
      )

      // Get kubeconfig context
      const context = `arn:aws:eks:${region}:*:cluster/${clusterName}`

      return {
        provider: 'aws',
        region,
        clusterName,
        kubeContext: context,
        endpoints: {
          rpc: `https://${this.network}-rpc.jejunetwork.org`,
          dws: `https://dws.${this.network}.jejunetwork.org`,
          api: `https://api.${this.network}.jejunetwork.org`,
        },
        nodeCount: 0,
        healthy: true,
      }
    } catch {
      return null
    }
  }

  private getGCPCluster(): CloudConfig | null {
    try {
      const projectId = process.env.GCP_PROJECT ?? ''
      const region = process.env.GCP_REGION ?? 'us-central1'
      const clusterName = `jeju-${this.network}-gke`

      if (!projectId) return null

      // Check if cluster exists
      execSync(
        `gcloud container clusters describe ${clusterName} --region ${region} --project ${projectId}`,
        { stdio: 'pipe' },
      )

      const context = `gke_${projectId}_${region}_${clusterName}`

      return {
        provider: 'gcp',
        region,
        clusterName,
        kubeContext: context,
        endpoints: {
          rpc: `https://${this.network}-rpc.gcp.jejunetwork.org`,
          dws: `https://dws.${this.network}.gcp.jejunetwork.org`,
          api: `https://api.${this.network}.gcp.jejunetwork.org`,
        },
        nodeCount: 0,
        healthy: true,
      }
    } catch {
      return null
    }
  }

  /**
   * Check health of all clouds
   */
  async checkHealth(): Promise<void> {
    console.log('\n🏥 Checking cloud health...\n')

    let healthyNodes = 0
    let totalNodes = 0

    for (const cloud of this.state.clouds) {
      try {
        // Check DWS endpoint
        const response = await fetch(`${cloud.endpoints.dws}/health`, {
          signal: AbortSignal.timeout(5000),
        })
        cloud.healthy = response.ok

        // Get node count from cluster
        const nodeCount = this.getNodeCount(cloud)
        cloud.nodeCount = nodeCount
        totalNodes += nodeCount

        if (cloud.healthy) {
          healthyNodes += nodeCount
          console.log(
            `   ✅ ${cloud.provider.toUpperCase()} (${cloud.region}): ${nodeCount} nodes, healthy`,
          )
        } else {
          console.log(
            `   ❌ ${cloud.provider.toUpperCase()} (${cloud.region}): ${nodeCount} nodes, unhealthy`,
          )
        }
      } catch (_error) {
        cloud.healthy = false
        console.log(
          `   ❌ ${cloud.provider.toUpperCase()} (${cloud.region}): unreachable`,
        )
      }
    }

    this.state.healthyNodes = healthyNodes
    this.state.totalNodes = totalNodes
    this.saveState()
  }

  private getNodeCount(cloud: CloudConfig): number {
    try {
      const output = execSync(
        `kubectl --context=${cloud.kubeContext} get pods -l app.kubernetes.io/part-of=jeju -o json`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      )
      const pods = JSON.parse(output)
      return pods.items?.length ?? 0
    } catch {
      return 0
    }
  }

  /**
   * Register nodes on-chain for cross-cloud discovery
   */
  async registerNodesOnChain(): Promise<void> {
    console.log('\n📝 Registering nodes on-chain...\n')

    const privateKey = process.env.DEPLOYER_PRIVATE_KEY
    if (!privateKey) {
      console.log('   ⏭️  No private key, skipping on-chain registration')
      return
    }

    // Load contract addresses
    const addressesPath = join(DEPLOYMENTS_DIR, `${this.network}-dws.json`)
    if (!existsSync(addressesPath)) {
      console.log('   ⏭️  DWS contracts not deployed, skipping')
      return
    }

    const addresses = JSON.parse(readFileSync(addressesPath, 'utf-8'))
    const nodeRegistryAddress = addresses.nodeRegistry as Address

    if (!nodeRegistryAddress) {
      console.log('   ⏭️  NodeRegistry not found, skipping')
      return
    }

    const account = privateKeyToAccount(privateKey as Hex)
    const rpcUrl =
      this.network === 'mainnet'
        ? 'https://mainnet.base.org'
        : 'https://sepolia.base.org'

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    })
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(rpcUrl),
    })

    for (const cloud of this.state.clouds) {
      if (!cloud.healthy) continue

      try {
        const hash = await walletClient.writeContract({
          address: nodeRegistryAddress,
          abi: NODE_REGISTRY_ABI,
          functionName: 'registerNode',
          args: [
            cloud.endpoints.dws,
            cloud.region,
            cloud.provider,
            [0, 1, 2], // Compute, Storage, CDN
          ],
        })

        await publicClient.waitForTransactionReceipt({ hash })
        console.log(
          `   ✅ ${cloud.provider.toUpperCase()}: Registered on-chain`,
        )
      } catch (_error) {
        console.log(
          `   ⏭️  ${cloud.provider.toUpperCase()}: Already registered or error`,
        )
      }
    }
  }

  /**
   * Deploy shared infrastructure (DNS, monitoring, etc.)
   */
  async deploySharedInfrastructure(): Promise<void> {
    console.log('\n🌐 Deploying shared infrastructure...\n')

    // Create shared ConfigMap for cross-cloud config
    const configMap = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'jeju-multicloud-config',
        namespace: 'jeju-system',
      },
      data: {
        network: this.network,
        clouds: JSON.stringify(this.state.clouds),
        primaryCloud: this.state.primaryCloud,
        rpcEndpoints: this.state.clouds.map((c) => c.endpoints.rpc).join(','),
        dwsEndpoints: this.state.clouds.map((c) => c.endpoints.dws).join(','),
      },
    }

    const configPath = join(DEPLOYMENTS_DIR, 'multicloud-config.yaml')
    writeFileSync(
      configPath,
      `# Auto-generated by multi-cloud-coordinator
${JSON.stringify(configMap, null, 2)
  .replace(/"([^"]+)":/g, '$1:')
  .replace(/"/g, "'")}`,
    )

    // Apply to all clusters
    for (const cloud of this.state.clouds) {
      try {
        execSync(
          `kubectl --context=${cloud.kubeContext} apply -f ${configPath}`,
          { stdio: 'pipe' },
        )
        console.log(`   ✅ ${cloud.provider.toUpperCase()}: ConfigMap applied`)
      } catch {
        console.log(
          `   ⏭️  ${cloud.provider.toUpperCase()}: Could not apply ConfigMap`,
        )
      }
    }
  }

  /**
   * Set up cross-cloud failover
   */
  async setupFailover(): Promise<void> {
    console.log('\n🔄 Setting up cross-cloud failover...\n')

    if (this.state.clouds.length < 2) {
      console.log('   ⏭️  Need at least 2 clouds for failover')
      return
    }

    // Determine primary based on health and node count
    const sortedClouds = [...this.state.clouds]
      .filter((c) => c.healthy)
      .sort((a, b) => b.nodeCount - a.nodeCount)

    if (sortedClouds.length > 0) {
      this.state.primaryCloud = sortedClouds[0].provider
      console.log(`   Primary cloud: ${this.state.primaryCloud.toUpperCase()}`)
    }

    // Create failover config for external-dns/route53/cloud-dns
    const failoverConfig = {
      primary: sortedClouds[0],
      secondary: sortedClouds[1],
      failoverThreshold: 3, // Consecutive failures before failover
      healthCheckInterval: 30, // seconds
    }

    writeFileSync(
      join(DEPLOYMENTS_DIR, `${this.network}-failover-config.json`),
      JSON.stringify(failoverConfig, null, 2),
    )

    console.log('   ✅ Failover configuration saved')

    this.saveState()
  }

  /**
   * Sync deployments across clouds
   */
  async syncDeployments(): Promise<void> {
    console.log('\n📦 Syncing deployments across clouds...\n')

    const helmfileDir = join(ROOT, 'packages/deployment/kubernetes/helmfile')

    for (const cloud of this.state.clouds) {
      if (!cloud.healthy) continue

      try {
        console.log(`   Syncing ${cloud.provider.toUpperCase()}...`)
        execSync(
          `cd ${helmfileDir} && KUBECONTEXT=${cloud.kubeContext} helmfile -e ${this.network} sync`,
          { stdio: 'inherit' },
        )
        console.log(`   ✅ ${cloud.provider.toUpperCase()}: Synced`)
      } catch (_error) {
        console.log(`   ❌ ${cloud.provider.toUpperCase()}: Sync failed`)
      }
    }
  }

  /**
   * Print status
   */
  printStatus(): void {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                 MULTI-CLOUD STATUS                           ║
╠══════════════════════════════════════════════════════════════╣
║  Network:       ${this.network.padEnd(44)}║
║  Clouds:        ${this.state.clouds.length.toString().padEnd(44)}║
║  Primary:       ${this.state.primaryCloud.toUpperCase().padEnd(44)}║
║  Healthy Nodes: ${this.state.healthyNodes.toString().padEnd(44)}║
║  Total Nodes:   ${this.state.totalNodes.toString().padEnd(44)}║
║  Last Sync:     ${(this.state.lastSync || 'Never').padEnd(44)}║
╠══════════════════════════════════════════════════════════════╣`)

    for (const cloud of this.state.clouds) {
      const status = cloud.healthy ? '✅' : '❌'
      console.log(
        `║  ${status} ${cloud.provider.toUpperCase().padEnd(6)} ${cloud.region.padEnd(15)} ${cloud.nodeCount.toString().padStart(3)} nodes         ║`,
      )
    }

    console.log(
      '╚══════════════════════════════════════════════════════════════╝',
    )
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })

  if (values.help) {
    console.log(`
Multi-Cloud Coordinator

Usage:
  NETWORK=testnet bun run scripts/infrastructure/multi-cloud-coordinator.ts <command>

Commands:
  discover     Discover cloud deployments
  health       Check health of all clouds
  register     Register nodes on-chain
  setup        Deploy shared infrastructure
  failover     Configure cross-cloud failover
  sync         Sync deployments across clouds
  status       Print current status
  all          Run all commands

Environment:
  NETWORK               Required: localnet, testnet, mainnet
  AWS_REGION            AWS region (default: us-east-1)
  GCP_PROJECT           GCP project ID
  GCP_REGION            GCP region (default: us-central1)
  DEPLOYER_PRIVATE_KEY  For on-chain registration
`)
    process.exit(0)
  }

  const network = getRequiredNetwork()
  const coordinator = new MultiCloudCoordinator(network)

  const command = positionals[0] ?? 'status'

  switch (command) {
    case 'discover':
      await coordinator.discoverClouds()
      break
    case 'health':
      await coordinator.checkHealth()
      break
    case 'register':
      await coordinator.registerNodesOnChain()
      break
    case 'setup':
      await coordinator.deploySharedInfrastructure()
      break
    case 'failover':
      await coordinator.setupFailover()
      break
    case 'sync':
      await coordinator.syncDeployments()
      break
    case 'all':
      await coordinator.discoverClouds()
      await coordinator.checkHealth()
      await coordinator.registerNodesOnChain()
      await coordinator.deploySharedInfrastructure()
      await coordinator.setupFailover()
      break
    default:
      coordinator.printStatus()
  }
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})

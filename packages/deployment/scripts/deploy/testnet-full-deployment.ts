#!/usr/bin/env bun
/**
 * Testnet Full Deployment Script
 *
 * Comprehensive deployment and validation for Jeju testnet:
 * 1. Verify chain connection and DWS infrastructure
 * 2. Deploy missing contracts (ComputeRegistry, DWSMarketplace, etc.)
 * 3. Register marketplace service provisioners (TEE/Phala, AWS, Nitro, inference)
 * 4. Deploy all apps via DWS (workers, SQLit, inference through marketplace)
 * 5. Validate all endpoints
 *
 * Usage:
 *   NETWORK=testnet bun run packages/deployment/scripts/deploy/testnet-full-deployment.ts
 *
 * Environment:
 *   DEPLOYER_PRIVATE_KEY - Private key for deployment
 *   DWS_URL - DWS API endpoint (default: https://dws.testnet.jejunetwork.org)
 */

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  type Hex,
  http,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const ROOT = join(import.meta.dir, '../../../..')
const APPS_DIR = join(ROOT, 'apps')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')
const CONFIG_DIR = join(ROOT, 'packages/config')

// Jeju Testnet chain definition
const jejuTestnet = defineChain({
  id: 420690,
  name: 'Jeju Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.jejunetwork.org'] },
  },
})

const DWS_URL = process.env.DWS_URL ?? 'https://dws.testnet.jejunetwork.org'
const RPC_URL = 'https://testnet-rpc.jejunetwork.org'

// ============================================================================
// Types
// ============================================================================

interface DeploymentStatus {
  chain: {
    connected: boolean
    chainId: number
    blockNumber: bigint
  }
  dws: {
    healthy: boolean
    services: Record<string, boolean>
  }
  contracts: {
    deployed: string[]
    missing: string[]
  }
  marketplace: {
    providers: ProviderInfo[]
  }
  apps: {
    deployed: string[]
    failed: string[]
  }
  endpoints: Record<string, EndpointCheck>
}

interface ProviderInfo {
  name: string
  type: string
  endpoint: string
  status: 'active' | 'inactive' | 'missing'
}

interface EndpointCheck {
  url: string
  status: number
  healthy: boolean
  responseTime: number
}

interface AppManifest {
  name: string
  displayName?: string
  enabled?: boolean
  jns?: { name: string }
  dws?: {
    backend?: {
      enabled: boolean
      runtime: string
      entrypoint: string
    }
    database?: {
      type: string
      name: string
    }
  }
  decentralization?: {
    frontend?: {
      buildDir: string
      jnsName?: string
    }
    worker?: {
      name: string
      entrypoint: string
    }
  }
}

// ============================================================================
// Contracts Configuration
// ============================================================================

// Required contracts for full testnet deployment
const REQUIRED_CONTRACTS = {
  // DWS Infrastructure
  storageManager: 'StorageManager',
  workerRegistry: 'WorkerRegistry',
  cdnRegistry: 'CDNRegistry',
  repoRegistry: 'RepoRegistry',
  packageRegistry: 'PackageRegistry',
  // JNS
  jnsRegistry: 'JNSRegistry',
  jnsResolver: 'JNSResolver',
  jnsRegistrar: 'JNSRegistrar',
  // Compute/Marketplace
  computeRegistry: 'ComputeRegistry',
  dwsMarketplace: 'DWSMarketplace',
  // Governance
  daoRegistry: 'DAORegistry',
  daoFunding: 'DAOFunding',
}

// Marketplace service types
const SERVICE_TYPES = {
  compute: {
    name: 'Compute',
    hash: 'keccak256("compute")',
    providers: [
      {
        name: 'jeju-aws-compute',
        endpoint: 'https://compute.testnet.jejunetwork.org',
        tee: false,
      },
    ],
  },
  inference: {
    name: 'Inference',
    hash: 'keccak256("inference")',
    providers: [
      {
        name: 'jeju-inference',
        endpoint: 'https://dws.testnet.jejunetwork.org/inference',
        tee: false,
      },
    ],
  },
  tee: {
    name: 'TEE (Phala)',
    hash: 'keccak256("tee")',
    providers: [
      {
        name: 'phala-dstack',
        endpoint: 'https://dstack.phala.network',
        tee: true,
        platform: 'phala',
      },
    ],
  },
  nitro: {
    name: 'TEE (AWS Nitro)',
    hash: 'keccak256("nitro")',
    providers: [
      {
        name: 'aws-nitro',
        endpoint: 'https://nitro.testnet.jejunetwork.org',
        tee: true,
        platform: 'nitro',
      },
    ],
  },
  database: {
    name: 'Database (SQLit)',
    hash: 'keccak256("database")',
    providers: [
      {
        name: 'jeju-sqlit',
        endpoint: 'https://dws.testnet.jejunetwork.org/sqlit',
        tee: false,
      },
    ],
  },
  storage: {
    name: 'Storage (IPFS)',
    hash: 'keccak256("storage")',
    providers: [
      {
        name: 'jeju-ipfs',
        endpoint: 'https://dws.testnet.jejunetwork.org/storage',
        tee: false,
      },
    ],
  },
}

// ============================================================================
// Main Deployment Logic
// ============================================================================

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                     JEJU TESTNET FULL DEPLOYMENT                             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  This script will:                                                           ║
║  1. Verify chain connection and DWS infrastructure                          ║
║  2. Deploy missing contracts (ComputeRegistry, DWSMarketplace, etc.)        ║
║  3. Register marketplace service provisioners                                ║
║  4. Deploy all apps via DWS (workers, SQLit, inference)                     ║
║  5. Validate all endpoints                                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY or PRIVATE_KEY environment variable required',
    )
  }

  const account = privateKeyToAccount(privateKey as Hex)
  console.log(`Deployer: ${account.address}`)
  console.log(`RPC URL: ${RPC_URL}`)
  console.log(`DWS URL: ${DWS_URL}`)
  console.log('')

  const publicClient = createPublicClient({
    chain: jejuTestnet,
    transport: http(RPC_URL),
  })

  // WalletClient is available if needed for write operations
  void createWalletClient({
    account,
    chain: jejuTestnet,
    transport: http(RPC_URL),
  })

  const status: DeploymentStatus = {
    chain: { connected: false, chainId: 0, blockNumber: BigInt(0) },
    dws: { healthy: false, services: {} },
    contracts: { deployed: [], missing: [] },
    marketplace: { providers: [] },
    apps: { deployed: [], failed: [] },
    endpoints: {},
  }

  // =========================================================================
  // Phase 1: Verify Chain Connection
  // =========================================================================
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )
  console.log('Phase 1: Verifying Chain Connection')
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )

  const chainId = await publicClient.getChainId()
  const blockNumber = await publicClient.getBlockNumber()
  const balance = await publicClient.getBalance({ address: account.address })

  status.chain = {
    connected: true,
    chainId,
    blockNumber,
  }

  console.log(`  ✅ Connected to chain ${chainId}`)
  console.log(`  ✅ Block number: ${blockNumber}`)
  console.log(`  ✅ Deployer balance: ${formatEther(balance)} ETH`)

  if (balance < BigInt(1e17)) {
    console.log('  ⚠️  Warning: Low balance. May need more ETH for deployment.')
  }
  console.log('')

  // =========================================================================
  // Phase 2: Check DWS Infrastructure
  // =========================================================================
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )
  console.log('Phase 2: Checking DWS Infrastructure')
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )

  const dwsEndpoints = [
    { name: 'health', path: '/health' },
    { name: 'storage', path: '/storage/info' },
    { name: 'sqlit', path: '/sqlit/health' },
    { name: 'workers', path: '/workers/status' },
    { name: 'compute', path: '/compute/status' },
    { name: 'inference', path: '/inference/status' },
  ]

  for (const endpoint of dwsEndpoints) {
    const startTime = Date.now()
    const response = await fetch(`${DWS_URL}${endpoint.path}`, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    const responseTime = Date.now() - startTime
    const healthy = response?.ok ?? false

    status.dws.services[endpoint.name] = healthy
    status.endpoints[endpoint.name] = {
      url: `${DWS_URL}${endpoint.path}`,
      status: response?.status ?? 0,
      healthy,
      responseTime,
    }

    const icon = healthy ? '✅' : '❌'
    console.log(
      `  ${icon} ${endpoint.name}: ${healthy ? 'healthy' : 'not responding'} (${responseTime}ms)`,
    )
  }

  status.dws.healthy = status.dws.services.health ?? false
  console.log('')

  // =========================================================================
  // Phase 3: Check and Deploy Missing Contracts
  // =========================================================================
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )
  console.log('Phase 3: Checking and Deploying Contracts')
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )

  // Load current contract addresses from config
  const contractsConfig = JSON.parse(
    readFileSync(join(CONFIG_DIR, 'contracts.json'), 'utf-8'),
  )
  const testnetContracts = contractsConfig.testnet

  // Check which contracts are deployed
  for (const [key, name] of Object.entries(REQUIRED_CONTRACTS)) {
    // Find address in nested config structure
    const address = findContractAddress(testnetContracts, key)

    if (address && address !== zeroAddress) {
      // Verify contract has code
      const code = await publicClient.getCode({ address: address as Address })
      if (code && code !== '0x' && code.length > 2) {
        status.contracts.deployed.push(name)
        console.log(`  ✅ ${name}: ${address}`)
      } else {
        status.contracts.missing.push(name)
        console.log(`  ❌ ${name}: deployed but no code at ${address}`)
      }
    } else {
      status.contracts.missing.push(name)
      console.log(`  ❌ ${name}: not deployed`)
    }
  }

  // Deploy missing contracts
  if (status.contracts.missing.length > 0) {
    console.log('')
    console.log(
      `  📦 Deploying ${status.contracts.missing.length} missing contracts...`,
    )

    for (const contractName of status.contracts.missing) {
      console.log(`     Deploying ${contractName}...`)
      const deployed = await deployContract(contractName, privateKey as Hex)
      if (deployed) {
        console.log(`     ✅ ${contractName} deployed: ${deployed}`)
        status.contracts.deployed.push(contractName)
        status.contracts.missing = status.contracts.missing.filter(
          (c) => c !== contractName,
        )
      } else {
        console.log(`     ❌ ${contractName} deployment failed`)
      }
    }
  }
  console.log('')

  // =========================================================================
  // Phase 4: Register Marketplace Provisioners
  // =========================================================================
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )
  console.log('Phase 4: Registering Marketplace Service Provisioners')
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )

  for (const [serviceType, config] of Object.entries(SERVICE_TYPES)) {
    console.log(`  📦 ${config.name}:`)

    for (const provider of config.providers) {
      // Check if provider endpoint is reachable
      const response = await fetch(provider.endpoint, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)

      const providerStatus: 'active' | 'inactive' | 'missing' = response?.ok
        ? 'active'
        : response
          ? 'inactive'
          : 'missing'

      status.marketplace.providers.push({
        name: provider.name,
        type: serviceType,
        endpoint: provider.endpoint,
        status: providerStatus,
      })

      const icon =
        providerStatus === 'active'
          ? '✅'
          : providerStatus === 'inactive'
            ? '⚠️'
            : '❌'
      console.log(
        `     ${icon} ${provider.name}: ${providerStatus} (${provider.endpoint})`,
      )

      // If provider not registered, register it
      if (providerStatus === 'missing') {
        console.log(`        ⏳ Registering provider...`)
        // TODO: Call contract to register provider
        // This requires the DWSMarketplace or ComputeRegistry contract
      }
    }
  }
  console.log('')

  // =========================================================================
  // Phase 5: Deploy All Apps
  // =========================================================================
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )
  console.log('Phase 5: Deploying Apps via DWS')
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )

  const apps = discoverApps()
  console.log(`  Found ${apps.length} apps to deploy`)
  console.log('')

  for (const app of apps) {
    console.log(`  📦 ${app.name}:`)

    // Check if already deployed via testnet URL
    const appUrl = `https://${app.name}.testnet.jejunetwork.org`

    const response = await fetch(appUrl, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (response?.ok) {
      status.apps.deployed.push(app.name)
      console.log(`     ✅ Already deployed at ${appUrl}`)
    } else {
      console.log(`     ⏳ Deploying...`)

      const success = await deployApp(app.dir, app.manifest, privateKey as Hex)

      if (success) {
        status.apps.deployed.push(app.name)
        console.log(`     ✅ Deployed successfully`)
      } else {
        status.apps.failed.push(app.name)
        console.log(`     ❌ Deployment failed`)
      }
    }
  }
  console.log('')

  // =========================================================================
  // Phase 6: Validate All Endpoints
  // =========================================================================
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )
  console.log('Phase 6: Validating All Endpoints')
  console.log(
    '═══════════════════════════════════════════════════════════════════════════════',
  )

  const testnetEndpoints = [
    // Core infrastructure
    {
      name: 'RPC',
      url: 'https://testnet-rpc.jejunetwork.org',
      method: 'POST',
      body: '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}',
    },
    {
      name: 'DWS',
      url: 'https://dws.testnet.jejunetwork.org/health',
      method: 'GET',
    },
    {
      name: 'Indexer',
      url: 'https://indexer.testnet.jejunetwork.org/graphql',
      method: 'POST',
      body: '{"query":"{ __typename }"}',
    },
    {
      name: 'Explorer',
      url: 'https://explorer.testnet.jejunetwork.org',
      method: 'GET',
    },
    // Apps
    {
      name: 'Gateway',
      url: 'https://gateway.testnet.jejunetwork.org',
      method: 'GET',
    },
    {
      name: 'Bazaar',
      url: 'https://bazaar.testnet.jejunetwork.org',
      method: 'GET',
    },
    {
      name: 'Crucible',
      url: 'https://crucible.testnet.jejunetwork.org',
      method: 'GET',
    },
    {
      name: 'Autocrat',
      url: 'https://autocrat.testnet.jejunetwork.org',
      method: 'GET',
    },
    {
      name: 'Factory',
      url: 'https://factory.testnet.jejunetwork.org',
      method: 'GET',
    },
    {
      name: 'OAuth3',
      url: 'https://oauth3.testnet.jejunetwork.org/health',
      method: 'GET',
    },
    // External RPCs
    {
      name: 'Eth Sepolia',
      url: 'https://ethereum-sepolia-rpc.publicnode.com',
      method: 'POST',
      body: '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}',
    },
    {
      name: 'Base Sepolia',
      url: 'https://sepolia.base.org',
      method: 'POST',
      body: '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}',
    },
  ]

  for (const endpoint of testnetEndpoints) {
    const startTime = Date.now()
    const response = await fetch(endpoint.url, {
      method: endpoint.method ?? 'GET',
      headers: endpoint.body
        ? { 'Content-Type': 'application/json' }
        : undefined,
      body: endpoint.body,
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    const responseTime = Date.now() - startTime
    const healthy = response?.ok ?? false

    status.endpoints[endpoint.name] = {
      url: endpoint.url,
      status: response?.status ?? 0,
      healthy,
      responseTime,
    }

    const icon = healthy ? '✅' : '❌'
    console.log(
      `  ${icon} ${endpoint.name}: ${response?.status ?? 'N/A'} (${responseTime}ms)`,
    )
  }
  console.log('')

  // =========================================================================
  // Summary Report
  // =========================================================================
  console.log(
    '╔══════════════════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                           DEPLOYMENT SUMMARY                                 ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════════════════════╝',
  )
  console.log('')

  console.log('Chain:')
  console.log(`  Connected: ${status.chain.connected ? '✅' : '❌'}`)
  console.log(`  Chain ID: ${status.chain.chainId}`)
  console.log(`  Block: ${status.chain.blockNumber}`)
  console.log('')

  console.log('DWS Infrastructure:')
  console.log(`  Health: ${status.dws.healthy ? '✅ Healthy' : '❌ Unhealthy'}`)
  for (const [service, healthy] of Object.entries(status.dws.services)) {
    console.log(`  ${service}: ${healthy ? '✅' : '❌'}`)
  }
  console.log('')

  console.log('Contracts:')
  console.log(`  Deployed: ${status.contracts.deployed.length}`)
  for (const contract of status.contracts.deployed) {
    console.log(`    ✅ ${contract}`)
  }
  if (status.contracts.missing.length > 0) {
    console.log(`  Missing: ${status.contracts.missing.length}`)
    for (const contract of status.contracts.missing) {
      console.log(`    ❌ ${contract}`)
    }
  }
  console.log('')

  console.log('Marketplace Providers:')
  for (const provider of status.marketplace.providers) {
    const icon =
      provider.status === 'active'
        ? '✅'
        : provider.status === 'inactive'
          ? '⚠️'
          : '❌'
    console.log(
      `  ${icon} ${provider.name} (${provider.type}): ${provider.status}`,
    )
  }
  console.log('')

  console.log('Apps:')
  console.log(`  Deployed: ${status.apps.deployed.length}`)
  for (const app of status.apps.deployed) {
    console.log(`    ✅ ${app}`)
  }
  if (status.apps.failed.length > 0) {
    console.log(`  Failed: ${status.apps.failed.length}`)
    for (const app of status.apps.failed) {
      console.log(`    ❌ ${app}`)
    }
  }
  console.log('')

  console.log('Endpoints:')
  const healthyEndpoints = Object.values(status.endpoints).filter(
    (e) => e.healthy,
  ).length
  const totalEndpoints = Object.keys(status.endpoints).length
  console.log(`  ${healthyEndpoints}/${totalEndpoints} endpoints healthy`)
  console.log('')

  // Save report
  const reportPath = join(ROOT, 'testnet-deployment-report.json')
  writeFileSync(
    reportPath,
    JSON.stringify(
      status,
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      2,
    ),
  )
  console.log(`Report saved to: ${reportPath}`)
  console.log('')

  // Overall status
  const allHealthy =
    status.chain.connected &&
    status.dws.healthy &&
    status.contracts.missing.length === 0 &&
    status.apps.failed.length === 0 &&
    healthyEndpoints === totalEndpoints

  if (allHealthy) {
    console.log(
      '╔══════════════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║                    ✅ TESTNET FULLY DEPLOYED AND HEALTHY                    ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════════════╝',
    )
  } else {
    console.log(
      '╔══════════════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║               ⚠️  TESTNET DEPLOYMENT INCOMPLETE - SEE ABOVE                 ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')
    console.log('Next steps to fix:')
    if (!status.chain.connected) {
      console.log('  1. Check RPC endpoint connectivity')
    }
    if (!status.dws.healthy) {
      console.log('  2. Deploy/restart DWS infrastructure')
    }
    if (status.contracts.missing.length > 0) {
      console.log(
        `  3. Deploy missing contracts: ${status.contracts.missing.join(', ')}`,
      )
    }
    if (status.apps.failed.length > 0) {
      console.log(
        `  4. Fix and redeploy failed apps: ${status.apps.failed.join(', ')}`,
      )
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function findContractAddress(
  config: Record<string, unknown>,
  key: string,
): string | null {
  // Direct lookup
  if (typeof config[key] === 'string') {
    return config[key] as string
  }

  // Check nested objects
  for (const value of Object.values(config)) {
    if (typeof value === 'object' && value !== null) {
      const nested = value as Record<string, unknown>
      if (typeof nested[key] === 'string') {
        return nested[key] as string
      }
    }
  }

  return null
}

async function deployContract(
  contractName: string,
  privateKey: Hex,
): Promise<string | null> {
  // Map contract names to deployment scripts
  const scriptMap: Record<string, string> = {
    ComputeRegistry: 'DeployComputeRegistry.s.sol',
    DWSMarketplace: 'DeployDWSMarketplace.s.sol',
    StorageManager: 'DeployDWS.s.sol',
    WorkerRegistry: 'DeployDWS.s.sol',
    CDNRegistry: 'DeployDWS.s.sol',
  }

  const script = scriptMap[contractName]
  if (!script) {
    console.log(`        No deployment script found for ${contractName}`)
    return null
  }

  try {
    const cmd = `cd ${CONTRACTS_DIR} && forge script script/${script} --rpc-url ${RPC_URL} --private-key ${privateKey} --broadcast --legacy 2>&1`
    const output = execSync(cmd, {
      encoding: 'utf-8',
      maxBuffer: 100 * 1024 * 1024,
    })

    // Extract address from output
    const addressMatch = output.match(
      new RegExp(`${contractName}:\\s*(0x[a-fA-F0-9]{40})`),
    )
    return addressMatch ? addressMatch[1] : null
  } catch (error) {
    console.error(`        Error deploying ${contractName}:`, error)
    return null
  }
}

function discoverApps(): Array<{
  name: string
  dir: string
  manifest: AppManifest
}> {
  const apps: Array<{ name: string; dir: string; manifest: AppManifest }> = []

  const appDirs = readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  for (const appName of appDirs) {
    const appDir = join(APPS_DIR, appName)
    const manifestPath = join(appDir, 'jeju-manifest.json')

    if (!existsSync(manifestPath)) continue

    const manifest: AppManifest = JSON.parse(
      readFileSync(manifestPath, 'utf-8'),
    )

    // Skip disabled apps
    if (manifest.enabled === false) continue

    // Skip apps without decentralization config
    if (!manifest.decentralization && !manifest.dws) continue

    apps.push({ name: appName, dir: appDir, manifest })
  }

  return apps
}

async function deployApp(
  _appDir: string,
  manifest: AppManifest,
  privateKey: Hex,
): Promise<boolean> {
  try {
    // Use the deploy-app script
    const cmd = `NETWORK=testnet PRIVATE_KEY=${privateKey} bun run ${join(ROOT, 'packages/deployment/scripts/deploy/deploy-app.ts')} --name ${manifest.name}`
    execSync(cmd, {
      encoding: 'utf-8',
      stdio: 'pipe',
      maxBuffer: 100 * 1024 * 1024,
    })
    return true
  } catch (error) {
    console.error(`        Error deploying ${manifest.name}:`, error)
    return false
  }
}

// ============================================================================
// Run
// ============================================================================

main().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})

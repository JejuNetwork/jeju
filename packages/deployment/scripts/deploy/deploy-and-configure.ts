#!/usr/bin/env bun
/**
 * Oracle Network Deployment and Configuration
 *
 * Deploys oracle contracts and configures the oracle node for the specified network.
 *
 * Usage:
 *   bun run scripts/oracle/deploy-and-configure.ts --network=<network> [options]
 *
 * Options:
 *   --network=<network>   Network: localnet, testnet, mainnet
 *   --deploy              Deploy contracts (default: false)
 *   --configure           Configure oracle node (default: true)
 *   --verify              Verify contracts on block explorer
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type NetworkType = 'localnet' | 'testnet' | 'mainnet'

interface DeployedAddresses {
  feedRegistry: string
  reportVerifier: string
  committeeManager: string
  feeRouter: string
  networkConnector: string
  disputeGame: string
}

const NETWORK_CONFIG: Record<
  NetworkType,
  { chainId: number; rpcEnvVar: string; verifyApi?: string }
> = {
  localnet: { chainId: 31337, rpcEnvVar: 'RPC_URL' },
  testnet: {
    chainId: 84532,
    rpcEnvVar: 'BASE_SEPOLIA_RPC_URL',
    verifyApi: 'basescan',
  },
  mainnet: {
    chainId: 8453,
    rpcEnvVar: 'BASE_MAINNET_RPC_URL',
    verifyApi: 'basescan',
  },
}

function parseArgs(): {
  network: NetworkType
  deploy: boolean
  configure: boolean
  verify: boolean
} {
  const args = process.argv.slice(2)
  let network: NetworkType = 'localnet'
  let deploy = false
  let configure = true
  let verify = false

  for (const arg of args) {
    if (arg.startsWith('--network=')) {
      network = arg.split('=')[1] as NetworkType
    } else if (arg === '--deploy') {
      deploy = true
    } else if (arg === '--configure') {
      configure = true
    } else if (arg === '--no-configure') {
      configure = false
    } else if (arg === '--verify') {
      verify = true
    }
  }

  return { network, deploy, configure, verify }
}

function getRpcUrl(network: NetworkType): string {
  const config = NETWORK_CONFIG[network]
  const rpcUrl =
    process.env[config.rpcEnvVar] ||
    (network === 'localnet' ? 'http://localhost:6546' : undefined)

  if (!rpcUrl) {
    throw new Error(`${config.rpcEnvVar} environment variable not set`)
  }

  return rpcUrl
}

async function deployContracts(
  network: NetworkType,
  rpcUrl: string,
  verify: boolean,
): Promise<DeployedAddresses> {
  console.log(`\n[Deploy] Deploying oracle contracts to ${network}...`)

  const contractsDir = path.join(process.cwd(), 'packages/contracts')

  // Build command
  let forgeCmd = `forge script script/DeployOracleNetwork.s.sol:DeployOracleNetwork --rpc-url ${rpcUrl} --broadcast`

  if (verify && NETWORK_CONFIG[network].verifyApi) {
    forgeCmd += ` --verify --etherscan-api-key ${process.env.ETHERSCAN_API_KEY}`
  }

  console.log(`[Deploy] Running: ${forgeCmd}`)

  // Execute deployment
  const result = execSync(forgeCmd, {
    cwd: contractsDir,
    encoding: 'utf-8',
    env: { ...process.env, PRIVATE_KEY: process.env.OPERATOR_PRIVATE_KEY },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  console.log(result)

  // Parse deployed addresses from broadcast output
  const broadcastDir = path.join(
    contractsDir,
    'broadcast/DeployOracleNetwork.s.sol',
    String(NETWORK_CONFIG[network].chainId),
    'run-latest.json',
  )

  if (!existsSync(broadcastDir)) {
    throw new Error(`Broadcast output not found: ${broadcastDir}`)
  }

  const broadcast = JSON.parse(readFileSync(broadcastDir, 'utf-8'))
  const addresses: Partial<DeployedAddresses> = {}

  for (const tx of broadcast.transactions) {
    if (tx.transactionType === 'CREATE') {
      const name = tx.contractName
      const addr = tx.contractAddress

      if (name === 'FeedRegistry') addresses.feedRegistry = addr
      if (name === 'ReportVerifier') addresses.reportVerifier = addr
      if (name === 'CommitteeManager') addresses.committeeManager = addr
      if (name === 'OracleFeeRouter') addresses.feeRouter = addr
      if (name === 'OracleNetworkConnector') addresses.networkConnector = addr
      if (name === 'DisputeGame') addresses.disputeGame = addr
    }
  }

  console.log('\n[Deploy] Deployed addresses:')
  for (const [name, addr] of Object.entries(addresses)) {
    console.log(`  ${name}: ${addr}`)
  }

  return addresses as DeployedAddresses
}

function updateNetworkConfig(
  network: NetworkType,
  addresses: DeployedAddresses,
): void {
  console.log(`\n[Config] Updating network configuration...`)

  const configPath = path.join(
    process.cwd(),
    'packages/config/oracle/networks.json',
  )
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))

  config[network].contracts = {
    feedRegistry: addresses.feedRegistry,
    reportVerifier: addresses.reportVerifier,
    committeeManager: addresses.committeeManager,
    feeRouter: addresses.feeRouter,
    networkConnector: addresses.networkConnector,
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2))
  console.log(`[Config] Updated ${configPath}`)
}

function createEnvFile(
  network: NetworkType,
  addresses: DeployedAddresses,
): void {
  console.log(`\n[Config] Creating oracle .env file...`)

  const envPath = path.join(process.cwd(), 'apps/gateway/.env.oracle')

  const envContent = `# Oracle Node Configuration for ${network}
# Generated by deploy-and-configure.ts

JEJU_NETWORK=${network}

# Contract Addresses
FEED_REGISTRY_ADDRESS=${addresses.feedRegistry}
REPORT_VERIFIER_ADDRESS=${addresses.reportVerifier}
COMMITTEE_MANAGER_ADDRESS=${addresses.committeeManager}
FEE_ROUTER_ADDRESS=${addresses.feeRouter}
NETWORK_CONNECTOR_ADDRESS=${addresses.networkConnector}

# Copy your keys from root .env
# OPERATOR_PRIVATE_KEY=
# WORKER_PRIVATE_KEY=
`

  writeFileSync(envPath, envContent)
  console.log(`[Config] Created ${envPath}`)
}

function updateGatewayConfig(
  network: NetworkType,
  addresses: DeployedAddresses,
): void {
  console.log(`\n[Config] Updating gateway oracle configuration...`)

  const gatewayConfigPath = path.join(
    process.cwd(),
    'apps/gateway/src/lib/oracleNetwork.ts',
  )

  const content = `// Auto-generated by deploy-and-configure.ts
// Network: ${network}

import type { Address } from 'viem';

export const ORACLE_NETWORK_ADDRESSES = {
  feedRegistry: '${addresses.feedRegistry}' as Address,
  reportVerifier: '${addresses.reportVerifier}' as Address,
  committeeManager: '${addresses.committeeManager}' as Address,
  feeRouter: '${addresses.feeRouter}' as Address,
  networkConnector: '${addresses.networkConnector}' as Address,
} as const;

export const ORACLE_FEED_REGISTRY_ABI = [
  { type: 'function', name: 'getAllFeeds', inputs: [], outputs: [{ type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getActiveFeeds', inputs: [], outputs: [{ type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getFeed', inputs: [{ name: 'feedId', type: 'bytes32' }], outputs: [{ type: 'tuple', components: [
    { name: 'feedId', type: 'bytes32' },
    { name: 'symbol', type: 'string' },
    { name: 'baseToken', type: 'address' },
    { name: 'quoteToken', type: 'address' },
    { name: 'decimals', type: 'uint8' },
    { name: 'heartbeatSeconds', type: 'uint32' },
    { name: 'twapWindowSeconds', type: 'uint32' },
    { name: 'minLiquidityUSD', type: 'uint256' },
    { name: 'maxDeviationBps', type: 'uint16' },
    { name: 'minOracles', type: 'uint8' },
    { name: 'quorumThreshold', type: 'uint8' },
    { name: 'isActive', type: 'bool' },
    { name: 'requiresConfidence', type: 'bool' },
    { name: 'category', type: 'uint8' },
  ]}], stateMutability: 'view' },
] as const;

export const ORACLE_REPORT_VERIFIER_ABI = [
  { type: 'function', name: 'getLatestPrice', inputs: [{ name: 'feedId', type: 'bytes32' }], outputs: [
    { name: 'price', type: 'uint256' },
    { name: 'confidence', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'isValid', type: 'bool' },
  ], stateMutability: 'view' },
  { type: 'function', name: 'getCurrentRound', inputs: [{ name: 'feedId', type: 'bytes32' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;
`

  writeFileSync(gatewayConfigPath, content)
  console.log(`[Config] Updated ${gatewayConfigPath}`)
}

function updateIndexerConfig(
  network: NetworkType,
  addresses: DeployedAddresses,
): void {
  console.log(`\n[Config] Updating indexer oracle configuration...`)

  const indexerConfigPath = path.join(
    process.cwd(),
    'apps/indexer/src/oracle-addresses.ts',
  )

  const content = `// Auto-generated by deploy-and-configure.ts
// Network: ${network}

export const ORACLE_ADDRESSES = {
  feedRegistry: '${addresses.feedRegistry}',
  reportVerifier: '${addresses.reportVerifier}',
  committeeManager: '${addresses.committeeManager}',
  feeRouter: '${addresses.feeRouter}',
  networkConnector: '${addresses.networkConnector}',
} as const;

export const ORACLE_START_BLOCK = 0; // Update this after deployment
`

  writeFileSync(indexerConfigPath, content)
  console.log(`[Config] Updated ${indexerConfigPath}`)
}

async function main(): Promise<void> {
  const { network, deploy, configure, verify } = parseArgs()

  console.log('='.repeat(60))
  console.log('  Oracle Network Deployment & Configuration')
  console.log('='.repeat(60))
  console.log(`  Network: ${network}`)
  console.log(`  Deploy:  ${deploy}`)
  console.log(`  Configure: ${configure}`)
  console.log(`  Verify:  ${verify}`)
  console.log('='.repeat(60))

  const rpcUrl = getRpcUrl(network)
  let addresses: DeployedAddresses

  if (deploy) {
    addresses = await deployContracts(network, rpcUrl, verify)
  } else {
    // Load existing addresses from config
    const configPath = path.join(
      process.cwd(),
      'packages/config/oracle/networks.json',
    )
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))

    if (!config[network].contracts.feedRegistry) {
      throw new Error(
        `No deployed contracts found for ${network}. Run with --deploy first.`,
      )
    }

    addresses = config[network].contracts as DeployedAddresses
    console.log(`\n[Config] Using existing addresses from config`)
  }

  if (configure) {
    if (deploy) {
      updateNetworkConfig(network, addresses)
    }
    createEnvFile(network, addresses)
    updateGatewayConfig(network, addresses)
    updateIndexerConfig(network, addresses)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('  Deployment Complete!')
  console.log('='.repeat(60))
  console.log(`
Next steps:
  1. Copy OPERATOR_PRIVATE_KEY and WORKER_PRIVATE_KEY to apps/gateway/.env.oracle
  2. Start the oracle node:
     cd apps/gateway && bun run dev:oracle --network=${network}
  3. Start the indexer:
     cd apps/indexer && bun run dev
  4. Monitor metrics at http://localhost:9090/metrics
`)
}

main().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})

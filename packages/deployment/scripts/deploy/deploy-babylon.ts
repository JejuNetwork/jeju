#!/usr/bin/env bun

/**
 * Deploy Babylon contracts to Jeju testnet or localnet
 *
 * Usage:
 *   NETWORK=testnet bun run scripts/deploy/deploy-babylon.ts
 *   NETWORK=localnet bun run scripts/deploy/deploy-babylon.ts
 *
 * Environment variables:
 *   - PRIVATE_KEY: Deployer private key
 *   - OWNER_ADDRESS: Owner address (defaults to deployer)
 *   - AI_CEO_ADDRESS: AI CEO address (defaults to owner)
 *   - VERIFY: Set to "true" to verify contracts on explorer
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import { parseArgs } from 'node:util'

const ROOT = join(import.meta.dir, '../..')
const BABYLON_ROOT = join(ROOT, '../../vendor/babylon')
const CONTRACTS_DIR = join(BABYLON_ROOT, 'packages/contracts')
const CONFIG_DIR = join(ROOT, '../config')

interface NetworkConfig {
  chainId: number
  rpcUrl: string
  explorerUrl: string
}

const NETWORKS: Record<string, NetworkConfig> = {
  localnet: {
    chainId: 1337,
    rpcUrl: 'http://127.0.0.1:6546',
    explorerUrl: '',
  },
  anvil: {
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:6545',
    explorerUrl: '',
  },
  testnet: {
    chainId: 420690,
    rpcUrl: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
    explorerUrl: 'https://explorer.testnet.jejunetwork.org',
  },
  mainnet: {
    chainId: 420691,
    rpcUrl: process.env.JEJU_MAINNET_RPC_URL || 'https://rpc.jejunetwork.org',
    explorerUrl: 'https://explorer.jejunetwork.org',
  },
}

interface DeployedContracts {
  network: string
  chainId: number
  deployer: string
  timestamp: string
  contracts: {
    BBLNToken: string
    BabylonTreasury: string
    BabylonAgentVault: string
    BabylonDAO: string
    TrainingOrchestrator: string
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      network: { type: 'string', short: 'n', default: process.env.NETWORK || 'localnet' },
      verify: { type: 'boolean', short: 'v', default: process.env.VERIFY === 'true' },
      'dry-run': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })

  const network = values.network as string
  const verify = values.verify
  const dryRun = values['dry-run']

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🏛️  BABYLON CONTRACTS DEPLOYMENT                          ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`)

  console.log(`Network: ${network}`)
  console.log(`Verify: ${verify}`)
  console.log(`Dry Run: ${dryRun}`)
  console.log('')

  const networkConfig = NETWORKS[network]
  if (!networkConfig) {
    throw new Error(`Unknown network: ${network}. Available: ${Object.keys(NETWORKS).join(', ')}`)
  }

  // Check for private key
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey && !dryRun) {
    throw new Error('PRIVATE_KEY environment variable is required')
  }

  // Check if contracts directory exists
  if (!existsSync(CONTRACTS_DIR)) {
    throw new Error(`Contracts directory not found: ${CONTRACTS_DIR}`)
  }

  console.log('📋 Building contracts...')
  const buildResult = await $`cd ${CONTRACTS_DIR} && forge build --root ${BABYLON_ROOT}`.nothrow()
  if (buildResult.exitCode !== 0) {
    console.log('⚠️  Build warning (may be ok if contracts exist)')
  } else {
    console.log('✅ Contracts built')
  }

  if (dryRun) {
    console.log('\n🔍 Dry run - skipping deployment')
    console.log('Would deploy to:', networkConfig.rpcUrl)
    return
  }

  // Run forge script
  console.log('\n🚀 Deploying contracts...')

  const forgeArgs = [
    'script',
    'script/DeployAll.s.sol:DeployAll',
    '--rpc-url', networkConfig.rpcUrl,
    '--broadcast',
    '-vvv',
  ]

  if (verify && networkConfig.explorerUrl) {
    forgeArgs.push('--verify')
  }

  const deployResult = await $`cd ${CONTRACTS_DIR} && FOUNDRY_PROFILE=packages forge ${forgeArgs}`.env({
    PRIVATE_KEY: privateKey,
    OWNER_ADDRESS: process.env.OWNER_ADDRESS || '',
    AI_CEO_ADDRESS: process.env.AI_CEO_ADDRESS || '',
  })

  if (deployResult.exitCode !== 0) {
    throw new Error('Deployment failed')
  }

  console.log('\n✅ Deployment complete!')

  // Parse deployed addresses from output
  const output = deployResult.stdout.toString()
  const addresses = parseDeployedAddresses(output)

  if (addresses) {
    console.log('\n📋 Deployed Contracts:')
    console.log(JSON.stringify(addresses, null, 2))

    // Save to deployment file
    const deploymentsDir = join(CONTRACTS_DIR, 'deployments', network)
    mkdirSync(deploymentsDir, { recursive: true })

    const deploymentFile = join(deploymentsDir, 'babylon.json')
    const deployment: DeployedContracts = {
      network,
      chainId: networkConfig.chainId,
      deployer: addresses.deployer || '',
      timestamp: new Date().toISOString(),
      contracts: {
        BBLNToken: addresses.BBLNToken || '',
        BabylonTreasury: addresses.BabylonTreasury || '',
        BabylonAgentVault: addresses.BabylonAgentVault || '',
        BabylonDAO: addresses.BabylonDAO || '',
        TrainingOrchestrator: addresses.TrainingOrchestrator || '',
      },
    }

    writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2))
    console.log(`\n💾 Saved to: ${deploymentFile}`)

    // Update main contracts.json if exists
    await updateContractsJson(network, deployment)
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ✅ BABYLON DEPLOYMENT COMPLETE                             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`)
}

function parseDeployedAddresses(output: string): Record<string, string> | null {
  const addresses: Record<string, string> = {}

  // Parse addresses from console output
  const patterns = [
    /BBLNToken:\s*(0x[a-fA-F0-9]{40})/,
    /BabylonTreasury:\s*(0x[a-fA-F0-9]{40})/,
    /BabylonAgentVault:\s*(0x[a-fA-F0-9]{40})/,
    /BabylonDAO:\s*(0x[a-fA-F0-9]{40})/,
    /TrainingOrchestrator:\s*(0x[a-fA-F0-9]{40})/,
    /Deployer:\s*(0x[a-fA-F0-9]{40})/,
  ]

  const names = ['BBLNToken', 'BabylonTreasury', 'BabylonAgentVault', 'BabylonDAO', 'TrainingOrchestrator', 'deployer']

  for (let i = 0; i < patterns.length; i++) {
    const match = output.match(patterns[i])
    if (match) {
      addresses[names[i]] = match[1]
    }
  }

  return Object.keys(addresses).length > 0 ? addresses : null
}

async function updateContractsJson(network: string, deployment: DeployedContracts): Promise<void> {
  const contractsJsonPath = join(CONFIG_DIR, 'contracts.json')

  if (!existsSync(contractsJsonPath)) {
    console.log('⚠️  contracts.json not found, skipping update')
    return
  }

  const contracts = JSON.parse(readFileSync(contractsJsonPath, 'utf-8'))

  // Add Babylon contracts section
  const networkKey = network === 'testnet' ? 'testnet' : network === 'mainnet' ? 'mainnet' : 'localnet'

  if (!contracts[networkKey]) {
    contracts[networkKey] = {}
  }

  contracts[networkKey].babylon = {
    BBLNToken: deployment.contracts.BBLNToken,
    BabylonTreasury: deployment.contracts.BabylonTreasury,
    BabylonAgentVault: deployment.contracts.BabylonAgentVault,
    BabylonDAO: deployment.contracts.BabylonDAO,
    TrainingOrchestrator: deployment.contracts.TrainingOrchestrator,
  }

  contracts.lastUpdated = new Date().toISOString().split('T')[0]

  writeFileSync(contractsJsonPath, JSON.stringify(contracts, null, 2))
  console.log(`\n📝 Updated: ${contractsJsonPath}`)
}

main().catch((err: Error) => {
  console.error('\n❌ Deployment failed:', err.message)
  process.exit(1)
})

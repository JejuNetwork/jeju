/**
 * Deploy DA Layer Contracts
 *
 * Deploys DAOperatorRegistry, DABlobRegistry, and DAAttestationManager
 *
 * Usage:
 *   bun scripts/deploy/deploy-da.ts [--network testnet|mainnet|localnet]
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const CONTRACTS_DIR = path.join(import.meta.dir, '../../packages/contracts')
const DEPLOYMENTS_DIR = path.join(CONTRACTS_DIR, 'deployments')

interface DADeployment {
  network: string
  chainId: number
  deployer: string
  timestamp: number
  contracts: {
    DAOperatorRegistry: string
    DABlobRegistry: string
    DAAttestationManager: string
  }
  config: {
    minOperatorStake: string
    submissionFee: string
    identityRegistry: string
    banManager: string
  }
}

function getNetworkConfig(network: string): {
  rpcUrl: string
  chainId: number
} {
  switch (network) {
    case 'mainnet':
      return {
        rpcUrl: process.env.BASE_MAINNET_RPC_URL ?? 'https://mainnet.base.org',
        chainId: 8453,
      }
    case 'testnet':
      return {
        rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
        chainId: 84532,
      }
    default:
      return {
        rpcUrl: process.env.LOCAL_RPC_URL ?? 'http://localhost:6545',
        chainId: 1337,
      }
  }
}

function loadExistingDeployments(network: string): Record<string, string> {
  const files = [`${network}.json`, `localnet.json`, 'addresses.json']

  for (const file of files) {
    const filepath = path.join(DEPLOYMENTS_DIR, file)
    if (existsSync(filepath)) {
      const content = JSON.parse(readFileSync(filepath, 'utf-8'))
      return {
        identityRegistry:
          content.IdentityRegistry ?? content.identityRegistry ?? '',
        banManager: content.BanManager ?? content.banManager ?? '',
      }
    }
  }

  return { identityRegistry: '', banManager: '' }
}

async function deploy(network: string): Promise<DADeployment> {
  console.log(`\nDeploying DA Layer to ${network}...`)

  const { rpcUrl, chainId } = getNetworkConfig(network)
  const existingDeployments = loadExistingDeployments(network)

  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable required')
  }

  // Set environment for forge script
  const env = {
    ...process.env,
    PRIVATE_KEY: privateKey,
    IDENTITY_REGISTRY:
      existingDeployments.identityRegistry ||
      '0x0000000000000000000000000000000000000000',
    BAN_MANAGER:
      existingDeployments.banManager ||
      '0x0000000000000000000000000000000000000000',
  }

  // Run forge script
  const cmd = [
    'forge',
    'script',
    'script/DeployDA.s.sol:DeployDA',
    '--rpc-url',
    rpcUrl,
    '--broadcast',
    '--json',
    '-vvv',
  ].join(' ')

  console.log(`Running: ${cmd}`)

  let output: string
  try {
    output = execSync(cmd, {
      cwd: CONTRACTS_DIR,
      env,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message: string }
    console.error('Deployment failed:', error.stderr ?? error.message)
    throw err
  }

  // Parse deployed addresses from output
  const operatorRegistryMatch = output.match(
    /DAOperatorRegistry deployed at: (0x[a-fA-F0-9]{40})/,
  )
  const blobRegistryMatch = output.match(
    /DABlobRegistry deployed at: (0x[a-fA-F0-9]{40})/,
  )
  const attestationManagerMatch = output.match(
    /DAAttestationManager deployed at: (0x[a-fA-F0-9]{40})/,
  )

  if (
    !operatorRegistryMatch ||
    !blobRegistryMatch ||
    !attestationManagerMatch
  ) {
    console.log('Output:', output)
    throw new Error('Could not parse deployed addresses from output')
  }

  const deployment: DADeployment = {
    network,
    chainId,
    deployer: process.env.DEPLOYER_ADDRESS ?? '',
    timestamp: Date.now(),
    contracts: {
      DAOperatorRegistry: operatorRegistryMatch[1],
      DABlobRegistry: blobRegistryMatch[1],
      DAAttestationManager: attestationManagerMatch[1],
    },
    config: {
      minOperatorStake: '0.1',
      submissionFee: '0.001',
      identityRegistry: existingDeployments.identityRegistry,
      banManager: existingDeployments.banManager,
    },
  }

  // Save deployment
  const deploymentPath = path.join(DEPLOYMENTS_DIR, `da-${network}.json`)
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2))
  console.log(`\nDeployment saved to: ${deploymentPath}`)

  return deployment
}

// Main
const network = process.argv.includes('--network')
  ? process.argv[process.argv.indexOf('--network') + 1]
  : 'localnet'

deploy(network)
  .then((deployment) => {
    console.log('\n=== DA Layer Deployment Complete ===')
    console.log('Network:', deployment.network)
    console.log('Chain ID:', deployment.chainId)
    console.log('\nContracts:')
    console.log(
      '  DAOperatorRegistry:',
      deployment.contracts.DAOperatorRegistry,
    )
    console.log('  DABlobRegistry:', deployment.contracts.DABlobRegistry)
    console.log(
      '  DAAttestationManager:',
      deployment.contracts.DAAttestationManager,
    )
  })
  .catch((err) => {
    console.error('Deployment failed:', err)
    process.exit(1)
  })

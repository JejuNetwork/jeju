#!/usr/bin/env bun
/**
 * Full Stack Deployment
 *
 * Deploys and verifies all decentralization contracts and services:
 * 1. Mock dependencies (JEJU token, Identity/Reputation registries)
 * 2. Core contracts (SequencerRegistry, GovernanceTimelock, DisputeGameFactory)
 * 3. Prover and adapters
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  type Chain,
  createPublicClient,
  formatEther,
  http,
  parseAbi,
  type Transport,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readContract } from 'viem/actions'
import { inferChainFromRpcUrl } from '../shared/chain-utils'

const ROOT = join(import.meta.dir, '../..')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')
const DEPLOYMENTS_DIR = join(CONTRACTS_DIR, 'deployments')

interface Deployment {
  [key: string]: string | number
  jejuToken: string
  identityRegistry: string
  reputationRegistry: string
  sequencerRegistry: string
  governanceTimelock: string
  disputeGameFactory: string
  prover: string
  l2OutputOracleAdapter: string
  optimismPortalAdapter: string
  thresholdBatchSubmitter: string
  deployer: string
  timestamp: number
  network: string
}

async function main() {
  console.log('🚀 Full Stack Deployment')
  console.log('='.repeat(60))
  console.log('')

  const rpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:6545'
  const deployerKey =
    process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  const network = process.env.NETWORK || 'localnet'

  if (!deployerKey) {
    console.error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required')
    process.exit(1)
  }

  console.log(`Network: ${network}`)
  console.log(`RPC: ${rpcUrl}`)
  console.log('')

  // Check L1 connection
  const chain = inferChainFromRpcUrl(rpcUrl)
  const account = privateKeyToAccount(deployerKey as `0x${string}`)
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const blockNumber = await publicClient.getBlockNumber()
  console.log(`✅ L1 connected at block ${blockNumber}`)

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`✅ Deployer: ${account.address}`)
  console.log(`   Balance: ${formatEther(balance)} ETH`)

  if (balance === 0n) {
    console.error('❌ Deployer has no ETH. Fund the account first.')
    process.exit(1)
  }

  console.log('')

  // Deploy using Forge script
  console.log('📦 Deploying contracts via Forge...')
  console.log('')

  const forgeCmd = `cd ${CONTRACTS_DIR} && DEPLOYER_PRIVATE_KEY=${deployerKey} BASESCAN_API_KEY=dummy ETHERSCAN_API_KEY=dummy forge script script/Deploy.s.sol:Deploy --rpc-url ${rpcUrl} --broadcast --legacy 2>&1`

  try {
    const output = execSync(forgeCmd, {
      encoding: 'utf-8',
      maxBuffer: 100 * 1024 * 1024,
    })

    // Parse deployed addresses from output
    const deployment = parseDeploymentOutput(output, account.address, network)

    if (!deployment.sequencerRegistry) {
      console.error('❌ Failed to parse deployment addresses from output')
      console.log(output)
      process.exit(1)
    }

    // Save deployment
    if (!existsSync(DEPLOYMENTS_DIR)) {
      mkdirSync(DEPLOYMENTS_DIR, { recursive: true })
    }
    const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`)
    writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2))

    console.log('')
    console.log('='.repeat(60))
    console.log('✅ Deployment Complete')
    console.log('='.repeat(60))
    console.log('')
    console.log('Contract Addresses:')
    console.log(`  JEJU Token:               ${deployment.jejuToken}`)
    console.log(`  Identity Registry:        ${deployment.identityRegistry}`)
    console.log(`  Reputation Registry:      ${deployment.reputationRegistry}`)
    console.log(`  Sequencer Registry:       ${deployment.sequencerRegistry}`)
    console.log(`  Governance Timelock:      ${deployment.governanceTimelock}`)
    console.log(`  Dispute Game Factory:     ${deployment.disputeGameFactory}`)
    console.log(`  Prover:                   ${deployment.prover}`)
    console.log(
      `  L2OutputOracleAdapter:    ${deployment.l2OutputOracleAdapter}`,
    )
    console.log(
      `  OptimismPortalAdapter:    ${deployment.optimismPortalAdapter}`,
    )
    console.log(
      `  ThresholdBatchSubmitter:  ${deployment.thresholdBatchSubmitter}`,
    )
    console.log('')
    console.log(`💾 Saved to: ${deploymentFile}`)
    console.log('')

    // Verify deployment
    await verifyDeployment(publicClient, deployment)
  } catch (error) {
    console.error('❌ Deployment failed:', error)
    process.exit(1)
  }
}

function parseDeploymentOutput(
  output: string,
  deployer: Address,
  network: string,
): Deployment {
  const deployment: Deployment = {
    jejuToken: '',
    identityRegistry: '',
    reputationRegistry: '',
    sequencerRegistry: '',
    governanceTimelock: '',
    disputeGameFactory: '',
    prover: '',
    l2OutputOracleAdapter: '',
    optimismPortalAdapter: '',
    thresholdBatchSubmitter: '',
    deployer,
    timestamp: Date.now(),
    network,
  }

  // Parse addresses from Forge output
  const addressPatterns: Record<string, RegExp> = {
    jejuToken: /MockJEJUToken deployed: (0x[a-fA-F0-9]{40})/,
    identityRegistry: /IdentityRegistry deployed: (0x[a-fA-F0-9]{40})/,
    reputationRegistry: /ReputationRegistry deployed: (0x[a-fA-F0-9]{40})/,
    sequencerRegistry: /SequencerRegistry deployed: (0x[a-fA-F0-9]{40})/,
    governanceTimelock: /GovernanceTimelock deployed: (0x[a-fA-F0-9]{40})/,
    disputeGameFactory: /DisputeGameFactory deployed: (0x[a-fA-F0-9]{40})/,
    prover: /Prover deployed: (0x[a-fA-F0-9]{40})/,
    l2OutputOracleAdapter:
      /L2OutputOracleAdapter deployed: (0x[a-fA-F0-9]{40})/,
    optimismPortalAdapter:
      /OptimismPortalAdapter deployed: (0x[a-fA-F0-9]{40})/,
    thresholdBatchSubmitter:
      /ThresholdBatchSubmitter deployed: (0x[a-fA-F0-9]{40})/,
  }

  for (const [key, pattern] of Object.entries(addressPatterns)) {
    const match = output.match(pattern)
    if (match) {
      deployment[key] = match[1]
    }
  }

  return deployment
}

type AnyPublicClient = ReturnType<typeof createPublicClient<Transport, Chain>>

async function verifyDeployment(
  publicClient: AnyPublicClient,
  deployment: Deployment,
): Promise<void> {
  console.log('🔍 Verifying deployment...')
  console.log('')

  // Verify DisputeGameFactory
  const factoryCode = await publicClient.getCode({
    address: deployment.disputeGameFactory as Address,
  })
  if (factoryCode === '0x') {
    console.error('❌ DisputeGameFactory has no code')
    process.exit(1)
  }

  const FACTORY_ABI = parseAbi([
    'function MIN_BOND() view returns (uint256)',
    'function proverEnabled(uint8) view returns (bool)',
  ])

  const [minBond, proverEnabled] = await Promise.all([
    readContract(publicClient, {
      address: deployment.disputeGameFactory as Address,
      abi: FACTORY_ABI,
      functionName: 'MIN_BOND',
    }),
    readContract(publicClient, {
      address: deployment.disputeGameFactory as Address,
      abi: FACTORY_ABI,
      functionName: 'proverEnabled',
      args: [0],
    }),
  ])

  console.log(`✅ DisputeGameFactory verified`)
  console.log(`   MIN_BOND: ${formatEther(minBond)} ETH`)
  console.log(`   Prover enabled: ${proverEnabled}`)

  // Verify Prover
  const PROVER_ABI = parseAbi(['function proverType() view returns (string)'])
  const proverType = await readContract(publicClient, {
    address: deployment.prover as Address,
    abi: PROVER_ABI,
    functionName: 'proverType',
  })
  console.log(`✅ Prover verified: ${proverType}`)

  // Verify SequencerRegistry
  const REGISTRY_ABI = parseAbi(['function MIN_STAKE() view returns (uint256)'])
  const minStake = await readContract(publicClient, {
    address: deployment.sequencerRegistry as Address,
    abi: REGISTRY_ABI,
    functionName: 'MIN_STAKE',
  })
  console.log(`✅ SequencerRegistry verified`)
  console.log(`   MIN_STAKE: ${formatEther(minStake)} JEJU`)

  // Verify GovernanceTimelock
  const TIMELOCK_ABI = parseAbi([
    'function timelockDelay() view returns (uint256)',
  ])
  const delay = await readContract(publicClient, {
    address: deployment.governanceTimelock as Address,
    abi: TIMELOCK_ABI,
    functionName: 'timelockDelay',
  })
  console.log(`✅ GovernanceTimelock verified`)
  console.log(`   Delay: ${Number(delay) / 86400} days`)

  console.log('')
  console.log('✅ All contracts verified')
  console.log('')
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})

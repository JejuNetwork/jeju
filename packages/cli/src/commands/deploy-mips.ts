/**
 * jeju deploy-mips - Deploy or configure real MIPS infrastructure for Stage 2
 *
 * MIPS (MIPS Instruction Proof System) is required for fraud proofs.
 * Options:
 * 1. Use pre-deployed Optimism MIPS contracts (recommended for Base)
 * 2. Deploy fresh MIPS contracts from Optimism monorepo
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { createPublicClient, http } from 'viem'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'
import { CHAIN_CONFIG, type NetworkType } from '../types'

interface MipsAddresses {
  mips: string
  preimageOracle: string
}

interface CannonProverStatus {
  testMode: boolean
  mipsAddress: string
  preimageOracleAddress: string
}

// Pre-deployed Optimism MIPS contracts per network
const OPTIMISM_MIPS_ADDRESSES: Record<string, MipsAddresses> = {
  mainnet: {
    mips: '0x0f8EdFbDdD3c0256A80AD8C0F2560B1807c3e67e',
    preimageOracle: '0xD326E10B8186e90F7F68d7F4B8F09F12C27a6828',
  },
  testnet: {
    mips: '0x47B0E34C1054009e696BaBAAd56165e1e994144d',
    preimageOracle: '0x627F825CBd48c4102d36f287BE71f4234426b9e4',
  },
  localnet: {
    // Localnet uses placeholder addresses - these get deployed by test setup
    mips: '0x0000000000000000000000000000000000000000',
    preimageOracle: '0x0000000000000000000000000000000000000000',
  },
}

function getOptimismMipsAddresses(network: NetworkType): MipsAddresses {
  const addresses = OPTIMISM_MIPS_ADDRESSES[network]
  if (!addresses) {
    throw new Error(`No MIPS addresses configured for network: ${network}`)
  }
  return addresses
}

async function checkCannonProverTestMode(
  network: NetworkType,
): Promise<CannonProverStatus> {
  const rootDir = findMonorepoRoot()
  const deploymentPath = join(
    rootDir,
    'packages/contracts/deployments',
    `decentralization-${network}.json`,
  )

  if (!existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found: ${deploymentPath}`)
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'))
  const cannonProverAddress = deployment.stage2?.CannonProver

  if (!cannonProverAddress) {
    throw new Error('CannonProver not found in deployment')
  }

  const rpcUrl = CHAIN_CONFIG[network].rpcUrl
  const client = createPublicClient({
    transport: http(rpcUrl),
  })

  // Check if MIPS is set to real address or placeholder
  const mipsAddress = (await client.readContract({
    address: cannonProverAddress as `0x${string}`,
    abi: [
      {
        name: 'mips',
        type: 'function',
        inputs: [],
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
      },
    ],
    functionName: 'mips',
  })) as string

  const preimageOracleAddress = (await client.readContract({
    address: cannonProverAddress as `0x${string}`,
    abi: [
      {
        name: 'preimageOracle',
        type: 'function',
        inputs: [],
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
      },
    ],
    functionName: 'preimageOracle',
  })) as string

  // Test mode = zero address or known placeholder
  const isTestMode =
    mipsAddress === '0x0000000000000000000000000000000000000000' ||
    mipsAddress === '0x0000000000000000000000000000000000000001'

  return {
    testMode: isTestMode,
    mipsAddress,
    preimageOracleAddress,
  }
}

async function updateCannonProver(
  network: NetworkType,
  addresses: MipsAddresses,
  dryRun: boolean,
): Promise<void> {
  const rootDir = findMonorepoRoot()
  const deploymentPath = join(
    rootDir,
    'packages/contracts/deployments',
    `decentralization-${network}.json`,
  )

  if (!existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found: ${deploymentPath}`)
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'))
  const cannonProverAddress = deployment.stage2?.CannonProver

  if (!cannonProverAddress) {
    throw new Error('CannonProver not found in deployment')
  }

  console.log('\n📋 CannonProver Configuration:')
  console.log(`  Contract: ${cannonProverAddress}`)
  console.log(`  New MIPS: ${addresses.mips}`)
  console.log(`  New PreimageOracle: ${addresses.preimageOracle}\n`)

  if (dryRun) {
    console.log(
      '🔍 DRY RUN - Would update CannonProver with new MIPS addresses',
    )
    return
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY environment variable required')
  }

  // In production, this would call setMips and setPreimageOracle on CannonProver
  // For now, we just indicate what would happen
  console.log('⚠️  To update CannonProver, you need to:')
  console.log('  1. Call setMips(address) on CannonProver')
  console.log('  2. Call setPreimageOracle(address) on CannonProver')
  console.log('\nIf ownership has been transferred to GovernanceTimelock,')
  console.log('this requires a governance proposal.')
}

export const deployMipsCommand = new Command('deploy-mips')
  .description('Deploy or configure real MIPS infrastructure for Stage 2')
  .requiredOption('--network <network>', 'mainnet or testnet')
  .option('--use-optimism', 'Use Optimism deployed MIPS (recommended for Base)')
  .option('--deploy-fresh', 'Deploy new MIPS contracts')
  .option('--dry-run', 'Simulate without executing')
  .action(async (options) => {
    const network = options.network as NetworkType

    if (!['mainnet', 'testnet', 'localnet'].includes(network)) {
      logger.error('Invalid network. Must be: mainnet, testnet, or localnet')
      process.exit(1)
    }

    console.log('\n🔧 MIPS Infrastructure Setup\n')

    // Check current status
    console.log('Checking current CannonProver status...')
    const status = await checkCannonProverTestMode(network)

    console.log(`\nCurrent Configuration:`)
    console.log(`  MIPS: ${status.mipsAddress}`)
    console.log(`  PreimageOracle: ${status.preimageOracleAddress}`)
    console.log(`  Test Mode: ${status.testMode ? 'YES ⚠️' : 'NO ✅'}\n`)

    if (options.useOptimism) {
      // Use pre-deployed Optimism contracts
      const addresses = getOptimismMipsAddresses(network)
      console.log('Using Optimism MIPS contracts:')
      console.log(`  MIPS: ${addresses.mips}`)
      console.log(`  PreimageOracle: ${addresses.preimageOracle}`)

      // Update CannonProver to use these
      await updateCannonProver(network, addresses, options.dryRun)
    } else if (options.deployFresh) {
      console.log('⚠️  Deploying fresh MIPS requires Optimism monorepo')
      console.log('\nSteps to deploy fresh MIPS:')
      console.log(
        '  1. Clone optimism monorepo: git clone https://github.com/ethereum-optimism/optimism',
      )
      console.log('  2. Install dependencies: cd optimism && pnpm install')
      console.log('  3. Build contracts: pnpm build')
      console.log('  4. Run MIPS deployment script')
      console.log('\nSee: packages/contracts/script/DeployCannonMIPS.md')
    } else {
      // Just show status
      console.log('Use --use-optimism or --deploy-fresh to configure MIPS')
    }

    // Verify not in test mode
    if (status.testMode) {
      console.log('\n❌ CannonProver is still in TEST MODE')
      console.log('   Fraud proofs will NOT work')
      console.log('   Run with --use-optimism to configure production MIPS')
    } else {
      console.log('\n✅ CannonProver is configured for production')
    }
  })

// Status subcommand
deployMipsCommand
  .command('status')
  .description('Check MIPS configuration status')
  .requiredOption('--network <network>', 'Network to check')
  .action(async (options) => {
    const network = options.network as NetworkType

    logger.header(`MIPS STATUS - ${network.toUpperCase()}`)

    const status = await checkCannonProverTestMode(network)

    console.log('\nCannonProver Configuration:')
    console.log(`  MIPS Address: ${status.mipsAddress}`)
    console.log(`  PreimageOracle: ${status.preimageOracleAddress}`)
    console.log(`  Test Mode: ${status.testMode ? 'YES ⚠️' : 'NO ✅'}`)

    if (status.testMode) {
      console.log('\n⚠️  WARNING: Fraud proofs are NOT active')
      console.log('   The network is operating in Stage 0 (centralized)')
      console.log(
        `   Run: jeju deploy-mips --network ${network} --use-optimism`,
      )
    } else {
      console.log('\n✅ MIPS is configured for production')
      console.log('   Fraud proofs are active')
    }

    // Show Optimism addresses for reference
    const optAddresses = OPTIMISM_MIPS_ADDRESSES[network]
    if (
      optAddresses &&
      optAddresses.mips !== '0x0000000000000000000000000000000000000000'
    ) {
      console.log('\nOptimism Reference Addresses:')
      console.log(`  MIPS: ${optAddresses.mips}`)
      console.log(`  PreimageOracle: ${optAddresses.preimageOracle}`)
    }
  })

export default deployMipsCommand

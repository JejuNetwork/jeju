/** Transfer contract ownership to GovernanceTimelock (IRREVERSIBLE) */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as readline from 'node:readline'
import { Command } from 'commander'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  isAddress,
  isHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'
import { validate } from '../schemas'
import { CHAIN_CONFIG, type NetworkType } from '../types'

const VALID_NETWORKS = ['mainnet', 'testnet', 'localnet'] as const

function parseNetworkType(value: string): NetworkType {
  if (!VALID_NETWORKS.includes(value as NetworkType)) {
    throw new Error(
      `Invalid network: ${value}. Must be: ${VALID_NETWORKS.join(', ')}`,
    )
  }
  return value as NetworkType
}

function parseAddress(value: string, context: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${context}: Invalid address format`)
  }
  return value
}

function parseHex(value: string, context: string): Hex {
  if (!isHex(value)) {
    throw new Error(`${context}: Invalid hex format`)
  }
  return value
}

const DeploymentDataSchema = z.object({
  network: z.string(),
  chainId: z.number(),
  stage2: z.record(z.string(), z.string()).optional(),
  deployer: z.string().optional(),
})

const CONTRACTS_TO_TRANSFER = [
  'DisputeGameFactory',
  'SequencerRegistry',
  'ForcedInclusion',
  'L2OutputOracleAdapter',
  'ThresholdBatchSubmitter',
] as const

type TransferableContract = (typeof CONTRACTS_TO_TRANSFER)[number]

interface TransferOptions {
  network: NetworkType
  timelock: Address
  contract?: string
  dryRun?: boolean
}

function loadDeployment(network: NetworkType): Record<string, string> {
  const rootDir = findMonorepoRoot()
  const deploymentPath = join(
    rootDir,
    'packages/contracts/deployments',
    `decentralization-${network}.json`,
  )

  if (!existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found: ${deploymentPath}`)
  }

  const rawData = JSON.parse(readFileSync(deploymentPath, 'utf-8'))
  const deployment = validate(
    rawData,
    DeploymentDataSchema,
    `deployment file at ${deploymentPath}`,
  )

  if (!deployment.stage2) {
    throw new Error('No stage2 contracts found in deployment')
  }

  return deployment.stage2
}

function getRpcUrl(network: NetworkType): string {
  const config = CHAIN_CONFIG[network]
  return config.rpcUrl
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function verifyOwnership(
  rpcUrl: string,
  contractAddress: Address,
  expectedOwner: Address,
): Promise<boolean> {
  const client = createPublicClient({
    transport: http(rpcUrl),
  })

  const owner = await client.readContract({
    address: contractAddress,
    abi: [
      {
        name: 'owner',
        type: 'function',
        inputs: [],
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
      },
    ],
    functionName: 'owner',
  })

  const ownerAddress = owner as Address
  return ownerAddress.toLowerCase() === expectedOwner.toLowerCase()
}

async function transferOwnership(options: TransferOptions): Promise<void> {
  const isMainnet = options.network === 'mainnet'

  // CRITICAL WARNINGS
  console.log(`\n${'⚠️ '.repeat(30)}`)
  console.log('\n🚨 CRITICAL SECURITY OPERATION 🚨\n')
  console.log(
    'This command will transfer contract ownership to the GovernanceTimelock.',
  )
  console.log('\n⛔ THIS ACTION IS IRREVERSIBLE ⛔\n')
  console.log('After this:')
  console.log('  • All admin changes require 30-day timelock')
  console.log('  • Emergency changes require 7-day minimum + Security Board')
  console.log('  • You CANNOT undo this transfer')
  console.log('  • Direct owner access will be PERMANENTLY LOST')
  console.log(`\n${'⚠️ '.repeat(30)}\n`)

  if (isMainnet) {
    console.log('🔴 MAINNET DETECTED - PRODUCTION FUNDS AT RISK 🔴\n')

    // Require explicit confirmation
    const confirm1 = await prompt(
      'Type "I UNDERSTAND THIS IS IRREVERSIBLE" to continue: ',
    )
    if (confirm1 !== 'I UNDERSTAND THIS IS IRREVERSIBLE') {
      console.log('❌ Aborted')
      process.exit(1)
    }

    const confirm2 = await prompt('Type the timelock address to confirm: ')
    if (confirm2.toLowerCase() !== options.timelock.toLowerCase()) {
      console.log('❌ Address mismatch - Aborted')
      process.exit(1)
    }

    const confirm3 = await prompt('Type "TRANSFER OWNERSHIP" to execute: ')
    if (confirm3 !== 'TRANSFER OWNERSHIP') {
      console.log('❌ Aborted')
      process.exit(1)
    }
  }

  // Load deployment
  const deployment = loadDeployment(options.network)
  const contracts: string[] = options.contract
    ? [options.contract]
    : [...CONTRACTS_TO_TRANSFER]

  console.log('\n📋 Contracts to transfer:')
  for (const name of contracts) {
    const addr = deployment[name]
    if (!addr) {
      console.log(`  ❌ ${name}: NOT FOUND IN DEPLOYMENT`)
      throw new Error(`Contract ${name} not found in deployment`)
    }
    console.log(`  ${name}: ${addr}`)
  }
  console.log(`  → New owner: ${options.timelock}\n`)

  if (options.dryRun) {
    console.log('🔍 DRY RUN - No transactions will be sent\n')

    const rpcUrl = getRpcUrl(options.network)

    // Simulate each transfer by checking current ownership
    for (const name of contracts) {
      const address = deployment[name]
      console.log(`  [DRY RUN] Checking ${name}...`)

      const client = createPublicClient({
        transport: http(rpcUrl),
      })

      const addressChecked = parseAddress(address, `Contract ${name}`)
      const currentOwner = await client.readContract({
        address: addressChecked,
        abi: [
          {
            name: 'owner',
            type: 'function',
            inputs: [],
            outputs: [{ name: '', type: 'address' }],
            stateMutability: 'view',
          },
        ],
        functionName: 'owner',
      })

      console.log(`    Current owner: ${currentOwner}`)
      console.log(`    Would transfer to: ${options.timelock}`)
    }

    console.log('\n✅ Dry run complete - no changes made')
    return
  }

  // Execute transfers
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY environment variable required')
  }

  const privateKeyHex = parseHex(privateKey, 'DEPLOYER_PRIVATE_KEY')
  const account = privateKeyToAccount(privateKeyHex)
  const rpcUrl = getRpcUrl(options.network)

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  })

  const chain = {
    id: CHAIN_CONFIG[options.network].chainId,
    name: CHAIN_CONFIG[options.network].name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  }

  const results: Array<{ name: string; hash: string; success: boolean }> = []

  const timelockAddress = parseAddress(options.timelock, 'timelock')

  for (const name of contracts) {
    const address = deployment[name]
    const contractAddress = parseAddress(address, `Contract ${name}`)
    console.log(`\n🔄 Transferring ${name}...`)

    const hash = await walletClient.writeContract({
      address: contractAddress,
      abi: [
        {
          name: 'transferOwnership',
          type: 'function',
          inputs: [{ name: 'newOwner', type: 'address' }],
          outputs: [],
          stateMutability: 'nonpayable',
        },
      ],
      functionName: 'transferOwnership',
      args: [timelockAddress],
      chain,
    })

    console.log(`  TX: ${hash}`)

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      console.log(`  ✅ ${name} ownership transferred`)
      results.push({ name, hash, success: true })
    } else {
      console.log(`  ❌ ${name} transfer FAILED`)
      results.push({ name, hash, success: false })
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(50)}`)
  console.log('TRANSFER SUMMARY')
  console.log('═'.repeat(50))

  const successful = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  if (successful.length > 0) {
    console.log('\n✅ Successfully transferred:')
    for (const r of successful) {
      console.log(`  ${r.name}: ${r.hash}`)
    }
  }

  if (failed.length > 0) {
    console.log('\n❌ Failed transfers:')
    for (const r of failed) {
      console.log(`  ${r.name}: ${r.hash}`)
    }
  }

  if (failed.length === 0) {
    console.log('\n✅ All ownership transfers complete')
    console.log('📝 Update your deployment records')
    console.log('🔒 Direct admin access is now DISABLED')
  } else {
    console.log('\n⚠️  Some transfers failed - review transactions above')
  }
}

export const decentralizeCommand = new Command('decentralize')
  .description(
    'Transfer contract ownership to GovernanceTimelock (IRREVERSIBLE)',
  )
  .requiredOption('--network <network>', 'Network: mainnet, testnet, localnet')
  .requiredOption('--timelock <address>', 'GovernanceTimelock address')
  .option(
    '--contract <name>',
    'Single contract to transfer (or all if omitted)',
  )
  .option('--dry-run', 'Simulate without executing')
  .action(async (options) => {
    let network: NetworkType
    try {
      network = parseNetworkType(options.network)
    } catch {
      logger.error('Invalid network. Must be: mainnet, testnet, or localnet')
      process.exit(1)
    }

    let timelockAddress: Address
    try {
      timelockAddress = parseAddress(options.timelock, 'timelock')
    } catch {
      logger.error('Invalid timelock address format')
      process.exit(1)
    }

    if (
      options.contract &&
      !CONTRACTS_TO_TRANSFER.includes(options.contract as TransferableContract)
    ) {
      logger.error(
        `Invalid contract name. Must be one of: ${CONTRACTS_TO_TRANSFER.join(', ')}`,
      )
      process.exit(1)
    }

    await transferOwnership({
      network,
      timelock: timelockAddress,
      contract: options.contract,
      dryRun: options.dryRun,
    })
  })

decentralizeCommand
  .command('verify')
  .description('Verify contract ownership has been transferred')
  .requiredOption('--network <network>', 'Network: mainnet, testnet, localnet')
  .requiredOption('--timelock <address>', 'Expected GovernanceTimelock owner')
  .action(async (options) => {
    const network = parseNetworkType(options.network)
    const timelockAddress = parseAddress(options.timelock, 'timelock')
    const deployment = loadDeployment(network)
    const rpcUrl = getRpcUrl(network)

    logger.header('OWNERSHIP VERIFICATION')

    let allCorrect = true

    for (const name of CONTRACTS_TO_TRANSFER) {
      const address = deployment[name]
      if (!address) {
        console.log(`  ⚠️  ${name}: Not found in deployment`)
        continue
      }

      const contractAddress = parseAddress(address, `Contract ${name}`)
      const isCorrect = await verifyOwnership(
        rpcUrl,
        contractAddress,
        timelockAddress,
      )

      if (isCorrect) {
        console.log(`  ✅ ${name}: Owned by timelock`)
      } else {
        console.log(`  ❌ ${name}: NOT owned by timelock`)
        allCorrect = false
      }
    }

    console.log()
    if (allCorrect) {
      logger.success('All contracts owned by GovernanceTimelock')
    } else {
      logger.error('Some contracts are NOT owned by the timelock')
    }
  })

decentralizeCommand
  .command('status')
  .description('Show current contract ownership status')
  .requiredOption('--network <network>', 'Network: mainnet, testnet, localnet')
  .action(async (options) => {
    const network = parseNetworkType(options.network)
    const deployment = loadDeployment(network)
    const rpcUrl = getRpcUrl(network)

    logger.header(`CONTRACT OWNERSHIP - ${network.toUpperCase()}`)

    const client = createPublicClient({
      transport: http(rpcUrl),
    })

    for (const name of CONTRACTS_TO_TRANSFER) {
      const address = deployment[name]
      if (!address) {
        console.log(`  ⚠️  ${name}: Not deployed`)
        continue
      }

      const contractAddress = parseAddress(address, `Contract ${name}`)
      const owner = await client.readContract({
        address: contractAddress,
        abi: [
          {
            name: 'owner',
            type: 'function',
            inputs: [],
            outputs: [{ name: '', type: 'address' }],
            stateMutability: 'view',
          },
        ],
        functionName: 'owner',
      })

      console.log(`  ${name}:`)
      console.log(`    Address: ${address}`)
      console.log(`    Owner:   ${owner}`)
    }
  })

export default decentralizeCommand

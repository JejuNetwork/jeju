#!/usr/bin/env bun
/**
 * Transfer Contract Ownership to Timelock
 *
 * This script transfers ownership of critical contracts to a timelock
 * for decentralized governance. This is a CRITICAL security step that
 * must be done before mainnet launch.
 *
 * Ownership transfer flow:
 * 1. Deploy Timelock with initial delay (e.g., 48h for mainnet)
 * 2. Transfer ownership of all contracts to Timelock
 * 3. Verify all transfers were successful
 * 4. Renounce admin keys (optional, after verification period)
 *
 * Usage:
 *   bun run packages/deployment/scripts/deploy/transfer-ownership.ts --network testnet
 *   bun run packages/deployment/scripts/deploy/transfer-ownership.ts --network mainnet --dry-run
 */

import { getRpcUrl } from '@jejunetwork/config'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

// Contracts that need ownership transfer
const CONTRACTS_TO_TRANSFER: Array<{
  name: string
  envKey: string
  critical: boolean
}> = [
  // Core protocol
  { name: 'SystemConfig', envKey: 'SYSTEM_CONFIG', critical: true },
  { name: 'L2OutputOracle', envKey: 'L2_OUTPUT_ORACLE', critical: true },
  { name: 'OptimismPortal', envKey: 'OPTIMISM_PORTAL', critical: true },

  // DWS Infrastructure
  { name: 'StorageManager', envKey: 'STORAGE_MANAGER', critical: true },
  { name: 'WorkerRegistry', envKey: 'WORKER_REGISTRY', critical: true },
  { name: 'CDNRegistry', envKey: 'CDN_REGISTRY', critical: true },
  { name: 'ComputeRegistry', envKey: 'COMPUTE_REGISTRY', critical: true },

  // Staking
  {
    name: 'NodeStakingManager',
    envKey: 'NODE_STAKING_MANAGER',
    critical: true,
  },
  {
    name: 'DelegatedNodeStaking',
    envKey: 'DELEGATED_NODE_STAKING',
    critical: true,
  },

  // Identity
  { name: 'IdentityRegistry', envKey: 'IDENTITY_REGISTRY', critical: true },
  { name: 'BanManager', envKey: 'BAN_MANAGER', critical: true },

  // JNS
  { name: 'JNSRegistry', envKey: 'JNS_REGISTRY', critical: true },
  { name: 'JNSResolver', envKey: 'JNS_RESOLVER', critical: true },

  // Oracle
  {
    name: 'OracleStakingManager',
    envKey: 'ORACLE_STAKING_MANAGER',
    critical: false,
  },
  { name: 'FeedRegistry', envKey: 'FEED_REGISTRY', critical: false },

  // Proxy
  { name: 'ProxyRegistry', envKey: 'PROXY_REGISTRY', critical: false },

  // VPN
  { name: 'VPNRegistry', envKey: 'VPN_REGISTRY', critical: false },

  // Database
  { name: 'DatabaseProvider', envKey: 'DATABASE_PROVIDER', critical: false },
]

// Ownable ABI
const OWNABLE_ABI = [
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'transferOwnership',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [],
  },
  {
    name: 'pendingOwner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'acceptOwnership',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const

interface TransferResult {
  contract: string
  address: Address
  previousOwner: Address
  newOwner: Address
  txHash: string
  success: boolean
  error?: string
}

async function main() {
  const args = process.argv.slice(2)

  // Parse arguments
  const networkIdx = args.indexOf('--network')
  const networkArg =
    networkIdx !== -1 && args[networkIdx + 1]
      ? args[networkIdx + 1]
      : process.env.JEJU_NETWORK || 'testnet'

  const dryRun = args.includes('--dry-run')
  const skipNonCritical = args.includes('--critical-only')

  const network = z.enum(['testnet', 'mainnet']).parse(networkArg)

  console.log('\n═'.repeat(60))
  console.log('Contract Ownership Transfer to Timelock')
  console.log('═'.repeat(60))
  console.log(`\nNetwork: ${network}`)
  console.log(`Mode: ${dryRun ? 'DRY RUN (no transactions)' : 'LIVE'}`)
  console.log(
    `Scope: ${skipNonCritical ? 'Critical contracts only' : 'All contracts'}\n`,
  )

  if (!dryRun) {
    console.log('⚠️  WARNING: This will transfer ownership of contracts.')
    console.log('   This action is IRREVERSIBLE once completed.')
    console.log('   Press Ctrl+C within 10 seconds to abort.\n')
    await new Promise((r) => setTimeout(r, 10000))
  }

  // Get configuration
  const rpcUrl = getRpcUrl(network)

  // Get timelock address
  const timelockAddress = process.env.TIMELOCK_ADDRESS as Address
  if (!timelockAddress) {
    console.error('ERROR: TIMELOCK_ADDRESS environment variable required')
    console.error('Deploy a timelock first, then set this variable.')
    process.exit(1)
  }

  console.log(`Timelock address: ${timelockAddress}`)

  // Get deployer private key
  const deployerKey =
    process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  if (!deployerKey) {
    console.error('ERROR: DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required')
    process.exit(1)
  }

  const account = privateKeyToAccount(deployerKey as `0x${string}`)
  console.log(`Deployer address: ${account.address}\n`)

  // Create clients
  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  })

  // Filter contracts
  const contractsToProcess = CONTRACTS_TO_TRANSFER.filter(
    (c) => !skipNonCritical || c.critical,
  )

  console.log(`Processing ${contractsToProcess.length} contracts...\n`)

  const results: TransferResult[] = []

  for (const contract of contractsToProcess) {
    const address = process.env[contract.envKey] as Address

    if (!address) {
      console.log(`⏭️  ${contract.name}: No address found (${contract.envKey})`)
      continue
    }

    console.log(`📝 ${contract.name} (${address})`)

    try {
      // Check current owner
      const currentOwner = (await publicClient.readContract({
        address,
        abi: OWNABLE_ABI,
        functionName: 'owner',
      })) as Address

      console.log(`   Current owner: ${currentOwner}`)

      if (currentOwner.toLowerCase() === timelockAddress.toLowerCase()) {
        console.log(`   ✅ Already owned by timelock`)
        results.push({
          contract: contract.name,
          address,
          previousOwner: currentOwner,
          newOwner: timelockAddress,
          txHash: '',
          success: true,
        })
        continue
      }

      if (currentOwner.toLowerCase() !== account.address.toLowerCase()) {
        console.log(`   ⚠️  Current owner is not deployer - skipping`)
        results.push({
          contract: contract.name,
          address,
          previousOwner: currentOwner,
          newOwner: timelockAddress,
          txHash: '',
          success: false,
          error: 'Not owned by deployer',
        })
        continue
      }

      if (dryRun) {
        console.log(`   🔄 Would transfer to: ${timelockAddress}`)
        results.push({
          contract: contract.name,
          address,
          previousOwner: currentOwner,
          newOwner: timelockAddress,
          txHash: '(dry run)',
          success: true,
        })
        continue
      }

      // Transfer ownership
      console.log(`   🔄 Transferring to: ${timelockAddress}`)

      const hash = await walletClient.writeContract({
        address,
        abi: OWNABLE_ABI,
        functionName: 'transferOwnership',
        args: [timelockAddress],
        chain: null,
      })

      console.log(`   ⏳ Tx: ${hash}`)

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      if (receipt.status === 'success') {
        console.log(`   ✅ Transferred successfully`)
        results.push({
          contract: contract.name,
          address,
          previousOwner: currentOwner,
          newOwner: timelockAddress,
          txHash: hash,
          success: true,
        })
      } else {
        console.log(`   ❌ Transaction failed`)
        results.push({
          contract: contract.name,
          address,
          previousOwner: currentOwner,
          newOwner: timelockAddress,
          txHash: hash,
          success: false,
          error: 'Transaction reverted',
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`   ❌ Error: ${message}`)
      results.push({
        contract: contract.name,
        address,
        previousOwner: '' as Address,
        newOwner: timelockAddress,
        txHash: '',
        success: false,
        error: message,
      })
    }

    console.log()
  }

  // Summary
  console.log('═'.repeat(60))
  console.log('SUMMARY')
  console.log('═'.repeat(60))

  const successful = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  console.log(`\n✅ Successful: ${successful.length}`)
  for (const r of successful) {
    console.log(`   - ${r.contract}`)
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}`)
    for (const r of failed) {
      console.log(`   - ${r.contract}: ${r.error}`)
    }
  }

  if (!dryRun && successful.length > 0) {
    console.log('\n⚠️  IMPORTANT: Verify ownership transfers on block explorer.')
    console.log('   If using 2-step transfer, accept ownership via timelock.')
  }

  // Write results to file
  const resultsFile = `ownership-transfer-${network}-${Date.now()}.json`
  await Bun.write(resultsFile, JSON.stringify(results, null, 2))
  console.log(`\n📄 Results saved to: ${resultsFile}`)

  if (failed.length > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('ERROR:', error)
  process.exit(1)
})

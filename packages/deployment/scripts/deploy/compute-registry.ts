#!/usr/bin/env bun
/**
 * Deploy ComputeRegistry to Jeju Testnet
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... bun run scripts/deploy/compute-registry.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  getContractAddress,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const TESTNET_RPC = 'https://testnet-rpc.jejunetwork.org'
const TESTNET_CHAIN_ID = 420690

// ComputeRegistry constructor ABI
const COMPUTE_REGISTRY_ABI = [
  {
    type: 'constructor',
    inputs: [
      { name: '_owner', type: 'address' },
      { name: '_identityRegistry', type: 'address' },
      { name: '_banManager', type: 'address' },
      { name: '_minProviderStake', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'version',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'pure',
  },
] as const

async function main() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  if (!privateKey) {
    console.error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY is required')
    process.exit(1)
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)

  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                COMPUTE REGISTRY DEPLOYMENT                               ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Chain: Jeju Testnet (${TESTNET_CHAIN_ID})                                         ║
║  Deployer: ${account.address}                 ║
╚══════════════════════════════════════════════════════════════════════════╝
`)

  const publicClient = createPublicClient({
    transport: http(TESTNET_RPC),
  })

  const walletClient = createWalletClient({
    account,
    transport: http(TESTNET_RPC),
  })

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`Balance: ${formatEther(balance)} ETH`)

  if (balance < 1000000000000000n) {
    // 0.001 ETH
    console.error('Insufficient balance for deployment')
    process.exit(1)
  }

  // Load bytecode from contracts build
  const ROOT = join(import.meta.dir, '../../../..')
  const bytecodeFile = join(
    ROOT,
    'packages/contracts/out/ComputeRegistry.sol/ComputeRegistry.json',
  )

  if (!existsSync(bytecodeFile)) {
    console.error('ComputeRegistry artifact not found. Run forge build first.')
    console.error(`Expected: ${bytecodeFile}`)
    process.exit(1)
  }

  const artifact = JSON.parse(readFileSync(bytecodeFile, 'utf-8'))
  const bytecode = artifact.bytecode.object as `0x${string}`

  console.log('Deploying ComputeRegistry...')

  // Deploy with constructor args:
  // - owner: deployer
  // - identityRegistry: address(0) (not required for now)
  // - banManager: address(0) (not required for now)
  // - minProviderStake: 0 (no minimum stake required)
  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  })

  const expectedAddress = getContractAddress({
    from: account.address,
    nonce: BigInt(nonce),
  })

  console.log(`Expected address: ${expectedAddress}`)

  // Encode constructor arguments
  const { encodeAbiParameters } = await import('viem')
  const constructorArgs = encodeAbiParameters(
    [
      { name: '_owner', type: 'address' },
      { name: '_identityRegistry', type: 'address' },
      { name: '_banManager', type: 'address' },
      { name: '_minProviderStake', type: 'uint256' },
    ],
    [
      account.address, // owner
      '0x0000000000000000000000000000000000000000' as Address, // identityRegistry
      '0x0000000000000000000000000000000000000000' as Address, // banManager
      0n, // minProviderStake
    ],
  )

  const deployData = (bytecode + constructorArgs.slice(2)) as `0x${string}`

  // Send deployment transaction
  const hash = await walletClient.sendTransaction({
    data: deployData,
    chain: {
      id: TESTNET_CHAIN_ID,
      name: 'Jeju Testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [TESTNET_RPC] },
      },
    },
  })

  console.log(`Transaction hash: ${hash}`)
  console.log('Waiting for confirmation...')

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  if (receipt.status !== 'success') {
    console.error('Deployment failed')
    process.exit(1)
  }

  const contractAddress = receipt.contractAddress as Address
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                   DEPLOYMENT SUCCESSFUL                                  ║
╠══════════════════════════════════════════════════════════════════════════╣
║  ComputeRegistry: ${contractAddress}          ║
║  Transaction: ${hash}  ║
╚══════════════════════════════════════════════════════════════════════════╝
`)

  // Verify the contract works
  const version = await publicClient.readContract({
    address: contractAddress,
    abi: COMPUTE_REGISTRY_ABI,
    functionName: 'version',
  })
  console.log(`Contract version: ${version}`)

  // Update contracts.json
  const configFile = join(ROOT, 'packages/config/contracts.json')
  if (existsSync(configFile)) {
    const config = JSON.parse(readFileSync(configFile, 'utf-8'))
    config.testnet.compute.registry = contractAddress
    config.lastUpdated = new Date().toISOString().split('T')[0]
    writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
    console.log('Updated packages/config/contracts.json')
  }

  // Save deployment record
  const deploymentsFile = join(
    ROOT,
    'packages/contracts/deployments/testnet/deployment.json',
  )
  let deployments: Record<string, unknown> = {}
  if (existsSync(deploymentsFile)) {
    deployments = JSON.parse(readFileSync(deploymentsFile, 'utf-8'))
  }
  deployments.ComputeRegistry = contractAddress
  deployments.lastDeployed = new Date().toISOString()
  writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2) + '\n')
  console.log('Updated packages/contracts/deployments/testnet/deployment.json')
}

main().catch((error) => {
  console.error('Deployment failed:', error.message)
  process.exit(1)
})

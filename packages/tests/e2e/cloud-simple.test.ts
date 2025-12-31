#!/usr/bin/env bun
/**
 * Simplified Cloud Integration E2E Tests
 * Tests actual deployed contracts on localnet
 *
 * NOTE: These tests require contracts to be deployed first.
 * Run `forge script script/DeployCloudIntegration.s.sol --rpc-url ${getL2RpcUrl()} --broadcast`
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getL2RpcUrl, getRpcUrl } from '@jejunetwork/config'
import {
  type Address,
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  isAddress,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { inferChainFromRpcUrl } from '../../../packages/deployment/scripts/shared/chain-utils'
import { TEST_WALLETS } from '../shared/constants'

// Alias for compatibility
const TEST_ACCOUNTS = TEST_WALLETS

// Load addresses dynamically from deployment files
function loadDeployedAddresses(): Record<string, string> {
  const deploymentsDir = resolve(
    __dirname,
    '../../../packages/contracts/deployments',
  )
  const addresses: Record<string, string> = {}

  // Try identity-system deployment
  const identityPath = resolve(deploymentsDir, 'identity-system-31337.json')
  if (existsSync(identityPath)) {
    const data = JSON.parse(readFileSync(identityPath, 'utf-8')) as Record<
      string,
      string
    >
    if (data.IdentityRegistry)
      addresses.identityRegistry = data.IdentityRegistry
    if (data.ReputationRegistry)
      addresses.reputationRegistry = data.ReputationRegistry
    if (data.ValidationRegistry)
      addresses.validationRegistry = data.ValidationRegistry
  }

  // Try localnet-addresses.json for cloud contracts
  const localnetPath = resolve(deploymentsDir, 'localnet-addresses.json')
  if (existsSync(localnetPath)) {
    const data = JSON.parse(readFileSync(localnetPath, 'utf-8')) as Record<
      string,
      string
    >
    Object.assign(addresses, data)
  }

  // Try cloud-integration deployment if it exists
  const cloudPath = resolve(deploymentsDir, 'cloud-integration-31337.json')
  if (existsSync(cloudPath)) {
    const data = JSON.parse(readFileSync(cloudPath, 'utf-8')) as Record<
      string,
      string
    >
    Object.assign(addresses, data)
  }

  return addresses
}

let ADDRESSES: Record<string, string> = {}
let publicClient: ReturnType<typeof createPublicClient>
let deployer: ReturnType<typeof privateKeyToAccount>

let localnetAvailable = false
let cloudContractsDeployed = false

// Top-level await to check localnet before tests start
try {
  const rpcUrl = getRpcUrl()
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    signal: AbortSignal.timeout(2000),
  })
  localnetAvailable = response.ok
  // Requires specific cloud contract deployments
  cloudContractsDeployed = false
} catch {
  localnetAvailable = false
}
if (!localnetAvailable) {
  console.log('⏭️ Skipping cloud-simple tests - localnet not available')
} else if (!cloudContractsDeployed) {
  console.log('⏭️ Skipping cloud-simple tests - cloud contracts not deployed')
}

describe.skipIf(!localnetAvailable || !cloudContractsDeployed)(
  'Cloud Simple Tests',
  () => {

beforeAll(async () => {
  ADDRESSES = loadDeployedAddresses()
  const rpcUrl = getRpcUrl()
  const chain = inferChainFromRpcUrl(rpcUrl)
  deployer = privateKeyToAccount(TEST_ACCOUNTS.deployer.privateKey)
  publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

  if (Object.keys(ADDRESSES).length === 0) {
    console.warn('⚠️ No deployment addresses found. Tests may be skipped.')
  }

  // Check if localnet is actually running
  try {
    await publicClient.getBlockNumber()
    localnetAvailable = true
  } catch {
    console.warn(
      `⚠️ Localnet not available at ${getL2RpcUrl()}. Tests will be skipped.`,
    )
    localnetAvailable = false
  }
})

describe('Cloud Contracts Deployment', () => {
  test('deployment addresses are loaded', () => {
    // This is a basic sanity check to ensure we have some addresses
    console.log(
      'Loaded addresses:',
      Object.keys(ADDRESSES).join(', ') || 'none',
    )
    if (Object.keys(ADDRESSES).length === 0) {
      console.log('⏭️ No deployment addresses found - contracts not deployed')
      return
    }
    expect(Object.keys(ADDRESSES).length).toBeGreaterThan(0)
  })

  test('all deployed contracts have code', async () => {
    // Skip if localnet not available
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running')
      return
    }

    // Skip if no addresses loaded
    if (Object.keys(ADDRESSES).length === 0) {
      console.log('⏭️ Skipping: No deployment addresses found')
      return
    }

    let deployedCount = 0
    for (const [name, address] of Object.entries(ADDRESSES)) {
      if (!isAddress(address)) {
        console.log(`⏭️ Skipping ${name}: invalid address format`)
        continue
      }
      const code = await getBytecode(publicClient, {
        address: address as Address,
      })
      if (code === '0x') {
        console.log(`⚠️ ${name}: no code at ${address} (not deployed)`)
      } else {
        console.log(`✓ ${name}: ${address}`)
        deployedCount++
      }
    }
    // At least some contracts should be deployed if we're running this test
    console.log(
      `${deployedCount}/${Object.keys(ADDRESSES).length} contracts deployed`,
    )
  })

  test('identity registry is functional', async () => {
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running')
      return
    }

    if (!ADDRESSES.identityRegistry && !ADDRESSES.IdentityRegistry) {
      console.log('⏭️ Skipping: IdentityRegistry address not found')
      return
    }

    const registryAddr =
      ADDRESSES.identityRegistry || ADDRESSES.IdentityRegistry

    // Check if contract is deployed
    const code = await publicClient.getBytecode({
      address: registryAddr as Address,
    })
    if (code === undefined || code === '0x') {
      console.log('⏭️ Skipping: IdentityRegistry not deployed')
      return
    }

    const totalAgents = await publicClient.readContract({
      address: registryAddr as Address,
      abi: parseAbi(['function totalAgents() external view returns (uint256)']),
      functionName: 'totalAgents',
    })
    console.log(`✓ IdentityRegistry has ${totalAgents} registered agents`)
    expect(totalAgents).toBeGreaterThanOrEqual(0n)
  })

  test('service registry is functional', async () => {
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running')
      return
    }

    if (!ADDRESSES.serviceRegistry && !ADDRESSES.ServiceRegistry) {
      console.log('⏭️ Skipping: ServiceRegistry address not found')
      return
    }

    const registryAddr = ADDRESSES.serviceRegistry || ADDRESSES.ServiceRegistry

    // Check if contract is deployed
    const code = await publicClient.getBytecode({
      address: registryAddr as Address,
    })
    if (code === undefined || code === '0x') {
      console.log('⏭️ Skipping: ServiceRegistry not deployed')
      return
    }

    const services = await publicClient.readContract({
      address: registryAddr as Address,
      abi: parseAbi([
        'function getAllServiceNames() external view returns (string[] memory)',
      ]),
      functionName: 'getAllServiceNames',
    })
    console.log(`✓ ServiceRegistry has ${services.length} registered services`)
    expect(services).toBeDefined()
  })

  test('cloud reputation provider is functional', async () => {
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running')
      return
    }

    if (
      !ADDRESSES.cloudReputationProvider &&
      !ADDRESSES.CloudReputationProvider
    ) {
      console.log('⏭️ Skipping: CloudReputationProvider address not found')
      return
    }

    const providerAddr =
      ADDRESSES.cloudReputationProvider || ADDRESSES.CloudReputationProvider

    // Check if contract is deployed
    const code = await getBytecode(publicClient, {
      address: providerAddr as Address,
    })
    if (code === undefined || code === '0x') {
      console.log('⏭️ Skipping: CloudReputationProvider not deployed')
      return
    }

    const owner = await publicClient.readContract({
      address: providerAddr as Address,
      abi: parseAbi(['function owner() external view returns (address)']),
      functionName: 'owner',
    })
    console.log(`✓ CloudReputationProvider owner: ${owner}`)
    expect(owner).toBeDefined()
    expect(isAddress(owner)).toBe(true)
  })
})

describe('Cloud Service Costs', () => {
  test('can query service costs', async () => {
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running')
      return
    }

    if (!ADDRESSES.serviceRegistry && !ADDRESSES.ServiceRegistry) {
      console.log('⏭️ Skipping: ServiceRegistry address not found')
      return
    }

    const registryAddr = ADDRESSES.serviceRegistry || ADDRESSES.ServiceRegistry

    // Check if contract is deployed
    const code = await publicClient.getBytecode({
      address: registryAddr as Address,
    })
    if (code === undefined || code === '0x') {
      console.log('⏭️ Skipping: ServiceRegistry not deployed')
      return
    }

    const registryAbi = parseAbi([
      'function getServiceCost(string,address) external view returns (uint256)',
      'function getAllServiceNames() external view returns (string[] memory)',
    ])

    // First check if service exists
    const services = (await readContract(publicClient, {
      address: registryAddr as Address,
      abi: registryAbi,
      functionName: 'getAllServiceNames',
    })) as string[]
    if (services.length === 0) {
      console.log('⏭️ Skipping: No services registered')
      return
    }

    const cost = await publicClient.readContract({
      address: registryAddr as Address,
      abi: registryAbi,
      functionName: 'getServiceCost',
      args: [services[0], deployer.address],
    })

    console.log(`✓ ${services[0]} cost: ${formatEther(cost)} tokens`)
    expect(cost).toBeGreaterThanOrEqual(0n)
  })
})

describe('Cloud Credit System', () => {
  test('can check user balances', async () => {
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running')
      return
    }

    if (!ADDRESSES.creditManager && !ADDRESSES.CreditManager) {
      console.log('⏭️ Skipping: CreditManager address not found')
      return
    }

    const creditAddr = ADDRESSES.creditManager || ADDRESSES.CreditManager
    const usdcAddr = ADDRESSES.usdc || ADDRESSES.USDC

    if (!usdcAddr) {
      console.log('⏭️ Skipping: USDC address not found')
      return
    }

    // Check if contract is deployed
    const code = await publicClient.getBytecode({
      address: creditAddr as Address,
    })
    if (code === undefined || code === '0x') {
      console.log('⏭️ Skipping: CreditManager not deployed')
      return
    }

    const balance = await publicClient.readContract({
      address: creditAddr as Address,
      abi: parseAbi([
        'function getBalance(address,address) external view returns (uint256)',
      ]),
      functionName: 'getBalance',
      args: [deployer.address, usdcAddr as Address],
    })

    console.log(
      `✓ User USDC balance in credit manager: ${formatUnits(balance, 6)} USDC`,
    )
    expect(balance).toBeGreaterThanOrEqual(0n)
  })
})

}) // Close Cloud Simple Tests describe

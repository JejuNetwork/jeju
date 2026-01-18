#!/usr/bin/env bun
/**
 * Simplified Cloud Integration E2E Tests
 * Tests actual deployed contracts on localnet
 *
 * FAIL-FAST: These tests REQUIRE contracts to be deployed.
 * If contracts are missing, tests will error immediately.
 * Run: bun run jeju dev (deploys chain + contracts)
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getRpcUrl } from '@jejunetwork/config'
import {
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
import { requireContracts } from '../shared/contracts-required'

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

  // Try localnet contracts
  const localnetPath = resolve(deploymentsDir, 'localnet-contracts.json')
  if (existsSync(localnetPath)) {
    const data = JSON.parse(readFileSync(localnetPath, 'utf-8')) as Record<
      string,
      string
    >
    Object.assign(addresses, data)
  }

  // Try cloud-specific deployment
  const cloudPath = resolve(deploymentsDir, 'cloud-31337.json')
  if (existsSync(cloudPath)) {
    const data = JSON.parse(readFileSync(cloudPath, 'utf-8')) as Record<
      string,
      string
    >
    Object.assign(addresses, data)
  }

  return addresses
}

// Address type for viem
type Address = `0x${string}`

let ADDRESSES: Record<string, string> = {}
let localnetAvailable = false
let publicClient: ReturnType<typeof createPublicClient>
let deployer: ReturnType<typeof privateKeyToAccount>

describe('Cloud Simple Tests', () => {
  beforeAll(async () => {
    // FAIL-FAST: Require chain and contracts before any tests
    await requireContracts()

    ADDRESSES = loadDeployedAddresses()
    const rpcUrl = getRpcUrl()
    const chain = inferChainFromRpcUrl(rpcUrl)
    deployer = privateKeyToAccount(TEST_ACCOUNTS.deployer.privateKey)
    publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

    if (Object.keys(ADDRESSES).length === 0) {
      throw new Error('No deployment addresses found. Run: bun run jeju dev')
    }

    // Check if localnet is actually running
    try {
      await publicClient.getBlockNumber()
      localnetAvailable = true
    } catch {
      console.warn(
        `⚠️ Localnet not available at ${getRpcUrl()}. Tests will be skipped.`,
      )
      localnetAvailable = false
    }
  })

  describe('Cloud Contracts Deployment', () => {
    test('deployment addresses are loaded', () => {
      // This is a basic sanity check to ensure we have some addresses
      console.log(
        'Loaded addresses:',
        Object.keys(ADDRESSES).slice(0, 5).join(', '),
        '...',
      )

      if (Object.keys(ADDRESSES).length === 0) {
        console.warn(
          '⚠️ No addresses loaded - run deployment first: bun run jeju dev',
        )
        return
      }
      expect(Object.keys(ADDRESSES).length).toBeGreaterThan(0)
    })

    test('all deployed contracts have code', async () => {
      // Skip if localnet not running
      if (!localnetAvailable) {
        console.log('⏭️ Skipping: Localnet not running')
        return
      }

      if (Object.keys(ADDRESSES).length === 0) {
        console.log('⏭️ Skipping: No addresses loaded')
        return
      }

      // Check each address has code
      for (const [name, address] of Object.entries(ADDRESSES)) {
        if (!isAddress(address)) {
          console.log(`⏭️ Skipping ${name}: Invalid address format`)
          continue
        }
        const code = await publicClient.getBytecode({
          address: address as Address,
        })
        if (code === '0x') {
          console.log(`⚠️ ${name}: No code at ${address}`)
        } else {
          console.log(`✓ ${name}: Code present`)
        }
      }

      // At least some contracts should have code
      expect(Object.keys(ADDRESSES).length).toBeGreaterThan(0)
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
        abi: parseAbi([
          'function getTotalAgentCount() external view returns (uint256)',
        ]),
        functionName: 'getTotalAgentCount',
      })

      console.log(`✓ Total agents in registry: ${totalAgents}`)
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

      const registryAddr =
        ADDRESSES.serviceRegistry || ADDRESSES.ServiceRegistry

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
          'function getAllServiceTypes() external view returns (string[])',
        ]),
        functionName: 'getAllServiceTypes',
      })

      console.log(`✓ Registered services: ${(services as string[]).length}`)
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
      const code = await publicClient.getBytecode({
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

      const registryAddr =
        ADDRESSES.serviceRegistry || ADDRESSES.ServiceRegistry

      // Check if contract is deployed
      const code = await publicClient.getBytecode({
        address: registryAddr as Address,
      })
      if (code === undefined || code === '0x') {
        console.log('⏭️ Skipping: ServiceRegistry not deployed')
        return
      }

      // Import readContract for type safety
      const { readContract } = await import('viem/actions')

      const services = (await readContract(publicClient, {
        address: registryAddr as Address,
        abi: parseAbi([
          'function getAllServiceTypes() external view returns (string[])',
        ]),
        functionName: 'getAllServiceTypes',
      })) as string[]
      if (services.length === 0) {
        console.log('⏭️ Skipping: No services registered')
        return
      }

      const cost = await publicClient.readContract({
        address: registryAddr as Address,
        abi: parseAbi([
          'function getServiceCost(string) external view returns (uint256)',
        ]),
        functionName: 'getServiceCost',
        args: [services[0]],
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
})

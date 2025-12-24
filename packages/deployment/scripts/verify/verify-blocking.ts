#!/usr/bin/env bun

/**
 * User Blocking System On-Chain Verification
 *
 * Verifies the UserBlockRegistry and blocking integrations across all contracts.
 * Tests real on-chain interactions to ensure blocking works correctly.
 *
 * Usage:
 *   bun scripts/verify/verify-blocking.ts [network]
 *   bun scripts/verify/verify-blocking.ts testnet
 *   bun scripts/verify/verify-blocking.ts mainnet --test  # Run integration tests
 *
 * Environment:
 *   DEPLOYER_PRIVATE_KEY - Private key for test transactions (only for --test)
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  isAddress,
  isHex,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

function parseAddress(
  value: string | undefined,
  context: string,
): Address | undefined {
  if (!value) return undefined
  if (!isAddress(value)) {
    throw new Error(`${context}: Invalid address format: ${value}`)
  }
  return value
}

function parseHex(value: string, context: string): Hex {
  if (!isHex(value)) {
    throw new Error(`${context}: Invalid hex format`)
  }
  return value
}

const CONTRACTS_DIR = path.join(import.meta.dirname, '../../packages/contracts')
const DEPLOYMENTS_DIR = path.join(CONTRACTS_DIR, 'deployments')

// ABIs for verification
const USER_BLOCK_REGISTRY_ABI = parseAbi([
  'function blockAddress(address target) external',
  'function unblockAddress(address target) external',
  'function isAddressBlocked(address blocker, address target) external view returns (bool)',
  'function isInteractionBlocked(address source, address target) external view returns (bool)',
  'function getBlockedAddressCount(address blocker) external view returns (uint256)',
  'function getBlockedAddresses(address blocker) external view returns (address[])',
  'function version() external view returns (string)',
  'event AddressBlocked(address indexed blocker, address indexed blocked, uint256 timestamp)',
  'event AddressUnblocked(address indexed blocker, address indexed blocked, uint256 timestamp)',
])

const OTC_ABI = parseAbi([
  'function setBlockRegistry(address _blockRegistry) external',
  'function blocking() external view returns (address)',
  'function isUserBlocked(address source, address target) external view returns (bool)',
])

const MESSAGING_KEY_REGISTRY_ABI = parseAbi([
  'function setBlockRegistry(address _blockRegistry) external',
  'function blocking() external view returns (address)',
  'function isUserBlocked(address source, address target) external view returns (bool)',
  'function version() external view returns (string)',
])

const MARKETPLACE_ABI = parseAbi([
  'function setBlockRegistry(address _blockRegistry) external',
  'function blocking() external view returns (address)',
  'function isUserBlocked(address source, address target) external view returns (bool)',
  'function version() external view returns (string)',
])

const X402_ABI = parseAbi([
  'function setBlockRegistry(address _blockRegistry) external',
  'function blocking() external view returns (address)',
  'function isPaymentBlocked(address payer, address recipient) external view returns (bool)',
])

const PLAYER_TRADE_ESCROW_ABI = parseAbi([
  'function setBlockRegistry(address _blockRegistry) external',
  'function blocking() external view returns (address)',
  'function isTradeBlocked(address playerA, address playerB) external view returns (bool)',
  'function version() external view returns (string)',
])

interface ChainConfig {
  chainId: number
  name: string
  rpcUrl: string
}

const CHAINS: Record<string, ChainConfig> = {
  testnet: {
    chainId: 420690,
    name: 'Jeju Testnet',
    rpcUrl:
      process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
  },
  mainnet: {
    chainId: 420691,
    name: 'Jeju Mainnet',
    rpcUrl: process.env.JEJU_RPC_URL || 'https://rpc.jejunetwork.org',
  },
  localnet: {
    chainId: 31337,
    name: 'Anvil',
    rpcUrl: process.env.ANVIL_RPC_URL || 'http://localhost:6545',
  },
  base: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  },
  baseSepolia: {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
  },
}

interface DeployedContracts {
  userBlockRegistry?: Address
  token?: Address
  otc?: Address
  messagingKeyRegistry?: Address
  marketplace?: Address
  x402Facilitator?: Address
  playerTradeEscrow?: Address
  identityRegistry?: Address
}

async function verifyContractExists(
  client: ReturnType<typeof createPublicClient>,
  address: Address,
): Promise<{ exists: boolean; error?: string }> {
  if (!address || address === '0x0000000000000000000000000000000000000000') {
    return { exists: false, error: 'Not deployed (zero address)' }
  }

  const code = await client.getCode({ address })
  if (!code || code === '0x') {
    return { exists: false, error: 'No code at address' }
  }

  return { exists: true }
}

async function verifyBlockRegistryIntegration(
  client: ReturnType<typeof createPublicClient>,
  contract: {
    address: Address
    name: string
    abi: ReturnType<typeof parseAbi>
  },
  expectedRegistry: Address,
): Promise<{
  integrated: boolean
  currentRegistry: Address | null
  error?: string
}> {
  const result = await verifyContractExists(client, contract.address)
  if (!result.exists) {
    return { integrated: false, currentRegistry: null, error: result.error }
  }

  const currentRegistryResult = await client.readContract({
    address: contract.address,
    abi: contract.abi,
    functionName: 'blocking',
  })
  const currentRegistry = currentRegistryResult as Address

  const integrated =
    currentRegistry.toLowerCase() === expectedRegistry.toLowerCase()

  return {
    integrated,
    currentRegistry,
    error: integrated
      ? undefined
      : `Registry mismatch: expected ${expectedRegistry}, got ${currentRegistry}`,
  }
}

async function runIntegrationTests(
  chain: ChainConfig,
  contracts: DeployedContracts,
): Promise<{
  passed: number
  failed: number
  results: Array<{ name: string; passed: boolean; error?: string }>
}> {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY required for integration tests')
  }

  const privateKeyHex = parseHex(privateKey, 'DEPLOYER_PRIVATE_KEY')
  const account = privateKeyToAccount(privateKeyHex)
  const publicClient = createPublicClient({
    transport: http(chain.rpcUrl),
  })
  const walletClient = createWalletClient({
    account,
    transport: http(chain.rpcUrl),
  })

  const results: Array<{ name: string; passed: boolean; error?: string }> = []
  let passed = 0
  let failed = 0

  const blockRegistry = contracts.userBlockRegistry
  if (!blockRegistry) {
    throw new Error('UserBlockRegistry not deployed')
  }

  // Test 1: Block an address
  console.log('  Test 1: Block an address...')
  const testAddress: Address = '0x1234567890123456789012345678901234567890'

  const hash1 = await walletClient.writeContract({
    address: blockRegistry,
    abi: USER_BLOCK_REGISTRY_ABI,
    functionName: 'blockAddress',
    args: [testAddress],
    chain: null,
  })
  await publicClient.waitForTransactionReceipt({ hash: hash1 })

  const isBlocked = (await publicClient.readContract({
    address: blockRegistry,
    abi: USER_BLOCK_REGISTRY_ABI,
    functionName: 'isAddressBlocked',
    args: [account.address, testAddress],
  })) as boolean

  if (isBlocked) {
    results.push({ name: 'Block address', passed: true })
    passed++
    console.log('    ✅ Block address')
  } else {
    results.push({
      name: 'Block address',
      passed: false,
      error: 'Block not registered',
    })
    failed++
    console.log('    ❌ Block address: Block not registered')
  }

  // Test 2: Check isInteractionBlocked
  console.log('  Test 2: Check interaction blocked...')
  const isInteractionBlocked = (await publicClient.readContract({
    address: blockRegistry,
    abi: USER_BLOCK_REGISTRY_ABI,
    functionName: 'isInteractionBlocked',
    args: [testAddress, account.address], // testAddress trying to interact with blocker
  })) as boolean

  if (isInteractionBlocked) {
    results.push({ name: 'Interaction blocked check', passed: true })
    passed++
    console.log('    ✅ Interaction blocked check')
  } else {
    results.push({
      name: 'Interaction blocked check',
      passed: false,
      error: 'Interaction should be blocked',
    })
    failed++
    console.log('    ❌ Interaction blocked check: Should be blocked')
  }

  // Test 3: Unblock address
  console.log('  Test 3: Unblock address...')
  const hash2 = await walletClient.writeContract({
    address: blockRegistry,
    abi: USER_BLOCK_REGISTRY_ABI,
    functionName: 'unblockAddress',
    args: [testAddress],
    chain: null,
  })
  await publicClient.waitForTransactionReceipt({ hash: hash2 })

  const stillBlocked = (await publicClient.readContract({
    address: blockRegistry,
    abi: USER_BLOCK_REGISTRY_ABI,
    functionName: 'isAddressBlocked',
    args: [account.address, testAddress],
  })) as boolean

  if (!stillBlocked) {
    results.push({ name: 'Unblock address', passed: true })
    passed++
    console.log('    ✅ Unblock address')
  } else {
    results.push({
      name: 'Unblock address',
      passed: false,
      error: 'Unblock failed',
    })
    failed++
    console.log('    ❌ Unblock address: Unblock failed')
  }

  // Test 4: Get blocked count
  console.log('  Test 4: Get blocked count...')
  const count = (await publicClient.readContract({
    address: blockRegistry,
    abi: USER_BLOCK_REGISTRY_ABI,
    functionName: 'getBlockedAddressCount',
    args: [account.address],
  })) as bigint

  if (count === 0n) {
    results.push({ name: 'Blocked count after unblock', passed: true })
    passed++
    console.log('    ✅ Blocked count is 0')
  } else {
    results.push({
      name: 'Blocked count after unblock',
      passed: false,
      error: `Count should be 0, got ${count}`,
    })
    failed++
    console.log(`    ❌ Blocked count: Expected 0, got ${count}`)
  }

  // Test 5: Version check
  console.log('  Test 5: Version check...')
  const version = (await publicClient.readContract({
    address: blockRegistry,
    abi: USER_BLOCK_REGISTRY_ABI,
    functionName: 'version',
  })) as string

  if (version === '1.0.0') {
    results.push({ name: 'Version check', passed: true })
    passed++
    console.log('    ✅ Version is 1.0.0')
  } else {
    results.push({
      name: 'Version check',
      passed: false,
      error: `Expected 1.0.0, got ${version}`,
    })
    failed++
    console.log(`    ❌ Version: Expected 1.0.0, got ${version}`)
  }

  return { passed, failed, results }
}

function loadDeployment(network: string): DeployedContracts | null {
  const possibleFiles = [
    path.join(DEPLOYMENTS_DIR, `blocking-${network}.json`),
    path.join(DEPLOYMENTS_DIR, `jeju-${network}.json`),
    path.join(DEPLOYMENTS_DIR, `${network}.json`),
  ]

  for (const file of possibleFiles) {
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf-8'))
      return data.contracts || data
    }
  }

  // Check environment variables for contract addresses
  const fromEnv: DeployedContracts = {}

  const userBlockRegistryAddr = parseAddress(
    process.env.USER_BLOCK_REGISTRY_ADDRESS,
    'USER_BLOCK_REGISTRY_ADDRESS',
  )
  if (userBlockRegistryAddr) {
    fromEnv.userBlockRegistry = userBlockRegistryAddr
  }
  const tokenAddr = parseAddress(process.env.TOKEN_ADDRESS, 'TOKEN_ADDRESS')
  if (tokenAddr) {
    fromEnv.token = tokenAddr
  }
  const otcAddr = parseAddress(process.env.OTC_ADDRESS, 'OTC_ADDRESS')
  if (otcAddr) {
    fromEnv.otc = otcAddr
  }
  const messagingKeyRegistryAddr = parseAddress(
    process.env.MESSAGING_KEY_REGISTRY_ADDRESS,
    'MESSAGING_KEY_REGISTRY_ADDRESS',
  )
  if (messagingKeyRegistryAddr) {
    fromEnv.messagingKeyRegistry = messagingKeyRegistryAddr
  }
  const marketplaceAddr = parseAddress(
    process.env.MARKETPLACE_ADDRESS,
    'MARKETPLACE_ADDRESS',
  )
  if (marketplaceAddr) {
    fromEnv.marketplace = marketplaceAddr
  }
  const x402FacilitatorAddr = parseAddress(
    process.env.X402_FACILITATOR_ADDRESS,
    'X402_FACILITATOR_ADDRESS',
  )
  if (x402FacilitatorAddr) {
    fromEnv.x402Facilitator = x402FacilitatorAddr
  }
  const playerTradeEscrowAddr = parseAddress(
    process.env.PLAYER_TRADE_ESCROW_ADDRESS,
    'PLAYER_TRADE_ESCROW_ADDRESS',
  )
  if (playerTradeEscrowAddr) {
    fromEnv.playerTradeEscrow = playerTradeEscrowAddr
  }

  if (Object.keys(fromEnv).length > 0) {
    return fromEnv
  }

  return null
}

async function main() {
  const args = process.argv.slice(2)
  const network = args[0] || 'testnet'
  const runTests = args.includes('--test')

  console.log(
    '╔══════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║           USER BLOCKING SYSTEM VERIFICATION                      ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════════╝',
  )
  console.log(`Network: ${network}`)
  console.log(`Run Tests: ${runTests}`)
  console.log('')

  const chain = CHAINS[network]
  if (!chain) {
    console.log(`❌ Unknown network: ${network}`)
    console.log(`   Available: ${Object.keys(CHAINS).join(', ')}`)
    process.exit(1)
  }

  console.log(`Chain: ${chain.name} (${chain.chainId})`)
  console.log(`RPC: ${chain.rpcUrl}`)
  console.log('')

  // Load deployment info
  const contracts = loadDeployment(network)
  if (!contracts) {
    console.log(
      '⚠️  No deployment info found. Using environment variables or run deployment first.',
    )
    console.log('   Set environment variables:')
    console.log('     USER_BLOCK_REGISTRY_ADDRESS=0x...')
    console.log('     TOKEN_ADDRESS=0x...')
    console.log('     OTC_ADDRESS=0x...')
    console.log('')
  }

  const publicClient = createPublicClient({
    transport: http(chain.rpcUrl),
  })

  // Verify contract deployments
  console.log('--- Contract Verification ---')

  const contractsToVerify = [
    { name: 'UserBlockRegistry', address: contracts?.userBlockRegistry },
    { name: 'Token', address: contracts?.token },
    { name: 'OTC', address: contracts?.otc },
    { name: 'MessagingKeyRegistry', address: contracts?.messagingKeyRegistry },
    { name: 'Marketplace', address: contracts?.marketplace },
    { name: 'X402Facilitator', address: contracts?.x402Facilitator },
    { name: 'PlayerTradeEscrow', address: contracts?.playerTradeEscrow },
  ]

  let allDeployed = true
  for (const contract of contractsToVerify) {
    if (!contract.address) {
      console.log(`  ${contract.name}: ⚠️  Address not configured`)
      continue
    }

    const result = await verifyContractExists(publicClient, contract.address)
    if (result.exists) {
      console.log(`  ${contract.name}: ✅ ${contract.address.slice(0, 10)}...`)
    } else {
      console.log(`  ${contract.name}: ❌ ${result.error}`)
      allDeployed = false
    }
  }
  console.log('')

  // Check registry integrations
  if (contracts?.userBlockRegistry) {
    console.log('--- Registry Integration Verification ---')

    const integrations = [
      { name: 'OTC', address: contracts.otc, abi: OTC_ABI },
      {
        name: 'MessagingKeyRegistry',
        address: contracts.messagingKeyRegistry,
        abi: MESSAGING_KEY_REGISTRY_ABI,
      },
      {
        name: 'Marketplace',
        address: contracts.marketplace,
        abi: MARKETPLACE_ABI,
      },
      {
        name: 'X402Facilitator',
        address: contracts.x402Facilitator,
        abi: X402_ABI,
      },
      {
        name: 'PlayerTradeEscrow',
        address: contracts.playerTradeEscrow,
        abi: PLAYER_TRADE_ESCROW_ABI,
      },
    ]

    for (const integration of integrations) {
      if (!integration.address) {
        console.log(`  ${integration.name}: ⚠️  Not configured`)
        continue
      }

      const result = await verifyBlockRegistryIntegration(
        publicClient,
        {
          address: integration.address,
          name: integration.name,
          abi: integration.abi,
        },
        contracts.userBlockRegistry,
      )

      if (result.integrated) {
        console.log(`  ${integration.name}: ✅ Integrated`)
      } else if (result.currentRegistry === null) {
        console.log(`  ${integration.name}: ⚠️  Contract not deployed`)
      } else if (
        result.currentRegistry === '0x0000000000000000000000000000000000000000'
      ) {
        console.log(
          `  ${integration.name}: ⚠️  Registry not set (run setBlockRegistry)`,
        )
      } else {
        console.log(`  ${integration.name}: ❌ ${result.error}`)
      }
    }
    console.log('')
  }

  // Run integration tests if requested
  if (runTests && contracts?.userBlockRegistry) {
    console.log('--- Integration Tests ---')
    const testResults = await runIntegrationTests(chain, contracts)
    console.log('')
    console.log(
      `Results: ${testResults.passed} passed, ${testResults.failed} failed`,
    )
    console.log('')

    if (testResults.failed > 0) {
      process.exit(1)
    }
  }

  // Summary
  console.log('--- Summary ---')
  if (allDeployed) {
    console.log('✅ All configured contracts are deployed')
  } else {
    console.log('⚠️  Some contracts missing or not deployed')
  }

  console.log('')
  console.log('Next steps:')
  console.log('  1. Deploy UserBlockRegistry if not deployed')
  console.log('  2. Call setBlockRegistry on each integrated contract')
  console.log('  3. Update app configurations to use blocking')
  console.log(
    '  4. Run integration tests: bun scripts/verify/verify-blocking.ts <network> --test',
  )

  process.exit(allDeployed ? 0 : 1)
}

main().catch((error) => {
  console.error('Verification failed:', error)
  process.exit(1)
})

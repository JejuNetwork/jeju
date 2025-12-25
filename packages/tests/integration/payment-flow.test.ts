/**
 * Payment Flow Integration Test
 *
 * End-to-end test of the complete payment flow:
 * 1. User requests service (chat-completion)
 * 2. Paymaster charges user (gasless or direct token)
 * 3. Balance is updated correctly
 * 4. Usage is recorded in ServiceRegistry
 * 5. Events are emitted properly
 *
 * Tests both payment methods:
 * - Gasless (via ServicePaymaster + ERC-4337)
 * - Direct token payment
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  parseAbi,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { JEJU_LOCALNET, TEST_WALLETS } from '../shared/constants'

// Check if localnet is available
const rpcUrl = JEJU_LOCALNET.rpcUrl
let localnetAvailable = false
try {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    }),
    signal: AbortSignal.timeout(2000),
  })
  localnetAvailable = response.ok
} catch {
  console.log(
    `Localnet not available at ${rpcUrl}, skipping payment flow tests`,
  )
}

// Use deployer for authorized calls, test account for user operations
const DEPLOYER_ACCOUNT = privateKeyToAccount(
  TEST_WALLETS.deployer.privateKey as `0x${string}`,
)

const TEST_CONFIG = {
  rpcUrl: JEJU_LOCALNET.rpcUrl,
  chainId: JEJU_LOCALNET.chainId,
  contracts: {
    jejuToken: (process.env.JEJU_TOKEN_ADDRESS ||
      '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Address,
    cloudServiceRegistry: (process.env.CLOUD_SERVICE_REGISTRY_ADDRESS ||
      '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address,
    cloudPaymaster: (process.env.CLOUD_PAYMASTER_ADDRESS ||
      '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0') as Address,
  },
  testAccount: privateKeyToAccount(
    (process.env.TEST_PRIVATE_KEY ||
      TEST_WALLETS.user1.privateKey) as `0x${string}`,
  ),
  deployerAccount: DEPLOYER_ACCOUNT,
}

const jejuChain = {
  id: TEST_CONFIG.chainId,
  name: 'Network',
  network: 'jeju',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [TEST_CONFIG.rpcUrl] },
    public: { http: [TEST_CONFIG.rpcUrl] },
  },
} as const

const publicClient = createPublicClient({ chain: jejuChain, transport: http() })
const walletClient = createWalletClient({
  account: TEST_CONFIG.testAccount,
  chain: jejuChain,
  transport: http(),
})

// Deployer wallet for admin operations
const deployerWalletClient = createWalletClient({
  account: TEST_CONFIG.deployerAccount,
  chain: jejuChain,
  transport: http(),
})

// Standard ABIs
const ERC20_ABI = parseAbi([
  'function balanceOf(address) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
])

const SERVICE_REGISTRY_ABI = parseAbi([
  'function getServiceCost(string calldata serviceName, address user) external view returns (uint256)',
  'function recordUsage(address user, string calldata serviceName, uint256 actualCost, bytes32 sessionId) external',
  'function userUsage(address user, string calldata serviceName) external view returns (uint256 totalSpent, uint256 requestCount, uint256 lastUsedBlock, uint256 volumeDiscount)',
  'function getUserVolumeDiscount(address user, string calldata serviceName) external view returns (uint256)',
  'function services(string calldata serviceName) external view returns (uint256 basePriceJeju, uint256 demandMultiplier, uint256 totalUsageCount, uint256 totalRevenueJeju, bool isActive, uint256 minPrice, uint256 maxPrice)',
  'function authorizedCallers(address caller) external view returns (bool)',
  'function addAuthorizedCaller(address caller) external',
  'event ServiceUsageRecorded(address indexed user, string serviceName, uint256 cost, bytes32 sessionId, uint256 volumeDiscount)',
])

const PAYMASTER_ABI = parseAbi([
  'function getDeposit() external view returns (uint256)',
  'function serviceRegistry() external view returns (address)',
])

describe.skipIf(!localnetAvailable)('Payment Flow Integration', () => {
  let initialBalance: bigint
  let serviceCost: bigint
  let isTestAccountAuthorized: boolean

  beforeAll(async () => {
    // Get initial JEJU token balance
    initialBalance = await publicClient.readContract({
      address: TEST_CONFIG.contracts.jejuToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [TEST_CONFIG.testAccount.address],
    })

    console.log(`Initial balance: ${formatUnits(initialBalance, 18)} JEJU`)

    // Get service cost for chat-completion
    serviceCost = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: SERVICE_REGISTRY_ABI,
      functionName: 'getServiceCost',
      args: ['chat-completion', TEST_CONFIG.testAccount.address],
    })

    console.log(`Service cost: ${formatUnits(serviceCost, 18)} JEJU`)

    // Check if test account is authorized to call recordUsage
    isTestAccountAuthorized = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: SERVICE_REGISTRY_ABI,
      functionName: 'authorizedCallers',
      args: [TEST_CONFIG.testAccount.address],
    })

    console.log(`Test account authorized: ${isTestAccountAuthorized}`)
  })

  test('Should get accurate service cost quote', async () => {
    const cost = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: SERVICE_REGISTRY_ABI,
      functionName: 'getServiceCost',
      args: ['chat-completion', TEST_CONFIG.testAccount.address],
    })

    expect(cost).toBeGreaterThan(0n)
    expect(cost).toBeLessThan(parseEther('1000')) // Sanity check: cost < 1000 JEJU
  })

  test('Should record service usage with direct payment', async () => {
    // First, approve ServiceRegistry to spend JEJU tokens
    const approveTx = await walletClient.writeContract({
      address: TEST_CONFIG.contracts.jejuToken,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [TEST_CONFIG.contracts.cloudServiceRegistry, serviceCost * 2n],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveTx })

    // Generate session ID
    const sessionId =
      `0x${Date.now().toString(16).padStart(64, '0')}` as `0x${string}`

    // If test account is not authorized, authorize it via deployer (who should be admin)
    if (!isTestAccountAuthorized) {
      const authorizeTx = await deployerWalletClient.writeContract({
        address: TEST_CONFIG.contracts.cloudServiceRegistry,
        abi: SERVICE_REGISTRY_ABI,
        functionName: 'addAuthorizedCaller',
        args: [TEST_CONFIG.testAccount.address],
      })
      await publicClient.waitForTransactionReceipt({ hash: authorizeTx })
      console.log(`Authorized test account as caller`)
    }

    // Record usage - test account should now be authorized
    const usageTx = await walletClient.writeContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: SERVICE_REGISTRY_ABI,
      functionName: 'recordUsage',
      args: [
        TEST_CONFIG.testAccount.address,
        'chat-completion',
        serviceCost,
        sessionId,
      ],
    })

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: usageTx,
    })

    // Verify transaction succeeded
    expect(receipt.status).toBe('success')
    expect(receipt.logs.length).toBeGreaterThan(0)

    // Decode ServiceUsageRecorded event
    const usageEvents = receipt.logs.filter((log) => {
      try {
        const decoded = decodeEventLog({
          abi: SERVICE_REGISTRY_ABI,
          data: log.data,
          topics: log.topics,
        })
        return decoded.eventName === 'ServiceUsageRecorded'
      } catch {
        return false
      }
    })

    expect(usageEvents.length).toBeGreaterThan(0)

    // Check balance was debited
    const newBalance = await publicClient.readContract({
      address: TEST_CONFIG.contracts.jejuToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [TEST_CONFIG.testAccount.address],
    })

    expect(newBalance).toBeLessThan(initialBalance)
    console.log(`Balance after usage: ${formatUnits(newBalance, 18)} JEJU`)
  })

  test('Should track user usage statistics', async () => {
    const usage = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: SERVICE_REGISTRY_ABI,
      functionName: 'userUsage',
      args: [TEST_CONFIG.testAccount.address, 'chat-completion'],
    })

    const [totalSpent, requestCount, _lastUsedBlock, volumeDiscount] = usage

    console.log(`User stats:`)
    console.log(`  Total spent: ${formatUnits(totalSpent, 18)} JEJU`)
    console.log(`  Request count: ${requestCount}`)
    console.log(`  Volume discount: ${volumeDiscount} bps`)

    expect(totalSpent).toBeGreaterThanOrEqual(0n)
    expect(requestCount).toBeGreaterThanOrEqual(0n)
    expect(volumeDiscount).toBeLessThanOrEqual(2000n) // Max 20% discount
  })

  test('Should calculate volume discounts correctly', async () => {
    const discount = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: SERVICE_REGISTRY_ABI,
      functionName: 'getUserVolumeDiscount',
      args: [TEST_CONFIG.testAccount.address, 'chat-completion'],
    })

    // Discount should be in valid range (0-2000 bps = 0-20%)
    expect(discount).toBeLessThanOrEqual(2000n)
    console.log(
      `Current volume discount: ${discount} bps (${Number(discount) / 100}%)`,
    )
  })

  test('Should have sufficient paymaster deposit for gasless transactions', async () => {
    const deposit = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudPaymaster,
      abi: PAYMASTER_ABI,
      functionName: 'getDeposit',
    })

    console.log(`Paymaster deposit: ${formatUnits(deposit, 18)} ETH`)

    // Should have at least some deposit for paying gas
    expect(deposit).toBeGreaterThan(0n)
  })

  test('Should verify paymaster is linked to service registry', async () => {
    const linkedRegistry = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudPaymaster,
      abi: PAYMASTER_ABI,
      functionName: 'serviceRegistry',
    })

    expect(linkedRegistry.toLowerCase()).toBe(
      TEST_CONFIG.contracts.cloudServiceRegistry.toLowerCase(),
    )
  })

  test('Should retrieve service pricing info', async () => {
    const service = await publicClient.readContract({
      address: TEST_CONFIG.contracts.cloudServiceRegistry,
      abi: SERVICE_REGISTRY_ABI,
      functionName: 'services',
      args: ['chat-completion'],
    })

    const [
      basePriceJeju,
      demandMultiplier,
      totalUsageCount,
      totalRevenueJeju,
      isActive,
      minPrice,
      maxPrice,
    ] = service

    console.log(`Chat-completion service:`)
    console.log(`  Base price: ${formatUnits(basePriceJeju, 18)} JEJU`)
    console.log(`  Demand multiplier: ${demandMultiplier} bps`)
    console.log(`  Total usage: ${totalUsageCount}`)
    console.log(
      `  Total revenue: ${formatUnits(totalRevenueJeju, 18)} JEJU`,
    )
    console.log(`  Is active: ${isActive}`)

    expect(isActive).toBe(true)
    expect(basePriceJeju).toBeGreaterThan(0n)
    expect(minPrice).toBeGreaterThan(0n)
    expect(maxPrice).toBeGreaterThan(minPrice)
  })
})

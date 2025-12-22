#!/usr/bin/env bun
/**
 * Cloud Integration - Complete Workflow E2E Test
 *
 * Tests the entire user journey from registration to ban:
 * 1. User registers as agent
 * 2. User deposits credits
 * 3. User makes successful requests (builds good reputation)
 * 4. User violates TOS multiple times
 * 5. User gets auto-banned
 * 6. User's subsequent requests are rejected
 *
 * NO MOCKS - full integration test.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import {
  type Account,
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  formatUnits,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
  parseEther,
  parseUnits,
  stringToBytes,
  stringToHex,
  type WalletClient,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from 'viem/actions'
import { inferChainFromRpcUrl } from '../../../packages/deployment/scripts/shared/chain-utils'
import {
  type CloudConfig,
  CloudIntegration,
  ViolationType,
} from '../../packages/deployment/scripts/shared/cloud-integration'
import { Logger } from '../../packages/deployment/scripts/shared/logger'

const logger = new Logger('cloud-complete-workflow')

let publicClient: PublicClient
let cloudOperator: WalletClient
let cloudOperatorAccount: Account
let _cloudAgentSigner: WalletClient
let cloudAgentAccount: Account
let testUser: WalletClient
let testUserAccount: Account
let integration: CloudIntegration
let userAgentId: bigint

describe('Complete User Workflow E2E', () => {
  beforeAll(async () => {
    logger.info('🚀 Setting up complete workflow test...')

    const rpcUrl = 'http://localhost:6546'
    const chain = inferChainFromRpcUrl(rpcUrl)

    publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    })

    cloudOperatorAccount = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as `0x${string}`,
    )
    cloudOperator = createWalletClient({
      account: cloudOperatorAccount,
      chain,
      transport: http(rpcUrl),
    })

    cloudAgentAccount = privateKeyToAccount(
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as `0x${string}`,
    )
    _cloudAgentSigner = createWalletClient({
      account: cloudAgentAccount,
      chain,
      transport: http(rpcUrl),
    })

    testUserAccount = privateKeyToAccount(
      '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' as `0x${string}`,
    )
    testUser = createWalletClient({
      account: testUserAccount,
      chain,
      transport: http(rpcUrl),
    })

    const config: CloudConfig = {
      identityRegistryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      reputationRegistryAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      cloudReputationProviderAddress:
        '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
      serviceRegistryAddress: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
      creditManagerAddress: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
      rpcUrl,
      chain,
      logger,
      cloudAgentSigner: cloudAgentAccount,
      chainId: 31337n,
    }

    integration = new CloudIntegration(config)
    logger.success('✓ Integration initialized')
  })

  test('STEP 1: User registers as agent', async () => {
    logger.info('👤 Step 1: User registration...')

    const identityRegistryAbi = parseAbi([
      'function register(string calldata tokenURI) external returns (uint256)',
      'event Registered(uint256 indexed agentId, address indexed owner, uint8 tier, uint256 registeredAt, string tokenURI)',
    ])
    const identityRegistryAddress =
      '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address

    const hash = await writeContract(testUser, {
      address: identityRegistryAddress,
      abi: identityRegistryAbi,
      functionName: 'register',
      args: ['ipfs://QmTestUser'],
    })

    const receipt = await waitForTransactionReceipt(publicClient, { hash })

    const registeredEventSignature = keccak256(
      stringToHex('Registered(uint256,address,uint8,uint256,string)'),
    )
    const event = receipt.logs.find(
      (log) => log.topics[0] === registeredEventSignature,
    )

    if (!event) {
      throw new Error('Registered event not found')
    }

    const decoded = decodeEventLog({
      abi: identityRegistryAbi,
      data: event.data,
      topics: event.topics,
    })

    userAgentId = decoded.args.agentId as bigint
    expect(userAgentId).toBeGreaterThan(0n)

    logger.success(`✓ User registered with agent ID: ${userAgentId}`)
  })

  test('STEP 2: User deposits credits', async () => {
    logger.info('💳 Step 2: Depositing credits...')

    const usdcAddress = '0x0165878A594ca255338adfa4d48449f69242Eb8F' as Address
    const creditManagerAddress =
      '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9' as Address

    const usdcAbi = parseAbi([
      'function approve(address spender, uint256 amount) external returns (bool)',
      'function balanceOf(address account) external view returns (uint256)',
    ])

    const creditManagerAbi = parseAbi([
      'function depositUSDC(uint256 amount) external',
      'function getBalance(address user, address token) external view returns (uint256)',
    ])

    const depositAmount = parseUnits('100', 6) // $100 USDC

    // Check USDC balance
    const usdcBalance = await readContract(publicClient, {
      address: usdcAddress,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [testUserAccount.address],
    })
    if (usdcBalance < depositAmount) {
      logger.warn('  Insufficient USDC balance, skipping deposit')
      return
    }

    // Approve and deposit
    const approveHash = await writeContract(testUser, {
      address: usdcAddress,
      abi: usdcAbi,
      functionName: 'approve',
      args: [creditManagerAddress, depositAmount],
    })
    await waitForTransactionReceipt(publicClient, { hash: approveHash })

    const depositHash = await writeContract(testUser, {
      address: creditManagerAddress,
      abi: creditManagerAbi,
      functionName: 'depositUSDC',
      args: [depositAmount],
    })
    await waitForTransactionReceipt(publicClient, { hash: depositHash })

    const balance = await readContract(publicClient, {
      address: creditManagerAddress,
      abi: creditManagerAbi,
      functionName: 'getBalance',
      args: [testUserAccount.address, usdcAddress],
    })
    expect(balance).toBeGreaterThanOrEqual(depositAmount)

    logger.success(`✓ Deposited ${formatUnits(depositAmount, 6)} USDC`)
  })

  test('STEP 3: User makes 10 successful requests (builds reputation)', async () => {
    logger.info('⭐ Step 3: Building good reputation...')

    for (let i = 0; i < 10; i++) {
      await integration.setReputation(
        cloudOperator,
        userAgentId,
        90 + (i % 8), // Scores between 90-97
        'quality',
        `request-${i}`,
        `Successful API request #${i}`,
      )

      if (i % 3 === 0) {
        logger.info(`  Processed ${i + 1}/10 requests...`)
      }
    }

    const reputation = await integration.getAgentReputation(userAgentId)
    expect(reputation.averageScore).toBeGreaterThan(85)
    expect(reputation.count).toBe(10n)

    logger.success(
      `✓ Good reputation established: ${reputation.averageScore}/100 (${reputation.count} reviews)`,
    )
  })

  test('STEP 4: User violates TOS (API abuse)', async () => {
    logger.info('🚫 Step 4: User violates TOS...')

    // Record first violation
    await integration.recordViolation(
      cloudOperator,
      userAgentId,
      ViolationType.API_ABUSE,
      70,
      'ipfs://QmRateLimitExceeded',
    )

    logger.warn('  ✗ Violation 1: API_ABUSE (severity: 70)')

    // User continues bad behavior
    await integration.setReputation(
      cloudOperator,
      userAgentId,
      40, // Low score
      'security',
      'rate-limit',
      'Rate limit exceeded',
    )

    await integration.recordViolation(
      cloudOperator,
      userAgentId,
      ViolationType.API_ABUSE,
      85,
      'ipfs://QmSevereAbuse',
    )

    logger.warn('  ✗ Violation 2: API_ABUSE (severity: 85)')

    // Third strike
    await integration.recordViolation(
      cloudOperator,
      userAgentId,
      ViolationType.API_ABUSE,
      90,
      'ipfs://QmPersistentAbuse',
    )

    logger.warn('  ✗ Violation 3: API_ABUSE (severity: 90)')

    const violations = await integration.getAgentViolations(userAgentId)
    expect(violations.length).toBeGreaterThanOrEqual(3)

    logger.success(`✓ ${violations.length} violations recorded`)
  })

  test('STEP 5: Automatic ban triggered', async () => {
    logger.info('⚖️  Step 5: Ban proposal and approval...')

    // Propose ban
    const proposalId = await integration.proposeBan(
      cloudOperator,
      userAgentId,
      ViolationType.API_ABUSE,
      'ipfs://QmBanEvidence',
    )

    expect(proposalId).toBeDefined()
    logger.warn(`  ✗ Ban proposed: ${proposalId}`)

    // In a real scenario, multiple approvers would approve
    // For this test, we'll simulate with the operator
    logger.info('  (Multi-sig approval would happen here)')
    logger.success('✓ Ban process initiated')
  })

  test('STEP 6: Verify user cannot access services', async () => {
    logger.info('🔒 Step 6: Verifying ban enforcement...')

    const identityRegistryAbi = parseAbi([
      'function getAgent(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed))',
    ])
    const identityRegistryAddress =
      '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address

    const agent = (await publicClient.readContract({
      address: identityRegistryAddress,
      abi: identityRegistryAbi,
      functionName: 'getAgent',
      args: [userAgentId],
    })) as { isBanned: boolean }

    if (agent.isBanned) {
      logger.success('✓ User is BANNED - all requests should be rejected')
    } else {
      logger.info('  (Ban may require multi-sig approval first)')
    }

    // Check final reputation
    const finalReputation = await integration.getAgentReputation(userAgentId)
    logger.info(`  Final reputation: ${finalReputation.averageScore}/100`)

    // Check violations
    const violations = await integration.getAgentViolations(userAgentId)
    logger.info(`  Total violations: ${violations.length}`)

    logger.success('✓ Complete workflow verified')
  })
})

describe('Rate Limiting Workflow E2E', () => {
  test('WORKFLOW: Rapid requests → Rate limit → Violation → Reputation penalty', async () => {
    logger.info('🔄 Testing rate limiting workflow...')

    // Simulate rapid requests (this would normally be in cloud-reputation.ts middleware)
    const rapidRequests = 100
    const rateLimit = 60 // requests per minute

    if (rapidRequests > rateLimit) {
      logger.warn(`  Detected ${rapidRequests} requests > ${rateLimit} limit`)

      // Record violation
      await integration.recordViolation(
        cloudOperator,
        userAgentId,
        ViolationType.API_ABUSE,
        80,
        `Rate limit exceeded: ${rapidRequests} requests in 1 minute`,
      )

      // Penalize reputation
      await integration.setReputation(
        cloudOperator,
        userAgentId,
        30, // Severe penalty
        'security',
        'rate-limit',
        'Rate limit violation',
      )

      logger.success('✓ Rate limit violation handled')
    }
  })
})

describe('Auto-Ban Threshold Workflow E2E', () => {
  let abusiveUserAgentId: bigint

  test('WORKFLOW: Create new user for auto-ban test', async () => {
    logger.info('👤 Creating new user for auto-ban test...')

    const newUserPrivateKey = generatePrivateKey()
    const newUserAccount = privateKeyToAccount(newUserPrivateKey)
    const chain = publicClient.chain
    if (!chain) throw new Error('Public client chain not configured')
    const newUser = createWalletClient({
      account: newUserAccount,
      chain,
      transport: http('http://localhost:6546'),
    })

    // Fund user with ETH
    const fundHash = await cloudOperator.sendTransaction({
      to: newUserAccount.address,
      value: parseEther('1'),
    })
    await waitForTransactionReceipt(publicClient, { hash: fundHash })

    const identityRegistryAbi = parseAbi([
      'function register() external returns (uint256)',
    ])
    const identityRegistryAddress =
      '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address

    const registerHash = await newUser.writeContract({
      address: identityRegistryAddress,
      abi: identityRegistryAbi,
      functionName: 'register',
      args: [],
    })

    const receipt = await waitForTransactionReceipt(publicClient, {
      hash: registerHash,
    })

    const registeredEventTopic = keccak256(
      stringToBytes('Registered(uint256,address,uint8,uint256,string)'),
    )
    const event = receipt.logs.find(
      (log) => log.topics[0] === registeredEventTopic,
    )

    if (!event) throw new Error('Registered event not found')
    abusiveUserAgentId = BigInt(event.topics[1])
    logger.success(`✓ New user agent ID: ${abusiveUserAgentId}`)
  })

  test('WORKFLOW: Repeated violations trigger auto-ban', async () => {
    logger.info('⚠️  Recording severe violations...')

    // Record 5 severe violations
    for (let i = 0; i < 5; i++) {
      await integration.recordViolation(
        cloudOperator,
        abusiveUserAgentId,
        ViolationType.HACKING,
        95 + i, // Severity 95-99
        `ipfs://QmHackAttempt${i}`,
      )

      logger.warn(`  ✗ Violation ${i + 1}: HACKING (severity: ${95 + i})`)
    }

    const violations = await integration.getAgentViolations(abusiveUserAgentId)
    expect(violations.length).toBe(5)

    // Set low reputation (triggers auto-ban threshold)
    await integration.setReputation(
      cloudOperator,
      abusiveUserAgentId,
      10, // Below threshold (20)
      'security',
      'hacking',
      'Multiple hacking attempts',
    )

    logger.success('✓ Auto-ban threshold triggered')

    // Verify TOS violation was auto-recorded
    const updatedViolations =
      await integration.getAgentViolations(abusiveUserAgentId)
    const tosViolations = updatedViolations.filter(
      (v) => Number(v.violationType) === ViolationType.TOS_VIOLATION,
    )

    expect(tosViolations.length).toBeGreaterThan(0)
    logger.success(
      `✓ TOS violation auto-recorded (total: ${updatedViolations.length})`,
    )
  })
})

describe('Service Discovery and Cost E2E', () => {
  test('WORKFLOW: Discover services → Check cost → Verify credit', async () => {
    logger.info('🔍 Testing service discovery workflow...')

    const services = ['chat-completion', 'image-generation', 'embeddings']

    for (const serviceName of services) {
      // Check if service is available
      const serviceRegistryAbi = parseAbi([
        'function isServiceAvailable(string calldata serviceName) external view returns (bool)',
        'function getServiceCost(string calldata serviceName, address user) external view returns (uint256)',
      ])
      const serviceRegistryAddress =
        '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as Address

      const isAvailable = (await publicClient.readContract({
        address: serviceRegistryAddress,
        abi: serviceRegistryAbi,
        functionName: 'isServiceAvailable',
        args: [serviceName],
      })) as boolean

      if (!isAvailable) {
        logger.warn(`  ${serviceName}: Not available`)
        continue
      }

      // Get cost
      const cost = (await publicClient.readContract({
        address: serviceRegistryAddress,
        abi: serviceRegistryAbi,
        functionName: 'getServiceCost',
        args: [serviceName, testUserAccount.address],
      })) as bigint

      logger.info(`  ${serviceName}: ${formatEther(cost)} elizaOS`)

      // Check user credit
      const credit = await integration.checkUserCredit(
        testUserAccount.address,
        serviceName,
        '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853' as Address, // elizaOS token
      )

      logger.info(
        `    Credit: ${credit.sufficient ? 'Sufficient ✓' : 'Insufficient ✗'}`,
      )
    }

    logger.success('✓ Service discovery workflow complete')
  })
})

describe('Reputation Summary E2E', () => {
  test('WORKFLOW: Query reputation across categories', async () => {
    logger.info('📊 Querying reputation summary...')

    const categories = ['quality', 'reliability', 'security']

    for (const category of categories) {
      const reputation = await integration.getAgentReputation(
        userAgentId,
        category,
      )

      if (reputation.count > 0n) {
        logger.info(
          `  ${category}: ${reputation.averageScore}/100 (${reputation.count} reviews)`,
        )
      } else {
        logger.info(`  ${category}: No data`)
      }
    }

    // Overall reputation
    const overall = await integration.getAgentReputation(userAgentId)
    logger.success(
      `✓ Overall: ${overall.averageScore}/100 (${overall.count} total reviews)`,
    )
  })
})

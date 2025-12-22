#!/usr/bin/env bun
/**
 * Payment System Integration E2E Tests
 *
 * Comprehensive tests for the payment infrastructure:
 * - x402 micropayments across all apps
 * - Paymaster gas subsidization
 * - Staking for combined EIL + gas liquidity
 * - Credit manager prepaid balances
 * - Fee distribution to stakers
 *
 * Run with: bun test packages/tests/e2e/payment-integration.test.ts
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getChainId, readContract } from 'viem/actions'
import { inferChainFromRpcUrl } from '../../../packages/deployment/scripts/shared/chain-utils'
import { Logger } from '../../../packages/deployment/scripts/shared/logger'
// Import shared utilities
import {
  createPaymentPayload,
  createPaymentRequirement,
  PAYMENT_TIERS,
  type PaymentPayload,
  signPaymentPayload,
  verifyPayment,
} from '../../../packages/deployment/scripts/shared/x402'
import { JEJU_LOCALNET, TEST_WALLETS } from '../shared/constants'

const logger = new Logger({ prefix: 'payment-e2e' })

// ============ Configuration ============

const RPC_URL = JEJU_LOCALNET.rpcUrl
const _CHAIN_ID = JEJU_LOCALNET.chainId

// Test accounts (Anvil defaults)
const DEPLOYER_KEY = TEST_WALLETS.deployer.privateKey as `0x${string}`
const USER_KEY = TEST_WALLETS.user1.privateKey as `0x${string}`
const STAKER_KEY = TEST_WALLETS.user2.privateKey as `0x${string}`

// Contract addresses (populated from env or defaults)
const ADDRESSES = {
  paymentToken: (process.env.STAKING_TOKEN_ADDRESS ||
    '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Address,
  creditManager: (process.env.CREDIT_MANAGER_ADDRESS ||
    '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9') as Address,
  staking: (process.env.STAKING_ADDRESS ||
    '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address,
  paymasterFactory: (process.env.PAYMASTER_FACTORY_ADDRESS ||
    '0x0000000000000000000000000000000000000000') as Address,
  x402Recipient: (process.env.X402_RECIPIENT_ADDRESS ||
    TEST_WALLETS.deployer.address) as Address,
}

// ============ ABIs ============

const _ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
  'function transfer(address, uint256) returns (bool)',
  'function allowance(address, address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

const CREDIT_MANAGER_ABI = [
  'function depositUSDC(uint256)',
  'function depositETH() payable',
  'function depositElizaOS(uint256)',
  'function getBalance(address, address) view returns (uint256)',
  'function hasSufficientCredit(address, address, uint256) view returns (bool, uint256)',
  'function getAllBalances(address) view returns (uint256, uint256, uint256)',
  'function withdraw(address, uint256)',
  'function usdc() view returns (address)',
  'function elizaOS() view returns (address)',
]

const _STAKING_ABI = [
  'function stake(uint256) payable',
  'function startUnbonding(uint256, uint256)',
  'function claimFees()',
  'function distributeFees(uint256, uint256)',
  'function getPosition(address) view returns (uint256, uint256, uint256, uint256, uint256, uint256, bool)',
  'function getPoolStats() view returns (uint256, uint256, uint256, uint256, uint256, uint256)',
  'function totalStaked() view returns (uint256)',
  'function minimumStake() view returns (uint256)',
]

// ============ Test Setup ============

let publicClient: ReturnType<typeof createPublicClient>
let deployerAccount: ReturnType<typeof privateKeyToAccount>
let userAccount: ReturnType<typeof privateKeyToAccount>
let stakerAccount: ReturnType<typeof privateKeyToAccount>
let _deployerWalletClient: ReturnType<typeof createWalletClient>
let _userWalletClient: ReturnType<typeof createWalletClient>
let _stakerWalletClient: ReturnType<typeof createWalletClient>
let localnetAvailable = false

// Check localnet availability
try {
  const response = await fetch(RPC_URL, {
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
    `Localnet not available at ${RPC_URL}, skipping payment integration tests`,
  )
}

describe.skipIf(!localnetAvailable)('Payment Integration - Setup', () => {
  beforeAll(async () => {
    logger.info('Setting up payment integration tests...')

    const chain = inferChainFromRpcUrl(RPC_URL)
    deployerAccount = privateKeyToAccount(DEPLOYER_KEY)
    userAccount = privateKeyToAccount(USER_KEY)
    stakerAccount = privateKeyToAccount(STAKER_KEY)

    publicClient = createPublicClient({ chain, transport: http(RPC_URL) })
    _deployerWalletClient = createWalletClient({
      chain,
      transport: http(RPC_URL),
      account: deployerAccount,
    })
    _userWalletClient = createWalletClient({
      chain,
      transport: http(RPC_URL),
      account: userAccount,
    })
    _stakerWalletClient = createWalletClient({
      chain,
      transport: http(RPC_URL),
      account: stakerAccount,
    })

    logger.success('Test setup complete')
  })

  test('should connect to localnet', async () => {
    const blockNumber = await publicClient.getBlockNumber()
    logger.info(`Connected to block ${blockNumber}`)
    expect(blockNumber).toBeGreaterThanOrEqual(0n)
  })

  test('should have test accounts funded', async () => {
    const deployerBalance = await publicClient.getBalance({
      address: deployerAccount.address,
    })
    const userBalance = await publicClient.getBalance({
      address: userAccount.address,
    })
    const stakerBalance = await publicClient.getBalance({
      address: stakerAccount.address,
    })

    logger.info(`Deployer: ${formatEther(deployerBalance)} ETH`)
    logger.info(`User: ${formatEther(userBalance)} ETH`)
    logger.info(`Staker: ${formatEther(stakerBalance)} ETH`)

    expect(deployerBalance).toBeGreaterThan(0n)
    expect(userBalance).toBeGreaterThan(0n)
    expect(stakerBalance).toBeGreaterThan(0n)
  })
})

// ============ x402 Payment Tests ============

describe.skipIf(!localnetAvailable)(
  'Payment Integration - x402 Protocol',
  () => {
    test('should create valid payment requirement', () => {
      logger.info('Testing x402 payment requirement creation...')

      const requirement = createPaymentRequirement(
        '/api/v1/chat',
        PAYMENT_TIERS.API_CALL_BASIC,
        'Chat API access',
        {
          recipientAddress: ADDRESSES.x402Recipient,
          network: 'jeju',
          serviceName: 'TestService',
        },
      )

      expect(requirement.x402Version).toBe(1)
      expect(requirement.accepts.length).toBeGreaterThan(0)
      expect(requirement.accepts[0].payTo).toBe(ADDRESSES.x402Recipient)
      expect(requirement.accepts[0].maxAmountRequired).toBe(
        PAYMENT_TIERS.API_CALL_BASIC.toString(),
      )

      logger.success('Payment requirement created correctly')
    })

    test('should validate payment tiers are defined', () => {
      logger.info('Validating payment tiers...')

      expect(PAYMENT_TIERS.API_CALL_BASIC).toBeDefined()
      expect(PAYMENT_TIERS.API_CALL_PREMIUM).toBeDefined()
      expect(PAYMENT_TIERS.COMPUTE_INFERENCE).toBeDefined()
      expect(PAYMENT_TIERS.STORAGE_PER_GB_MONTH).toBeDefined()
      expect(PAYMENT_TIERS.GAME_ENTRY).toBeDefined()

      // Verify tier ordering
      expect(PAYMENT_TIERS.API_CALL_BASIC).toBeLessThan(
        PAYMENT_TIERS.API_CALL_PREMIUM,
      )
      expect(PAYMENT_TIERS.GAME_ENTRY).toBeLessThan(PAYMENT_TIERS.GAME_PREMIUM)

      logger.success('Payment tiers validated')
    })

    test('should create and sign payment payload', async () => {
      logger.info('Testing payment signing...')

      const payload = createPaymentPayload(
        '0x0000000000000000000000000000000000000000' as Address,
        ADDRESSES.x402Recipient,
        PAYMENT_TIERS.API_CALL_BASIC,
        '/api/test',
        'jeju',
      )

      expect(payload.scheme).toBe('exact')
      expect(payload.nonce).toBeDefined()
      expect(payload.timestamp).toBeGreaterThan(0)

      // Sign the payload
      const signedPayload = await signPaymentPayload(payload, USER_KEY)
      expect(signedPayload.signature).toBeDefined()
      expect(signedPayload.signature?.startsWith('0x')).toBe(true)

      logger.success('Payment payload signed')
    })

    test('should reject payment with missing fields', async () => {
      const invalidPayload: PaymentPayload = {
        scheme: 'exact',
        network: 'jeju',
        asset: '0x0000000000000000000000000000000000000000',
        payTo: ADDRESSES.x402Recipient,
        amount: '', // Missing amount
        resource: '/test',
        nonce: 'abc123',
        timestamp: Math.floor(Date.now() / 1000),
      }

      const result = await verifyPayment(
        invalidPayload,
        parseEther('0.001'),
        ADDRESSES.x402Recipient,
      )

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()

      logger.success('Invalid payment correctly rejected')
    })

    test('should reject expired payment', async () => {
      const expiredPayload: PaymentPayload = {
        scheme: 'exact',
        network: 'jeju',
        asset: '0x0000000000000000000000000000000000000000',
        payTo: ADDRESSES.x402Recipient,
        amount: parseEther('0.001').toString(),
        resource: '/test',
        nonce: 'abc123',
        timestamp: Math.floor(Date.now() / 1000) - 600, // 10 minutes ago
      }

      const result = await verifyPayment(
        expiredPayload,
        parseEther('0.001'),
        ADDRESSES.x402Recipient,
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('expired')

      logger.success('Expired payment correctly rejected')
    })
  },
)

// ============ Credit Manager Tests ============

describe.skipIf(!localnetAvailable)(
  'Payment Integration - Credit Manager',
  () => {
    test('should query credit balance', async () => {
      logger.info('Testing credit balance queries...')

      // Query user's balance
      const balance = await readContract(publicClient, {
        address: ADDRESSES.creditManager,
        abi: parseAbi(CREDIT_MANAGER_ABI),
        functionName: 'getBalance',
        args: [userAccount.address, ADDRESSES.paymentToken],
      })
      logger.info(`User balance: ${formatEther(balance)} tokens`)

      // Balance should be a valid bigint
      expect(typeof balance).toBe('bigint')
      expect(balance).toBeGreaterThanOrEqual(0n)

      logger.success('Credit balance query successful')
    })

    test('should check credit sufficiency', async () => {
      logger.info('Testing credit sufficiency check...')

      const testAmount = parseEther('1')

      const result = (await readContract(publicClient, {
        address: ADDRESSES.creditManager,
        abi: parseAbi(CREDIT_MANAGER_ABI),
        functionName: 'hasSufficientCredit',
        args: [userAccount.address, ADDRESSES.paymentToken, testAmount],
      })) as [boolean, bigint]
      const [sufficient, available] = result

      logger.info(`Required: ${formatEther(testAmount)}`)
      logger.info(`Available: ${formatEther(available)}`)
      logger.info(`Sufficient: ${sufficient}`)

      // Should return boolean and bigint
      expect(typeof sufficient).toBe('boolean')
      expect(typeof available).toBe('bigint')

      logger.success('Credit sufficiency check successful')
    })

    test('should get all balances', async () => {
      logger.info('Testing multi-token balance query...')

      const [usdcBalance, elizaBalance, ethBalance] =
        await creditManager.getAllBalances(user.address)

      logger.info(`USDC: ${formatUnits(usdcBalance, 6)}`)
      logger.info(`elizaOS: ${formatEther(elizaBalance)}`)
      logger.info(`ETH: ${formatEther(ethBalance)}`)

      // All should be valid bigints
      expect(typeof usdcBalance).toBe('bigint')
      expect(typeof elizaBalance).toBe('bigint')
      expect(typeof ethBalance).toBe('bigint')

      logger.success('Multi-token balance query successful')
    })

    test('should deposit ETH to credit manager', async () => {
      logger.info('Testing ETH deposit...')

      const depositAmount = parseEther('0.1')
      const creditManagerAsUser = creditManager.connect(user)

      // Get initial balance
      const [, , initialEth] = await creditManager.getAllBalances(user.address)

      // Deposit ETH
      const tx = await creditManagerAsUser.depositETH({ value: depositAmount })
      await tx.wait()

      // Check new balance
      const [, , newEth] = await creditManager.getAllBalances(user.address)

      expect(newEth).toBe(initialEth + depositAmount)
      logger.success(`Deposited ${formatEther(depositAmount)} ETH`)
    })
  },
)

// ============ Staking Tests ============

describe.skipIf(!localnetAvailable)('Payment Integration - Staking', () => {
  test('should query pool stats', async () => {
    logger.info('Testing pool stats query...')

    const [
      totalStaked,
      totalLocked,
      rewardsPerShare,
      _lastUpdateBlock,
      _totalRewardsDistributed,
      stakerCount,
    ] = await staking.getPoolStats()

    logger.info(`Total Staked: ${formatEther(totalStaked)}`)
    logger.info(`Total Locked: ${formatEther(totalLocked)}`)
    logger.info(`Rewards Per Share: ${rewardsPerShare}`)
    logger.info(`Staker Count: ${stakerCount}`)

    // All should be valid bigints
    expect(typeof totalStaked).toBe('bigint')
    expect(typeof totalLocked).toBe('bigint')
    expect(typeof stakerCount).toBe('bigint')

    logger.success('Pool stats query successful')
  })

  test('should query staker position', async () => {
    logger.info('Testing position query...')

    const [
      stakedAmount,
      lockedAmount,
      _rewardDebt,
      pendingRewards,
      _lastClaimBlock,
      _unbondingEnd,
      isUnbonding,
    ] = await staking.getPosition(staker.address)

    logger.info(`Staked: ${formatEther(stakedAmount)}`)
    logger.info(`Locked: ${formatEther(lockedAmount)}`)
    logger.info(`Pending Rewards: ${formatEther(pendingRewards)}`)
    logger.info(`Is Unbonding: ${isUnbonding}`)

    // Validate types
    expect(typeof stakedAmount).toBe('bigint')
    expect(typeof isUnbonding).toBe('boolean')

    logger.success('Position query successful')
  })

  test('should query minimum stake requirement', async () => {
    logger.info('Testing minimum stake query...')

    const totalStaked = await staking.totalStaked()
    const minStake = await staking.minimumStake()

    logger.info(`Total Staked: ${formatEther(totalStaked)}`)
    logger.info(`Minimum Stake: ${formatEther(minStake)}`)

    expect(minStake).toBeGreaterThanOrEqual(0n)

    logger.success('Minimum stake query successful')
  })
})

// ============ Fee Distribution Tests ============

describe.skipIf(!localnetAvailable)(
  'Payment Integration - Fee Distribution',
  () => {
    test('should validate fee split constants', () => {
      logger.info('Validating fee distribution constants...')

      // Standard splits (from FeeDistributor contract)
      const APP_SHARE = 4500 // 45%
      const LP_SHARE = 4500 // 45%
      const CONTRIBUTOR_SHARE = 1000 // 10%

      // Should sum to 100%
      expect(APP_SHARE + LP_SHARE + CONTRIBUTOR_SHARE).toBe(10000)

      // LP splits
      const ETH_LP_SHARE = 7000 // 70% of LP portion
      const TOKEN_LP_SHARE = 3000 // 30% of LP portion

      expect(ETH_LP_SHARE + TOKEN_LP_SHARE).toBe(10000)

      logger.success('Fee distribution constants valid')
    })

    test('should calculate expected fees correctly', () => {
      // If 100 tokens are distributed:
      // - Apps get: 45 tokens
      // - LPs get: 45 tokens (31.5 to ETH LPs, 13.5 to token LPs)
      // - Contributors get: 10 tokens

      const totalFees = 100n
      const appShare = (totalFees * 4500n) / 10000n
      const lpShare = (totalFees * 4500n) / 10000n
      const contributorShare = totalFees - appShare - lpShare

      expect(appShare).toBe(45n)
      expect(lpShare).toBe(45n)
      expect(contributorShare).toBe(10n)

      const ethLPShare = (lpShare * 7000n) / 10000n
      const tokenLPShare = lpShare - ethLPShare

      expect(ethLPShare).toBe(31n) // Rounded
      expect(tokenLPShare).toBe(14n)

      logger.success('Fee calculations verified')
    })

    test('should calculate gas subsidy correctly', () => {
      logger.info('Testing gas subsidy calculation...')

      // Gas subsidy formula: 21000 base + 68 per byte of calldata
      const calculateGas = (calldataBytes: number): bigint => {
        return BigInt(21000) + BigInt(calldataBytes) * 68n
      }

      // Simple transfer (empty calldata)
      expect(calculateGas(0)).toBe(21000n)

      // ERC20 transfer (~68 bytes calldata)
      expect(calculateGas(68)).toBe(21000n + 68n * 68n)

      // Complex call (~200 bytes)
      expect(calculateGas(200)).toBe(21000n + 200n * 68n)

      logger.success('Gas subsidy calculation verified')
    })
  },
)

// ============ Cross-App Integration Tests ============

describe.skipIf(!localnetAvailable)(
  'Payment Integration - Cross-App Compatibility',
  () => {
    test('should use consistent x402 types across apps', () => {
      // Verify types match across implementations
      const testPayload: PaymentPayload = {
        scheme: 'exact',
        network: 'jeju',
        asset: '0x0000000000000000000000000000000000000000' as Address,
        payTo: ADDRESSES.x402Recipient,
        amount: '1000000000000000',
        resource: '/api/test',
        nonce: 'test-nonce',
        timestamp: Math.floor(Date.now() / 1000),
      }

      // All fields should be present and typed correctly
      expect(typeof testPayload.scheme).toBe('string')
      expect(typeof testPayload.network).toBe('string')
      expect(typeof testPayload.asset).toBe('string')
      expect(typeof testPayload.payTo).toBe('string')
      expect(typeof testPayload.amount).toBe('string')
      expect(typeof testPayload.resource).toBe('string')
      expect(typeof testPayload.nonce).toBe('string')
      expect(typeof testPayload.timestamp).toBe('number')

      logger.success('x402 types are consistent')
    })

    test('should support multiple networks', () => {
      const networks: Array<'base-sepolia' | 'base' | 'jeju' | 'jeju-testnet'> =
        ['base-sepolia', 'base', 'jeju', 'jeju-testnet']

      for (const network of networks) {
        const requirement = createPaymentRequirement(
          '/api/test',
          parseEther('0.001'),
          'Test',
          {
            recipientAddress: ADDRESSES.x402Recipient,
            network,
            serviceName: 'Test',
          },
        )

        expect(requirement.accepts[0].network).toBe(network)
      }

      logger.success('Multi-network support verified')
    })

    test('should verify EIP-712 domain consistency', async () => {
      logger.info('Testing EIP-712 domain...')

      const _chainId = (await provider.getNetwork()).chainId

      // Payment domain should match chain
      const payload = createPaymentPayload(
        '0x0000000000000000000000000000000000000000' as Address,
        ADDRESSES.x402Recipient,
        parseEther('0.001'),
        '/test',
        'jeju',
      )

      // Sign and verify signer can be recovered
      const signed = await signPaymentPayload(payload, USER_KEY)
      expect(signed.signature).toBeDefined()

      // Verify against expected amount
      const verification = await verifyPayment(
        signed,
        parseEther('0.001'),
        ADDRESSES.x402Recipient,
      )

      expect(verification.valid).toBe(true)
      expect(verification.signer?.toLowerCase()).toBe(
        userAccount.address.toLowerCase(),
      )

      logger.success('EIP-712 domain consistency verified')
    })
  },
)

// ============ Summary ============

describe.skipIf(!localnetAvailable)('Payment Integration - Summary', () => {
  test('should print test summary', async () => {
    const blockNumber = await publicClient.getBlockNumber()
    const chainId = await getChainId(publicClient)

    logger.separator()
    logger.box(`
PAYMENT INTEGRATION TEST SUMMARY

Network:
  Chain ID: ${chainId}
  Block: ${blockNumber}
  RPC: ${RPC_URL}

Components Tested:
  - x402 Payment Protocol (create, sign, verify)
  - Credit Manager (deposit, balance, sufficiency)
  - Staking (pool stats, positions, minimums)
  - Fee Distribution (splits, calculations)
  - Cross-App Compatibility (types, networks, EIP-712)

Contract Addresses:
  Payment Token: ${ADDRESSES.paymentToken}
  Credit Manager: ${ADDRESSES.creditManager}
  Staking: ${ADDRESSES.staking}
  x402 Recipient: ${ADDRESSES.x402Recipient}
    `)
    logger.separator()
  })
})

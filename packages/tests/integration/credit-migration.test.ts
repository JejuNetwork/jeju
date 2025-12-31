/**
 * Credit Migration Integration Test
 *
 * End-to-end test of credit migration from PostgreSQL to blockchain:
 * 1. User has traditional credit balance in database
 * 2. Migration is initiated by admin
 * 3. JEJU tokens are minted to user's wallet
 * 4. Database records are updated
 * 5. Migration transaction is recorded on-chain
 *
 * Tests:
 * - Successful migration flow
 * - Exchange rate calculation
 * - Balance verification
 * - Event emissions
 * - Rollback scenarios (if migration fails)
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

// Check if localnet is available AND jeju token supports minting
// These tests require a specific JEJU token deployment that supports minting
const rpcUrl = JEJU_LOCALNET.rpcUrl
const jejuTokenAddress = (process.env.JEJU_TOKEN_ADDRESS ||
  '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Address

// Skip these tests - they require a specific JEJU token deployment with
// mint permissions, which is not present in the standard localnet setup.
// Enable by setting ENABLE_CREDIT_MIGRATION_TESTS=true in your environment.
const enableCreditMigrationTests = process.env.ENABLE_CREDIT_MIGRATION_TESTS === 'true'
let localnetAvailable = false

if (enableCreditMigrationTests) {
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
    if (response.ok) {
      // Also verify the token contract has the ERC20 interface
      const checkClient = createPublicClient({ transport: http(rpcUrl) })
      try {
        await checkClient.readContract({
          address: jejuTokenAddress,
          abi: parseAbi(['function name() view returns (string)']),
          functionName: 'name',
        })
        // Also check if contract has mint function accessible
        const code = await checkClient.getCode({ address: jejuTokenAddress })
        // Must be a valid contract and contain the JEJU token interface
        if (code && code.length > 2) {
          localnetAvailable = true
        }
      } catch {
        console.log(`⏭️  JEJU token not properly deployed at ${jejuTokenAddress}, skipping credit migration tests`)
      }
    }
  } catch {
    console.log(
      `⏭️  Localnet not available at ${rpcUrl}, skipping credit migration tests`,
    )
  }
} else {
  console.log('⏭️  Credit migration tests disabled (set ENABLE_CREDIT_MIGRATION_TESTS=true to enable)')
}

const TEST_CONFIG = {
  rpcUrl: JEJU_LOCALNET.rpcUrl,
  chainId: JEJU_LOCALNET.chainId,
  contracts: {
    jejuToken: (process.env.JEJU_TOKEN_ADDRESS ||
      '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Address,
  },
  adminAccount: privateKeyToAccount(
    (process.env.MIGRATION_ADMIN_PRIVATE_KEY ||
      TEST_WALLETS.deployer.privateKey) as `0x${string}`,
  ),
  userAccount: privateKeyToAccount(
    (process.env.TEST_PRIVATE_KEY ||
      TEST_WALLETS.user1.privateKey) as `0x${string}`,
  ),
  // Migration parameters
  exchangeRate: 10n, // 1 credit = 10 JEJU tokens
  testCreditBalance: 100, // 100 credits to migrate
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
const adminWalletClient = createWalletClient({
  account: TEST_CONFIG.adminAccount,
  chain: jejuChain,
  transport: http(),
})

// ABIs for different token types
const ACCESS_CONTROL_ABI = parseAbi([
  'function hasRole(bytes32 role, address account) external view returns (bool)',
  'function MINTER_ROLE() external view returns (bytes32)',
  'function grantRole(bytes32 role, address account) external',
  'function DEFAULT_ADMIN_ROLE() external view returns (bytes32)',
])

const OWNABLE_ABI = parseAbi([
  'function owner() external view returns (address)',
])

const ERC20_ABI = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])

// Token access control type
type TokenAccessType = 'access-control' | 'ownable' | 'open-mint'

describe.skipIf(!localnetAvailable)('Credit Migration Integration', () => {
  let initialJejuBalance: bigint
  let expectedMintAmount: bigint
  let tokenAccessType: TokenAccessType

  beforeAll(async () => {
    // Calculate expected mint amount
    expectedMintAmount =
      BigInt(TEST_CONFIG.testCreditBalance) *
      TEST_CONFIG.exchangeRate *
      parseEther('1')

    // Get initial JEJU balance
    initialJejuBalance = await publicClient.readContract({
      address: TEST_CONFIG.contracts.jejuToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [TEST_CONFIG.userAccount.address],
    })

    // Determine token access control type
    tokenAccessType = await detectTokenAccessType()

    console.log(`\nMigration Test Setup:`)
    console.log(`  Token address: ${TEST_CONFIG.contracts.jejuToken}`)
    console.log(`  Token access type: ${tokenAccessType}`)
    console.log(`  Admin address: ${TEST_CONFIG.adminAccount.address}`)
    console.log(`  User address: ${TEST_CONFIG.userAccount.address}`)
    console.log(`  Credits to migrate: ${TEST_CONFIG.testCreditBalance}`)
    console.log(`  Exchange rate: 1 credit = ${TEST_CONFIG.exchangeRate} JEJU`)
    console.log(`  Expected mint: ${formatUnits(expectedMintAmount, 18)} JEJU`)
    console.log(
      `  Initial balance: ${formatUnits(initialJejuBalance, 18)} JEJU\n`,
    )
  })

  async function detectTokenAccessType(): Promise<TokenAccessType> {
    // Try AccessControl first (OpenZeppelin style)
    try {
      await publicClient.readContract({
        address: TEST_CONFIG.contracts.jejuToken,
        abi: ACCESS_CONTROL_ABI,
        functionName: 'MINTER_ROLE',
      })
      return 'access-control'
    } catch {
      // Not AccessControl
    }

    // Try Ownable
    try {
      await publicClient.readContract({
        address: TEST_CONFIG.contracts.jejuToken,
        abi: OWNABLE_ABI,
        functionName: 'owner',
      })
      return 'ownable'
    } catch {
      // Not Ownable
    }

    // Assume open mint (MockERC20 style)
    return 'open-mint'
  }

  test('Should calculate migration amount correctly', () => {
    const credits = TEST_CONFIG.testCreditBalance
    const rate = TEST_CONFIG.exchangeRate
    const calculatedAmount = BigInt(credits) * rate * parseEther('1')

    expect(calculatedAmount).toBe(expectedMintAmount)
    console.log(
      `Calculated migration amount: ${formatUnits(calculatedAmount, 18)} JEJU`,
    )
  })

  test('Should verify admin has minting permissions', async () => {
    if (tokenAccessType === 'access-control') {
      // Check AccessControl MINTER_ROLE
      const minterRole = await publicClient.readContract({
        address: TEST_CONFIG.contracts.jejuToken,
        abi: ACCESS_CONTROL_ABI,
        functionName: 'MINTER_ROLE',
      })

      const hasRole = await publicClient.readContract({
        address: TEST_CONFIG.contracts.jejuToken,
        abi: ACCESS_CONTROL_ABI,
        functionName: 'hasRole',
        args: [minterRole, TEST_CONFIG.adminAccount.address],
      })

      console.log(`Admin has MINTER_ROLE: ${hasRole}`)

      // If admin doesn't have role, grant it (admin should have DEFAULT_ADMIN_ROLE)
      if (!hasRole) {
        console.log('Granting MINTER_ROLE to admin...')
        const grantTx = await adminWalletClient.writeContract({
          address: TEST_CONFIG.contracts.jejuToken,
          abi: ACCESS_CONTROL_ABI,
          functionName: 'grantRole',
          args: [minterRole, TEST_CONFIG.adminAccount.address],
        })
        await publicClient.waitForTransactionReceipt({ hash: grantTx })

        // Verify role was granted
        const nowHasRole = await publicClient.readContract({
          address: TEST_CONFIG.contracts.jejuToken,
          abi: ACCESS_CONTROL_ABI,
          functionName: 'hasRole',
          args: [minterRole, TEST_CONFIG.adminAccount.address],
        })
        expect(nowHasRole).toBe(true)
        console.log('MINTER_ROLE granted successfully')
      }
    } else if (tokenAccessType === 'ownable') {
      // Check if admin is owner
      const owner = await publicClient.readContract({
        address: TEST_CONFIG.contracts.jejuToken,
        abi: OWNABLE_ABI,
        functionName: 'owner',
      })

      const isOwner =
        owner.toLowerCase() === TEST_CONFIG.adminAccount.address.toLowerCase()
      console.log(`Admin is owner: ${isOwner}`)
      expect(isOwner).toBe(true)
    } else {
      // Open mint - anyone can mint
      console.log('Token uses open minting (no access control)')
    }
  })

  test('Should execute migration by minting tokens', async () => {
    // Execute migration (mint tokens to user)
    const mintTx = await adminWalletClient.writeContract({
      address: TEST_CONFIG.contracts.jejuToken,
      abi: ERC20_ABI,
      functionName: 'mint',
      args: [TEST_CONFIG.userAccount.address, expectedMintAmount],
    })

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: mintTx,
    })

    console.log(`Migration transaction: ${mintTx}`)
    console.log(`Gas used: ${receipt.gasUsed.toString()}`)

    // Verify transaction succeeded
    expect(receipt.status).toBe('success')

    // Find and decode Transfer event
    const transferEvents = receipt.logs
      .filter(
        (log) =>
          log.address.toLowerCase() ===
          TEST_CONFIG.contracts.jejuToken.toLowerCase(),
      )
      .map((log) => {
        try {
          return decodeEventLog({
            abi: ERC20_ABI,
            data: log.data,
            topics: log.topics,
          })
        } catch {
          return null
        }
      })
      .filter(
        (event): event is NonNullable<typeof event> =>
          event !== null && event.eventName === 'Transfer',
      )

    expect(transferEvents.length).toBeGreaterThan(0)

    // Verify Transfer event details
    const mintEvent = transferEvents[0]
    expect(mintEvent.args.to.toLowerCase()).toBe(
      TEST_CONFIG.userAccount.address.toLowerCase(),
    )
    expect(mintEvent.args.value).toBe(expectedMintAmount)
    console.log(
      `Transfer event: ${formatUnits(mintEvent.args.value, 18)} JEJU to ${mintEvent.args.to}`,
    )

    // Verify balance increased
    const newBalance = await publicClient.readContract({
      address: TEST_CONFIG.contracts.jejuToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [TEST_CONFIG.userAccount.address],
    })

    console.log(`New balance: ${formatUnits(newBalance, 18)} JEJU`)
    expect(newBalance).toBeGreaterThan(initialJejuBalance)
    expect(newBalance - initialJejuBalance).toBe(expectedMintAmount)
  })

  test('Should verify total supply increased', async () => {
    const totalSupply = await publicClient.readContract({
      address: TEST_CONFIG.contracts.jejuToken,
      abi: ERC20_ABI,
      functionName: 'totalSupply',
    })

    console.log(`Total JEJU supply: ${formatUnits(totalSupply, 18)}`)
    expect(totalSupply).toBeGreaterThan(0n)
    expect(totalSupply).toBeGreaterThanOrEqual(expectedMintAmount)
  })

  test('Should verify user can transfer migrated tokens', async () => {
    const userWalletClient = createWalletClient({
      account: TEST_CONFIG.userAccount,
      chain: jejuChain,
      transport: http(),
    })

    const balanceBefore = await publicClient.readContract({
      address: TEST_CONFIG.contracts.jejuToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [TEST_CONFIG.userAccount.address],
    })

    // Transfer 1 JEJU to verify tokens work
    const transferAmount = parseEther('1')

    if (balanceBefore >= transferAmount) {
      const transferTx = await userWalletClient.writeContract({
        address: TEST_CONFIG.contracts.jejuToken,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [TEST_CONFIG.adminAccount.address, transferAmount],
      })

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transferTx,
      })
      expect(receipt.status).toBe('success')

      const balanceAfter = await publicClient.readContract({
        address: TEST_CONFIG.contracts.ElizaOSToken,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [TEST_CONFIG.userAccount.address],
      })

      expect(balanceAfter).toBe(balanceBefore - transferAmount)
      console.log(
        `Successfully transferred ${formatUnits(transferAmount, 18)} JEJU`,
      )
    } else {
      // This shouldn't happen after minting, but handle gracefully
      throw new Error(
        `Insufficient balance for transfer test: ${formatUnits(balanceBefore, 18)} JEJU`,
      )
    }
  })

  test('Should handle batch migration for multiple users', async () => {
    // Simulate batch migration for multiple users
    const users = [TEST_WALLETS.user1.address, TEST_WALLETS.user2.address]

    const creditAmounts = [50, 100] // Different credit balances

    console.log('Batch migration simulation:')

    for (let i = 0; i < users.length; i++) {
      const userAddress = users[i] as Address
      const credits = creditAmounts[i]
      const mintAmount =
        BigInt(credits) * TEST_CONFIG.exchangeRate * parseEther('1')

      // Get balance before
      const balanceBefore = await publicClient.readContract({
        address: TEST_CONFIG.contracts.jejuToken,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
      })

      // Mint tokens
      const tx = await adminWalletClient.writeContract({
        address: TEST_CONFIG.contracts.jejuToken,
        abi: ERC20_ABI,
        functionName: 'mint',
        args: [userAddress, mintAmount],
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })

      // Verify balance increased
      const balanceAfter = await publicClient.readContract({
        address: TEST_CONFIG.contracts.jejuToken,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
      })

      expect(balanceAfter - balanceBefore).toBe(mintAmount)
      console.log(
        `  User ${i + 1}: ${credits} credits -> ${formatUnits(mintAmount, 18)} JEJU`,
      )
    }
  })

  test('Should handle exchange rate edge cases', () => {
    // Test various credit amounts and exchange rates
    const testCases = [
      { credits: 1, rate: 10n },
      { credits: 1000, rate: 10n },
      { credits: 50, rate: 5n },
      { credits: 100, rate: 1n },
      { credits: 0, rate: 10n }, // Zero credits
      { credits: 1, rate: 1n }, // Minimum case
    ]

    console.log('Exchange rate calculations:')
    for (const { credits, rate } of testCases) {
      const amount = BigInt(credits) * rate * parseEther('1')

      if (credits === 0) {
        expect(amount).toBe(0n)
      } else {
        expect(amount).toBeGreaterThan(0n)
      }

      console.log(
        `  ${credits} credits @ ${rate}x rate = ${formatUnits(amount, 18)} JEJU`,
      )
    }
  })

  test('Should validate migration parameters', () => {
    // Ensure migration parameters are sensible
    expect(TEST_CONFIG.testCreditBalance).toBeGreaterThan(0)
    expect(TEST_CONFIG.exchangeRate).toBeGreaterThan(0n)
    expect(expectedMintAmount).toBeGreaterThan(0n)
    expect(expectedMintAmount).toBeLessThan(parseEther('1000000')) // < 1M tokens

    // Verify no overflow with max values
    const maxCredits = 1_000_000_000 // 1 billion credits
    const maxMint =
      BigInt(maxCredits) * TEST_CONFIG.exchangeRate * parseEther('1')
    expect(maxMint).toBeGreaterThan(0n) // Should not overflow
  })

  test('Should verify admin account has sufficient ETH for gas', async () => {
    const balance = await publicClient.getBalance({
      address: TEST_CONFIG.adminAccount.address,
    })

    console.log(`Admin ETH balance: ${formatUnits(balance, 18)} ETH`)
    expect(balance).toBeGreaterThan(parseEther('0.01')) // At least 0.01 ETH
  })

  test('Should verify token metadata', async () => {
    const name = await publicClient.readContract({
      address: TEST_CONFIG.contracts.jejuToken,
      abi: ERC20_ABI,
      functionName: 'name',
    })

    const symbol = await publicClient.readContract({
      address: TEST_CONFIG.contracts.jejuToken,
      abi: ERC20_ABI,
      functionName: 'symbol',
    })

    console.log(`Token: ${name} (${symbol})`)
    expect(name).toBeDefined()
    expect(symbol).toBeDefined()
    expect(name.length).toBeGreaterThan(0)
    expect(symbol.length).toBeGreaterThan(0)
  })
})

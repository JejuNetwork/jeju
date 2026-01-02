/**
 * Real L1 → L2 Derivation Integration Test
 *
 * This test validates ACTUAL deposit derivation - not simulation.
 * It requires a real OP Stack running with:
 *   - L1 with OptimismPortal deployed
 *   - op-node deriving L2 blocks
 *   - op-geth executing derived payloads
 *
 * Prerequisites:
 *   bun run packages/deployment/scripts/start-real-op-stack.ts
 *
 * Usage:
 *   L1_RPC=http://127.0.0.1:32770 L2_RPC=http://127.0.0.1:32771 \
 *   OPTIMISM_PORTAL=0x... bun test packages/bridge/tests/integration/real-derivation.test.ts
 */

import { beforeAll, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Config from environment or file
const getConfig = () => {
  const configPath = join(
    import.meta.dir,
    '../../../deployment/.localnet/op-stack.json',
  )

  if (existsSync(configPath)) {
    const config = require(configPath)
    return {
      l1Rpc: process.env.L1_RPC || config.l1Rpc,
      l2Rpc: process.env.L2_RPC || config.l2Rpc,
      l1ChainId: parseInt(
        process.env.L1_CHAIN_ID || String(config.l1ChainId),
        10,
      ),
      l2ChainId: parseInt(
        process.env.L2_CHAIN_ID || String(config.l2ChainId),
        10,
      ),
      optimismPortal: (process.env.OPTIMISM_PORTAL ||
        config.contracts?.OptimismPortal) as Address,
    }
  }

  return {
    l1Rpc: process.env.L1_RPC || 'http://127.0.0.1:8545',
    l2Rpc: process.env.L2_RPC || 'http://127.0.0.1:9545',
    l1ChainId: parseInt(process.env.L1_CHAIN_ID || '3151908', 10),
    l2ChainId: parseInt(process.env.L2_CHAIN_ID || '901', 10),
    optimismPortal: process.env.OPTIMISM_PORTAL as Address,
  }
}

// Test account with funds (Anvil default)
const FUNDER = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)

// Random recipient for deposit
const RECIPIENT = privateKeyToAccount(
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
)

// OptimismPortal ABI (minimal for deposits)
const OPTIMISM_PORTAL_ABI = [
  {
    name: 'depositTransaction',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_to', type: 'address' },
      { name: '_value', type: 'uint256' },
      { name: '_gasLimit', type: 'uint64' },
      { name: '_isCreation', type: 'bool' },
      { name: '_data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'TransactionDeposited',
    type: 'event',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'version', type: 'uint256', indexed: true },
      { name: 'opaqueData', type: 'bytes', indexed: false },
    ],
  },
] as const

// Max time to wait for derivation (ms)
const DERIVATION_TIMEOUT = 30000

describe('Real L1 → L2 Derivation', () => {
  const config = getConfig()
  let l1Client: ReturnType<typeof createPublicClient>
  let l2Client: ReturnType<typeof createPublicClient>
  let l1WalletClient: ReturnType<typeof createWalletClient>
  let shouldSkip = false

  beforeAll(async () => {
    // Create clients
    l1Client = createPublicClient({
      transport: http(config.l1Rpc),
    })

    l2Client = createPublicClient({
      transport: http(config.l2Rpc),
    })

    // Check connectivity
    try {
      await Promise.all([l1Client.getBlockNumber(), l2Client.getBlockNumber()])
    } catch {
      console.log('⚠️ Chains not reachable. Skipping integration tests.')
      console.log('   Start the real OP Stack first:')
      console.log(
        '   bun run packages/deployment/scripts/start-real-op-stack.ts',
      )
      shouldSkip = true
      return
    }

    // Check for OptimismPortal
    if (
      !config.optimismPortal ||
      config.optimismPortal === '0x0000000000000000000000000000000000000000'
    ) {
      console.log(
        '⚠️ OptimismPortal address not configured. Skipping deposit tests.',
      )
      shouldSkip = true
      return
    }

    // Check portal exists
    const portalCode = await l1Client.getCode({
      address: config.optimismPortal,
    })
    if (!portalCode || portalCode === '0x') {
      console.log('⚠️ OptimismPortal not deployed at', config.optimismPortal)
      shouldSkip = true
      return
    }

    // Create wallet client
    l1WalletClient = createWalletClient({
      chain: {
        id: config.l1ChainId,
        name: 'L1',
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [config.l1Rpc] } },
      },
      transport: http(config.l1Rpc),
      account: FUNDER,
    })

    console.log(`
Real Derivation Test Config:
  L1 RPC: ${config.l1Rpc}
  L2 RPC: ${config.l2Rpc}
  OptimismPortal: ${config.optimismPortal}
  Recipient: ${RECIPIENT.address}
`)
  })

  it('should have L1 and L2 chains running', async () => {
    if (shouldSkip) return

    const l1Block = await l1Client.getBlockNumber()
    const l2Block = await l2Client.getBlockNumber()

    expect(l1Block).toBeGreaterThan(0n)
    expect(l2Block).toBeGreaterThan(0n)

    console.log(`   L1 Block: ${l1Block}, L2 Block: ${l2Block}`)
  })

  it('should have OptimismPortal deployed', async () => {
    if (shouldSkip) return

    const code = await l1Client.getCode({ address: config.optimismPortal })
    expect(code).toBeDefined()
    expect(code).not.toBe('0x')
  })

  it(
    'should deposit ETH from L1 and see it on L2 (REAL DERIVATION)',
    async () => {
      if (shouldSkip) {
        console.log('   Skipping: Stack not running or portal not configured')
        return
      }

      const depositAmount = parseEther('0.1')

      // Get initial L2 balance
      const l2BalanceBefore = await l2Client.getBalance({
        address: RECIPIENT.address,
      })
      console.log(`   L2 balance before: ${formatEther(l2BalanceBefore)} ETH`)

      // Record L2 block before deposit
      const l2BlockBefore = await l2Client.getBlockNumber()

      // Send deposit transaction on L1
      console.log(`   Sending deposit of ${formatEther(depositAmount)} ETH...`)

      const depositHash = await l1WalletClient.writeContract({
        address: config.optimismPortal,
        abi: OPTIMISM_PORTAL_ABI,
        functionName: 'depositTransaction',
        args: [
          RECIPIENT.address, // _to
          depositAmount, // _value
          100000n, // _gasLimit
          false, // _isCreation
          '0x', // _data
        ],
        value: depositAmount,
      })

      console.log(`   L1 deposit tx: ${depositHash}`)

      // Wait for L1 confirmation
      const receipt = await l1Client.waitForTransactionReceipt({
        hash: depositHash,
      })
      expect(receipt.status).toBe('success')
      console.log(`   L1 deposit confirmed in block ${receipt.blockNumber}`)

      // Now wait for L2 to derive the deposit
      // This is the REAL test - op-node should pick up the deposit and derive an L2 block
      console.log(
        `   Waiting for L2 derivation (max ${DERIVATION_TIMEOUT / 1000}s)...`,
      )

      const startTime = Date.now()
      let derived = false
      let l2BalanceAfter = 0n

      while (Date.now() - startTime < DERIVATION_TIMEOUT) {
        const currentL2Block = await l2Client.getBlockNumber()

        // Check if we have a new L2 block
        if (currentL2Block > l2BlockBefore) {
          l2BalanceAfter = await l2Client.getBalance({
            address: RECIPIENT.address,
          })

          // Check if balance increased
          if (l2BalanceAfter > l2BalanceBefore) {
            derived = true
            console.log(`   L2 derived at block ${currentL2Block}`)
            console.log(
              `   L2 balance after: ${formatEther(l2BalanceAfter)} ETH`,
            )
            break
          }
        }

        await Bun.sleep(1000)
      }

      if (!derived) {
        console.log(`   ❌ Derivation timeout - deposit not seen on L2`)
        console.log(
          `   This may indicate op-node is not properly deriving from L1`,
        )
      }

      expect(derived).toBe(true)
      expect(l2BalanceAfter - l2BalanceBefore).toBeGreaterThanOrEqual(
        depositAmount,
      )
    },
    DERIVATION_TIMEOUT + 10000,
  )

  it('should verify L2 received the correct amount', async () => {
    if (shouldSkip) return

    // This is a follow-up check
    const balance = await l2Client.getBalance({ address: RECIPIENT.address })
    console.log(`   Recipient L2 balance: ${formatEther(balance)} ETH`)

    // If previous test passed, balance should be > 0
    expect(balance).toBeGreaterThan(0n)
  })
})

describe('L2 Block Attributes', () => {
  const config = getConfig()
  let l2Client: ReturnType<typeof createPublicClient>
  let shouldSkip = false

  beforeAll(async () => {
    l2Client = createPublicClient({
      transport: http(config.l2Rpc),
    })

    try {
      await l2Client.getBlockNumber()
    } catch {
      shouldSkip = true
    }
  })

  it('should have L1 block info in L2 blocks (via L1Block predeploy)', async () => {
    if (shouldSkip) return

    // L1Block predeploy address
    const L1_BLOCK_ADDRESS =
      '0x4200000000000000000000000000000000000015' as Address

    // Check if L1Block exists
    const code = await l2Client.getCode({ address: L1_BLOCK_ADDRESS })

    if (!code || code === '0x') {
      console.log('   L1Block predeploy not found (expected in real OP Stack)')
      return
    }

    // Read L1 block number from L1Block
    const L1_BLOCK_ABI = [
      {
        name: 'number',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint64' }],
      },
      {
        name: 'timestamp',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint64' }],
      },
    ] as const

    const l1BlockNumber = await l2Client.readContract({
      address: L1_BLOCK_ADDRESS,
      abi: L1_BLOCK_ABI,
      functionName: 'number',
    })

    const l1Timestamp = await l2Client.readContract({
      address: L1_BLOCK_ADDRESS,
      abi: L1_BLOCK_ABI,
      functionName: 'timestamp',
    })

    console.log(`   L1 block (from L2): ${l1BlockNumber}`)
    console.log(`   L1 timestamp (from L2): ${l1Timestamp}`)

    expect(l1BlockNumber).toBeGreaterThan(0n)
  })
})

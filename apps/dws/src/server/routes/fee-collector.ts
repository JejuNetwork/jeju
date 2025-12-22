/**
 * Fee Collector
 *
 * Collects fees from DWS services and deposits them to the DeepFundingDistributor.
 * This is the bridge between network fees and deep funding distribution.
 *
 * Fee Sources:
 * - RPC requests (/rpc/*)
 * - Compute jobs (/compute/*)
 * - Storage operations (/storage/*)
 * - CDN bandwidth (/cdn/*)
 * - API marketplace (/api/*)
 * - Git operations (/git/*)
 * - Package registry (/pkg/*)
 */

import { Hono } from 'hono'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ============ Types ============

interface FeeDeposit {
  daoId: string
  source: string
  amount: bigint
  timestamp: number
}

interface FeeStats {
  totalCollected: bigint
  totalDeposited: bigint
  pendingDeposit: bigint
  bySource: Record<string, bigint>
}

// ============ State ============

const pendingFees: Map<string, FeeDeposit[]> = new Map()
const feeStats: FeeStats = {
  totalCollected: 0n,
  totalDeposited: 0n,
  pendingDeposit: 0n,
  bySource: {},
}

const DEPOSIT_THRESHOLD = BigInt(1e16) // 0.01 ETH minimum before depositing
const DEPOSIT_INTERVAL = 60 * 60 * 1000 // 1 hour

// ============ ABI ============

const DEEP_FUNDING_DISTRIBUTOR_ABI = parseAbi([
  'function depositFees(bytes32 daoId, string source) external payable',
  'function authorizedDepositors(address) external view returns (bool)',
])

// ============ Fee Collection ============

export function recordFee(daoId: string, source: string, amount: bigint): void {
  if (amount <= 0n) return

  if (!pendingFees.has(daoId)) {
    pendingFees.set(daoId, [])
  }

  pendingFees.get(daoId)?.push({
    daoId,
    source,
    amount,
    timestamp: Date.now(),
  })

  feeStats.totalCollected += amount
  feeStats.pendingDeposit += amount
  feeStats.bySource[source] = (feeStats.bySource[source] || 0n) + amount
}

async function depositPendingFees(): Promise<number> {
  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:6546'
  const depositorKey = process.env.FEE_DEPOSITOR_PRIVATE_KEY
  const distributorAddress = process.env
    .DEEP_FUNDING_DISTRIBUTOR_ADDRESS as Address

  if (!depositorKey || !distributorAddress) {
    console.warn('[FeeCollector] Not configured - skipping deposit')
    return 0
  }

  const account = privateKeyToAccount(depositorKey as Hex)
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  })

  let depositsProcessed = 0

  for (const [daoId, fees] of pendingFees.entries()) {
    // Group by source
    const bySource = new Map<string, bigint>()
    for (const fee of fees) {
      bySource.set(fee.source, (bySource.get(fee.source) || 0n) + fee.amount)
    }

    for (const [source, amount] of bySource.entries()) {
      if (amount < DEPOSIT_THRESHOLD) continue

      try {
        await walletClient.writeContract({
          address: distributorAddress,
          abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
          functionName: 'depositFees',
          args: [daoId as Hex, source],
          value: amount,
        })

        feeStats.totalDeposited += amount
        feeStats.pendingDeposit -= amount
        depositsProcessed++

        console.log(
          `[FeeCollector] Deposited ${amount} for ${source} to DAO ${daoId.slice(0, 10)}`,
        )
      } catch (err) {
        console.error(`[FeeCollector] Deposit failed:`, err)
      }
    }
  }

  // Clear processed fees
  pendingFees.clear()

  return depositsProcessed
}

// Start periodic deposit
let depositInterval: NodeJS.Timeout | null = null

export function startFeeCollector(): void {
  if (depositInterval) return

  depositInterval = setInterval(async () => {
    const count = await depositPendingFees()
    if (count > 0) {
      console.log(`[FeeCollector] Processed ${count} deposits`)
    }
  }, DEPOSIT_INTERVAL)

  console.log('[FeeCollector] Started periodic fee deposit')
}

export function stopFeeCollector(): void {
  if (depositInterval) {
    clearInterval(depositInterval)
    depositInterval = null
  }
}

// ============ Router ============

export function createFeeCollectorRouter(): Hono {
  const router = new Hono()

  // Manual deposit trigger (admin)
  router.post('/deposit', async (c) => {
    const count = await depositPendingFees()
    return c.json({ depositsProcessed: count })
  })

  // Get stats
  router.get('/stats', (c) => {
    return c.json({
      totalCollected: feeStats.totalCollected.toString(),
      totalDeposited: feeStats.totalDeposited.toString(),
      pendingDeposit: feeStats.pendingDeposit.toString(),
      bySource: Object.fromEntries(
        Object.entries(feeStats.bySource).map(([k, v]) => [k, v.toString()]),
      ),
      pendingDaos: Array.from(pendingFees.keys()),
    })
  })

  // Record fee manually (for services that don't use middleware)
  router.post('/record', async (c) => {
    const body = (await c.req.json()) as {
      daoId: string
      source: string
      amount: string
    }
    recordFee(body.daoId, body.source, BigInt(body.amount))
    return c.json({ recorded: true })
  })

  // Health
  router.get('/health', async (c) => {
    const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:6546'
    const depositorKey = process.env.FEE_DEPOSITOR_PRIVATE_KEY
    const distributorAddress = process.env
      .DEEP_FUNDING_DISTRIBUTOR_ADDRESS as Address

    let isAuthorized = false

    if (depositorKey && distributorAddress) {
      try {
        const account = privateKeyToAccount(depositorKey as Hex)
        const publicClient = createPublicClient({ transport: http(rpcUrl) })

        isAuthorized = (await publicClient.readContract({
          address: distributorAddress,
          abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
          functionName: 'authorizedDepositors',
          args: [account.address],
        })) as boolean
      } catch {
        // Contract may not be deployed
      }
    }

    return c.json({
      configured: !!depositorKey && !!distributorAddress,
      isAuthorized,
      collectorRunning: !!depositInterval,
    })
  })

  return router
}

// ============ Middleware for Service Routes ============

/**
 * Middleware to collect fees from service requests
 * Usage: app.use('/rpc/*', feeCollectorMiddleware('rpc', jejuDaoId))
 */
export function feeCollectorMiddleware(source: string, daoId: string) {
  return async (
    c: { req: { header: (name: string) => string | undefined } },
    next: () => Promise<void>,
  ) => {
    // Check if request has fee payment header
    const feeAmount = c.req.header('x-jeju-fee')

    await next()

    if (feeAmount) {
      recordFee(daoId, source, BigInt(feeAmount))
    }
  }
}

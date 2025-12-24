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

import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { recordFeeRequestSchema } from '../../shared/schemas'

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
const pendingFees: Map<string, FeeDeposit[]> = new Map()
const feeStats: FeeStats = {
  totalCollected: 0n,
  totalDeposited: 0n,
  pendingDeposit: 0n,
  bySource: {},
}

const DEPOSIT_THRESHOLD = BigInt(1e16) // 0.01 ETH minimum before depositing
const DEPOSIT_INTERVAL = 60 * 60 * 1000 // 1 hour
const DEEP_FUNDING_DISTRIBUTOR_ABI = parseAbi([
  'function depositFees(bytes32 daoId, string source) external payable',
  'function authorizedDepositors(address) external view returns (bool)',
])
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
          chain: walletClient.chain ?? null,
          account: walletClient.account ?? null,
        })

        feeStats.totalDeposited += amount
        feeStats.pendingDeposit -= amount
        depositsProcessed++

        console.log(
          `[FeeCollector] Deposited ${amount} for ${source} to DAO ${daoId.slice(0, 10)}`,
        )
      } catch (err) {
        console.error(`[FeeCollector] Deposit failed:`, err)
        throw err
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
export function createFeeCollectorRouter() {
  const router = new Elysia({ name: 'fee-collector', prefix: '/fees' })

  // Manual deposit trigger (admin)
  router.post('/deposit', async () => {
    const count = await depositPendingFees()
    return { depositsProcessed: count }
  })

  // Get stats
  router.get('/stats', () => {
    return {
      totalCollected: feeStats.totalCollected.toString(),
      totalDeposited: feeStats.totalDeposited.toString(),
      pendingDeposit: feeStats.pendingDeposit.toString(),
      bySource: Object.fromEntries(
        Object.entries(feeStats.bySource).map(([k, v]) => [k, v.toString()]),
      ),
      pendingDaos: Array.from(pendingFees.keys()),
    }
  })

  // Record fee manually (for services that don't use middleware)
  router.post('/record', async ({ body }) => {
    const validated = expectValid(
      recordFeeRequestSchema,
      body,
      'Record fee request',
    )
    recordFee(validated.daoId, validated.source, BigInt(validated.amount))
    return { recorded: true }
  })

  // Health
  router.get('/health', async () => {
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

    return {
      configured: !!depositorKey && !!distributorAddress,
      isAuthorized,
      collectorRunning: !!depositInterval,
    }
  })

  return router
}
/**
 * Elysia plugin to collect fees from service requests
 * Usage: app.use(feeCollectorPlugin('rpc', jejuDaoId))
 */
export function feeCollectorPlugin(source: string, daoId: string) {
  return new Elysia({ name: `fee-collector-${source}` }).onAfterHandle(
    ({ request }) => {
      const feeAmount = request.headers.get('x-jeju-fee')
      if (feeAmount) {
        recordFee(daoId, source, BigInt(feeAmount))
      }
    },
  )
}

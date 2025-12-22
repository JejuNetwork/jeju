#!/usr/bin/env bun

/**
 * Forced Inclusion Monitor
 *
 * Watches the ForcedInclusion contract and ensures sequencers include queued transactions
 * within the 50-block window. This is critical for Stage 2 censorship resistance.
 *
 * Integration with op-batcher:
 * - Monitors TxQueued events from ForcedInclusion contract
 * - Alerts when transactions approach the inclusion deadline
 * - Can automatically force-include if sequencers fail
 * - Reports slashing opportunities for censoring sequencers
 *
 * Required Environment:
 *   L1_RPC_URL - L1 RPC endpoint
 *   FORCED_INCLUSION_ADDRESS - ForcedInclusion contract address
 *   FORCER_PRIVATE_KEY - (optional) Wallet to force-include and earn rewards
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodePacked,
  formatEther,
  getBalance,
  getLogs,
  http,
  type PublicClient,
  parseAbi,
  readContract,
  type WalletClient,
  waitForTransactionReceipt,
  watchContractEvent,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { inferChainFromRpcUrl } from '../shared/chain-utils'

const ROOT = join(import.meta.dir, '../..')
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments')

// ForcedInclusion ABI
const FORCED_INCLUSION_ABI = [
  'event TxQueued(bytes32 indexed txId, address indexed sender, uint256 fee, uint256 queuedAtBlock)',
  'event TxIncluded(bytes32 indexed txId, address indexed sequencer, bytes32 batchRoot)',
  'event TxForced(bytes32 indexed txId, address indexed forcer, uint256 reward)',
  'event TxExpired(bytes32 indexed txId, address indexed sender, uint256 refund)',
  'function queuedTxs(bytes32 txId) view returns (address sender, bytes data, uint256 gasLimit, uint256 fee, uint256 queuedAtBlock, uint256 queuedAtTimestamp, bool included, bool expired)',
  'function forceInclude(bytes32 txId) external',
  'function pendingTxIds(uint256 index) view returns (bytes32)',
  'function INCLUSION_WINDOW_BLOCKS() view returns (uint256)',
  'function MIN_FEE() view returns (uint256)',
]

interface QueuedTx {
  txId: string
  sender: string
  fee: bigint
  queuedAtBlock: number
  deadline: number
  included: boolean
  expired: boolean
}

interface MonitorStats {
  txQueued: number
  txIncluded: number
  txForced: number
  txExpired: number
  pendingCount: number
  alertCount: number
}

class ForcedInclusionMonitor {
  private pendingTxs = new Map<string, QueuedTx>()
  private stats: MonitorStats = {
    txQueued: 0,
    txIncluded: 0,
    txForced: 0,
    txExpired: 0,
    pendingCount: 0,
    alertCount: 0,
  }
  private isRunning = false
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private unwatchCallbacks: Array<() => void> = []

  constructor(
    private publicClient: PublicClient,
    private forcedInclusionAddress: Address,
    private forcedInclusionAbi: ReturnType<typeof parseAbi>,
    private walletClient: WalletClient | null,
    private inclusionWindow: bigint,
    private alertThreshold = 10,
    private checkInterval = 12000,
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true

    console.log('📡 Forced Inclusion Monitor Started')
    console.log(`   Contract: ${this.forcedInclusionAddress}`)
    console.log(`   Inclusion window: ${this.inclusionWindow} blocks`)
    console.log(
      `   Alert threshold: ${this.alertThreshold} blocks before deadline`,
    )
    if (this.walletClient?.account) {
      console.log(`   Forcer wallet: ${this.walletClient.account.address}`)
    } else {
      console.log('   Forcer wallet: NONE (monitoring only)')
    }
    console.log('')

    // Load past events
    await this.loadPastEvents()

    // Watch for new events
    const unwatchQueued = watchContractEvent(this.publicClient, {
      address: this.forcedInclusionAddress,
      abi: this.forcedInclusionAbi,
      eventName: 'TxQueued',
      onLogs: (logs) => {
        for (const log of logs) {
          const decoded = decodeEventLog({
            abi: this.forcedInclusionAbi,
            ...log,
          })
          this.handleTxQueued(
            decoded.args.txId,
            decoded.args.sender,
            decoded.args.fee,
            decoded.args.queuedAtBlock,
          )
        }
      },
    })

    const unwatchIncluded = watchContractEvent(this.publicClient, {
      address: this.forcedInclusionAddress,
      abi: this.forcedInclusionAbi,
      eventName: 'TxIncluded',
      onLogs: (logs) => {
        for (const log of logs) {
          const decoded = decodeEventLog({
            abi: this.forcedInclusionAbi,
            ...log,
          })
          this.handleTxIncluded(
            decoded.args.txId,
            decoded.args.sequencer,
            decoded.args.batchRoot,
          )
        }
      },
    })

    const unwatchForced = watchContractEvent(this.publicClient, {
      address: this.forcedInclusionAddress,
      abi: this.forcedInclusionAbi,
      eventName: 'TxForced',
      onLogs: (logs) => {
        for (const log of logs) {
          const decoded = decodeEventLog({
            abi: this.forcedInclusionAbi,
            ...log,
          })
          this.handleTxForced(
            decoded.args.txId,
            decoded.args.forcer,
            decoded.args.reward,
          )
        }
      },
    })

    const unwatchExpired = watchContractEvent(this.publicClient, {
      address: this.forcedInclusionAddress,
      abi: this.forcedInclusionAbi,
      eventName: 'TxExpired',
      onLogs: (logs) => {
        for (const log of logs) {
          const decoded = decodeEventLog({
            abi: this.forcedInclusionAbi,
            ...log,
          })
          this.handleTxExpired(
            decoded.args.txId,
            decoded.args.sender,
            decoded.args.refund,
          )
        }
      },
    })

    this.unwatchCallbacks = [
      unwatchQueued,
      unwatchIncluded,
      unwatchForced,
      unwatchExpired,
    ]

    // Start periodic checks
    this.pollInterval = setInterval(
      () => this.checkPendingTxs(),
      this.checkInterval,
    )

    console.log('🔍 Monitoring for queued transactions...\n')
  }

  private async loadPastEvents(): Promise<void> {
    const currentBlock = await this.publicClient.getBlockNumber()
    const fromBlock = currentBlock - BigInt(Number(this.inclusionWindow) + 100)

    const [queuedLogs, includedLogs, forcedLogs, expiredLogs] =
      await Promise.all([
        getLogs(this.publicClient, {
          address: this.forcedInclusionAddress,
          abi: this.forcedInclusionAbi,
          eventName: 'TxQueued',
          fromBlock,
        }),
        getLogs(this.publicClient, {
          address: this.forcedInclusionAddress,
          abi: this.forcedInclusionAbi,
          eventName: 'TxIncluded',
          fromBlock,
        }),
        getLogs(this.publicClient, {
          address: this.forcedInclusionAddress,
          abi: this.forcedInclusionAbi,
          eventName: 'TxForced',
          fromBlock,
        }),
        getLogs(this.publicClient, {
          address: this.forcedInclusionAddress,
          abi: this.forcedInclusionAbi,
          eventName: 'TxExpired',
          fromBlock,
        }),
      ])

    for (const log of queuedLogs) {
      const decoded = decodeEventLog({ abi: this.forcedInclusionAbi, ...log })
      this.handleTxQueued(
        decoded.args.txId,
        decoded.args.sender,
        decoded.args.fee,
        decoded.args.queuedAtBlock,
      )
    }

    for (const log of includedLogs) {
      const decoded = decodeEventLog({ abi: this.forcedInclusionAbi, ...log })
      this.handleTxIncluded(
        decoded.args.txId,
        decoded.args.sequencer,
        decoded.args.batchRoot,
      )
    }

    for (const log of forcedLogs) {
      const decoded = decodeEventLog({ abi: this.forcedInclusionAbi, ...log })
      this.handleTxForced(
        decoded.args.txId,
        decoded.args.forcer,
        decoded.args.reward,
      )
    }

    for (const log of expiredLogs) {
      const decoded = decodeEventLog({ abi: this.forcedInclusionAbi, ...log })
      this.handleTxExpired(
        decoded.args.txId,
        decoded.args.sender,
        decoded.args.refund,
      )
    }
  }

  stop(): void {
    this.isRunning = false
    for (const unwatch of this.unwatchCallbacks) {
      unwatch()
    }
    this.unwatchCallbacks = []
    if (this.pollInterval) clearInterval(this.pollInterval)
    console.log('\nMonitor stopped')
    this.printStats()
  }

  private handleTxQueued(
    txId: string,
    sender: string,
    fee: bigint,
    queuedAtBlock: bigint,
  ): void {
    this.stats.txQueued++
    const deadline = Number(queuedAtBlock) + Number(this.inclusionWindow)

    this.pendingTxs.set(txId, {
      txId,
      sender,
      fee,
      queuedAtBlock: Number(queuedAtBlock),
      deadline,
      included: false,
      expired: false,
    })
    this.stats.pendingCount = this.pendingTxs.size

    console.log(`📥 [QUEUED] ${txId.slice(0, 10)}...`)
    console.log(`   Sender: ${sender.slice(0, 10)}...`)
    console.log(`   Fee: ${formatEther(fee)} ETH`)
    console.log(`   Deadline: block ${deadline}`)
    console.log('')
  }

  private handleTxIncluded(
    txId: string,
    sequencer: string,
    batchRoot: string,
  ): void {
    this.stats.txIncluded++
    const tx = this.pendingTxs.get(txId)
    if (tx) {
      tx.included = true
      this.pendingTxs.delete(txId)
      this.stats.pendingCount = this.pendingTxs.size
    }

    console.log(`✅ [INCLUDED] ${txId.slice(0, 10)}...`)
    console.log(`   Sequencer: ${sequencer.slice(0, 10)}...`)
    console.log(`   Batch: ${batchRoot.slice(0, 20)}...`)
    console.log('')
  }

  private handleTxForced(txId: string, forcer: string, reward: bigint): void {
    this.stats.txForced++
    const tx = this.pendingTxs.get(txId)
    if (tx) {
      tx.included = true
      this.pendingTxs.delete(txId)
      this.stats.pendingCount = this.pendingTxs.size
    }

    console.log(`⚡ [FORCED] ${txId.slice(0, 10)}...`)
    console.log(`   Forcer: ${forcer.slice(0, 10)}...`)
    console.log(`   Reward: ${formatEther(reward)} ETH`)
    console.log('   ⚠️  Sequencer failed to include - slashing may apply')
    console.log('')
  }

  private handleTxExpired(txId: string, sender: string, refund: bigint): void {
    this.stats.txExpired++
    const tx = this.pendingTxs.get(txId)
    if (tx) {
      tx.expired = true
      this.pendingTxs.delete(txId)
      this.stats.pendingCount = this.pendingTxs.size
    }

    console.log(`⏰ [EXPIRED] ${txId.slice(0, 10)}...`)
    console.log(`   Sender: ${sender.slice(0, 10)}...`)
    console.log(`   Refund: ${formatEther(refund)} ETH`)
    console.log('')
  }

  private async checkPendingTxs(): Promise<void> {
    if (this.pendingTxs.size === 0) return

    const currentBlock = await this.publicClient.getBlockNumber()

    for (const [txId, tx] of this.pendingTxs) {
      const blocksRemaining = tx.deadline - Number(currentBlock)

      // Alert if approaching deadline
      if (blocksRemaining <= this.alertThreshold && blocksRemaining > 0) {
        this.stats.alertCount++
        console.log(
          `🚨 [ALERT] ${txId.slice(0, 10)}... - ${blocksRemaining} blocks until deadline!`,
        )
        console.log(`   Sequencers should include this transaction immediately`)
        console.log('')
      }

      // Force include if past deadline and we have a wallet client
      if (
        blocksRemaining <= 0 &&
        this.walletClient &&
        !tx.included &&
        !tx.expired
      ) {
        await this.tryForceInclude(txId)
      }
    }
  }

  private async tryForceInclude(txId: `0x${string}`): Promise<void> {
    if (!this.walletClient) return

    console.log(`⚡ Attempting to force-include ${txId.slice(0, 10)}...`)

    const hash = await this.walletClient.writeContract({
      address: this.forcedInclusionAddress,
      abi: this.forcedInclusionAbi,
      functionName: 'forceInclude',
      args: [txId],
    })
    console.log(`   TX submitted: ${hash}`)

    const receipt = await waitForTransactionReceipt(this.publicClient, { hash })
    console.log(`   ✅ Force-included in block ${receipt.blockNumber}`)
    console.log(`   💰 Check wallet for reward`)
    console.log('')
  }

  printStats(): void {
    console.log('\n📊 Monitor Statistics:')
    console.log(`   Transactions queued: ${this.stats.txQueued}`)
    console.log(`   Transactions included: ${this.stats.txIncluded}`)
    console.log(`   Transactions forced: ${this.stats.txForced}`)
    console.log(`   Transactions expired: ${this.stats.txExpired}`)
    console.log(`   Currently pending: ${this.stats.pendingCount}`)
    console.log(`   Deadline alerts: ${this.stats.alertCount}`)
  }
}

// ============================================================
// OP-BATCHER INTEGRATION HELPER
// ============================================================

/**
 * Gets pending forced transactions that the batcher should include
 * This function should be called by op-batcher before creating a batch
 */
export async function getPendingForcedTxs(
  publicClient: PublicClient,
  forcedInclusionAddress: Address,
): Promise<
  Array<{
    txId: `0x${string}`
    sender: Address
    data: `0x${string}`
    gasLimit: bigint
    deadline: number
  }>
> {
  const abi = parseAbi(FORCED_INCLUSION_ABI)
  const currentBlock = await publicClient.getBlockNumber()
  const inclusionWindow = await readContract(publicClient, {
    address: forcedInclusionAddress,
    abi,
    functionName: 'INCLUSION_WINDOW_BLOCKS',
  })

  const pendingTxs: Array<{
    txId: `0x${string}`
    sender: Address
    data: `0x${string}`
    gasLimit: bigint
    deadline: number
  }> = []

  // Get all queued transactions by listening to past events
  const events = await getLogs(publicClient, {
    address: forcedInclusionAddress,
    abi,
    eventName: 'TxQueued',
    fromBlock: currentBlock - BigInt(Number(inclusionWindow) + 10),
  })

  for (const log of events) {
    const decoded = decodeEventLog({ abi, ...log })
    const txId = decoded.args.txId as `0x${string}`
    const queuedAtBlock = decoded.args.queuedAtBlock as bigint

    // Check if still pending
    const txData = (await readContract(publicClient, {
      address: forcedInclusionAddress,
      abi,
      functionName: 'queuedTxs',
      args: [txId],
    })) as {
      sender: Address
      data: `0x${string}`
      gasLimit: bigint
      included: boolean
      expired: boolean
    }

    if (!txData.included && !txData.expired) {
      const deadline = Number(queuedAtBlock) + Number(inclusionWindow)

      // Prioritize transactions close to deadline
      if (deadline - Number(currentBlock) <= 25) {
        // Last 25 blocks
        pendingTxs.push({
          txId,
          sender: txData.sender,
          data: txData.data,
          gasLimit: txData.gasLimit,
          deadline,
        })
      }
    }
  }

  // Sort by deadline (soonest first)
  pendingTxs.sort((a, b) => a.deadline - b.deadline)

  return pendingTxs
}

/**
 * Generates the batch data that includes a forced transaction
 * This should be integrated into op-batcher's batch building logic
 */
export function generateForcedTxBatchData(
  sender: Address,
  data: `0x${string}`,
  gasLimit: bigint,
): `0x${string}` {
  // Format: 0x7e (forced tx marker) + sender + gasLimit + data
  const encoded = encodePacked(
    ['bytes1', 'address', 'uint256', 'bytes'],
    ['0x7e', sender, gasLimit, data],
  )
  return encoded
}

// ============================================================
// CLI ENTRY POINT
// ============================================================

async function main(): Promise<void> {
  console.log('📡 Forced Inclusion Monitor\n')

  const network = process.env.NETWORK || 'localnet'
  const l1RpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:8545'
  const alertThreshold = parseInt(process.env.ALERT_THRESHOLD || '10', 10)
  const checkInterval = parseInt(process.env.CHECK_INTERVAL || '12000', 10)

  let forcedInclusionAddress = process.env.FORCED_INCLUSION_ADDRESS
  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`)
  if (existsSync(deploymentFile)) {
    const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'))
    forcedInclusionAddress =
      forcedInclusionAddress || deployment.forcedInclusion
    console.log(`Loaded deployment from ${deploymentFile}`)
  }

  if (!forcedInclusionAddress) {
    console.error('FORCED_INCLUSION_ADDRESS required')
    process.exit(1)
  }

  const chain = inferChainFromRpcUrl(l1RpcUrl)
  const publicClient = createPublicClient({ chain, transport: http(l1RpcUrl) })
  const forcedInclusionAbi = parseAbi(FORCED_INCLUSION_ABI)
  const forcedInclusionAddr = forcedInclusionAddress as Address

  // Optional forcer wallet for automatic force-inclusion
  let walletClient: WalletClient | null = null
  const forcerKey = process.env.FORCER_PRIVATE_KEY
  if (forcerKey) {
    const account = privateKeyToAccount(forcerKey as `0x${string}`)
    walletClient = createWalletClient({
      chain,
      transport: http(l1RpcUrl),
      account,
    })
    const balance = await getBalance(publicClient, { address: account.address })
    console.log(`Forcer wallet: ${account.address}`)
    console.log(`Forcer balance: ${formatEther(balance)} ETH`)
  }

  const inclusionWindow = await readContract(publicClient, {
    address: forcedInclusionAddr,
    abi: forcedInclusionAbi,
    functionName: 'INCLUSION_WINDOW_BLOCKS',
  })
  console.log(`Inclusion window: ${inclusionWindow} blocks`)
  console.log('')

  const monitor = new ForcedInclusionMonitor(
    publicClient,
    forcedInclusionAddr,
    forcedInclusionAbi,
    walletClient,
    inclusionWindow,
    alertThreshold,
    checkInterval,
  )

  process.on('SIGINT', () => {
    monitor.stop()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    monitor.stop()
    process.exit(0)
  })

  await monitor.start()
}

main().catch((e) => {
  console.error('Fatal error:', e)
  process.exit(1)
})

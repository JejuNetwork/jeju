/**
 * On-Chain Moderation Signals
 *
 * DESIGN AXIOM: Protocol neutrality, operator responsibility
 * Protocol emits signals; operators enforce based on role.
 *
 * DESIGN AXIOM: Deterministic enforcement
 * All on-chain actions are rule-based, logged, and auditable.
 *
 * Integrates with BanManager contract to:
 * 1. Place wallets on notice (warning)
 * 2. Apply permanent bans (CSAM / sanctions / abuse)
 * 3. Sync bans cross-chain via Hyperlane
 *
 * Contract events emitted:
 * - OnNoticeBanApplied(target, reporter, caseId, reason)
 * - AddressBanApplied(target, banType, caseId, reason)
 * - AddressBanRemoved(target)
 */

import type {
  Account,
  Address,
  Chain,
  Hash,
  PublicClient,
  Transport,
  WalletClient,
} from 'viem'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { logger } from '../logger'

// BanManager ABI (partial - only methods we need)
const BAN_MANAGER_ABI = [
  {
    name: 'placeOnNotice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'reporter', type: 'address' },
      { name: 'caseId', type: 'bytes32' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'applyAddressBan',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'caseId', type: 'bytes32' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'removeAddressBan',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [],
  },
  {
    name: 'isAddressBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'isOnNotice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'isPermanentlyBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'getAddressBan',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'isBanned', type: 'bool' },
          { name: 'banType', type: 'uint8' },
          { name: 'bannedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'reason', type: 'string' },
          { name: 'proposalId', type: 'bytes32' },
          { name: 'reporter', type: 'address' },
          { name: 'caseId', type: 'bytes32' },
        ],
      },
    ],
  },
] as const

export type BanType = 'none' | 'on_notice' | 'challenged' | 'permanent'

export interface OnChainBanRecord {
  isBanned: boolean
  banType: BanType
  bannedAt: number
  expiresAt: number
  reason: string
  caseId: Hash
  reporter: Address
}

export interface OnChainSignalsConfig {
  network?: 'mainnet' | 'testnet'
  banManagerAddress?: Address
  rpcUrl?: string
  moderatorPrivateKey?: `0x${string}`
  dryRun?: boolean
}

const BAN_TYPE_MAP: Record<number, BanType> = {
  0: 'none',
  1: 'on_notice',
  2: 'challenged',
  3: 'permanent',
}

export interface ModerationSignal {
  type: 'warning' | 'ban' | 'unban'
  target: Address
  reason: string
  caseId?: string
  evidenceBundleId?: string
  contentHash?: string
  violationType?: string
  timestamp: number
}

// Queue of pending signals (for batching/retry)
const signalQueue: ModerationSignal[] = []

/** Convert ModerationSignal to JSON-safe format for logging */
function signalToJson(
  signal: ModerationSignal,
): Record<string, string | number> {
  const result: Record<string, string | number> = {
    type: signal.type,
    target: signal.target,
    reason: signal.reason,
    timestamp: signal.timestamp,
  }
  if (signal.caseId) result.caseId = signal.caseId
  if (signal.evidenceBundleId) result.evidenceBundleId = signal.evidenceBundleId
  if (signal.contentHash) result.contentHash = signal.contentHash
  if (signal.violationType) result.violationType = signal.violationType
  return result
}

/**
 * On-Chain Moderation Signals Service
 */
export class OnChainSignalsService {
  private config: Required<Pick<OnChainSignalsConfig, 'network' | 'dryRun'>> &
    OnChainSignalsConfig
  private publicClient: PublicClient
  private walletClient?: WalletClient<Transport, Chain, Account>
  private moderatorAddress?: Address
  private initialized = false

  constructor(config: OnChainSignalsConfig = {}) {
    this.config = {
      network: config.network ?? 'testnet',
      dryRun: config.dryRun ?? !config.moderatorPrivateKey,
      banManagerAddress: config.banManagerAddress,
      rpcUrl: config.rpcUrl,
      moderatorPrivateKey: config.moderatorPrivateKey,
    }

    const chain = this.config.network === 'mainnet' ? base : baseSepolia
    const rpcUrl =
      this.config.rpcUrl ??
      (this.config.network === 'mainnet'
        ? 'https://mainnet.base.org'
        : 'https://sepolia.base.org')

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Setup wallet client if private key provided
    if (this.config.moderatorPrivateKey) {
      const account = privateKeyToAccount(this.config.moderatorPrivateKey)
      this.moderatorAddress = account.address

      const chain = this.config.network === 'mainnet' ? base : baseSepolia
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(this.config.rpcUrl),
      })

      logger.info('[OnChainSignals] Wallet client initialized', {
        moderator: this.moderatorAddress,
        network: this.config.network,
      })
    }

    if (!this.config.banManagerAddress) {
      logger.warn(
        '[OnChainSignals] No BanManager address configured - running in read-only mode',
      )
    }

    logger.info('[OnChainSignals] Initialized', {
      network: this.config.network,
      dryRun: this.config.dryRun,
      hasBanManager: !!this.config.banManagerAddress,
      hasWallet: !!this.walletClient,
    })

    this.initialized = true
  }

  /**
   * Place wallet on notice (warning)
   *
   * Use for first-time violations or suspicious activity
   */
  async placeOnNotice(params: {
    target: Address
    reason: string
    caseId?: string
  }): Promise<Hash | null> {
    const signal: ModerationSignal = {
      type: 'warning',
      target: params.target,
      reason: params.reason,
      caseId: params.caseId,
      timestamp: Date.now(),
    }

    if (this.config.dryRun) {
      logger.info(
        '[OnChainSignals] DRY RUN: placeOnNotice',
        signalToJson(signal),
      )
      signalQueue.push(signal)
      return null
    }

    if (!this.walletClient || !this.config.banManagerAddress) {
      logger.warn(
        '[OnChainSignals] Cannot execute on-chain action - missing config',
      )
      signalQueue.push(signal)
      return null
    }

    const caseIdBytes = params.caseId
      ? (`0x${params.caseId.replace(/^0x/, '').padStart(64, '0')}` as Hash)
      : (`0x${'0'.repeat(64)}` as Hash)

    try {
      const hash = await this.walletClient.writeContract({
        address: this.config.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'placeOnNotice',
        args: [
          params.target,
          this.moderatorAddress as Address,
          caseIdBytes,
          params.reason,
        ],
      })

      logger.info('[OnChainSignals] placeOnNotice executed', {
        txHash: hash,
        target: params.target,
        reason: params.reason,
      })

      return hash
    } catch (error) {
      logger.error('[OnChainSignals] placeOnNotice failed', {
        error: String(error),
        target: params.target,
      })
      signalQueue.push(signal)
      return null
    }
  }

  /**
   * Apply permanent ban
   *
   * Use for CSAM, sanctions, or repeated severe violations
   */
  async applyBan(params: {
    target: Address
    reason: string
    caseId?: string
    evidenceBundleId?: string
    contentHash?: string
  }): Promise<Hash | null> {
    const signal: ModerationSignal = {
      type: 'ban',
      target: params.target,
      reason: params.reason,
      caseId: params.caseId,
      evidenceBundleId: params.evidenceBundleId,
      contentHash: params.contentHash,
      timestamp: Date.now(),
    }

    if (this.config.dryRun) {
      logger.info('[OnChainSignals] DRY RUN: applyBan', signalToJson(signal))
      signalQueue.push(signal)
      return null
    }

    if (!this.walletClient || !this.config.banManagerAddress) {
      logger.warn(
        '[OnChainSignals] Cannot execute on-chain action - missing config',
      )
      signalQueue.push(signal)
      return null
    }

    const caseIdBytes = params.caseId
      ? (`0x${params.caseId.replace(/^0x/, '').padStart(64, '0')}` as Hash)
      : (`0x${'0'.repeat(64)}` as Hash)

    try {
      const hash = await this.walletClient.writeContract({
        address: this.config.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'applyAddressBan',
        args: [params.target, caseIdBytes, params.reason],
      })

      logger.info('[OnChainSignals] applyBan executed', {
        txHash: hash,
        target: params.target,
        reason: params.reason,
      })

      return hash
    } catch (error) {
      logger.error('[OnChainSignals] applyBan failed', {
        error: String(error),
        target: params.target,
      })
      signalQueue.push(signal)
      return null
    }
  }

  /**
   * Remove ban (reinstate wallet)
   *
   * Use when ban is appealed successfully
   */
  async removeBan(params: {
    target: Address
    reason: string
  }): Promise<Hash | null> {
    const signal: ModerationSignal = {
      type: 'unban',
      target: params.target,
      reason: params.reason,
      timestamp: Date.now(),
    }

    if (this.config.dryRun) {
      logger.info('[OnChainSignals] DRY RUN: removeBan', signalToJson(signal))
      signalQueue.push(signal)
      return null
    }

    if (!this.walletClient || !this.config.banManagerAddress) {
      logger.warn(
        '[OnChainSignals] Cannot execute on-chain action - missing config',
      )
      signalQueue.push(signal)
      return null
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.config.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'removeAddressBan',
        args: [params.target],
      })

      logger.info('[OnChainSignals] removeBan executed', {
        txHash: hash,
        target: params.target,
      })

      return hash
    } catch (error) {
      logger.error('[OnChainSignals] removeBan failed', {
        error: String(error),
        target: params.target,
      })
      signalQueue.push(signal)
      return null
    }
  }

  /**
   * Check if address is banned on-chain
   */
  async isAddressBanned(target: Address): Promise<boolean> {
    if (!this.config.banManagerAddress) {
      return false
    }

    try {
      const result = await this.publicClient.readContract({
        address: this.config.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'isAddressBanned',
        args: [target],
      })
      return result
    } catch (error) {
      logger.error('[OnChainSignals] isAddressBanned check failed', {
        error: String(error),
      })
      return false
    }
  }

  /**
   * Check if address is on notice
   */
  async isOnNotice(target: Address): Promise<boolean> {
    if (!this.config.banManagerAddress) {
      return false
    }

    try {
      const result = await this.publicClient.readContract({
        address: this.config.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'isOnNotice',
        args: [target],
      })
      return result
    } catch (error) {
      logger.error('[OnChainSignals] isOnNotice check failed', {
        error: String(error),
      })
      return false
    }
  }

  /**
   * Get full ban record
   */
  async getBanRecord(target: Address): Promise<OnChainBanRecord | null> {
    if (!this.config.banManagerAddress) {
      return null
    }

    try {
      const result = await this.publicClient.readContract({
        address: this.config.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'getAddressBan',
        args: [target],
      })

      return {
        isBanned: result.isBanned,
        banType: BAN_TYPE_MAP[result.banType] ?? 'none',
        bannedAt: Number(result.bannedAt),
        expiresAt: Number(result.expiresAt),
        reason: result.reason,
        caseId: result.caseId,
        reporter: result.reporter,
      }
    } catch (error) {
      logger.error('[OnChainSignals] getBanRecord failed', {
        error: String(error),
      })
      return null
    }
  }

  /**
   * Process pending signal queue
   *
   * Called periodically to retry failed signals
   */
  async processQueue(): Promise<number> {
    if (this.config.dryRun || signalQueue.length === 0) {
      return 0
    }

    let processed = 0
    const signals = [...signalQueue]
    signalQueue.length = 0 // Clear queue

    for (const signal of signals) {
      try {
        switch (signal.type) {
          case 'warning':
            await this.placeOnNotice({
              target: signal.target,
              reason: signal.reason,
              caseId: signal.caseId,
            })
            break
          case 'ban':
            await this.applyBan({
              target: signal.target,
              reason: signal.reason,
              caseId: signal.caseId,
              evidenceBundleId: signal.evidenceBundleId,
              contentHash: signal.contentHash,
            })
            break
          case 'unban':
            await this.removeBan({
              target: signal.target,
              reason: signal.reason,
            })
            break
        }
        processed++
      } catch {
        // Re-queue failed signal
        signalQueue.push(signal)
      }
    }

    if (processed > 0) {
      logger.info('[OnChainSignals] Processed queue', {
        processed,
        remaining: signalQueue.length,
      })
    }

    return processed
  }

  /**
   * Get pending signals
   */
  getPendingSignals(): ModerationSignal[] {
    return [...signalQueue]
  }

  /**
   * Get service stats
   */
  getStats(): {
    network: string
    dryRun: boolean
    hasBanManager: boolean
    hasWallet: boolean
    pendingSignals: number
  } {
    return {
      network: this.config.network,
      dryRun: this.config.dryRun,
      hasBanManager: !!this.config.banManagerAddress,
      hasWallet: !!this.walletClient,
      pendingSignals: signalQueue.length,
    }
  }
}

// Singleton
let instance: OnChainSignalsService | null = null

export function getOnChainSignalsService(
  config?: OnChainSignalsConfig,
): OnChainSignalsService {
  if (!instance) {
    instance = new OnChainSignalsService(
      config ?? {
        network: process.env.NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
        banManagerAddress: process.env.BAN_MANAGER_ADDRESS as
          | Address
          | undefined,
        moderatorPrivateKey: process.env.MODERATOR_PRIVATE_KEY as
          | `0x${string}`
          | undefined,
        dryRun: process.env.MODERATION_DRY_RUN === 'true',
      },
    )
  }
  return instance
}

export function resetOnChainSignalsService(): void {
  instance = null
  signalQueue.length = 0
}

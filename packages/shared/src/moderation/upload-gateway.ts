/**
 * Upload Gateway with Proof of Work Challenge
 *
 * DESIGN AXIOM: Protocol neutrality, operator responsibility
 * Gateway enforces intake policy without storing content.
 *
 * Rate limiting via PoW:
 * - Difficulty scales with wallet reputation
 * - New/suspicious wallets = harder PoW
 * - Established wallets = easier PoW
 * - Sanctioned/banned wallets = blocked entirely
 *
 * Pipeline:
 * 1. Validate wallet (sanctions + ban check)
 * 2. Issue PoW challenge based on difficulty
 * 3. Verify PoW solution
 * 4. Accept upload and compute SHA256
 * 5. Encrypt and store with TTL
 * 6. Return intake context for pipeline
 */

import type { Address } from 'viem'
import { logger } from '../logger'
import type { IntakeContext } from './ingestion-pipeline'
import { getSanctionsScreener, type SanctionsScreener } from './sanctions'
import {
  getWalletEnforcementManager,
  type WalletEnforcementManager,
} from './wallet-enforcement'

async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Buffer(buffer: Buffer): Promise<string> {
  return sha256(new Uint8Array(buffer))
}

export interface PoWChallenge {
  challengeId: string
  prefix: string
  difficulty: number
  expiresAt: number
  walletAddress: Address
}

export interface PoWSolution {
  challengeId: string
  nonce: string
  hash: string
}

export interface UploadRequest {
  walletAddress: Address
  content: Buffer
  contentType: string
  powSolution?: PoWSolution
  ip?: string
  userAgent?: string
}

export interface UploadResult {
  success: boolean
  error?: string
  intake?: IntakeContext
  challenge?: PoWChallenge
}

export interface UploadGatewayConfig {
  /** Default TTL for content in ms (default: 30 minutes) */
  defaultTtlMs?: number
  /** Challenge expiry in ms (default: 5 minutes) */
  challengeExpiryMs?: number
  /** Max content size in bytes (default: 50MB) */
  maxContentSize?: number
  /** Base difficulty (default: 16 - requires hash starting with 4 zeros) */
  baseDifficulty?: number
  /** Enable PoW challenges (default: true) */
  enablePoW?: boolean
  /** Enable sanctions check (default: true) */
  enableSanctionsCheck?: boolean
  /** Skip PoW for high-reputation wallets */
  skipPoWForTrustedWallets?: boolean
}

// In-memory challenge store (should be Redis in production)
const challengeStore = new Map<string, PoWChallenge>()

// Clean up expired challenges periodically
setInterval(() => {
  const now = Date.now()
  for (const [id, challenge] of challengeStore) {
    if (challenge.expiresAt < now) {
      challengeStore.delete(id)
    }
  }
}, 60000) // Every minute

/**
 * Upload Gateway
 *
 * Handles rate-limited content intake with PoW challenges.
 */
export class UploadGateway {
  private config: Required<UploadGatewayConfig>
  private sanctionsScreener: SanctionsScreener
  private walletEnforcement: WalletEnforcementManager
  private initialized = false

  constructor(config: UploadGatewayConfig = {}) {
    this.config = {
      defaultTtlMs: config.defaultTtlMs ?? 30 * 60 * 1000,
      challengeExpiryMs: config.challengeExpiryMs ?? 5 * 60 * 1000,
      maxContentSize: config.maxContentSize ?? 50 * 1024 * 1024,
      baseDifficulty: config.baseDifficulty ?? 16,
      enablePoW: config.enablePoW ?? true,
      enableSanctionsCheck: config.enableSanctionsCheck ?? true,
      skipPoWForTrustedWallets: config.skipPoWForTrustedWallets ?? true,
    }

    this.sanctionsScreener = getSanctionsScreener()
    this.walletEnforcement = getWalletEnforcementManager()
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    await Promise.all([
      this.sanctionsScreener.initialize(),
      this.walletEnforcement.initialize(),
    ])

    logger.info('[UploadGateway] Initialized', {
      maxSize: `${this.config.maxContentSize / (1024 * 1024)}MB`,
      baseDifficulty: this.config.baseDifficulty,
      enablePoW: this.config.enablePoW,
    })

    this.initialized = true
  }

  /**
   * Issue PoW challenge for a wallet
   */
  async issueChallenge(
    walletAddress: Address,
  ): Promise<PoWChallenge | { blocked: true; reason: string }> {
    // Check sanctions
    if (this.config.enableSanctionsCheck) {
      const sanctionsResult =
        await this.sanctionsScreener.checkAddress(walletAddress)
      if (sanctionsResult.isSanctioned) {
        logger.warn('[UploadGateway] Sanctioned wallet blocked', {
          address: walletAddress,
        })
        return {
          blocked: true,
          reason: `Sanctioned wallet: ${sanctionsResult.source}`,
        }
      }
    }

    // Check wallet enforcement status
    const canUpload = await this.walletEnforcement.canPerformAction(
      walletAddress,
      'upload',
    )
    if (!canUpload) {
      logger.warn('[UploadGateway] Wallet upload blocked', {
        address: walletAddress,
      })
      return { blocked: true, reason: 'Wallet is restricted from uploading' }
    }

    // Determine difficulty based on wallet status
    const difficulty =
      await this.walletEnforcement.getPoWDifficulty(walletAddress)
    const scaledDifficulty = this.config.baseDifficulty * difficulty

    // Generate challenge
    const challengeId = crypto.randomUUID()
    const prefix = await sha256(
      new TextEncoder().encode(`${challengeId}-${walletAddress}-${Date.now()}`),
    )

    const challenge: PoWChallenge = {
      challengeId,
      prefix: prefix.slice(0, 32),
      difficulty: scaledDifficulty,
      expiresAt: Date.now() + this.config.challengeExpiryMs,
      walletAddress,
    }

    challengeStore.set(challengeId, challenge)

    logger.info('[UploadGateway] Challenge issued', {
      challengeId,
      address: walletAddress,
      difficulty: scaledDifficulty,
    })

    return challenge
  }

  /**
   * Verify PoW solution
   */
  verifySolution(solution: PoWSolution): boolean {
    const challenge = challengeStore.get(solution.challengeId)
    if (!challenge) {
      logger.warn('[UploadGateway] Challenge not found', {
        challengeId: solution.challengeId,
      })
      return false
    }

    if (challenge.expiresAt < Date.now()) {
      challengeStore.delete(solution.challengeId)
      logger.warn('[UploadGateway] Challenge expired', {
        challengeId: solution.challengeId,
      })
      return false
    }

    // Verify hash meets difficulty requirement
    const requiredZeros = Math.floor(challenge.difficulty / 4)
    const requiredPrefix = '0'.repeat(requiredZeros)

    if (!solution.hash.startsWith(requiredPrefix)) {
      logger.warn('[UploadGateway] Invalid PoW solution', {
        challengeId: solution.challengeId,
        expectedPrefix: requiredPrefix,
        actualPrefix: solution.hash.slice(0, requiredZeros),
      })
      return false
    }

    // Remove used challenge
    challengeStore.delete(solution.challengeId)

    logger.info('[UploadGateway] PoW solution verified', {
      challengeId: solution.challengeId,
    })
    return true
  }

  /**
   * Process upload request
   */
  async processUpload(request: UploadRequest): Promise<UploadResult> {
    // Validate content size
    if (request.content.length > this.config.maxContentSize) {
      return {
        success: false,
        error: `Content exceeds max size of ${this.config.maxContentSize / (1024 * 1024)}MB`,
      }
    }

    // Check sanctions
    if (this.config.enableSanctionsCheck) {
      const sanctionsResult = await this.sanctionsScreener.checkAddress(
        request.walletAddress,
      )
      if (sanctionsResult.isSanctioned) {
        return {
          success: false,
          error: `Sanctioned wallet: ${sanctionsResult.source}`,
        }
      }
    }

    // Check wallet enforcement status
    const canUpload = await this.walletEnforcement.canPerformAction(
      request.walletAddress,
      'upload',
    )
    if (!canUpload) {
      return {
        success: false,
        error: 'Wallet is restricted from uploading',
      }
    }

    // Check if PoW is required
    if (this.config.enablePoW) {
      const walletState = await this.walletEnforcement.getState(
        request.walletAddress,
      )

      // Skip PoW for trusted wallets with clean status
      const skipPoW =
        this.config.skipPoWForTrustedWallets &&
        walletState.status === 'clean' &&
        walletState.transactionCount > 100

      if (!skipPoW) {
        if (!request.powSolution) {
          // Issue challenge
          const challengeResult = await this.issueChallenge(
            request.walletAddress,
          )
          if ('blocked' in challengeResult) {
            return { success: false, error: challengeResult.reason }
          }
          return { success: false, challenge: challengeResult }
        }

        // Verify solution
        if (!this.verifySolution(request.powSolution)) {
          return { success: false, error: 'Invalid PoW solution' }
        }
      }
    }

    // Compute content hash
    const contentHash = await sha256Buffer(request.content)

    // Encrypt content (placeholder - would use actual encryption)
    const encryptedRef = `enc:${contentHash}:${Date.now()}`

    // Build intake context
    const intake: IntakeContext = {
      sha256: contentHash,
      encryptedRef,
      receivedAt: Date.now(),
      ttlMs: this.config.defaultTtlMs,
      uploaderAddress: request.walletAddress,
      uploaderIp: request.ip,
      userAgent: request.userAgent,
      powDifficulty: request.powSolution
        ? challengeStore.get(request.powSolution.challengeId)?.difficulty
        : undefined,
      powSolution: request.powSolution?.hash,
    }

    logger.info('[UploadGateway] Upload accepted', {
      hash: contentHash.slice(0, 16),
      address: request.walletAddress,
      size: request.content.length,
    })

    return { success: true, intake }
  }

  /**
   * Compute PoW solution (client-side helper)
   */
  static async computeSolution(challenge: PoWChallenge): Promise<PoWSolution> {
    const requiredZeros = Math.floor(challenge.difficulty / 4)
    const requiredPrefix = '0'.repeat(requiredZeros)

    let nonce = 0
    let hash: string

    // Mine for valid hash
    do {
      const data = new TextEncoder().encode(`${challenge.prefix}:${nonce}`)
      hash = await sha256(data)
      nonce++

      // Safety limit
      if (nonce > 100_000_000) {
        throw new Error('PoW computation exceeded safety limit')
      }
    } while (!hash.startsWith(requiredPrefix))

    return {
      challengeId: challenge.challengeId,
      nonce: (nonce - 1).toString(),
      hash,
    }
  }

  /**
   * Get gateway stats
   */
  getStats(): {
    pendingChallenges: number
    config: typeof this.config
  } {
    return {
      pendingChallenges: challengeStore.size,
      config: this.config,
    }
  }
}

// Singleton
let instance: UploadGateway | null = null

export function getUploadGateway(config?: UploadGatewayConfig): UploadGateway {
  if (!instance) {
    instance = new UploadGateway(config)
  }
  return instance
}

export function resetUploadGateway(): void {
  instance = null
  challengeStore.clear()
}

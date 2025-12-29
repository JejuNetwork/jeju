/**
 * Wallet Enforcement
 *
 * DESIGN AXIOM: Deterministic enforcement
 * Every action is rule-based, logged, reproducible, auditable.
 *
 * Manages wallet status transitions:
 * CLEAN → WARNED → RESTRICTED → QUARANTINE_ONLY → DENIED
 *
 * Status affects:
 * - Rate limits (PoW difficulty)
 * - Content access (quarantine only for restricted)
 * - Network participation (denied = blocked)
 */

import { logger } from '../logger'
import type { Address } from 'viem'

export type WalletStatus = 'clean' | 'warned' | 'restricted' | 'quarantine_only' | 'denied'

export type ViolationType =
  | 'csam_upload'
  | 'csam_distribution'
  | 'policy_violation'
  | 'spam'
  | 'malware'
  | 'sanctions'
  | 'repeated_warnings'

export interface Violation {
  id: string
  timestamp: number
  type: ViolationType
  severity: 'low' | 'medium' | 'high' | 'critical'
  contentHash?: string
  description: string
  evidenceBundleId?: string
}

export interface WalletEnforcementState {
  address: Address
  status: WalletStatus
  statusChangedAt: number
  
  // History
  violations: Violation[]
  warningsIssued: number
  
  // Reputation factors
  walletAge: number
  stakeAmount: bigint
  transactionCount: number
  
  // Sanctions screening
  ofacMatch: boolean
  taintScore: number
  
  // Processing limits
  powDifficulty: number
  rateLimit: number
}

export interface WalletEnforcementConfig {
  /** Warnings before restriction (default: 3) */
  warningsBeforeRestriction?: number
  /** Days to clear a warning (default: 30) */
  warningClearDays?: number
}

const DEFAULT_CONFIG = {
  warningsBeforeRestriction: 3,
  warningClearDays: 30,
}

// In-memory storage (replace with persistent store in production)
const walletStates = new Map<Address, WalletEnforcementState>()

// Status severity order for transitions
const STATUS_ORDER: WalletStatus[] = ['clean', 'warned', 'restricted', 'quarantine_only', 'denied']

/**
 * Wallet Enforcement Manager
 *
 * Tracks wallet violations and manages status transitions.
 * All transitions are logged for audit trail.
 */
export class WalletEnforcementManager {
  private config: typeof DEFAULT_CONFIG

  constructor(config: WalletEnforcementConfig = {}) {
    this.config = {
      warningsBeforeRestriction: config.warningsBeforeRestriction ?? DEFAULT_CONFIG.warningsBeforeRestriction,
      warningClearDays: config.warningClearDays ?? DEFAULT_CONFIG.warningClearDays,
    }
  }

  async initialize(): Promise<void> {
    logger.info('[WalletEnforcement] Initialized')
  }

  /**
   * Get or create wallet state
   */
  getState(address: Address): WalletEnforcementState {
    const existing = walletStates.get(address)
    if (existing) return existing

    const newState: WalletEnforcementState = {
      address,
      status: 'clean',
      statusChangedAt: Date.now(),
      violations: [],
      warningsIssued: 0,
      walletAge: 0,
      stakeAmount: 0n,
      transactionCount: 0,
      ofacMatch: false,
      taintScore: 0,
      powDifficulty: 1,
      rateLimit: 100,
    }

    walletStates.set(address, newState)
    return newState
  }

  /**
   * Record violation and update status
   *
   * CSAM violations = immediate DENIED
   * Other violations = graduated response
   */
  async recordViolation(address: Address, violation: Omit<Violation, 'id' | 'timestamp'>): Promise<WalletEnforcementState> {
    const state = this.getState(address)
    const now = Date.now()

    const fullViolation: Violation = {
      ...violation,
      id: crypto.randomUUID(),
      timestamp: now,
    }

    state.violations.push(fullViolation)

    // Determine new status based on violation
    const newStatus = this.determineStatus(state, fullViolation)
    if (newStatus !== state.status) {
      const oldStatus = state.status
      state.status = newStatus
      state.statusChangedAt = now

      logger.info('[WalletEnforcement] Status changed', {
        address,
        oldStatus,
        newStatus,
        violationType: violation.type,
        severity: violation.severity,
      })
    }

    // Update processing limits based on status
    this.updateLimits(state)

    walletStates.set(address, state)
    return state
  }

  /**
   * Determine new status based on violation
   */
  private determineStatus(state: WalletEnforcementState, violation: Violation): WalletStatus {
    // Critical violations = immediate DENIED
    if (violation.severity === 'critical' || violation.type === 'csam_upload' || violation.type === 'csam_distribution') {
      return 'denied'
    }

    // Sanctions = immediate DENIED
    if (violation.type === 'sanctions') {
      return 'denied'
    }

    // Count recent violations
    const recentViolations = state.violations.filter(v => 
      Date.now() - v.timestamp < 30 * 24 * 60 * 60 * 1000 // Last 30 days
    )

    // High severity = escalate one level
    if (violation.severity === 'high') {
      const currentIndex = STATUS_ORDER.indexOf(state.status)
      const nextIndex = Math.min(currentIndex + 1, STATUS_ORDER.length - 1)
      return STATUS_ORDER[nextIndex]!
    }

    // Accumulated violations
    if (recentViolations.length >= 5) {
      return 'denied'
    } else if (recentViolations.length >= 3) {
      return 'quarantine_only'
    } else if (recentViolations.length >= 2) {
      return 'restricted'
    } else if (recentViolations.length >= 1) {
      return 'warned'
    }

    return state.status
  }

  /**
   * Update processing limits based on status
   */
  private updateLimits(state: WalletEnforcementState): void {
    switch (state.status) {
      case 'clean':
        state.powDifficulty = 1
        state.rateLimit = 100
        break
      case 'warned':
        state.powDifficulty = 2
        state.rateLimit = 50
        break
      case 'restricted':
        state.powDifficulty = 4
        state.rateLimit = 10
        break
      case 'quarantine_only':
        state.powDifficulty = 8
        state.rateLimit = 1
        break
      case 'denied':
        state.powDifficulty = 256
        state.rateLimit = 0
        break
    }
  }

  /**
   * Issue warning without recording violation
   */
  async issueWarning(address: Address, reason: string): Promise<void> {
    const state = this.getState(address)
    state.warningsIssued++

    if (state.warningsIssued >= this.config.warningsBeforeRestriction && state.status === 'clean') {
      state.status = 'warned'
      state.statusChangedAt = Date.now()
    }

    walletStates.set(address, state)

    logger.info('[WalletEnforcement] Warning issued', {
      address,
      reason,
      totalWarnings: state.warningsIssued,
    })
  }

  /**
   * Check if wallet can perform action
   */
  canPerformAction(address: Address, action: 'upload' | 'access' | 'participate'): boolean {
    const state = this.getState(address)

    switch (state.status) {
      case 'denied':
        return false
      case 'quarantine_only':
        return action === 'access' // Can only view, not upload
      case 'restricted':
        return action !== 'participate' // Can upload/access, not participate in governance
      case 'warned':
      case 'clean':
        return true
    }
  }

  /**
   * Get PoW difficulty for wallet
   */
  getPoWDifficulty(address: Address): number {
    return this.getState(address).powDifficulty
  }

  /**
   * Get rate limit for wallet
   */
  getRateLimit(address: Address): number {
    return this.getState(address).rateLimit
  }

  /**
   * Retroactive enforcement: apply ban to all wallets that uploaded matching content
   */
  async retroactiveEnforcement(contentHash: string, affectedWallets: Address[]): Promise<void> {
    for (const address of affectedWallets) {
      await this.recordViolation(address, {
        type: 'csam_distribution',
        severity: 'critical',
        contentHash,
        description: 'Retroactive enforcement: content matched CSAM hash database',
      })
    }

    logger.info('[WalletEnforcement] Retroactive enforcement applied', {
      contentHash: contentHash.slice(0, 16),
      walletsAffected: affectedWallets.length,
    })
  }

  /**
   * Check OFAC sanctions list (stub for now)
   */
  async checkSanctions(address: Address): Promise<boolean> {
    const state = this.getState(address)
    // In production: query OFAC SDN list
    // For now, return stored value
    return state.ofacMatch
  }

  /**
   * Mark wallet as sanctioned
   */
  async markSanctioned(address: Address): Promise<void> {
    const state = this.getState(address)
    state.ofacMatch = true
    state.status = 'denied'
    state.statusChangedAt = Date.now()
    walletStates.set(address, state)

    logger.warn('[WalletEnforcement] Wallet marked as sanctioned', { address })
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number
    byStatus: Record<WalletStatus, number>
    sanctioned: number
  } {
    const byStatus: Record<WalletStatus, number> = {
      clean: 0,
      warned: 0,
      restricted: 0,
      quarantine_only: 0,
      denied: 0,
    }
    let sanctioned = 0

    for (const state of walletStates.values()) {
      byStatus[state.status]++
      if (state.ofacMatch) sanctioned++
    }

    return {
      total: walletStates.size,
      byStatus,
      sanctioned,
    }
  }
}

// Singleton
let instance: WalletEnforcementManager | null = null

export function getWalletEnforcementManager(config?: WalletEnforcementConfig): WalletEnforcementManager {
  if (!instance) {
    instance = new WalletEnforcementManager(config)
  }
  return instance
}


/**
 * Contribution calculation utilities
 *
 * Shared business logic for fair contribution model
 */

import type { Address } from 'viem'
import { type ContributionState, expect } from '../schemas'
import type { VPNServiceContext } from '../types'

/**
 * Default contribution cap multiplier (3x usage)
 */
const CONTRIBUTION_CAP_MULTIPLIER = 3

/**
 * Default contribution period in milliseconds (30 days)
 */
const CONTRIBUTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Get or create contribution state for an address
 */
export function getOrCreateContribution(
  ctx: VPNServiceContext,
  address: Address,
): ContributionState {
  let contribution = ctx.contributions.get(address)

  if (!contribution) {
    const now = Date.now()
    contribution = {
      address,
      bytesUsed: BigInt(0),
      bytesContributed: BigInt(0),
      cap: BigInt(0), // Will be set when first usage occurs
      periodStart: now,
      periodEnd: now + CONTRIBUTION_PERIOD_MS,
    }
    ctx.contributions.set(address, contribution)
  }

  return contribution
}

/**
 * Calculate contribution cap based on usage
 */
export function calculateContributionCap(bytesUsed: bigint): bigint {
  return bytesUsed * BigInt(CONTRIBUTION_CAP_MULTIPLIER)
}

/**
 * Update contribution cap if usage increased
 */
export function updateContributionCap(contribution: ContributionState): void {
  const newCap = calculateContributionCap(contribution.bytesUsed)
  if (newCap > contribution.cap) {
    contribution.cap = newCap
  }
}

/**
 * Get contribution quota remaining
 */
export function getQuotaRemaining(contribution: ContributionState): bigint {
  const remaining = contribution.cap - contribution.bytesContributed
  expect(remaining >= BigInt(0), 'Quota remaining cannot be negative')
  return remaining
}

/**
 * Calculate contribution ratio
 */
export function calculateContributionRatio(
  contribution: ContributionState,
): number {
  if (contribution.bytesUsed === BigInt(0)) {
    return 0
  }
  return Number(contribution.bytesContributed) / Number(contribution.bytesUsed)
}

/**
 * Check if contribution period has expired
 */
export function isContributionPeriodExpired(
  contribution: ContributionState,
): boolean {
  return Date.now() > contribution.periodEnd
}

/**
 * Reset contribution for new period
 */
export function resetContributionPeriod(contribution: ContributionState): void {
  const now = Date.now()
  contribution.bytesUsed = BigInt(0)
  contribution.bytesContributed = BigInt(0)
  contribution.cap = BigInt(0)
  contribution.periodStart = now
  contribution.periodEnd = now + CONTRIBUTION_PERIOD_MS
}

/**
 * Add usage to contribution
 */
export function addUsage(
  contribution: ContributionState,
  bytesUsed: bigint,
): void {
  expect(bytesUsed >= BigInt(0), 'Usage cannot be negative')
  contribution.bytesUsed += bytesUsed
  updateContributionCap(contribution)
}

/**
 * Add contribution
 */
export function addContribution(
  contribution: ContributionState,
  bytesContributed: bigint,
): void {
  expect(bytesContributed >= BigInt(0), 'Contribution cannot be negative')
  contribution.bytesContributed += bytesContributed

  const remaining = getQuotaRemaining(contribution)
  expect(remaining >= BigInt(0), 'Contribution exceeds cap')
}

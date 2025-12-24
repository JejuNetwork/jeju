/** Contribution calculation utilities */

import { expectTrue } from '@jejunetwork/types'
import type { Address } from 'viem'
import type { ContributionState } from '../schemas'
import type { VPNServiceContext } from '../types'

const CONTRIBUTION_CAP_MULTIPLIER = 3
const CONTRIBUTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000

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

export function calculateContributionCap(bytesUsed: bigint): bigint {
  return bytesUsed * BigInt(CONTRIBUTION_CAP_MULTIPLIER)
}

export function updateContributionCap(contribution: ContributionState): void {
  const newCap = calculateContributionCap(contribution.bytesUsed)
  if (newCap > contribution.cap) {
    contribution.cap = newCap
  }
}

export function getQuotaRemaining(contribution: ContributionState): bigint {
  const remaining = contribution.cap - contribution.bytesContributed
  expectTrue(remaining >= BigInt(0), 'Quota remaining cannot be negative')
  return remaining
}

export function calculateContributionRatio(
  contribution: ContributionState,
): number {
  if (contribution.bytesUsed === BigInt(0)) {
    return 0
  }
  return Number(contribution.bytesContributed) / Number(contribution.bytesUsed)
}

export function isContributionPeriodExpired(
  contribution: ContributionState,
): boolean {
  return Date.now() > contribution.periodEnd
}

export function resetContributionPeriod(contribution: ContributionState): void {
  const now = Date.now()
  contribution.bytesUsed = BigInt(0)
  contribution.bytesContributed = BigInt(0)
  contribution.cap = BigInt(0)
  contribution.periodStart = now
  contribution.periodEnd = now + CONTRIBUTION_PERIOD_MS
}

export function addUsage(
  contribution: ContributionState,
  bytesUsed: bigint,
): void {
  expectTrue(bytesUsed >= BigInt(0), 'Usage cannot be negative')
  contribution.bytesUsed += bytesUsed
  updateContributionCap(contribution)
}

export function addContribution(
  contribution: ContributionState,
  bytesContributed: bigint,
): void {
  expectTrue(bytesContributed >= BigInt(0), 'Contribution cannot be negative')
  contribution.bytesContributed += bytesContributed

  // getQuotaRemaining will throw if remaining is negative
  getQuotaRemaining(contribution)
}

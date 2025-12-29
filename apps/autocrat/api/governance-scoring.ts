/**
 * Objective Governance Scoring System
 *
 * Replaces LARP metrics with measurable, outcome-tracked scoring:
 * - Multi-factor weighted decision making (not just vote counting)
 * - Calibrated confidence based on historical accuracy
 * - Objective alignment scoring against DAO charter
 * - Adaptive quality thresholds that learn from outcomes
 *
 * @module governance-scoring
 */

import { z } from 'zod'
import type { AgentVote } from './agents/runtime'

// ============================================================================
// Types
// ============================================================================

export interface ProposalFactors {
  proposalId: string
  daoId: string

  // Board vote analysis (not just counts)
  boardVotes: AgentVote[]
  boardConsensusStrength: number // 0-1: How aligned are the votes?
  boardDissent: string[] // Specific concerns raised

  // Quality metrics (objective)
  structureScore: number // 0-100: Has required sections, clear language
  specificityScore: number // 0-100: Measurable outcomes, deadlines
  feasibilityScore: number // 0-100: Technical/financial viability
  riskScore: number // 0-100: Higher = more risk identified

  // Research findings (verified)
  researchQuality: number // 0-100: Methodology strength
  claimsVerified: number // Count of verifiable claims checked
  claimsValid: number // Count that passed verification
  externalSources: number // Number of independent sources

  // Historical context
  proposerTrackRecord: number // 0-100: Past proposal success rate
  similarProposalOutcomes: number // 0-100: How similar proposals performed
  daoCapacity: number // 0-100: Can DAO execute this given current load?

  // Stake signals (Skin in the game)
  totalStaked: bigint
  uniqueBackers: number
  avgBackerReputation: number
}

export interface DecisionScore {
  // Final decision
  approved: boolean

  // Component scores (all objective, trackable)
  boardScore: number // 0-100: Weighted board recommendation
  qualityScore: number // 0-100: Proposal quality
  feasibilityScore: number // 0-100: Can it be done?
  riskAdjustedScore: number // 0-100: Reward minus risk
  alignmentScore: number // 0-100: Charter alignment (measured)
  confidenceScore: number // 0-100: Calibrated confidence

  // Weighted final score
  finalScore: number // 0-100: The actual decision basis
  threshold: number // Dynamic threshold for this DAO/type

  // Audit trail
  factors: ProposalFactors
  weights: DecisionWeights
  reasoning: string
  decisionBasis: string // Exactly why approved/rejected
}

export interface DecisionWeights {
  board: number
  quality: number
  feasibility: number
  risk: number
  alignment: number
  stake: number
  trackRecord: number
}

export interface OutcomeRecord {
  proposalId: string
  daoId: string
  approved: boolean
  predictedScore: number
  executionStatus:
    | 'pending'
    | 'executing'
    | 'completed'
    | 'failed'
    | 'cancelled'
  actualOutcome?: 'success' | 'partial' | 'failure'
  outcomeScore?: number // 0-100: How well did it achieve stated goals?
  recordedAt: number
  evaluatedAt?: number
}

export interface CalibrationData {
  daoId: string
  totalDecisions: number
  accurateDecisions: number // Prediction matched outcome
  avgPredictedScore: number
  avgActualOutcome: number
  calibrationError: number // Lower = better calibrated
  lastUpdated: number
}

// ============================================================================
// Default Weights (can be tuned per DAO)
// ============================================================================

const DEFAULT_WEIGHTS: DecisionWeights = {
  board: 0.25, // Board votes are advisory, not deterministic
  quality: 0.15, // Proposal structure and clarity
  feasibility: 0.2, // Can it actually be done?
  risk: 0.15, // Risk-adjusted (negative factor)
  alignment: 0.1, // Charter alignment
  stake: 0.05, // Skin in the game signals
  trackRecord: 0.1, // Proposer history
}

const BASE_THRESHOLD = 60 // Default approval threshold
const MIN_THRESHOLD = 40 // Never approve below this
const MAX_THRESHOLD = 80 // Always approve above this (unless blocked)

// ============================================================================
// Board Vote Analysis (Not just counting)
// ============================================================================

/**
 * Analyze board votes with nuance beyond simple approve/reject counts
 */
export function analyzeBoardVotes(votes: AgentVote[]): {
  score: number
  consensusStrength: number
  concerns: string[]
  strongSupport: string[]
  abstentions: string[]
} {
  if (votes.length === 0) {
    return {
      score: 50, // No votes = neutral
      consensusStrength: 0,
      concerns: [],
      strongSupport: [],
      abstentions: [],
    }
  }

  // Weight votes by confidence (high confidence votes matter more)
  let weightedApprove = 0
  let weightedReject = 0
  let totalWeight = 0
  const concerns: string[] = []
  const strongSupport: string[] = []
  const abstentions: string[] = []

  // Role-specific weights (some roles matter more for certain proposals)
  const roleWeights: Record<string, number> = {
    Security: 1.2, // Security concerns should weigh heavily
    Treasury: 1.1, // Financial implications
    Code: 1.0,
    Community: 1.0,
    Legal: 1.1,
  }

  for (const vote of votes) {
    const roleWeight = roleWeights[vote.role] ?? 1.0
    const confWeight = vote.confidence / 100
    const voteWeight = roleWeight * confWeight

    if (vote.vote === 'APPROVE') {
      weightedApprove += voteWeight
      if (vote.confidence >= 80) {
        strongSupport.push(`${vote.role}: ${vote.reasoning.slice(0, 100)}`)
      }
    } else if (vote.vote === 'REJECT') {
      weightedReject += voteWeight
      // Extract concerns from rejections
      concerns.push(`${vote.role}: ${vote.reasoning.slice(0, 200)}`)
    } else {
      abstentions.push(vote.role)
    }
    totalWeight += roleWeight
  }

  // Calculate consensus strength (how unified is the board?)
  const maxVotes = Math.max(weightedApprove, weightedReject)
  const consensusStrength = totalWeight > 0 ? maxVotes / totalWeight : 0

  // Board score: Not just majority, but strength-weighted
  // A 3-2 split with low confidence is different from 5-0 with high confidence
  const baseScore =
    totalWeight > 0
      ? ((weightedApprove - weightedReject) / totalWeight + 1) * 50
      : 50

  // Adjust for consensus strength
  const score = Math.round(
    baseScore * (0.5 + 0.5 * consensusStrength), // Weak consensus = closer to 50
  )

  return {
    score: Math.max(0, Math.min(100, score)),
    consensusStrength,
    concerns,
    strongSupport,
    abstentions,
  }
}

// ============================================================================
// Objective Alignment Scoring
// ============================================================================

const AlignmentCriteriaSchema = z.object({
  missionKeywords: z.array(z.string()),
  prohibitedActions: z.array(z.string()),
  requiredProcesses: z.array(z.string()),
  valueStatements: z.array(z.string()),
})

export type AlignmentCriteria = z.infer<typeof AlignmentCriteriaSchema>

/**
 * Score alignment against DAO charter (objective, keyword-based)
 * NOT "ask LLM how aligned this is" - actually check against criteria
 */
export function scoreAlignment(
  proposalText: string,
  criteria: AlignmentCriteria,
): { score: number; matches: string[]; violations: string[] } {
  const text = proposalText.toLowerCase()
  const matches: string[] = []
  const violations: string[] = []

  // Check mission keyword presence (positive)
  let missionMatches = 0
  for (const keyword of criteria.missionKeywords) {
    if (text.includes(keyword.toLowerCase())) {
      missionMatches++
      matches.push(`Mission: "${keyword}"`)
    }
  }
  const missionScore =
    criteria.missionKeywords.length > 0
      ? (missionMatches / criteria.missionKeywords.length) * 100
      : 50

  // Check for prohibited actions (negative)
  let prohibitedViolations = 0
  for (const prohibited of criteria.prohibitedActions) {
    if (text.includes(prohibited.toLowerCase())) {
      prohibitedViolations++
      violations.push(`Prohibited: "${prohibited}"`)
    }
  }
  const prohibitedPenalty = prohibitedViolations * 20 // Each violation = -20

  // Check required process mentions (positive)
  let processMatches = 0
  for (const process of criteria.requiredProcesses) {
    if (text.includes(process.toLowerCase())) {
      processMatches++
      matches.push(`Process: "${process}"`)
    }
  }
  const processScore =
    criteria.requiredProcesses.length > 0
      ? (processMatches / criteria.requiredProcesses.length) * 100
      : 50

  // Final alignment score
  const baseScore = missionScore * 0.5 + processScore * 0.5
  const score = Math.max(0, Math.min(100, baseScore - prohibitedPenalty))

  return { score: Math.round(score), matches, violations }
}

// ============================================================================
// Calibrated Confidence
// ============================================================================

/**
 * Calculate confidence based on historical calibration
 * NOT self-reported LLM confidence
 */
export function calculateCalibratedConfidence(
  calibration: CalibrationData | null,
  currentFactors: {
    dataCompleteness: number // 0-1: How much data do we have?
    consensusStrength: number // 0-1: Board agreement
    precedentAvailable: boolean // Similar proposals exist?
    riskLevel: number // 0-100: Higher = more uncertain
  },
): number {
  const { dataCompleteness, consensusStrength, precedentAvailable, riskLevel } =
    currentFactors

  // Base confidence from data quality
  let confidence = 50 + dataCompleteness * 30

  // Adjust for consensus (high agreement = more confident)
  confidence += consensusStrength * 15

  // Precedent helps confidence
  if (precedentAvailable) {
    confidence += 10
  }

  // Risk reduces confidence
  confidence -= (riskLevel / 100) * 20

  // Historical calibration adjustment
  if (calibration && calibration.totalDecisions >= 10) {
    // If we've been overconfident, reduce; if underconfident, increase
    const calibrationAdjust =
      (calibration.avgActualOutcome - calibration.avgPredictedScore) / 2
    confidence += calibrationAdjust
  }

  return Math.round(Math.max(20, Math.min(95, confidence)))
}

// ============================================================================
// Adaptive Quality Threshold
// ============================================================================

/**
 * Calculate dynamic approval threshold based on:
 * - Proposal type (higher bar for treasury/code changes)
 * - Historical DAO performance
 * - Current risk level
 */
export function calculateAdaptiveThreshold(
  proposalType: string,
  _daoId: string,
  calibration: CalibrationData | null,
  riskScore: number,
): number {
  // Base threshold by proposal type
  const typeThresholds: Record<string, number> = {
    TREASURY: 70, // Money movements need higher bar
    CODE_CHANGE: 75, // Code changes are risky
    PARAMETER_CHANGE: 65,
    MEMBER_APPLICATION: 55,
    FUNDING: 65,
    OPINION: 45, // Opinions are low-risk
    SUGGESTION: 50,
  }

  let threshold = typeThresholds[proposalType] ?? BASE_THRESHOLD

  // Adjust based on calibration (if we've been approving bad proposals, raise the bar)
  if (calibration && calibration.totalDecisions >= 20) {
    const successRate =
      calibration.accurateDecisions / calibration.totalDecisions
    if (successRate < 0.6) {
      threshold += 10 // Too many failures, be more cautious
    } else if (successRate > 0.85) {
      threshold -= 5 // Very successful, can be slightly less strict
    }
  }

  // Risk adjustment
  threshold += (riskScore / 100) * 15

  return Math.round(Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, threshold)))
}

// ============================================================================
// Main Decision Function
// ============================================================================

/**
 * Make a governance decision based on objective, weighted factors
 */
export function makeObjectiveDecision(
  factors: ProposalFactors,
  charter: AlignmentCriteria,
  calibration: CalibrationData | null,
  proposalText: string,
  weights: DecisionWeights = DEFAULT_WEIGHTS,
): DecisionScore {
  // 1. Board analysis (weighted, not just counting)
  const boardAnalysis = analyzeBoardVotes(factors.boardVotes)

  // 2. Alignment scoring (objective, keyword-based)
  const alignment = scoreAlignment(proposalText, charter)

  // 3. Calibrated confidence
  const confidence = calculateCalibratedConfidence(calibration, {
    dataCompleteness: Math.min(
      1,
      factors.claimsVerified / Math.max(1, factors.claimsVerified + 5),
    ),
    consensusStrength: boardAnalysis.consensusStrength,
    precedentAvailable: factors.similarProposalOutcomes > 0,
    riskLevel: factors.riskScore,
  })

  // 4. Calculate component scores
  const qualityScore = (factors.structureScore + factors.specificityScore) / 2

  // 6. Stake signal (logarithmic - diminishing returns)
  const stakeSignal = Math.min(
    100,
    Math.log10(Number(factors.totalStaked) / 1e18 + 1) * 20 +
      factors.uniqueBackers * 2,
  )

  // 7. Calculate weighted final score
  const riskAdjustedFeasibility =
    factors.feasibilityScore * (1 - factors.riskScore / 200)

  const finalScore = Math.round(
    boardAnalysis.score * weights.board +
      qualityScore * weights.quality +
      riskAdjustedFeasibility * weights.feasibility +
      (100 - factors.riskScore) * weights.risk + // Invert risk (lower risk = higher score)
      alignment.score * weights.alignment +
      stakeSignal * weights.stake +
      factors.proposerTrackRecord * weights.trackRecord,
  )

  // 8. Dynamic threshold
  const threshold = calculateAdaptiveThreshold(
    'GENERAL', // Would come from proposal type
    factors.daoId,
    calibration,
    factors.riskScore,
  )

  // 9. Make decision
  const approved = finalScore >= threshold

  // 10. Generate reasoning based on actual factors (not LLM opinion)
  const reasoning = generateObjectiveReasoning(
    approved,
    finalScore,
    threshold,
    boardAnalysis,
    alignment,
    factors,
  )

  return {
    approved,
    boardScore: boardAnalysis.score,
    qualityScore,
    feasibilityScore: factors.feasibilityScore,
    riskAdjustedScore: Math.round(riskAdjustedFeasibility),
    alignmentScore: alignment.score,
    confidenceScore: confidence,
    finalScore,
    threshold,
    factors,
    weights,
    reasoning,
    decisionBasis: `Score ${finalScore} ${approved ? '≥' : '<'} threshold ${threshold}`,
  }
}

function generateObjectiveReasoning(
  approved: boolean,
  score: number,
  threshold: number,
  board: ReturnType<typeof analyzeBoardVotes>,
  alignment: ReturnType<typeof scoreAlignment>,
  factors: ProposalFactors,
): string {
  const lines: string[] = []

  lines.push(
    `Decision: ${approved ? 'APPROVED' : 'REJECTED'} (${score}/${threshold})`,
  )
  lines.push('')

  // Board summary
  const voteCount = factors.boardVotes.length
  const approves = factors.boardVotes.filter((v) => v.vote === 'APPROVE').length
  lines.push(
    `Board: ${approves}/${voteCount} approve (strength: ${Math.round(board.consensusStrength * 100)}%)`,
  )

  if (board.concerns.length > 0) {
    lines.push(`Concerns: ${board.concerns.slice(0, 2).join('; ')}`)
  }

  // Key factors
  lines.push('')
  lines.push('Key factors:')
  lines.push(`• Quality: ${factors.structureScore}/100`)
  lines.push(`• Feasibility: ${factors.feasibilityScore}/100`)
  lines.push(`• Risk: ${factors.riskScore}/100`)
  lines.push(`• Alignment: ${alignment.score}/100`)

  if (alignment.violations.length > 0) {
    lines.push(`• Alignment violations: ${alignment.violations.join(', ')}`)
  }

  if (factors.claimsVerified > 0) {
    const verifyRate = Math.round(
      (factors.claimsValid / factors.claimsVerified) * 100,
    )
    lines.push(
      `• Claims verified: ${factors.claimsValid}/${factors.claimsVerified} (${verifyRate}%)`,
    )
  }

  return lines.join('\n')
}

// ============================================================================
// Outcome Tracking (for calibration)
// ============================================================================

export function recordOutcome(
  proposalId: string,
  daoId: string,
  approved: boolean,
  predictedScore: number,
): OutcomeRecord {
  return {
    proposalId,
    daoId,
    approved,
    predictedScore,
    executionStatus: 'pending',
    recordedAt: Date.now(),
  }
}

export function updateCalibration(
  current: CalibrationData | null,
  outcome: OutcomeRecord,
): CalibrationData {
  const base = current ?? {
    daoId: outcome.daoId,
    totalDecisions: 0,
    accurateDecisions: 0,
    avgPredictedScore: 0,
    avgActualOutcome: 0,
    calibrationError: 0,
    lastUpdated: 0,
  }

  if (outcome.outcomeScore === undefined) {
    return base // Can't update without outcome
  }

  const newTotal = base.totalDecisions + 1
  const newAvgPredicted =
    (base.avgPredictedScore * base.totalDecisions + outcome.predictedScore) /
    newTotal
  const newAvgActual =
    (base.avgActualOutcome * base.totalDecisions + outcome.outcomeScore) /
    newTotal

  // Was our prediction accurate? (within 20 points of actual)
  const accurate = Math.abs(outcome.predictedScore - outcome.outcomeScore) <= 20

  return {
    daoId: outcome.daoId,
    totalDecisions: newTotal,
    accurateDecisions: base.accurateDecisions + (accurate ? 1 : 0),
    avgPredictedScore: newAvgPredicted,
    avgActualOutcome: newAvgActual,
    calibrationError: Math.abs(newAvgPredicted - newAvgActual),
    lastUpdated: Date.now(),
  }
}

// ============================================================================
// Exports for storage
// ============================================================================

export const ProposalFactorsSchema = z.object({
  proposalId: z.string(),
  daoId: z.string(),
  boardVotes: z.array(
    z.object({
      role: z.string(),
      agentId: z.string(),
      vote: z.enum(['APPROVE', 'REJECT', 'ABSTAIN']),
      reasoning: z.string(),
      confidence: z.number(),
      timestamp: z.number(),
    }),
  ),
  boardConsensusStrength: z.number(),
  boardDissent: z.array(z.string()),
  structureScore: z.number(),
  specificityScore: z.number(),
  feasibilityScore: z.number(),
  riskScore: z.number(),
  researchQuality: z.number(),
  claimsVerified: z.number(),
  claimsValid: z.number(),
  externalSources: z.number(),
  proposerTrackRecord: z.number(),
  similarProposalOutcomes: z.number(),
  daoCapacity: z.number(),
  totalStaked: z.bigint(),
  uniqueBackers: z.number(),
  avgBackerReputation: z.number(),
})

export const DecisionScoreSchema = z.object({
  approved: z.boolean(),
  boardScore: z.number(),
  qualityScore: z.number(),
  feasibilityScore: z.number(),
  riskAdjustedScore: z.number(),
  alignmentScore: z.number(),
  confidenceScore: z.number(),
  finalScore: z.number(),
  threshold: z.number(),
  factors: ProposalFactorsSchema,
  weights: z.object({
    board: z.number(),
    quality: z.number(),
    feasibility: z.number(),
    risk: z.number(),
    alignment: z.number(),
    stake: z.number(),
    trackRecord: z.number(),
  }),
  reasoning: z.string(),
  decisionBasis: z.string(),
})

export const OutcomeRecordSchema = z.object({
  proposalId: z.string(),
  daoId: z.string(),
  approved: z.boolean(),
  predictedScore: z.number(),
  executionStatus: z.enum([
    'pending',
    'executing',
    'completed',
    'failed',
    'cancelled',
  ]),
  actualOutcome: z.enum(['success', 'partial', 'failure']).optional(),
  outcomeScore: z.number().optional(),
  recordedAt: z.number(),
  evaluatedAt: z.number().optional(),
})

export const CalibrationDataSchema = z.object({
  daoId: z.string(),
  totalDecisions: z.number(),
  accurateDecisions: z.number(),
  avgPredictedScore: z.number(),
  avgActualOutcome: z.number(),
  calibrationError: z.number(),
  lastUpdated: z.number(),
})

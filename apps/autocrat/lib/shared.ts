/**
 * Shared constants and utilities for Council
 */

import { expectValid } from '@jejunetwork/types'
import { type Address, type Hex, isAddress, isHex } from 'viem'
import { z } from 'zod'
import { extractLLMContent, LLMCompletionResponseSchema } from './schemas'

/**
 * Type-safe hex string conversion with validation.
 * Throws if the value is not a valid hex string.
 */
export function toHex(value: string): Hex {
  if (!isHex(value)) {
    throw new Error(`Invalid hex string: ${value}`)
  }
  return value
}

/**
 * Type-safe address conversion with validation.
 * Throws for invalid or missing addresses.
 */
export function toAddress(value: string): Address {
  if (!isAddress(value)) {
    throw new Error(`Invalid address: ${value}`)
  }
  return value
}

// ============================================================================
// CQL Row Accessors - Type-safe database row field extraction
// ============================================================================

/**
 * Extract a required string field from a database row.
 * Throws if the field is not a string.
 */
export function rowString(row: Record<string, unknown>, key: string): string {
  const val = row[key]
  if (typeof val !== 'string') throw new Error(`Row ${key} must be a string`)
  return val
}

/**
 * Extract an optional string field from a database row.
 * Returns undefined if the field is not a string.
 */
export function rowOptionalString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = row[key]
  return typeof val === 'string' ? val : undefined
}

/**
 * Extract a required number field from a database row.
 * Throws if the field is not a number.
 */
export function rowNumber(row: Record<string, unknown>, key: string): number {
  const val = row[key]
  if (typeof val !== 'number') throw new Error(`Row ${key} must be a number`)
  return val
}

/**
 * Extract an optional number field from a database row.
 * Returns undefined if the field is not a number.
 */
export function rowOptionalNumber(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const val = row[key]
  return typeof val === 'number' ? val : undefined
}

/**
 * Extract a bigint field from a database row.
 * Parses string values, returns 0n for missing/invalid values.
 */
export function rowBigInt(row: Record<string, unknown>, key: string): bigint {
  const val = row[key]
  return BigInt(typeof val === 'string' ? val : '0')
}

/**
 * Extract a required Address field from a database row.
 * Throws if the field is not a valid address.
 */
export function rowAddress(row: Record<string, unknown>, key: string): Address {
  const val = rowString(row, key)
  return toAddress(val)
}

/**
 * Parse JSON from LLM response that may include markdown code fences
 */
export function parseJson<T>(response: string): T {
  const cleaned = response.replace(/```json\s*/gi, '').replace(/```\s*/g, '')
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in response')
  return JSON.parse(match[0]) as T
}

export const COUNCIL_ABI = [
  'function getProposal(bytes32) view returns (tuple(bytes32, address, uint256, uint8, uint8, uint8, uint256, uint256, uint256, bytes32, address, bytes, uint256, uint256, uint256, uint256, bool, bytes32, bool, bytes32))',
  'function getAutocratVotes(bytes32) view returns (tuple(bytes32, address, uint8, uint8, bytes32, uint256, uint256)[])',
  'function getActiveProposals() view returns (bytes32[])',
  'function getAllProposals() view returns (bytes32[])',
  'function proposalCount() view returns (uint256)',
  'function minQualityScore() view returns (uint8)',
  'function autocratVotingPeriod() view returns (uint256)',
  'function gracePeriod() view returns (uint256)',
] as const

export const CEO_AGENT_ABI = [
  'function getCurrentModel() view returns (tuple(string, string, string, address, uint256, uint256, uint256, bool, uint256, uint256, uint256))',
  'function getCEOStats() view returns (string, uint256, uint256, uint256, uint256, uint256)',
  'function getDecision(bytes32) view returns (tuple(bytes32, string, bool, bytes32, bytes32, bytes32, uint256, uint256, uint256, bool, bool))',
  'function getAllModels() view returns (string[])',
  'function getModel(string) view returns (tuple(string, string, string, address, uint256, uint256, uint256, bool, uint256, uint256, uint256))',
  'function getRecentDecisions(uint256) view returns (bytes32[])',
] as const

export const PROPOSAL_STATUS = [
  'SUBMITTED',
  'AUTOCRAT_REVIEW',
  'RESEARCH_PENDING',
  'AUTOCRAT_FINAL',
  'CEO_QUEUE',
  'APPROVED',
  'EXECUTING',
  'COMPLETED',
  'REJECTED',
  'VETOED',
  'DUPLICATE',
  'SPAM',
] as const
export const PROPOSAL_TYPES = [
  'PARAMETER_CHANGE',
  'TREASURY_ALLOCATION',
  'CODE_UPGRADE',
  'HIRE_CONTRACTOR',
  'FIRE_CONTRACTOR',
  'BOUNTY',
  'GRANT',
  'PARTNERSHIP',
  'POLICY',
  'EMERGENCY',
] as const
export const VOTE_TYPES = [
  'APPROVE',
  'REJECT',
  'ABSTAIN',
  'REQUEST_CHANGES',
] as const
export const AUTOCRAT_ROLES = [
  'TREASURY',
  'CODE',
  'COMMUNITY',
  'SECURITY',
] as const

export function getProposalStatus(
  index: number,
): (typeof PROPOSAL_STATUS)[number] {
  const status = PROPOSAL_STATUS[index]
  if (!status) throw new Error(`Invalid proposal status index: ${index}`)
  return status
}
export function getProposalType(
  index: number,
): (typeof PROPOSAL_TYPES)[number] {
  const type = PROPOSAL_TYPES[index]
  if (!type) throw new Error(`Invalid proposal type index: ${index}`)
  return type
}
export function getVoteType(index: number): (typeof VOTE_TYPES)[number] {
  const type = VOTE_TYPES[index]
  if (!type) throw new Error(`Invalid vote type index: ${index}`)
  return type
}
export function getAutocratRole(
  index: number,
): (typeof AUTOCRAT_ROLES)[number] {
  const role = AUTOCRAT_ROLES[index]
  if (!role) throw new Error(`Invalid autocrat role index: ${index}`)
  return role
}

export interface ProposalFromContract {
  proposalId: `0x${string}`
  proposer: `0x${string}`
  proposerAgentId: bigint
  proposalType: number
  status: number
  qualityScore: number
  createdAt: bigint
  autocratVoteEnd: bigint
  gracePeriodEnd: bigint
  contentHash: `0x${string}`
  targetContract: `0x${string}`
  callData: `0x${string}`
  value: bigint
  totalStaked: bigint
  totalReputation: bigint
  backerCount: bigint
  hasResearch: boolean
  researchHash: `0x${string}`
  ceoApproved: boolean
  ceoDecisionHash: `0x${string}`
}

export interface AutocratVoteFromContract {
  proposalId: `0x${string}`
  councilAgent: `0x${string}`
  role: number
  vote: number
  reasoningHash: `0x${string}`
  votedAt: bigint
  weight: bigint
}

export interface ModelFromContract {
  modelId: string
  modelName: string
  provider: string
  nominatedBy: string
  totalStaked: bigint
  totalReputation: bigint
  nominatedAt: bigint
  isActive: boolean
  decisionsCount: bigint
  approvedDecisions: bigint
  benchmarkScore: bigint
}

export interface DecisionFromContract {
  proposalId: string
  modelId: string
  approved: boolean
  decisionHash: string
  encryptedHash: string
  contextHash: string
  decidedAt: bigint
  confidenceScore: bigint
  alignmentScore: bigint
  disputed: boolean
  overridden: boolean
}

export interface CEOStatsFromContract {
  currentModelId: string
  totalDecisions: bigint
  approvedDecisions: bigint
  overriddenDecisions: bigint
  approvalRate: bigint
  overrideRate: bigint
}

// Heuristic assessment (fallback only - use AI assessment when available)
export function assessClarity(
  title: string | undefined,
  summary: string | undefined,
  description: string | undefined,
): number {
  if (!title || !summary || !description) return 20
  let score = 40
  if (title.length >= 10 && title.length <= 100) score += 20
  if (summary.length >= 50 && summary.length <= 500) score += 20
  if (description.length >= 200) score += 20
  return Math.min(100, score)
}

export function assessCompleteness(description: string | undefined): number {
  if (!description || description.length < 100) return 20
  let score = 30
  for (const section of [
    'problem',
    'solution',
    'implementation',
    'timeline',
    'cost',
    'benefit',
  ]) {
    if (description.toLowerCase().includes(section)) score += 12
  }
  return Math.min(100, score)
}

export function assessFeasibility(description: string | undefined): number {
  if (!description || description.length < 200) return 30
  let score = 50
  if (description.toLowerCase().includes('timeline')) score += 15
  if (description.toLowerCase().includes('resource')) score += 15
  if (description.length > 500) score += 20
  return Math.min(100, score)
}

export function assessAlignment(description: string | undefined): number {
  if (!description) return 30
  let score = 40
  for (const value of [
    'growth',
    'open source',
    'decentralized',
    'community',
    'member benefit',
  ]) {
    if (description.toLowerCase().includes(value)) score += 12
  }
  return Math.min(100, score)
}

export function assessImpact(description: string | undefined): number {
  if (!description || description.length < 100) return 30
  let score = 40
  if (description.toLowerCase().includes('impact')) score += 20
  if (
    description.toLowerCase().includes('metric') ||
    description.toLowerCase().includes('kpi')
  )
    score += 20
  if (description.length > 400) score += 20
  return Math.min(100, score)
}

export function assessRisk(description: string | undefined): number {
  if (!description) return 20
  let score = 30
  if (description.toLowerCase().includes('risk')) score += 25
  if (description.toLowerCase().includes('mitigation')) score += 25
  if (description.toLowerCase().includes('security')) score += 20
  return Math.min(100, score)
}

export function assessCostBenefit(description: string | undefined): number {
  if (!description) return 30
  let score = 40
  if (description.toLowerCase().includes('cost')) score += 20
  if (description.toLowerCase().includes('budget')) score += 20
  if (
    description.toLowerCase().includes('roi') ||
    description.toLowerCase().includes('return')
  )
    score += 20
  return Math.min(100, score)
}

export interface QualityCriteria {
  clarity: number
  completeness: number
  feasibility: number
  alignment: number
  impact: number
  riskAssessment: number
  costBenefit: number
}

// Schema for AI assessment JSON response
const AIAssessmentResponseSchema = z.object({
  clarity: z.number().min(0).max(100),
  completeness: z.number().min(0).max(100),
  feasibility: z.number().min(0).max(100),
  alignment: z.number().min(0).max(100),
  impact: z.number().min(0).max(100),
  riskAssessment: z.number().min(0).max(100),
  costBenefit: z.number().min(0).max(100),
  feedback: z.array(z.string()),
  blockers: z.array(z.string()),
  suggestions: z.array(z.string()),
})

export function calculateQualityScore(criteria: QualityCriteria): number {
  return Math.round(
    criteria.clarity * 0.15 +
      criteria.completeness * 0.15 +
      criteria.feasibility * 0.15 +
      criteria.alignment * 0.15 +
      criteria.impact * 0.15 +
      criteria.riskAssessment * 0.15 +
      criteria.costBenefit * 0.1,
  )
}

export interface AIAssessmentResult {
  overallScore: number
  criteria: QualityCriteria
  feedback: string[]
  blockers: string[]
  suggestions: string[]
}

export async function assessProposalWithAI(
  title: string,
  summary: string,
  description: string,
  cloudEndpoint: string,
  apiKey?: string,
): Promise<AIAssessmentResult> {
  const prompt = `Assess this DAO proposal. Return JSON with scores 0-100.

Title: ${title}
Summary: ${summary}
Description: ${description}

Return ONLY valid JSON:
{"clarity":N,"completeness":N,"feasibility":N,"alignment":N,"impact":N,"riskAssessment":N,"costBenefit":N,"feedback":[],"blockers":[],"suggestions":[]}`

  const response = await fetch(`${cloudEndpoint}/api/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    }),
  })

  if (!response.ok) throw new Error(`AI assessment failed: ${response.status}`)

  const data = expectValid(
    LLMCompletionResponseSchema,
    await response.json(),
    'AI assessment response',
  )
  const content = extractLLMContent(data, 'AI assessment')

  const rawParsed = JSON.parse(content)
  const parsed = AIAssessmentResponseSchema.parse(rawParsed)

  return {
    overallScore: calculateQualityScore(parsed),
    criteria: {
      clarity: parsed.clarity,
      completeness: parsed.completeness,
      feasibility: parsed.feasibility,
      alignment: parsed.alignment,
      impact: parsed.impact,
      riskAssessment: parsed.riskAssessment,
      costBenefit: parsed.costBenefit,
    },
    feedback: parsed.feedback,
    blockers: parsed.blockers,
    suggestions: parsed.suggestions,
  }
}

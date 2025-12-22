/**
 * Shared constants and utilities for Council
 */

import { z } from 'zod';

export const COUNCIL_ABI = [
  'function getProposal(bytes32) view returns (tuple(bytes32, address, uint256, uint8, uint8, uint8, uint256, uint256, uint256, bytes32, address, bytes, uint256, uint256, uint256, uint256, bool, bytes32, bool, bytes32))',
  'function getAutocratVotes(bytes32) view returns (tuple(bytes32, address, uint8, uint8, bytes32, uint256, uint256)[])',
  'function getActiveProposals() view returns (bytes32[])',
  'function getAllProposals() view returns (bytes32[])',
  'function proposalCount() view returns (uint256)',
  'function minQualityScore() view returns (uint8)',
  'function autocratVotingPeriod() view returns (uint256)',
  'function gracePeriod() view returns (uint256)',
] as const;

export const CEO_AGENT_ABI = [
  'function getCurrentModel() view returns (tuple(string, string, string, address, uint256, uint256, uint256, bool, uint256, uint256, uint256))',
  'function getCEOStats() view returns (string, uint256, uint256, uint256, uint256, uint256)',
  'function getDecision(bytes32) view returns (tuple(bytes32, string, bool, bytes32, bytes32, bytes32, uint256, uint256, uint256, bool, bool))',
  'function getAllModels() view returns (string[])',
  'function getModel(string) view returns (tuple(string, string, string, address, uint256, uint256, uint256, bool, uint256, uint256, uint256))',
  'function getRecentDecisions(uint256) view returns (bytes32[])',
] as const;

export const PROPOSAL_STATUS = ['SUBMITTED', 'AUTOCRAT_REVIEW', 'RESEARCH_PENDING', 'AUTOCRAT_FINAL', 'CEO_QUEUE', 'APPROVED', 'EXECUTING', 'COMPLETED', 'REJECTED', 'VETOED', 'DUPLICATE', 'SPAM'] as const;
export const PROPOSAL_TYPES = ['PARAMETER_CHANGE', 'TREASURY_ALLOCATION', 'CODE_UPGRADE', 'HIRE_CONTRACTOR', 'FIRE_CONTRACTOR', 'BOUNTY', 'GRANT', 'PARTNERSHIP', 'POLICY', 'EMERGENCY'] as const;
export const VOTE_TYPES = ['APPROVE', 'REJECT', 'ABSTAIN', 'REQUEST_CHANGES'] as const;
export const AUTOCRAT_ROLES = ['TREASURY', 'CODE', 'COMMUNITY', 'SECURITY'] as const;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function getProposalStatus(index: number): string { return PROPOSAL_STATUS[index] ?? 'UNKNOWN'; }
export function getProposalType(index: number): string { return PROPOSAL_TYPES[index] ?? 'UNKNOWN'; }
export function getVoteType(index: number): string { return VOTE_TYPES[index] ?? 'UNKNOWN'; }
export function getAutocratRole(index: number): string { return AUTOCRAT_ROLES[index] ?? 'UNKNOWN'; }

export interface ProposalFromContract {
  proposalId: string;
  proposer: string;
  proposerAgentId: bigint;
  proposalType: number;
  status: number;
  qualityScore: number;
  createdAt: bigint;
  autocratVoteEnd: bigint;
  gracePeriodEnd: bigint;
  contentHash: string;
  targetContract: string;
  callData: string;
  value: bigint;
  totalStaked: bigint;
  totalReputation: bigint;
  backerCount: bigint;
  hasResearch: boolean;
  researchHash: string;
  ceoApproved: boolean;
  ceoDecisionHash: string;
}

export interface AutocratVoteFromContract {
  proposalId: string;
  councilAgent: string;
  role: number;
  vote: number;
  reasoningHash: string;
  votedAt: bigint;
  weight: bigint;
}

export interface ModelFromContract {
  modelId: string;
  modelName: string;
  provider: string;
  nominatedBy: string;
  totalStaked: bigint;
  totalReputation: bigint;
  nominatedAt: bigint;
  isActive: boolean;
  decisionsCount: bigint;
  approvedDecisions: bigint;
  benchmarkScore: bigint;
}

export interface DecisionFromContract {
  proposalId: string;
  modelId: string;
  approved: boolean;
  decisionHash: string;
  encryptedHash: string;
  contextHash: string;
  decidedAt: bigint;
  confidenceScore: bigint;
  alignmentScore: bigint;
  disputed: boolean;
  overridden: boolean;
}

export interface CEOStatsFromContract {
  currentModelId: string;
  totalDecisions: bigint;
  approvedDecisions: bigint;
  overriddenDecisions: bigint;
  approvalRate: bigint;
  overrideRate: bigint;
}

// Heuristic assessment (fallback only - use AI assessment when available)
export function assessClarity(title: string | undefined, summary: string | undefined, description: string | undefined): number {
  if (!title || !summary || !description) return 20;
  let score = 40;
  if (title.length >= 10 && title.length <= 100) score += 20;
  if (summary.length >= 50 && summary.length <= 500) score += 20;
  if (description.length >= 200) score += 20;
  return Math.min(100, score);
}

export function assessCompleteness(description: string | undefined): number {
  if (!description || description.length < 100) return 20;
  let score = 30;
  for (const section of ['problem', 'solution', 'implementation', 'timeline', 'cost', 'benefit']) {
    if (description.toLowerCase().includes(section)) score += 12;
  }
  return Math.min(100, score);
}

export function assessFeasibility(description: string | undefined): number {
  if (!description || description.length < 200) return 30;
  let score = 50;
  if (description.toLowerCase().includes('timeline')) score += 15;
  if (description.toLowerCase().includes('resource')) score += 15;
  if (description.length > 500) score += 20;
  return Math.min(100, score);
}

export function assessAlignment(description: string | undefined): number {
  if (!description) return 30;
  let score = 40;
  for (const value of ['growth', 'open source', 'decentralized', 'community', 'member benefit']) {
    if (description.toLowerCase().includes(value)) score += 12;
  }
  return Math.min(100, score);
}

export function assessImpact(description: string | undefined): number {
  if (!description || description.length < 100) return 30;
  let score = 40;
  if (description.toLowerCase().includes('impact')) score += 20;
  if (description.toLowerCase().includes('metric') || description.toLowerCase().includes('kpi')) score += 20;
  if (description.length > 400) score += 20;
  return Math.min(100, score);
}

export function assessRisk(description: string | undefined): number {
  if (!description) return 20;
  let score = 30;
  if (description.toLowerCase().includes('risk')) score += 25;
  if (description.toLowerCase().includes('mitigation')) score += 25;
  if (description.toLowerCase().includes('security')) score += 20;
  return Math.min(100, score);
}

export function assessCostBenefit(description: string | undefined): number {
  if (!description) return 30;
  let score = 40;
  if (description.toLowerCase().includes('cost')) score += 20;
  if (description.toLowerCase().includes('budget')) score += 20;
  if (description.toLowerCase().includes('roi') || description.toLowerCase().includes('return')) score += 20;
  return Math.min(100, score);
}

export interface QualityCriteria {
  clarity: number;
  completeness: number;
  feasibility: number;
  alignment: number;
  impact: number;
  riskAssessment: number;
  costBenefit: number;
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
});

export function calculateQualityScore(criteria: QualityCriteria): number {
  return Math.round(
    criteria.clarity * 0.15 +
    criteria.completeness * 0.15 +
    criteria.feasibility * 0.15 +
    criteria.alignment * 0.15 +
    criteria.impact * 0.15 +
    criteria.riskAssessment * 0.15 +
    criteria.costBenefit * 0.10
  );
}

export interface AIAssessmentResult {
  overallScore: number;
  criteria: QualityCriteria;
  feedback: string[];
  blockers: string[];
  suggestions: string[];
}

export async function assessProposalWithAI(title: string, summary: string, description: string, cloudEndpoint: string, apiKey?: string): Promise<AIAssessmentResult> {
  const prompt = `Assess this DAO proposal. Return JSON with scores 0-100.

Title: ${title}
Summary: ${summary}
Description: ${description}

Return ONLY valid JSON:
{"clarity":N,"completeness":N,"feasibility":N,"alignment":N,"impact":N,"riskAssessment":N,"costBenefit":N,"feedback":[],"blockers":[],"suggestions":[]}`;

  const response = await fetch(`${cloudEndpoint}/api/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 500 }),
  });

  if (!response.ok) throw new Error(`AI assessment failed: ${response.status}`);

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error('AI assessment returned no choices');
  }
  const firstChoice = data.choices[0];
  if (!firstChoice.message || typeof firstChoice.message.content !== 'string') {
    throw new Error('AI assessment response missing message content');
  }
  const content = firstChoice.message.content;
  if (content.length === 0) {
    throw new Error('AI assessment returned empty content');
  }
  
  const rawParsed = JSON.parse(content);
  const parsed = AIAssessmentResponseSchema.parse(rawParsed);

  return {
    overallScore: calculateQualityScore(parsed),
    criteria: { clarity: parsed.clarity, completeness: parsed.completeness, feasibility: parsed.feasibility, alignment: parsed.alignment, impact: parsed.impact, riskAssessment: parsed.riskAssessment, costBenefit: parsed.costBenefit },
    feedback: parsed.feedback,
    blockers: parsed.blockers,
    suggestions: parsed.suggestions,
  };
}

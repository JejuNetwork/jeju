/**
 * Shared constants and utilities for Council servers
 */

// Contract ABIs
export const COUNCIL_ABI = [
  'function getProposal(bytes32) view returns (tuple(bytes32 proposalId, address proposer, uint256 proposerAgentId, uint8 proposalType, uint8 status, uint8 qualityScore, uint256 createdAt, uint256 councilVoteEnd, uint256 gracePeriodEnd, bytes32 contentHash, address targetContract, bytes callData, uint256 value, uint256 totalStaked, uint256 totalReputation, uint256 backerCount, bool hasResearch, bytes32 researchHash, bool ceoApproved, bytes32 ceoDecisionHash))',
  'function getCouncilVotes(bytes32) view returns (tuple(bytes32 proposalId, address councilAgent, uint8 role, uint8 vote, bytes32 reasoningHash, uint256 votedAt, uint256 weight)[])',
  'function getActiveProposals() view returns (bytes32[])',
  'function getAllProposals() view returns (bytes32[])',
  'function proposalCount() view returns (uint256)',
  'function minQualityScore() view returns (uint8)',
  'function councilVotingPeriod() view returns (uint256)',
  'function gracePeriod() view returns (uint256)',
] as const;

export const CEO_AGENT_ABI = [
  'function getCurrentModel() view returns (tuple(string modelId, string modelName, string provider, address nominatedBy, uint256 totalStaked, uint256 totalReputation, uint256 nominatedAt, bool isActive, uint256 decisionsCount, uint256 approvedDecisions, uint256 benchmarkScore))',
  'function getCEOStats() view returns (string currentModelId, uint256 totalDecisions, uint256 approvedDecisions, uint256 overriddenDecisions, uint256 approvalRate, uint256 overrideRate)',
  'function getDecision(bytes32) view returns (tuple(bytes32 proposalId, string modelId, bool approved, bytes32 decisionHash, bytes32 encryptedHash, bytes32 contextHash, uint256 decidedAt, uint256 confidenceScore, uint256 alignmentScore, bool disputed, bool overridden))',
  'function getAllModels() view returns (string[])',
] as const;

// Status and type enums as arrays for index-based lookup
export const PROPOSAL_STATUS = [
  'SUBMITTED', 'COUNCIL_REVIEW', 'RESEARCH_PENDING', 'COUNCIL_FINAL',
  'CEO_QUEUE', 'APPROVED', 'EXECUTING', 'COMPLETED', 'REJECTED',
  'VETOED', 'DUPLICATE', 'SPAM'
] as const;

export const PROPOSAL_TYPES = [
  'PARAMETER_CHANGE', 'TREASURY_ALLOCATION', 'CODE_UPGRADE',
  'HIRE_CONTRACTOR', 'FIRE_CONTRACTOR', 'BOUNTY', 'GRANT',
  'PARTNERSHIP', 'POLICY', 'EMERGENCY'
] as const;

export const VOTE_TYPES = ['APPROVE', 'REJECT', 'ABSTAIN', 'REQUEST_CHANGES'] as const;
export const COUNCIL_ROLES = ['TREASURY', 'CODE', 'COMMUNITY', 'SECURITY'] as const;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Type guards for safe array access
export function getProposalStatus(index: number): string {
  return PROPOSAL_STATUS[index] ?? 'UNKNOWN';
}

export function getProposalType(index: number): string {
  return PROPOSAL_TYPES[index] ?? 'UNKNOWN';
}

export function getVoteType(index: number): string {
  return VOTE_TYPES[index] ?? 'UNKNOWN';
}

export function getCouncilRole(index: number): string {
  return COUNCIL_ROLES[index] ?? 'UNKNOWN';
}

// Contract response types
export interface ProposalFromContract {
  proposalId: string;
  proposer: string;
  proposerAgentId: bigint;
  proposalType: number;
  status: number;
  qualityScore: number;
  createdAt: bigint;
  councilVoteEnd: bigint;
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

export interface CouncilVoteFromContract {
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

// Quality assessment - heuristic fallback when AI not available
// NOTE: For production, use assessProposalWithAI() which calls real inference
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
  const sections = ['problem', 'solution', 'implementation', 'timeline', 'cost', 'benefit'];
  for (const section of sections) {
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
  const values = ['growth', 'open source', 'decentralized', 'community', 'member benefit'];
  for (const value of values) {
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

// AI-based assessment (production)
export interface AIAssessmentResult {
  overallScore: number;
  criteria: QualityCriteria;
  feedback: string[];
  blockers: string[];
  suggestions: string[];
}

export async function assessProposalWithAI(
  title: string,
  summary: string,
  description: string,
  cloudEndpoint: string,
  apiKey?: string
): Promise<AIAssessmentResult> {
  const prompt = `Assess this DAO proposal. Return JSON with scores 0-100.

Title: ${title}
Summary: ${summary}
Description: ${description}

Return ONLY valid JSON:
{
  "clarity": <score>,
  "completeness": <score>,
  "feasibility": <score>,
  "alignment": <score>,
  "impact": <score>,
  "riskAssessment": <score>,
  "costBenefit": <score>,
  "feedback": ["..."],
  "blockers": ["..."],
  "suggestions": ["..."]
}`;

  const response = await fetch(`${cloudEndpoint}/api/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI assessment failed: ${response.status}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message.content ?? '{}';
  const parsed = JSON.parse(content) as {
    clarity: number;
    completeness: number;
    feasibility: number;
    alignment: number;
    impact: number;
    riskAssessment: number;
    costBenefit: number;
    feedback: string[];
    blockers: string[];
    suggestions: string[];
  };

  const criteria = {
    clarity: parsed.clarity,
    completeness: parsed.completeness,
    feasibility: parsed.feasibility,
    alignment: parsed.alignment,
    impact: parsed.impact,
    riskAssessment: parsed.riskAssessment,
    costBenefit: parsed.costBenefit,
  };

  return {
    overallScore: calculateQualityScore(criteria),
    criteria,
    feedback: parsed.feedback,
    blockers: parsed.blockers,
    suggestions: parsed.suggestions,
  };
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

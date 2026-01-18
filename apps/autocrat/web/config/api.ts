// @ts-nocheck - Eden Treaty type inference issues with complex Elysia app types
// TODO: Fix by either simplifying App type or using explicit API types
import { api, extractData, extractDataOrDefault } from '../lib/client'
import { AUTOCRAT_API_URL } from './env'

const API_BASE = AUTOCRAT_API_URL

// A2A Protocol (JSON-RPC) - Typed A2A Client

type A2AData =
  | string
  | number
  | boolean
  | null
  | A2AData[]
  | { [key: string]: A2AData }

interface A2APart {
  kind: 'text' | 'data'
  text?: string
  data?: A2AData
}

interface A2AJsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: {
    parts?: A2APart[]
  }
  error?: {
    code: number
    message: string
  }
}

interface A2AResult<T> {
  message: string
  data: T
}

async function callA2A<T>(
  skillId: string,
  params: Record<string, A2AData> = {},
): Promise<A2AResult<T>> {
  const response = await fetch(`${API_BASE}/a2a`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'message/send',
      params: {
        message: {
          messageId: `web-${Date.now()}`,
          parts: [
            {
              kind: 'data',
              data: { skillId, params },
            },
          ],
        },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(
      `A2A request failed: ${response.status} ${response.statusText}`,
    )
  }

  const json: A2AJsonRpcResponse = await response.json()

  if (json.error) {
    throw new Error(json.error.message)
  }

  const parts = json.result?.parts
  if (!parts || parts.length === 0) {
    throw new Error('A2A response contains no parts')
  }

  const dataPart = parts.find((p) => p.kind === 'data')
  const textPart = parts.find((p) => p.kind === 'text')

  if (!dataPart || dataPart.kind !== 'data' || !dataPart.data) {
    throw new Error('A2A response contains no data part')
  }

  return {
    message: textPart?.text ?? '',
    data: dataPart.data as T,
  }
}

export interface Proposal {
  proposalId: string
  proposer: string
  proposalType: string
  status: string
  qualityScore: number
  createdAt: string
  totalStaked?: string
  backerCount?: string
  hasResearch?: boolean
  directorApproved?: boolean
}

export interface ProposalList {
  total: number
  proposals: Proposal[]
}

export interface DirectorStatus {
  currentModel: {
    modelId: string
    name: string
    provider: string
    totalStaked?: string
    benchmarkScore?: string
  }
  stats: {
    totalDecisions: string
    approvedDecisions: string
    overriddenDecisions: string
    approvalRate: string
    overrideRate: string
  }
  decisionsThisPeriod?: number
}

export interface GovernanceStats {
  totalProposals: string
  director: {
    model: string
    decisions: string
    approvalRate: string
  }
  parameters: {
    minQualityScore: string
    autocratVotingPeriod: string
    gracePeriod: string
  }
}

export interface QualityAssessment {
  overallScore: number
  criteria: {
    clarity: number
    completeness: number
    feasibility: number
    alignment: number
    impact: number
    riskAssessment: number
    costBenefit: number
  }
  feedback: string[]
  suggestions: string[]
  blockers: string[]
  readyToSubmit: boolean
  minRequired: number
}

export interface AutocratAgent {
  role: string
  index: number
  description: string
}

export interface AutocratStatus {
  agents: AutocratAgent[]
  votingPeriod: string
  gracePeriod: string
}

export interface ProposalDraft {
  daoId?: string
  title: string
  summary: string
  description: string
  proposalType: number
  casualCategory?: string
  targetContract?: `0x${string}`
  calldata?: `0x${string}`
  value?: string
  tags?: string[]
  linkedPackageId?: string
  linkedRepoId?: string
}

export interface SimilarProposal {
  proposalId: string
  title: string
  similarity: number
  status: string
  reason: string
}

export interface FullQualityAssessment extends QualityAssessment {
  similarProposals: SimilarProposal[]
  assessedAt: number
  model: string
}

export interface QuickScoreResult {
  score: number
  contentHash: string
  readyForFullAssessment: boolean
}

export interface BountySubmissionsResponse {
  submissions: BountySubmission[]
  total: number
}

export interface ImprovedTextResponse {
  improved: string
}

export interface ModelCandidate {
  modelId: string
  modelName: string
  provider: string
  totalStaked: string
  totalReputation: string
  benchmarkScore: number
  decisionsCount: number
  isActive: boolean
}

export interface Decision {
  decisionId: string
  proposalId: string
  approved: boolean
  confidenceScore: number
  alignmentScore: number
  decidedAt: number
  disputed: boolean
  overridden: boolean
}

export interface ResearchRequest {
  proposalId: string
  title: string
  description: string
  proposalType?: string
  references?: string[]
  depth?: 'quick' | 'standard' | 'deep'
  daoId?: string
  daoName?: string
}

export interface ResearchSection {
  title: string
  content: string
  sources: string[]
  confidence: number
}

export interface ResearchReport {
  proposalId: string
  researcher: string
  model: string
  executionTime: number
  sections: ResearchSection[]
  recommendation: 'proceed' | 'reject' | 'modify'
  confidenceLevel: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  keyFindings: string[]
  concerns: string[]
  alternatives: string[]
  ipfsHash: string
}

export interface QuickScreenResult {
  recommendation: 'proceed' | 'reject' | 'needs_full_research'
  confidence: number
  redFlags: string[]
  greenFlags: string[]
}

export interface OrchestratorStatus {
  running: boolean
  cycleCount: number
  lastCycle?: number
  processedProposals?: number
  message?: string
}

// Bug Bounty Types
export interface BountySubmission {
  submissionId: string
  title: string
  severity: number
  vulnType: number
  status: number
  submittedAt: number
  researcher: string
  stake: string
  rewardAmount: string
  guardianApprovals: number
  guardianRejections: number
}

export interface BountyStats {
  totalPool: string
  totalPaidOut: string
  pendingPayouts: string
  activeSubmissions: number
  guardianCount: number
}

export interface BountyAssessment {
  severity: number
  estimatedReward: { min: number; max: number; currency: string }
  qualityScore: number
  issues: string[]
  readyToSubmit: boolean
}

export interface BountySubmissionDraft {
  title: string
  summary: string
  description: string
  severity: number
  vulnType: number
  affectedComponents: string[]
  stepsToReproduce: string[]
  proofOfConcept?: string
  suggestedFix?: string
  impact?: string
}

export async function fetchHealth() {
  const response = await api.health.get()
  return extractData(response)
}

/** Partial proposal data from API response */
interface ProposalApiData {
  proposalId?: string
  proposer?: string
  proposalType?: string
  status?: string
  qualityScore?: number
  createdAt?: string
  totalStaked?: string
  backerCount?: string
  hasResearch?: boolean
  directorApproved?: boolean
}

/** API response for proposal list */
interface ProposalListApiResponse {
  proposals?: ProposalApiData[]
  total?: number
}

export async function fetchProposals(
  activeOnly = false,
): Promise<ProposalList> {
  const response = await api.api.v1.proposals.get({
    query: { active: activeOnly ? 'true' : undefined },
  })
  if (response.error || !response.data) {
    return { proposals: [], total: 0 }
  }
  // Eden Treaty infers generic Record type - validate structure matches ProposalList
  const data = response.data as ProposalListApiResponse
  return {
    proposals: (data.proposals ?? []).map((p) => ({
      proposalId: p.proposalId ?? '',
      proposer: p.proposer ?? '',
      proposalType: p.proposalType ?? '',
      status: p.status ?? '',
      qualityScore: p.qualityScore ?? 0,
      createdAt: p.createdAt ?? '',
      totalStaked: p.totalStaked,
      backerCount: p.backerCount,
      hasResearch: p.hasResearch,
      directorApproved: p.directorApproved,
    })),
    total: data.total ?? 0,
  }
}

export async function fetchProposal(proposalId: string): Promise<Proposal> {
  const response = await api.api.v1.proposals({ id: proposalId }).get()
  if (response.error || !response.data) {
    throw new Error('Proposal not found')
  }
  // Eden Treaty infers generic Record type - validate structure matches Proposal
  const data = response.data as ProposalApiData
  return {
    proposalId: data.proposalId ?? '',
    proposer: data.proposer ?? '',
    proposalType: data.proposalType ?? '',
    status: data.status ?? '',
    qualityScore: data.qualityScore ?? 0,
    createdAt: data.createdAt ?? '',
    totalStaked: data.totalStaked,
    backerCount: data.backerCount,
    hasResearch: data.hasResearch,
    directorApproved: data.directorApproved,
  }
}

export async function assessProposal(params: {
  title: string
  summary: string
  description: string
  proposalType: string
}): Promise<QualityAssessment> {
  const result = await callA2A<QualityAssessment>('assess-proposal', params)
  return result.data
}

type SubmitProposalResult = {
  success: boolean
  proposalId?: string
  txHash?: string
  error?: string
}

export async function prepareSubmitProposal(params: {
  proposalType: number
  qualityScore: number
  contentHash: string
  targetContract?: string
  callData?: string
  value?: string
}): Promise<SubmitProposalResult> {
  const result = await callA2A<SubmitProposalResult>('submit-proposal', params)
  return result.data
}

/** API response for quality assessment */
interface QualityAssessmentApiResponse {
  overallScore?: number
  criteria?: {
    clarity?: number
    completeness?: number
    feasibility?: number
    alignment?: number
    impact?: number
    riskAssessment?: number
    costBenefit?: number
  }
  feedback?: string[]
  suggestions?: string[]
  blockers?: string[]
  readyToSubmit?: boolean
  minRequired?: number
}

export async function assessProposalFull(
  draft: ProposalDraft,
): Promise<FullQualityAssessment> {
  const response = await api.api.v1.proposals.assess.post({
    daoId: draft.daoId ?? 'jeju',
    title: draft.title,
    summary: draft.summary,
    description: draft.description,
    proposalType: draft.proposalType,
    casualCategory: draft.casualCategory,
    targetContract: draft.targetContract,
    calldata: draft.calldata,
    value: draft.value,
    tags: draft.tags,
    linkedPackageId: draft.linkedPackageId,
    linkedRepoId: draft.linkedRepoId,
  })
  // Validate structure matches QualityAssessment
  const data = extractData(response) as QualityAssessmentApiResponse
  const criteria = data.criteria ?? {}
  return {
    overallScore: data.overallScore ?? 0,
    criteria: {
      clarity: criteria.clarity ?? 0,
      completeness: criteria.completeness ?? 0,
      feasibility: criteria.feasibility ?? 0,
      alignment: criteria.alignment ?? 0,
      impact: criteria.impact ?? 0,
      riskAssessment: criteria.riskAssessment ?? 0,
      costBenefit: criteria.costBenefit ?? 0,
    },
    feedback: data.feedback ?? [],
    suggestions: data.suggestions ?? [],
    blockers: data.blockers ?? [],
    readyToSubmit: data.readyToSubmit ?? false,
    minRequired: data.minRequired ?? 70,
    similarProposals: [],
    assessedAt: Date.now(),
    model: 'gpt-5',
  }
}

interface CheckDuplicatesResponse {
  duplicates: SimilarProposal[]
}

export async function checkDuplicates(
  draft: ProposalDraft,
): Promise<SimilarProposal[]> {
  const response = await api.api.v1.proposals['check-duplicates'].post({
    daoId: draft.daoId ?? 'jeju',
    title: draft.title,
    summary: draft.summary,
    description: draft.description,
    proposalType: draft.proposalType,
  })
  const data = extractData<CheckDuplicatesResponse>(response)
  return data.duplicates
}

interface ImproveProposalResponse {
  improved: string
}

export async function improveProposal(
  draft: ProposalDraft,
  criterion: string,
): Promise<string> {
  const response = await api.api.v1.proposals.improve.post({
    draft: {
      daoId: draft.daoId ?? 'jeju',
      title: draft.title,
      summary: draft.summary,
      description: draft.description,
      proposalType: draft.proposalType,
    },
    criterion,
  })
  const data = extractData<ImproveProposalResponse>(response)
  return data.improved
}

export async function generateProposal(
  idea: string,
  proposalType: number,
): Promise<ProposalDraft> {
  const response = await api.api.v1.proposals.generate.post({
    idea,
    proposalType,
  })
  return extractData(response) as ProposalDraft
}

export async function quickScore(
  draft: ProposalDraft,
): Promise<QuickScoreResult> {
  const response = await api.api.v1.proposals['quick-score'].post({
    daoId: draft.daoId ?? 'jeju',
    title: draft.title,
    summary: draft.summary,
    description: draft.description,
    proposalType: draft.proposalType,
  })
  return extractData(response) as QuickScoreResult
}

export async function fetchDirectorStatus(): Promise<DirectorStatus> {
  const result = await callA2A<DirectorStatus>('get-director-status')
  return result.data
}

interface ModelCandidatesResponse {
  models: ModelCandidate[]
}

export async function fetchModelCandidates(): Promise<ModelCandidate[]> {
  const response = await api.api.v1.agents.director.models.get()
  const data = extractDataOrDefault<ModelCandidatesResponse>(response, {
    models: [],
  })
  return data.models
}

interface DecisionsResponse {
  decisions: Decision[]
}

export async function fetchRecentDecisions(limit = 10): Promise<Decision[]> {
  const response = await api.api.v1.agents.director.decisions.get({
    query: { limit: String(limit) },
  })
  const data = extractDataOrDefault<DecisionsResponse>(response, {
    decisions: [],
  })
  return data.decisions
}

export interface NominateModelRequest {
  modelId: string
  modelName: string
  provider: string
  benchmarkScore?: number
}

interface NominateModelResponse {
  success: boolean
  nominated: ModelCandidate & { nominatedAt: number }
  message: string
}

export async function nominateModel(
  request: NominateModelRequest,
): Promise<NominateModelResponse> {
  const response = await fetch(`${API_BASE}/api/v1/agents/director/nominate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    throw new Error(`Failed to nominate model: ${response.statusText}`)
  }
  return response.json()
}

export async function fetchGovernanceStats(): Promise<GovernanceStats> {
  const result = await callA2A<GovernanceStats>('get-governance-stats')
  return result.data
}

export async function fetchAutocratStatus(): Promise<AutocratStatus> {
  const result = await callA2A<AutocratStatus>('get-autocrat-status')
  return result.data
}

export async function conductResearch(request: ResearchRequest) {
  const response = await api.api.v1.research.conduct.post(request)
  return extractData(response)
}

export async function quickScreenResearch(request: {
  proposalId: string
  title: string
  description: string
}) {
  const response = await api.api.v1.research['quick-screen'].post(request)
  return extractData(response)
}

export async function factCheck(claim: string, context: string) {
  const response = await api.api.v1.research['fact-check'].post({
    claim,
    context,
  })
  return extractData(response)
}

export async function fetchOrchestratorStatus(): Promise<OrchestratorStatus> {
  const response = await api.api.v1.orchestrator.status.get()
  if (response.error || !response.data) {
    return {
      running: false,
      cycleCount: 0,
      message: 'Unable to fetch status',
    }
  }
  return response.data as OrchestratorStatus
}

export async function startOrchestrator() {
  const response = await api.api.v1.orchestrator.start.post()
  return extractData(response)
}

export async function stopOrchestrator() {
  const response = await api.api.v1.orchestrator.stop.post()
  return extractData(response)
}

export async function fetchBugBountyStats(): Promise<BountyStats> {
  const response = await api.api.v1['bug-bounty'].stats.get()
  return extractData(response) as BountyStats
}

export async function fetchBugBountySubmissions(
  limit?: number,
  status?: number,
  researcher?: string,
) {
  const response = await api.api.v1['bug-bounty'].submissions.get({
    query: {
      limit: limit ? String(limit) : undefined,
      status: status !== undefined ? String(status) : undefined,
      researcher,
    },
  })
  return extractData(response) as BountySubmissionsResponse
}

export async function fetchBugBountySubmission(id: string) {
  const response = await api.api.v1['bug-bounty'].submissions({ id }).get()
  return extractData(response)
}

export async function assessBugBounty(
  draft: BountySubmissionDraft,
): Promise<BountyAssessment> {
  const response = await api.api.v1['bug-bounty'].assess.post(draft)
  return extractData(response) as BountyAssessment
}

export async function submitBugBounty(
  draft: BountySubmissionDraft,
  researcher: string,
  researcherAgentId?: string,
) {
  const response = await api.api.v1['bug-bounty'].submit.post({
    ...draft,
    researcher,
    researcherAgentId,
  })
  return extractData(response)
}

export async function fetchResearcherStats(address: string) {
  const response = await api.api.v1['bug-bounty'].researcher({ address }).get()
  return extractData(response)
}

export interface ResearcherLeaderboardEntry {
  researcher: string
  totalSubmissions: number
  approvedSubmissions: number
  totalEarned: string
  successRate: number
}

export async function fetchResearcherLeaderboard(
  limit = 10,
): Promise<{ entries: ResearcherLeaderboardEntry[]; total: number }> {
  const response = await api.api.v1['bug-bounty'].leaderboard.get({
    query: { limit: String(limit) },
  })
  return extractData(response)
}

export async function fetchDAOs() {
  const response = await api.api.v1.dao.list.get()
  return extractData(response)
}

export async function fetchActiveDAOs() {
  const response = await api.api.v1.dao.active.get()
  return extractData(response)
}

export async function fetchDAO(daoId: string) {
  const response = await api.api.v1.dao({ daoId }).get()
  return extractData(response)
}

export async function fetchDAOPersona(daoId: string) {
  const response = await api.api.v1.dao({ daoId }).persona.get()
  return extractData(response)
}

export async function fetchDAOBoard(daoId: string) {
  const response = await api.api.v1.dao({ daoId }).board.get()
  return extractData(response)
}

export async function submitModerationFlag(params: {
  proposalId: string
  flagger: string
  flagType: string
  reason: string
  stake?: number
  evidence?: string[]
}) {
  const response = await api.api.v1.moderation.flag.post(params)
  return extractData(response)
}

export async function voteOnFlag(
  flagId: string,
  voter: string,
  upvote: boolean,
) {
  const response = await api.api.v1.moderation.vote.post({
    flagId,
    voter,
    upvote,
  })
  return extractData(response)
}

export async function fetchProposalModerationScore(proposalId: string) {
  const response = await api.api.v1.moderation.score({ proposalId }).get()
  return extractData(response)
}

export async function fetchProposalFlags(proposalId: string) {
  const response = await api.api.v1.moderation.flags({ proposalId }).get()
  return extractData(response)
}

export async function fetchActiveFlags() {
  const response = await api.api.v1.moderation['active-flags'].get()
  return extractData(response)
}

export async function fetchModeratorLeaderboard(limit = 10) {
  const response = await api.api.v1.moderation.leaderboard.get({
    query: { limit: String(limit) },
  })
  return extractData(response)
}

export async function fetchModeratorStats(address: string) {
  const response = await api.api.v1.moderation.moderator({ address }).get()
  return extractData(response)
}

export async function createRLAIFRun(params: {
  environment: { id: string; type: string; configCID: string }
  archetype?: string
  baseModel: string
  trajectoryBatchCID?: string
  trainingConfig: { steps: number; batchSize: number; learningRate: number }
}) {
  const response = await api.rlaif.runs.post(params)
  return extractData(response)
}

export async function fetchRLAIFRuns(environment?: string) {
  const response = await api.rlaif.runs.get({
    query: { environment },
  })
  return extractData(response)
}

export async function fetchRLAIFRun(id: string) {
  const response = await api.rlaif.runs({ id }).get()
  return extractData(response)
}

export async function startRLAIFRun(id: string, maxIterations?: number) {
  const response = await api.rlaif
    .runs({ id })
    .start.post(maxIterations ? { maxIterations } : {})
  return extractData(response)
}

export async function cancelRLAIFRun(id: string) {
  const response = await api.rlaif.runs({ id }).cancel.post()
  return extractData(response)
}

export async function fetchRLAIFHealth() {
  const response = await api.rlaif.health.get()
  return extractData(response)
}

export async function fetchTrajectoryStats(environment = 'default') {
  const response = await api.rlaif.trajectories.stats.get({
    query: { environment },
  })
  return extractData(response)
}

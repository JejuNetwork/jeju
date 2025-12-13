const API_BASE = process.env.NEXT_PUBLIC_COUNCIL_API || ''

interface A2ARequest {
  skillId: string
  params?: Record<string, unknown>
}

interface A2AResponse<T> {
  message: string
  data: T
}

async function callA2A<T>(request: A2ARequest): Promise<A2AResponse<T>> {
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
          parts: [{ kind: 'data', data: { skillId: request.skillId, params: request.params || {} } }]
        }
      }
    })
  })

  if (!response.ok) {
    throw new Error(`A2A request failed: ${response.status} ${response.statusText}`)
  }

  const json = await response.json()
  
  // Check for JSON-RPC error
  if (json.error) {
    throw new Error(json.error.message || 'A2A error')
  }

  const dataPart = json.result?.parts?.find((p: { kind: string }) => p.kind === 'data')
  const textPart = json.result?.parts?.find((p: { kind: string }) => p.kind === 'text')

  return {
    message: textPart?.text || '',
    data: (dataPart?.data || {}) as T
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
  ceoApproved?: boolean
}

export interface ProposalList {
  total: number
  proposals: Proposal[]
}

export interface CEOStatus {
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
}

export interface GovernanceStats {
  totalProposals: string
  ceo: {
    model: string
    decisions: string
    approvalRate: string
  }
  parameters: {
    minQualityScore: string
    councilVotingPeriod: string
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

export interface CouncilAgent {
  role: string
  index: number
  description: string
}

export interface CouncilStatus {
  agents: CouncilAgent[]
  votingPeriod: string
  gracePeriod: string
}

export async function fetchHealth() {
  const response = await fetch(`${API_BASE}/health`)
  return response.json()
}

export async function fetchProposals(activeOnly = false): Promise<ProposalList> {
  const result = await callA2A<ProposalList>({ skillId: 'list-proposals', params: { activeOnly } })
  return result.data
}

export async function fetchProposal(proposalId: string): Promise<Proposal> {
  const result = await callA2A<Proposal>({ skillId: 'get-proposal', params: { proposalId } })
  return result.data
}

export async function fetchCEOStatus(): Promise<CEOStatus> {
  const result = await callA2A<CEOStatus>({ skillId: 'get-ceo-status' })
  return result.data
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

export async function fetchModelCandidates(): Promise<ModelCandidate[]> {
  const response = await fetch(`${API_BASE}/api/v1/ceo/models`)
  if (!response.ok) return []
  const data = await response.json()
  return data.models ?? []
}

export async function fetchRecentDecisions(limit = 10): Promise<Decision[]> {
  const response = await fetch(`${API_BASE}/api/v1/ceo/decisions?limit=${limit}`)
  if (!response.ok) return []
  const data = await response.json()
  return data.decisions ?? []
}

export async function fetchGovernanceStats(): Promise<GovernanceStats> {
  const result = await callA2A<GovernanceStats>({ skillId: 'get-governance-stats' })
  return result.data
}

export async function fetchCouncilStatus(): Promise<CouncilStatus> {
  const result = await callA2A<CouncilStatus>({ skillId: 'get-council-status' })
  return result.data
}

export async function assessProposal(params: {
  title: string
  summary: string
  description: string
  proposalType: string
}): Promise<QualityAssessment> {
  const result = await callA2A<QualityAssessment>({ skillId: 'assess-proposal', params })
  return result.data
}

export async function prepareSubmitProposal(params: {
  proposalType: number
  qualityScore: number
  contentHash: string
  targetContract?: string
  callData?: string
  value?: string
}) {
  const result = await callA2A({ skillId: 'submit-proposal', params })
  return result.data
}

// ============================================================================
// Proposal Assistant API (REST endpoints)
// ============================================================================

export interface ProposalDraft {
  title: string
  summary: string
  description: string
  proposalType: number
  targetContract?: string
  calldata?: string
  value?: string
  tags?: string[]
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

export interface ImprovementResult {
  improved: string
}

export interface GeneratedProposal {
  title: string
  summary: string
  description: string
  tags: string[]
}

export async function assessProposalFull(draft: ProposalDraft): Promise<FullQualityAssessment> {
  const response = await fetch(`${API_BASE}/api/v1/proposals/assess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft)
  })
  if (!response.ok) throw new Error('Assessment failed')
  return response.json()
}

export async function checkDuplicates(draft: ProposalDraft): Promise<SimilarProposal[]> {
  const response = await fetch(`${API_BASE}/api/v1/proposals/check-duplicates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft)
  })
  if (!response.ok) throw new Error('Duplicate check failed')
  const data = await response.json()
  return data.duplicates
}

export async function improveProposal(draft: ProposalDraft, criterion: string): Promise<string> {
  const response = await fetch(`${API_BASE}/api/v1/proposals/improve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft, criterion })
  })
  if (!response.ok) throw new Error('Improvement failed')
  const data: ImprovementResult = await response.json()
  return data.improved
}

export async function generateProposal(idea: string, proposalType: number): Promise<GeneratedProposal> {
  const response = await fetch(`${API_BASE}/api/v1/proposals/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idea, proposalType })
  })
  if (!response.ok) throw new Error('Generation failed')
  return response.json()
}

export async function quickScore(draft: ProposalDraft): Promise<QuickScoreResult> {
  const response = await fetch(`${API_BASE}/api/v1/proposals/quick-score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft)
  })
  if (!response.ok) throw new Error('Quick score failed')
  return response.json()
}

// ============================================================================
// Research API
// ============================================================================

export interface ResearchRequest {
  proposalId: string
  title: string
  summary: string
  description: string
  proposalType: number
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

export async function conductResearch(request: ResearchRequest): Promise<ResearchReport> {
  const response = await fetch(`${API_BASE}/api/v1/research/conduct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })
  if (!response.ok) throw new Error('Research failed')
  return response.json()
}

export async function quickScreenResearch(request: ResearchRequest): Promise<QuickScreenResult> {
  const response = await fetch(`${API_BASE}/api/v1/research/quick-screen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })
  if (!response.ok) throw new Error('Quick screen failed')
  return response.json()
}

export async function factCheck(claim: string, context: string) {
  const response = await fetch(`${API_BASE}/api/v1/research/fact-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claim, context })
  })
  if (!response.ok) throw new Error('Fact check failed')
  return response.json()
}

// ============================================================================
// Orchestrator & Triggers API
// ============================================================================

export interface OrchestratorStatus {
  running: boolean
  cycleCount: number
  lastCycle: number
  processedProposals: number
}

export async function fetchOrchestratorStatus(): Promise<OrchestratorStatus> {
  const response = await fetch(`${API_BASE}/api/v1/orchestrator/status`)
  return response.json()
}

export async function startOrchestrator() {
  const response = await fetch(`${API_BASE}/api/v1/orchestrator/start`, { method: 'POST' })
  return response.json()
}

export async function stopOrchestrator() {
  const response = await fetch(`${API_BASE}/api/v1/orchestrator/stop`, { method: 'POST' })
  return response.json()
}

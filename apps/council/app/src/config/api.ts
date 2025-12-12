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

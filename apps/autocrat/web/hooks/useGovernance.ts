/**
 * React Query Hooks for Governance Data
 *
 * Type-safe data fetching hooks using React Query and Eden Treaty.
 * These replace direct fetch calls in React components.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AutocratStatus,
  CEOStatus,
  GovernanceStats,
  ImprovedTextResponse,
  Proposal,
  ProposalDraft,
  ProposalList,
  QualityAssessment,
} from '../config/api'
import { api, extractData } from '../lib/client'

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
  ceoApproved?: boolean
}

/** API response for proposal list */
interface ProposalListApiResponse {
  proposals?: ProposalApiData[]
  total?: number
}

/** API response for CEO status */
interface CEOStatusApiResponse {
  currentModel?: {
    modelId?: string
    name?: string
    provider?: string
    totalStaked?: string
    benchmarkScore?: string
  }
  stats?: {
    totalDecisions?: string
    approvedDecisions?: string
    overriddenDecisions?: string
    approvalRate?: string
    overrideRate?: string
  }
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

export const governanceKeys = {
  all: ['governance'] as const,
  stats: () => [...governanceKeys.all, 'stats'] as const,
  ceo: () => [...governanceKeys.all, 'ceo'] as const,
  autocrat: () => [...governanceKeys.all, 'autocrat'] as const,
  proposals: () => [...governanceKeys.all, 'proposals'] as const,
  proposalsList: (activeOnly: boolean) =>
    [...governanceKeys.proposals(), { activeOnly }] as const,
  proposalDetail: (id: string) =>
    [...governanceKeys.proposals(), 'detail', id] as const,
  orchestrator: () => [...governanceKeys.all, 'orchestrator'] as const,
}

export function useGovernanceStats() {
  return useQuery({
    queryKey: governanceKeys.stats(),
    queryFn: async (): Promise<GovernanceStats> => {
      // Use A2A for governance stats since it aggregates multiple sources
      const response = await fetch('/api/v1/stats')
      if (!response.ok) {
        // Fallback to defaults
        return {
          totalProposals: '0',
          ceo: { model: 'Not set', decisions: '0', approvalRate: '0%' },
          parameters: {
            minQualityScore: '70%',
            autocratVotingPeriod: '24h',
            gracePeriod: '6h',
          },
        }
      }
      return response.json()
    },
    staleTime: 30_000, // 30 seconds
  })
}

export function useCEOStatus() {
  return useQuery({
    queryKey: governanceKeys.ceo(),
    queryFn: async (): Promise<CEOStatus> => {
      const response = await api.api.v1.agents.ceo.get()
      if (response.error || !response.data) {
        return {
          currentModel: {
            modelId: '',
            name: 'Not configured',
            provider: 'unknown',
          },
          stats: {
            totalDecisions: '0',
            approvedDecisions: '0',
            overriddenDecisions: '0',
            approvalRate: '0',
            overrideRate: '0',
          },
        }
      }
      const data = response.data as CEOStatusApiResponse
      return {
        currentModel: {
          modelId: data.currentModel?.modelId ?? '',
          name: data.currentModel?.name ?? 'Not configured',
          provider: data.currentModel?.provider ?? 'unknown',
          totalStaked: data.currentModel?.totalStaked,
          benchmarkScore: data.currentModel?.benchmarkScore,
        },
        stats: {
          totalDecisions: data.stats?.totalDecisions ?? '0',
          approvedDecisions: data.stats?.approvedDecisions ?? '0',
          overriddenDecisions: data.stats?.overriddenDecisions ?? '0',
          approvalRate: data.stats?.approvalRate ?? '0',
          overrideRate: data.stats?.overrideRate ?? '0',
        },
      }
    },
    staleTime: 60_000, // 1 minute
  })
}

export function useAutocratStatus() {
  return useQuery({
    queryKey: governanceKeys.autocrat(),
    queryFn: async (): Promise<AutocratStatus> => {
      return {
        agents: [],
        votingPeriod: '24h',
        gracePeriod: '6h',
      }
    },
    staleTime: 60_000,
  })
}

export function useProposals(activeOnly = false) {
  return useQuery({
    queryKey: governanceKeys.proposalsList(activeOnly),
    queryFn: async (): Promise<ProposalList> => {
      const response = await api.api.v1.proposals.get({
        query: { active: activeOnly ? 'true' : undefined },
      })
      if (response.error) {
        return { proposals: [], total: 0 }
      }
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
          ceoApproved: p.ceoApproved,
        })),
        total: data.total ?? 0,
      }
    },
    staleTime: 10_000, // 10 seconds
  })
}

export function useProposal(proposalId: string) {
  return useQuery({
    queryKey: governanceKeys.proposalDetail(proposalId),
    queryFn: async (): Promise<Proposal | null> => {
      const response = await api.api.v1.proposals({ id: proposalId }).get()
      if (response.error || !response.data) {
        return null
      }
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
        ceoApproved: data.ceoApproved,
      }
    },
    enabled: Boolean(proposalId),
    staleTime: 30_000,
  })
}

export function useAssessProposal() {
  return useMutation({
    mutationFn: async (draft: ProposalDraft): Promise<QualityAssessment> => {
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
      const data = extractData(response) as QualityAssessmentApiResponse
      return {
        overallScore: data.overallScore ?? 0,
        criteria: {
          clarity: data.criteria?.clarity ?? 0,
          completeness: data.criteria?.completeness ?? 0,
          feasibility: data.criteria?.feasibility ?? 0,
          alignment: data.criteria?.alignment ?? 0,
          impact: data.criteria?.impact ?? 0,
          riskAssessment: data.criteria?.riskAssessment ?? 0,
          costBenefit: data.criteria?.costBenefit ?? 0,
        },
        feedback: data.feedback ?? [],
        suggestions: data.suggestions ?? [],
        blockers: data.blockers ?? [],
        readyToSubmit: data.readyToSubmit ?? false,
        minRequired: data.minRequired ?? 70,
      }
    },
  })
}

export function useImproveProposal() {
  return useMutation({
    mutationFn: async ({
      draft,
      criterion,
    }: {
      draft: ProposalDraft
      criterion: string
    }): Promise<string> => {
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
      const data = extractData(response) as ImprovedTextResponse
      return data.improved
    },
  })
}

export function useGenerateProposal() {
  return useMutation({
    mutationFn: async ({
      idea,
      proposalType,
    }: {
      idea: string
      proposalType: number
    }): Promise<ProposalDraft> => {
      const response = await api.api.v1.proposals.generate.post({
        idea,
        proposalType,
      })
      return extractData(response) as ProposalDraft
    },
  })
}

export function useOrchestratorStatus() {
  return useQuery({
    queryKey: governanceKeys.orchestrator(),
    queryFn: async () => {
      const response = await api.api.v1.orchestrator.status.get()
      if (response.error || !response.data) {
        return { running: false, cycleCount: 0 }
      }
      return response.data
    },
    refetchInterval: 5_000, // Refresh every 5 seconds when running
  })
}

export function useStartOrchestrator() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await api.api.v1.orchestrator.start.post()
      return extractData(response)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: governanceKeys.orchestrator() })
    },
  })
}

export function useStopOrchestrator() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await api.api.v1.orchestrator.stop.post()
      return extractData(response)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: governanceKeys.orchestrator() })
    },
  })
}

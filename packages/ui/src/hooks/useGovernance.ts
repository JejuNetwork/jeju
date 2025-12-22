import type {
  CreateProposalParams,
  DelegateInfo,
  ProposalInfo,
  VoteParams,
} from '@jejunetwork/sdk'
import type { ProposalStatus } from '@jejunetwork/types'
import { useCallback } from 'react'
import type { Hex } from 'viem'
import { useNetworkContext } from '../context'
import { type AsyncState, requireClient, useAsyncState } from './utils'

export interface UseGovernanceResult extends AsyncState {
  listProposals: (status?: ProposalStatus) => Promise<ProposalInfo[]>
  createProposal: (params: CreateProposalParams) => Promise<Hex>
  vote: (params: VoteParams) => Promise<Hex>
  getVotingPower: () => Promise<bigint>
  listDelegates: () => Promise<DelegateInfo[]>
}

export function useGovernance(): UseGovernanceResult {
  const { client } = useNetworkContext()
  const { isLoading, error, execute } = useAsyncState()

  const listProposals = useCallback(
    async (status?: ProposalStatus): Promise<ProposalInfo[]> => {
      const c = requireClient(client)
      return c.governance.listProposals(status)
    },
    [client],
  )

  const createProposal = useCallback(
    async (params: CreateProposalParams): Promise<Hex> => {
      const c = requireClient(client)
      return execute(() => c.governance.createProposal(params))
    },
    [client, execute],
  )

  const vote = useCallback(
    async (params: VoteParams): Promise<Hex> => {
      const c = requireClient(client)
      return execute(() => c.governance.vote(params))
    },
    [client, execute],
  )

  const getVotingPower = useCallback(async (): Promise<bigint> => {
    const c = requireClient(client)
    return c.governance.getVotingPower()
  }, [client])

  const listDelegates = useCallback(async (): Promise<DelegateInfo[]> => {
    const c = requireClient(client)
    return c.governance.listDelegates()
  }, [client])

  return {
    isLoading,
    error,
    listProposals,
    createProposal,
    vote,
    getVotingPower,
    listDelegates,
  }
}

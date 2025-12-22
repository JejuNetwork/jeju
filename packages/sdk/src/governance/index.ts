/**
 * Governance Module - Proposals, voting, delegation
 */

import {
  type NetworkType,
  type ProposalStatus,
  type ProposalType,
  ProposalTypeValue,
  type VoteType,
  VoteTypeValue,
} from '@jejunetwork/types'

/** Reverse mapping from numeric type to ProposalType string */
const ProposalTypeFromValue: Record<number, ProposalType> = {
  0: 'PARAMETER_CHANGE',
  1: 'TREASURY_ALLOCATION',
  2: 'CODE_UPGRADE',
  3: 'HIRE_CONTRACTOR',
  4: 'FIRE_CONTRACTOR',
  5: 'BOUNTY',
  6: 'GRANT',
  7: 'PARTNERSHIP',
  8: 'POLICY',
  9: 'EMERGENCY',
}

/** Reverse mapping from numeric status to ProposalStatus string */
const ProposalStatusFromValue: Record<number, ProposalStatus> = {
  0: 'SUBMITTED',
  1: 'COUNCIL_REVIEW',
  2: 'RESEARCH_PENDING',
  3: 'COUNCIL_FINAL',
  4: 'CEO_QUEUE',
  5: 'APPROVED',
  6: 'EXECUTING',
  7: 'COMPLETED',
  8: 'REJECTED',
  9: 'VETOED',
  10: 'FUTARCHY_PENDING',
  11: 'FUTARCHY_APPROVED',
  12: 'FUTARCHY_REJECTED',
  13: 'DUPLICATE',
  14: 'SPAM',
}

import { type Address, encodeFunctionData, type Hex } from 'viem'
import { getServicesConfig, requireContract } from '../config'
import {
  DelegateInfoSchema,
  DelegatesListSchema,
  GovernanceIPFSUploadResponseSchema,
  GovernanceStatsRawResponseSchema,
  GovernanceVotingPowerResponseSchema,
  ProposalInfoSchema,
  ProposalsListSchema,
} from '../shared/schemas'
import type { JejuWallet } from '../wallet'

export interface ProposalInfo {
  proposalId: Hex
  proposer: Address
  proposerAgentId: bigint
  type: ProposalType
  status: ProposalStatus
  qualityScore: number
  createdAt: number
  councilVoteEnd: number
  gracePeriodEnd: number
  contentHash: string
  targetContract: Address
  callData: Hex
  value: bigint
  totalStaked: bigint
  backerCount: number
  hasResearch: boolean
  ceoApproved: boolean
}

export interface CreateProposalParams {
  type: ProposalType
  title: string
  description: string
  targetContract?: Address
  callData?: Hex
  value?: bigint
}

export interface VoteParams {
  proposalId: Hex
  vote: VoteType
  reason?: string
}

export interface DelegateInfo {
  address: Address
  agentId: bigint
  name: string
  expertise: string[]
  totalDelegated: bigint
  delegatorCount: number
  isActive: boolean
}

export interface GovernanceStats {
  totalProposals: number
  activeProposals: number
  executedProposals: number
  rejectedProposals: number
  totalStaked: bigint
  totalDelegated: bigint
}

export interface GovernanceModule {
  // Proposals
  createProposal(params: CreateProposalParams): Promise<Hex>
  getProposal(proposalId: Hex): Promise<ProposalInfo>
  listProposals(status?: ProposalStatus): Promise<ProposalInfo[]>
  backProposal(proposalId: Hex, amount: bigint): Promise<Hex>

  // Voting
  vote(params: VoteParams): Promise<Hex>
  getVotingPower(): Promise<bigint>

  // Delegation
  delegate(delegateTo: Address): Promise<Hex>
  undelegate(): Promise<Hex>
  listDelegates(): Promise<DelegateInfo[]>
  getMyDelegate(): Promise<DelegateInfo | null>

  // Stats
  getStats(): Promise<GovernanceStats>
}

const COUNCIL_ABI = [
  {
    name: 'createProposal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proposalType', type: 'uint8' },
      { name: 'contentHash', type: 'bytes32' },
      { name: 'target', type: 'address' },
      { name: 'callData', type: 'bytes' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getProposal',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'proposer', type: 'address' },
          { name: 'proposerAgentId', type: 'uint256' },
          { name: 'proposalType', type: 'uint8' },
          { name: 'status', type: 'uint8' },
          { name: 'qualityScore', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'councilVoteEnd', type: 'uint256' },
          { name: 'gracePeriodEnd', type: 'uint256' },
          { name: 'contentHash', type: 'bytes32' },
          { name: 'targetContract', type: 'address' },
          { name: 'callData', type: 'bytes' },
          { name: 'value', type: 'uint256' },
          { name: 'totalStaked', type: 'uint256' },
          { name: 'backerCount', type: 'uint256' },
          { name: 'hasResearch', type: 'bool' },
          { name: 'ceoApproved', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'backProposal',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'proposalId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'castVote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proposalId', type: 'bytes32' },
      { name: 'vote', type: 'uint8' },
      { name: 'reasonHash', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

const DELEGATION_ABI = [
  {
    name: 'delegate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'delegateTo', type: 'address' }],
    outputs: [],
  },
  {
    name: 'undelegate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'getDelegation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'delegator', type: 'address' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'getVotingPower',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

export function createGovernanceModule(
  wallet: JejuWallet,
  network: NetworkType,
): GovernanceModule {
  const councilAddress = requireContract('governance', 'council', network)
  const delegationAddress = requireContract('governance', 'delegation', network)
  const services = getServicesConfig(network)

  async function createProposal(params: CreateProposalParams): Promise<Hex> {
    // Upload content to IPFS
    const content = { title: params.title, description: params.description }
    const response = await fetch(`${services.storage.api}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    })

    if (!response.ok) throw new Error('Failed to upload proposal content')
    const rawUpload: unknown = await response.json()
    const { cid } = GovernanceIPFSUploadResponseSchema.parse(rawUpload)
    const contentHash =
      `0x${Buffer.from(cid).toString('hex').padEnd(64, '0')}` as Hex

    const data = encodeFunctionData({
      abi: COUNCIL_ABI,
      functionName: 'createProposal',
      args: [
        ProposalTypeValue[params.type],
        contentHash,
        params.targetContract ?? '0x0000000000000000000000000000000000000000',
        params.callData ?? '0x',
        params.value ?? 0n,
      ],
    })

    return wallet.sendTransaction({ to: councilAddress, data })
  }

  async function getProposal(proposalId: Hex): Promise<ProposalInfo> {
    const response = await fetch(
      `${services.gateway.api}/governance/proposals/${proposalId}`,
    )
    if (!response.ok) throw new Error('Failed to fetch proposal')
    const rawData: unknown = await response.json()
    const parsed = ProposalInfoSchema.parse(rawData)
    return {
      ...parsed,
      type: ProposalTypeFromValue[parsed.type] ?? 'PARAMETER_CHANGE',
      status: ProposalStatusFromValue[parsed.status] ?? 'SUBMITTED',
    }
  }

  async function listProposals(
    status?: ProposalStatus,
  ): Promise<ProposalInfo[]> {
    const url = status
      ? `${services.gateway.api}/governance/proposals?status=${status}`
      : `${services.gateway.api}/governance/proposals`

    const response = await fetch(url)
    if (!response.ok) throw new Error('Failed to list proposals')

    const rawData: unknown = await response.json()
    const data = ProposalsListSchema.parse(rawData)
    return data.proposals.map((p) => ({
      ...p,
      type: ProposalTypeFromValue[p.type] ?? 'PARAMETER_CHANGE',
      status: ProposalStatusFromValue[p.status] ?? 'SUBMITTED',
    }))
  }

  async function backProposal(proposalId: Hex, amount: bigint): Promise<Hex> {
    const data = encodeFunctionData({
      abi: COUNCIL_ABI,
      functionName: 'backProposal',
      args: [proposalId],
    })

    return wallet.sendTransaction({ to: councilAddress, data, value: amount })
  }

  async function vote(params: VoteParams): Promise<Hex> {
    const reasonHash = params.reason
      ? (`0x${Buffer.from(params.reason).toString('hex').slice(0, 64).padEnd(64, '0')}` as Hex)
      : ('0x0000000000000000000000000000000000000000000000000000000000000000' as Hex)

    const data = encodeFunctionData({
      abi: COUNCIL_ABI,
      functionName: 'castVote',
      args: [params.proposalId, VoteTypeValue[params.vote], reasonHash],
    })

    return wallet.sendTransaction({ to: councilAddress, data })
  }

  async function getVotingPower(): Promise<bigint> {
    const response = await fetch(
      `${services.gateway.api}/governance/voting-power/${wallet.address}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to get voting power: ${response.statusText}`)
    }
    const rawData: unknown = await response.json()
    const data = GovernanceVotingPowerResponseSchema.parse(rawData)
    return BigInt(data.power)
  }

  async function delegate(delegateTo: Address): Promise<Hex> {
    const data = encodeFunctionData({
      abi: DELEGATION_ABI,
      functionName: 'delegate',
      args: [delegateTo],
    })

    return wallet.sendTransaction({ to: delegationAddress, data })
  }

  async function undelegate(): Promise<Hex> {
    const data = encodeFunctionData({
      abi: DELEGATION_ABI,
      functionName: 'undelegate',
      args: [],
    })

    return wallet.sendTransaction({ to: delegationAddress, data })
  }

  async function listDelegates(): Promise<DelegateInfo[]> {
    const response = await fetch(`${services.gateway.api}/governance/delegates`)
    if (!response.ok) {
      throw new Error(`Failed to list delegates: ${response.statusText}`)
    }
    const rawData: unknown = await response.json()
    const data = DelegatesListSchema.parse(rawData)
    return data.delegates
  }

  async function getMyDelegate(): Promise<DelegateInfo | null> {
    const response = await fetch(
      `${services.gateway.api}/governance/delegation/${wallet.address}`,
    )
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to get delegation: ${response.statusText}`)
    }
    const rawData: unknown = await response.json()
    return DelegateInfoSchema.parse(rawData)
  }

  async function getStats(): Promise<GovernanceStats> {
    const response = await fetch(`${services.gateway.api}/governance/stats`)
    if (!response.ok) {
      throw new Error(`Failed to get governance stats: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const data = GovernanceStatsRawResponseSchema.parse(rawData)

    return {
      ...data,
      totalStaked: BigInt(data.totalStaked),
      totalDelegated: BigInt(data.totalDelegated),
    }
  }

  return {
    createProposal,
    getProposal,
    listProposals,
    backProposal,
    vote,
    getVotingPower,
    delegate,
    undelegate,
    listDelegates,
    getMyDelegate,
    getStats,
  }
}

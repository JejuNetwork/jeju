/**
 * ProposalService - Handles on-chain proposal submission via BoardGovernance contract
 */

import { getChainId, getRpcUrl } from '@jejunetwork/config'
import {
  type Address,
  type Hash,
  createPublicClient,
  createWalletClient,
  http,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil, type Chain } from 'viem/chains'

// BoardGovernance ABI - minimal for proposal submission
const BOARD_GOVERNANCE_ABI = [
  {
    type: 'function',
    name: 'submitProposal',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'proposalType', type: 'uint8' },
      { name: 'contentHash', type: 'bytes32' },
      { name: 'targetContract', type: 'address' },
      { name: 'callData', type: 'bytes' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: 'proposalId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getProposal',
    inputs: [{ name: 'proposalId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'proposalId', type: 'bytes32' },
          { name: 'proposer', type: 'address' },
          { name: 'proposerAgentId', type: 'uint256' },
          { name: 'proposalType', type: 'uint8' },
          { name: 'status', type: 'uint8' },
          { name: 'qualityScore', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'autocratVoteEnd', type: 'uint256' },
          { name: 'gracePeriodEnd', type: 'uint256' },
          { name: 'contentHash', type: 'bytes32' },
          { name: 'targetContract', type: 'address' },
          { name: 'callData', type: 'bytes' },
          { name: 'value', type: 'uint256' },
          { name: 'totalStaked', type: 'uint256' },
          { name: 'totalReputation', type: 'uint256' },
          { name: 'backerCount', type: 'uint256' },
          { name: 'hasResearch', type: 'bool' },
          { name: 'researchHash', type: 'bytes32' },
          { name: 'directorApproved', type: 'bool' },
          { name: 'directorDecisionHash', type: 'bytes32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getProposalsByDAO',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'proposalCount',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'ProposalSubmitted',
    inputs: [
      { name: 'daoId', type: 'bytes32', indexed: true },
      { name: 'proposalId', type: 'bytes32', indexed: true },
      { name: 'proposer', type: 'address', indexed: true },
      { name: 'proposalType', type: 'uint8', indexed: false },
      { name: 'contentHash', type: 'bytes32', indexed: false },
    ],
  },
  // Board voting functions
  {
    type: 'function',
    name: 'castVote',
    inputs: [
      { name: 'proposalId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
      { name: 'vote', type: 'uint8' },
      { name: 'reasoningHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getVotes',
    inputs: [{ name: 'proposalId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'vote', type: 'uint8' },
          { name: 'reasoningHash', type: 'bytes32' },
          { name: 'votedAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getVoteCounts',
    inputs: [{ name: 'proposalId', type: 'bytes32' }],
    outputs: [
      { name: 'approvals', type: 'uint256' },
      { name: 'rejections', type: 'uint256' },
      { name: 'abstentions', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hasVoted',
    inputs: [
      { name: 'proposalId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'VoteCast',
    inputs: [
      { name: 'proposalId', type: 'bytes32', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'vote', type: 'uint8', indexed: false },
      { name: 'reasoningHash', type: 'bytes32', indexed: false },
    ],
  },
  // Director decision functions
  {
    type: 'function',
    name: 'setDirectorApproval',
    inputs: [
      { name: 'proposalId', type: 'bytes32' },
      { name: 'approved', type: 'bool' },
      { name: 'decisionHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isDirectorDecided',
    inputs: [{ name: 'proposalId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'DirectorDecision',
    inputs: [
      { name: 'proposalId', type: 'bytes32', indexed: true },
      { name: 'approved', type: 'bool', indexed: false },
      { name: 'decisionHash', type: 'bytes32', indexed: false },
      { name: 'decidedAt', type: 'uint256', indexed: false },
    ],
  },
] as const

// Localnet BoardGovernance address - deployed via DeployBoardGovernance.s.sol
const BOARD_GOVERNANCE_ADDRESS: Address =
  '0x63fea6e447f120b8faf85b53cdad8348e645d80e'

// Default operator key (localnet only)
const DEFAULT_OPERATOR_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

export interface ProposalSubmission {
  daoId: string
  proposalType: number
  contentHash: string
  targetContract?: Address
  callData?: `0x${string}`
  value?: bigint
}

export interface OnChainProposal {
  proposalId: string
  proposer: Address
  proposalType: number
  status: number
  createdAt: number
  contentHash: string
  targetContract: Address
  value: string
}

// Vote choice enum matching contract
export const VoteChoice = {
  APPROVE: 0,
  REJECT: 1,
  ABSTAIN: 2,
} as const
export type VoteChoiceType = (typeof VoteChoice)[keyof typeof VoteChoice]

export interface VoteSubmission {
  proposalId: string
  agentId: bigint
  vote: VoteChoiceType
  reasoningHash: string
}

export interface OnChainVote {
  agentId: string
  vote: VoteChoiceType
  reasoningHash: string
  votedAt: number
}

export interface VoteCounts {
  approvals: number
  rejections: number
  abstentions: number
}

export interface DirectorDecisionSubmission {
  proposalId: string
  approved: boolean
  decisionHash: string // Hash of reasoning stored off-chain
}

function getChain(): Chain {
  const chainId = getChainId()
  if (chainId === 31337) {
    return anvil
  }
  // Add other chains as needed
  return anvil
}

class ProposalService {
  private publicClient
  private walletClient
  private contractAddress: Address

  constructor() {
    const rpcUrl = getRpcUrl()
    const chain = getChain()
    const operatorKey = process.env.OPERATOR_PRIVATE_KEY ?? DEFAULT_OPERATOR_KEY
    const account = privateKeyToAccount(operatorKey as `0x${string}`)

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    })

    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    })

    this.contractAddress = BOARD_GOVERNANCE_ADDRESS
  }

  /**
   * Submit a proposal on-chain
   */
  async submitProposal(params: ProposalSubmission): Promise<{
    txHash: Hash
    proposalId: string
  }> {
    // Convert daoId to bytes32 if it's not already
    const daoIdBytes = params.daoId.startsWith('0x')
      ? (params.daoId as `0x${string}`)
      : toHex(params.daoId, { size: 32 })

    // Convert contentHash to bytes32
    const contentHashBytes = params.contentHash.startsWith('0x')
      ? (params.contentHash as `0x${string}`)
      : toHex(params.contentHash, { size: 32 })

    const { request, result } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi: BOARD_GOVERNANCE_ABI,
      functionName: 'submitProposal',
      args: [
        daoIdBytes,
        params.proposalType,
        contentHashBytes,
        params.targetContract ?? '0x0000000000000000000000000000000000000000',
        params.callData ?? '0x',
        params.value ?? 0n,
      ],
      account: this.walletClient.account,
    })

    const txHash = await this.walletClient.writeContract(request)

    // Wait for confirmation
    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    return {
      txHash,
      proposalId: result as string,
    }
  }

  /**
   * Get proposal by ID
   */
  async getProposal(proposalId: string): Promise<OnChainProposal | null> {
    try {
      const proposalIdBytes = proposalId.startsWith('0x')
        ? (proposalId as `0x${string}`)
        : toHex(proposalId, { size: 32 })

      const result = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: BOARD_GOVERNANCE_ABI,
        functionName: 'getProposal',
        args: [proposalIdBytes],
      })

      // Check if proposal exists (proposalId != 0)
      if (result.proposalId === '0x' + '0'.repeat(64)) {
        return null
      }

      return {
        proposalId: result.proposalId,
        proposer: result.proposer,
        proposalType: result.proposalType,
        status: result.status,
        createdAt: Number(result.createdAt),
        contentHash: result.contentHash,
        targetContract: result.targetContract,
        value: result.value.toString(),
      }
    } catch {
      return null
    }
  }

  /**
   * Get all proposal IDs for a DAO
   */
  async getProposalsByDAO(daoId: string): Promise<string[]> {
    const daoIdBytes = daoId.startsWith('0x')
      ? (daoId as `0x${string}`)
      : toHex(daoId, { size: 32 })

    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BOARD_GOVERNANCE_ABI,
      functionName: 'getProposalsByDAO',
      args: [daoIdBytes],
    })

    return result as string[]
  }

  /**
   * Get proposal count for a DAO
   */
  async getProposalCount(daoId: string): Promise<number> {
    const daoIdBytes = daoId.startsWith('0x')
      ? (daoId as `0x${string}`)
      : toHex(daoId, { size: 32 })

    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BOARD_GOVERNANCE_ABI,
      functionName: 'proposalCount',
      args: [daoIdBytes],
    })

    return Number(result)
  }

  /**
   * Cast a vote on a proposal (on-chain)
   */
  async castVote(params: VoteSubmission): Promise<{ txHash: Hash }> {
    const proposalIdBytes = params.proposalId.startsWith('0x')
      ? (params.proposalId as `0x${string}`)
      : toHex(params.proposalId, { size: 32 })

    const reasoningHashBytes = params.reasoningHash.startsWith('0x')
      ? (params.reasoningHash as `0x${string}`)
      : toHex(params.reasoningHash, { size: 32 })

    const { request } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi: BOARD_GOVERNANCE_ABI,
      functionName: 'castVote',
      args: [proposalIdBytes, params.agentId, params.vote, reasoningHashBytes],
      account: this.walletClient.account,
    })

    const txHash = await this.walletClient.writeContract(request)
    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    return { txHash }
  }

  /**
   * Get all votes for a proposal
   */
  async getVotes(proposalId: string): Promise<OnChainVote[]> {
    const proposalIdBytes = proposalId.startsWith('0x')
      ? (proposalId as `0x${string}`)
      : toHex(proposalId, { size: 32 })

    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BOARD_GOVERNANCE_ABI,
      functionName: 'getVotes',
      args: [proposalIdBytes],
    })

    return (result as readonly { agentId: bigint; vote: number; reasoningHash: `0x${string}`; votedAt: bigint }[]).map((v) => ({
      agentId: v.agentId.toString(),
      vote: v.vote as VoteChoiceType,
      reasoningHash: v.reasoningHash,
      votedAt: Number(v.votedAt),
    }))
  }

  /**
   * Get vote counts for a proposal
   */
  async getVoteCounts(proposalId: string): Promise<VoteCounts> {
    const proposalIdBytes = proposalId.startsWith('0x')
      ? (proposalId as `0x${string}`)
      : toHex(proposalId, { size: 32 })

    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BOARD_GOVERNANCE_ABI,
      functionName: 'getVoteCounts',
      args: [proposalIdBytes],
    })

    const [approvals, rejections, abstentions] = result as [bigint, bigint, bigint]
    return {
      approvals: Number(approvals),
      rejections: Number(rejections),
      abstentions: Number(abstentions),
    }
  }

  /**
   * Check if an agent has voted on a proposal
   */
  async hasVoted(proposalId: string, agentId: bigint): Promise<boolean> {
    const proposalIdBytes = proposalId.startsWith('0x')
      ? (proposalId as `0x${string}`)
      : toHex(proposalId, { size: 32 })

    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BOARD_GOVERNANCE_ABI,
      functionName: 'hasVoted',
      args: [proposalIdBytes, agentId],
    })

    return result as boolean
  }

  /**
   * Submit director decision (on-chain, immutable once set)
   */
  async submitDirectorDecision(params: DirectorDecisionSubmission): Promise<{ txHash: Hash }> {
    const proposalIdBytes = params.proposalId.startsWith('0x')
      ? (params.proposalId as `0x${string}`)
      : toHex(params.proposalId, { size: 32 })

    const decisionHashBytes = params.decisionHash.startsWith('0x')
      ? (params.decisionHash as `0x${string}`)
      : toHex(params.decisionHash, { size: 32 })

    const { request } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi: BOARD_GOVERNANCE_ABI,
      functionName: 'setDirectorApproval',
      args: [proposalIdBytes, params.approved, decisionHashBytes],
      account: this.walletClient.account,
    })

    const txHash = await this.walletClient.writeContract(request)
    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    return { txHash }
  }

  /**
   * Check if director has decided on a proposal
   */
  async isDirectorDecided(proposalId: string): Promise<boolean> {
    const proposalIdBytes = proposalId.startsWith('0x')
      ? (proposalId as `0x${string}`)
      : toHex(proposalId, { size: 32 })

    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BOARD_GOVERNANCE_ABI,
      functionName: 'isDirectorDecided',
      args: [proposalIdBytes],
    })

    return result as boolean
  }
}

// Singleton instance
let proposalServiceInstance: ProposalService | null = null

export function getProposalService(): ProposalService {
  if (!proposalServiceInstance) {
    proposalServiceInstance = new ProposalService()
  }
  return proposalServiceInstance
}

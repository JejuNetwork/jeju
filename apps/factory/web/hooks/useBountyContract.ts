/**
 * Bounty Contract Hooks
 * Provides on-chain bounty creation with escrow via the BountyRegistry contract
 */

import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Address, Hash } from 'viem'
import { parseEther, zeroAddress } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { getContractAddressSafe } from '../config/contracts'

// BountyRegistry ABI - subset for bounty creation and management
const bountyRegistryAbi = [
  {
    type: 'function',
    name: 'createBounty',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'specUri', type: 'string' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      {
        name: 'rewards',
        type: 'tuple[]',
        components: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      { name: 'milestoneTitles', type: 'string[]' },
      { name: 'milestoneDescriptions', type: 'string[]' },
      { name: 'milestonePercentages', type: 'uint256[]' },
      { name: 'requiredSkills', type: 'string[]' },
    ],
    outputs: [{ name: 'bountyId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'cancelBounty',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'applyForBounty',
    inputs: [
      { name: 'bountyId', type: 'bytes32' },
      { name: 'proposalUri', type: 'string' },
      { name: 'estimatedDuration', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'acceptApplication',
    inputs: [
      { name: 'bountyId', type: 'bytes32' },
      { name: 'applicantIndex', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'submitMilestone',
    inputs: [
      { name: 'bountyId', type: 'bytes32' },
      { name: 'deliverableUri', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'creatorApproveMilestone',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'creatorRejectMilestone',
    inputs: [
      { name: 'bountyId', type: 'bytes32' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getBounty',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'bountyId', type: 'bytes32' },
          { name: 'creator', type: 'address' },
          { name: 'creatorAgentId', type: 'uint256' },
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'specUri', type: 'string' },
          {
            name: 'creatorStake',
            type: 'tuple',
            components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
          },
          { name: 'deadline', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'assignee', type: 'address' },
          { name: 'assigneeAgentId', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'completedAt', type: 'uint256' },
          { name: 'currentMilestone', type: 'uint256' },
          { name: 'disputeCaseId', type: 'bytes32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getMilestones',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'percentage', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'deliverableUri', type: 'string' },
          { name: 'submittedAt', type: 'uint256' },
          { name: 'approvedAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getApplications',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'applicant', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'proposalUri', type: 'string' },
          { name: 'estimatedDuration', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'appliedAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'CREATOR_STAKE_BPS',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export interface CreateBountyOnChainParams {
  title: string
  description: string
  specUri: string
  deadline: number
  rewardAmount: string // in ETH
  milestoneTitles: string[]
  milestoneDescriptions: string[]
  milestonePercentages: number[] // basis points, must sum to 10000
  requiredSkills: string[]
}

export interface OnChainBounty {
  bountyId: Hash
  creator: Address
  title: string
  description: string
  specUri: string
  deadline: bigint
  status: number
  assignee: Address
  createdAt: bigint
  completedAt: bigint
  currentMilestone: bigint
  creatorStake: {
    token: Address
    amount: bigint
  }
}

export interface OnChainMilestone {
  title: string
  description: string
  percentage: bigint
  status: number
  deliverableUri: string
  submittedAt: bigint
  approvedAt: bigint
}

/**
 * Check if the BountyRegistry contract is available
 */
export function useBountyContractAvailable(): boolean {
  const address = getContractAddressSafe('bountyRegistry')
  return address !== null && address !== zeroAddress
}

/**
 * Get the bounty registry contract address
 */
export function useBountyRegistryAddress(): Address | null {
  return getContractAddressSafe('bountyRegistry')
}

/**
 * Get the creator stake percentage (10% = 1000 basis points)
 */
export function useCreatorStakeBps() {
  const address = useBountyRegistryAddress()

  return useReadContract({
    address: address ?? undefined,
    abi: bountyRegistryAbi,
    functionName: 'CREATOR_STAKE_BPS',
    query: { enabled: !!address },
  })
}

/**
 * Create a bounty on-chain with escrow
 */
export function useCreateBountyOnChain() {
  const queryClient = useQueryClient()
  const { address: userAddress } = useAccount()
  const bountyRegistryAddress = useBountyRegistryAddress()

  const { writeContract, data: txHash, isPending, reset } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const createBounty = async (params: CreateBountyOnChainParams) => {
    if (!bountyRegistryAddress) {
      toast.error('BountyRegistry contract not deployed')
      throw new Error('BountyRegistry contract not deployed')
    }

    if (!userAddress) {
      toast.error('Please connect your wallet')
      throw new Error('Wallet not connected')
    }

    // Calculate total value needed (reward + 10% stake)
    const rewardWei = parseEther(params.rewardAmount)
    const stakeWei = (rewardWei * BigInt(1000)) / BigInt(10000) // 10% stake
    const totalValue = rewardWei + stakeWei

    // Validate milestones sum to 10000
    const totalPercentage = params.milestonePercentages.reduce(
      (a, b) => a + b,
      0,
    )
    if (totalPercentage !== 10000) {
      toast.error('Milestone percentages must sum to 100%')
      throw new Error('Invalid milestone percentages')
    }

    try {
      writeContract({
        address: bountyRegistryAddress,
        abi: bountyRegistryAbi,
        functionName: 'createBounty',
        args: [
          {
            title: params.title,
            description: params.description,
            specUri: params.specUri,
            deadline: BigInt(params.deadline),
          },
          [{ token: zeroAddress, amount: rewardWei }], // ETH reward
          params.milestoneTitles,
          params.milestoneDescriptions,
          params.milestonePercentages.map((p) => BigInt(p)),
          params.requiredSkills,
        ],
        value: totalValue,
      })
    } catch (error) {
      console.error('Failed to create bounty:', error)
      throw error
    }
  }

  // Invalidate queries when transaction succeeds
  if (isSuccess) {
    queryClient.invalidateQueries({ queryKey: ['bounties'] })
    queryClient.invalidateQueries({ queryKey: ['bountyStats'] })
  }

  return {
    createBounty,
    txHash,
    isPending,
    isConfirming,
    isSuccess,
    reset,
  }
}

/**
 * Cancel a bounty and get refund
 */
export function useCancelBounty() {
  const queryClient = useQueryClient()
  const bountyRegistryAddress = useBountyRegistryAddress()

  const { writeContract, data: txHash, isPending, reset } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const cancelBounty = async (bountyId: Hash) => {
    if (!bountyRegistryAddress) {
      throw new Error('BountyRegistry contract not deployed')
    }

    writeContract({
      address: bountyRegistryAddress,
      abi: bountyRegistryAbi,
      functionName: 'cancelBounty',
      args: [bountyId],
    })
  }

  if (isSuccess) {
    queryClient.invalidateQueries({ queryKey: ['bounties'] })
  }

  return {
    cancelBounty,
    txHash,
    isPending,
    isConfirming,
    isSuccess,
    reset,
  }
}

/**
 * Apply for a bounty
 */
export function useApplyForBounty() {
  const bountyRegistryAddress = useBountyRegistryAddress()
  const { writeContract, data: txHash, isPending, reset } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const apply = async (
    bountyId: Hash,
    proposalUri: string,
    estimatedDuration: number,
  ) => {
    if (!bountyRegistryAddress) {
      throw new Error('BountyRegistry contract not deployed')
    }

    writeContract({
      address: bountyRegistryAddress,
      abi: bountyRegistryAbi,
      functionName: 'applyForBounty',
      args: [bountyId, proposalUri, BigInt(estimatedDuration)],
    })
  }

  return {
    apply,
    txHash,
    isPending,
    isConfirming,
    isSuccess,
    reset,
  }
}

/**
 * Accept an application (bounty creator only)
 */
export function useAcceptApplication() {
  const bountyRegistryAddress = useBountyRegistryAddress()
  const { writeContract, data: txHash, isPending, reset } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const accept = async (bountyId: Hash, applicantIndex: number) => {
    if (!bountyRegistryAddress) {
      throw new Error('BountyRegistry contract not deployed')
    }

    writeContract({
      address: bountyRegistryAddress,
      abi: bountyRegistryAbi,
      functionName: 'acceptApplication',
      args: [bountyId, BigInt(applicantIndex)],
    })
  }

  return {
    accept,
    txHash,
    isPending,
    isConfirming,
    isSuccess,
    reset,
  }
}

/**
 * Submit milestone deliverables (assignee only)
 */
export function useSubmitMilestone() {
  const bountyRegistryAddress = useBountyRegistryAddress()
  const { writeContract, data: txHash, isPending, reset } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const submit = async (bountyId: Hash, deliverableUri: string) => {
    if (!bountyRegistryAddress) {
      throw new Error('BountyRegistry contract not deployed')
    }

    writeContract({
      address: bountyRegistryAddress,
      abi: bountyRegistryAbi,
      functionName: 'submitMilestone',
      args: [bountyId, deliverableUri],
    })
  }

  return {
    submit,
    txHash,
    isPending,
    isConfirming,
    isSuccess,
    reset,
  }
}

/**
 * Approve a milestone (bounty creator only)
 */
export function useApproveMilestone() {
  const bountyRegistryAddress = useBountyRegistryAddress()
  const { writeContract, data: txHash, isPending, reset } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const approve = async (bountyId: Hash) => {
    if (!bountyRegistryAddress) {
      throw new Error('BountyRegistry contract not deployed')
    }

    writeContract({
      address: bountyRegistryAddress,
      abi: bountyRegistryAbi,
      functionName: 'creatorApproveMilestone',
      args: [bountyId],
    })
  }

  return {
    approve,
    txHash,
    isPending,
    isConfirming,
    isSuccess,
    reset,
  }
}

/**
 * Reject a milestone (bounty creator only)
 */
export function useRejectMilestone() {
  const bountyRegistryAddress = useBountyRegistryAddress()
  const { writeContract, data: txHash, isPending, reset } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const reject = async (bountyId: Hash, reason: string) => {
    if (!bountyRegistryAddress) {
      throw new Error('BountyRegistry contract not deployed')
    }

    writeContract({
      address: bountyRegistryAddress,
      abi: bountyRegistryAbi,
      functionName: 'creatorRejectMilestone',
      args: [bountyId, reason],
    })
  }

  return {
    reject,
    txHash,
    isPending,
    isConfirming,
    isSuccess,
    reset,
  }
}

/**
 * Read on-chain bounty data
 */
export function useOnChainBounty(bountyId: Hash | undefined) {
  const bountyRegistryAddress = useBountyRegistryAddress()

  const { data: bounty, isLoading: bountyLoading } = useReadContract({
    address: bountyRegistryAddress ?? undefined,
    abi: bountyRegistryAbi,
    functionName: 'getBounty',
    args: bountyId ? [bountyId] : undefined,
    query: { enabled: !!bountyRegistryAddress && !!bountyId },
  })

  const { data: milestones, isLoading: milestonesLoading } = useReadContract({
    address: bountyRegistryAddress ?? undefined,
    abi: bountyRegistryAbi,
    functionName: 'getMilestones',
    args: bountyId ? [bountyId] : undefined,
    query: { enabled: !!bountyRegistryAddress && !!bountyId },
  })

  const { data: applications, isLoading: applicationsLoading } =
    useReadContract({
      address: bountyRegistryAddress ?? undefined,
      abi: bountyRegistryAbi,
      functionName: 'getApplications',
      args: bountyId ? [bountyId] : undefined,
      query: { enabled: !!bountyRegistryAddress && !!bountyId },
    })

  return {
    bounty: bounty as OnChainBounty | undefined,
    milestones: milestones as OnChainMilestone[] | undefined,
    applications,
    isLoading: bountyLoading || milestonesLoading || applicationsLoading,
  }
}

/**
 * Calculate the required stake for a given reward amount
 */
export function calculateRequiredStake(rewardAmount: string): string {
  try {
    const rewardWei = parseEther(rewardAmount)
    const stakeWei = (rewardWei * BigInt(1000)) / BigInt(10000) // 10%
    return (Number(stakeWei) / 1e18).toFixed(4)
  } catch {
    return '0'
  }
}

/**
 * Calculate total ETH needed (reward + stake)
 */
export function calculateTotalRequired(rewardAmount: string): string {
  try {
    const rewardWei = parseEther(rewardAmount)
    const stakeWei = (rewardWei * BigInt(1000)) / BigInt(10000)
    const totalWei = rewardWei + stakeWei
    return (Number(totalWei) / 1e18).toFixed(4)
  } catch {
    return '0'
  }
}

/**
 * Node Staking Hook
 *
 * Provides contract interactions for node staking on the Jeju Network.
 * Uses wagmi's useWriteContract for actual on-chain transactions.
 */

import { useCallback } from 'react'
import type { Address, Hex } from 'viem'
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'

// Region enum matching the contract
export const Region = {
  NorthAmerica: 0,
  SouthAmerica: 1,
  Europe: 2,
  Asia: 3,
  Africa: 4,
  Oceania: 5,
  Global: 6,
} as const

export type RegionKey = keyof typeof Region
export type RegionValue = (typeof Region)[RegionKey]

// NodeStakingManager ABI (subset for registration)
const NODE_STAKING_MANAGER_ABI = [
  {
    name: 'registerNode',
    type: 'function',
    inputs: [
      { name: 'stakingToken', type: 'address' },
      { name: 'stakeAmount', type: 'uint256' },
      { name: 'rewardToken', type: 'address' },
      { name: 'rpcUrl', type: 'string' },
      { name: 'region', type: 'uint8' },
    ],
    outputs: [{ name: 'nodeId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'deactivateNode',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'claimRewards',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [{ name: 'rewardAmount', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'minStakeUSD',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'baseRewardPerMonthUSD',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getOperatorNodes',
    type: 'function',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    name: 'calculatePendingRewards',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// ERC20 approval ABI
const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export interface RegisterNodeParams {
  stakingToken: Address
  stakeAmount: bigint
  rewardToken: Address
  rpcUrl: string
  region: RegionValue
}

export interface UseNodeStakingResult {
  // Contract state
  minStakeUSD: bigint | undefined
  baseRewardPerMonthUSD: bigint | undefined
  operatorNodes: Hex[] | undefined

  // Approval
  approveStaking: (token: Address, amount: bigint) => void
  isApproving: boolean
  isApprovalSuccess: boolean
  approvalHash: Hex | undefined

  // Registration
  registerNode: (params: RegisterNodeParams) => void
  isRegistering: boolean
  isRegistrationSuccess: boolean
  registrationHash: Hex | undefined

  // Claim rewards
  claimRewards: (nodeId: Hex) => void
  isClaiming: boolean
  isClaimSuccess: boolean
  claimHash: Hex | undefined

  // Deactivate
  deactivateNode: (nodeId: Hex) => void
  isDeactivating: boolean
  isDeactivateSuccess: boolean
  deactivateHash: Hex | undefined

  // Pending rewards
  getPendingRewards: (nodeId: Hex) => bigint | undefined

  // Refetch
  refetch: () => void
}

export function useNodeStaking(
  stakingManagerAddress: Address | undefined,
  operatorAddress: Address | undefined,
): UseNodeStakingResult {
  // Read minimum stake
  const { data: minStakeUSD, refetch: refetchMinStake } = useReadContract({
    address: stakingManagerAddress,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'minStakeUSD',
    query: { enabled: !!stakingManagerAddress },
  })

  // Read base reward
  const { data: baseRewardPerMonthUSD, refetch: refetchBaseReward } =
    useReadContract({
      address: stakingManagerAddress,
      abi: NODE_STAKING_MANAGER_ABI,
      functionName: 'baseRewardPerMonthUSD',
      query: { enabled: !!stakingManagerAddress },
    })

  // Read operator's nodes
  const { data: operatorNodes, refetch: refetchNodes } = useReadContract({
    address: stakingManagerAddress,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'getOperatorNodes',
    args: operatorAddress ? [operatorAddress] : undefined,
    query: { enabled: !!stakingManagerAddress && !!operatorAddress },
  })

  // Approval transaction
  const {
    writeContract: writeApprove,
    data: approvalHash,
    isPending: isApprovalPending,
  } = useWriteContract()
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalSuccess } =
    useWaitForTransactionReceipt({ hash: approvalHash })

  // Registration transaction
  const {
    writeContract: writeRegister,
    data: registrationHash,
    isPending: isRegistrationPending,
  } = useWriteContract()
  const {
    isLoading: isRegistrationConfirming,
    isSuccess: isRegistrationSuccess,
  } = useWaitForTransactionReceipt({ hash: registrationHash })

  // Claim transaction
  const {
    writeContract: writeClaim,
    data: claimHash,
    isPending: isClaimPending,
  } = useWriteContract()
  const { isLoading: isClaimConfirming, isSuccess: isClaimSuccess } =
    useWaitForTransactionReceipt({ hash: claimHash })

  // Deactivate transaction
  const {
    writeContract: writeDeactivate,
    data: deactivateHash,
    isPending: isDeactivatePending,
  } = useWriteContract()
  const { isLoading: isDeactivateConfirming, isSuccess: isDeactivateSuccess } =
    useWaitForTransactionReceipt({ hash: deactivateHash })

  const approveStaking = useCallback(
    (token: Address, amount: bigint) => {
      if (!stakingManagerAddress) {
        throw new Error('Staking manager address not configured')
      }
      writeApprove({
        address: token,
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [stakingManagerAddress, amount],
      })
    },
    [stakingManagerAddress, writeApprove],
  )

  const registerNode = useCallback(
    (params: RegisterNodeParams) => {
      if (!stakingManagerAddress) {
        throw new Error('Staking manager address not configured')
      }
      writeRegister({
        address: stakingManagerAddress,
        abi: NODE_STAKING_MANAGER_ABI,
        functionName: 'registerNode',
        args: [
          params.stakingToken,
          params.stakeAmount,
          params.rewardToken,
          params.rpcUrl,
          params.region,
        ],
      })
    },
    [stakingManagerAddress, writeRegister],
  )

  const claimRewards = useCallback(
    (nodeId: Hex) => {
      if (!stakingManagerAddress) {
        throw new Error('Staking manager address not configured')
      }
      writeClaim({
        address: stakingManagerAddress,
        abi: NODE_STAKING_MANAGER_ABI,
        functionName: 'claimRewards',
        args: [nodeId],
      })
    },
    [stakingManagerAddress, writeClaim],
  )

  const deactivateNode = useCallback(
    (nodeId: Hex) => {
      if (!stakingManagerAddress) {
        throw new Error('Staking manager address not configured')
      }
      writeDeactivate({
        address: stakingManagerAddress,
        abi: NODE_STAKING_MANAGER_ABI,
        functionName: 'deactivateNode',
        args: [nodeId],
      })
    },
    [stakingManagerAddress, writeDeactivate],
  )

  // For pending rewards, we need a separate read per nodeId
  // This is a simple version - caller passes nodeId
  const getPendingRewards = useCallback((_nodeId: Hex): bigint | undefined => {
    // This would need to be a separate useReadContract per node
    // For now, return undefined - the caller should use useReadContract directly
    return undefined
  }, [])

  const refetch = useCallback(() => {
    refetchMinStake()
    refetchBaseReward()
    refetchNodes()
  }, [refetchMinStake, refetchBaseReward, refetchNodes])

  return {
    minStakeUSD: minStakeUSD as bigint | undefined,
    baseRewardPerMonthUSD: baseRewardPerMonthUSD as bigint | undefined,
    operatorNodes: operatorNodes as Hex[] | undefined,

    approveStaking,
    isApproving: isApprovalPending || isApprovalConfirming,
    isApprovalSuccess,
    approvalHash,

    registerNode,
    isRegistering: isRegistrationPending || isRegistrationConfirming,
    isRegistrationSuccess,
    registrationHash,

    claimRewards,
    isClaiming: isClaimPending || isClaimConfirming,
    isClaimSuccess,
    claimHash,

    deactivateNode,
    isDeactivating: isDeactivatePending || isDeactivateConfirming,
    isDeactivateSuccess,
    deactivateHash,

    getPendingRewards,
    refetch,
  }
}

import type { Address } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import {
  getNodeStakingAddress,
  NODE_STAKING_MANAGER_ABI,
  type NodeStake,
  type OperatorStats,
  type PerformanceMetrics,
  type Region,
} from '../../lib/nodeStaking'
import { useTypedWriteContract } from './useTypedWriteContract'

export function useNodeStaking() {
  const stakingManager = getNodeStakingAddress()
  const { address: userAddress } = useAccount()

  const { data: operatorNodeIds, refetch: refetchNodes } = useReadContract({
    address: stakingManager,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'getOperatorNodes',
    args: userAddress ? [userAddress] : undefined,
  })

  const { data: operatorStats } = useReadContract({
    address: stakingManager,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'getOperatorStats',
    args: userAddress ? [userAddress] : undefined,
  })

  const { data: networkStats } = useReadContract({
    address: stakingManager,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'getNetworkStats',
  })

  const {
    write: register,
    isPending: isRegistering,
    isConfirming: isConfirmingRegister,
    isSuccess: isRegisterSuccess,
  } = useTypedWriteContract()

  const registerNode = async (
    stakingToken: Address,
    stakeAmount: bigint,
    rewardToken: Address,
    rpcUrl: string,
    region: Region,
  ) => {
    register({
      address: stakingManager,
      abi: NODE_STAKING_MANAGER_ABI,
      functionName: 'registerNode',
      args: [stakingToken, stakeAmount, rewardToken, rpcUrl, region],
    })
  }

  const {
    write: deregister,
    isPending: isDeregistering,
    isConfirming: isConfirmingDeregister,
    isSuccess: isDeregisterSuccess,
  } = useTypedWriteContract()

  const deregisterNode = async (nodeId: string) => {
    deregister({
      address: stakingManager,
      abi: NODE_STAKING_MANAGER_ABI,
      functionName: 'deregisterNode',
      args: [nodeId as `0x${string}`],
    })
  }

  return {
    operatorNodeIds: operatorNodeIds
      ? [...(operatorNodeIds as `0x${string}`[])]
      : [],
    operatorStats: operatorStats as OperatorStats | undefined,
    networkStats: networkStats as [bigint, bigint, bigint] | undefined,
    registerNode,
    deregisterNode,
    isRegistering: isRegistering || isConfirmingRegister,
    isDeregistering: isDeregistering || isConfirmingDeregister,
    isRegisterSuccess,
    isDeregisterSuccess,
    refetchNodes,
  }
}

export function useNodeInfo(nodeId: string | undefined) {
  const stakingManager = getNodeStakingAddress()

  const { data: nodeInfo, refetch } = useReadContract({
    address: stakingManager,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'getNodeInfo',
    args: nodeId ? [nodeId as `0x${string}`] : undefined,
  })

  return {
    nodeInfo: nodeInfo as [NodeStake, PerformanceMetrics, bigint] | undefined,
    refetch,
  }
}

export function useNodeRewards(nodeId: string | undefined) {
  const stakingManager = getNodeStakingAddress()

  const { data: pendingRewardsUSD } = useReadContract({
    address: stakingManager,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'calculatePendingRewards',
    args: nodeId ? [nodeId as `0x${string}`] : undefined,
  })

  const {
    write: claim,
    isPending: isClaiming,
    isConfirming: isConfirmingClaim,
    isSuccess: isClaimSuccess,
  } = useTypedWriteContract()

  const claimRewards = async (nodeIdToClaim: string) => {
    claim({
      address: stakingManager,
      abi: NODE_STAKING_MANAGER_ABI,
      functionName: 'claimRewards',
      args: [nodeIdToClaim as `0x${string}`],
    })
  }

  return {
    pendingRewardsUSD: pendingRewardsUSD as bigint | undefined,
    claimRewards,
    isClaiming: isClaiming || isConfirmingClaim,
    isClaimSuccess,
  }
}

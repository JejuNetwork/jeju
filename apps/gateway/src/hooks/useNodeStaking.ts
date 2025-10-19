/**
 * @fileoverview Hook for interacting with NodeStakingManager contract
 * @module gateway/hooks/useNodeStaking
 */

import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { NODE_STAKING_MANAGER_ABI, getNodeStakingAddress, type NodeStake, type PerformanceMetrics, type OperatorStats, Region } from '../lib/nodeStaking';
import { Address } from 'viem';

export function useNodeStaking() {
  const stakingManager = getNodeStakingAddress();
  const { address: userAddress } = useAccount();

  // Read operator's nodes
  const { data: operatorNodeIds, refetch: refetchNodes } = useReadContract({
    address: stakingManager,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'getOperatorNodes',
    args: userAddress ? [userAddress] : undefined,
  });

  // Read operator stats
  const { data: operatorStats } = useReadContract({
    address: stakingManager,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'getOperatorStats',
    args: userAddress ? [userAddress] : undefined,
  });

  // Read network stats
  const { data: networkStats } = useReadContract({
    address: stakingManager,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'getNetworkStats',
  });

  // Write: Register node
  const { writeContract: register, data: registerHash, isPending: isRegistering } = useWriteContract();
  const { isLoading: isConfirmingRegister, isSuccess: isRegisterSuccess } = useWaitForTransactionReceipt({ hash: registerHash });

  const registerNode = async (
    stakingToken: Address,
    stakeAmount: bigint,
    rewardToken: Address,
    rpcUrl: string,
    region: Region
  ) => {
    register({
      address: stakingManager,
      abi: NODE_STAKING_MANAGER_ABI,
      functionName: 'registerNode',
      args: [stakingToken, stakeAmount, rewardToken, rpcUrl, region],
    });
  };

  // Write: Deregister node
  const { writeContract: deregister, data: deregisterHash, isPending: isDeregistering } = useWriteContract();
  const { isLoading: isConfirmingDeregister, isSuccess: isDeregisterSuccess } = useWaitForTransactionReceipt({ hash: deregisterHash });

  const deregisterNode = async (nodeId: string) => {
    deregister({
      address: stakingManager,
      abi: NODE_STAKING_MANAGER_ABI,
      functionName: 'deregisterNode',
      args: [nodeId as `0x${string}`],
    });
  };

  return {
    operatorNodeIds: (operatorNodeIds as string[]) || [],
    operatorStats: operatorStats as OperatorStats | undefined,
    networkStats: networkStats as [bigint, bigint, bigint] | undefined,
    registerNode,
    deregisterNode,
    isRegistering: isRegistering || isConfirmingRegister,
    isDeregistering: isDeregistering || isConfirmingDeregister,
    isRegisterSuccess,
    isDeregisterSuccess,
    refetchNodes,
  };
}

export function useNodeInfo(nodeId: string | undefined) {
  const stakingManager = getNodeStakingAddress();

  const { data: nodeInfo, refetch } = useReadContract({
    address: stakingManager,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'getNodeInfo',
    args: nodeId ? [nodeId as `0x${string}`] : undefined,
  });

  return {
    nodeInfo: nodeInfo as [NodeStake, PerformanceMetrics, bigint] | undefined,
    refetch,
  };
}

export function useNodeRewards(nodeId: string | undefined) {
  const stakingManager = getNodeStakingAddress();

  // Read pending rewards
  const { data: pendingRewardsUSD } = useReadContract({
    address: stakingManager,
    abi: NODE_STAKING_MANAGER_ABI,
    functionName: 'calculatePendingRewards',
    args: nodeId ? [nodeId as `0x${string}`] : undefined,
  });

  // Write: Claim rewards
  const { writeContract: claim, data: claimHash, isPending: isClaiming } = useWriteContract();
  const { isLoading: isConfirmingClaim, isSuccess: isClaimSuccess } = useWaitForTransactionReceipt({ hash: claimHash });

  const claimRewards = async (nodeIdToClaim: string) => {
    claim({
      address: stakingManager,
      abi: NODE_STAKING_MANAGER_ABI,
      functionName: 'claimRewards',
      args: [nodeIdToClaim as `0x${string}`],
    });
  };

  return {
    pendingRewardsUSD: pendingRewardsUSD as bigint | undefined,
    claimRewards,
    isClaiming: isClaiming || isConfirmingClaim,
    isClaimSuccess,
  };
}


/**
 * Contract interaction hooks for Factory
 */

import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { type Address, parseEther, formatEther } from 'viem';
import { getContractAddress, getContractAddressSafe } from '@/config/contracts';

// ============ ABI Fragments ============

const BOUNTY_REGISTRY_ABI = [
  {
    name: 'createBounty',
    type: 'function',
    inputs: [
      { name: 'params', type: 'tuple', components: [
        { name: 'title', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'specUri', type: 'string' },
        { name: 'deadline', type: 'uint256' },
      ]},
      { name: 'rewards', type: 'tuple[]', components: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ]},
      { name: 'milestoneTitles', type: 'string[]' },
      { name: 'milestoneDescriptions', type: 'string[]' },
      { name: 'milestonePercentages', type: 'uint256[]' },
      { name: 'requiredSkills', type: 'string[]' },
    ],
    outputs: [{ name: 'bountyId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'getBounty',
    type: 'function',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'bountyId', type: 'bytes32' },
        { name: 'creator', type: 'address' },
        { name: 'title', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'status', type: 'uint8' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    name: 'applyForBounty',
    type: 'function',
    inputs: [
      { name: 'bountyId', type: 'bytes32' },
      { name: 'proposalUri', type: 'string' },
      { name: 'estimatedDuration', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

const MODEL_REGISTRY_ABI = [
  {
    name: 'createModel',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'organization', type: 'string' },
      { name: 'modelType', type: 'uint8' },
      { name: 'license', type: 'uint8' },
      { name: 'licenseUri', type: 'string' },
      { name: 'accessLevel', type: 'uint8' },
      { name: 'description', type: 'string' },
      { name: 'tags', type: 'string[]' },
    ],
    outputs: [{ name: 'modelId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'getModel',
    type: 'function',
    inputs: [{ name: 'modelId', type: 'bytes32' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'modelId', type: 'bytes32' },
        { name: 'name', type: 'string' },
        { name: 'organization', type: 'string' },
        { name: 'owner', type: 'address' },
        { name: 'description', type: 'string' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    name: 'downloadModel',
    type: 'function',
    inputs: [{ name: 'modelId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'toggleStar',
    type: 'function',
    inputs: [{ name: 'modelId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

const GUARDIAN_REGISTRY_ABI = [
  {
    name: 'registerGuardian',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'specializations', type: 'string[]' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'getGuardian',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'agentId', type: 'uint256' },
        { name: 'owner', type: 'address' },
        { name: 'tier', type: 'uint8' },
        { name: 'stakedAmount', type: 'uint256' },
        { name: 'isActive', type: 'bool' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    name: 'submitReview',
    type: 'function',
    inputs: [
      { name: 'subjectId', type: 'bytes32' },
      { name: 'subjectType', type: 'string' },
      { name: 'action', type: 'uint8' },
      { name: 'commentUri', type: 'string' },
      { name: 'suggestions', type: 'string[]' },
    ],
    outputs: [{ name: 'reviewId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
] as const;

// ============ Bounty Hooks ============

export function useBounty(bountyId: `0x${string}` | undefined) {
  const address = getContractAddressSafe('bountyRegistry');
  
  return useReadContract({
    address: address || undefined,
    abi: BOUNTY_REGISTRY_ABI,
    functionName: 'getBounty',
    args: bountyId ? [bountyId] : undefined,
    query: {
      enabled: !!bountyId && !!address,
    },
  });
}

export function useCreateBounty() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const createBounty = async (params: {
    title: string;
    description: string;
    specUri: string;
    rewards: { token: Address; amount: bigint }[];
    milestones: { title: string; description: string; percentage: number }[];
    deadline: number;
    skills: string[];
    stakeAmount: bigint;
  }) => {
    const address = getContractAddress('bountyRegistry');
    
    writeContract({
      address,
      abi: BOUNTY_REGISTRY_ABI,
      functionName: 'createBounty',
      args: [
        {
          title: params.title,
          description: params.description,
          specUri: params.specUri,
          deadline: BigInt(params.deadline),
        },
        params.rewards,
        params.milestones.map(m => m.title),
        params.milestones.map(m => m.description),
        params.milestones.map(m => BigInt(m.percentage * 100)), // Convert to BPS
        params.skills,
      ],
      value: params.stakeAmount + params.rewards.reduce((sum, r) => 
        r.token === '0x0000000000000000000000000000000000000000' ? sum + r.amount : sum, 0n
      ),
    });
  };

  return {
    createBounty,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useApplyForBounty() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const apply = async (bountyId: `0x${string}`, proposalUri: string, estimatedDuration: number) => {
    const address = getContractAddress('bountyRegistry');
    
    writeContract({
      address,
      abi: BOUNTY_REGISTRY_ABI,
      functionName: 'applyForBounty',
      args: [bountyId, proposalUri, BigInt(estimatedDuration)],
    });
  };

  return {
    apply,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

// ============ Model Hooks ============

export function useModel(modelId: `0x${string}` | undefined) {
  const address = getContractAddressSafe('modelRegistry');
  
  return useReadContract({
    address: address || undefined,
    abi: MODEL_REGISTRY_ABI,
    functionName: 'getModel',
    args: modelId ? [modelId] : undefined,
    query: {
      enabled: !!modelId && !!address,
    },
  });
}

export function useCreateModel() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const createModel = async (params: {
    name: string;
    organization: string;
    modelType: number;
    license: number;
    licenseUri: string;
    accessLevel: number;
    description: string;
    tags: string[];
  }) => {
    const address = getContractAddress('modelRegistry');
    
    writeContract({
      address,
      abi: MODEL_REGISTRY_ABI,
      functionName: 'createModel',
      args: [
        params.name,
        params.organization,
        params.modelType,
        params.license,
        params.licenseUri,
        params.accessLevel,
        params.description,
        params.tags,
      ],
    });
  };

  return {
    createModel,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useStarModel() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const toggleStar = async (modelId: `0x${string}`) => {
    const address = getContractAddress('modelRegistry');
    
    writeContract({
      address,
      abi: MODEL_REGISTRY_ABI,
      functionName: 'toggleStar',
      args: [modelId],
    });
  };

  return {
    toggleStar,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

// ============ Guardian Hooks ============

export function useGuardian(agentId: bigint | undefined) {
  const address = getContractAddressSafe('guardianRegistry');
  
  return useReadContract({
    address: address || undefined,
    abi: GUARDIAN_REGISTRY_ABI,
    functionName: 'getGuardian',
    args: agentId !== undefined ? [agentId] : undefined,
    query: {
      enabled: agentId !== undefined && !!address,
    },
  });
}

export function useRegisterGuardian() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const register = async (agentId: bigint, specializations: string[], stakeAmount: bigint) => {
    const address = getContractAddress('guardianRegistry');
    
    writeContract({
      address,
      abi: GUARDIAN_REGISTRY_ABI,
      functionName: 'registerGuardian',
      args: [agentId, specializations],
      value: stakeAmount,
    });
  };

  return {
    register,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useSubmitReview() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const submitReview = async (params: {
    subjectId: `0x${string}`;
    subjectType: string;
    action: number;
    commentUri: string;
    suggestions: string[];
  }) => {
    const address = getContractAddress('guardianRegistry');
    
    writeContract({
      address,
      abi: GUARDIAN_REGISTRY_ABI,
      functionName: 'submitReview',
      args: [
        params.subjectId,
        params.subjectType,
        params.action,
        params.commentUri,
        params.suggestions,
      ],
    });
  };

  return {
    submitReview,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}


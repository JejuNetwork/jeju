/**
 * Training hooks for Psyche-compatible distributed training
 * Integrates with TrainingCoordinator, TrainingRewards, and NodePerformanceOracle
 */

import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount, useBlockNumber } from 'wagmi';
import { type Address, parseEther, keccak256, encodePacked } from 'viem';
import { getContractAddress, getContractAddressSafe } from '@/config/contracts';
import { useEffect } from 'react';

// Psyche-compatible run states
export enum RunState {
  Uninitialized = 0,
  WaitingForMembers = 1,
  Warmup = 2,
  RoundTrain = 3,
  RoundWitness = 4,
  Cooldown = 5,
  Finished = 6,
  Paused = 7,
}

export enum ClientState {
  Healthy = 0,
  Dropped = 1,
  Withdrawn = 2,
  Ejected = 3,
}

export enum PrivacyMode {
  Public = 0,
  Private = 1,
}

export enum GPUTier {
  Consumer = 0,
  Professional = 1,
  Datacenter = 2,
  HighEnd = 3,
}

export interface CoordinatorConfig {
  warmupTime: bigint;
  cooldownTime: bigint;
  maxRoundTrainTime: bigint;
  roundWitnessTime: bigint;
  epochTime: bigint;
  globalBatchSizeWarmupTokens: bigint;
  totalSteps: number;
  initMinClients: number;
  minClients: number;
  witnessNodes: number;
  globalBatchSizeStart: number;
  globalBatchSizeEnd: number;
  verificationPercent: number;
  waitingForMembersExtraTime: number;
}

export interface ModelConfig {
  modelHash: `0x${string}`;
  hfRepo: string;
  maxSeqLen: number;
  coldStartWarmupSteps: number;
}

export interface TrainingRun {
  runId: `0x${string}`;
  creator: Address;
  state: RunState;
  hfRepo: string;
  privacyMode: PrivacyMode;
  clientCount: number;
  currentStep: number;
  totalSteps: number;
  epoch: number;
  createdAt: number;
}

export interface NodeInfo {
  address: Address;
  gpuTier: GPUTier;
  score: number;
  latencyMs: number;
  bandwidthMbps: number;
  isActive: boolean;
}

const TRAINING_COORDINATOR_ABI = [
  {
    name: 'createRun',
    type: 'function',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'config', type: 'tuple', components: [
        { name: 'warmupTime', type: 'uint64' },
        { name: 'cooldownTime', type: 'uint64' },
        { name: 'maxRoundTrainTime', type: 'uint64' },
        { name: 'roundWitnessTime', type: 'uint64' },
        { name: 'epochTime', type: 'uint64' },
        { name: 'globalBatchSizeWarmupTokens', type: 'uint64' },
        { name: 'totalSteps', type: 'uint32' },
        { name: 'initMinClients', type: 'uint16' },
        { name: 'minClients', type: 'uint16' },
        { name: 'witnessNodes', type: 'uint16' },
        { name: 'globalBatchSizeStart', type: 'uint16' },
        { name: 'globalBatchSizeEnd', type: 'uint16' },
        { name: 'verificationPercent', type: 'uint8' },
        { name: 'waitingForMembersExtraTime', type: 'uint8' },
      ]},
      { name: 'model', type: 'tuple', components: [
        { name: 'modelHash', type: 'bytes32' },
        { name: 'hfRepo', type: 'string' },
        { name: 'maxSeqLen', type: 'uint32' },
        { name: 'coldStartWarmupSteps', type: 'uint32' },
      ]},
      { name: 'privacyMode', type: 'uint8' },
      { name: 'mpcKeyId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'joinRun',
    type: 'function',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'p2pEndpointId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'tick',
    type: 'function',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'submitWitness',
    type: 'function',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'submission', type: 'tuple', components: [
        { name: 'participantBloom', type: 'bytes32' },
        { name: 'broadcastBloom', type: 'bytes32' },
        { name: 'broadcastMerkle', type: 'bytes32' },
        { name: 'step', type: 'uint32' },
        { name: 'tokensPerSec', type: 'uint64' },
        { name: 'bandwidthPerSec', type: 'uint64' },
        { name: 'loss', type: 'uint32' },
      ]},
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'withdrawFromRun',
    type: 'function',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'pauseRun',
    type: 'function',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'resumeRun',
    type: 'function',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getRunState',
    type: 'function',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    name: 'getRunConfig',
    type: 'function',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'warmupTime', type: 'uint64' },
        { name: 'cooldownTime', type: 'uint64' },
        { name: 'maxRoundTrainTime', type: 'uint64' },
        { name: 'roundWitnessTime', type: 'uint64' },
        { name: 'epochTime', type: 'uint64' },
        { name: 'globalBatchSizeWarmupTokens', type: 'uint64' },
        { name: 'totalSteps', type: 'uint32' },
        { name: 'initMinClients', type: 'uint16' },
        { name: 'minClients', type: 'uint16' },
        { name: 'witnessNodes', type: 'uint16' },
        { name: 'globalBatchSizeStart', type: 'uint16' },
        { name: 'globalBatchSizeEnd', type: 'uint16' },
        { name: 'verificationPercent', type: 'uint8' },
        { name: 'waitingForMembersExtraTime', type: 'uint8' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    name: 'getClientCount',
    type: 'function',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    name: 'getStep',
    type: 'function',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint32' }],
    stateMutability: 'view',
  },
  {
    name: 'getEpoch',
    type: 'function',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    name: 'isClientInRun',
    type: 'function',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'client', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

const TRAINING_REWARDS_ABI = [
  {
    name: 'createRewardPool',
    type: 'function',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'rewardToken', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'pointsPerEpoch', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'claim',
    type: 'function',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [{ name: 'amount', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'claimable',
    type: 'function',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'participant', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'points', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

const NODE_PERFORMANCE_ABI = [
  {
    name: 'registerNode',
    type: 'function',
    inputs: [
      { name: 'tier', type: 'uint8' },
      { name: 'attestationHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getOptimalNodes',
    type: 'function',
    inputs: [
      { name: 'count', type: 'uint256' },
      { name: 'minGpuTier', type: 'uint8' },
      { name: 'minBandwidth', type: 'uint256' },
      { name: 'minScore', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getNodeScore',
    type: 'function',
    inputs: [{ name: 'node', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getNodeMetrics',
    type: 'function',
    inputs: [{ name: 'node', type: 'address' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'avgLatencyMs', type: 'uint64' },
        { name: 'avgBandwidthMbps', type: 'uint64' },
        { name: 'successRate', type: 'uint32' },
        { name: 'totalTasks', type: 'uint32' },
        { name: 'lastUpdated', type: 'uint64' },
      ],
    }],
    stateMutability: 'view',
  },
] as const;

// Generate deterministic run ID
export function generateRunId(creator: Address, modelRepo: string): `0x${string}` {
  return keccak256(encodePacked(
    ['address', 'string', 'uint256'],
    [creator, modelRepo, BigInt(Date.now())]
  ));
}

// Default LLM training config
export function getDefaultLLMConfig(minClients = 2): CoordinatorConfig {
  return {
    warmupTime: BigInt(300), // 5 minutes
    cooldownTime: BigInt(60), // 1 minute
    maxRoundTrainTime: BigInt(600), // 10 minutes
    roundWitnessTime: BigInt(120), // 2 minutes
    epochTime: BigInt(3600), // 1 hour
    globalBatchSizeWarmupTokens: BigInt(1000000), // 1M tokens
    totalSteps: 1000,
    initMinClients: minClients + 2,
    minClients,
    witnessNodes: Math.max(1, Math.floor(minClients / 3)),
    globalBatchSizeStart: 256,
    globalBatchSizeEnd: 2048,
    verificationPercent: 10,
    waitingForMembersExtraTime: 60,
  };
}

// Hook: Get run state
export function useRunState(runId: `0x${string}` | undefined) {
  const address = getContractAddressSafe('trainingCoordinator');
  
  return useReadContract({
    address: address || undefined,
    abi: TRAINING_COORDINATOR_ABI,
    functionName: 'getRunState',
    args: runId ? [runId] : undefined,
    query: { enabled: !!runId && !!address },
  });
}

// Hook: Get run config
export function useRunConfig(runId: `0x${string}` | undefined) {
  const address = getContractAddressSafe('trainingCoordinator');
  
  return useReadContract({
    address: address || undefined,
    abi: TRAINING_COORDINATOR_ABI,
    functionName: 'getRunConfig',
    args: runId ? [runId] : undefined,
    query: { enabled: !!runId && !!address },
  });
}

// Hook: Check if user is in run
export function useIsInRun(runId: `0x${string}` | undefined) {
  const { address: userAddress } = useAccount();
  const contractAddress = getContractAddressSafe('trainingCoordinator');
  
  return useReadContract({
    address: contractAddress || undefined,
    abi: TRAINING_COORDINATOR_ABI,
    functionName: 'isClientInRun',
    args: runId && userAddress ? [runId, userAddress] : undefined,
    query: { enabled: !!runId && !!userAddress && !!contractAddress },
  });
}

// Hook: Get claimable rewards
export function useClaimableRewards(runId: `0x${string}` | undefined) {
  const { address: userAddress } = useAccount();
  const contractAddress = getContractAddressSafe('trainingRewards');
  
  return useReadContract({
    address: contractAddress || undefined,
    abi: TRAINING_REWARDS_ABI,
    functionName: 'claimable',
    args: runId && userAddress ? [runId, userAddress] : undefined,
    query: { enabled: !!runId && !!userAddress && !!contractAddress },
  });
}

// Hook: Get optimal nodes
export function useOptimalNodes(count: number, minGpuTier: GPUTier = GPUTier.Consumer) {
  const address = getContractAddressSafe('nodePerformanceOracle');
  
  return useReadContract({
    address: address || undefined,
    abi: NODE_PERFORMANCE_ABI,
    functionName: 'getOptimalNodes',
    args: [BigInt(count), minGpuTier, BigInt(0), BigInt(0)],
    query: { enabled: !!address },
  });
}

// Hook: Create training run
export function useCreateRun() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const { address: creator } = useAccount();

  const createRun = async (params: {
    modelRepo: string;
    modelHash?: `0x${string}`;
    config?: Partial<CoordinatorConfig>;
    privacyMode?: PrivacyMode;
    stake?: bigint;
  }) => {
    const address = getContractAddress('trainingCoordinator');
    const runId = generateRunId(creator!, params.modelRepo);
    const config = { ...getDefaultLLMConfig(), ...params.config };
    
    writeContract({
      address,
      abi: TRAINING_COORDINATOR_ABI,
      functionName: 'createRun',
      args: [
        runId,
        config,
        {
          modelHash: params.modelHash || ('0x' + '0'.repeat(64)) as `0x${string}`,
          hfRepo: params.modelRepo,
          maxSeqLen: 2048,
          coldStartWarmupSteps: 10,
        },
        params.privacyMode ?? PrivacyMode.Public,
        ('0x' + '0'.repeat(64)) as `0x${string}`,
      ],
      value: params.stake ?? parseEther('0.01'),
    });

    return runId;
  };

  return { createRun, hash, isPending, isConfirming, isSuccess, error };
}

// Hook: Join training run
export function useJoinRun() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const joinRun = async (runId: `0x${string}`, p2pEndpointId?: `0x${string}`) => {
    const address = getContractAddress('trainingCoordinator');
    const endpoint = p2pEndpointId || keccak256(encodePacked(['uint256'], [BigInt(Date.now())]));
    
    writeContract({
      address,
      abi: TRAINING_COORDINATOR_ABI,
      functionName: 'joinRun',
      args: [runId, endpoint],
    });
  };

  return { joinRun, hash, isPending, isConfirming, isSuccess, error };
}

// Hook: Withdraw from run
export function useWithdrawFromRun() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const withdraw = async (runId: `0x${string}`) => {
    const address = getContractAddress('trainingCoordinator');
    writeContract({
      address,
      abi: TRAINING_COORDINATOR_ABI,
      functionName: 'withdrawFromRun',
      args: [runId],
    });
  };

  return { withdraw, hash, isPending, isConfirming, isSuccess, error };
}

// Hook: Claim rewards
export function useClaimRewards() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const claim = async (runId: `0x${string}`) => {
    const address = getContractAddress('trainingRewards');
    writeContract({
      address,
      abi: TRAINING_REWARDS_ABI,
      functionName: 'claim',
      args: [runId],
    });
  };

  return { claim, hash, isPending, isConfirming, isSuccess, error };
}

// Hook: Register as compute node
export function useRegisterNode() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const register = async (gpuTier: GPUTier, attestationHash: `0x${string}`) => {
    const address = getContractAddress('nodePerformanceOracle');
    writeContract({
      address,
      abi: NODE_PERFORMANCE_ABI,
      functionName: 'registerNode',
      args: [gpuTier, attestationHash],
    });
  };

  return { register, hash, isPending, isConfirming, isSuccess, error };
}

// Hook: Live run progress tracking
export function useRunProgress(runId: `0x${string}` | undefined) {
  const coordinatorAddress = getContractAddressSafe('trainingCoordinator');
  const { data: blockNumber } = useBlockNumber({ watch: true });
  
  const { data: state, refetch: refetchState } = useReadContract({
    address: coordinatorAddress || undefined,
    abi: TRAINING_COORDINATOR_ABI,
    functionName: 'getRunState',
    args: runId ? [runId] : undefined,
    query: { enabled: !!runId && !!coordinatorAddress },
  });

  const { data: step, refetch: refetchStep } = useReadContract({
    address: coordinatorAddress || undefined,
    abi: TRAINING_COORDINATOR_ABI,
    functionName: 'getStep',
    args: runId ? [runId] : undefined,
    query: { enabled: !!runId && !!coordinatorAddress },
  });

  const { data: clientCount, refetch: refetchClients } = useReadContract({
    address: coordinatorAddress || undefined,
    abi: TRAINING_COORDINATOR_ABI,
    functionName: 'getClientCount',
    args: runId ? [runId] : undefined,
    query: { enabled: !!runId && !!coordinatorAddress },
  });

  const { data: epoch, refetch: refetchEpoch } = useReadContract({
    address: coordinatorAddress || undefined,
    abi: TRAINING_COORDINATOR_ABI,
    functionName: 'getEpoch',
    args: runId ? [runId] : undefined,
    query: { enabled: !!runId && !!coordinatorAddress },
  });

  // Refetch on new blocks
  useEffect(() => {
    if (blockNumber) {
      refetchState();
      refetchStep();
      refetchClients();
      refetchEpoch();
    }
  }, [blockNumber, refetchState, refetchStep, refetchClients, refetchEpoch]);

  return {
    state: state as RunState | undefined,
    step: step as number | undefined,
    clientCount: clientCount as number | undefined,
    epoch: epoch as number | undefined,
    isLoading: !state,
  };
}

// Run state label helper
export function getRunStateLabel(state: RunState): string {
  const labels: Record<RunState, string> = {
    [RunState.Uninitialized]: 'Not Started',
    [RunState.WaitingForMembers]: 'Waiting for Participants',
    [RunState.Warmup]: 'Warming Up',
    [RunState.RoundTrain]: 'Training',
    [RunState.RoundWitness]: 'Witnessing',
    [RunState.Cooldown]: 'Cooling Down',
    [RunState.Finished]: 'Completed',
    [RunState.Paused]: 'Paused',
  };
  return labels[state] ?? 'Unknown';
}

// Run state color helper
export function getRunStateColor(state: RunState): string {
  const colors: Record<RunState, string> = {
    [RunState.Uninitialized]: 'text-gray-400',
    [RunState.WaitingForMembers]: 'text-amber-400',
    [RunState.Warmup]: 'text-blue-400',
    [RunState.RoundTrain]: 'text-green-400',
    [RunState.RoundWitness]: 'text-purple-400',
    [RunState.Cooldown]: 'text-cyan-400',
    [RunState.Finished]: 'text-emerald-400',
    [RunState.Paused]: 'text-orange-400',
  };
  return colors[state] ?? 'text-gray-400';
}


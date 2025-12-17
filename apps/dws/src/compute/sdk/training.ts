import type { Address, Hex, PublicClient, WalletClient, Chain, Account, Hash } from 'viem';
import { keccak256, encodeAbiParameters, parseAbiParameters, zeroHash } from 'viem';

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
  Unknown = 0,
  Consumer = 1,
  Prosumer = 2,
  Datacenter = 3,
  HighEnd = 4,
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
  modelHash: Hex;
  hfRepo: string;
  maxSeqLen: number;
  coldStartWarmupSteps: number;
}

export interface Client {
  addr: Address;
  p2pEndpointId: Hex;
  state: ClientState;
  exitedHeight: number;
  joinedAt: bigint;
}

export interface Round {
  witnessProofs: Hex[];
  participantBloom: Hex;
  broadcastMerkle: Hex;
  dataIndex: bigint;
  randomSeed: bigint;
  height: number;
  clientsLen: number;
  tieBreaker: number;
}

export interface WitnessSubmission {
  participantBloom: Hex;
  broadcastBloom: Hex;
  broadcastMerkle: Hex;
  step: number;
  tokensPerSec: bigint;
  bandwidthPerSec: bigint;
  loss: number;
}

export interface TrainingRunInfo {
  creator: Address;
  state: RunState;
  epoch: number;
  step: number;
  clientCount: number;
  privacyMode: PrivacyMode;
}

export interface NodeMetrics {
  totalRoundsParticipated: bigint;
  successfulRounds: bigint;
  droppedRounds: bigint;
  witnessSubmissions: bigint;
  successfulWitnesses: bigint;
  averageLatencyMs: bigint;
  averageBandwidthMbps: bigint;
  averageTokensPerSec: bigint;
  gpuTier: GPUTier;
  attestationHash: Hex;
  lastActiveTimestamp: bigint;
  registeredAt: bigint;
  score: number;
}

export interface ParticipantRewards {
  earnedPoints: bigint;
  claimedPoints: bigint;
  lastCompletedEpoch: number;
  lastClaimTime: bigint;
}

export interface ClaimableInfo {
  claimableAmount: bigint;
  claimablePoints: bigint;
}

export interface TEEConfig {
  provider: number;
  requiredEnclaveId: Hex;
  minAttestationTimestamp: bigint;
  authorizedEnclaves: Hex[];
  requireFreshAttestation: boolean;
}

export interface PrivateRunConfig {
  mpcKeyId: Hex;
  dataKeyId: Hex;
  teeConfig: TEEConfig;
  authorizedParticipants: Address[];
  participantAllowlistEnabled: boolean;
}

export interface CreateRunOptions {
  runId: Hex;
  config: CoordinatorConfig;
  model: ModelConfig;
  privacyMode: PrivacyMode;
  mpcKeyId?: Hex;
  rewardToken?: Address;
  rewardAmount?: bigint;
}

export interface TrainingSDKConfig {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  chain: Chain;
  addresses: {
    coordinator: Address;
    rewards: Address;
    performance: Address;
    registry: Address;
  };
}

const coordinatorAbi = [
  {
    name: 'createRun',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      {
        name: 'config',
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
      },
      {
        name: 'model',
        type: 'tuple',
        components: [
          { name: 'modelHash', type: 'bytes32' },
          { name: 'hfRepo', type: 'string' },
          { name: 'maxSeqLen', type: 'uint32' },
          { name: 'coldStartWarmupSteps', type: 'uint32' },
        ],
      },
      { name: 'privacyMode', type: 'uint8' },
      { name: 'mpcKeyId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'joinRun',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'p2pEndpointId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'tick',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'submitWitness',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      {
        name: 'submission',
        type: 'tuple',
        components: [
          { name: 'participantBloom', type: 'bytes32' },
          { name: 'broadcastBloom', type: 'bytes32' },
          { name: 'broadcastMerkle', type: 'bytes32' },
          { name: 'step', type: 'uint32' },
          { name: 'tokensPerSec', type: 'uint64' },
          { name: 'bandwidthPerSec', type: 'uint64' },
          { name: 'loss', type: 'uint32' },
        ],
      },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'submitWarmupWitness',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      {
        name: 'submission',
        type: 'tuple',
        components: [
          { name: 'participantBloom', type: 'bytes32' },
          { name: 'broadcastBloom', type: 'bytes32' },
          { name: 'broadcastMerkle', type: 'bytes32' },
          { name: 'step', type: 'uint32' },
          { name: 'tokensPerSec', type: 'uint64' },
          { name: 'bandwidthPerSec', type: 'uint64' },
          { name: 'loss', type: 'uint32' },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: 'submitCheckpoint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'modelHash', type: 'bytes32' },
      { name: 'hfRepo', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'withdrawFromRun',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'pauseRun',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'resumeRun',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getRunState',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'getRunConfig',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [
      {
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
      },
    ],
  },
  {
    name: 'getClients',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'addr', type: 'address' },
          { name: 'p2pEndpointId', type: 'bytes32' },
          { name: 'state', type: 'uint8' },
          { name: 'exitedHeight', type: 'uint32' },
          { name: 'joinedAt', type: 'uint64' },
        ],
      },
    ],
  },
  {
    name: 'getCurrentRound',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'witnessProofs', type: 'bytes32[]' },
          { name: 'participantBloom', type: 'bytes32' },
          { name: 'broadcastMerkle', type: 'bytes32' },
          { name: 'dataIndex', type: 'uint64' },
          { name: 'randomSeed', type: 'uint64' },
          { name: 'height', type: 'uint32' },
          { name: 'clientsLen', type: 'uint16' },
          { name: 'tieBreaker', type: 'uint16' },
        ],
      },
    ],
  },
  {
    name: 'isClientInRun',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'client', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'getRun',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'state', type: 'uint8' },
      { name: 'epoch', type: 'uint16' },
      { name: 'step', type: 'uint32' },
      { name: 'clientCount', type: 'uint16' },
      { name: 'privacyMode', type: 'uint8' },
    ],
  },
  {
    name: 'StateTransition',
    type: 'event',
    inputs: [
      { name: 'runId', type: 'bytes32', indexed: true },
      { name: 'oldState', type: 'uint8', indexed: false },
      { name: 'newState', type: 'uint8', indexed: false },
      { name: 'timestamp', type: 'uint64', indexed: false },
    ],
  },
  {
    name: 'RoundStarted',
    type: 'event',
    inputs: [
      { name: 'runId', type: 'bytes32', indexed: true },
      { name: 'roundHeight', type: 'uint32', indexed: false },
      { name: 'dataIndex', type: 'uint64', indexed: false },
      { name: 'randomSeed', type: 'uint64', indexed: false },
    ],
  },
  {
    name: 'EpochCompleted',
    type: 'event',
    inputs: [
      { name: 'runId', type: 'bytes32', indexed: true },
      { name: 'epoch', type: 'uint16', indexed: false },
      { name: 'stepsCompleted', type: 'uint32', indexed: false },
    ],
  },
] as const;

const rewardsAbi = [
  {
    name: 'createRewardPool',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'rewardToken', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'pointsPerEpoch', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'claimMultiple',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runIds', type: 'bytes32[]' }],
    outputs: [],
  },
  {
    name: 'claimable',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'participant', type: 'address' },
    ],
    outputs: [
      { name: 'claimableAmount', type: 'uint256' },
      { name: 'claimablePoints', type: 'uint256' },
    ],
  },
  {
    name: 'getParticipantRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'participant', type: 'address' },
    ],
    outputs: [
      { name: 'earnedPoints', type: 'uint256' },
      { name: 'claimedPoints', type: 'uint256' },
      { name: 'lastCompletedEpoch', type: 'uint16' },
      { name: 'lastClaimTime', type: 'uint64' },
    ],
  },
] as const;

const performanceAbi = [
  {
    name: 'registerNode',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'gpuTier', type: 'uint8' },
      { name: 'attestationHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'getNodeScore',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'address' }],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'getOptimalNodes',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'count', type: 'uint16' },
      { name: 'minGpuTier', type: 'uint8' },
      { name: 'minBandwidth', type: 'uint64' },
      { name: 'minScore', type: 'uint8' },
    ],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getNodeMetrics',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'totalRoundsParticipated', type: 'uint64' },
          { name: 'successfulRounds', type: 'uint64' },
          { name: 'droppedRounds', type: 'uint64' },
          { name: 'witnessSubmissions', type: 'uint64' },
          { name: 'successfulWitnesses', type: 'uint64' },
          { name: 'averageLatencyMs', type: 'uint64' },
          { name: 'averageBandwidthMbps', type: 'uint64' },
          { name: 'averageTokensPerSec', type: 'uint64' },
          { name: 'gpuTier', type: 'uint8' },
          { name: 'attestationHash', type: 'bytes32' },
          { name: 'lastActiveTimestamp', type: 'uint64' },
          { name: 'registeredAt', type: 'uint64' },
          { name: 'score', type: 'uint8' },
        ],
      },
    ],
  },
  {
    name: 'isNodeActive',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

const registryAbi = [
  {
    name: 'isAuthorizedParticipant',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'participant', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'getPrivateRunConfig',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'mpcKeyId', type: 'bytes32' },
          { name: 'dataKeyId', type: 'bytes32' },
          {
            name: 'teeConfig',
            type: 'tuple',
            components: [
              { name: 'provider', type: 'uint8' },
              { name: 'requiredEnclaveId', type: 'bytes32' },
              { name: 'minAttestationTimestamp', type: 'uint64' },
              { name: 'authorizedEnclaves', type: 'bytes32[]' },
              { name: 'requireFreshAttestation', type: 'bool' },
            ],
          },
          { name: 'authorizedParticipants', type: 'address[]' },
          { name: 'participantAllowlistEnabled', type: 'bool' },
        ],
      },
    ],
  },
] as const;

const erc20Abi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

type RunResult = readonly [Address, number, number, number, number, number];

export class TrainingSDK {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null;
  private chain: Chain;
  private addresses: TrainingSDKConfig['addresses'];

  constructor(config: TrainingSDKConfig) {
    this.publicClient = config.publicClient;
    this.walletClient = config.walletClient || null;
    this.chain = config.chain;
    this.addresses = config.addresses;
  }

  private getAccount(): Account {
    if (!this.walletClient?.account) {
      throw new Error('WalletClient with account required for write operations');
    }
    return this.walletClient.account;
  }

  private async write(
    address: Address,
    abi: readonly Record<string, unknown>[],
    functionName: string,
    args: readonly unknown[]
  ): Promise<Hash> {
    const account = this.getAccount();
    const hash = await this.walletClient!.writeContract({
      address,
      abi: abi as never,
      functionName,
      args,
      chain: this.chain,
      account,
    } as never);
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  private async read<T>(
    address: Address,
    abi: readonly Record<string, unknown>[],
    functionName: string,
    args: readonly unknown[] = []
  ): Promise<T> {
    return this.publicClient.readContract({
      address,
      abi: abi as never,
      functionName,
      args,
    } as never) as Promise<T>;
  }

  private validateConfig(config: CoordinatorConfig): void {
    if (config.totalSteps <= 0) throw new Error('totalSteps must be positive');
    if (config.minClients <= 0) throw new Error('minClients must be positive');
    if (config.initMinClients < config.minClients) {
      throw new Error('initMinClients must be >= minClients');
    }
    if (config.witnessNodes <= 0) throw new Error('witnessNodes must be positive');
    if (config.witnessNodes > config.minClients) {
      throw new Error('witnessNodes cannot exceed minClients');
    }
    if (config.globalBatchSizeStart <= 0) throw new Error('globalBatchSizeStart must be positive');
    if (config.globalBatchSizeEnd < config.globalBatchSizeStart) {
      throw new Error('globalBatchSizeEnd must be >= globalBatchSizeStart');
    }
    if (config.verificationPercent < 0 || config.verificationPercent > 100) {
      throw new Error('verificationPercent must be 0-100');
    }
    if (config.warmupTime <= BigInt(0)) throw new Error('warmupTime must be positive');
    if (config.cooldownTime <= BigInt(0)) throw new Error('cooldownTime must be positive');
    if (config.maxRoundTrainTime <= BigInt(0)) throw new Error('maxRoundTrainTime must be positive');
    if (config.roundWitnessTime <= BigInt(0)) throw new Error('roundWitnessTime must be positive');
    if (config.epochTime <= BigInt(0)) throw new Error('epochTime must be positive');
  }

  private validateModel(model: ModelConfig): void {
    if (!model.modelHash || model.modelHash === zeroHash) {
      throw new Error('modelHash is required');
    }
    if (!model.hfRepo || model.hfRepo.length === 0) {
      throw new Error('hfRepo is required');
    }
    if (model.maxSeqLen <= 0) throw new Error('maxSeqLen must be positive');
    if (model.coldStartWarmupSteps < 0) throw new Error('coldStartWarmupSteps cannot be negative');
  }

  async createRun(options: CreateRunOptions): Promise<Hash> {
    this.validateConfig(options.config);
    this.validateModel(options.model);

    const args = [
      options.runId,
      {
        warmupTime: options.config.warmupTime,
        cooldownTime: options.config.cooldownTime,
        maxRoundTrainTime: options.config.maxRoundTrainTime,
        roundWitnessTime: options.config.roundWitnessTime,
        epochTime: options.config.epochTime,
        globalBatchSizeWarmupTokens: options.config.globalBatchSizeWarmupTokens,
        totalSteps: options.config.totalSteps,
        initMinClients: options.config.initMinClients,
        minClients: options.config.minClients,
        witnessNodes: options.config.witnessNodes,
        globalBatchSizeStart: options.config.globalBatchSizeStart,
        globalBatchSizeEnd: options.config.globalBatchSizeEnd,
        verificationPercent: options.config.verificationPercent,
        waitingForMembersExtraTime: options.config.waitingForMembersExtraTime,
      },
      {
        modelHash: options.model.modelHash,
        hfRepo: options.model.hfRepo,
        maxSeqLen: options.model.maxSeqLen,
        coldStartWarmupSteps: options.model.coldStartWarmupSteps,
      },
      options.privacyMode,
      options.mpcKeyId || zeroHash,
    ] as const;

    const hash = await this.write(this.addresses.coordinator, coordinatorAbi, 'createRun', args);

    // Create reward pool if tokens provided
    if (options.rewardToken && options.rewardAmount && options.rewardAmount > BigInt(0)) {
      const account = this.getAccount();
      const currentAllowance = await this.read<bigint>(options.rewardToken, erc20Abi, 'allowance', [
        account.address,
        this.addresses.rewards,
      ]);

      if (currentAllowance < options.rewardAmount) {
        await this.write(options.rewardToken, erc20Abi, 'approve', [this.addresses.rewards, options.rewardAmount]);
      }

      await this.write(this.addresses.rewards, rewardsAbi, 'createRewardPool', [
        options.runId,
        options.rewardToken,
        options.rewardAmount,
        BigInt(0),
      ]);
    }

    return hash;
  }

  async joinRun(runId: Hex, p2pEndpointId: Hex): Promise<Hash> {
    return this.write(this.addresses.coordinator, coordinatorAbi, 'joinRun', [runId, p2pEndpointId]);
  }

  async tick(runId: Hex): Promise<Hash> {
    return this.write(this.addresses.coordinator, coordinatorAbi, 'tick', [runId]);
  }

  async submitWitness(runId: Hex, submission: WitnessSubmission, proof: Hex = '0x'): Promise<Hash> {
    return this.write(this.addresses.coordinator, coordinatorAbi, 'submitWitness', [
      runId,
      {
        participantBloom: submission.participantBloom,
        broadcastBloom: submission.broadcastBloom,
        broadcastMerkle: submission.broadcastMerkle,
        step: submission.step,
        tokensPerSec: submission.tokensPerSec,
        bandwidthPerSec: submission.bandwidthPerSec,
        loss: submission.loss,
      },
      proof,
    ]);
  }

  async submitWarmupWitness(runId: Hex, submission: WitnessSubmission): Promise<Hash> {
    return this.write(this.addresses.coordinator, coordinatorAbi, 'submitWarmupWitness', [
      runId,
      {
        participantBloom: submission.participantBloom,
        broadcastBloom: submission.broadcastBloom,
        broadcastMerkle: submission.broadcastMerkle,
        step: submission.step,
        tokensPerSec: submission.tokensPerSec,
        bandwidthPerSec: submission.bandwidthPerSec,
        loss: submission.loss,
      },
    ]);
  }

  async submitCheckpoint(runId: Hex, modelHash: Hex, hfRepo: string): Promise<Hash> {
    return this.write(this.addresses.coordinator, coordinatorAbi, 'submitCheckpoint', [runId, modelHash, hfRepo]);
  }

  async withdrawFromRun(runId: Hex): Promise<Hash> {
    return this.write(this.addresses.coordinator, coordinatorAbi, 'withdrawFromRun', [runId]);
  }

  async pauseRun(runId: Hex): Promise<Hash> {
    return this.write(this.addresses.coordinator, coordinatorAbi, 'pauseRun', [runId]);
  }

  async resumeRun(runId: Hex): Promise<Hash> {
    return this.write(this.addresses.coordinator, coordinatorAbi, 'resumeRun', [runId]);
  }

  async getRunInfo(runId: Hex): Promise<TrainingRunInfo> {
    const result = await this.read<RunResult>(this.addresses.coordinator, coordinatorAbi, 'getRun', [runId]);
    return {
      creator: result[0],
      state: result[1] as RunState,
      epoch: result[2],
      step: result[3],
      clientCount: result[4],
      privacyMode: result[5] as PrivacyMode,
    };
  }

  async getRunState(runId: Hex): Promise<RunState> {
    return this.read<RunState>(this.addresses.coordinator, coordinatorAbi, 'getRunState', [runId]);
  }

  async getRunConfig(runId: Hex): Promise<CoordinatorConfig> {
    return this.read<CoordinatorConfig>(this.addresses.coordinator, coordinatorAbi, 'getRunConfig', [runId]);
  }

  async getClients(runId: Hex): Promise<Client[]> {
    type ClientResult = { addr: Address; p2pEndpointId: Hex; state: number; exitedHeight: number; joinedAt: bigint };
    const rawClients = await this.read<ClientResult[]>(this.addresses.coordinator, coordinatorAbi, 'getClients', [
      runId,
    ]);
    return rawClients.map((c) => ({
      addr: c.addr,
      p2pEndpointId: c.p2pEndpointId,
      state: c.state as ClientState,
      exitedHeight: c.exitedHeight,
      joinedAt: c.joinedAt,
    }));
  }

  async getCurrentRound(runId: Hex): Promise<Round> {
    return this.read<Round>(this.addresses.coordinator, coordinatorAbi, 'getCurrentRound', [runId]);
  }

  async isClientInRun(runId: Hex, client: Address): Promise<boolean> {
    return this.read<boolean>(this.addresses.coordinator, coordinatorAbi, 'isClientInRun', [runId, client]);
  }

  async claim(runId: Hex): Promise<Hash> {
    return this.write(this.addresses.rewards, rewardsAbi, 'claim', [runId]);
  }

  async claimMultiple(runIds: Hex[]): Promise<Hash> {
    return this.write(this.addresses.rewards, rewardsAbi, 'claimMultiple', [runIds]);
  }

  async getClaimable(runId: Hex, participant: Address): Promise<ClaimableInfo> {
    const result = await this.read<readonly [bigint, bigint]>(this.addresses.rewards, rewardsAbi, 'claimable', [
      runId,
      participant,
    ]);
    return { claimableAmount: result[0], claimablePoints: result[1] };
  }

  async getParticipantRewards(runId: Hex, participant: Address): Promise<ParticipantRewards> {
    const result = await this.read<readonly [bigint, bigint, number, bigint]>(
      this.addresses.rewards,
      rewardsAbi,
      'getParticipantRewards',
      [runId, participant]
    );
    return {
      earnedPoints: result[0],
      claimedPoints: result[1],
      lastCompletedEpoch: result[2],
      lastClaimTime: result[3],
    };
  }

  async registerNode(gpuTier: GPUTier, attestationHash: Hex): Promise<Hash> {
    return this.write(this.addresses.performance, performanceAbi, 'registerNode', [gpuTier, attestationHash]);
  }

  async getNodeMetrics(node: Address): Promise<NodeMetrics> {
    const metrics = await this.read<NodeMetrics & { gpuTier: number }>(
      this.addresses.performance,
      performanceAbi,
      'getNodeMetrics',
      [node]
    );
    return { ...metrics, gpuTier: metrics.gpuTier as GPUTier };
  }

  async getNodeScore(node: Address): Promise<number> {
    return this.read<number>(this.addresses.performance, performanceAbi, 'getNodeScore', [node]);
  }

  async getOptimalNodes(
    count: number,
    minGpuTier: GPUTier = GPUTier.Consumer,
    minBandwidth: bigint = BigInt(100),
    minScore: number = 50
  ): Promise<Address[]> {
    return this.read<Address[]>(this.addresses.performance, performanceAbi, 'getOptimalNodes', [
      count,
      minGpuTier,
      minBandwidth,
      minScore,
    ]);
  }

  async isNodeActive(node: Address): Promise<boolean> {
    return this.read<boolean>(this.addresses.performance, performanceAbi, 'isNodeActive', [node]);
  }

  async isAuthorizedParticipant(runId: Hex, participant: Address): Promise<boolean> {
    return this.read<boolean>(this.addresses.registry, registryAbi, 'isAuthorizedParticipant', [runId, participant]);
  }

  async getPrivateRunConfig(runId: Hex): Promise<PrivateRunConfig> {
    return this.read<PrivateRunConfig>(this.addresses.registry, registryAbi, 'getPrivateRunConfig', [runId]);
  }

  watchStateTransition(
    runId: Hex | null,
    callback: (runId: Hex, oldState: RunState, newState: RunState, timestamp: bigint) => void
  ) {
    return this.publicClient.watchContractEvent({
      address: this.addresses.coordinator,
      abi: coordinatorAbi,
      eventName: 'StateTransition',
      args: runId ? { runId } : undefined,
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as { runId: Hex; oldState: number; newState: number; timestamp: bigint };
          callback(args.runId, args.oldState as RunState, args.newState as RunState, args.timestamp);
        }
      },
    });
  }

  watchRoundStarted(
    runId: Hex | null,
    callback: (runId: Hex, height: number, dataIndex: bigint, randomSeed: bigint) => void
  ) {
    return this.publicClient.watchContractEvent({
      address: this.addresses.coordinator,
      abi: coordinatorAbi,
      eventName: 'RoundStarted',
      args: runId ? { runId } : undefined,
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as { runId: Hex; roundHeight: number; dataIndex: bigint; randomSeed: bigint };
          callback(args.runId, args.roundHeight, args.dataIndex, args.randomSeed);
        }
      },
    });
  }

  watchEpochCompleted(runId: Hex | null, callback: (runId: Hex, epoch: number, stepsCompleted: number) => void) {
    return this.publicClient.watchContractEvent({
      address: this.addresses.coordinator,
      abi: coordinatorAbi,
      eventName: 'EpochCompleted',
      args: runId ? { runId } : undefined,
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as { runId: Hex; epoch: number; stepsCompleted: number };
          callback(args.runId, args.epoch, args.stepsCompleted);
        }
      },
    });
  }

  static generateRunId(name: string, creator: Address): Hex {
    return keccak256(
      encodeAbiParameters(parseAbiParameters('string, address, uint256'), [name, creator, BigInt(Date.now())])
    );
  }

  static getDefaultLLMConfig(totalSteps: number, minClients: number = 4): CoordinatorConfig {
    return {
      warmupTime: BigInt(300),
      cooldownTime: BigInt(60),
      maxRoundTrainTime: BigInt(600),
      roundWitnessTime: BigInt(60),
      epochTime: BigInt(3600),
      globalBatchSizeWarmupTokens: BigInt(1_000_000),
      totalSteps,
      initMinClients: minClients + 2,
      minClients,
      witnessNodes: Math.min(minClients, 8),
      globalBatchSizeStart: 4,
      globalBatchSizeEnd: 32,
      verificationPercent: 10,
      waitingForMembersExtraTime: 60,
    };
  }
}

export default TrainingSDK;

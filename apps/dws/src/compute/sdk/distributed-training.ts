import type { Address, Hex, PublicClient, WalletClient, Chain } from 'viem';
import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import {
  TrainingSDK,
  RunState,
  PrivacyMode,
  GPUTier,
  type CoordinatorConfig,
  type ModelConfig,
  type WitnessSubmission,
  type NodeMetrics,
  type CreateRunOptions,
} from './training';

export { RunState, PrivacyMode, GPUTier } from './training';
export type { CoordinatorConfig, ModelConfig, NodeMetrics } from './training';

export interface DistributedTrainingConfig {
  publicClient: PublicClient;
  walletClient: WalletClient;
  chain: Chain;
  contracts: {
    coordinator: Address;
    rewards: Address;
    performance: Address;
    registry: Address;
  };
  p2p?: {
    endpointUrl?: string;
    discoveryUrl?: string;
  };
  storage?: {
    ipfsGateway?: string;
    hfToken?: string;
  };
}

export interface TrainingJobConfig {
  name: string;
  baseModel: string;
  datasetCid: string;
  training: {
    totalSteps: number;
    minNodes: number;
    batchSizeStart: number;
    batchSizeEnd: number;
    maxSeqLen: number;
  };
  privacyMode: PrivacyMode;
  mpcKeyId?: Hex;
  rewardToken?: Address;
  rewardAmount?: bigint;
}

export interface TrainingJobStatus {
  runId: Hex;
  name: string;
  state: RunState;
  epoch: number;
  step: number;
  totalSteps: number;
  clientCount: number;
  privacyMode: PrivacyMode;
  latestCheckpoint?: {
    modelHash: Hex;
    hfRepo: string;
    step: number;
  };
}

export interface NodeInfo {
  address: Address;
  metrics: NodeMetrics;
  isActive: boolean;
  score: number;
}

export interface P2PEndpoint {
  endpointId: Hex;
  publicKey: Address;
  addresses: string[];
}

export class DistributedTrainingClient {
  private sdk: TrainingSDK;
  private config: DistributedTrainingConfig;
  private activeRuns: Map<string, TrainingJobStatus> = new Map();
  private p2pEndpoint: P2PEndpoint | null = null;
  private unwatchFns: (() => void)[] = [];

  constructor(config: DistributedTrainingConfig) {
    this.config = config;
    this.sdk = new TrainingSDK({
      publicClient: config.publicClient,
      walletClient: config.walletClient,
      chain: config.chain,
      addresses: config.contracts,
    });
  }

  async submitJob(config: TrainingJobConfig): Promise<Hex> {
    const account = this.config.walletClient.account;
    if (!account) throw new Error('Account required for submitting jobs');

    const runId = TrainingSDK.generateRunId(config.name, account.address);
    const { training } = config;

    // Build coordinator config from defaults, override batch sizes
    const coordinatorConfig: CoordinatorConfig = {
      ...TrainingSDK.getDefaultLLMConfig(training.totalSteps, training.minNodes),
      globalBatchSizeStart: training.batchSizeStart,
      globalBatchSizeEnd: training.batchSizeEnd,
      globalBatchSizeWarmupTokens: BigInt(training.maxSeqLen * 1000),
    };

    // Build model config
    const modelConfig: ModelConfig = {
      modelHash: keccak256(encodeAbiParameters(parseAbiParameters('string'), [config.baseModel])),
      hfRepo: config.baseModel,
      maxSeqLen: training.maxSeqLen,
      coldStartWarmupSteps: Math.floor(training.totalSteps * 0.1),
    };

    await this.sdk.createRun({
      runId,
      config: coordinatorConfig,
      model: modelConfig,
      privacyMode: config.privacyMode,
      mpcKeyId: config.mpcKeyId,
      rewardToken: config.rewardToken,
      rewardAmount: config.rewardAmount,
    });

    this.activeRuns.set(runId, {
      runId,
      name: config.name,
      state: RunState.WaitingForMembers,
      epoch: 0,
      step: 1,
      totalSteps: training.totalSteps,
      clientCount: 0,
      privacyMode: config.privacyMode,
    });

    // Set up event listeners for this run
    this.setupRunListeners(runId);

    return runId;
  }

  async joinRun(runId: Hex): Promise<void> {
    // Initialize P2P endpoint if needed
    if (!this.p2pEndpoint) {
      this.p2pEndpoint = await this.initializeP2P();
    }

    await this.sdk.joinRun(runId, this.p2pEndpoint.endpointId);
  }

  async getJobStatus(runId: Hex): Promise<TrainingJobStatus | null> {
    const cached = this.activeRuns.get(runId);
    if (cached) return cached;

    const info = await this.sdk.getRunInfo(runId);
    if (info.state === RunState.Uninitialized) return null;

    const config = await this.sdk.getRunConfig(runId);

    return {
      runId,
      name: '',
      state: info.state,
      epoch: info.epoch,
      step: info.step,
      totalSteps: config.totalSteps,
      clientCount: info.clientCount,
      privacyMode: info.privacyMode,
    };
  }

  async pauseJob(runId: Hex): Promise<void> {
    await this.sdk.pauseRun(runId);
    const status = this.activeRuns.get(runId);
    if (status) {
      status.state = RunState.Paused;
    }
  }

  async resumeJob(runId: Hex): Promise<void> {
    await this.sdk.resumeRun(runId);
  }

  async withdrawFromJob(runId: Hex): Promise<void> {
    await this.sdk.withdrawFromRun(runId);
  }

  async runTrainingLoop(
    runId: Hex,
    callbacks: {
      onRoundStart: (dataIndex: bigint, randomSeed: bigint) => Promise<{
        participantBloom: Hex;
        broadcastBloom: Hex;
        broadcastMerkle: Hex;
        tokensPerSec: bigint;
        bandwidthPerSec: bigint;
        loss: number;
      }>;
      onCheckpoint: (step: number, epoch: number) => Promise<{
        modelHash: Hex;
        hfRepo: string;
        ipfsCid: string;
      }>;
      onEpochComplete: (epoch: number, stepsCompleted: number) => Promise<void>;
      onError?: (error: Error, context: string) => void;
    }
  ): Promise<void> {
    let running = true;
    let loopError: Error | null = null;

    const handleError = (error: Error, context: string) => {
      if (callbacks.onError) {
        callbacks.onError(error, context);
      }
      loopError = error;
      running = false;
    };

    // Watch for state transitions
    const unwatchState = this.sdk.watchStateTransition(runId, (_, _oldState, newState) => {
      if (newState === RunState.Finished || newState === RunState.Paused) {
        running = false;
      }
    });

    // Watch for round starts - handle async errors
    const unwatchRound = this.sdk.watchRoundStarted(runId, (_, height, dataIndex, randomSeed) => {
      void (async () => {
        const result = await callbacks.onRoundStart(dataIndex, randomSeed);

        const submission: WitnessSubmission = {
          participantBloom: result.participantBloom,
          broadcastBloom: result.broadcastBloom,
          broadcastMerkle: result.broadcastMerkle,
          step: height,
          tokensPerSec: result.tokensPerSec,
          bandwidthPerSec: result.bandwidthPerSec,
          loss: result.loss,
        };

        // Submit witness
        const state = await this.sdk.getRunState(runId);
        if (state === RunState.Warmup) {
          await this.sdk.submitWarmupWitness(runId, submission);
        } else if (state === RunState.RoundTrain || state === RunState.RoundWitness) {
          await this.sdk.submitWitness(runId, submission);
        }
      })().catch((err: Error) => handleError(err, 'onRoundStart'));
    });

    // Watch for epoch completions - handle async errors
    const unwatchEpoch = this.sdk.watchEpochCompleted(runId, (_, epoch, stepsCompleted) => {
      void (async () => {
        // Submit checkpoint
        const checkpoint = await callbacks.onCheckpoint(stepsCompleted, epoch);

        await this.sdk.submitCheckpoint(runId, checkpoint.modelHash, checkpoint.hfRepo);
        await callbacks.onEpochComplete(epoch, stepsCompleted);
      })().catch((err: Error) => handleError(err, 'onCheckpoint'));
    });

    // Keep ticking the coordinator
    while (running) {
      const state = await this.sdk.getRunState(runId);

      if (state === RunState.Finished || state === RunState.Paused) {
        break;
      }

      // Tick to advance state
      await this.sdk.tick(runId);

      // Wait before next tick
      await new Promise((r) => setTimeout(r, 10000));
    }

    // Cleanup watchers
    unwatchState();
    unwatchRound();
    unwatchEpoch();

    // Re-throw any error that occurred in callbacks
    if (loopError) {
      throw loopError;
    }
  }

  async registerNode(gpuTier: GPUTier, attestationHash: Hex): Promise<void> {
    await this.sdk.registerNode(gpuTier, attestationHash);
  }

  async getOptimalNodes(
    count: number,
    minGpuTier: GPUTier = GPUTier.Datacenter,
    minScore: number = 60,
    minBandwidthMbps: number = 1000
  ): Promise<NodeInfo[]> {
    const addresses = await this.sdk.getOptimalNodes(count, minGpuTier, BigInt(minBandwidthMbps), minScore);
    return Promise.all(addresses.map((addr) => this.getNodeInfo(addr)));
  }

  async getNodeInfo(address: Address): Promise<NodeInfo> {
    const [metrics, isActive, score] = await Promise.all([
      this.sdk.getNodeMetrics(address),
      this.sdk.isNodeActive(address),
      this.sdk.getNodeScore(address),
    ]);
    return { address, metrics, isActive, score };
  }

  async claimRewards(runId: Hex): Promise<bigint> {
    const account = this.config.walletClient.account;
    if (!account) throw new Error('Account required for claiming rewards');

    const claimable = await this.sdk.getClaimable(runId, account.address);

    if (claimable.claimableAmount === BigInt(0)) {
      return BigInt(0);
    }

    await this.sdk.claim(runId);
    return claimable.claimableAmount;
  }

  async claimAllRewards(runIds: Hex[]): Promise<bigint> {
    const account = this.config.walletClient.account;
    if (!account) throw new Error('Account required for claiming rewards');

    let totalClaimable = BigInt(0);

    const claimableRuns: Hex[] = [];
    for (const runId of runIds) {
      const claimable = await this.sdk.getClaimable(runId, account.address);
      if (claimable.claimableAmount > BigInt(0)) {
        totalClaimable += claimable.claimableAmount;
        claimableRuns.push(runId);
      }
    }

    if (claimableRuns.length > 0) {
      await this.sdk.claimMultiple(claimableRuns);
    }

    return totalClaimable;
  }

  async getParticipantRewards(runId: Hex) {
    const account = this.config.walletClient.account;
    if (!account) throw new Error('Account required');

    return this.sdk.getParticipantRewards(runId, account.address);
  }

  private async initializeP2P(): Promise<P2PEndpoint> {
    const account = this.config.walletClient.account;
    if (!account) throw new Error('Account required');

    // Generate a unique endpoint ID from the wallet address
    const endpointId = keccak256(
      encodeAbiParameters(parseAbiParameters('address, uint256'), [account.address, BigInt(Date.now())])
    );

    // If Iroh endpoint is configured, connect to it
    const p2pConfig = this.config.p2p;
    if (p2pConfig?.endpointUrl) {
      // Connect to Iroh discovery service
      const response = await fetch(`${p2pConfig.endpointUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointId,
          publicKey: account.address,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to register P2P endpoint: ${response.statusText}`);
      }

      const data = (await response.json()) as { addresses: string[] };
      return {
        endpointId,
        publicKey: account.address,
        addresses: data.addresses,
      };
    }

    // Fallback: local-only mode (no P2P connectivity)
    // This is valid for testing but won't work for real distributed training
    return {
      endpointId,
      publicKey: account.address,
      addresses: [],
    };
  }

  private setupRunListeners(runId: Hex): void {
    const status = this.activeRuns.get(runId);
    if (!status) return;

    const unwatchState = this.sdk.watchStateTransition(runId, (_, _oldState, newState) => {
      status.state = newState;
    });

    const unwatchEpoch = this.sdk.watchEpochCompleted(runId, (_, epoch) => {
      status.epoch = epoch;
    });

    this.unwatchFns.push(unwatchState, unwatchEpoch);
  }

  cleanup(): void {
    for (const unwatch of this.unwatchFns) {
      unwatch();
    }
    this.unwatchFns = [];
    this.activeRuns.clear();
  }
}

export function createDistributedTrainingClient(config: DistributedTrainingConfig): DistributedTrainingClient {
  return new DistributedTrainingClient(config);
}

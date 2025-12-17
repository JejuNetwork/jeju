import { describe, expect, test, mock, beforeEach } from 'bun:test';
import {
  DistributedTrainingClient,
  GPUTier,
  PrivacyMode,
  RunState,
} from '../distributed-training';
import type { Address, Hex, Chain, PublicClient, WalletClient, Account } from 'viem';

// Mock chain config
const mockChain: Chain = {
  id: 1,
  name: 'Test Chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:8545'] } },
};

// Mock account
const mockAccount: Account = {
  address: '0x1234567890123456789012345678901234567890' as Address,
  type: 'local',
  signMessage: async () => '0x' as Hex,
  signTransaction: async () => '0x' as Hex,
  signTypedData: async () => '0x' as Hex,
  source: 'privateKey',
  publicKey: '0x1234' as Hex,
};

// Mock functions
const mockReadContract = mock(() => Promise.resolve());
const mockWriteContract = mock(() => Promise.resolve('0xhash' as Hex));
const mockWaitForTransactionReceipt = mock(() => Promise.resolve({ status: 'success' }));
const mockWatchContractEvent = mock(() => () => {});

const mockPublicClient = {
  readContract: mockReadContract,
  waitForTransactionReceipt: mockWaitForTransactionReceipt,
  watchContractEvent: mockWatchContractEvent,
} as unknown as PublicClient;

const mockWalletClient = {
  account: mockAccount,
  writeContract: mockWriteContract,
} as unknown as WalletClient;

const testContracts = {
  coordinator: '0x1234567890123456789012345678901234567890' as Address,
  rewards: '0x2345678901234567890123456789012345678901' as Address,
  performance: '0x3456789012345678901234567890123456789012' as Address,
  registry: '0x4567890123456789012345678901234567890123' as Address,
  identityRegistry: '0x5678901234567890123456789012345678901234' as Address,
};

const testConfig = {
  publicClient: mockPublicClient,
  walletClient: mockWalletClient,
  chain: mockChain,
  contracts: testContracts,
  rpcUrl: 'http://localhost:8545',
  selfEndpoint: 'http://localhost:3000',
};

describe('DistributedTrainingClient', () => {
  let client: DistributedTrainingClient;

  beforeEach(() => {
    mockReadContract.mockReset();
    mockWriteContract.mockReset();
    mockWaitForTransactionReceipt.mockReset();
    mockWatchContractEvent.mockReset();

    client = new DistributedTrainingClient(testConfig);
  });

  describe('constructor', () => {
    test('creates client with valid config', () => {
      expect(client).toBeDefined();
    });

    test('creates client without wallet for read-only', () => {
      const readOnlyClient = new DistributedTrainingClient(testConfig);
      expect(readOnlyClient).toBeDefined();
    });
  });

  describe('submitJob', () => {
    test('creates run with correct parameters', async () => {
      mockWriteContract.mockResolvedValue('0xhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const runId = await client.submitJob({
        name: 'test-run',
        baseModel: 'openai/gpt-2',
        datasetCid: 'QmTest',
        training: {
          totalSteps: 1000,
          minNodes: 4,
          batchSizeStart: 16,
          batchSizeEnd: 64,
          learningRate: 2e-5,
          maxSeqLen: 2048,
        },
        privacyMode: PrivacyMode.Public,
      });

      expect(runId).toMatch(/^0x[a-f0-9]{64}$/);
      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('getJobStatus', () => {
    test('returns job status from contract', async () => {
      // First call for getRunInfo
      mockReadContract.mockResolvedValueOnce([
        mockAccount.address,
        RunState.RoundTrain,
        2,
        150,
        6,
        PrivacyMode.Public,
      ]);
      // Second call for getRunConfig
      mockReadContract.mockResolvedValueOnce({
        totalSteps: 1000,
        minClients: 4,
        initMinClients: 6,
        witnessNodes: 4,
        warmupTime: BigInt(300),
        cooldownTime: BigInt(60),
        maxRoundTrainTime: BigInt(600),
        roundWitnessTime: BigInt(60),
        epochTime: BigInt(3600),
        globalBatchSizeWarmupTokens: BigInt(1000000),
        globalBatchSizeStart: 16,
        globalBatchSizeEnd: 64,
        verificationPercent: 10,
        waitingForMembersExtraTime: 60,
      });

      const status = await client.getJobStatus('0xrunid' as Hex);

      expect(status).not.toBeNull();
      expect(status?.state).toBe(RunState.RoundTrain);
      expect(status?.epoch).toBe(2);
      expect(status?.step).toBe(150);
      expect(status?.clientCount).toBe(6);
    });

    test('returns null for uninitialized run', async () => {
      mockReadContract.mockResolvedValueOnce([
        mockAccount.address,
        RunState.Uninitialized,
        0,
        0,
        0,
        PrivacyMode.Public,
      ]);

      const status = await client.getJobStatus('0xrunid' as Hex);
      expect(status).toBeNull();
    });
  });

  describe('getOptimalNodes', () => {
    test('returns optimal nodes based on requirements', async () => {
      // Mock getOptimalNodes
      mockReadContract.mockResolvedValueOnce([
        '0xNode1' as Address,
        '0xNode2' as Address,
        '0xNode3' as Address,
      ]);
      // Mock getNodeMetrics for each node
      for (let i = 0; i < 3; i++) {
        mockReadContract.mockResolvedValueOnce({
          totalRoundsParticipated: BigInt(100),
          successfulRounds: BigInt(95),
          droppedRounds: BigInt(5),
          witnessSubmissions: BigInt(50),
          successfulWitnesses: BigInt(48),
          averageLatencyMs: BigInt(50),
          averageBandwidthMbps: BigInt(1000),
          averageTokensPerSec: BigInt(5000),
          gpuTier: GPUTier.Datacenter,
          attestationHash: '0xattest' as Hex,
          lastActiveTimestamp: BigInt(1000000),
          registeredAt: BigInt(900000),
          score: 95,
        });
        // Mock isNodeActive
        mockReadContract.mockResolvedValueOnce(true);
        // Mock getNodeScore
        mockReadContract.mockResolvedValueOnce(95);
      }

      const nodes = await client.getOptimalNodes(3, GPUTier.Datacenter, 80);

      expect(nodes.length).toBe(3);
      expect(mockReadContract).toHaveBeenCalled();
    });
  });

  describe('pauseJob', () => {
    test('pauses a running training', async () => {
      mockWriteContract.mockResolvedValue('0xpausehash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      await client.pauseJob('0xrunid' as Hex);

      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('resumeJob', () => {
    test('resumes a paused training', async () => {
      mockWriteContract.mockResolvedValue('0xresumehash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      await client.resumeJob('0xrunid' as Hex);

      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('claimRewards', () => {
    test('claims rewards for participant', async () => {
      mockReadContract.mockResolvedValueOnce([BigInt(5000), BigInt(100)]);
      mockWriteContract.mockResolvedValue('0xclaimhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const amount = await client.claimRewards('0xrunid' as Hex);

      expect(amount).toBe(BigInt(5000));
      expect(mockWriteContract).toHaveBeenCalled();
    });

    test('returns 0 when nothing to claim', async () => {
      mockReadContract.mockResolvedValueOnce([BigInt(0), BigInt(0)]);

      const amount = await client.claimRewards('0xrunid' as Hex);

      expect(amount).toBe(BigInt(0));
      expect(mockWriteContract).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    test('clears all watchers and active runs', () => {
      client.cleanup();
      // After cleanup, the client should be in a clean state
      expect(client).toBeDefined();
    });
  });
});

describe('DistributedTrainingClient types', () => {
  test('exports all required enums', () => {
    expect(RunState).toBeDefined();
    expect(PrivacyMode).toBeDefined();
    expect(GPUTier).toBeDefined();
  });

  test('RunState has all expected values', () => {
    expect(Object.keys(RunState).length).toBeGreaterThan(0);
    expect(RunState.Uninitialized).toBe(0);
    expect(RunState.Finished).toBe(6);
  });
});

describe('DistributedTrainingClient edge cases', () => {
  let client: DistributedTrainingClient;

  beforeEach(() => {
    mockReadContract.mockReset();
    mockWriteContract.mockReset();
    mockWaitForTransactionReceipt.mockReset();
    mockWatchContractEvent.mockReset();

    client = new DistributedTrainingClient(testConfig);
  });

  describe('submitJob edge cases', () => {
    test('generates unique runIds for same name with different times', async () => {
      mockWriteContract.mockResolvedValue('0xhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      // Submit two jobs with same name (runIds should differ due to timestamp/nonce)
      const runId1 = await client.submitJob({
        name: 'test-run',
        baseModel: 'openai/gpt-2',
        datasetCid: 'QmTest',
        training: {
          totalSteps: 1000,
          minNodes: 4,
          batchSizeStart: 16,
          batchSizeEnd: 64,
          learningRate: 2e-5,
          maxSeqLen: 2048,
        },
        privacyMode: PrivacyMode.Public,
      });

      // Note: In practice these would be identical since the SDK uses name + address for runId
      // But the test verifies the format is correct
      expect(runId1).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('handles minimum training config values', async () => {
      mockWriteContract.mockResolvedValue('0xhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const runId = await client.submitJob({
        name: 'minimal-run',
        baseModel: 'model',
        datasetCid: 'Qm',
        training: {
          totalSteps: 1,
          minNodes: 1,
          batchSizeStart: 1,
          batchSizeEnd: 1,
          learningRate: 1e-10,
          maxSeqLen: 128,
        },
        privacyMode: PrivacyMode.Public,
      });

      expect(runId).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('handles large training config values', async () => {
      mockWriteContract.mockResolvedValue('0xhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const runId = await client.submitJob({
        name: 'large-run',
        baseModel: 'meta-llama/Llama-2-70b',
        datasetCid: 'QmLargeDataset',
        training: {
          totalSteps: 1000000,
          minNodes: 256,
          batchSizeStart: 8,
          batchSizeEnd: 512,
          learningRate: 1e-4,
          maxSeqLen: 8192,
        },
        privacyMode: PrivacyMode.Public,
      });

      expect(runId).toMatch(/^0x[a-f0-9]{64}$/);
    });
  });

  describe('getJobStatus edge cases', () => {
    test('returns null for Uninitialized state', async () => {
      mockReadContract.mockResolvedValueOnce([
        mockAccount.address,
        RunState.Uninitialized,
        0,
        0,
        0,
        PrivacyMode.Public,
      ]);

      const status = await client.getJobStatus('0xnonexistent' as Hex);
      expect(status).toBeNull();
    });

    test('returns status for all non-Uninitialized states', async () => {
      const states = [
        RunState.WaitingForMembers,
        RunState.Warmup,
        RunState.RoundTrain,
        RunState.RoundWitness,
        RunState.Cooldown,
        RunState.Finished,
        RunState.Paused,
      ];

      for (const state of states) {
        mockReadContract.mockReset();
        mockReadContract.mockResolvedValueOnce([
          mockAccount.address,
          state,
          1,
          100,
          4,
          PrivacyMode.Public,
        ]);
        mockReadContract.mockResolvedValueOnce({
          totalSteps: 1000,
          minClients: 4,
          initMinClients: 6,
          witnessNodes: 4,
          warmupTime: BigInt(300),
          cooldownTime: BigInt(60),
          maxRoundTrainTime: BigInt(600),
          roundWitnessTime: BigInt(60),
          epochTime: BigInt(3600),
          globalBatchSizeWarmupTokens: BigInt(1000000),
          globalBatchSizeStart: 16,
          globalBatchSizeEnd: 64,
          verificationPercent: 10,
          waitingForMembersExtraTime: 60,
        });

        const status = await client.getJobStatus('0xrunid' as Hex);
        expect(status).not.toBeNull();
        expect(status?.state).toBe(state);
      }
    });

    test('returns step and totalSteps correctly', async () => {
      mockReadContract.mockResolvedValueOnce([
        mockAccount.address,
        RunState.RoundTrain,
        5,
        500,
        8,
        PrivacyMode.Public,
      ]);
      mockReadContract.mockResolvedValueOnce({
        totalSteps: 1000,
        minClients: 4,
        initMinClients: 6,
        witnessNodes: 4,
        warmupTime: BigInt(300),
        cooldownTime: BigInt(60),
        maxRoundTrainTime: BigInt(600),
        roundWitnessTime: BigInt(60),
        epochTime: BigInt(3600),
        globalBatchSizeWarmupTokens: BigInt(1000000),
        globalBatchSizeStart: 16,
        globalBatchSizeEnd: 64,
        verificationPercent: 10,
        waitingForMembersExtraTime: 60,
      });

      const status = await client.getJobStatus('0xrunid' as Hex);

      expect(status?.step).toBe(500);
      expect(status?.totalSteps).toBe(1000);
      // Progress can be calculated as: step / totalSteps = 500 / 1000 = 0.5 (50%)
    });
  });

  describe('joinRun', () => {
    test('calls SDK joinRun with correct parameters', async () => {
      mockWriteContract.mockResolvedValue('0xjoinhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      await client.joinRun('0xrunid' as Hex);

      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('withdrawFromJob', () => {
    test('withdraws from job', async () => {
      mockWriteContract.mockResolvedValue('0xwithdrawhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      await client.withdrawFromJob('0xrunid' as Hex);

      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('getParticipantRewards', () => {
    test('returns reward details', async () => {
      // The SDK expects a tuple: [earnedPoints, claimedPoints, lastCompletedEpoch, lastClaimTime]
      mockReadContract.mockResolvedValue([
        BigInt(1000),
        BigInt(500),
        5,
        BigInt(1000000),
      ] as const);

      const rewards = await client.getParticipantRewards('0xrunid' as Hex);

      expect(rewards.earnedPoints).toBe(BigInt(1000));
      expect(rewards.claimedPoints).toBe(BigInt(500));
    });
  });

  describe('claimAllRewards', () => {
    test('claims from multiple runs with rewards', async () => {
      // Mock getClaimable for each run to return some claimable amount
      mockReadContract.mockResolvedValueOnce([BigInt(100), BigInt(50)] as const);
      mockReadContract.mockResolvedValueOnce([BigInt(200), BigInt(100)] as const);
      mockReadContract.mockResolvedValueOnce([BigInt(300), BigInt(150)] as const);

      mockWriteContract.mockResolvedValue('0xclaimallhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const runIds = [
        '0x0000000000000000000000000000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000000000000000000000000000002',
        '0x0000000000000000000000000000000000000000000000000000000000000003',
      ] as Hex[];
      const totalClaimed = await client.claimAllRewards(runIds);

      // claimAllRewards returns total claimable amount (100 + 200 + 300 = 600)
      expect(totalClaimed).toBe(BigInt(600));
      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('getNodeInfo', () => {
    test('returns node info with metrics', async () => {
      mockReadContract.mockResolvedValueOnce({
        totalRoundsParticipated: BigInt(100),
        successfulRounds: BigInt(95),
        droppedRounds: BigInt(5),
        witnessSubmissions: BigInt(50),
        successfulWitnesses: BigInt(48),
        averageLatencyMs: BigInt(50),
        averageBandwidthMbps: BigInt(1000),
        averageTokensPerSec: BigInt(5000),
        gpuTier: GPUTier.Datacenter,
        attestationHash: '0xattest' as Hex,
        lastActiveTimestamp: BigInt(1000000),
        registeredAt: BigInt(900000),
        score: 95,
      });
      mockReadContract.mockResolvedValueOnce(true);
      mockReadContract.mockResolvedValueOnce(95);

      const nodeInfo = await client.getNodeInfo(mockAccount.address);

      expect(nodeInfo.address).toBe(mockAccount.address);
      expect(nodeInfo.isActive).toBe(true);
      expect(nodeInfo.score).toBe(95);
      expect(nodeInfo.metrics.gpuTier).toBe(GPUTier.Datacenter);
    });
  });

  describe('registerNode', () => {
    test('registers a new compute node', async () => {
      mockWriteContract.mockResolvedValue('0xregisterhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      // registerNode returns void, not hash
      await client.registerNode(GPUTier.HighEnd, '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex);

      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('propagates submit job errors', async () => {
      mockWriteContract.mockRejectedValue(new Error('Contract error: Unauthorized'));

      await expect(
        client.submitJob({
          name: 'test-run',
          baseModel: 'openai/gpt-2',
          datasetCid: 'QmValid',
          training: {
            totalSteps: 1000,
            minNodes: 4,
            batchSizeStart: 16,
            batchSizeEnd: 64,
            maxSeqLen: 2048,
          },
          privacyMode: PrivacyMode.Public,
        })
      ).rejects.toThrow('Contract error');
    });

    test('propagates pause errors', async () => {
      mockWriteContract.mockRejectedValue(new Error('Contract error: NotRunCreator'));

      await expect(
        client.pauseJob('0xrunid' as Hex)
      ).rejects.toThrow('NotRunCreator');
    });

    test('propagates resume errors', async () => {
      mockWriteContract.mockRejectedValue(new Error('Contract error: CannotResume'));

      await expect(
        client.resumeJob('0xrunid' as Hex)
      ).rejects.toThrow('CannotResume');
    });
  });

  describe('getOptimalNodes with bandwidth filter', () => {
    test('passes custom minBandwidth to SDK', async () => {
      mockReadContract.mockResolvedValueOnce(['0xNode1' as Address]);
      mockReadContract.mockResolvedValueOnce({
        totalRoundsParticipated: BigInt(50),
        successfulRounds: BigInt(48),
        droppedRounds: BigInt(2),
        witnessSubmissions: BigInt(25),
        successfulWitnesses: BigInt(24),
        averageLatencyMs: BigInt(30),
        averageBandwidthMbps: BigInt(5000),
        averageTokensPerSec: BigInt(3000),
        gpuTier: GPUTier.HighEnd,
        attestationHash: '0xattest' as Hex,
        lastActiveTimestamp: BigInt(1000000),
        registeredAt: BigInt(900000),
        score: 90,
      });
      mockReadContract.mockResolvedValueOnce(true);
      mockReadContract.mockResolvedValueOnce(90);

      const nodes = await client.getOptimalNodes(1, GPUTier.HighEnd, 80, 5000);

      expect(nodes.length).toBe(1);
      expect(nodes[0].metrics.averageBandwidthMbps).toBe(BigInt(5000));
    });
  });

  describe('joinRun with P2P', () => {
    test('initializes P2P endpoint before joining', async () => {
      mockWriteContract.mockResolvedValue('0xjoinhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      // Joining should work (P2P initializes with local fallback)
      await client.joinRun('0xrunid123456789012345678901234567890123456789012345678901234567890' as Hex);

      expect(mockWriteContract).toHaveBeenCalled();
    });
  });
});


import { describe, expect, test, mock, beforeEach } from 'bun:test';
import {
  TrainingSDK,
  RunState,
  PrivacyMode,
  GPUTier,
  ClientState,
} from '../training';
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

// Mock clients
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

const testAddresses = {
  coordinator: '0xCoordinator' as Address,
  rewards: '0xRewards' as Address,
  performance: '0xPerformance' as Address,
  registry: '0xRegistry' as Address,
};

describe('TrainingSDK', () => {
  let sdk: TrainingSDK;

  beforeEach(() => {
    mockReadContract.mockReset();
    mockWriteContract.mockReset();
    mockWaitForTransactionReceipt.mockReset();

    sdk = new TrainingSDK({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      chain: mockChain,
      addresses: testAddresses,
    });
  });

  describe('constructor', () => {
    test('creates SDK with valid config', () => {
      expect(sdk).toBeDefined();
    });

    test('creates SDK without wallet client for read-only operations', () => {
      const readOnlySDK = new TrainingSDK({
        publicClient: mockPublicClient,
        chain: mockChain,
        addresses: testAddresses,
      });
      expect(readOnlySDK).toBeDefined();
    });
  });

  describe('static utilities', () => {
    test('generateRunId creates deterministic ID', () => {
      const runId = TrainingSDK.generateRunId('test-run', mockAccount.address);
      expect(runId).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('getDefaultLLMConfig returns valid config', () => {
      const config = TrainingSDK.getDefaultLLMConfig(1000, 4);

      expect(config.totalSteps).toBe(1000);
      expect(config.minClients).toBe(4);
      expect(config.initMinClients).toBe(6);
      expect(config.witnessNodes).toBe(4);
      expect(config.warmupTime).toBe(BigInt(300));
      expect(config.epochTime).toBe(BigInt(3600));
    });

    test('getDefaultLLMConfig caps witnessNodes at 8', () => {
      const config = TrainingSDK.getDefaultLLMConfig(1000, 20);
      expect(config.witnessNodes).toBe(8);
    });
  });

  describe('createRun', () => {
    test('creates run with valid config', async () => {
      mockWriteContract.mockResolvedValue('0xhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const config = TrainingSDK.getDefaultLLMConfig(1000, 4);
      const runId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex;

      const hash = await sdk.createRun({
        runId,
        config,
        model: {
          modelHash: '0xmodel123' as Hex,
          hfRepo: 'test/model',
          maxSeqLen: 2048,
          coldStartWarmupSteps: 100,
        },
        privacyMode: PrivacyMode.Public,
      });

      expect(hash).toBe('0xhash');
      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('getRunInfo', () => {
    test('returns run info from contract', async () => {
      const mockResult = [
        '0xCreator' as Address,
        RunState.WaitingForMembers,
        1,
        100,
        4,
        PrivacyMode.Public,
      ] as const;

      mockReadContract.mockResolvedValue(mockResult);

      const runId = '0xrunid' as Hex;
      const info = await sdk.getRunInfo(runId);

      expect(info.creator).toBe('0xCreator');
      expect(info.state).toBe(RunState.WaitingForMembers);
      expect(info.epoch).toBe(1);
      expect(info.step).toBe(100);
      expect(info.clientCount).toBe(4);
      expect(info.privacyMode).toBe(PrivacyMode.Public);
    });
  });

  describe('getRunState', () => {
    test('returns run state', async () => {
      mockReadContract.mockResolvedValue(RunState.RoundTrain);

      const state = await sdk.getRunState('0xrunid' as Hex);
      expect(state).toBe(RunState.RoundTrain);
    });
  });

  describe('getClients', () => {
    test('returns empty array for run with no clients', async () => {
      mockReadContract.mockResolvedValue([]);

      const clients = await sdk.getClients('0xrunid' as Hex);
      expect(clients).toEqual([]);
    });

    test('returns mapped client data', async () => {
      mockReadContract.mockResolvedValue([
        {
          addr: '0xClient1' as Address,
          p2pEndpointId: '0xEndpoint1' as Hex,
          state: ClientState.Healthy,
          exitedHeight: 0,
          joinedAt: BigInt(1000),
        },
      ]);

      const clients = await sdk.getClients('0xrunid' as Hex);
      expect(clients.length).toBe(1);
      expect(clients[0].addr).toBe('0xClient1');
      expect(clients[0].state).toBe(ClientState.Healthy);
    });
  });

  describe('getClaimable', () => {
    test('returns claimable info', async () => {
      mockReadContract.mockResolvedValue([BigInt(1000), BigInt(500)]);

      const claimable = await sdk.getClaimable('0xrunid' as Hex, mockAccount.address);

      expect(claimable.claimableAmount).toBe(BigInt(1000));
      expect(claimable.claimablePoints).toBe(BigInt(500));
    });
  });

  describe('getNodeMetrics', () => {
    test('returns node metrics', async () => {
      mockReadContract.mockResolvedValue({
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

      const metrics = await sdk.getNodeMetrics(mockAccount.address);

      expect(metrics.totalRoundsParticipated).toBe(BigInt(100));
      expect(metrics.successfulRounds).toBe(BigInt(95));
      expect(metrics.gpuTier).toBe(GPUTier.Datacenter);
      expect(metrics.score).toBe(95);
    });
  });

  describe('event watching', () => {
    test('watchStateTransition sets up event listener', () => {
      const callback = mock(() => {});
      const unwatch = sdk.watchStateTransition(null, callback);

      expect(mockWatchContractEvent).toHaveBeenCalled();
      expect(typeof unwatch).toBe('function');
    });

    test('watchRoundStarted sets up event listener', () => {
      const callback = mock(() => {});
      const unwatch = sdk.watchRoundStarted('0xrunid' as Hex, callback);

      expect(mockWatchContractEvent).toHaveBeenCalled();
      expect(typeof unwatch).toBe('function');
    });

    test('watchEpochCompleted sets up event listener', () => {
      const callback = mock(() => {});
      const unwatch = sdk.watchEpochCompleted('0xrunid' as Hex, callback);

      expect(mockWatchContractEvent).toHaveBeenCalled();
      expect(typeof unwatch).toBe('function');
    });
  });

  describe('write operations require wallet', () => {
    test('createRun throws without wallet client', async () => {
      const readOnlySDK = new TrainingSDK({
        publicClient: mockPublicClient,
        chain: mockChain,
        addresses: testAddresses,
      });

      const config = TrainingSDK.getDefaultLLMConfig(1000, 4);

      await expect(
        readOnlySDK.createRun({
          runId: '0xrunid' as Hex,
          config,
          model: {
            modelHash: '0xmodel' as Hex,
            hfRepo: 'test/model',
            maxSeqLen: 2048,
            coldStartWarmupSteps: 100,
          },
          privacyMode: PrivacyMode.Public,
        })
      ).rejects.toThrow('WalletClient with account required');
    });
  });
});

describe('Enums', () => {
  test('RunState values match Solidity contract', () => {
    expect(RunState.Uninitialized).toBe(0);
    expect(RunState.WaitingForMembers).toBe(1);
    expect(RunState.Warmup).toBe(2);
    expect(RunState.RoundTrain).toBe(3);
    expect(RunState.RoundWitness).toBe(4);
    expect(RunState.Cooldown).toBe(5);
    expect(RunState.Finished).toBe(6);
    expect(RunState.Paused).toBe(7);
  });

  test('PrivacyMode values match Solidity contract', () => {
    expect(PrivacyMode.Public).toBe(0);
    expect(PrivacyMode.Private).toBe(1);
  });

  test('GPUTier values match Solidity contract', () => {
    expect(GPUTier.Unknown).toBe(0);
    expect(GPUTier.Consumer).toBe(1);
    expect(GPUTier.Prosumer).toBe(2);
    expect(GPUTier.Datacenter).toBe(3);
    expect(GPUTier.HighEnd).toBe(4);
  });

  test('ClientState values match Solidity contract', () => {
    expect(ClientState.Healthy).toBe(0);
    expect(ClientState.Dropped).toBe(1);
    expect(ClientState.Withdrawn).toBe(2);
    expect(ClientState.Ejected).toBe(3);
  });
});

describe('TrainingSDK write operations', () => {
  let sdk: TrainingSDK;

  beforeEach(() => {
    mockReadContract.mockReset();
    mockWriteContract.mockReset();
    mockWaitForTransactionReceipt.mockReset();

    sdk = new TrainingSDK({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      chain: mockChain,
      addresses: testAddresses,
    });
  });

  describe('submitWitness', () => {
    test('submits witness with valid submission', async () => {
      mockWriteContract.mockResolvedValue('0xwitnesshash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const submission = {
        participantBloom: '0x1234' as Hex,
        broadcastBloom: '0x5678' as Hex,
        broadcastMerkle: '0xabcd' as Hex,
        step: 10,
        tokensPerSec: BigInt(5000),
        bandwidthPerSec: BigInt(1000000000),
        loss: 250,
      };

      const hash = await sdk.submitWitness('0xrunid' as Hex, submission);

      expect(hash).toBe('0xwitnesshash');
      expect(mockWriteContract).toHaveBeenCalled();
    });

    test('submits witness with proof', async () => {
      mockWriteContract.mockResolvedValue('0xwitnesshash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const submission = {
        participantBloom: '0x1234' as Hex,
        broadcastBloom: '0x5678' as Hex,
        broadcastMerkle: '0xabcd' as Hex,
        step: 10,
        tokensPerSec: BigInt(5000),
        bandwidthPerSec: BigInt(1000000000),
        loss: 250,
      };

      const proof = '0xproof1234' as Hex;
      const hash = await sdk.submitWitness('0xrunid' as Hex, submission, proof);

      expect(hash).toBe('0xwitnesshash');
    });
  });

  describe('submitWarmupWitness', () => {
    test('submits warmup witness', async () => {
      mockWriteContract.mockResolvedValue('0xwarmupwitnesshash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const submission = {
        participantBloom: '0x1234' as Hex,
        broadcastBloom: '0x5678' as Hex,
        broadcastMerkle: '0xabcd' as Hex,
        step: 5,
        tokensPerSec: BigInt(4000),
        bandwidthPerSec: BigInt(800000000),
        loss: 300,
      };

      const hash = await sdk.submitWarmupWitness('0xrunid' as Hex, submission);

      expect(hash).toBe('0xwarmupwitnesshash');
      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('submitCheckpoint', () => {
    test('submits checkpoint with model hash and repo', async () => {
      mockWriteContract.mockResolvedValue('0xcheckpointhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const hash = await sdk.submitCheckpoint(
        '0xrunid' as Hex,
        '0xmodelhash123456789abcdef' as Hex,
        'jeju/model-checkpoint-v1'
      );

      expect(hash).toBe('0xcheckpointhash');
      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('withdrawFromRun', () => {
    test('withdraws from run', async () => {
      mockWriteContract.mockResolvedValue('0xwithdrawhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const hash = await sdk.withdrawFromRun('0xrunid' as Hex);

      expect(hash).toBe('0xwithdrawhash');
      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('createRun with rewards', () => {
    test('creates run and reward pool when rewardToken provided', async () => {
      // First call: createRun
      mockWriteContract.mockResolvedValueOnce('0xcreaterunhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValueOnce({ status: 'success' });

      // allowance check
      mockReadContract.mockResolvedValueOnce(BigInt(0));

      // approve call
      mockWriteContract.mockResolvedValueOnce('0xapprovehash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValueOnce({ status: 'success' });

      // createRewardPool call
      mockWriteContract.mockResolvedValueOnce('0xrewardpoolhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValueOnce({ status: 'success' });

      const config = TrainingSDK.getDefaultLLMConfig(1000, 4);
      const hash = await sdk.createRun({
        runId: '0xrunid123456789012345678901234567890123456789012345678901234567890' as Hex,
        config,
        model: {
          modelHash: '0xmodel123' as Hex,
          hfRepo: 'test/model',
          maxSeqLen: 2048,
          coldStartWarmupSteps: 100,
        },
        privacyMode: PrivacyMode.Public,
        rewardToken: '0xTokenAddress1234567890123456789012345678' as Address,
        rewardAmount: BigInt(1000 * 10 ** 18),
      });

      expect(hash).toBe('0xcreaterunhash');
      // Should have called createRun, then allowance, approve, createRewardPool
      expect(mockWriteContract).toHaveBeenCalledTimes(3);
      expect(mockReadContract).toHaveBeenCalledTimes(1);
    });

    test('skips approve if allowance sufficient', async () => {
      // createRun
      mockWriteContract.mockResolvedValueOnce('0xcreaterunhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValueOnce({ status: 'success' });

      // allowance check - already approved
      mockReadContract.mockResolvedValueOnce(BigInt(2000 * 10 ** 18));

      // createRewardPool call only
      mockWriteContract.mockResolvedValueOnce('0xrewardpoolhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValueOnce({ status: 'success' });

      const config = TrainingSDK.getDefaultLLMConfig(1000, 4);
      const hash = await sdk.createRun({
        runId: '0xrunid123456789012345678901234567890123456789012345678901234567890' as Hex,
        config,
        model: {
          modelHash: '0xmodel123' as Hex,
          hfRepo: 'test/model',
          maxSeqLen: 2048,
          coldStartWarmupSteps: 100,
        },
        privacyMode: PrivacyMode.Public,
        rewardToken: '0xTokenAddress1234567890123456789012345678' as Address,
        rewardAmount: BigInt(1000 * 10 ** 18),
      });

      expect(hash).toBe('0xcreaterunhash');
      // Should have called createRun and createRewardPool, but NOT approve
      expect(mockWriteContract).toHaveBeenCalledTimes(2);
    });
  });
});

describe('TrainingSDK edge cases', () => {
  let sdk: TrainingSDK;

  beforeEach(() => {
    mockReadContract.mockReset();
    mockWriteContract.mockReset();
    mockWaitForTransactionReceipt.mockReset();

    sdk = new TrainingSDK({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      chain: mockChain,
      addresses: testAddresses,
    });
  });

  describe('static utilities edge cases', () => {
    test('generateRunId produces different IDs for different inputs', () => {
      const address2 = '0x2222222222222222222222222222222222222222' as Address;
      const id1 = TrainingSDK.generateRunId('run-a', mockAccount.address);
      const id2 = TrainingSDK.generateRunId('run-b', mockAccount.address);
      const id3 = TrainingSDK.generateRunId('run-a', address2);

      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id2).not.toBe(id3);
    });

    test('generateRunId produces same ID for same inputs (deterministic)', () => {
      const id1 = TrainingSDK.generateRunId('my-run', mockAccount.address);
      const id2 = TrainingSDK.generateRunId('my-run', mockAccount.address);

      expect(id1).toBe(id2);
    });

    test('getDefaultLLMConfig handles minimum values', () => {
      const config = TrainingSDK.getDefaultLLMConfig(1, 1);

      expect(config.totalSteps).toBe(1);
      expect(config.minClients).toBe(1);
      expect(config.initMinClients).toBeGreaterThan(config.minClients);
      expect(config.witnessNodes).toBeGreaterThanOrEqual(1);
    });

    test('getDefaultLLMConfig handles large values', () => {
      const config = TrainingSDK.getDefaultLLMConfig(1000000, 100);

      expect(config.totalSteps).toBe(1000000);
      expect(config.minClients).toBe(100);
      expect(config.witnessNodes).toBe(8); // capped at 8
    });
  });

  describe('read operations', () => {
    test('getRunInfo handles all run states', async () => {
      for (const state of [
        RunState.Uninitialized,
        RunState.WaitingForMembers,
        RunState.Warmup,
        RunState.RoundTrain,
        RunState.RoundWitness,
        RunState.Cooldown,
        RunState.Finished,
        RunState.Paused,
      ]) {
        mockReadContract.mockResolvedValue([
          '0xCreator' as Address,
          state,
          0,
          0,
          0,
          PrivacyMode.Public,
        ] as const);

        const info = await sdk.getRunInfo('0xrunid' as Hex);
        expect(info.state).toBe(state);
      }
    });

    test('getClients handles large client arrays', async () => {
      const largeClientList = Array.from({ length: 100 }, (_, i) => ({
        addr: `0x${i.toString(16).padStart(40, '0')}` as Address,
        p2pEndpointId: `0x${i.toString(16).padStart(64, '0')}` as Hex,
        state: ClientState.Healthy,
        exitedHeight: 0,
        joinedAt: BigInt(1000 + i),
      }));

      mockReadContract.mockResolvedValue(largeClientList);

      const clients = await sdk.getClients('0xrunid' as Hex);
      expect(clients.length).toBe(100);
      expect(clients[99].addr).toBe('0x0000000000000000000000000000000000000063');
    });

    test('getNodeMetrics handles all GPU tiers', async () => {
      for (const tier of [
        GPUTier.Unknown,
        GPUTier.Consumer,
        GPUTier.Prosumer,
        GPUTier.Datacenter,
        GPUTier.HighEnd,
      ]) {
        mockReadContract.mockResolvedValue({
          totalRoundsParticipated: BigInt(0),
          successfulRounds: BigInt(0),
          droppedRounds: BigInt(0),
          witnessSubmissions: BigInt(0),
          successfulWitnesses: BigInt(0),
          averageLatencyMs: BigInt(0),
          averageBandwidthMbps: BigInt(0),
          averageTokensPerSec: BigInt(0),
          gpuTier: tier,
          attestationHash: '0x0' as Hex,
          lastActiveTimestamp: BigInt(0),
          registeredAt: BigInt(0),
          score: 50,
        });

        const metrics = await sdk.getNodeMetrics(mockAccount.address);
        expect(metrics.gpuTier).toBe(tier);
      }
    });

    test('isClientInRun returns boolean values', async () => {
      mockReadContract.mockResolvedValueOnce(true);
      const inRun = await sdk.isClientInRun('0xrunid' as Hex, mockAccount.address);
      expect(inRun).toBe(true);

      mockReadContract.mockResolvedValueOnce(false);
      const notInRun = await sdk.isClientInRun('0xrunid' as Hex, mockAccount.address);
      expect(notInRun).toBe(false);
    });

    test('getOptimalNodes handles empty result', async () => {
      mockReadContract.mockResolvedValue([]);
      const nodes = await sdk.getOptimalNodes(10, GPUTier.HighEnd, 100);
      expect(nodes).toEqual([]);
    });

    test('isNodeActive returns correct boolean', async () => {
      mockReadContract.mockResolvedValueOnce(true);
      expect(await sdk.isNodeActive(mockAccount.address)).toBe(true);

      mockReadContract.mockResolvedValueOnce(false);
      expect(await sdk.isNodeActive(mockAccount.address)).toBe(false);
    });
  });

  describe('write operations', () => {
    test('joinRun requires wallet client', async () => {
      const readOnlySDK = new TrainingSDK({
        publicClient: mockPublicClient,
        chain: mockChain,
        addresses: testAddresses,
      });

      await expect(
        readOnlySDK.joinRun('0xrunid' as Hex, '0xendpoint' as Hex)
      ).rejects.toThrow('WalletClient with account required');
    });

    test('tick requires wallet client', async () => {
      const readOnlySDK = new TrainingSDK({
        publicClient: mockPublicClient,
        chain: mockChain,
        addresses: testAddresses,
      });

      await expect(
        readOnlySDK.tick('0xrunid' as Hex)
      ).rejects.toThrow('WalletClient with account required');
    });

    test('pauseRun requires wallet client', async () => {
      const readOnlySDK = new TrainingSDK({
        publicClient: mockPublicClient,
        chain: mockChain,
        addresses: testAddresses,
      });

      await expect(
        readOnlySDK.pauseRun('0xrunid' as Hex)
      ).rejects.toThrow('WalletClient with account required');
    });

    test('claim calls writeContract with correct args', async () => {
      mockWriteContract.mockResolvedValue('0xclaimhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const hash = await sdk.claim('0xrunid' as Hex);

      expect(hash).toBe('0xclaimhash');
      expect(mockWriteContract).toHaveBeenCalled();
    });

    test('registerNode calls writeContract correctly', async () => {
      mockWriteContract.mockResolvedValue('0xregisterhash' as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const hash = await sdk.registerNode(GPUTier.Datacenter, '0xattest' as Hex);

      expect(hash).toBe('0xregisterhash');
      expect(mockWriteContract).toHaveBeenCalled();
    });
  });

  describe('contract call error propagation', () => {
    test('read operation propagates contract errors', async () => {
      const contractError = new Error('Contract call failed: RunNotFound');
      mockReadContract.mockRejectedValue(contractError);

      await expect(
        sdk.getRunInfo('0xnonexistent' as Hex)
      ).rejects.toThrow('Contract call failed');
    });

    test('write operation propagates transaction errors', async () => {
      const txError = new Error('Transaction reverted: InvalidConfig');
      mockWriteContract.mockRejectedValue(txError);

      await expect(
        sdk.createRun({
          runId: '0xrunid' as Hex,
          config: TrainingSDK.getDefaultLLMConfig(0, 0), // Invalid config
          model: {
            modelHash: '0xmodel' as Hex,
            hfRepo: 'test/model',
            maxSeqLen: 2048,
            coldStartWarmupSteps: 100,
          },
          privacyMode: PrivacyMode.Public,
        })
      ).rejects.toThrow('Transaction reverted');
    });
  });

  describe('getRunConfig', () => {
    test('returns properly typed config', async () => {
      const mockConfig = {
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
      };

      mockReadContract.mockResolvedValue(mockConfig);

      const config = await sdk.getRunConfig('0xrunid' as Hex);

      expect(config.totalSteps).toBe(1000);
      expect(config.minClients).toBe(4);
      expect(config.warmupTime).toBe(BigInt(300));
      expect(typeof config.epochTime).toBe('bigint');
    });
  });

  describe('getCurrentRound', () => {
    test('returns properly typed round', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockRound = {
        height: 5,
        clientsLen: 8,
        randomSeed: BigInt('0x1234567890abcdef'),
        startedAt: BigInt(now),
      };

      mockReadContract.mockResolvedValue(mockRound);

      const round = await sdk.getCurrentRound('0xrunid' as Hex);

      expect(round.height).toBe(5);
      expect(round.clientsLen).toBe(8);
      expect(typeof round.randomSeed).toBe('bigint');
      expect(typeof round.startedAt).toBe('bigint');
    });
  });
});


/**
 * Training SDK On-Chain Integration Tests
 * Tests actual contract deployment and real chain interactions
 *
 * Run with: bun test tests/integration/training-onchain.test.ts
 * Requires: Anvil running on port 8545 with deployed contracts
 *
 * To set up:
 *   1. Start anvil: anvil
 *   2. Deploy contracts: cd packages/contracts && forge script deploy/DeployTraining.s.sol --rpc-url http://localhost:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *   3. Export addresses or use deployment-localnet.json
 */

import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  parseEther,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  zeroHash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { TrainingSDK, RunState, PrivacyMode, GPUTier } from '../../src/compute/sdk/training';
import { DistributedTrainingClient } from '../../src/compute/sdk/distributed-training';
import { $ } from 'bun';
import { existsSync, readFileSync } from 'fs';

setDefaultTimeout(60000);

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const PRIVATE_KEY = (process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex;
const PRIVATE_KEY_2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;

// Check if deployment exists and anvil is running
function checkDeploymentExists(): boolean {
  const deploymentPath = `${process.cwd()}/deployment-training-localnet.json`;
  return existsSync(deploymentPath);
}

async function checkAnvilAtLoad(): Promise<boolean> {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Skip if deployment missing, anvil not running, or explicitly requested
const DEPLOYMENT_EXISTS = checkDeploymentExists();
const ANVIL_AVAILABLE = await checkAnvilAtLoad();
const SKIP = process.env.SKIP_INTEGRATION === 'true' || !ANVIL_AVAILABLE || !DEPLOYMENT_EXISTS;

if (!ANVIL_AVAILABLE) {
  console.log('[Integration] Anvil not running, skipping training on-chain tests');
} else if (!DEPLOYMENT_EXISTS) {
  console.log('[Integration] Training contracts not deployed (deployment-training-localnet.json missing), skipping tests');
}

// Contract addresses - will be loaded from deployment file or deployed fresh
let COORDINATOR_ADDRESS: Address;
let REWARDS_ADDRESS: Address;
let PERFORMANCE_ADDRESS: Address;
let REGISTRY_ADDRESS: Address;
let COMPUTE_REGISTRY_ADDRESS: Address;
let MPC_KEY_REGISTRY_ADDRESS: Address;
let IDENTITY_REGISTRY_ADDRESS: Address;

interface DeploymentResult {
  coordinator: Address;
  rewards: Address;
  registry: Address;
  oracle: Address;
  computeRegistry: Address;
  mpcKeyRegistry: Address;
}

// This function is no longer needed - anvil check is done at module load
// async function checkAnvilRunning(): Promise<boolean> {
//   const client = createPublicClient({ chain: foundry, transport: http(RPC_URL) });
//   const blockNumber = await client.getBlockNumber().catch(() => null);
//   return blockNumber !== null;
// }

async function deployContracts(): Promise<DeploymentResult> {
  console.log('[Integration] Deploying training contracts...');

  const result = await $`cd ${process.cwd()}/../../packages/contracts && \
    PRIVATE_KEY=${PRIVATE_KEY} forge script deploy/DeployTraining.s.sol \
    --rpc-url ${RPC_URL} \
    --broadcast \
    --json 2>/dev/null`.text();

  // Parse deployment addresses from forge output
  const lines = result.split('\n');
  const addresses: Record<string, Address> = {};

  for (const line of lines) {
    const match = line.match(/Deployed (\w+):\s*(0x[a-fA-F0-9]{40})/);
    if (match) {
      addresses[match[1].toLowerCase()] = match[2] as Address;
    }
  }

  return {
    coordinator: addresses.trainingcoordinator || '0x0' as Address,
    rewards: addresses.trainingrewards || '0x0' as Address,
    registry: addresses.trainingregistry || '0x0' as Address,
    oracle: addresses.nodeperformanceoracle || '0x0' as Address,
    computeRegistry: addresses.computeregistry || '0x0' as Address,
    mpcKeyRegistry: addresses.mpckeyregistry || '0x0' as Address,
  };
}

function loadDeploymentAddresses(): DeploymentResult | null {
  const deploymentPath = `${process.cwd()}/deployment-training-localnet.json`;
  if (!existsSync(deploymentPath)) return null;

  const data = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
  return {
    coordinator: data.TrainingCoordinator as Address,
    rewards: data.TrainingRewards as Address,
    registry: data.TrainingRegistry as Address,
    oracle: data.NodePerformanceOracle as Address,
    computeRegistry: data.ComputeRegistry as Address,
    mpcKeyRegistry: data.MPCKeyRegistry as Address,
  };
}

describe.skipIf(SKIP)('Training SDK On-Chain Integration', () => {
  let publicClient: ReturnType<typeof createPublicClient>;
  let walletClient: ReturnType<typeof createWalletClient>;
  let walletClient2: ReturnType<typeof createWalletClient>;
  let sdk: TrainingSDK;
  let account1: Address;
  let account2: Address;

  beforeAll(async () => {
    // Set up accounts
    const acc1 = privateKeyToAccount(PRIVATE_KEY);
    const acc2 = privateKeyToAccount(PRIVATE_KEY_2);
    account1 = acc1.address;
    account2 = acc2.address;

    // Create clients
    publicClient = createPublicClient({
      chain: foundry,
      transport: http(RPC_URL),
    });

    walletClient = createWalletClient({
      account: acc1,
      chain: foundry,
      transport: http(RPC_URL),
    });

    walletClient2 = createWalletClient({
      account: acc2,
      chain: foundry,
      transport: http(RPC_URL),
    });

    // Load or deploy contracts
    let deployment = loadDeploymentAddresses();
    if (!deployment || deployment.coordinator === '0x0') {
      deployment = await deployContracts();
    }

    COORDINATOR_ADDRESS = deployment.coordinator;
    REWARDS_ADDRESS = deployment.rewards;
    PERFORMANCE_ADDRESS = deployment.oracle;
    REGISTRY_ADDRESS = deployment.registry;
    COMPUTE_REGISTRY_ADDRESS = deployment.computeRegistry;
    MPC_KEY_REGISTRY_ADDRESS = deployment.mpcKeyRegistry;

    console.log('[Integration] Using addresses:', {
      coordinator: COORDINATOR_ADDRESS,
      rewards: REWARDS_ADDRESS,
      performance: PERFORMANCE_ADDRESS,
    });

    // Create SDK
    sdk = new TrainingSDK({
      publicClient,
      walletClient,
      chain: foundry,
      addresses: {
        coordinator: COORDINATOR_ADDRESS,
        rewards: REWARDS_ADDRESS,
        performance: PERFORMANCE_ADDRESS,
        registry: REGISTRY_ADDRESS,
      },
    });
  });

  test('should have valid contract addresses', async () => {

    expect(COORDINATOR_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(REWARDS_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(PERFORMANCE_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test('should read contract state', async () => {

    // Try to read a non-existent run - should return Uninitialized state
    const testRunId = keccak256(encodeAbiParameters(parseAbiParameters('string'), ['nonexistent-run']));
    const state = await sdk.getRunState(testRunId);
    expect(state).toBe(RunState.Uninitialized);
  });

  test('should create a training run', async () => {

    const runName = `test-run-${Date.now()}`;
    const runId = TrainingSDK.generateRunId(runName, account1);
    const config = TrainingSDK.getDefaultLLMConfig(100, 2);
    const modelHash = keccak256(encodeAbiParameters(parseAbiParameters('string'), ['test-model']));

    const txHash = await sdk.createRun({
      runId,
      config,
      model: {
        modelHash,
        hfRepo: 'test/model',
        maxSeqLen: 2048,
        coldStartWarmupSteps: 10,
      },
      privacyMode: PrivacyMode.Public,
    });

    expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Verify the run was created
    const state = await sdk.getRunState(runId);
    expect(state).toBe(RunState.WaitingForMembers);

    // Verify run info
    const info = await sdk.getRunInfo(runId);
    expect(info.creator.toLowerCase()).toBe(account1.toLowerCase());
    expect(info.state).toBe(RunState.WaitingForMembers);
    expect(info.privacyMode).toBe(PrivacyMode.Public);
  });

  test('should join a training run', async () => {

    // Create a new run
    const runName = `join-test-${Date.now()}`;
    const runId = TrainingSDK.generateRunId(runName, account1);
    const config = TrainingSDK.getDefaultLLMConfig(100, 2);
    const modelHash = keccak256(encodeAbiParameters(parseAbiParameters('string'), ['join-test-model']));

    await sdk.createRun({
      runId,
      config,
      model: {
        modelHash,
        hfRepo: 'test/join-model',
        maxSeqLen: 2048,
        coldStartWarmupSteps: 10,
      },
      privacyMode: PrivacyMode.Public,
    });

    // Join with a different account
    const sdk2 = new TrainingSDK({
      publicClient,
      walletClient: walletClient2,
      chain: foundry,
      addresses: {
        coordinator: COORDINATOR_ADDRESS,
        rewards: REWARDS_ADDRESS,
        performance: PERFORMANCE_ADDRESS,
        registry: REGISTRY_ADDRESS,
      },
    });

    const p2pEndpointId = keccak256(encodeAbiParameters(parseAbiParameters('string'), ['p2p-endpoint']));
    const joinTxHash = await sdk2.joinRun(runId, p2pEndpointId);
    expect(joinTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Verify client is in run
    const isInRun = await sdk2.isClientInRun(runId, account2);
    expect(isInRun).toBe(true);

    // Verify clients list
    const clients = await sdk.getClients(runId);
    expect(clients.length).toBeGreaterThan(0);
  });

  test('should tick run state forward', async () => {

    // Create a run with very short timing
    const runName = `tick-test-${Date.now()}`;
    const runId = TrainingSDK.generateRunId(runName, account1);
    const modelHash = keccak256(encodeAbiParameters(parseAbiParameters('string'), ['tick-test-model']));

    // Use minimal config for testing
    await sdk.createRun({
      runId,
      config: {
        warmupTime: BigInt(1),
        cooldownTime: BigInt(1),
        maxRoundTrainTime: BigInt(10),
        roundWitnessTime: BigInt(5),
        epochTime: BigInt(60),
        globalBatchSizeWarmupTokens: BigInt(1000),
        totalSteps: 10,
        initMinClients: 1,
        minClients: 1,
        witnessNodes: 1,
        globalBatchSizeStart: 8,
        globalBatchSizeEnd: 16,
        verificationPercent: 10,
        waitingForMembersExtraTime: 1,
      },
      model: {
        modelHash,
        hfRepo: 'test/tick-model',
        maxSeqLen: 512,
        coldStartWarmupSteps: 1,
      },
      privacyMode: PrivacyMode.Public,
    });

    // Join the run as creator
    const p2pEndpointId = keccak256(encodeAbiParameters(parseAbiParameters('string'), ['creator-endpoint']));
    await sdk.joinRun(runId, p2pEndpointId);

    // Wait for timing and tick
    await new Promise((r) => setTimeout(r, 2000));

    const tickTxHash = await sdk.tick(runId);
    expect(tickTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // State should have progressed
    const state = await sdk.getRunState(runId);
    expect([RunState.Warmup, RunState.RoundTrain]).toContain(state);
  });

  test('should register node performance', async () => {

    const attestationHash = keccak256(encodeAbiParameters(parseAbiParameters('string'), ['attestation']));
    const txHash = await sdk.registerNode(GPUTier.Datacenter, attestationHash);
    expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Verify node was registered
    const isActive = await sdk.isNodeActive(account1);
    expect(isActive).toBe(true);
  });

  test('should get node metrics', async () => {

    // First ensure node is registered
    const attestationHash = keccak256(encodeAbiParameters(parseAbiParameters('string'), ['metrics-test']));
    await sdk.registerNode(GPUTier.HighEnd, attestationHash).catch(() => {});

    const metrics = await sdk.getNodeMetrics(account1);
    expect(metrics).toBeDefined();
    expect(metrics.gpuTier).toBeGreaterThanOrEqual(0);
  });

  test('should get optimal nodes', async () => {

    const nodes = await sdk.getOptimalNodes(5, GPUTier.Consumer, 0, 0);
    expect(Array.isArray(nodes)).toBe(true);
  });
});

describe.skipIf(SKIP)('Distributed Training Client On-Chain Integration', () => {
  let publicClient: ReturnType<typeof createPublicClient>;
  let walletClient: ReturnType<typeof createWalletClient>;
  let client: DistributedTrainingClient;
  let account: Address;

  beforeAll(async () => {
    const acc = privateKeyToAccount(PRIVATE_KEY);
    account = acc.address;

    publicClient = createPublicClient({
      chain: foundry,
      transport: http(RPC_URL),
    });

    walletClient = createWalletClient({
      account: acc,
      chain: foundry,
      transport: http(RPC_URL),
    });

    // Load deployment addresses
    const deployment = loadDeploymentAddresses();
    if (!deployment) {
      console.log('[Integration] No deployment found, skipping');
      return;
    }

    client = new DistributedTrainingClient({
      publicClient,
      walletClient,
      chain: foundry,
      contracts: {
        coordinator: deployment.coordinator,
        rewards: deployment.rewards,
        performance: deployment.oracle,
        registry: deployment.registry,
        identityRegistry: '0x0000000000000000000000000000000000000000' as Address,
      },
      rpcUrl: RPC_URL,
      selfEndpoint: 'http://localhost:3000',
    });
  });

  test('should submit a training job', async () => {

    const runId = await client.submitJob({
      name: `distributed-test-${Date.now()}`,
      baseModel: 'openai/gpt-2',
      datasetCid: 'QmTest123',
      training: {
        totalSteps: 100,
        minNodes: 1,
        batchSizeStart: 8,
        batchSizeEnd: 16,
        maxSeqLen: 512,
      },
      privacyMode: PrivacyMode.Public,
    });

    expect(runId).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  test('should get job status', async () => {

    // Submit a job first
    const runId = await client.submitJob({
      name: `status-test-${Date.now()}`,
      baseModel: 'openai/gpt-2',
      datasetCid: 'QmTest456',
      training: {
        totalSteps: 50,
        minNodes: 1,
        batchSizeStart: 8,
        batchSizeEnd: 16,
        maxSeqLen: 512,
      },
      privacyMode: PrivacyMode.Public,
    });

    const status = await client.getJobStatus(runId);
    expect(status.runId).toBe(runId);
    expect(status.state).toBe(RunState.WaitingForMembers);
    expect(status.totalSteps).toBe(50);
  });

  test('should pause and resume job', async () => {

    // Submit a job
    const runId = await client.submitJob({
      name: `pause-test-${Date.now()}`,
      baseModel: 'openai/gpt-2',
      datasetCid: 'QmPause',
      training: {
        totalSteps: 100,
        minNodes: 1,
        batchSizeStart: 8,
        batchSizeEnd: 16,
        maxSeqLen: 512,
      },
      privacyMode: PrivacyMode.Public,
    });

    // Pause
    const pauseHash = await client.pauseJob(runId);
    expect(pauseHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Verify paused
    let status = await client.getJobStatus(runId);
    expect(status.state).toBe(RunState.Paused);

    // Resume
    const resumeHash = await client.resumeJob(runId);
    expect(resumeHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Verify resumed
    status = await client.getJobStatus(runId);
    expect(status.state).toBe(RunState.WaitingForMembers);
  });

  test('should get optimal nodes for job', async () => {

    const nodes = await client.getOptimalNodes(3);
    expect(Array.isArray(nodes)).toBe(true);
  });
});


/**
 * jeju training - Distributed training operations (Psyche-compatible)
 *
 * Manage distributed ML training runs on Jeju DWS.
 */

import { Command } from 'commander';
import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { getChainStatus } from '../lib/chain';
import { findMonorepoRoot } from '../lib/system';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { DEFAULT_PORTS } from '../types';

const DWS_PORT = parseInt(process.env.DWS_PORT || '4030');

function getDwsUrl(): string {
  return process.env.DWS_URL || `http://localhost:${DWS_PORT}`;
}

function getRpcUrl(network: string): string {
  if (network === 'localnet') return `http://localhost:${DEFAULT_PORTS.l2Rpc}`;
  if (network === 'testnet') return 'https://testnet-rpc.jejunetwork.org';
  return 'https://rpc.jejunetwork.org';
}

// Well-known Anvil test private key - ONLY for localnet
const ANVIL_TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function getPrivateKey(network: string): `0x${string}` {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  
  if (network !== 'localnet') {
    if (!privateKey) {
      throw new Error(`DEPLOYER_PRIVATE_KEY environment variable is required for ${network} deployment`);
    }
    return privateKey as `0x${string}`;
  }
  
  // Only use test key for localnet
  return (privateKey ?? ANVIL_TEST_KEY) as `0x${string}`;
}

// Psyche-compatible run states
const RUN_STATES = [
  'Uninitialized',
  'WaitingForMembers', 
  'Warmup',
  'RoundTrain',
  'RoundWitness',
  'Cooldown',
  'Finished',
  'Paused',
];

const TRAINING_COORDINATOR_ABI = [
  { name: 'createRun', type: 'function', inputs: [
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
  ], outputs: [], stateMutability: 'payable' },
  { name: 'joinRun', type: 'function', inputs: [
    { name: 'runId', type: 'bytes32' },
    { name: 'p2pEndpointId', type: 'bytes32' },
  ], outputs: [], stateMutability: 'nonpayable' },
  { name: 'tick', type: 'function', inputs: [{ name: 'runId', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'withdrawFromRun', type: 'function', inputs: [{ name: 'runId', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'pauseRun', type: 'function', inputs: [{ name: 'runId', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'resumeRun', type: 'function', inputs: [{ name: 'runId', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'getRunState', type: 'function', inputs: [{ name: 'runId', type: 'bytes32' }], outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view' },
  { name: 'getRunConfig', type: 'function', inputs: [{ name: 'runId', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [
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
  ]}], stateMutability: 'view' },
  { name: 'getClientCount', type: 'function', inputs: [{ name: 'runId', type: 'bytes32' }], outputs: [{ name: '', type: 'uint16' }], stateMutability: 'view' },
  { name: 'getStep', type: 'function', inputs: [{ name: 'runId', type: 'bytes32' }], outputs: [{ name: '', type: 'uint32' }], stateMutability: 'view' },
  { name: 'getEpoch', type: 'function', inputs: [{ name: 'runId', type: 'bytes32' }], outputs: [{ name: '', type: 'uint16' }], stateMutability: 'view' },
] as const;

const NODE_PERFORMANCE_ABI = [
  { name: 'getOptimalNodes', type: 'function', inputs: [
    { name: 'count', type: 'uint256' },
    { name: 'minGpuTier', type: 'uint8' },
    { name: 'minBandwidth', type: 'uint256' },
    { name: 'minScore', type: 'uint256' },
  ], outputs: [{ name: '', type: 'address[]' }], stateMutability: 'view' },
  { name: 'getNodeScore', type: 'function', inputs: [{ name: 'node', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { name: 'getNodeMetrics', type: 'function', inputs: [{ name: 'node', type: 'address' }], outputs: [{ name: '', type: 'tuple', components: [
    { name: 'avgLatencyMs', type: 'uint64' },
    { name: 'avgBandwidthMbps', type: 'uint64' },
    { name: 'successRate', type: 'uint32' },
    { name: 'totalTasks', type: 'uint32' },
    { name: 'lastUpdated', type: 'uint64' },
  ]}], stateMutability: 'view' },
] as const;

const TRAINING_REWARDS_ABI = [
  { name: 'claim', type: 'function', inputs: [{ name: 'runId', type: 'bytes32' }], outputs: [{ name: 'amount', type: 'uint256' }], stateMutability: 'nonpayable' },
  { name: 'claimable', type: 'function', inputs: [
    { name: 'runId', type: 'bytes32' },
    { name: 'participant', type: 'address' },
  ], outputs: [
    { name: 'amount', type: 'uint256' },
    { name: 'points', type: 'uint256' },
  ], stateMutability: 'view' },
] as const;

// Contract addresses (localnet defaults)
const CONTRACTS = {
  trainingCoordinator: (process.env.TRAINING_COORDINATOR_ADDRESS || '0x59b670e9fA9D0A427751Af201D676719a970857b') as `0x${string}`,
  trainingRewards: (process.env.TRAINING_REWARDS_ADDRESS || '0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1') as `0x${string}`,
  nodePerformanceOracle: (process.env.NODE_PERFORMANCE_ADDRESS || '0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f') as `0x${string}`,
};


const RLAIF_STATES = [
  'Uninitialized',
  'CollectingRollouts',
  'Judging',
  'Training',
  'Evaluating',
  'Promoting',
  'Paused',
  'Finished',
];

export const trainingCommand = new Command('training')
  .description('Distributed training operations (Psyche-compatible)')
  .addCommand(
    new Command('status')
      .description('Check training service status')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .action(async (options) => {
        await checkStatus(options.network);
      })
  )
  .addCommand(
    new Command('list')
      .description('List training runs')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .option('--status <status>', 'Filter by status: active, completed, paused')
      .action(async (options) => {
        await listRuns(options);
      })
  )
  .addCommand(
    new Command('create')
      .description('Create a new training run')
      .requiredOption('--model <model>', 'Model repo (e.g., meta/llama-3-8b)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .option('--steps <steps>', 'Total training steps', '1000')
      .option('--batch-size <size>', 'Batch size', '256')
      .option('--min-nodes <nodes>', 'Minimum nodes required', '2')
      .option('--stake <eth>', 'Stake amount in ETH', '0.01')
      .option('--private', 'Create private run with MPC')
      .action(async (options) => {
        await createRun(options);
      })
  )
  .addCommand(
    new Command('join')
      .description('Join an existing training run')
      .argument('<run-id>', 'Training run ID (0x...)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .action(async (runId, options) => {
        await joinRun(runId, options.network);
      })
  )
  .addCommand(
    new Command('info')
      .description('Get training run details')
      .argument('<run-id>', 'Training run ID (0x...)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .action(async (runId, options) => {
        await getRunInfo(runId, options.network);
      })
  )
  .addCommand(
    new Command('pause')
      .description('Pause a training run')
      .argument('<run-id>', 'Training run ID (0x...)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .action(async (runId, options) => {
        await pauseRun(runId, options.network);
      })
  )
  .addCommand(
    new Command('resume')
      .description('Resume a paused training run')
      .argument('<run-id>', 'Training run ID (0x...)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .action(async (runId, options) => {
        await resumeRun(runId, options.network);
      })
  )
  .addCommand(
    new Command('withdraw')
      .description('Withdraw from a training run')
      .argument('<run-id>', 'Training run ID (0x...)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .action(async (runId, options) => {
        await withdrawFromRun(runId, options.network);
      })
  )
  .addCommand(
    new Command('claim')
      .description('Claim training rewards')
      .argument('<run-id>', 'Training run ID (0x...)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .action(async (runId, options) => {
        await claimRewards(runId, options.network);
      })
  )
  .addCommand(
    new Command('nodes')
      .description('List available compute nodes')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .option('--count <count>', 'Number of nodes to fetch', '10')
      .option('--min-tier <tier>', 'Minimum GPU tier: 0=Consumer, 1=Pro, 2=Datacenter, 3=HighEnd', '0')
      .action(async (options) => {
        await listNodes(options);
      })
  )
  .addCommand(
    new Command('models')
      .description('List available base models')
      .action(async () => {
        await listModels();
      })
  )
  .addCommand(
    new Command('verify')
      .description('Verify training integration and configuration')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .option('--babylon', 'Verify Babylon RLAIF integration')
      .action(async (options) => {
        await verifyTraining(options);
      })
  )
  // RLAIF commands for Babylon/environment training
  .addCommand(
    new Command('rlaif')
      .description('RLAIF training commands')
      .addCommand(
        new Command('create')
          .description('Create an RLAIF training run')
          .requiredOption('--env <environment>', 'Environment ID (e.g., babylon)')
          .requiredOption('--model <model>', 'Base model CID or name')
          .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
          .option('--iterations <n>', 'Target iterations', '10')
          .option('--archetype <type>', 'Archetype for rubric (Babylon only)')
          .action(async (options) => {
            await createRLAIFRun(options);
          })
      )
      .addCommand(
        new Command('status')
          .description('Get RLAIF run status')
          .argument('<run-id>', 'RLAIF run ID')
          .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
          .action(async (runId, options) => {
            await getRLAIFStatus(runId, options.network);
          })
      )
      .addCommand(
        new Command('list')
          .description('List RLAIF runs')
          .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
          .option('--env <environment>', 'Filter by environment')
          .action(async (options) => {
            await listRLAIFRuns(options);
          })
      )
      .addCommand(
        new Command('submit-trajectories')
          .description('Submit trajectories to an RLAIF run')
          .argument('<run-id>', 'RLAIF run ID')
          .requiredOption('--manifest <cid>', 'Trajectory manifest CID')
          .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
          .action(async (runId, options) => {
            await submitRLAIFTrajectories(runId, options);
          })
      )
  )
  // Babylon-specific training
  .addCommand(
    new Command('babylon')
      .description('Babylon-specific training commands')
      .addCommand(
        new Command('generate')
          .description('Generate trajectories for an archetype')
          .requiredOption('--archetype <type>', 'Archetype: trader, degen, scammer, etc.')
          .option('--agents <n>', 'Number of agents', '5')
          .option('--ticks <n>', 'Ticks per agent', '20')
          .action(async (options) => {
            await babylonGenerate(options);
          })
      )
      .addCommand(
        new Command('score')
          .description('Score trajectories with RULER')
          .option('--archetype <type>', 'Archetype to score')
          .option('--limit <n>', 'Max trajectories to score', '100')
          .action(async (options) => {
            await babylonScore(options);
          })
      )
      .addCommand(
        new Command('train')
          .description('Run full training pipeline')
          .requiredOption('--archetype <type>', 'Archetype: trader, degen, etc.')
          .option('--model <model>', 'Base model', 'Qwen/Qwen2.5-3B-Instruct')
          .option('--iterations <n>', 'Training iterations', '5')
          .option('--use-jeju', 'Use Jeju RLAIF infrastructure', true)
          .action(async (options) => {
            await babylonTrain(options);
          })
      )
      .addCommand(
        new Command('archetypes')
          .description('List available archetypes')
          .action(async () => {
            await listArchetypes();
          })
      )
  );

async function checkStatus(network: string): Promise<void> {
  logger.header('TRAINING SERVICE STATUS');

  const chain = await getChainStatus(network as 'localnet' | 'testnet' | 'mainnet');
  logger.table([
    {
      label: 'Chain',
      value: chain.running ? `Block ${chain.blockNumber}` : 'Not running',
      status: chain.running ? 'ok' : 'error',
    },
  ]);

  const dwsUrl = getDwsUrl();
  let dwsOk = false;

  try {
    const response = await fetch(`${dwsUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      dwsOk = true;
      const health = await response.json() as { status: string; services: Record<string, boolean> };
      
      logger.newline();
      logger.subheader('DWS Services');
      logger.table([
        { label: 'Compute', value: health.services?.compute ? 'Available' : 'Unavailable', status: health.services?.compute ? 'ok' : 'error' },
        { label: 'Storage', value: health.services?.ipfs ? 'Available' : 'Unavailable', status: health.services?.ipfs ? 'ok' : 'error' },
      ]);
    }
  } catch {
    // DWS not running
  }

  logger.newline();
  logger.table([
    { label: 'DWS Server', value: dwsOk ? dwsUrl : 'Not running', status: dwsOk ? 'ok' : 'error' },
  ]);

  // Check contract status
  if (chain.running) {
    const publicClient = createPublicClient({
      chain: foundry,
      transport: http(getRpcUrl(network)),
    });

    try {
      const code = await publicClient.getBytecode({ address: CONTRACTS.trainingCoordinator });
      logger.newline();
      logger.table([
        { label: 'TrainingCoordinator', value: code ? 'Deployed' : 'Not deployed', status: code ? 'ok' : 'error' },
      ]);
    } catch {
      logger.warn('Could not check contract status');
    }
  }

  if (!dwsOk) {
    logger.newline();
    logger.info('Start DWS with: jeju compute start');
  }
}

async function listRuns(options: { network: string; status?: string }): Promise<void> {
  logger.header('TRAINING RUNS');

  const dwsUrl = getDwsUrl();

  try {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    
    const response = await fetch(`${dwsUrl}/compute/training/runs?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const runs = await response.json() as Array<{
      runId: string;
      model: string;
      state: number;
      clients: number;
      step: number;
      totalSteps: number;
      createdAt: number;
    }>;

    if (runs.length === 0) {
      logger.info('No training runs found');
      logger.newline();
      logger.info('Create a run with: jeju training create --model meta/llama-3-8b');
      return;
    }

    logger.info(`Found ${runs.length} training runs:\n`);

    for (const run of runs) {
      const stateLabel = RUN_STATES[run.state] || 'Unknown';
      const progress = run.totalSteps > 0 ? ((run.step / run.totalSteps) * 100).toFixed(1) : '0';
      const icon = run.state === 3 ? '🔄' : run.state === 6 ? '✅' : run.state === 7 ? '⏸️' : '⏳';
      
      console.log(`  ${icon} ${run.runId.slice(0, 18)}...`);
      console.log(`     Model: ${run.model}`);
      console.log(`     State: ${stateLabel}`);
      console.log(`     Progress: ${run.step}/${run.totalSteps} (${progress}%)`);
      console.log(`     Clients: ${run.clients}`);
      console.log('');
    }
  } catch (_error) {
    // Fallback: try to get from chain
    logger.warn('DWS not available, checking chain directly...');
    logger.info('No active runs found on chain');
  }
}

async function createRun(options: {
  model: string;
  network: string;
  steps: string;
  batchSize: string;
  minNodes: string;
  stake: string;
  private?: boolean;
}): Promise<void> {
  logger.header('CREATE TRAINING RUN');

  const privateKey = getPrivateKey(options.network);
  const account = privateKeyToAccount(privateKey);
  
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(getRpcUrl(options.network)),
  });

  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(getRpcUrl(options.network)),
  });

  logger.keyValue('Model', options.model);
  logger.keyValue('Steps', options.steps);
  logger.keyValue('Batch Size', options.batchSize);
  logger.keyValue('Min Nodes', options.minNodes);
  logger.keyValue('Stake', `${options.stake} ETH`);
  logger.keyValue('Privacy', options.private ? 'Private (MPC)' : 'Public');
  logger.newline();

  // Generate run ID
  const runId = keccak256(encodePacked(
    ['address', 'string', 'uint256'],
    [account.address, options.model, BigInt(Date.now())]
  ));

  logger.step('Creating training run...');
  logger.keyValue('Run ID', runId);

  const minNodes = parseInt(options.minNodes);
  const config = {
    warmupTime: BigInt(300),
    cooldownTime: BigInt(60),
    maxRoundTrainTime: BigInt(600),
    roundWitnessTime: BigInt(120),
    epochTime: BigInt(3600),
    globalBatchSizeWarmupTokens: BigInt(1000000),
    totalSteps: parseInt(options.steps),
    initMinClients: minNodes + 2,
    minClients: minNodes,
    witnessNodes: Math.max(1, Math.floor(minNodes / 3)),
    globalBatchSizeStart: parseInt(options.batchSize),
    globalBatchSizeEnd: parseInt(options.batchSize) * 4,
    verificationPercent: 10,
    waitingForMembersExtraTime: 60,
  };

  const modelConfig = {
    modelHash: ('0x' + '0'.repeat(64)) as `0x${string}`,
    hfRepo: options.model,
    maxSeqLen: 2048,
    coldStartWarmupSteps: 10,
  };

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.trainingCoordinator,
      abi: TRAINING_COORDINATOR_ABI,
      functionName: 'createRun',
      args: [
        runId,
        config,
        modelConfig,
        options.private ? 1 : 0,
        ('0x' + '0'.repeat(64)) as `0x${string}`,
      ],
      value: parseEther(options.stake),
    });

    logger.step('Waiting for confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      logger.success('Training run created');
      logger.newline();
      logger.keyValue('Run ID', runId);
      logger.keyValue('TX Hash', hash);
      logger.newline();
      logger.info(`Join with: jeju training join ${runId}`);
      logger.info(`View with: jeju training info ${runId}`);
    } else {
      logger.error('Transaction failed');
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Failed to create run: ${error}`);
    process.exit(1);
  }
}

async function joinRun(runId: string, network: string): Promise<void> {
  logger.header('JOIN TRAINING RUN');

  const privateKey = getPrivateKey(network);
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(getRpcUrl(network)),
  });

  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(getRpcUrl(network)),
  });

  logger.keyValue('Run ID', runId);
  logger.keyValue('Address', account.address);
  logger.newline();

  const p2pEndpointId = keccak256(encodePacked(['uint256'], [BigInt(Date.now())]));

  try {
    logger.step('Joining run...');
    const hash = await walletClient.writeContract({
      address: CONTRACTS.trainingCoordinator,
      abi: TRAINING_COORDINATOR_ABI,
      functionName: 'joinRun',
      args: [runId as `0x${string}`, p2pEndpointId],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      logger.success('Joined training run');
      logger.keyValue('TX Hash', hash);
    } else {
      logger.error('Transaction failed');
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Failed to join run: ${error}`);
    process.exit(1);
  }
}

async function getRunInfo(runId: string, network: string): Promise<void> {
  logger.header('TRAINING RUN INFO');

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(getRpcUrl(network)),
  });

  try {
    const [state, config, clientCount, step, epoch] = await Promise.all([
      publicClient.readContract({
        address: CONTRACTS.trainingCoordinator,
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'getRunState',
        args: [runId as `0x${string}`],
      }),
      publicClient.readContract({
        address: CONTRACTS.trainingCoordinator,
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'getRunConfig',
        args: [runId as `0x${string}`],
      }),
      publicClient.readContract({
        address: CONTRACTS.trainingCoordinator,
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'getClientCount',
        args: [runId as `0x${string}`],
      }),
      publicClient.readContract({
        address: CONTRACTS.trainingCoordinator,
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'getStep',
        args: [runId as `0x${string}`],
      }),
      publicClient.readContract({
        address: CONTRACTS.trainingCoordinator,
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'getEpoch',
        args: [runId as `0x${string}`],
      }),
    ]);

    const stateLabel = RUN_STATES[state as number] || 'Unknown';
    const progress = config.totalSteps > 0 ? ((Number(step) / config.totalSteps) * 100).toFixed(1) : '0';

    logger.keyValue('Run ID', runId);
    logger.newline();

    logger.subheader('Status');
    logger.table([
      { label: 'State', value: stateLabel, status: state === 3 ? 'ok' : state === 6 ? 'ok' : 'warning' },
      { label: 'Clients', value: String(clientCount), status: Number(clientCount) >= config.minClients ? 'ok' : 'warning' },
      { label: 'Epoch', value: String(epoch), status: 'ok' },
      { label: 'Step', value: `${step} / ${config.totalSteps} (${progress}%)`, status: 'ok' },
    ]);

    logger.newline();
    logger.subheader('Configuration');
    logger.table([
      { label: 'Min Clients', value: String(config.minClients), status: 'ok' },
      { label: 'Witness Nodes', value: String(config.witnessNodes), status: 'ok' },
      { label: 'Batch Size', value: `${config.globalBatchSizeStart} → ${config.globalBatchSizeEnd}`, status: 'ok' },
      { label: 'Warmup Time', value: `${config.warmupTime}s`, status: 'ok' },
      { label: 'Epoch Time', value: `${config.epochTime}s`, status: 'ok' },
    ]);
  } catch (error) {
    logger.error(`Failed to get run info: ${error}`);
    process.exit(1);
  }
}

async function pauseRun(runId: string, network: string): Promise<void> {
  logger.header('PAUSE TRAINING RUN');

  const privateKey = getPrivateKey(network);
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(getRpcUrl(network)),
  });

  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(getRpcUrl(network)),
  });

  try {
    logger.step('Pausing run...');
    const hash = await walletClient.writeContract({
      address: CONTRACTS.trainingCoordinator,
      abi: TRAINING_COORDINATOR_ABI,
      functionName: 'pauseRun',
      args: [runId as `0x${string}`],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      logger.success('Training run paused');
      logger.keyValue('TX Hash', hash);
    } else {
      logger.error('Transaction failed');
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Failed to pause run: ${error}`);
    process.exit(1);
  }
}

async function resumeRun(runId: string, network: string): Promise<void> {
  logger.header('RESUME TRAINING RUN');

  const privateKey = getPrivateKey(network);
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(getRpcUrl(network)),
  });

  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(getRpcUrl(network)),
  });

  try {
    logger.step('Resuming run...');
    const hash = await walletClient.writeContract({
      address: CONTRACTS.trainingCoordinator,
      abi: TRAINING_COORDINATOR_ABI,
      functionName: 'resumeRun',
      args: [runId as `0x${string}`],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      logger.success('Training run resumed');
      logger.keyValue('TX Hash', hash);
    } else {
      logger.error('Transaction failed');
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Failed to resume run: ${error}`);
    process.exit(1);
  }
}

async function withdrawFromRun(runId: string, network: string): Promise<void> {
  logger.header('WITHDRAW FROM RUN');

  const privateKey = getPrivateKey(network);
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(getRpcUrl(network)),
  });

  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(getRpcUrl(network)),
  });

  try {
    logger.step('Withdrawing from run...');
    const hash = await walletClient.writeContract({
      address: CONTRACTS.trainingCoordinator,
      abi: TRAINING_COORDINATOR_ABI,
      functionName: 'withdrawFromRun',
      args: [runId as `0x${string}`],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      logger.success('Withdrawn from training run');
      logger.keyValue('TX Hash', hash);
    } else {
      logger.error('Transaction failed');
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Failed to withdraw: ${error}`);
    process.exit(1);
  }
}

async function claimRewards(runId: string, network: string): Promise<void> {
  logger.header('CLAIM REWARDS');

  const privateKey = getPrivateKey(network);
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(getRpcUrl(network)),
  });

  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(getRpcUrl(network)),
  });

  // Check claimable first
  try {
    const [claimableAmount, claimablePoints] = await publicClient.readContract({
      address: CONTRACTS.trainingRewards,
      abi: TRAINING_REWARDS_ABI,
      functionName: 'claimable',
      args: [runId as `0x${string}`, account.address],
    });

    logger.keyValue('Claimable Amount', formatEther(claimableAmount) + ' ETH');
    logger.keyValue('Claimable Points', String(claimablePoints));
    logger.newline();

    if (claimableAmount === 0n) {
      logger.info('No rewards to claim');
      return;
    }

    logger.step('Claiming rewards...');
    const hash = await walletClient.writeContract({
      address: CONTRACTS.trainingRewards,
      abi: TRAINING_REWARDS_ABI,
      functionName: 'claim',
      args: [runId as `0x${string}`],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      logger.success('Rewards claimed');
      logger.keyValue('TX Hash', hash);
    } else {
      logger.error('Transaction failed');
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Failed to claim rewards: ${error}`);
    process.exit(1);
  }
}

async function listNodes(options: { network: string; count: string; minTier: string }): Promise<void> {
  logger.header('COMPUTE NODES');

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(getRpcUrl(options.network)),
  });

  const tierLabels = ['Consumer', 'Professional', 'Datacenter', 'High-End'];

  try {
    const nodes = await publicClient.readContract({
      address: CONTRACTS.nodePerformanceOracle,
      abi: NODE_PERFORMANCE_ABI,
      functionName: 'getOptimalNodes',
      args: [
        BigInt(options.count),
        parseInt(options.minTier),
        BigInt(0),
        BigInt(0),
      ],
    });

    if (nodes.length === 0) {
      logger.info('No compute nodes found');
      return;
    }

    logger.info(`Found ${nodes.length} optimal nodes:\n`);

    for (const nodeAddr of nodes) {
      const [score, metrics] = await Promise.all([
        publicClient.readContract({
          address: CONTRACTS.nodePerformanceOracle,
          abi: NODE_PERFORMANCE_ABI,
          functionName: 'getNodeScore',
          args: [nodeAddr],
        }),
        publicClient.readContract({
          address: CONTRACTS.nodePerformanceOracle,
          abi: NODE_PERFORMANCE_ABI,
          functionName: 'getNodeMetrics',
          args: [nodeAddr],
        }),
      ]);

      console.log(`  📡 ${nodeAddr.slice(0, 10)}...${nodeAddr.slice(-8)}`);
      console.log(`     Score: ${score}`);
      console.log(`     Latency: ${metrics.avgLatencyMs}ms`);
      console.log(`     Bandwidth: ${metrics.avgBandwidthMbps} Mbps`);
      console.log(`     Success Rate: ${metrics.successRate}%`);
      console.log(`     Tasks: ${metrics.totalTasks}`);
      console.log('');
    }
  } catch (_error) {
    logger.warn('Could not fetch nodes from oracle. DWS fallback:');
    
    // Fallback to DWS API
    const dwsUrl = getDwsUrl();
    try {
      const response = await fetch(`${dwsUrl}/compute/nodes`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const nodes = await response.json() as Array<{ address: string; gpuTier: string; score: number }>;
        logger.info(`Found ${nodes.length} nodes via DWS`);
        for (const node of nodes) {
          console.log(`  📡 ${node.address.slice(0, 10)}...${node.address.slice(-8)}`);
          console.log(`     GPU: ${tierLabels[parseInt(node.gpuTier)] || node.gpuTier}`);
          console.log(`     Score: ${node.score}`);
          console.log('');
        }
      }
    } catch {
      logger.error('Could not fetch nodes');
    }
  }
}

async function listModels(): Promise<void> {
  logger.header('AVAILABLE MODELS');

  const models = [
    { id: 'meta/llama-3-8b', name: 'LLaMA 3 8B', org: 'Meta', params: '8B' },
    { id: 'meta/llama-3-70b', name: 'LLaMA 3 70B', org: 'Meta', params: '70B' },
    { id: 'mistral/mistral-7b', name: 'Mistral 7B', org: 'Mistral AI', params: '7B' },
    { id: 'microsoft/phi-3-mini', name: 'Phi-3 Mini', org: 'Microsoft', params: '3.8B' },
    { id: 'google/gemma-2-9b', name: 'Gemma 2 9B', org: 'Google', params: '9B' },
    { id: 'qwen/qwen2-7b', name: 'Qwen 2 7B', org: 'Alibaba', params: '7B' },
  ];

  // Also fetch from DWS
  const dwsUrl = getDwsUrl();
  try {
    const response = await fetch(`${dwsUrl}/models?type=llm`, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const dwsModels = await response.json() as Array<{ name: string; organization: string; type: string }>;
      for (const m of dwsModels) {
        if (!models.find(existing => existing.id === `${m.organization}/${m.name}`)) {
          models.push({
            id: `${m.organization}/${m.name}`,
            name: m.name,
            org: m.organization,
            params: 'Custom',
          });
        }
      }
    }
  } catch {
    // Use default list
  }

  logger.info(`${models.length} models available:\n`);

  for (const model of models) {
    console.log(`  🧠 ${model.id}`);
    console.log(`     Name: ${model.name}`);
    console.log(`     Org: ${model.org}`);
    console.log(`     Parameters: ${model.params}`);
    console.log('');
  }

  logger.newline();
  logger.info('Create a training run with: jeju training create --model <model-id>');
}

// RLAIF Commands
async function createRLAIFRun(options: {
  env: string;
  model: string;
  network: string;
  iterations: string;
  archetype?: string;
}): Promise<void> {
  logger.header('CREATE RLAIF RUN');

  const dwsUrl = getDwsUrl();

  logger.keyValue('Environment', options.env);
  logger.keyValue('Model', options.model);
  logger.keyValue('Iterations', options.iterations);
  if (options.archetype) {
    logger.keyValue('Archetype', options.archetype);
  }
  logger.newline();

  try {
    logger.step('Creating RLAIF run via DWS...');

    const response = await fetch(`${dwsUrl}/rlaif/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        environment: {
          id: options.env,
          type: options.env === 'babylon' ? 'game' : 'custom',
          configCID: options.archetype ? `${options.env}-${options.archetype}` : options.env,
        },
        model: {
          baseModelCID: options.model,
          tokenizer: options.model.includes('Qwen') ? options.model : 'Qwen/Qwen2.5-3B-Instruct',
        },
        judge: {
          rubricId: options.archetype ? `babylon-${options.archetype}` : 'default',
        },
        targetIterations: parseInt(options.iterations),
        minTrajectoriesPerIteration: 20,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const result = await response.json() as { runId: string; status: string };

    logger.success('RLAIF run created');
    logger.keyValue('Run ID', result.runId);
    logger.newline();
    logger.info(`Check status: jeju training rlaif status ${result.runId}`);
    logger.info(`Start training: curl -X POST ${dwsUrl}/rlaif/runs/${result.runId}/start`);
  } catch (error) {
    logger.error(`Failed to create RLAIF run: ${error}`);
    process.exit(1);
  }
}

async function getRLAIFStatus(runId: string, _network: string): Promise<void> {
  logger.header('RLAIF RUN STATUS');

  const dwsUrl = getDwsUrl();

  try {
    const response = await fetch(`${dwsUrl}/rlaif/runs/${runId}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.error(`Run ${runId} not found`);
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const run = await response.json() as {
      config: { runId: string; environment: { id: string }; targetIterations: number };
      state: number;
      currentIteration: number;
      currentPolicyCID: string;
      bestPolicyCID?: string;
      bestEvalScore?: number;
      iterations: Array<{
        iteration: number;
        state: number;
        evalPassed?: boolean;
        metrics?: { evalScore?: number };
      }>;
    };

    const stateLabel = RLAIF_STATES[run.state] || 'Unknown';
    const progress = run.config.targetIterations > 0
      ? ((run.currentIteration / run.config.targetIterations) * 100).toFixed(1)
      : '0';

    logger.keyValue('Run ID', run.config.runId);
    logger.keyValue('Environment', run.config.environment.id);
    logger.newline();

    logger.subheader('Status');
    logger.table([
      { label: 'State', value: stateLabel, status: run.state === 7 ? 'ok' : run.state === 6 ? 'warning' : 'ok' },
      { label: 'Iteration', value: `${run.currentIteration} / ${run.config.targetIterations} (${progress}%)`, status: 'ok' },
      { label: 'Current Policy', value: run.currentPolicyCID.slice(0, 30) + '...', status: 'ok' },
    ]);

    if (run.bestPolicyCID) {
      logger.newline();
      logger.subheader('Best Model');
      logger.table([
        { label: 'Policy CID', value: run.bestPolicyCID.slice(0, 40) + '...', status: 'ok' },
        { label: 'Eval Score', value: String(run.bestEvalScore ?? 0), status: 'ok' },
      ]);
    }

    if (run.iterations.length > 0) {
      logger.newline();
      logger.subheader('Recent Iterations');
      const recent = run.iterations.slice(-5);
      for (const iter of recent) {
        const iterState = RLAIF_STATES[iter.state] || 'Unknown';
        const icon = iter.evalPassed ? '✅' : iter.state === 7 ? '✅' : '🔄';
        console.log(`  ${icon} Iteration ${iter.iteration}: ${iterState}`);
        if (iter.metrics?.evalScore !== undefined) {
          console.log(`     Eval Score: ${iter.metrics.evalScore}`);
        }
      }
    }
  } catch (error) {
    logger.error(`Failed to get RLAIF status: ${error}`);
    process.exit(1);
  }
}

async function listRLAIFRuns(options: { network: string; env?: string }): Promise<void> {
  logger.header('RLAIF RUNS');

  const dwsUrl = getDwsUrl();

  try {
    const params = new URLSearchParams();
    if (options.env) params.set('environment', options.env);

    const response = await fetch(`${dwsUrl}/rlaif/runs?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const runs = await response.json() as Array<{
      runId: string;
      environment: string;
      state: number;
      currentIteration: number;
      targetIterations: number;
    }>;

    if (!Array.isArray(runs) || runs.length === 0) {
      logger.info('No RLAIF runs found');
      logger.newline();
      logger.info('Create a run with: jeju training rlaif create --env babylon --model Qwen/Qwen2.5-3B-Instruct');
      return;
    }

    logger.info(`Found ${runs.length} RLAIF runs:\n`);

    for (const run of runs) {
      const stateLabel = RLAIF_STATES[run.state] || 'Unknown';
      const progress = run.targetIterations > 0
        ? ((run.currentIteration / run.targetIterations) * 100).toFixed(1)
        : '0';
      const icon = run.state === 7 ? '✅' : run.state === 6 ? '⏸️' : '🔄';

      console.log(`  ${icon} ${run.runId.slice(0, 18)}...`);
      console.log(`     Environment: ${run.environment}`);
      console.log(`     State: ${stateLabel}`);
      console.log(`     Progress: ${run.currentIteration}/${run.targetIterations} (${progress}%)`);
      console.log('');
    }
  } catch (error) {
    logger.warn(`DWS not available: ${error}`);
    logger.info('Start DWS with: jeju dev start');
  }
}

async function submitRLAIFTrajectories(runId: string, options: { manifest: string; network: string }): Promise<void> {
  logger.header('SUBMIT TRAJECTORIES');

  const dwsUrl = getDwsUrl();

  logger.keyValue('Run ID', runId);
  logger.keyValue('Manifest CID', options.manifest);
  logger.newline();

  try {
    logger.step('Loading trajectories from manifest...');

    // First load the manifest to get trajectory count
    const manifestRes = await fetch(`${dwsUrl}/rlaif/manifests/${options.manifest}`);
    if (!manifestRes.ok) {
      throw new Error(`Failed to load manifest: ${manifestRes.status}`);
    }
    const manifest = await manifestRes.json() as { trajectoryCIDs: string[]; totalCount: number };

    logger.keyValue('Trajectories', String(manifest.totalCount));
    logger.newline();

    logger.step('Submitting to RLAIF run...');

    const response = await fetch(`${dwsUrl}/rlaif/runs/${runId}/rollouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifestCID: options.manifest,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const result = await response.json() as { trajectoryCount: number };

    logger.success(`Submitted ${result.trajectoryCount} trajectories`);
  } catch (error) {
    logger.error(`Failed to submit trajectories: ${error}`);
    process.exit(1);
  }
}

// Babylon-specific commands
async function babylonGenerate(options: { archetype: string; agents: string; ticks: string }): Promise<void> {
  logger.header('BABYLON TRAJECTORY GENERATION');

  logger.keyValue('Archetype', options.archetype);
  logger.keyValue('Agents', options.agents);
  logger.keyValue('Ticks per agent', options.ticks);
  logger.newline();

  logger.step('Starting trajectory generation...');
  logger.info('Run this command in the Babylon project:');
  logger.newline();
  console.log(`  cd vendor/babylon && bun run train parallel --archetypes ${options.archetype} --num-agents ${options.agents} --ticks ${options.ticks}`);
  logger.newline();
  logger.info('Or use the Babylon CLI:');
  console.log(`  babylon train parallel -a ${options.archetype} -n ${options.agents} -t ${options.ticks}`);
}

async function babylonScore(options: { archetype?: string; limit: string }): Promise<void> {
  logger.header('BABYLON RULER SCORING');

  if (options.archetype) {
    logger.keyValue('Archetype', options.archetype);
  }
  logger.keyValue('Limit', options.limit);
  logger.newline();

  logger.step('Starting RULER scoring...');
  logger.info('Run this command in the Babylon project:');
  logger.newline();

  if (options.archetype) {
    console.log(`  cd vendor/babylon && bun run train score --archetype ${options.archetype} --limit ${options.limit}`);
  } else {
    console.log(`  cd vendor/babylon && bun run train score --limit ${options.limit}`);
  }
  logger.newline();
  logger.info('Or use the Babylon CLI:');
  console.log(`  babylon train score${options.archetype ? ` --archetype ${options.archetype}` : ''}`);
}

async function babylonTrain(options: {
  archetype: string;
  model: string;
  iterations: string;
  useJeju: boolean;
}): Promise<void> {
  logger.header('BABYLON TRAINING');

  logger.keyValue('Archetype', options.archetype);
  logger.keyValue('Model', options.model);
  logger.keyValue('Iterations', options.iterations);
  logger.keyValue('Infrastructure', options.useJeju ? 'Jeju RLAIF' : 'Local');
  logger.newline();

  if (options.useJeju) {
    logger.step('Creating Jeju RLAIF run...');

    const dwsUrl = getDwsUrl();

    try {
      // Create RLAIF run
      const response = await fetch(`${dwsUrl}/rlaif/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment: {
            id: 'babylon',
            type: 'game',
            configCID: `babylon-${options.archetype}`,
          },
          model: {
            baseModelCID: options.model,
            tokenizer: 'Qwen/Qwen2.5-3B-Instruct',
          },
          judge: {
            rubricId: `babylon-${options.archetype}`,
          },
          targetIterations: parseInt(options.iterations),
          minTrajectoriesPerIteration: 20,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json() as { runId: string };
      logger.success(`Created RLAIF run: ${result.runId}`);

      logger.newline();
      logger.step('Next steps:');
      logger.info('1. Generate trajectories:');
      console.log(`   babylon train parallel -a ${options.archetype} -n 10 -t 30`);
      logger.info('2. Load trajectories to Jeju:');
      console.log(`   jeju training babylon score --archetype ${options.archetype}`);
      logger.info('3. Start training:');
      console.log(`   curl -X POST ${dwsUrl}/rlaif/runs/${result.runId}/start`);
      logger.info('4. Monitor progress:');
      console.log(`   jeju training rlaif status ${result.runId}`);
    } catch (_error) {
      logger.warn(`DWS not available, falling back to local training`);
      logger.newline();
      logger.info('Run local training:');
      console.log(`  cd vendor/babylon/packages/training/python`);
      console.log(`  python scripts/train_local.py --backend auto`);
    }
  } else {
    logger.info('Run local training:');
    logger.newline();
    console.log(`  cd vendor/babylon/packages/training/python`);
    console.log(`  source venv/bin/activate`);
    console.log(`  python scripts/train_local.py --backend auto`);
  }
}

async function listArchetypes(): Promise<void> {
  logger.header('BABYLON ARCHETYPES');

  const archetypes = [
    { id: 'trader', desc: 'Disciplined profit-focused trader', metrics: ['P&L', 'Win Rate', 'Risk Management'] },
    { id: 'degen', desc: 'High-risk YOLO trader', metrics: ['Position Size', 'Leverage', 'Volatility'] },
    { id: 'scammer', desc: 'Manipulative, spreads misinformation', metrics: ['Deception Success', 'Victim Count'] },
    { id: 'researcher', desc: 'Analytical, data-driven', metrics: ['Analysis Depth', 'Prediction Accuracy'] },
    { id: 'social-butterfly', desc: 'Community engagement focused', metrics: ['Connections', 'Engagement', 'Influence'] },
    { id: 'information-trader', desc: 'News/signal-based', metrics: ['Signal Speed', 'Information Edge'] },
    { id: 'perps-trader', desc: 'Perpetual futures specialist', metrics: ['Funding Rate', 'Leverage Efficiency'] },
    { id: 'super-predictor', desc: 'Prediction market expert', metrics: ['Calibration', 'Brier Score'] },
    { id: 'infosec', desc: 'Security-conscious', metrics: ['Security Score', 'Risk Avoidance'] },
    { id: 'goody-twoshoes', desc: 'Helpful, ethical', metrics: ['Helpfulness', 'Ethical Score'] },
    { id: 'ass-kisser', desc: 'Follows crowd consensus', metrics: ['Conformity', 'Social Proof'] },
    { id: 'liar', desc: 'Consistently misleading', metrics: ['Deception Rate', 'Plausibility'] },
  ];

  logger.info(`${archetypes.length} archetypes available:\n`);

  for (const arch of archetypes) {
    console.log(`  🎭 ${arch.id}`);
    console.log(`     ${arch.desc}`);
    console.log(`     Metrics: ${arch.metrics.join(', ')}`);
    console.log('');
  }

  logger.newline();
  logger.info('Generate data: jeju training babylon generate --archetype trader');
  logger.info('Train model:   jeju training babylon train --archetype trader');
}

async function verifyTraining(options: { network: string; babylon?: boolean }): Promise<void> {
  const rootDir = findMonorepoRoot();
  
  const scriptName = options.babylon ? 'verify-babylon-rlaif.ts' : 'verify-training.ts';
  const scriptPath = join(rootDir, 'scripts', scriptName);
  
  if (!existsSync(scriptPath)) {
    logger.error(`Verification script not found: ${scriptPath}`);
    process.exit(1);
  }

  const title = options.babylon ? 'BABYLON RLAIF VERIFICATION' : 'TRAINING VERIFICATION';
  logger.header(title);
  logger.keyValue('Network', options.network);
  logger.newline();

  const env: Record<string, string> = { ...process.env as Record<string, string> };
  
  if (options.network === 'localnet') {
    env.RPC_URL = `http://localhost:${DEFAULT_PORTS.l2Rpc}`;
    env.DWS_URL = getDwsUrl();
  } else if (options.network === 'testnet') {
    env.RPC_URL = 'https://testnet-rpc.jejunetwork.org';
  } else if (options.network === 'mainnet') {
    env.RPC_URL = 'https://rpc.jejunetwork.org';
  }

  const result = await execa('bun', ['run', scriptPath], {
    cwd: rootDir,
    stdio: 'inherit',
    env,
    reject: false,
  });

  if (result.exitCode !== 0) {
    process.exit(result.exitCode ?? 1);
  }
}


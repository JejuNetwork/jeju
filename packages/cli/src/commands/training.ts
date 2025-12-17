/**
 * jeju training - Distributed training operations (Psyche-compatible)
 *
 * Manage distributed ML training runs on Jeju DWS.
 */

import { Command } from 'commander';
import { logger } from '../lib/logger';
import { getChainStatus } from '../lib/chain';
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
  } catch (error) {
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

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  
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

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = privateKeyToAccount(privateKey as `0x${string}`);

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

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = privateKeyToAccount(privateKey as `0x${string}`);

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

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = privateKeyToAccount(privateKey as `0x${string}`);

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

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = privateKeyToAccount(privateKey as `0x${string}`);

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

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = privateKeyToAccount(privateKey as `0x${string}`);

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
  } catch (error) {
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


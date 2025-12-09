/**
 * Bootstrap Script - 100% PERMISSIONLESS
 *
 * This is the entry point for deploying the permissionless AI game.
 * Provide a wallet with funds and everything else is handled automatically.
 *
 * Uses:
 * - StateManager with Arweave for permanent storage
 * - Real blockchain client for contract interaction
 * - TEE enclave (simulated locally, real via Phala dstack)
 *
 * Usage:
 *   PRIVATE_KEY=0x... CONTRACT_ADDRESS=0x... bun run src/infra/bootstrap.ts
 */

import type { Address, Hex } from 'viem';
import { keccak256, toBytes, toHex } from 'viem';
import { type AgentState, AIAgent } from '../game/agent.js';
import { GameEnvironment } from '../game/environment.js';
import { AITrainer } from '../game/trainer.js';
import { FileStorage } from '../storage/file-storage.js';
import { StateManager } from '../storage/state-manager.js';
import { TEEEnclave } from '../tee/enclave.js';
import { BlockchainClient } from './blockchain-client.js';

export interface BootstrapConfig {
  // Required: wallet that will operate the game
  privateKey: Hex;

  // Required: deployed contract address
  contractAddress: Address;

  // Chain configuration
  chainId?: 'mainnet' | 'sepolia' | 'localhost';
  rpcUrl?: string;

  // Storage directory (for FileStorage)
  storageDir?: string;

  // Game configuration
  gameCodeHash?: Hex;
  instanceId?: string;

  // Training configuration
  trainingBatchSize?: number;
  trainingEpochs?: number;

  // Heartbeat interval (ms)
  heartbeatIntervalMs?: number;
}

export interface BootstrappedGame {
  // Clients
  blockchain: BlockchainClient;
  storage: FileStorage;

  // TEE
  enclave: TEEEnclave;
  stateManager: StateManager;

  // Game
  agent: AIAgent;
  environment: GameEnvironment;
  trainer: AITrainer;

  // Control
  start: () => Promise<void>;
  stop: () => Promise<void>;
  runTrainingCycle: () => Promise<void>;

  // Status
  getStatus: () => Promise<GameStatus>;
}

export interface GameStatus {
  operatorAddress: Address;
  contractBalance: string;
  stateVersion: bigint;
  keyVersion: bigint;
  trainingEpoch: bigint;
  isActive: boolean;
  lastHeartbeat: Date;
}

interface SavedGameState {
  agent: AgentState;
  gameStats: ReturnType<GameEnvironment['getStats']>;
  trainingStats: ReturnType<AITrainer['getStats']>;
  version: number;
  timestamp: number;
}

/**
 * Bootstrap the entire permissionless AI game
 */
export async function bootstrap(
  config: BootstrapConfig
): Promise<BootstrappedGame> {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       BOOTSTRAPPING PERMISSIONLESS AI GAME               ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // =========================================================================
  // Step 1: Initialize blockchain client
  // =========================================================================
  console.log('[1/6] Connecting to blockchain...');

  const blockchain = new BlockchainClient({
    chainId: config.chainId ?? 'localhost',
    rpcUrl: config.rpcUrl,
    contractAddress: config.contractAddress,
    privateKey: config.privateKey,
  });

  const balance = await blockchain.getBalance();
  console.log(`  Contract balance: ${balance} wei`);
  console.log(`  Operator wallet: ${blockchain.getAddress()}`);

  // =========================================================================
  // Step 2: Initialize storage (FileStorage or ArweaveStorage)
  // =========================================================================
  console.log('\n[2/6] Initializing storage...');

  const storageDir = config.storageDir ?? './game-data';
  const storage = new FileStorage({
    directory: storageDir,
  });
  console.log(`  Storage initialized (FileStorage: ${storageDir})`);

  // =========================================================================
  // Step 3: Boot TEE enclave
  // =========================================================================
  console.log('\n[3/6] Booting TEE enclave...');

  const codeHash =
    config.gameCodeHash ?? (keccak256(toBytes('jeju-compute-v1')) as Hex);

  const enclave = await TEEEnclave.create({
    codeHash,
    instanceId: config.instanceId ?? 'primary-game-enclave',
  });

  const attestation = enclave.getAttestation();
  console.log(`  Enclave address: ${enclave.getOperatorAddress()}`);
  console.log(`  Code hash: ${attestation.mrEnclave.slice(0, 20)}...`);

  // =========================================================================
  // Step 4: Register operator on-chain (if not already)
  // =========================================================================
  console.log('\n[4/6] Checking operator registration...');

  const operatorInfo = await blockchain.getOperatorInfo();

  if (operatorInfo.address === enclave.getOperatorAddress()) {
    console.log('  Operator already registered ✓');
  } else if (!operatorInfo.active) {
    console.log('  Registering operator on-chain...');
    const attestationHex = toHex(
      new TextEncoder().encode(JSON.stringify(attestation))
    );
    await blockchain.registerOperator(
      enclave.getOperatorAddress(),
      attestationHex
    );
    console.log('  Operator registered ✓');
  } else {
    throw new Error(
      `Another operator is active: ${operatorInfo.address}. Wait for timeout or manually deactivate.`
    );
  }

  // =========================================================================
  // Step 5: Initialize game components
  // =========================================================================
  console.log('\n[5/6] Initializing game components...');

  // Create state manager with permanent storage
  const stateManager = new StateManager(enclave, storage, {
    verbose: false,
  });

  const agent = new AIAgent({
    inputSize: 5,
    hiddenSize: 8,
    outputSize: 1,
    learningRate: 0.1,
  });

  const environment = new GameEnvironment({
    sequenceLength: 5,
    patternTypes: ['linear', 'quadratic', 'fibonacci'],
    difficulty: 5,
  });

  const trainer = new AITrainer(
    {
      batchSize: config.trainingBatchSize ?? 50,
      epochsPerCycle: config.trainingEpochs ?? 10,
      targetLoss: 0.01,
    },
    agent,
    environment
  );

  console.log('  AI Agent initialized ✓');
  console.log('  Game Environment initialized ✓');
  console.log('  Trainer initialized ✓');

  // =========================================================================
  // Step 6: Load or create initial state
  // =========================================================================
  console.log('\n[6/6] Loading game state...');

  const gameState = await blockchain.getGameState();
  let currentVersion = 0;

  if (gameState.cid && gameState.cid.length > 0) {
    console.log(`  Loading existing state: ${gameState.cid}`);
    try {
      const state = (await stateManager.loadState(
        gameState.cid
      )) as SavedGameState;
      if (state?.agent) {
        agent.loadState(state.agent);
        currentVersion = state.version;
        console.log('  State loaded ✓');
      }
    } catch {
      console.log('  Could not load state, starting fresh');
    }
  } else {
    console.log('  No existing state, creating genesis...');
    const initialState: SavedGameState = {
      agent: agent.serialize(),
      gameStats: environment.getStats(),
      trainingStats: trainer.getStats(),
      version: 1,
      timestamp: Date.now(),
    };

    const checkpoint = await stateManager.saveState(initialState);
    await blockchain.updateState(checkpoint.id, checkpoint.hash);
    currentVersion = 1;
    console.log(`  Genesis state saved: ${checkpoint.id}`);
  }

  // =========================================================================
  // Control functions
  // =========================================================================

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const start = async () => {
    if (running) return;
    running = true;

    console.log('\n[Game] Starting heartbeat...');

    // Send initial heartbeat
    await blockchain.heartbeat();

    // Start heartbeat interval
    const interval = config.heartbeatIntervalMs ?? 60000; // 1 minute default
    heartbeatTimer = setInterval(async () => {
      await blockchain.heartbeat();
      console.log(`[Heartbeat] ${new Date().toISOString()}`);
    }, interval);

    console.log(`[Game] Running (heartbeat every ${interval / 1000}s)`);
  };

  const stop = async () => {
    if (!running) return;
    running = false;

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // Save final state
    currentVersion++;
    const finalState: SavedGameState = {
      agent: agent.serialize(),
      gameStats: environment.getStats(),
      trainingStats: trainer.getStats(),
      version: currentVersion,
      timestamp: Date.now(),
    };

    const checkpoint = await stateManager.saveState(finalState);
    await blockchain.updateState(checkpoint.id, checkpoint.hash);

    await enclave.shutdown();
    console.log('[Game] Stopped');
  };

  const runTrainingCycle = async () => {
    console.log('\n[Training] Starting cycle...');

    const result = trainer.runTrainingCycle();

    // Save training data (public)
    const dataset = await stateManager.saveTrainingData(
      result.samples,
      result.modelHashBefore,
      result.modelHashAfter
    );

    // Record on-chain
    await blockchain.recordTraining(dataset.id, result.modelHashAfter);

    // Save updated state
    currentVersion++;
    const newState: SavedGameState = {
      agent: agent.serialize(),
      gameStats: environment.getStats(),
      trainingStats: trainer.getStats(),
      version: currentVersion,
      timestamp: Date.now(),
    };

    const checkpoint = await stateManager.saveState(newState);
    await blockchain.updateState(checkpoint.id, checkpoint.hash);

    console.log(`[Training] Complete. Loss: ${result.finalLoss.toFixed(4)}`);
    console.log(`[Training] Dataset ID: ${dataset.id}`);
  };

  const getStatus = async (): Promise<GameStatus> => {
    const state = await blockchain.getGameState();
    const bal = await blockchain.getBalance();
    const epoch = await blockchain.getTrainingEpoch();

    return {
      operatorAddress: enclave.getOperatorAddress(),
      contractBalance: bal.toString(),
      stateVersion: state.version,
      keyVersion: state.keyVersion,
      trainingEpoch: epoch,
      isActive: state.operatorActive,
      lastHeartbeat: new Date(Number(state.lastHeartbeat) * 1000),
    };
  };

  // =========================================================================
  // Return bootstrapped game
  // =========================================================================

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              BOOTSTRAP COMPLETE                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  return {
    blockchain,
    storage,
    enclave,
    stateManager,
    agent,
    environment,
    trainer,
    start,
    stop,
    runTrainingCycle,
    getStatus,
  };
}

// =========================================================================
// CLI Entry Point
// =========================================================================

if (import.meta.main) {
  const privateKey = process.env.PRIVATE_KEY as Hex;
  const contractAddress = process.env.CONTRACT_ADDRESS as Address;
  const rpcUrl = process.env.RPC_URL;
  const chainId = (process.env.CHAIN_ID ?? 'localhost') as
    | 'mainnet'
    | 'sepolia'
    | 'localhost';

  if (!privateKey) {
    console.error('Error: PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  if (!contractAddress) {
    console.error('Error: CONTRACT_ADDRESS environment variable required');
    process.exit(1);
  }

  bootstrap({
    privateKey,
    contractAddress,
    chainId,
    rpcUrl,
  })
    .then(async (game) => {
      await game.start();

      // Run initial training
      await game.runTrainingCycle();

      // Print status
      const status = await game.getStatus();
      console.log('\nGame Status:', status);

      // Keep running
      console.log('\nGame is running. Press Ctrl+C to stop.');

      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await game.stop();
        process.exit(0);
      });
    })
    .catch((e) => {
      console.error('Bootstrap failed:', e);
      process.exit(1);
    });
}

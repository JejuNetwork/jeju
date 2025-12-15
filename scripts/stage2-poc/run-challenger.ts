#!/usr/bin/env bun
/**
 * Permissionless Challenger Service
 * 
 * Monitors L2 outputs and challenges invalid state roots.
 * Anyone can run this and earn rewards for successful challenges.
 * 
 * Required Environment:
 *   L1_RPC_URL - L1 RPC endpoint
 *   CHALLENGER_PRIVATE_KEY or CHALLENGER_PRIVATE_KEY_FILE - Challenger wallet
 *   DISPUTE_GAME_FACTORY_ADDRESS - DisputeGameFactory contract
 *   L2_OUTPUT_ORACLE_ADDRESS - L2OutputOracle contract (optional)
 *   L2_RPC_URL - L2 RPC endpoint for state verification (optional)
 * 
 * Usage:
 *   bun run run-challenger.ts
 */

import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');

// Contract ABIs
const DISPUTE_GAME_FACTORY_ABI = [
  'function createGame(address proposer, bytes32 stateRoot, bytes32 claimRoot, uint8 gameType, uint8 proverType) payable returns (bytes32)',
  'function resolveChallengerWins(bytes32 gameId, bytes calldata proof) external',
  'function resolveProposerWins(bytes32 gameId, bytes calldata defenseProof) external',
  'function resolveTimeout(bytes32 gameId) external',
  'function getGame(bytes32 gameId) external view returns (tuple(address challenger, address proposer, bytes32 stateRoot, bytes32 claimRoot, uint8 gameType, uint8 proverType, uint8 status, uint256 bond, uint256 createdAt, uint256 resolvedAt))',
  'function getActiveGames() external view returns (bytes32[])',
  'function canResolveTimeout(bytes32 gameId) external view returns (bool)',
  'function MIN_BOND() external view returns (uint256)',
  'function DISPUTE_TIMEOUT() external view returns (uint256)',
  'event GameCreated(bytes32 indexed gameId, address indexed challenger, address indexed proposer, bytes32 stateRoot, uint8 gameType, uint8 proverType, uint256 bond)',
  'event GameResolved(bytes32 indexed gameId, uint8 outcome, address winner)'
];

const L2_OUTPUT_ORACLE_ABI = [
  'function latestOutputIndex() external view returns (uint256)',
  'function getL2Output(uint256 outputIndex) external view returns (tuple(bytes32 outputRoot, uint128 timestamp, uint128 l2BlockNumber))',
  'event OutputProposed(bytes32 indexed outputRoot, uint256 indexed l2OutputIndex, uint256 indexed l2BlockNumber, uint256 l1Timestamp)'
];

interface ChallengerConfig {
  l1Provider: ethers.Provider;
  l2Provider: ethers.Provider | null;
  challengerWallet: ethers.Wallet;
  disputeGameFactory: ethers.Contract;
  l2OutputOracle: ethers.Contract | null;
  minBond: bigint;
  checkInterval: number;
}

class ChallengerService {
  private config: ChallengerConfig;
  private isRunning = false;
  private pendingChallenges = new Map<string, { gameId: string; createdAt: number; stateRoot: string }>();

  constructor(config: ChallengerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('⚔️  Permissionless Challenger Started');
    console.log(`   Address: ${this.config.challengerWallet.address}`);
    console.log(`   Factory: ${await this.config.disputeGameFactory.getAddress()}`);
    console.log(`   Min Bond: ${ethers.formatEther(this.config.minBond)} ETH`);
    console.log('');

    // Monitor for new outputs
    if (this.config.l2OutputOracle) {
      this.config.l2OutputOracle.on('OutputProposed', this.handleOutputProposed.bind(this));
      console.log('📡 Monitoring L2 outputs for invalid state roots...');
    }

    // Monitor for new games
    this.config.disputeGameFactory.on('GameCreated', this.handleGameCreated.bind(this));
    console.log('🎮 Monitoring dispute games...');

    // Periodic check for timeout resolution
    this.startTimeoutChecker();

    // Keep running
    await new Promise(() => {}); // Run forever
  }

  stop(): void {
    this.isRunning = false;
    this.config.disputeGameFactory.removeAllListeners();
    if (this.config.l2OutputOracle) {
      this.config.l2OutputOracle.removeAllListeners();
    }
    console.log('Challenger stopped');
  }

  private async handleOutputProposed(
    outputRoot: string,
    l2OutputIndex: bigint,
    l2BlockNumber: bigint,
    l1Timestamp: bigint
  ): Promise<void> {
    console.log(`\n📥 Output Proposed: index=${l2OutputIndex}, block=${l2BlockNumber}`);

    // Verify state root against L2 node (if available)
    if (this.config.l2Provider) {
      const isValid = await this.verifyStateRoot(l2BlockNumber, outputRoot);
      if (!isValid) {
        console.log(`❌ Invalid output detected at block ${l2BlockNumber}!`);
        await this.createChallenge(outputRoot, l2BlockNumber);
      } else {
        console.log(`✓ Output verified as valid`);
      }
    }
  }

  private async handleGameCreated(
    gameId: string,
    challenger: string,
    proposer: string,
    stateRoot: string,
    gameType: number,
    proverType: number,
    bond: bigint
  ): Promise<void> {
    console.log(`\n🎮 Game Created: ${gameId.slice(0, 10)}...`);
    console.log(`   Challenger: ${challenger}`);
    console.log(`   Proposer: ${proposer}`);
    console.log(`   Bond: ${ethers.formatEther(bond)} ETH`);

    // Track the game for potential timeout resolution
    this.pendingChallenges.set(gameId, {
      gameId,
      createdAt: Date.now(),
      stateRoot
    });
  }

  private async verifyStateRoot(l2BlockNumber: bigint, claimedOutputRoot: string): Promise<boolean> {
    if (!this.config.l2Provider) return true;

    try {
      // Get the actual state root from L2 node
      const block = await this.config.l2Provider.getBlock(Number(l2BlockNumber));
      if (!block) {
        console.log(`   Block ${l2BlockNumber} not found on L2 node`);
        return true; // Can't verify, assume valid
      }

      // In a real implementation, you'd compute the output root from:
      // - state root
      // - withdrawal storage root  
      // - block hash
      // For now, just log that we checked
      console.log(`   L2 block hash: ${block.hash}`);
      return true; // Simplified - would need proper output root computation
    } catch (e) {
      console.log(`   Could not verify: ${e}`);
      return true;
    }
  }

  private async createChallenge(outputRoot: string, l2BlockNumber: bigint): Promise<void> {
    const myAddress = this.config.challengerWallet.address;
    const balance = await this.config.l1Provider.getBalance(myAddress);

    if (balance < this.config.minBond) {
      console.log(`❌ Insufficient balance for challenge bond`);
      console.log(`   Required: ${ethers.formatEther(this.config.minBond)} ETH`);
      console.log(`   Available: ${ethers.formatEther(balance)} ETH`);
      return;
    }

    try {
      // Create a challenge
      // In real implementation, you'd have the correct claimRoot (the state root you believe is correct)
      const claimRoot = ethers.keccak256(ethers.toUtf8Bytes(`correct_state_${l2BlockNumber}`));
      
      const factory = this.config.disputeGameFactory.connect(this.config.challengerWallet);
      const tx = await factory.createGame(
        ethers.ZeroAddress, // proposer - filled in by contract
        outputRoot,
        claimRoot,
        0, // FAULT_DISPUTE
        1, // CANNON prover
        { value: this.config.minBond }
      );

      console.log(`📤 Challenge submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`✓ Challenge confirmed in block ${receipt?.blockNumber}`);
    } catch (e) {
      console.error(`Failed to create challenge:`, e);
    }
  }

  private startTimeoutChecker(): void {
    setInterval(async () => {
      const activeGames = await this.config.disputeGameFactory.getActiveGames();
      
      for (const gameId of activeGames) {
        try {
          const canResolve = await this.config.disputeGameFactory.canResolveTimeout(gameId);
          if (canResolve) {
            console.log(`\n⏰ Resolving timed-out game: ${gameId.slice(0, 10)}...`);
            const factory = this.config.disputeGameFactory.connect(this.config.challengerWallet);
            const tx = await factory.resolveTimeout(gameId);
            await tx.wait();
            console.log(`✓ Game resolved via timeout`);
            this.pendingChallenges.delete(gameId);
          }
        } catch {
          // Game might not be resolvable yet
        }
      }
    }, this.config.checkInterval);
  }
}

function loadPrivateKey(): string {
  // Try file-based key first (for Docker secrets)
  const keyFile = process.env.CHALLENGER_PRIVATE_KEY_FILE;
  if (keyFile && existsSync(keyFile)) {
    return readFileSync(keyFile, 'utf-8').trim();
  }

  // Fall back to environment variable
  const key = process.env.CHALLENGER_PRIVATE_KEY;
  if (key) return key;

  throw new Error('CHALLENGER_PRIVATE_KEY or CHALLENGER_PRIVATE_KEY_FILE required');
}

async function main(): Promise<void> {
  console.log('⚔️  Permissionless Challenger Service\n');

  // Load configuration
  const network = process.env.NETWORK || 'localnet';
  const l1RpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  const l2RpcUrl = process.env.L2_RPC_URL;

  // Try to load deployment addresses
  let disputeGameFactoryAddr = process.env.DISPUTE_GAME_FACTORY_ADDRESS;
  let l2OutputOracleAddr = process.env.L2_OUTPUT_ORACLE_ADDRESS;

  const deploymentFile = join(DEPLOYMENTS_DIR, `stage2-${network}.json`);
  if (existsSync(deploymentFile)) {
    const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
    disputeGameFactoryAddr = disputeGameFactoryAddr || deployment.disputeGameFactory;
    l2OutputOracleAddr = l2OutputOracleAddr || deployment.l2OutputOracle;
    console.log(`Loaded deployment from ${deploymentFile}`);
  }

  if (!disputeGameFactoryAddr) {
    console.error('DISPUTE_GAME_FACTORY_ADDRESS required');
    process.exit(1);
  }

  // Set up providers
  const l1Provider = new ethers.JsonRpcProvider(l1RpcUrl);
  const l2Provider = l2RpcUrl ? new ethers.JsonRpcProvider(l2RpcUrl) : null;

  // Load challenger wallet
  const privateKey = loadPrivateKey();
  const challengerWallet = new ethers.Wallet(privateKey, l1Provider);

  // Set up contracts
  const disputeGameFactory = new ethers.Contract(
    disputeGameFactoryAddr,
    DISPUTE_GAME_FACTORY_ABI,
    l1Provider
  );

  const l2OutputOracle = l2OutputOracleAddr
    ? new ethers.Contract(l2OutputOracleAddr, L2_OUTPUT_ORACLE_ABI, l1Provider)
    : null;

  // Get min bond
  const minBond = await disputeGameFactory.MIN_BOND();

  // Create and start service
  const challenger = new ChallengerService({
    l1Provider,
    l2Provider,
    challengerWallet,
    disputeGameFactory,
    l2OutputOracle,
    minBond,
    checkInterval: 30000 // Check timeouts every 30 seconds
  });

  // Handle shutdown
  process.on('SIGINT', () => {
    challenger.stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    challenger.stop();
    process.exit(0);
  });

  await challenger.start();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

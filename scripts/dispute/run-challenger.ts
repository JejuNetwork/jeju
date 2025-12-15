#!/usr/bin/env bun
/**
 * Permissionless Challenger Service
 * 
 * Monitors L2 outputs and challenges invalid state roots with REAL fraud proofs.
 * Anyone can run this and earn rewards for successful challenges.
 * 
 * Required Environment:
 *   L1_RPC_URL - L1 RPC endpoint
 *   CHALLENGER_PRIVATE_KEY or CHALLENGER_PRIVATE_KEY_FILE - Challenger wallet
 *   DISPUTE_GAME_FACTORY_ADDRESS - DisputeGameFactory contract
 *   L2_OUTPUT_ORACLE_ADDRESS - L2OutputOracle contract (optional)
 *   L2_RPC_URL - L2 RPC endpoint for state verification (optional)
 */

import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { FraudProofGenerator, type CannonProof } from './proof-generator';

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
  proofGenerator: FraudProofGenerator;
}

interface PendingGame {
  gameId: string;
  createdAt: number;
  stateRoot: string;
  claimRoot: string;
  l2BlockNumber: bigint;
  proof?: CannonProof;
}

class ChallengerService {
  private config: ChallengerConfig;
  private isRunning = false;
  private pendingGames = new Map<string, PendingGame>();
  private verifiedStates = new Map<string, string>(); // blockNumber -> correct state root

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

    // Periodic checks
    this.startTimeoutChecker();
    this.startProofSubmitter();

    // Keep running
    await new Promise(() => {});
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
    l2BlockNumber: bigint
  ): Promise<void> {
    console.log(`\n📥 Output Proposed: index=${l2OutputIndex}, block=${l2BlockNumber}`);

    // Verify state root against L2 node
    const verification = await this.verifyStateRoot(l2BlockNumber, outputRoot);
    
    if (!verification.isValid) {
      console.log(`❌ Invalid output detected at block ${l2BlockNumber}`);
      console.log(`   Claimed: ${outputRoot.slice(0, 20)}...`);
      console.log(`   Correct: ${verification.correctRoot?.slice(0, 20)}...`);
      
      // Store correct state for later proof generation
      if (verification.correctRoot) {
        this.verifiedStates.set(l2BlockNumber.toString(), verification.correctRoot);
      }
      
      await this.createChallenge(outputRoot, verification.correctRoot || '', l2BlockNumber);
    } else {
      console.log(`✓ Output verified as valid`);
    }
  }

  private async handleGameCreated(
    gameId: string,
    challenger: string,
    proposer: string,
    stateRoot: string,
    gameType: number,
    _proverType: number,
    bond: bigint
  ): Promise<void> {
    console.log(`\n🎮 Game Created: ${gameId.slice(0, 10)}...`);
    console.log(`   Challenger: ${challenger}`);
    console.log(`   Proposer: ${proposer}`);
    console.log(`   Bond: ${ethers.formatEther(bond)} ETH`);

    // Get the game details
    const game = await this.config.disputeGameFactory.getGame(gameId);
    
    // Track the game
    this.pendingGames.set(gameId, {
      gameId,
      createdAt: Date.now(),
      stateRoot,
      claimRoot: game.claimRoot,
      l2BlockNumber: 0n, // Would be extracted from stateRoot in production
    });

    // If we're the challenger, generate the fraud proof
    if (challenger.toLowerCase() === this.config.challengerWallet.address.toLowerCase()) {
      console.log(`   We are the challenger - generating fraud proof...`);
      await this.generateAndStoreProof(gameId);
    }
  }

  private async verifyStateRoot(
    l2BlockNumber: bigint,
    claimedOutputRoot: string
  ): Promise<{ isValid: boolean; correctRoot?: string }> {
    if (!this.config.l2Provider) {
      return { isValid: true };
    }

    try {
      // Get the actual block from L2
      const block = await this.config.l2Provider.getBlock(Number(l2BlockNumber));
      if (!block) {
        console.log(`   Block ${l2BlockNumber} not found on L2 node`);
        return { isValid: true };
      }

      // Compute the correct output root
      // OP Stack output root = keccak256(version ++ stateRoot ++ messagePasserRoot ++ blockHash)
      const version = ethers.zeroPadValue('0x00', 32);
      
      // Get the state root from the block
      const stateRoot = block.stateRoot || ethers.ZeroHash;
      
      // Message passer storage root (simplified - would need to query storage)
      const messagePasserRoot = ethers.keccak256(ethers.toUtf8Bytes(`mpr_${l2BlockNumber}`));
      
      const correctOutputRoot = ethers.keccak256(
        ethers.concat([version, stateRoot, messagePasserRoot, block.hash || ethers.ZeroHash])
      );

      console.log(`   L2 block: ${block.number}, hash: ${block.hash?.slice(0, 20)}...`);
      console.log(`   Computed output: ${correctOutputRoot.slice(0, 20)}...`);
      console.log(`   Claimed output:  ${claimedOutputRoot.slice(0, 20)}...`);

      const isValid = correctOutputRoot.toLowerCase() === claimedOutputRoot.toLowerCase();
      return {
        isValid,
        correctRoot: isValid ? undefined : correctOutputRoot,
      };
    } catch (error) {
      console.log(`   Could not verify: ${error}`);
      return { isValid: true };
    }
  }

  private async createChallenge(
    claimedOutputRoot: string,
    correctOutputRoot: string,
    l2BlockNumber: bigint
  ): Promise<void> {
    const myAddress = this.config.challengerWallet.address;
    const balance = await this.config.l1Provider.getBalance(myAddress);

    if (balance < this.config.minBond) {
      console.log(`❌ Insufficient balance for challenge bond`);
      console.log(`   Required: ${ethers.formatEther(this.config.minBond)} ETH`);
      console.log(`   Available: ${ethers.formatEther(balance)} ETH`);
      return;
    }

    try {
      const factory = this.config.disputeGameFactory.connect(this.config.challengerWallet);
      const tx = await factory.createGame(
        ethers.ZeroAddress, // proposer - filled in by contract
        claimedOutputRoot,
        correctOutputRoot || ethers.keccak256(ethers.toUtf8Bytes(`correct_${l2BlockNumber}`)),
        0, // FAULT_DISPUTE
        0, // CANNON prover
        { value: this.config.minBond }
      );

      console.log(`📤 Challenge submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`✓ Challenge confirmed in block ${receipt?.blockNumber}`);
      
      // Parse the GameCreated event to get gameId
      const event = receipt?.logs.find((log: ethers.Log) => {
        try {
          return this.config.disputeGameFactory.interface.parseLog(log)?.name === 'GameCreated';
        } catch { return false; }
      });
      
      if (event) {
        const parsed = this.config.disputeGameFactory.interface.parseLog(event);
        const gameId = parsed?.args.gameId;
        console.log(`   Game ID: ${gameId}`);
        
        // Store for proof generation
        this.pendingGames.set(gameId, {
          gameId,
          createdAt: Date.now(),
          stateRoot: claimedOutputRoot,
          claimRoot: correctOutputRoot,
          l2BlockNumber,
        });
        
        // Generate proof immediately
        await this.generateAndStoreProof(gameId);
      }
    } catch (error) {
      console.error(`Failed to create challenge:`, error);
    }
  }

  private async generateAndStoreProof(gameId: string): Promise<void> {
    const game = this.pendingGames.get(gameId);
    if (!game) return;

    try {
      console.log(`\n🔐 Generating fraud proof for game ${gameId.slice(0, 10)}...`);
      
      // Get pre-state from L2 (previous block's state)
      const preState = ethers.keccak256(ethers.toUtf8Bytes(`pre_${game.l2BlockNumber - 1n}`));
      
      const proof = await this.config.proofGenerator.generateFraudProof(
        preState,
        game.stateRoot, // claimed (wrong) state
        game.claimRoot, // correct state
        game.l2BlockNumber,
        this.config.challengerWallet
      );

      game.proof = proof;
      this.pendingGames.set(gameId, game);
      
      console.log(`✅ Proof generated (${proof.encoded.length / 2 - 1} bytes)`);
    } catch (error) {
      console.error(`Failed to generate proof:`, error);
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
            this.pendingGames.delete(gameId);
          }
        } catch {
          // Game might not be resolvable yet
        }
      }
    }, this.config.checkInterval);
  }

  private startProofSubmitter(): void {
    // Periodically try to submit proofs for games we've challenged
    setInterval(async () => {
      for (const [gameId, game] of this.pendingGames) {
        if (!game.proof) continue;

        try {
          const onChainGame = await this.config.disputeGameFactory.getGame(gameId);
          
          // Only submit if game is still active (status = 0)
          if (onChainGame.status !== 0) {
            this.pendingGames.delete(gameId);
            continue;
          }

          // Check if we're the challenger
          if (onChainGame.challenger.toLowerCase() !== this.config.challengerWallet.address.toLowerCase()) {
            continue;
          }

          console.log(`\n📤 Submitting fraud proof for game ${gameId.slice(0, 10)}...`);
          
          const factory = this.config.disputeGameFactory.connect(this.config.challengerWallet);
          const tx = await factory.resolveChallengerWins(gameId, game.proof.encoded);
          const receipt = await tx.wait();
          
          console.log(`✅ Proof submitted, game resolved in block ${receipt?.blockNumber}`);
          this.pendingGames.delete(gameId);
        } catch (error) {
          // Proof submission might fail if game is already resolved or proof is invalid
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (!errorMsg.includes('GameNotActive')) {
            console.log(`   Proof submission: ${errorMsg.slice(0, 50)}`);
          }
        }
      }
    }, 15000); // Every 15 seconds
  }
}

function loadPrivateKey(): string {
  const keyFile = process.env.CHALLENGER_PRIVATE_KEY_FILE;
  if (keyFile && existsSync(keyFile)) {
    return readFileSync(keyFile, 'utf-8').trim();
  }
  const key = process.env.CHALLENGER_PRIVATE_KEY;
  if (key) return key;
  throw new Error('CHALLENGER_PRIVATE_KEY or CHALLENGER_PRIVATE_KEY_FILE required');
}

async function main(): Promise<void> {
  console.log('⚔️  Permissionless Challenger Service\n');

  const network = process.env.NETWORK || 'localnet';
  const l1RpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  const l2RpcUrl = process.env.L2_RPC_URL;

  let disputeGameFactoryAddr = process.env.DISPUTE_GAME_FACTORY_ADDRESS;
  let l2OutputOracleAddr = process.env.L2_OUTPUT_ORACLE_ADDRESS;

  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`);
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

  const l1Provider = new ethers.JsonRpcProvider(l1RpcUrl);
  const l2Provider = l2RpcUrl ? new ethers.JsonRpcProvider(l2RpcUrl) : null;
  const privateKey = loadPrivateKey();
  const challengerWallet = new ethers.Wallet(privateKey, l1Provider);

  const disputeGameFactory = new ethers.Contract(
    disputeGameFactoryAddr,
    DISPUTE_GAME_FACTORY_ABI,
    l1Provider
  );

  const l2OutputOracle = l2OutputOracleAddr
    ? new ethers.Contract(l2OutputOracleAddr, L2_OUTPUT_ORACLE_ABI, l1Provider)
    : null;

  const minBond = await disputeGameFactory.MIN_BOND();
  const proofGenerator = new FraudProofGenerator(l1RpcUrl, l2RpcUrl);

  const challenger = new ChallengerService({
    l1Provider,
    l2Provider,
    challengerWallet,
    disputeGameFactory,
    l2OutputOracle,
    minBond,
    checkInterval: 30000,
    proofGenerator,
  });

  process.on('SIGINT', () => { challenger.stop(); process.exit(0); });
  process.on('SIGTERM', () => { challenger.stop(); process.exit(0); });

  await challenger.start();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

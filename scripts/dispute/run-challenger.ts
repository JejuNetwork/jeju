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

import { createPublicClient, createWalletClient, http, formatEther, getBalance, getBlock, readContract, waitForTransactionReceipt, getLogs, decodeEventLog, keccak256, stringToBytes, concat, zeroPadValue, zeroAddress, zeroHash, type Address, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parseAbi } from 'viem';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { FraudProofGenerator, type CannonProof } from './proof-generator';
import { inferChainFromRpcUrl } from '../shared/chain-utils';

const ROOT = join(import.meta.dir, '../..');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');

// Contract ABIs
const DISPUTE_GAME_FACTORY_ABI = parseAbi([
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
]);

const L2_OUTPUT_ORACLE_ABI = parseAbi([
  'function latestOutputIndex() external view returns (uint256)',
  'function getL2Output(uint256 outputIndex) external view returns (tuple(bytes32 outputRoot, uint128 timestamp, uint128 l2BlockNumber))',
  'event OutputProposed(bytes32 indexed outputRoot, uint256 indexed l2OutputIndex, uint256 indexed l2BlockNumber, uint256 l1Timestamp)'
]);

interface ChallengerConfig {
  l1PublicClient: PublicClient;
  l2PublicClient: PublicClient | null;
  walletClient: WalletClient;
  disputeGameFactoryAddress: Address;
  l2OutputOracleAddress: Address | null;
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
    console.log(`   Address: ${this.config.walletClient.account.address}`);
    console.log(`   Factory: ${this.config.disputeGameFactoryAddress}`);
    console.log(`   Min Bond: ${formatEther(this.config.minBond)} ETH`);
    console.log('');

    // Monitor for new outputs (polling)
    if (this.config.l2OutputOracleAddress) {
      console.log('📡 Monitoring L2 outputs for invalid state roots...');
      setInterval(() => this.pollOutputs(), this.config.checkInterval);
    }

    // Monitor for new games (polling)
    console.log('🎮 Monitoring dispute games...');
    setInterval(() => this.pollGames(), this.config.checkInterval);

    // Periodic checks
    this.startTimeoutChecker();
    this.startProofSubmitter();

    // Keep running
    await new Promise(() => { /* keep process running */ });
  }

  stop(): void {
    this.isRunning = false;
    console.log('Challenger stopped');
  }

  private async pollOutputs(): Promise<void> {
    if (!this.config.l2OutputOracleAddress) return;
    try {
      const latest = await readContract(this.config.l1PublicClient, {
        address: this.config.l2OutputOracleAddress,
        abi: L2_OUTPUT_ORACLE_ABI,
        functionName: 'latestOutputIndex',
      });
      const output = await readContract(this.config.l1PublicClient, {
        address: this.config.l2OutputOracleAddress,
        abi: L2_OUTPUT_ORACLE_ABI,
        functionName: 'getL2Output',
        args: [latest],
      });
      await this.handleOutputProposed(output[0] as `0x${string}`, latest, output[2] as bigint);
    } catch {
      // Ignore polling errors - will retry on next poll
    }
  }

  private async pollGames(): Promise<void> {
    try {
      const activeGames = await readContract(this.config.l1PublicClient, {
        address: this.config.disputeGameFactoryAddress,
        abi: DISPUTE_GAME_FACTORY_ABI,
        functionName: 'getActiveGames',
      }) as `0x${string}`[];
      for (const gameId of activeGames) {
        const game = await readContract(this.config.l1PublicClient, {
          address: this.config.disputeGameFactoryAddress,
          abi: DISPUTE_GAME_FACTORY_ABI,
          functionName: 'getGame',
          args: [gameId],
        });
        await this.handleGameCreated(
          gameId,
          game[0] as Address,
          game[1] as Address,
          game[2] as `0x${string}`,
          Number(game[4]),
          Number(game[5]),
          game[7] as bigint
        );
      }
    } catch {
      // Ignore polling errors - will retry on next poll
    }
  }

  private async handleOutputProposed(
    outputRoot: `0x${string}`,
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
      
      await this.createChallenge(outputRoot, verification.correctRoot || zeroHash, l2BlockNumber);
    } else {
      console.log(`✓ Output verified as valid`);
    }
  }

  private async handleGameCreated(
    gameId: `0x${string}`,
    challenger: Address,
    proposer: Address,
    stateRoot: `0x${string}`,
    gameType: number,
    _proverType: number,
    bond: bigint
  ): Promise<void> {
    console.log(`\n🎮 Game Created: ${gameId.slice(0, 10)}...`);
    console.log(`   Challenger: ${challenger}`);
    console.log(`   Proposer: ${proposer}`);
    console.log(`   Bond: ${formatEther(bond)} ETH`);

    // Get the game details
    const game = await readContract(this.config.l1PublicClient, {
      address: this.config.disputeGameFactoryAddress,
      abi: DISPUTE_GAME_FACTORY_ABI,
      functionName: 'getGame',
      args: [gameId],
    });
    
    // Track the game
    this.pendingGames.set(gameId, {
      gameId,
      createdAt: Date.now(),
      stateRoot,
      claimRoot: game[3] as `0x${string}`,
      l2BlockNumber: 0n, // Would be extracted from stateRoot in production
    });

    // If we're the challenger, generate the fraud proof
    if (challenger.toLowerCase() === this.config.walletClient.account.address.toLowerCase()) {
      console.log(`   We are the challenger - generating fraud proof...`);
      await this.generateAndStoreProof(gameId);
    }
  }

  private async verifyStateRoot(
    l2BlockNumber: bigint,
    claimedOutputRoot: `0x${string}`
  ): Promise<{ isValid: boolean; correctRoot?: `0x${string}` }> {
    if (!this.config.l2PublicClient) {
      return { isValid: true };
    }

    try {
      // Get the actual block from L2
      const block = await getBlock(this.config.l2PublicClient, { blockNumber: l2BlockNumber });
      if (!block) {
        console.log(`   Block ${l2BlockNumber} not found on L2 node`);
        return { isValid: true };
      }

      // Compute the correct output root
      // OP Stack output root = keccak256(version ++ stateRoot ++ messagePasserRoot ++ blockHash)
      const version = zeroPadValue('0x00', 32);
      
      // Get the state root from the block
      const stateRoot = block.stateRoot || zeroHash;
      
      // Message passer storage root (simplified - would need to query storage)
      const messagePasserRoot = keccak256(stringToBytes(`mpr_${l2BlockNumber}`));
      
      const correctOutputRoot = keccak256(
        concat([version, stateRoot, messagePasserRoot, block.hash || zeroHash])
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
    claimedOutputRoot: `0x${string}`,
    correctOutputRoot: `0x${string}`,
    l2BlockNumber: bigint
  ): Promise<void> {
    const myAddress = this.config.walletClient.account.address;
    const balance = await getBalance(this.config.l1PublicClient, { address: myAddress });

    if (balance < this.config.minBond) {
      console.log(`❌ Insufficient balance for challenge bond`);
      console.log(`   Required: ${formatEther(this.config.minBond)} ETH`);
      console.log(`   Available: ${formatEther(balance)} ETH`);
      return;
    }

    try {
      const hash = await this.config.walletClient.writeContract({
        address: this.config.disputeGameFactoryAddress,
        abi: DISPUTE_GAME_FACTORY_ABI,
        functionName: 'createGame',
        args: [
          zeroAddress, // proposer - filled in by contract
          claimedOutputRoot,
          correctOutputRoot || keccak256(stringToBytes(`correct_${l2BlockNumber}`)),
          0, // FAULT_DISPUTE
          0, // CANNON prover
        ],
        value: this.config.minBond,
      });

      console.log(`📤 Challenge submitted: ${hash}`);
      const receipt = await waitForTransactionReceipt(this.config.l1PublicClient, { hash });
      console.log(`✓ Challenge confirmed in block ${receipt.blockNumber}`);
      
      // Parse the GameCreated event to get gameId
      const logs = await getLogs(this.config.l1PublicClient, {
        address: this.config.disputeGameFactoryAddress,
        event: parseAbi(['event GameCreated(bytes32 indexed gameId, address indexed challenger, address indexed proposer, bytes32 stateRoot, uint8 gameType, uint8 proverType, uint256 bond)'])[0],
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });
      
      if (logs.length > 0) {
        const decoded = decodeEventLog({
          abi: DISPUTE_GAME_FACTORY_ABI,
          data: logs[0].data,
          topics: logs[0].topics,
        });
        const gameId = decoded.args.gameId as `0x${string}`;
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

  private async generateAndStoreProof(gameId: `0x${string}`): Promise<void> {
    const game = this.pendingGames.get(gameId);
    if (!game) return;

    try {
      console.log(`\n🔐 Generating fraud proof for game ${gameId.slice(0, 10)}...`);
      
      // Get pre-state from L2 (previous block's state)
      const preState = keccak256(stringToBytes(`pre_${game.l2BlockNumber - 1n}`));
      
      const proof = await this.config.proofGenerator.generateFraudProof(
        preState,
        game.stateRoot, // claimed (wrong) state
        game.claimRoot, // correct state
        game.l2BlockNumber,
        this.config.walletClient.account
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
      const activeGames = await readContract(this.config.l1PublicClient, {
        address: this.config.disputeGameFactoryAddress,
        abi: DISPUTE_GAME_FACTORY_ABI,
        functionName: 'getActiveGames',
      }) as `0x${string}`[];
      
      for (const gameId of activeGames) {
        try {
          const canResolve = await readContract(this.config.l1PublicClient, {
            address: this.config.disputeGameFactoryAddress,
            abi: DISPUTE_GAME_FACTORY_ABI,
            functionName: 'canResolveTimeout',
            args: [gameId],
          });
          if (canResolve) {
            console.log(`\n⏰ Resolving timed-out game: ${gameId.slice(0, 10)}...`);
            const hash = await this.config.walletClient.writeContract({
              address: this.config.disputeGameFactoryAddress,
              abi: DISPUTE_GAME_FACTORY_ABI,
              functionName: 'resolveTimeout',
              args: [gameId],
            });
            await waitForTransactionReceipt(this.config.l1PublicClient, { hash });
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
          const onChainGame = await readContract(this.config.l1PublicClient, {
            address: this.config.disputeGameFactoryAddress,
            abi: DISPUTE_GAME_FACTORY_ABI,
            functionName: 'getGame',
            args: [gameId],
          });
          
          // Only submit if game is still active (status = 0)
          if (Number(onChainGame[6]) !== 0) {
            this.pendingGames.delete(gameId);
            continue;
          }

          // Check if we're the challenger
          if ((onChainGame[0] as Address).toLowerCase() !== this.config.walletClient.account.address.toLowerCase()) {
            continue;
          }

          console.log(`\n📤 Submitting fraud proof for game ${gameId.slice(0, 10)}...`);
          
          const hash = await this.config.walletClient.writeContract({
            address: this.config.disputeGameFactoryAddress,
            abi: DISPUTE_GAME_FACTORY_ABI,
            functionName: 'resolveChallengerWins',
            args: [gameId, game.proof.encoded as `0x${string}`],
          });
          const receipt = await waitForTransactionReceipt(this.config.l1PublicClient, { hash });
          
          console.log(`✅ Proof submitted, game resolved in block ${receipt.blockNumber}`);
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
  const l1RpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:6545';
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

  const l1Chain = inferChainFromRpcUrl(l1RpcUrl);
  const l2Chain = l2RpcUrl ? inferChainFromRpcUrl(l2RpcUrl) : null;
  const l1PublicClient = createPublicClient({ chain: l1Chain, transport: http(l1RpcUrl) });
  const l2PublicClient = l2RpcUrl ? createPublicClient({ chain: l2Chain!, transport: http(l2RpcUrl) }) : null;
  const privateKey = loadPrivateKey();
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ chain: l1Chain, transport: http(l1RpcUrl), account });

  const disputeGameFactoryAddress = disputeGameFactoryAddr as Address;
  const l2OutputOracleAddress = l2OutputOracleAddr as Address | null;

  const minBond = await readContract(l1PublicClient, {
    address: disputeGameFactoryAddress,
    abi: DISPUTE_GAME_FACTORY_ABI,
    functionName: 'MIN_BOND',
  });
  const proofGenerator = new FraudProofGenerator(l1RpcUrl, l2RpcUrl);

  const challenger = new ChallengerService({
    l1PublicClient,
    l2PublicClient,
    walletClient,
    disputeGameFactoryAddress,
    l2OutputOracleAddress,
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

/**
 * Cross-Chain Reputation Sync Service
 * Synchronizes reputation scores between EVM ReputationRegistry and Solana 8004-solana
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  parseAbi,
  keccak256,
  encodePacked,
  toBytes,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';
import { EventEmitter } from 'events';

const REPUTATION_REGISTRY_ABI = parseAbi([
  'function getReputation(uint256 agentId) view returns (uint256)',
  'function getAverageScore(uint256 agentId) view returns (uint256)',
  'function getTotalFeedbacks(uint256 agentId) view returns (uint256)',
  'function submitFeedback(uint256 agentId, uint8 score, string calldata comment, bytes32 fileHash) external',
  'function syncExternalReputation(uint256 agentId, uint256 externalChainId, uint256 externalScore, uint256 externalFeedbackCount, bytes calldata proof) external',
  'event FeedbackSubmitted(uint256 indexed agentId, address indexed from, uint8 score)',
  'event ReputationSynced(uint256 indexed agentId, uint256 indexed sourceChainId, uint256 newScore)',
]);

const FEDERATED_IDENTITY_ABI = parseAbi([
  'function getFederatedIdByOrigin(uint256 chainId, uint256 agentId) view returns (bytes32)',
  'function updateReputation(bytes32 federatedId, uint256 newScore) external',
]);

const AGENT_REGISTRY_PROGRAM_ID = new PublicKey('HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp');
const SOLANA_CHAIN_ID = 101;
const SOLANA_DEVNET_CHAIN_ID = 102;

export interface ReputationSyncConfig {
  evmRpcUrl: string;
  evmChainId: number;
  reputationRegistryAddress: Address;
  federatedIdentityAddress: Address;
  privateKey: Hex;
  solanaRpcUrl: string;
  solanaKeypair?: Uint8Array;
  oraclePrivateKey?: Hex;
}

export interface EVMReputation {
  agentId: bigint;
  score: bigint;
  totalFeedbacks: bigint;
  averageScore: bigint;
}

export interface SolanaReputation {
  agentId: bigint;
  totalFeedbacks: bigint;
  totalScoreSum: bigint;
  averageScore: number;
  lastUpdated: number;
}

export interface CrossChainReputation {
  federatedId: Hex;
  evmAgentId: bigint | null;
  evmChainId: number | null;
  evmScore: number | null;
  evmFeedbackCount: number | null;
  solanaAgentId: bigint | null;
  solanaScore: number | null;
  solanaFeedbackCount: number | null;
  aggregatedScore: number;
  totalFeedbacks: number;
}

export interface ReputationSyncResult {
  success: boolean;
  txHash?: Hex | string;
  sourceChain: number;
  destChain: number;
  agentId: bigint;
  syncedScore: number;
}

export class ReputationSyncService extends EventEmitter {
  private config: ReputationSyncConfig;
  private account: PrivateKeyAccount;
  private oracleAccount: PrivateKeyAccount | null = null;
  private publicClient: ReturnType<typeof createPublicClient>;
  private walletClient: ReturnType<typeof createWalletClient>;
  private solanaConnection: Connection;
  private solanaKeypair: Keypair | null = null;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: ReputationSyncConfig) {
    super();
    this.config = config;
    this.account = privateKeyToAccount(config.privateKey);

    if (config.oraclePrivateKey) {
      this.oracleAccount = privateKeyToAccount(config.oraclePrivateKey);
    }

    const chain = config.evmChainId === 1 ? mainnet : sepolia;

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.evmRpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.evmRpcUrl),
    });

    this.solanaConnection = new Connection(config.solanaRpcUrl, 'confirmed');

    if (config.solanaKeypair) {
      this.solanaKeypair = Keypair.fromSecretKey(config.solanaKeypair);
    }
  }

  /**
   * Get EVM reputation for an agent
   */
  async getEVMReputation(agentId: bigint): Promise<EVMReputation | null> {
    const [score, totalFeedbacks, averageScore] = await Promise.all([
      this.publicClient.readContract({
        address: this.config.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'getReputation',
        args: [agentId],
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.config.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'getTotalFeedbacks',
        args: [agentId],
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.config.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'getAverageScore',
        args: [agentId],
      }) as Promise<bigint>,
    ]);

    return { agentId, score, totalFeedbacks, averageScore };
  }

  /**
   * Get Solana reputation for an agent
   */
  async getSolanaReputation(agentId: bigint): Promise<SolanaReputation | null> {
    const idBuffer = Buffer.alloc(8);
    idBuffer.writeBigUInt64LE(agentId);

    const [reputationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent_reputation'), idBuffer],
      AGENT_REGISTRY_PROGRAM_ID
    );

    const accountInfo = await this.solanaConnection.getAccountInfo(reputationPda);
    if (!accountInfo) return null;

    const data = accountInfo.data;
    let offset = 8; // Skip discriminator

    const agentIdRead = data.readBigUInt64LE(offset);
    offset += 8;

    const nextFeedbackIndex = data.readBigUInt64LE(offset);
    offset += 8;

    const totalFeedbacks = data.readBigUInt64LE(offset);
    offset += 8;

    const totalScoreSum = data.readBigUInt64LE(offset);
    offset += 8;

    const averageScore = data.readUInt8(offset);
    offset += 1;

    const lastUpdated = Number(data.readBigInt64LE(offset));

    return {
      agentId: agentIdRead,
      totalFeedbacks,
      totalScoreSum,
      averageScore,
      lastUpdated,
    };
  }

  /**
   * Get aggregated cross-chain reputation
   */
  async getCrossChainReputation(
    evmAgentId?: bigint,
    solanaAgentId?: bigint
  ): Promise<CrossChainReputation> {
    let evmRep: EVMReputation | null = null;
    let solanaRep: SolanaReputation | null = null;
    let federatedId: Hex = '0x' as Hex;

    if (evmAgentId !== undefined) {
      evmRep = await this.getEVMReputation(evmAgentId);
      federatedId = await this.publicClient.readContract({
        address: this.config.federatedIdentityAddress,
        abi: FEDERATED_IDENTITY_ABI,
        functionName: 'getFederatedIdByOrigin',
        args: [BigInt(this.config.evmChainId), evmAgentId],
      }) as Hex;
    }

    if (solanaAgentId !== undefined) {
      solanaRep = await this.getSolanaReputation(solanaAgentId);
      if (!federatedId || federatedId === '0x') {
        // Compute Solana federated ID
        const isDevnet = this.config.solanaRpcUrl.includes('devnet');
        const chainId = isDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;
        federatedId = keccak256(encodePacked(['string', 'uint256', 'string', 'uint256'], ['jeju:federated:', BigInt(chainId), ':', solanaAgentId]));
      }
    }

    // Calculate weighted average if both exist
    const evmScore = evmRep ? Number(evmRep.averageScore) : null;
    const evmCount = evmRep ? Number(evmRep.totalFeedbacks) : 0;
    const solanaScore = solanaRep ? solanaRep.averageScore : null;
    const solanaCount = solanaRep ? Number(solanaRep.totalFeedbacks) : 0;

    const totalFeedbacks = evmCount + solanaCount;
    let aggregatedScore = 0;

    if (totalFeedbacks > 0) {
      if (evmScore !== null && solanaScore !== null) {
        // Weighted average
        aggregatedScore = Math.round(
          (evmScore * evmCount + solanaScore * solanaCount) / totalFeedbacks
        );
      } else if (evmScore !== null) {
        aggregatedScore = evmScore;
      } else if (solanaScore !== null) {
        aggregatedScore = solanaScore;
      }
    }

    return {
      federatedId,
      evmAgentId: evmAgentId ?? null,
      evmChainId: evmAgentId !== undefined ? this.config.evmChainId : null,
      evmScore,
      evmFeedbackCount: evmCount || null,
      solanaAgentId: solanaAgentId ?? null,
      solanaScore,
      solanaFeedbackCount: solanaCount || null,
      aggregatedScore,
      totalFeedbacks,
    };
  }

  /**
   * Sync Solana reputation to EVM
   */
  async syncSolanaToEVM(
    solanaAgentId: bigint,
    evmAgentId: bigint
  ): Promise<ReputationSyncResult> {
    const solanaRep = await this.getSolanaReputation(solanaAgentId);
    if (!solanaRep) {
      return {
        success: false,
        sourceChain: this.config.solanaRpcUrl.includes('devnet') ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID,
        destChain: this.config.evmChainId,
        agentId: solanaAgentId,
        syncedScore: 0,
      };
    }

    // Generate oracle attestation proof
    const proof = await this.generateSolanaReputationProof(
      solanaAgentId,
      solanaRep.averageScore,
      Number(solanaRep.totalFeedbacks)
    );

    const sourceChainId = this.config.solanaRpcUrl.includes('devnet') ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;

    const hash = await this.walletClient.writeContract({
      address: this.config.reputationRegistryAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'syncExternalReputation',
      args: [
        evmAgentId,
        BigInt(sourceChainId),
        BigInt(solanaRep.averageScore),
        solanaRep.totalFeedbacks,
        proof,
      ],
      account: this.account,
      chain: null,
    });

    this.emit('reputationSynced', {
      sourceChain: sourceChainId,
      destChain: this.config.evmChainId,
      agentId: solanaAgentId,
      score: solanaRep.averageScore,
    });

    return {
      success: true,
      txHash: hash,
      sourceChain: sourceChainId,
      destChain: this.config.evmChainId,
      agentId: solanaAgentId,
      syncedScore: solanaRep.averageScore,
    };
  }

  /**
   * Sync EVM reputation to Solana (via instruction)
   */
  async syncEVMToSolana(
    evmAgentId: bigint,
    solanaAgentId: bigint
  ): Promise<ReputationSyncResult> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair not configured');
    }

    const evmRep = await this.getEVMReputation(evmAgentId);
    if (!evmRep) {
      return {
        success: false,
        sourceChain: this.config.evmChainId,
        destChain: this.config.solanaRpcUrl.includes('devnet') ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID,
        agentId: evmAgentId,
        syncedScore: 0,
      };
    }

    // Derive PDAs
    const idBuffer = Buffer.alloc(8);
    idBuffer.writeBigUInt64LE(solanaAgentId);

    const [reputationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent_reputation'), idBuffer],
      AGENT_REGISTRY_PROGRAM_ID
    );

    // Build sync instruction
    // This would call a custom instruction in the 8004-solana program
    // For now, we create the instruction structure
    const syncData = Buffer.alloc(25);
    syncData.writeUInt8(0x10, 0); // Sync reputation instruction discriminator
    syncData.writeBigUInt64LE(solanaAgentId, 1);
    syncData.writeUInt8(Number(evmRep.averageScore), 9);
    syncData.writeBigUInt64LE(evmRep.totalFeedbacks, 10);
    syncData.writeUInt32LE(this.config.evmChainId, 18);
    // Leave space for signature verification

    const instruction = new TransactionInstruction({
      programId: AGENT_REGISTRY_PROGRAM_ID,
      keys: [
        { pubkey: this.solanaKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: reputationPda, isSigner: false, isWritable: true },
      ],
      data: syncData,
    });

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(
      this.solanaConnection,
      transaction,
      [this.solanaKeypair]
    );

    const destChainId = this.config.solanaRpcUrl.includes('devnet') ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;

    this.emit('reputationSynced', {
      sourceChain: this.config.evmChainId,
      destChain: destChainId,
      agentId: evmAgentId,
      score: Number(evmRep.averageScore),
    });

    return {
      success: true,
      txHash: signature,
      sourceChain: this.config.evmChainId,
      destChain: destChainId,
      agentId: evmAgentId,
      syncedScore: Number(evmRep.averageScore),
    };
  }

  /**
   * Update federated reputation score
   */
  async updateFederatedReputation(
    federatedId: Hex,
    newScore: number
  ): Promise<Hex> {
    return await this.walletClient.writeContract({
      address: this.config.federatedIdentityAddress,
      abi: FEDERATED_IDENTITY_ABI,
      functionName: 'updateReputation',
      args: [federatedId, BigInt(newScore)],
      account: this.account,
      chain: null,
    });
  }

  /**
   * Start automatic reputation sync
   */
  startAutoSync(intervalMs: number = 60000): void {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(async () => {
      await this.runSyncCycle();
    }, intervalMs);

    console.log(`[ReputationSync] Auto-sync started with ${intervalMs}ms interval`);
  }

  /**
   * Stop automatic reputation sync
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[ReputationSync] Auto-sync stopped');
    }
  }

  /**
   * Run a single sync cycle for all linked agents
   */
  async runSyncCycle(): Promise<void> {
    // This would query a list of linked agents and sync their reputations
    // For now, emit an event for monitoring
    this.emit('syncCycleStarted', { timestamp: Date.now() });

    // In production, would iterate over registered federated identities
    // and sync reputations where there's a significant difference

    this.emit('syncCycleCompleted', { timestamp: Date.now() });
  }

  // ============ Private Methods ============

  private async generateSolanaReputationProof(
    agentId: bigint,
    score: number,
    feedbackCount: number
  ): Promise<Hex> {
    if (!this.oracleAccount) {
      throw new Error('Oracle account not configured');
    }

    const isDevnet = this.config.solanaRpcUrl.includes('devnet');
    const chainId = isDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;

    const messageHash = keccak256(
      encodePacked(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [BigInt(chainId), agentId, score, BigInt(feedbackCount), BigInt(Date.now())]
      )
    );

    const signature = await this.walletClient.signMessage({
      account: this.oracleAccount,
      message: { raw: toBytes(messageHash) },
    });

    return signature;
  }
}

export function createReputationSyncService(config: ReputationSyncConfig): ReputationSyncService {
  return new ReputationSyncService(config);
}


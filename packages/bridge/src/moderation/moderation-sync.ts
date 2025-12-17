/**
 * Cross-Chain Moderation Sync Service
 * Synchronizes ban status and moderation actions between EVM and Solana
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
import { createLogger } from '../utils/logger.js';

const log = createLogger('moderation-sync');

const BAN_MANAGER_ABI = parseAbi([
  'function isBanned(uint256 agentId) view returns (bool)',
  'function getBanReason(uint256 agentId) view returns (string)',
  'function getBanExpiry(uint256 agentId) view returns (uint256)',
  'function banAgent(uint256 agentId, string reason, uint256 duration) external',
  'function unbanAgent(uint256 agentId) external',
  'function syncExternalBan(uint256 agentId, uint256 sourceChainId, string reason, uint256 expiry, bytes proof) external',
  'event AgentBanned(uint256 indexed agentId, string reason, uint256 expiry)',
  'event AgentUnbanned(uint256 indexed agentId)',
  'event BanSynced(uint256 indexed agentId, uint256 indexed sourceChainId)',
]);

const REPORTING_SYSTEM_ABI = parseAbi([
  'function getReportCount(uint256 agentId) view returns (uint256)',
  'function getReports(uint256 agentId) view returns (tuple(uint256 reportId, address reporter, uint256 agentId, uint8 category, string reason, uint256 timestamp, uint8 status)[])',
  'function submitReport(uint256 agentId, uint8 category, string reason) external',
  'event ReportSubmitted(uint256 indexed reportId, uint256 indexed agentId, address indexed reporter)',
]);

const FEDERATED_IDENTITY_ABI = parseAbi([
  'function deactivateAgent(bytes32 federatedId) external',
  'function getFederatedIdByOrigin(uint256 chainId, uint256 agentId) view returns (bytes32)',
]);

const SOLANA_CHAIN_ID = 101;
const SOLANA_DEVNET_CHAIN_ID = 102;

export interface ModerationSyncConfig {
  evmRpcUrl: string;
  evmChainId: number;
  banManagerAddress: Address;
  reportingSystemAddress: Address;
  federatedIdentityAddress: Address;
  privateKey: Hex;
  solanaRpcUrl: string;
  solanaKeypair?: Uint8Array;
  oraclePrivateKey?: Hex;
}

export interface BanStatus {
  isBanned: boolean;
  reason: string;
  expiry: bigint;
}

export interface Report {
  reportId: bigint;
  reporter: Address;
  agentId: bigint;
  category: number;
  reason: string;
  timestamp: bigint;
  status: number;
}

export interface CrossChainBanStatus {
  federatedId: Hex;
  evmAgentId: bigint | null;
  evmBanned: boolean;
  evmBanReason: string | null;
  evmBanExpiry: bigint | null;
  solanaAgentId: bigint | null;
  solanaBanned: boolean;
  solanaBanReason: string | null;
  effectiveBan: boolean;
}

export interface ModerationSyncResult {
  success: boolean;
  txHash?: Hex | string;
  sourceChain: number;
  destChain: number;
  agentId: bigint;
  action: 'ban' | 'unban' | 'report';
}

export enum ReportCategory {
  SPAM = 0,
  ABUSE = 1,
  FRAUD = 2,
  IMPERSONATION = 3,
  ILLEGAL_CONTENT = 4,
  OTHER = 5,
}

export enum ReportStatus {
  PENDING = 0,
  RESOLVED_BAN = 1,
  RESOLVED_WARNING = 2,
  DISMISSED = 3,
}

export class ModerationSyncService extends EventEmitter {
  private config: ModerationSyncConfig;
  private account: PrivateKeyAccount;
  private oracleAccount: PrivateKeyAccount | null = null;
  private publicClient: ReturnType<typeof createPublicClient>;
  private walletClient: ReturnType<typeof createWalletClient>;
  private solanaConnection: Connection;
  private solanaKeypair: Keypair | null = null;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: ModerationSyncConfig) {
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
   * Get ban status on EVM
   */
  async getEVMBanStatus(agentId: bigint): Promise<BanStatus> {
    const [isBanned, reason, expiry] = await Promise.all([
      this.publicClient.readContract({
        address: this.config.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'isBanned',
        args: [agentId],
      }) as Promise<boolean>,
      this.publicClient.readContract({
        address: this.config.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'getBanReason',
        args: [agentId],
      }) as Promise<string>,
      this.publicClient.readContract({
        address: this.config.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'getBanExpiry',
        args: [agentId],
      }) as Promise<bigint>,
    ]);

    return { isBanned, reason, expiry };
  }

  /**
   * Get ban status on Solana (via agent metadata)
   */
  async getSolanaBanStatus(agentId: bigint): Promise<BanStatus> {
    // On Solana, ban status would be stored in agent metadata
    // Check for "banned" metadata key
    const idBuffer = Buffer.alloc(8);
    idBuffer.writeBigUInt64LE(agentId);

    // Compute key hash for "banned" metadata
    const keyHash = Buffer.alloc(8);
    const fullHash = keccak256(toBytes('banned'));
    Buffer.from(fullHash.slice(2, 18), 'hex').copy(keyHash);

    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent_meta'), idBuffer, keyHash],
      new PublicKey('HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp')
    );

    const accountInfo = await this.solanaConnection.getAccountInfo(metadataPda);
    if (!accountInfo) {
      return { isBanned: false, reason: '', expiry: 0n };
    }

    // Parse metadata value (JSON encoded ban info)
    const data = accountInfo.data;
    let offset = 8 + 8 + 4 + 32; // Skip discriminator, agent_id, key length, key

    const valueLen = data.readUInt32LE(offset);
    offset += 4;
    const valueBytes = data.slice(offset, offset + valueLen);

    const banInfo = JSON.parse(valueBytes.toString('utf8'));

    return {
      isBanned: banInfo.banned === true,
      reason: banInfo.reason || '',
      expiry: BigInt(banInfo.expiry || 0),
    };
  }

  /**
   * Get aggregated cross-chain ban status
   */
  async getCrossChainBanStatus(
    evmAgentId?: bigint,
    solanaAgentId?: bigint
  ): Promise<CrossChainBanStatus> {
    let evmBan: BanStatus | null = null;
    let solanaBan: BanStatus | null = null;
    let federatedId: Hex = '0x' as Hex;

    if (evmAgentId !== undefined) {
      evmBan = await this.getEVMBanStatus(evmAgentId);
      federatedId = await this.publicClient.readContract({
        address: this.config.federatedIdentityAddress,
        abi: FEDERATED_IDENTITY_ABI,
        functionName: 'getFederatedIdByOrigin',
        args: [BigInt(this.config.evmChainId), evmAgentId],
      }) as Hex;
    }

    if (solanaAgentId !== undefined) {
      solanaBan = await this.getSolanaBanStatus(solanaAgentId);
      if (!federatedId || federatedId === '0x') {
        const isDevnet = this.config.solanaRpcUrl.includes('devnet');
        const chainId = isDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;
        federatedId = keccak256(encodePacked(['string', 'uint256', 'string', 'uint256'], ['jeju:federated:', BigInt(chainId), ':', solanaAgentId]));
      }
    }

    // Effective ban: banned on ANY chain
    const effectiveBan = (evmBan?.isBanned ?? false) || (solanaBan?.isBanned ?? false);

    return {
      federatedId,
      evmAgentId: evmAgentId ?? null,
      evmBanned: evmBan?.isBanned ?? false,
      evmBanReason: evmBan?.reason || null,
      evmBanExpiry: evmBan?.expiry ?? null,
      solanaAgentId: solanaAgentId ?? null,
      solanaBanned: solanaBan?.isBanned ?? false,
      solanaBanReason: solanaBan?.reason || null,
      effectiveBan,
    };
  }

  /**
   * Sync ban from Solana to EVM
   */
  async syncSolanaBanToEVM(
    solanaAgentId: bigint,
    evmAgentId: bigint
  ): Promise<ModerationSyncResult> {
    const solanaBan = await this.getSolanaBanStatus(solanaAgentId);
    if (!solanaBan.isBanned) {
      return {
        success: false,
        sourceChain: this.config.solanaRpcUrl.includes('devnet') ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID,
        destChain: this.config.evmChainId,
        agentId: solanaAgentId,
        action: 'ban',
      };
    }

    const proof = await this.generateBanProof(
      solanaAgentId,
      solanaBan.reason,
      solanaBan.expiry
    );

    const sourceChainId = this.config.solanaRpcUrl.includes('devnet') ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;

    const hash = await this.walletClient.writeContract({
      address: this.config.banManagerAddress,
      abi: BAN_MANAGER_ABI,
      functionName: 'syncExternalBan',
      args: [
        evmAgentId,
        BigInt(sourceChainId),
        solanaBan.reason,
        solanaBan.expiry,
        proof,
      ],
      account: this.account,
      chain: null,
    });

    this.emit('banSynced', {
      sourceChain: sourceChainId,
      destChain: this.config.evmChainId,
      agentId: solanaAgentId,
      reason: solanaBan.reason,
    });

    return {
      success: true,
      txHash: hash,
      sourceChain: sourceChainId,
      destChain: this.config.evmChainId,
      agentId: solanaAgentId,
      action: 'ban',
    };
  }

  /**
   * Sync ban from EVM to Solana
   */
  async syncEVMBanToSolana(
    evmAgentId: bigint,
    solanaAgentId: bigint
  ): Promise<ModerationSyncResult> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair not configured');
    }

    const evmBan = await this.getEVMBanStatus(evmAgentId);
    if (!evmBan.isBanned) {
      return {
        success: false,
        sourceChain: this.config.evmChainId,
        destChain: this.config.solanaRpcUrl.includes('devnet') ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID,
        agentId: evmAgentId,
        action: 'ban',
      };
    }

    // Set ban metadata on Solana agent
    const idBuffer = Buffer.alloc(8);
    idBuffer.writeBigUInt64LE(solanaAgentId);

    // Compute key hash for "banned"
    const keyHash = Buffer.alloc(8);
    const fullHash = keccak256(toBytes('banned'));
    Buffer.from(fullHash.slice(2, 18), 'hex').copy(keyHash);

    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent_meta'), idBuffer, keyHash],
      new PublicKey('HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp')
    );

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), idBuffer],
      new PublicKey('HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp')
    );

    // Build set_metadata_pda instruction
    const banValue = JSON.stringify({
      banned: true,
      reason: evmBan.reason,
      expiry: evmBan.expiry.toString(),
      sourceChain: this.config.evmChainId,
    });

    const key = 'banned';
    const instructionData = Buffer.alloc(1 + 8 + 4 + key.length + 4 + banValue.length + 1);
    let offset = 0;

    instructionData.writeUInt8(0x03, offset); // set_metadata_pda discriminator
    offset += 1;

    keyHash.copy(instructionData, offset);
    offset += 8;

    instructionData.writeUInt32LE(key.length, offset);
    offset += 4;
    instructionData.write(key, offset);
    offset += key.length;

    instructionData.writeUInt32LE(banValue.length, offset);
    offset += 4;
    instructionData.write(banValue, offset);
    offset += banValue.length;

    instructionData.writeUInt8(0, offset); // immutable = false

    const instruction = new TransactionInstruction({
      programId: new PublicKey('HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp'),
      keys: [
        { pubkey: this.solanaKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: agentPda, isSigner: false, isWritable: false },
        { pubkey: metadataPda, isSigner: false, isWritable: true },
        { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(
      this.solanaConnection,
      transaction,
      [this.solanaKeypair]
    );

    const destChainId = this.config.solanaRpcUrl.includes('devnet') ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;

    this.emit('banSynced', {
      sourceChain: this.config.evmChainId,
      destChain: destChainId,
      agentId: evmAgentId,
      reason: evmBan.reason,
    });

    return {
      success: true,
      txHash: signature,
      sourceChain: this.config.evmChainId,
      destChain: destChainId,
      agentId: evmAgentId,
      action: 'ban',
    };
  }

  /**
   * Deactivate federated identity when banned on any chain
   */
  async deactivateFederatedIdentity(federatedId: Hex): Promise<Hex> {
    return await this.walletClient.writeContract({
      address: this.config.federatedIdentityAddress,
      abi: FEDERATED_IDENTITY_ABI,
      functionName: 'deactivateAgent',
      args: [federatedId],
      account: this.account,
      chain: null,
    });
  }

  /**
   * Get reports for an agent on EVM
   */
  async getEVMReports(agentId: bigint): Promise<Report[]> {
    const reports = await this.publicClient.readContract({
      address: this.config.reportingSystemAddress,
      abi: REPORTING_SYSTEM_ABI,
      functionName: 'getReports',
      args: [agentId],
    }) as [bigint, Address, bigint, number, string, bigint, number][];

    return reports.map(r => ({
      reportId: r[0],
      reporter: r[1],
      agentId: r[2],
      category: r[3],
      reason: r[4],
      timestamp: r[5],
      status: r[6],
    }));
  }

  /**
   * Submit cross-chain report
   */
  async submitCrossChainReport(
    agentId: bigint,
    category: ReportCategory,
    reason: string
  ): Promise<Hex> {
    return await this.walletClient.writeContract({
      address: this.config.reportingSystemAddress,
      abi: REPORTING_SYSTEM_ABI,
      functionName: 'submitReport',
      args: [agentId, category, reason],
      account: this.account,
      chain: null,
    });
  }

  /**
   * Start automatic moderation sync
   */
  startAutoSync(intervalMs: number = 60000): void {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(async () => {
      await this.runSyncCycle();
    }, intervalMs);

    log.info('Auto-sync started', { intervalMs });
  }

  /**
   * Stop automatic moderation sync
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      log.info('Auto-sync stopped');
    }
  }

  /**
   * Run sync cycle
   */
  async runSyncCycle(): Promise<void> {
    this.emit('syncCycleStarted', { timestamp: Date.now() });
    // Would iterate over federated identities and check for ban status changes
    this.emit('syncCycleCompleted', { timestamp: Date.now() });
  }

  // ============ Private Methods ============

  private async generateBanProof(
    agentId: bigint,
    reason: string,
    expiry: bigint
  ): Promise<Hex> {
    if (!this.oracleAccount) {
      throw new Error('Oracle account not configured');
    }

    const isDevnet = this.config.solanaRpcUrl.includes('devnet');
    const chainId = isDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;

    const messageHash = keccak256(
      encodePacked(
        ['uint256', 'uint256', 'string', 'uint256', 'uint256'],
        [BigInt(chainId), agentId, reason, expiry, BigInt(Date.now())]
      )
    );

    const signature = await this.walletClient.signMessage({
      account: this.oracleAccount,
      message: { raw: toBytes(messageHash) },
    });

    return signature;
  }
}

export function createModerationSyncService(config: ModerationSyncConfig): ModerationSyncService {
  return new ModerationSyncService(config);
}


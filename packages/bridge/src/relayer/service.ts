/**
 * Cross-Chain Relayer Service - orchestrates bridge flow between Solana and EVM
 */

import { cors } from '@elysiajs/cors';
import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Elysia } from 'elysia';
import { createEVMClient } from '../clients/evm-client.js';
import { createSolanaClient } from '../clients/solana-client.js';
import { createTEEBatcher } from '../tee/batcher.js';
import type {
  ChainId,
  CrossChainTransfer,
  EthereumStateCommitment,
  Hash32,
  SolanaStateCommitment,
  SP1Proof,
} from '../types/index.js';
import { TransferStatus, toHash32 } from '../types/index.js';

export interface RelayerConfig {
  port: number;
  evmChains: EVMChainConfig[];
  solanaConfig: SolanaChainConfig;
  proverEndpoint: string;
  teeEndpoint: string;
  batchSize: number;
  batchTimeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
}

export interface EVMChainConfig {
  chainId: ChainId;
  rpcUrl: string;
  bridgeAddress: string;
  lightClientAddress: string;
  privateKey: string;
}

export interface SolanaChainConfig {
  rpcUrl: string;
  bridgeProgramId: string;
  evmLightClientProgramId: string;
  keypairPath: string;
}

interface ConsensusSnapshot {
  slot: bigint;
  bankHash: Uint8Array;
  parentHash: Uint8Array;
  blockTime: number;
  votes: ValidatorVote[];
  transactionsRoot: Uint8Array;
}

interface ValidatorVote {
  validator: Uint8Array;
  voteAccount: Uint8Array;
  slot: bigint;
  hash: Uint8Array;
  signature: Uint8Array;
  timestamp: number;
}

interface EthereumUpdate {
  slot: bigint;
  blockRoot: Uint8Array;
  stateRoot: Uint8Array;
  executionStateRoot: Uint8Array;
  executionBlockNumber: bigint;
  executionBlockHash: Uint8Array;
}

interface PendingTransfer {
  transfer: CrossChainTransfer;
  sourceCommitment: SolanaStateCommitment | EthereumStateCommitment | null;
  receivedAt: number;
  attempts: number;
  status: (typeof TransferStatus)[keyof typeof TransferStatus];
  error: string | null;
}

interface RelayerStats {
  uptime: number;
  transfersProcessed: number;
  transfersFailed: number;
  proofsGenerated: number;
  lastSolanaSlot: bigint;
  lastEthereumSlot: bigint;
  pendingTransfers: number;
  pendingBatches: number;
}

// =============================================================================
// RELAYER SERVICE
// =============================================================================

export class RelayerService {
  private config: RelayerConfig;
  private app: Elysia;
  private batcher: ReturnType<typeof createTEEBatcher>;
  private evmClients: Map<ChainId, ReturnType<typeof createEVMClient>> =
    new Map();
  private solanaClient: ReturnType<typeof createSolanaClient> | null = null;

  // State
  private pendingTransfers: Map<string, PendingTransfer> = new Map();
  private solanaCommitments: Map<string, SolanaStateCommitment> = new Map();
  private ethereumCommitments: Map<string, EthereumStateCommitment> = new Map();
  private lastSolanaSlot = BigInt(0);
  private lastEthereumSlot = BigInt(0);
  private startTime = Date.now();
  private stats = {
    transfersProcessed: 0,
    transfersFailed: 0,
    proofsGenerated: 0,
    lightClientUpdates: 0,
  };

  constructor(config: RelayerConfig) {
    this.config = config;

    this.batcher = createTEEBatcher({
      maxBatchSize: config.batchSize,
      maxBatchWaitMs: config.batchTimeoutMs,
      minBatchSize: 1,
      targetCostPerItem: BigInt(1000000000000000),
      teeEndpoint: config.teeEndpoint,
    });

    this.app = new Elysia().use(cors()) as Elysia;
    this.setupRoutes();
  }

  async start(): Promise<void> {
    console.log('[Relayer] Starting...');

    await this.batcher.initialize();

    for (const chainConfig of this.config.evmChains) {
      const client = createEVMClient({
        chainId: chainConfig.chainId,
        rpcUrl: chainConfig.rpcUrl,
        privateKey: chainConfig.privateKey as `0x${string}`,
        bridgeAddress: chainConfig.bridgeAddress as `0x${string}`,
        lightClientAddress: chainConfig.lightClientAddress as `0x${string}`,
      });
      this.evmClients.set(chainConfig.chainId, client);
      console.log(`[Relayer] EVM client for chain ${chainConfig.chainId}`);
    }

    const keypair = await this.loadSolanaKeypair();
    this.solanaClient = createSolanaClient({
      rpcUrl: this.config.solanaConfig.rpcUrl,
      commitment: 'confirmed',
      keypair,
      bridgeProgramId: new PublicKey(this.config.solanaConfig.bridgeProgramId),
      evmLightClientProgramId: new PublicKey(
        this.config.solanaConfig.evmLightClientProgramId
      ),
    });
    console.log('[Relayer] Solana client ready');

    this.startProcessingLoop();
    this.app.listen(this.config.port);
    console.log(`[Relayer] Listening on port ${this.config.port}`);
  }

  stop(): void {
    console.log('[Relayer] Stopping...');
    this.app.stop();
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', () => ({
      status: 'ok',
      uptime: Date.now() - this.startTime,
    }));

    // Stats endpoint
    this.app.get('/stats', () => this.getStats());

    // Solana consensus snapshot from Geyser plugin
    this.app.post('/consensus', async ({ body }) => {
      const snapshot = body as ConsensusSnapshot;
      await this.handleSolanaConsensus(snapshot);
      return { status: 'accepted' };
    });

    // Solana bridge transfer from Geyser plugin
    this.app.post('/transfer', async ({ body }) => {
      const transfer = body as CrossChainTransfer;
      await this.handleIncomingTransfer(transfer, 'solana');
      return { status: 'accepted' };
    });

    // Ethereum finality update from beacon watcher
    this.app.post('/ethereum/finality', async ({ body }) => {
      const update = body as EthereumUpdate;
      await this.handleEthereumFinality(update);
      return { status: 'accepted' };
    });

    // Ethereum sync committee update
    this.app.post('/ethereum/sync-committee', async () => {
      console.log('[Relayer] Received sync committee update');
      return { status: 'accepted' };
    });

    // Ethereum light client update
    this.app.post('/ethereum/update', async () => {
      console.log('[Relayer] Received Ethereum light client update');
      return { status: 'accepted' };
    });

    // Manual transfer submission
    this.app.post('/submit-transfer', async ({ body }) => {
      const transfer = body as CrossChainTransfer & {
        source: 'evm' | 'solana';
      };
      await this.handleIncomingTransfer(transfer, transfer.source);
      return {
        status: 'accepted',
        transferId: this.hashToHex(transfer.transferId),
      };
    });

    // Get transfer status
    this.app.get('/transfer/:id', ({ params }) => {
      const pending = this.pendingTransfers.get(params.id);
      if (!pending) {
        return { error: 'Transfer not found' };
      }
      return {
        transferId: params.id,
        status: pending.status,
        attempts: pending.attempts,
        error: pending.error,
      };
    });
  }

  private async handleSolanaConsensus(
    snapshot: ConsensusSnapshot
  ): Promise<void> {
    console.log(`[Relayer] Received Solana consensus at slot ${snapshot.slot}`);

    if (snapshot.slot <= this.lastSolanaSlot) {
      return; // Already processed
    }

    // Store for later proof generation
    const commitment: SolanaStateCommitment = {
      slot: snapshot.slot,
      bankHash: toHash32(new Uint8Array(snapshot.bankHash)),
      epochStakes: toHash32(new Uint8Array(32)), // Would extract from snapshot
      proof: null as unknown as SP1Proof, // Will be generated
      provenAt: BigInt(0),
    };

    this.solanaCommitments.set(snapshot.slot.toString(), commitment);
    this.lastSolanaSlot = snapshot.slot;

    // Update EVM light clients
    await this.updateEVMLightClients(snapshot);
  }

  private async handleEthereumFinality(update: EthereumUpdate): Promise<void> {
    console.log(`[Relayer] Received Ethereum finality at slot ${update.slot}`);

    if (update.slot <= this.lastEthereumSlot) {
      return;
    }

    // Store for later proof generation
    const commitment: EthereumStateCommitment = {
      slot: update.slot,
      beaconBlockRoot: toHash32(new Uint8Array(update.blockRoot)),
      executionStateRoot: toHash32(new Uint8Array(update.executionStateRoot)),
      proof: null as unknown as SP1Proof,
      provenAt: BigInt(0),
    };

    this.ethereumCommitments.set(update.slot.toString(), commitment);
    this.lastEthereumSlot = update.slot;

    // Update Solana light client
    await this.updateSolanaLightClient(update);
  }

  private async handleIncomingTransfer(
    transfer: CrossChainTransfer,
    source: 'evm' | 'solana'
  ): Promise<void> {
    const transferId = this.hashToHex(transfer.transferId);
    console.log(`[Relayer] Received transfer ${transferId} from ${source}`);

    // Get source commitment
    let sourceCommitment:
      | SolanaStateCommitment
      | EthereumStateCommitment
      | null = null;

    if (source === 'solana') {
      sourceCommitment =
        this.solanaCommitments.get(this.lastSolanaSlot.toString()) ?? null;
    } else {
      sourceCommitment =
        this.ethereumCommitments.get(this.lastEthereumSlot.toString()) ?? null;
    }

    // Store pending transfer
    this.pendingTransfers.set(transferId, {
      transfer,
      sourceCommitment,
      receivedAt: Date.now(),
      attempts: 0,
      status: TransferStatus.PENDING,
      error: null,
    });

    // Add to TEE batch
    await this.batcher.addTransfer(transfer);
  }

  private async updateEVMLightClients(
    snapshot: ConsensusSnapshot
  ): Promise<void> {
    // Generate proof for this consensus
    const proof = await this.generateSolanaConsensusProof(snapshot);
    if (!proof) {
      console.error('[Relayer] Failed to generate Solana consensus proof');
      return;
    }

    // Submit to each EVM chain
    for (const [chainId, client] of this.evmClients) {
      try {
        const txHash = await client.updateLightClient({
          slot: snapshot.slot,
          bankHash:
            `0x${Buffer.from(snapshot.bankHash).toString('hex')}` as `0x${string}`,
          epochStakesRoot:
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          proof: proof.map((p) => BigInt(p)),
          publicInputs: [],
        });
        console.log(
          `[Relayer] Updated light client on chain ${chainId}: ${txHash}`
        );
      } catch (error) {
        console.error(
          `[Relayer] Failed to update light client on chain ${chainId}:`,
          error
        );
      }
    }
  }

  private async updateSolanaLightClient(
    update: EthereumUpdate
  ): Promise<void> {
    if (!this.solanaClient) {
      console.error('[Relayer] Solana client not initialized');
      return;
    }

    try {
      // Generate ZK proof of Ethereum consensus using SP1 prover
      const proof = await this.generateSP1ProofForEthereumUpdate(update);
      if (!proof) {
        console.error('[Relayer] Failed to generate Ethereum consensus proof');
        return;
      }

      // Encode public inputs for the light client update
      const publicInputs = this.encodeEthereumUpdateInputs(update);

      // Build the update instruction
      const instruction = this.buildEvmLightClientUpdateInstruction(
        update,
        proof,
        publicInputs
      );

      // Submit to Solana
      const payer = this.solanaClient.getPublicKey();
      
      if (!payer) {
        console.error('[Relayer] No keypair configured for Solana');
        return;
      }

      const tx = new Transaction().add(instruction);
      // In production, sign and send: await sendAndConfirmTransaction(connection, tx, [keypair])
      console.log('[Relayer] Submitting EVM light client update to Solana');
      console.log(`  Slot: ${update.slot}`);
      console.log(`  Block: ${update.executionBlockNumber}`);
      console.log(`  Transaction: ${tx.serialize().length} bytes`);
      
      this.stats.lightClientUpdates++;
    } catch (error) {
      console.error('[Relayer] Failed to update Solana EVM light client:', error);
    }
  }

  private async generateSP1ProofForEthereumUpdate(
    update: EthereumUpdate
  ): Promise<SP1Proof | null> {
    try {
      const response = await fetch(`${this.config.proverEndpoint}/prove/ethereum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot: update.slot.toString(),
          blockRoot: Array.from(update.blockRoot),
          stateRoot: Array.from(update.stateRoot),
          executionBlockNumber: update.executionBlockNumber.toString(),
          executionBlockHash: Array.from(update.executionBlockHash),
        }),
      });

      if (!response.ok) {
        console.error('[Relayer] Prover returned error:', response.status);
        return null;
      }

      const result = (await response.json()) as SP1Proof;
      this.stats.proofsGenerated++;
      return result;
    } catch (error) {
      console.error('[Relayer] Failed to generate Ethereum consensus proof:', error);
      return null;
    }
  }

  private encodeEthereumUpdateInputs(update: EthereumUpdate): Uint8Array {
    const buffer = new Uint8Array(80);
    const view = new DataView(buffer.buffer);
    
    view.setBigUint64(0, update.slot, true);
    buffer.set(update.blockRoot, 8);
    buffer.set(update.stateRoot, 40);
    view.setBigUint64(72, update.executionBlockNumber, true);
    
    return buffer;
  }

  private buildEvmLightClientUpdateInstruction(
    update: EthereumUpdate,
    proof: SP1Proof,
    publicInputs: Uint8Array
  ): TransactionInstruction {
    const discriminator = Buffer.from([0x1a, 0x3b, 0x5c, 0x7d, 0x9e, 0xaf, 0xc0, 0xd1]);
    
    const slotBuffer = Buffer.alloc(8);
    slotBuffer.writeBigUInt64LE(update.slot);
    
    const blockBuffer = Buffer.alloc(8);
    blockBuffer.writeBigUInt64LE(update.executionBlockNumber);
    
    const proofLenBuffer = Buffer.alloc(4);
    proofLenBuffer.writeUInt32LE(proof.proof.length);
    
    const inputsLenBuffer = Buffer.alloc(4);
    inputsLenBuffer.writeUInt32LE(publicInputs.length);
    
    const data = Buffer.concat([
      discriminator,
      slotBuffer,
      Buffer.from(update.blockRoot),
      Buffer.from(update.stateRoot),
      blockBuffer,
      proofLenBuffer,
      Buffer.from(proof.proof),
      inputsLenBuffer,
      Buffer.from(publicInputs),
    ]);

    const evmLightClientProgramId = new PublicKey(this.config.solanaConfig.evmLightClientProgramId);
    const [lightClientState] = PublicKey.findProgramAddressSync(
      [Buffer.from('light_client_state')],
      evmLightClientProgramId
    );

    return new TransactionInstruction({
      programId: evmLightClientProgramId,
      keys: [
        { pubkey: lightClientState, isSigner: false, isWritable: true },
        { pubkey: this.solanaClient!.getPublicKey()!, isSigner: true, isWritable: true },
      ],
      data,
    });
  }

  private async generateSolanaConsensusProof(
    _snapshot: ConsensusSnapshot
  ): Promise<number[] | null> {
    try {
      // Call prover service
      const response = await fetch(`${this.config.proverEndpoint}/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'solana_consensus',
          inputs: _snapshot,
        }),
      });

      if (!response.ok) {
        return null;
      }

      const result = (await response.json()) as { proof: number[] };
      this.stats.proofsGenerated++;
      return result.proof;
    } catch (error) {
      console.error('[Relayer] Solana consensus proof generation failed:', error);
      return null;
    }
  }

  private startProcessingLoop(): void {
    // Process pending transfers every 5 seconds
    setInterval(async () => {
      await this.processPendingTransfers();
    }, 5000);

    // Process ready batches every 10 seconds
    setInterval(async () => {
      await this.processReadyBatches();
    }, 10000);

    // Cleanup old data every minute
    setInterval(() => {
      this.cleanupOldData();
    }, 60000);
  }

  private async processPendingTransfers(): Promise<void> {
    for (const [_id, pending] of this.pendingTransfers) {
      if (pending.status !== TransferStatus.PENDING) {
        continue;
      }

      if (pending.attempts >= this.config.retryAttempts) {
        pending.status = TransferStatus.FAILED;
        pending.error = 'Max retry attempts exceeded';
        this.stats.transfersFailed++;
        continue;
      }

      pending.attempts++;
      // Would complete transfer on destination chain
    }
  }

  private async processReadyBatches(): Promise<void> {
    const batch = this.batcher.getNextBatchForProving();
    if (!batch) {
      return;
    }

    console.log(
      `[Relayer] Processing batch with ${batch.transfers.length} transfers`
    );

    // Generate batch proof
    const proof = await this.generateBatchProof(batch.transfers);
    if (!proof) {
      console.error('[Relayer] Failed to generate batch proof');
      return;
    }

    // Mark batch as proven
    const proofBatch = this.batcher.markBatchProven(
      this.hashToHex(batch.id),
      proof
    );

    // Complete transfers on destination chains
    for (const transfer of proofBatch.items) {
      await this.completeTransferOnDestination(transfer, proof);
    }
  }

  private async generateBatchProof(
    transfers: { transfer: CrossChainTransfer }[]
  ): Promise<SP1Proof | null> {
    try {
      const response = await fetch(
        `${this.config.proverEndpoint}/prove-batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'batch_transfer',
            transfers: transfers.map((t) => t.transfer),
          }),
        }
      );

      if (!response.ok) {
        return null;
      }

      const result = (await response.json()) as SP1Proof;
      this.stats.proofsGenerated++;
      return result;
    } catch (error) {
      console.error('[Relayer] Batch proof generation failed:', error);
      return null;
    }
  }

  private async completeTransferOnDestination(
    transfer: CrossChainTransfer,
    proof: SP1Proof
  ): Promise<void> {
    const txId = this.hashToHex(transfer.transferId);
    const pending = this.pendingTransfers.get(txId);

    if (!pending) {
      return;
    }

    // Determine destination and complete
    const isDestEVM =
      transfer.destChain !== 101 &&
      transfer.destChain !== 102 &&
      transfer.destChain !== 103 &&
      transfer.destChain !== 104;

    if (isDestEVM) {
      const client = this.evmClients.get(transfer.destChain as ChainId);
      if (!client) {
        throw new Error(`No EVM client for chain ${transfer.destChain}`);
      }
      
      const sourceSlot = pending.sourceCommitment && 'slot' in pending.sourceCommitment 
        ? BigInt(pending.sourceCommitment.slot)
        : BigInt(0);
      
      console.log(`[Relayer] Completing transfer ${txId} on EVM chain ${transfer.destChain}`);
      const txHash = await client.completeTransfer({
        transferId: transfer.transferId,
        token: `0x${Buffer.from(transfer.token).toString('hex').slice(-40)}` as `0x${string}`,
        sender: transfer.sender,
        recipient: `0x${Buffer.from(transfer.recipient).toString('hex').slice(-40)}` as `0x${string}`,
        amount: transfer.amount,
        slot: sourceSlot,
        proof: Array.from(proof.proof).map(b => BigInt(b)),
        publicInputs: Array.from(proof.publicInputs).map(b => BigInt(b)),
      });
      console.log(`[Relayer] EVM transfer completed: ${txHash}`);
      
      pending.status = TransferStatus.COMPLETED;
      this.stats.transfersProcessed++;
    } else if (this.solanaClient) {
      console.log(`[Relayer] Completing transfer ${txId} on Solana`);
      const sourceSlot = pending.sourceCommitment && 'slot' in pending.sourceCommitment 
        ? BigInt(pending.sourceCommitment.slot)
        : BigInt(0);
        
      const signature = await this.solanaClient.completeTransfer({
        transferId: transfer.transferId,
        mint: new PublicKey(transfer.token),
        sender: transfer.sender,
        recipient: new PublicKey(transfer.recipient),
        amount: transfer.amount,
        evmBlockNumber: sourceSlot,
        proof: proof.proof,
        publicInputs: proof.publicInputs,
      });
      console.log(`[Relayer] Solana transfer completed: ${signature}`);
      
      pending.status = TransferStatus.COMPLETED;
      this.stats.transfersProcessed++;
    } else {
      throw new Error(`No client available for destination chain ${transfer.destChain}`);
    }
  }

  private cleanupOldData(): void {
    const cutoff = Date.now() - 3600000; // 1 hour

    // Remove old completed/failed transfers
    for (const [id, pending] of this.pendingTransfers) {
      if (
        pending.receivedAt < cutoff &&
        (pending.status === TransferStatus.COMPLETED ||
          pending.status === TransferStatus.FAILED)
      ) {
        this.pendingTransfers.delete(id);
      }
    }

    // Keep only recent commitments
    const maxCommitments = 1000;
    if (this.solanaCommitments.size > maxCommitments) {
      const entries = Array.from(this.solanaCommitments.entries());
      entries.sort((a, b) => Number(a[0]) - Number(b[0]));
      for (let i = 0; i < entries.length - maxCommitments; i++) {
        this.solanaCommitments.delete(entries[i][0]);
      }
    }
  }

  private async loadSolanaKeypair(): Promise<Keypair> {
    const keypairPath = this.config.solanaConfig.keypairPath.replace(
      '~',
      process.env.HOME ?? ''
    );
    
    try {
      const keypairData = await Bun.file(keypairPath).json();
      return Keypair.fromSecretKey(new Uint8Array(keypairData));
    } catch (error) {
      // Only allow ephemeral keypair in local development
      if (process.env.NODE_ENV === 'development' || keypairPath.includes('localnet')) {
        console.warn(
          `[Relayer] Could not load keypair from ${keypairPath}, using ephemeral keypair for local dev`
        );
        return Keypair.generate();
      }
      throw new Error(
        `Failed to load Solana keypair from ${keypairPath}: ${error}. ` +
        `Ensure the keypair file exists and is valid JSON.`
      );
    }
  }

  private getStats(): RelayerStats {
    return {
      uptime: Date.now() - this.startTime,
      transfersProcessed: this.stats.transfersProcessed,
      transfersFailed: this.stats.transfersFailed,
      proofsGenerated: this.stats.proofsGenerated,
      lastSolanaSlot: this.lastSolanaSlot,
      lastEthereumSlot: this.lastEthereumSlot,
      pendingTransfers: this.pendingTransfers.size,
      pendingBatches: 0, // Would get from batcher
    };
  }

  private hashToHex(hash: Hash32): string {
    return Array.from(hash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createRelayerService(config: RelayerConfig): RelayerService {
  return new RelayerService(config);
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (import.meta.main) {
  const config: RelayerConfig = {
    port: parseInt(process.env.RELAYER_PORT ?? '8081'),
    evmChains: [
      {
        chainId: 31337 as ChainId,
        rpcUrl: process.env.EVM_RPC_URL ?? 'http://127.0.0.1:8545',
        bridgeAddress:
          process.env.BRIDGE_ADDRESS ??
          '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        lightClientAddress:
          process.env.LIGHT_CLIENT_ADDRESS ??
          '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
        privateKey:
          process.env.PRIVATE_KEY ??
          '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      },
    ],
    solanaConfig: {
      rpcUrl: process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899',
      bridgeProgramId:
        process.env.BRIDGE_PROGRAM_ID ??
        'TokenBridge11111111111111111111111111111111',
      evmLightClientProgramId:
        process.env.EVM_LIGHT_CLIENT_PROGRAM_ID ??
        'EVMLightClient1111111111111111111111111111',
      keypairPath: process.env.SOLANA_KEYPAIR ?? '~/.config/solana/id.json',
    },
    proverEndpoint: process.env.PROVER_ENDPOINT ?? 'http://127.0.0.1:8082',
    teeEndpoint: process.env.TEE_ENDPOINT ?? 'http://127.0.0.1:8080',
    batchSize: 10,
    batchTimeoutMs: 30000,
    retryAttempts: 3,
    retryDelayMs: 5000,
  };

  const relayer = createRelayerService(config);

  process.on('SIGINT', () => {
    relayer.stop();
    process.exit(0);
  });

  relayer.start().catch(console.error);
}

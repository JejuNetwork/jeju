/**
 * Cross-Chain Relayer Service - orchestrates bridge flow between Solana and EVM
 */

import { cors } from '@elysiajs/cors'
import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { Elysia } from 'elysia'
import { createEVMClient } from '../clients/evm-client.js'
import { createSolanaClient } from '../clients/solana-client.js'
import { createTEEBatcher } from '../tee/batcher.js'
import type {
  ChainId,
  CrossChainTransfer,
  EthereumStateCommitment,
  SolanaStateCommitment,
  SP1Proof,
} from '../types/index.js'
import { TransferStatus, toHash32 } from '../types/index.js'
import {
  BatchProofResponseSchema,
  ConsensusSnapshotSchema,
  CrossChainTransferSchema,
  createLogger,
  EthereumUpdateSchema,
  hashToHex,
  SP1ProofResponseSchema,
  TransferSubmissionSchema,
} from '../utils/index.js'

// ============ Logger ============

const log = createLogger('relayer')

// ============ Environment Validation ============

// Strict check: NODE_ENV must be exactly 'production', not empty/undefined/typo
const nodeEnv = (process.env.NODE_ENV ?? '').trim().toLowerCase()
const isProduction = nodeEnv === 'production'
const isLocalDev = nodeEnv === 'development' || nodeEnv === ''

if (isProduction) {
  log.info('Starting in PRODUCTION mode')
} else {
  log.warn('Starting in DEVELOPMENT mode - some defaults will be used', {
    nodeEnv,
  })
}

/**
 * Require an environment variable, with optional default for local dev
 */
function requireEnv(key: string, devDefault?: string): string {
  const value = process.env[key]
  if (value) return value

  if (isLocalDev && devDefault !== undefined) {
    log.warn(`Using dev default for ${key}`)
    return devDefault
  }

  throw new Error(
    `Missing required environment variable: ${key}. ` +
      `Set it in your .env file or environment.`,
  )
}

/**
 * Require a secret environment variable (no defaults allowed)
 */
function requireEnvSecret(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing required secret: ${key}. ` +
        `Secrets must be provided via environment variables - no defaults allowed.`,
    )
  }
  return value
}

export interface RelayerConfig {
  port: number
  evmChains: EVMChainConfig[]
  solanaConfig: SolanaChainConfig
  proverEndpoint: string
  teeEndpoint: string
  batchSize: number
  batchTimeoutMs: number
  retryAttempts: number
  retryDelayMs: number
}

export interface EVMChainConfig {
  chainId: ChainId
  rpcUrl: string
  bridgeAddress: string
  lightClientAddress: string
  privateKey: string
}

export interface SolanaChainConfig {
  rpcUrl: string
  bridgeProgramId: string
  evmLightClientProgramId: string
  keypairPath: string
}

interface ConsensusSnapshot {
  slot: bigint
  bankHash: Uint8Array
  parentHash: Uint8Array
  blockTime: number
  votes: ValidatorVote[]
  transactionsRoot: Uint8Array
  epoch: bigint
  epochStakesRoot: Uint8Array
}

interface ValidatorVote {
  validator: Uint8Array
  voteAccount: Uint8Array
  slot: bigint
  hash: Uint8Array
  signature: Uint8Array
  timestamp: number
}

interface EthereumUpdate {
  slot: bigint
  blockRoot: Uint8Array
  stateRoot: Uint8Array
  executionStateRoot: Uint8Array
  executionBlockNumber: bigint
  executionBlockHash: Uint8Array
}

interface PendingTransfer {
  transfer: CrossChainTransfer
  sourceCommitment: SolanaStateCommitment | EthereumStateCommitment | null
  receivedAt: number
  attempts: number
  status: (typeof TransferStatus)[keyof typeof TransferStatus]
  error: string | null
}

interface RelayerStats {
  uptime: number
  transfersProcessed: number
  transfersFailed: number
  proofsGenerated: number
  lastSolanaSlot: bigint
  lastEthereumSlot: bigint
  pendingTransfers: number
  pendingBatches: number
}

// =============================================================================
// RELAYER SERVICE
// =============================================================================

export class RelayerService {
  private config: RelayerConfig
  private app: Elysia
  private batcher: ReturnType<typeof createTEEBatcher>
  private evmClients: Map<ChainId, ReturnType<typeof createEVMClient>> =
    new Map()
  private solanaClient: ReturnType<typeof createSolanaClient> | null = null

  // State
  private pendingTransfers: Map<string, PendingTransfer> = new Map()
  private solanaCommitments: Map<string, SolanaStateCommitment> = new Map()
  private ethereumCommitments: Map<string, EthereumStateCommitment> = new Map()
  private lastSolanaSlot = BigInt(0)
  private lastEthereumSlot = BigInt(0)
  private startTime = Date.now()
  private stats = {
    transfersProcessed: 0,
    transfersFailed: 0,
    proofsGenerated: 0,
    lightClientUpdates: 0,
  }

  // Nonce tracking for replay protection - tracks per sender+chain combination
  private processedNonces: Map<string, Set<bigint>> = new Map()
  // Track processed transfer IDs to prevent double-spend
  private processedTransferIds: Set<string> = new Set()

  constructor(config: RelayerConfig) {
    this.config = config

    this.batcher = createTEEBatcher({
      maxBatchSize: config.batchSize,
      maxBatchWaitMs: config.batchTimeoutMs,
      minBatchSize: 1,
      targetCostPerItem: BigInt(1000000000000000),
      teeEndpoint: config.teeEndpoint,
    })

    this.app = new Elysia().use(cors()) as Elysia
    this.setupRoutes()
  }

  async start(): Promise<void> {
    log.info('Starting relayer service')

    await this.batcher.initialize()

    for (const chainConfig of this.config.evmChains) {
      const client = createEVMClient({
        chainId: chainConfig.chainId,
        rpcUrl: chainConfig.rpcUrl,
        privateKey: chainConfig.privateKey as `0x${string}`,
        bridgeAddress: chainConfig.bridgeAddress as `0x${string}`,
        lightClientAddress: chainConfig.lightClientAddress as `0x${string}`,
      })
      this.evmClients.set(chainConfig.chainId, client)
      log.info('EVM client initialized', { chainId: chainConfig.chainId })
    }

    const keypair = await this.loadSolanaKeypair()
    this.solanaClient = createSolanaClient({
      rpcUrl: this.config.solanaConfig.rpcUrl,
      commitment: 'confirmed',
      keypair,
      bridgeProgramId: new PublicKey(this.config.solanaConfig.bridgeProgramId),
      evmLightClientProgramId: new PublicKey(
        this.config.solanaConfig.evmLightClientProgramId,
      ),
    })
    log.info('Solana client initialized')

    this.startProcessingLoop()
    this.app.listen(this.config.port)
    log.info('Relayer listening', { port: this.config.port })
  }

  stop(): void {
    log.info('Stopping relayer')
    this.app.stop()
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', () => ({
      status: 'ok',
      uptime: Date.now() - this.startTime,
    }))

    // Stats endpoint
    this.app.get('/stats', () => this.getStats())

    // Solana consensus snapshot from Geyser plugin
    this.app.post('/consensus', async ({ body }) => {
      const parsed = ConsensusSnapshotSchema.parse(body)
      const snapshot = this.parseConsensusSnapshot(parsed)
      await this.handleSolanaConsensus(snapshot)
      return { status: 'accepted' }
    })

    // Solana bridge transfer from Geyser plugin
    this.app.post('/transfer', async ({ body }) => {
      const parsed = CrossChainTransferSchema.parse(body)
      const transfer = this.parseCrossChainTransfer(parsed)
      await this.handleIncomingTransfer(transfer, 'solana')
      return { status: 'accepted' }
    })

    // Ethereum finality update from beacon watcher
    this.app.post('/ethereum/finality', async ({ body }) => {
      const parsed = EthereumUpdateSchema.parse(body)
      const update = this.parseEthereumUpdate(parsed)
      await this.handleEthereumFinality(update)
      return { status: 'accepted' }
    })

    // Ethereum sync committee update
    this.app.post('/ethereum/sync-committee', async () => {
      log.debug('Received sync committee update')
      return { status: 'accepted' }
    })

    // Ethereum light client update
    this.app.post('/ethereum/update', async () => {
      log.debug('Received Ethereum light client update')
      return { status: 'accepted' }
    })

    // Manual transfer submission
    this.app.post('/submit-transfer', async ({ body }) => {
      const parsed = TransferSubmissionSchema.parse(body)
      const transfer = this.parseCrossChainTransfer(parsed)
      await this.handleIncomingTransfer(transfer, parsed.source)
      return {
        status: 'accepted',
        transferId: hashToHex(transfer.transferId),
      }
    })

    // Get transfer status
    this.app.get('/transfer/:id', ({ params }) => {
      const pending = this.pendingTransfers.get(params.id)
      if (!pending) {
        return { error: 'Transfer not found' }
      }
      return {
        transferId: params.id,
        status: pending.status,
        attempts: pending.attempts,
        error: pending.error,
      }
    })
  }

  // =============================================================================
  // PARSING HELPERS - Convert Zod validated data to internal types
  // =============================================================================

  private toUint8Array(data: Uint8Array | number[]): Uint8Array {
    return data instanceof Uint8Array ? data : new Uint8Array(data)
  }

  private parseConsensusSnapshot(parsed: {
    slot: bigint
    bankHash: Uint8Array | number[]
    parentHash: Uint8Array | number[]
    blockTime: number
    votes: Array<{
      validator: Uint8Array | number[]
      voteAccount: Uint8Array | number[]
      slot: bigint
      hash: Uint8Array | number[]
      signature: Uint8Array | number[]
      timestamp: number
    }>
    transactionsRoot: Uint8Array | number[]
    epoch: bigint
    epochStakesRoot: Uint8Array | number[]
  }): ConsensusSnapshot {
    return {
      slot: parsed.slot,
      bankHash: this.toUint8Array(parsed.bankHash),
      parentHash: this.toUint8Array(parsed.parentHash),
      blockTime: parsed.blockTime,
      votes: parsed.votes.map((v) => ({
        validator: this.toUint8Array(v.validator),
        voteAccount: this.toUint8Array(v.voteAccount),
        slot: v.slot,
        hash: this.toUint8Array(v.hash),
        signature: this.toUint8Array(v.signature),
        timestamp: v.timestamp,
      })),
      transactionsRoot: this.toUint8Array(parsed.transactionsRoot),
      epoch: parsed.epoch,
      epochStakesRoot: this.toUint8Array(parsed.epochStakesRoot),
    }
  }

  private parseCrossChainTransfer(parsed: {
    transferId: Uint8Array | number[]
    sourceChain: number
    destChain: number
    token: Uint8Array | number[]
    sender: Uint8Array | number[]
    recipient: Uint8Array | number[]
    amount: bigint
    nonce: bigint
    timestamp: bigint
    payload: Uint8Array | number[]
  }): CrossChainTransfer {
    return {
      transferId: toHash32(this.toUint8Array(parsed.transferId)),
      sourceChain: parsed.sourceChain as ChainId,
      destChain: parsed.destChain as ChainId,
      token: toHash32(this.toUint8Array(parsed.token)),
      sender: this.toUint8Array(parsed.sender),
      recipient: this.toUint8Array(parsed.recipient),
      amount: parsed.amount,
      nonce: parsed.nonce,
      timestamp: parsed.timestamp,
      payload: this.toUint8Array(parsed.payload),
    }
  }

  private parseEthereumUpdate(parsed: {
    slot: bigint
    blockRoot: Uint8Array | number[]
    stateRoot: Uint8Array | number[]
    executionStateRoot: Uint8Array | number[]
    executionBlockNumber: bigint
    executionBlockHash: Uint8Array | number[]
  }): EthereumUpdate {
    return {
      slot: parsed.slot,
      blockRoot: this.toUint8Array(parsed.blockRoot),
      stateRoot: this.toUint8Array(parsed.stateRoot),
      executionStateRoot: this.toUint8Array(parsed.executionStateRoot),
      executionBlockNumber: parsed.executionBlockNumber,
      executionBlockHash: this.toUint8Array(parsed.executionBlockHash),
    }
  }

  // =============================================================================
  // CONSENSUS HANDLERS
  // =============================================================================

  private async handleSolanaConsensus(
    snapshot: ConsensusSnapshot,
  ): Promise<void> {
    log.info('Received Solana consensus', { slot: snapshot.slot.toString() })

    if (snapshot.slot <= this.lastSolanaSlot) {
      return // Already processed
    }

    // Store for later proof generation
    const commitment: SolanaStateCommitment = {
      slot: snapshot.slot,
      bankHash: toHash32(new Uint8Array(snapshot.bankHash)),
      epochStakes: toHash32(new Uint8Array(snapshot.epochStakesRoot)),
      proof: null,
      provenAt: BigInt(0),
    }

    this.solanaCommitments.set(snapshot.slot.toString(), commitment)
    this.lastSolanaSlot = snapshot.slot

    // Update EVM light clients
    await this.updateEVMLightClients(snapshot)
  }

  private async handleEthereumFinality(update: EthereumUpdate): Promise<void> {
    log.info('Received Ethereum finality', { slot: update.slot.toString() })

    // SECURITY: Validate slot is not absurdly in the future (anti-DoS)
    // Ethereum has ~12s slots, so 1 hour = 300 slots ahead max
    const maxFutureSlots = 300n
    if (update.slot > this.lastEthereumSlot + maxFutureSlots) {
      log.warn('Ethereum slot too far in future - potential manipulation', {
        slot: update.slot.toString(),
        lastSlot: this.lastEthereumSlot.toString(),
      })
      return
    }

    // SECURITY: Reject slots that go backwards by more than finality depth
    // Ethereum finality is ~2 epochs = 64 slots
    const maxReorgDepth = 64n
    if (
      update.slot < this.lastEthereumSlot - maxReorgDepth &&
      this.lastEthereumSlot > maxReorgDepth
    ) {
      log.warn('Ethereum slot too far in past - ignoring', {
        slot: update.slot.toString(),
        lastSlot: this.lastEthereumSlot.toString(),
      })
      return
    }

    if (update.slot <= this.lastEthereumSlot) {
      return
    }

    // SECURITY: Validate block root is not empty
    if (update.blockRoot.every((b) => b === 0)) {
      log.warn('Empty block root received - invalid finality data')
      return
    }

    // SECURITY: Validate execution state root is not empty
    if (update.executionStateRoot.every((b) => b === 0)) {
      log.warn('Empty execution state root - invalid finality data')
      return
    }

    // Store for later proof generation
    const commitment: EthereumStateCommitment = {
      slot: update.slot,
      beaconBlockRoot: toHash32(new Uint8Array(update.blockRoot)),
      executionStateRoot: toHash32(new Uint8Array(update.executionStateRoot)),
      proof: null,
      provenAt: BigInt(0),
    }

    this.ethereumCommitments.set(update.slot.toString(), commitment)
    this.lastEthereumSlot = update.slot

    // Update Solana light client
    await this.updateSolanaLightClient(update)
  }

  private async handleIncomingTransfer(
    transfer: CrossChainTransfer,
    source: 'evm' | 'solana',
  ): Promise<void> {
    const transferId = hashToHex(transfer.transferId)
    log.info('Received transfer', { transferId, source })

    // SECURITY: Check for replay attack - prevent double-spend
    if (this.processedTransferIds.has(transferId)) {
      log.warn('Duplicate transfer ID detected - potential replay attack', {
        transferId,
      })
      throw new Error(`Transfer ${transferId} has already been processed`)
    }

    // SECURITY: Nonce replay protection - per sender+chain
    const nonceKey = `${source}-${hashToHex(toHash32(transfer.sender))}`
    let senderNonces = this.processedNonces.get(nonceKey)
    if (!senderNonces) {
      senderNonces = new Set<bigint>()
      this.processedNonces.set(nonceKey, senderNonces)
    }

    if (senderNonces.has(transfer.nonce)) {
      log.warn('Duplicate nonce detected - potential replay attack', {
        transferId,
        nonce: transfer.nonce.toString(),
        sender: nonceKey,
      })
      throw new Error(`Nonce ${transfer.nonce} already used by sender`)
    }

    // SECURITY: Validate nonce is not too far in the future (anti-DoS)
    const maxNonce = this.getMaxNonceForSender(senderNonces)
    if (transfer.nonce > maxNonce + 1000n) {
      log.warn('Nonce too far in future - potential DoS attack', {
        transferId,
        nonce: transfer.nonce.toString(),
        maxNonce: maxNonce.toString(),
      })
      throw new Error(`Nonce ${transfer.nonce} is too far in the future`)
    }

    // SECURITY: Validate transfer amount is positive
    if (transfer.amount <= 0n) {
      log.warn('Invalid transfer amount', {
        transferId,
        amount: transfer.amount.toString(),
      })
      throw new Error('Transfer amount must be positive')
    }

    // SECURITY: Validate chain IDs are valid
    if (transfer.sourceChain === transfer.destChain) {
      log.warn('Same chain transfer not allowed through bridge', { transferId })
      throw new Error('Source and destination chains must be different')
    }

    // Mark nonce and transfer ID as processed
    senderNonces.add(transfer.nonce)
    this.processedTransferIds.add(transferId)

    // Get source commitment
    let sourceCommitment:
      | SolanaStateCommitment
      | EthereumStateCommitment
      | null = null

    if (source === 'solana') {
      sourceCommitment =
        this.solanaCommitments.get(this.lastSolanaSlot.toString()) ?? null
    } else {
      sourceCommitment =
        this.ethereumCommitments.get(this.lastEthereumSlot.toString()) ?? null
    }

    // Store pending transfer
    this.pendingTransfers.set(transferId, {
      transfer,
      sourceCommitment,
      receivedAt: Date.now(),
      attempts: 0,
      status: TransferStatus.PENDING,
      error: null,
    })

    // Add to TEE batch
    await this.batcher.addTransfer(transfer)
  }

  private getMaxNonceForSender(nonces: Set<bigint>): bigint {
    let max = 0n
    for (const nonce of nonces) {
      if (nonce > max) max = nonce
    }
    return max
  }

  private async updateEVMLightClients(
    snapshot: ConsensusSnapshot,
  ): Promise<void> {
    // Generate proof for this consensus
    const proof = await this.generateSolanaConsensusProof(snapshot)
    if (!proof) {
      log.error('Failed to generate Solana consensus proof')
      return
    }

    // Submit to each EVM chain
    for (const [chainId, client] of this.evmClients) {
      try {
        const txHash = await client.updateLightClient({
          slot: snapshot.slot,
          bankHash:
            `0x${Buffer.from(snapshot.bankHash).toString('hex')}` as `0x${string}`,
          epochStakesRoot:
            `0x${Buffer.from(snapshot.epochStakesRoot).toString('hex')}` as `0x${string}`,
          proof: proof.map((p) => BigInt(p)),
          publicInputs: [],
        })
        log.info('Updated light client on EVM chain', { chainId, txHash })
      } catch (error) {
        log.error('Failed to update light client', {
          chainId,
          error: String(error),
        })
      }
    }
  }

  private async updateSolanaLightClient(update: EthereumUpdate): Promise<void> {
    if (!this.solanaClient) {
      log.error('Solana client not initialized')
      return
    }

    try {
      // Generate ZK proof of Ethereum consensus using SP1 prover
      const proof = await this.generateSP1ProofForEthereumUpdate(update)
      if (!proof) {
        log.error('Failed to generate Ethereum consensus proof')
        return
      }

      // Encode public inputs for the light client update
      const publicInputs = this.encodeEthereumUpdateInputs(update)

      // Build the update instruction
      const instruction = this.buildEvmLightClientUpdateInstruction(
        update,
        proof,
        publicInputs,
      )

      // Submit to Solana
      const payer = this.solanaClient.getPublicKey()

      if (!payer) {
        log.error('No keypair configured for Solana')
        return
      }

      const tx = new Transaction().add(instruction)
      tx.feePayer = payer

      const connection = this.solanaClient.getConnection()
      const { blockhash } = await connection.getLatestBlockhash()
      tx.recentBlockhash = blockhash

      // Sign and submit the transaction
      const keypair = this.solanaClient.getKeypair()
      if (!keypair) {
        log.error('No keypair available for signing')
        return
      }

      const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [keypair],
        { commitment: 'confirmed' },
      )

      log.info('Submitted EVM light client update to Solana', {
        slot: update.slot.toString(),
        block: update.executionBlockNumber.toString(),
        signature,
      })

      this.stats.lightClientUpdates++
    } catch (error) {
      log.error('Failed to update Solana EVM light client', {
        error: String(error),
      })
    }
  }

  private async generateSP1ProofForEthereumUpdate(
    update: EthereumUpdate,
  ): Promise<SP1Proof | null> {
    try {
      const response = await fetch(
        `${this.config.proverEndpoint}/prove/ethereum`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slot: update.slot.toString(),
            blockRoot: Array.from(update.blockRoot),
            stateRoot: Array.from(update.stateRoot),
            executionBlockNumber: update.executionBlockNumber.toString(),
            executionBlockHash: Array.from(update.executionBlockHash),
          }),
        },
      )

      if (!response.ok) {
        log.error('Prover returned error', { status: response.status })
        return null
      }

      const rawData: unknown = await response.json()
      const result = SP1ProofResponseSchema.parse(rawData)
      this.stats.proofsGenerated++
      // Convert JSON response to SP1Proof type
      return {
        proof:
          result.proof instanceof Uint8Array
            ? result.proof
            : new Uint8Array(result.proof),
        publicInputs: result.publicInputs
          ? result.publicInputs instanceof Uint8Array
            ? result.publicInputs
            : new Uint8Array(result.publicInputs)
          : new Uint8Array(0),
        vkeyHash: toHash32(new Uint8Array(32)), // Would be parsed from result.vkeyHash if provided
      }
    } catch (error) {
      log.error('Failed to generate Ethereum consensus proof', {
        error: String(error),
      })
      return null
    }
  }

  private encodeEthereumUpdateInputs(update: EthereumUpdate): Uint8Array {
    const buffer = new Uint8Array(80)
    const view = new DataView(buffer.buffer)

    view.setBigUint64(0, update.slot, true)
    buffer.set(update.blockRoot, 8)
    buffer.set(update.stateRoot, 40)
    view.setBigUint64(72, update.executionBlockNumber, true)

    return buffer
  }

  private buildEvmLightClientUpdateInstruction(
    update: EthereumUpdate,
    proof: SP1Proof,
    publicInputs: Uint8Array,
  ): TransactionInstruction {
    const discriminator = Buffer.from([
      0x1a, 0x3b, 0x5c, 0x7d, 0x9e, 0xaf, 0xc0, 0xd1,
    ])

    const slotBuffer = Buffer.alloc(8)
    slotBuffer.writeBigUInt64LE(update.slot)

    const blockBuffer = Buffer.alloc(8)
    blockBuffer.writeBigUInt64LE(update.executionBlockNumber)

    const proofLenBuffer = Buffer.alloc(4)
    proofLenBuffer.writeUInt32LE(proof.proof.length)

    const inputsLenBuffer = Buffer.alloc(4)
    inputsLenBuffer.writeUInt32LE(publicInputs.length)

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
    ])

    const evmLightClientProgramId = new PublicKey(
      this.config.solanaConfig.evmLightClientProgramId,
    )
    const [lightClientState] = PublicKey.findProgramAddressSync(
      [Buffer.from('light_client_state')],
      evmLightClientProgramId,
    )

    const payerPubkey = this.solanaClient?.getPublicKey()
    if (!payerPubkey) {
      throw new Error('Solana client not initialized or no keypair')
    }

    return new TransactionInstruction({
      programId: evmLightClientProgramId,
      keys: [
        { pubkey: lightClientState, isSigner: false, isWritable: true },
        {
          pubkey: payerPubkey,
          isSigner: true,
          isWritable: true,
        },
      ],
      data,
    })
  }

  private async generateSolanaConsensusProof(
    _snapshot: ConsensusSnapshot,
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
      })

      if (!response.ok) {
        return null
      }

      const rawData: unknown = await response.json()
      const result = BatchProofResponseSchema.parse(rawData)
      this.stats.proofsGenerated++
      return result.proof
    } catch (error) {
      log.error('Solana consensus proof generation failed', {
        error: String(error),
      })
      return null
    }
  }

  private startProcessingLoop(): void {
    // Process pending transfers every 5 seconds
    setInterval(async () => {
      await this.processPendingTransfers()
    }, 5000)

    // Process ready batches every 10 seconds
    setInterval(async () => {
      await this.processReadyBatches()
    }, 10000)

    // Cleanup old data every minute
    setInterval(() => {
      this.cleanupOldData()
    }, 60000)
  }

  private async processPendingTransfers(): Promise<void> {
    for (const [_id, pending] of this.pendingTransfers) {
      if (pending.status !== TransferStatus.PENDING) {
        continue
      }

      if (pending.attempts >= this.config.retryAttempts) {
        pending.status = TransferStatus.FAILED
        pending.error = 'Max retry attempts exceeded'
        this.stats.transfersFailed++
        continue
      }

      pending.attempts++
      // Would complete transfer on destination chain
    }
  }

  private async processReadyBatches(): Promise<void> {
    const batch = this.batcher.getNextBatchForProving()
    if (!batch) {
      return
    }

    log.info('Processing batch', { transferCount: batch.transfers.length })

    // Generate batch proof
    const proof = await this.generateBatchProof(batch.transfers)
    if (!proof) {
      log.error('Failed to generate batch proof')
      return
    }

    // Mark batch as proven
    const proofBatch = this.batcher.markBatchProven(hashToHex(batch.id), proof)

    // Complete transfers on destination chains
    for (const transfer of proofBatch.items) {
      await this.completeTransferOnDestination(transfer, proof)
    }
  }

  private async generateBatchProof(
    transfers: { transfer: CrossChainTransfer }[],
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
        },
      )

      if (!response.ok) {
        return null
      }

      const rawData: unknown = await response.json()
      const result = SP1ProofResponseSchema.parse(rawData)
      this.stats.proofsGenerated++
      // Convert JSON response to SP1Proof type
      return {
        proof:
          result.proof instanceof Uint8Array
            ? result.proof
            : new Uint8Array(result.proof),
        publicInputs: result.publicInputs
          ? result.publicInputs instanceof Uint8Array
            ? result.publicInputs
            : new Uint8Array(result.publicInputs)
          : new Uint8Array(0),
        vkeyHash: toHash32(new Uint8Array(32)),
      }
    } catch (error) {
      log.error('Batch proof generation failed', { error: String(error) })
      return null
    }
  }

  private async completeTransferOnDestination(
    transfer: CrossChainTransfer,
    proof: SP1Proof,
  ): Promise<void> {
    const txId = hashToHex(transfer.transferId)
    const pending = this.pendingTransfers.get(txId)

    if (!pending) {
      return
    }

    // Determine destination and complete
    const isDestEVM =
      transfer.destChain !== 101 &&
      transfer.destChain !== 102 &&
      transfer.destChain !== 103 &&
      transfer.destChain !== 104

    if (isDestEVM) {
      const client = this.evmClients.get(transfer.destChain as ChainId)
      if (!client) {
        throw new Error(`No EVM client for chain ${transfer.destChain}`)
      }

      const sourceSlot =
        pending.sourceCommitment && 'slot' in pending.sourceCommitment
          ? BigInt(pending.sourceCommitment.slot)
          : BigInt(0)

      log.info('Completing transfer on EVM chain', {
        txId,
        chainId: transfer.destChain,
      })
      const txHash = await client.completeTransfer({
        transferId: transfer.transferId,
        token:
          `0x${Buffer.from(transfer.token).toString('hex').slice(-40)}` as `0x${string}`,
        sender: transfer.sender,
        recipient:
          `0x${Buffer.from(transfer.recipient).toString('hex').slice(-40)}` as `0x${string}`,
        amount: transfer.amount,
        slot: sourceSlot,
        proof: Array.from(proof.proof).map((b) => BigInt(b)),
        publicInputs: Array.from(proof.publicInputs).map((b) => BigInt(b)),
      })
      log.info('EVM transfer completed', { txHash })

      pending.status = TransferStatus.COMPLETED
      this.stats.transfersProcessed++
    } else if (this.solanaClient) {
      log.info('Completing transfer on Solana', { txId })
      const sourceSlot =
        pending.sourceCommitment && 'slot' in pending.sourceCommitment
          ? BigInt(pending.sourceCommitment.slot)
          : BigInt(0)

      const signature = await this.solanaClient.completeTransfer({
        transferId: transfer.transferId,
        mint: new PublicKey(transfer.token),
        sender: transfer.sender,
        recipient: new PublicKey(transfer.recipient),
        amount: transfer.amount,
        evmBlockNumber: sourceSlot,
        proof: proof.proof,
        publicInputs: proof.publicInputs,
      })
      log.info('Solana transfer completed', { signature })

      pending.status = TransferStatus.COMPLETED
      this.stats.transfersProcessed++
    } else {
      throw new Error(
        `No client available for destination chain ${transfer.destChain}`,
      )
    }
  }

  private cleanupOldData(): void {
    const cutoff = Date.now() - 3600000 // 1 hour

    // Remove old completed/failed transfers
    for (const [id, pending] of this.pendingTransfers) {
      if (
        pending.receivedAt < cutoff &&
        (pending.status === TransferStatus.COMPLETED ||
          pending.status === TransferStatus.FAILED)
      ) {
        this.pendingTransfers.delete(id)
        // Also clean up from processed set after grace period
        this.processedTransferIds.delete(id)
      }
    }

    // Keep only recent commitments
    const maxCommitments = 1000
    if (this.solanaCommitments.size > maxCommitments) {
      const entries = Array.from(this.solanaCommitments.entries())
      entries.sort((a, b) => Number(a[0]) - Number(b[0]))
      for (let i = 0; i < entries.length - maxCommitments; i++) {
        this.solanaCommitments.delete(entries[i][0])
      }
    }

    // SECURITY: Clean up Ethereum commitments too
    if (this.ethereumCommitments.size > maxCommitments) {
      const entries = Array.from(this.ethereumCommitments.entries())
      entries.sort((a, b) => Number(a[0]) - Number(b[0]))
      for (let i = 0; i < entries.length - maxCommitments; i++) {
        this.ethereumCommitments.delete(entries[i][0])
      }
    }

    // SECURITY: Clean up old nonces to prevent memory growth
    for (const [key, nonces] of this.processedNonces) {
      if (nonces.size > 10000) {
        // If a sender has too many nonces, trim old ones
        const noncesArray = Array.from(nonces).sort((a, b) => Number(a - b))
        const trimCount = nonces.size - 5000
        for (let i = 0; i < trimCount; i++) {
          nonces.delete(noncesArray[i])
        }
        log.debug('Trimmed old nonces for sender', { key, trimmed: trimCount })
      }
    }
  }

  private async loadSolanaKeypair(): Promise<Keypair> {
    const keypairPath = this.config.solanaConfig.keypairPath.replace(
      '~',
      process.env.HOME ?? '',
    )

    // Check file exists first
    const file = Bun.file(keypairPath)
    const exists = await file.exists()

    if (!exists) {
      // Only allow ephemeral keypair in local development
      if (isLocalDev || keypairPath.includes('localnet')) {
        log.warn(
          'Keypair file not found, using ephemeral keypair for local dev',
          { keypairPath },
        )
        return Keypair.generate()
      }
      throw new Error(
        `Solana keypair file not found: ${keypairPath}. ` +
          `Create a keypair with 'solana-keygen new' or set SOLANA_KEYPAIR to a valid path.`,
      )
    }

    const keypairData = await file.json()
    log.info('Loaded Solana keypair', { keypairPath })
    return Keypair.fromSecretKey(new Uint8Array(keypairData))
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
    }
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createRelayerService(config: RelayerConfig): RelayerService {
  return new RelayerService(config)
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (import.meta.main) {
  const config: RelayerConfig = {
    port: parseInt(process.env.RELAYER_PORT ?? '8081', 10),
    evmChains: [
      {
        chainId: parseInt(process.env.EVM_CHAIN_ID ?? '31337', 10) as ChainId,
        rpcUrl: requireEnv('EVM_RPC_URL', 'http://127.0.0.1:6545'),
        bridgeAddress: requireEnv('BRIDGE_ADDRESS'),
        lightClientAddress: requireEnv('LIGHT_CLIENT_ADDRESS'),
        privateKey: requireEnvSecret('PRIVATE_KEY'),
      },
    ],
    solanaConfig: {
      rpcUrl: requireEnv('SOLANA_RPC_URL', 'http://127.0.0.1:8899'),
      bridgeProgramId: requireEnv('BRIDGE_PROGRAM_ID'),
      evmLightClientProgramId: requireEnv('EVM_LIGHT_CLIENT_PROGRAM_ID'),
      keypairPath: requireEnv('SOLANA_KEYPAIR', '~/.config/solana/id.json'),
    },
    proverEndpoint: requireEnv('PROVER_ENDPOINT', 'http://127.0.0.1:8082'),
    teeEndpoint: requireEnv('TEE_ENDPOINT', 'http://127.0.0.1:8080'),
    batchSize: 10,
    batchTimeoutMs: 30000,
    retryAttempts: 3,
    retryDelayMs: 5000,
  }

  const relayer = createRelayerService(config)

  process.on('SIGINT', () => {
    relayer.stop()
    process.exit(0)
  })

  relayer
    .start()
    .catch((error) =>
      log.error('Relayer startup failed', { error: String(error) }),
    )
}

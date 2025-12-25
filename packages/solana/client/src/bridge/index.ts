import type { TransferStatus } from '@jejunetwork/types'
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  type Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import { bytesToEvmAddress, evmAddressToBytes } from '../dex/utils'
import { EVM_LIGHT_CLIENT_PROGRAM_ID } from '../light-client'

// NOTE: This must match the program ID in Anchor.toml
export const TOKEN_BRIDGE_PROGRAM_ID = new PublicKey(
  '36Cx8V6UCkCGuSCjzQuE9oeeqojd9734TKmfnbDGWhCA',
)

const BRIDGE_STATE_SEED = Buffer.from('bridge_state')
const TOKEN_CONFIG_SEED = Buffer.from('token_config')
const TRANSFER_SEED = Buffer.from('transfer')
const COMPLETION_SEED = Buffer.from('completion')
const BRIDGE_VAULT_SEED = Buffer.from('bridge_vault')

export const MAX_PAYLOAD_SIZE = 1024

export type { TransferStatus }

export interface BridgeState {
  admin: PublicKey
  evmLightClient: PublicKey
  evmBridgeAddress: Uint8Array
  evmChainId: bigint
  transferNonce: bigint
  totalLocked: bigint
  paused: boolean
}

export interface TokenConfig {
  mint: PublicKey
  evmToken: Uint8Array
  isNativeOnSolana: boolean
  totalBridged: bigint
  enabled: boolean
}

export interface TransferRecord {
  transferId: Uint8Array
  sender: PublicKey
  evmRecipient: Uint8Array
  mint: PublicKey
  amount: bigint
  nonce: bigint
  timestamp: bigint
  status: TransferStatus
  payload: Uint8Array
}

export interface CompletionRecord {
  transferId: Uint8Array
  completed: boolean
  completedAt: bigint
}

export interface InitializeBridgeParams {
  evmChainId: bigint
  evmLightClient: PublicKey
}

export interface RegisterTokenParams {
  mint: PublicKey
  evmToken: Uint8Array
  isNativeOnSolana: boolean
}

export interface InitiateTransferParams {
  mint: PublicKey
  evmRecipient: Uint8Array
  amount: bigint
  payload?: Uint8Array
}

export interface CompleteTransferParams {
  transferId: Uint8Array
  evmSender: Uint8Array
  mint: PublicKey
  amount: bigint
  evmBlockNumber: bigint
  proofData: Uint8Array
}

export class TokenBridgeClient {
  private connection: Connection
  private programId: PublicKey

  constructor(connection: Connection, programId?: PublicKey) {
    this.connection = connection
    this.programId = programId ?? TOKEN_BRIDGE_PROGRAM_ID
  }

  // PDA Derivation

  getBridgeStatePDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([BRIDGE_STATE_SEED], this.programId)
  }

  getTokenConfigPDA(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [TOKEN_CONFIG_SEED, mint.toBuffer()],
      this.programId,
    )
  }

  getTransferPDA(nonce: bigint): [PublicKey, number] {
    const nonceBuffer = Buffer.alloc(8)
    nonceBuffer.writeBigUInt64LE(nonce)
    return PublicKey.findProgramAddressSync(
      [TRANSFER_SEED, nonceBuffer],
      this.programId,
    )
  }

  getCompletionPDA(transferId: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [COMPLETION_SEED, Buffer.from(transferId)],
      this.programId,
    )
  }

  getBridgeVaultPDA(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [BRIDGE_VAULT_SEED, mint.toBuffer()],
      this.programId,
    )
  }

  // Read Operations

  async getBridgeState(): Promise<BridgeState | null> {
    const [statePDA] = this.getBridgeStatePDA()
    const accountInfo = await this.connection.getAccountInfo(statePDA)
    if (!accountInfo) return null
    return this.deserializeBridgeState(accountInfo.data)
  }

  async getTokenConfig(mint: PublicKey): Promise<TokenConfig | null> {
    const [configPDA] = this.getTokenConfigPDA(mint)
    const accountInfo = await this.connection.getAccountInfo(configPDA)
    if (!accountInfo) return null
    return this.deserializeTokenConfig(accountInfo.data)
  }

  async getTransferRecord(nonce: bigint): Promise<TransferRecord | null> {
    const [transferPDA] = this.getTransferPDA(nonce)
    const accountInfo = await this.connection.getAccountInfo(transferPDA)
    if (!accountInfo) return null
    return this.deserializeTransferRecord(accountInfo.data)
  }

  async getCompletionRecord(
    transferId: Uint8Array,
  ): Promise<CompletionRecord | null> {
    const [completionPDA] = this.getCompletionPDA(transferId)
    const accountInfo = await this.connection.getAccountInfo(completionPDA)
    if (!accountInfo) return null
    return this.deserializeCompletionRecord(accountInfo.data)
  }

  async isInitialized(): Promise<boolean> {
    const state = await this.getBridgeState()
    return state !== null
  }

  async isPaused(): Promise<boolean> {
    const state = await this.getBridgeState()
    if (!state) {
      throw new Error('Bridge not initialized')
    }
    return state.paused
  }

  // Admin Instructions

  async initializeInstructions(
    params: InitializeBridgeParams,
    admin: PublicKey,
  ): Promise<TransactionInstruction[]> {
    const [statePDA] = this.getBridgeStatePDA()

    const data = this.buildInitializeData(params)

    return [
      new TransactionInstruction({
        keys: [
          { pubkey: statePDA, isSigner: false, isWritable: true },
          { pubkey: params.evmLightClient, isSigner: false, isWritable: false },
          { pubkey: admin, isSigner: true, isWritable: true },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        programId: this.programId,
        data,
      }),
    ]
  }

  async registerTokenInstructions(
    params: RegisterTokenParams,
    admin: PublicKey,
  ): Promise<TransactionInstruction[]> {
    const [statePDA] = this.getBridgeStatePDA()
    const [tokenConfigPDA] = this.getTokenConfigPDA(params.mint)

    const data = this.buildRegisterTokenData(params)

    return [
      new TransactionInstruction({
        keys: [
          { pubkey: statePDA, isSigner: false, isWritable: false },
          { pubkey: tokenConfigPDA, isSigner: false, isWritable: true },
          { pubkey: params.mint, isSigner: false, isWritable: false },
          { pubkey: admin, isSigner: true, isWritable: true },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        programId: this.programId,
        data,
      }),
    ]
  }

  async pauseInstructions(admin: PublicKey): Promise<TransactionInstruction[]> {
    const [statePDA] = this.getBridgeStatePDA()

    // Discriminator for pause
    const data = Buffer.from([0x70, 0x61, 0x75, 0x73, 0x65, 0x00, 0x00, 0x00])

    return [
      new TransactionInstruction({
        keys: [
          { pubkey: statePDA, isSigner: false, isWritable: true },
          { pubkey: admin, isSigner: true, isWritable: false },
        ],
        programId: this.programId,
        data,
      }),
    ]
  }

  async unpauseInstructions(
    admin: PublicKey,
  ): Promise<TransactionInstruction[]> {
    const [statePDA] = this.getBridgeStatePDA()

    // Discriminator for unpause
    const data = Buffer.from([0x75, 0x6e, 0x70, 0x61, 0x75, 0x73, 0x65, 0x00])

    return [
      new TransactionInstruction({
        keys: [
          { pubkey: statePDA, isSigner: false, isWritable: true },
          { pubkey: admin, isSigner: true, isWritable: false },
        ],
        programId: this.programId,
        data,
      }),
    ]
  }

  // Transfer Instructions

  async initiateTransferInstructions(
    params: InitiateTransferParams,
    sender: PublicKey,
  ): Promise<TransactionInstruction[]> {
    const state = await this.getBridgeState()
    if (!state) throw new Error('Bridge not initialized')

    const [statePDA] = this.getBridgeStatePDA()
    const [tokenConfigPDA] = this.getTokenConfigPDA(params.mint)
    const [transferPDA] = this.getTransferPDA(state.transferNonce + 1n)
    const [bridgeVaultPDA] = this.getBridgeVaultPDA(params.mint)

    const senderTokenAccount = await getAssociatedTokenAddress(
      params.mint,
      sender,
    )

    const instructions: TransactionInstruction[] = []

    // Create bridge vault if it doesn't exist
    const vaultInfo = await this.connection.getAccountInfo(bridgeVaultPDA)
    if (!vaultInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          sender,
          bridgeVaultPDA,
          statePDA,
          params.mint,
        ),
      )
    }

    const data = this.buildInitiateTransferData(params)

    instructions.push(
      new TransactionInstruction({
        keys: [
          { pubkey: statePDA, isSigner: false, isWritable: true },
          { pubkey: tokenConfigPDA, isSigner: false, isWritable: false },
          { pubkey: transferPDA, isSigner: false, isWritable: true },
          { pubkey: params.mint, isSigner: false, isWritable: true },
          { pubkey: bridgeVaultPDA, isSigner: false, isWritable: true },
          { pubkey: senderTokenAccount, isSigner: false, isWritable: true },
          { pubkey: sender, isSigner: true, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        programId: this.programId,
        data,
      }),
    )

    return instructions
  }

  async completeTransferInstructions(
    params: CompleteTransferParams,
    recipient: PublicKey,
    relayer: PublicKey,
  ): Promise<TransactionInstruction[]> {
    const state = await this.getBridgeState()
    if (!state) throw new Error('Bridge not initialized')

    const [statePDA] = this.getBridgeStatePDA()
    const [tokenConfigPDA] = this.getTokenConfigPDA(params.mint)
    const [completionPDA] = this.getCompletionPDA(params.transferId)
    const [bridgeVaultPDA] = this.getBridgeVaultPDA(params.mint)

    const recipientTokenAccount = await getAssociatedTokenAddress(
      params.mint,
      recipient,
    )

    const instructions: TransactionInstruction[] = []

    // Create recipient token account if needed
    const recipientAccountInfo = await this.connection.getAccountInfo(
      recipientTokenAccount,
    )
    if (!recipientAccountInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          relayer,
          recipientTokenAccount,
          recipient,
          params.mint,
        ),
      )
    }

    const data = this.buildCompleteTransferData(params)

    instructions.push(
      new TransactionInstruction({
        keys: [
          { pubkey: statePDA, isSigner: false, isWritable: false },
          { pubkey: tokenConfigPDA, isSigner: false, isWritable: false },
          { pubkey: completionPDA, isSigner: false, isWritable: true },
          {
            pubkey: EVM_LIGHT_CLIENT_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          { pubkey: state.evmLightClient, isSigner: false, isWritable: false },
          { pubkey: params.mint, isSigner: false, isWritable: true },
          { pubkey: bridgeVaultPDA, isSigner: false, isWritable: true },
          { pubkey: recipientTokenAccount, isSigner: false, isWritable: true },
          { pubkey: recipient, isSigner: false, isWritable: false },
          { pubkey: relayer, isSigner: true, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        programId: this.programId,
        data,
      }),
    )

    return instructions
  }

  evmAddressToBytes(address: string): Uint8Array {
    return evmAddressToBytes(address)
  }

  bytesToEvmAddress(bytes: Uint8Array): string {
    return bytesToEvmAddress(bytes)
  }

  private buildInitializeData(params: InitializeBridgeParams): Buffer {
    const data = Buffer.alloc(8 + 8)

    // Discriminator for initialize
    Buffer.from([0xaf, 0xaf, 0x6d, 0x1f, 0x0d, 0x98, 0x9b, 0xed]).copy(data, 0)
    data.writeBigUInt64LE(params.evmChainId, 8)

    return data
  }

  private buildRegisterTokenData(params: RegisterTokenParams): Buffer {
    const data = Buffer.alloc(8 + 20 + 1)

    // Discriminator for register_token
    Buffer.from([0x72, 0x65, 0x67, 0x69, 0x73, 0x74, 0x65, 0x72]).copy(data, 0)
    Buffer.from(params.evmToken).copy(data, 8)
    data.writeUInt8(params.isNativeOnSolana ? 1 : 0, 28)

    return data
  }

  private buildInitiateTransferData(params: InitiateTransferParams): Buffer {
    const payload = params.payload ?? new Uint8Array(0)
    const data = Buffer.alloc(8 + 20 + 8 + 4 + payload.length)
    let offset = 0

    // Discriminator for initiate_transfer
    Buffer.from([0x69, 0x6e, 0x69, 0x74, 0x69, 0x61, 0x74, 0x65]).copy(
      data,
      offset,
    )
    offset += 8

    Buffer.from(params.evmRecipient).copy(data, offset)
    offset += 20

    data.writeBigUInt64LE(params.amount, offset)
    offset += 8

    data.writeUInt32LE(payload.length, offset)
    offset += 4
    if (payload.length > 0) {
      Buffer.from(payload).copy(data, offset)
    }

    return data
  }

  private buildCompleteTransferData(params: CompleteTransferParams): Buffer {
    const data = Buffer.alloc(8 + 32 + 20 + 8 + 8 + 4 + params.proofData.length)
    let offset = 0

    // Discriminator for complete_transfer
    Buffer.from([0x63, 0x6f, 0x6d, 0x70, 0x6c, 0x65, 0x74, 0x65]).copy(
      data,
      offset,
    )
    offset += 8

    Buffer.from(params.transferId).copy(data, offset)
    offset += 32

    Buffer.from(params.evmSender).copy(data, offset)
    offset += 20

    data.writeBigUInt64LE(params.amount, offset)
    offset += 8

    data.writeBigUInt64LE(params.evmBlockNumber, offset)
    offset += 8

    data.writeUInt32LE(params.proofData.length, offset)
    offset += 4
    Buffer.from(params.proofData).copy(data, offset)

    return data
  }

  // Deserialization

  private deserializeBridgeState(data: Buffer): BridgeState {
    let offset = 8 // Skip discriminator

    const admin = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const evmLightClient = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const evmBridgeAddress = new Uint8Array(data.subarray(offset, offset + 20))
    offset += 20

    const evmChainId = data.readBigUInt64LE(offset)
    offset += 8

    const transferNonce = data.readBigUInt64LE(offset)
    offset += 8

    const totalLocked = data.readBigUInt64LE(offset)
    offset += 8

    const paused = data.readUInt8(offset) === 1

    return {
      admin,
      evmLightClient,
      evmBridgeAddress,
      evmChainId,
      transferNonce,
      totalLocked,
      paused,
    }
  }

  private deserializeTokenConfig(data: Buffer): TokenConfig {
    let offset = 8 // Skip discriminator

    const mint = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const evmToken = new Uint8Array(data.subarray(offset, offset + 20))
    offset += 20

    const isNativeOnSolana = data.readUInt8(offset) === 1
    offset += 1

    const totalBridged = data.readBigUInt64LE(offset)
    offset += 8

    const enabled = data.readUInt8(offset) === 1

    return {
      mint,
      evmToken,
      isNativeOnSolana,
      totalBridged,
      enabled,
    }
  }

  private deserializeTransferRecord(data: Buffer): TransferRecord {
    let offset = 8 // Skip discriminator

    const transferId = new Uint8Array(data.subarray(offset, offset + 32))
    offset += 32

    const sender = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const evmRecipient = new Uint8Array(data.subarray(offset, offset + 20))
    offset += 20

    const mint = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const amount = data.readBigUInt64LE(offset)
    offset += 8

    const nonce = data.readBigUInt64LE(offset)
    offset += 8

    const timestamp = data.readBigInt64LE(offset)
    offset += 8

    const statusByte = data.readUInt8(offset)
    const status: TransferStatus =
      statusByte === 0 ? 'pending' : statusByte === 1 ? 'completed' : 'failed'
    offset += 1

    const payloadLen = data.readUInt32LE(offset)
    offset += 4
    const payload = new Uint8Array(data.subarray(offset, offset + payloadLen))

    return {
      transferId,
      sender,
      evmRecipient,
      mint,
      amount,
      nonce,
      timestamp,
      status,
      payload,
    }
  }

  private deserializeCompletionRecord(data: Buffer): CompletionRecord {
    let offset = 8 // Skip discriminator

    const transferId = new Uint8Array(data.subarray(offset, offset + 32))
    offset += 32

    const completed = data.readUInt8(offset) === 1
    offset += 1

    const completedAt = data.readBigInt64LE(offset)

    return {
      transferId,
      completed,
      completedAt,
    }
  }
}

export function createTokenBridgeClient(
  connection: Connection,
  programId?: PublicKey,
): TokenBridgeClient {
  return new TokenBridgeClient(connection, programId)
}

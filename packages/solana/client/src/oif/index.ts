/**
 * OIF Solana Client
 *
 * TypeScript client for the Open Intent Framework on Solana.
 * Enables cross-chain intent creation and settlement.
 */

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
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
import { hexToBytes as sharedHexToBytes } from '../dex/utils'

export const OIF_PROGRAM_ID = new PublicKey(
  'GYSFWUUKUFAdtv1TgZ3GkGfdCxPNbyRj1jsW8VRK7hBs',
)

const CONFIG_SEED = Buffer.from('config')
const INTENT_SEED = Buffer.from('intent')
const SOLVER_SEED = Buffer.from('solver')
const STAKE_VAULT_SEED = Buffer.from('stake-vault')

export const CHAIN_IDS = {
  SOLANA_MAINNET: 1399811149,
  SOLANA_DEVNET: 1399811150,
  ETHEREUM: 1,
  BASE: 8453,
  BASE_SEPOLIA: 84532,
  ARBITRUM: 42161,
  OPTIMISM: 10,
  POLYGON: 137,
} as const

export interface OIFConfig {
  authority: PublicKey
  protocolFeeBps: number
  minSolverStake: bigint
  totalIntents: bigint
  totalFilled: bigint
  totalVolume: bigint
}

// Import consolidated IntentStatus from @jejunetwork/types (OIF standard)
import type { IntentStatus } from '@jejunetwork/types'
export type { IntentStatus }

export interface Intent {
  creator: PublicKey
  intentId: Uint8Array
  sourceChain: number
  destinationChain: number
  sourceToken: PublicKey
  destinationToken: Uint8Array
  sourceAmount: bigint
  minDestinationAmount: bigint
  recipient: Uint8Array
  expiry: bigint
  partialFillAllowed: boolean
  amountFilled: bigint
  status: IntentStatus
  createdAt: bigint
  filledAt: bigint
}

export interface Solver {
  owner: PublicKey
  stake: bigint
  supportedChains: number[]
  intentsFilled: bigint
  totalVolume: bigint
  reputationScore: bigint
  active: boolean
  registeredAt: bigint
}

export interface CreateIntentParams {
  sourceChain: number
  destinationChain: number
  sourceToken: PublicKey
  destinationToken: string | Uint8Array
  sourceAmount: bigint
  minDestinationAmount: bigint
  recipient: string | Uint8Array
  expiry?: bigint
  partialFillAllowed?: boolean
}

export interface FillIntentParams {
  intentId: Uint8Array
  fillAmount: bigint
  destinationTxHash: string | Uint8Array
}

export class OIFClient {
  private connection: Connection
  private programId: PublicKey

  constructor(connection: Connection, programId?: PublicKey) {
    this.connection = connection
    this.programId = programId ?? OIF_PROGRAM_ID
  }

  getConfigPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([CONFIG_SEED], this.programId)
  }

  getIntentPDA(intentId: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [INTENT_SEED, intentId],
      this.programId,
    )
  }

  getSolverPDA(owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SOLVER_SEED, owner.toBuffer()],
      this.programId,
    )
  }

  getStakeVaultPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([STAKE_VAULT_SEED], this.programId)
  }

  async getConfig(): Promise<OIFConfig | null> {
    const [configPDA] = this.getConfigPDA()
    const accountInfo = await this.connection.getAccountInfo(configPDA)
    if (!accountInfo) return null
    return this.deserializeConfig(accountInfo.data)
  }

  async getIntent(intentId: Uint8Array): Promise<Intent | null> {
    const [intentPDA] = this.getIntentPDA(intentId)
    const accountInfo = await this.connection.getAccountInfo(intentPDA)
    if (!accountInfo) return null
    return this.deserializeIntent(accountInfo.data)
  }

  async getSolver(owner: PublicKey): Promise<Solver | null> {
    const [solverPDA] = this.getSolverPDA(owner)
    const accountInfo = await this.connection.getAccountInfo(solverPDA)
    if (!accountInfo) return null
    return this.deserializeSolver(accountInfo.data)
  }

  async getOpenIntents(limit: number = 100): Promise<Intent[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [{ dataSize: 220 }],
    })

    const intents: Intent[] = []
    for (const { account } of accounts) {
      const intent = this.deserializeIntent(account.data)
      if (intent.status === 'open') {
        intents.push(intent)
        if (intents.length >= limit) break
      }
    }
    return intents
  }

  async getActiveSolvers(limit: number = 100): Promise<Solver[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [{ dataSize: 150 }],
    })

    const solvers: Solver[] = []
    for (const { account } of accounts) {
      const solver = this.deserializeSolver(account.data)
      if (solver.active) {
        solvers.push(solver)
        if (solvers.length >= limit) break
      }
    }
    return solvers
  }

  generateIntentId(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32))
  }

  async createIntentInstructions(
    params: CreateIntentParams,
    creator: PublicKey,
  ): Promise<{ instructions: TransactionInstruction[]; intentId: Uint8Array }> {
    const intentId = this.generateIntentId()
    const [configPDA] = this.getConfigPDA()
    const [intentPDA] = this.getIntentPDA(intentId)

    const destinationToken =
      typeof params.destinationToken === 'string'
        ? this.addressToBytes(params.destinationToken)
        : params.destinationToken

    const recipient =
      typeof params.recipient === 'string'
        ? this.addressToBytes(params.recipient)
        : params.recipient

    const creatorTokenAccount = await getAssociatedTokenAddress(
      params.sourceToken,
      creator,
    )

    const escrowTokenAccount = await getAssociatedTokenAddress(
      params.sourceToken,
      intentPDA,
      true,
    )

    const data = this.buildCreateIntentData({
      intentId,
      sourceChain: params.sourceChain,
      destinationChain: params.destinationChain,
      sourceToken: params.sourceToken,
      destinationToken,
      sourceAmount: params.sourceAmount,
      minDestinationAmount: params.minDestinationAmount,
      recipient,
      expiry: params.expiry ?? BigInt(0),
      partialFillAllowed: params.partialFillAllowed ?? true,
    })

    const instructions: TransactionInstruction[] = []

    const escrowAccountInfo =
      await this.connection.getAccountInfo(escrowTokenAccount)
    if (!escrowAccountInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          creator,
          escrowTokenAccount,
          intentPDA,
          params.sourceToken,
        ),
      )
    }

    instructions.push(
      new TransactionInstruction({
        keys: [
          { pubkey: creator, isSigner: true, isWritable: true },
          { pubkey: configPDA, isSigner: false, isWritable: true },
          { pubkey: params.sourceToken, isSigner: false, isWritable: false },
          { pubkey: intentPDA, isSigner: false, isWritable: true },
          { pubkey: creatorTokenAccount, isSigner: false, isWritable: true },
          { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          {
            pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
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

    return { instructions, intentId }
  }

  async fillIntentInstructions(
    params: FillIntentParams,
    solver: PublicKey,
  ): Promise<TransactionInstruction[]> {
    const [configPDA] = this.getConfigPDA()
    const [intentPDA] = this.getIntentPDA(params.intentId)
    const [solverPDA] = this.getSolverPDA(solver)

    const intent = await this.getIntent(params.intentId)
    if (!intent) throw new Error('Intent not found')

    const escrowTokenAccount = await getAssociatedTokenAddress(
      intent.sourceToken,
      intentPDA,
      true,
    )

    const solverTokenAccount = await getAssociatedTokenAddress(
      intent.sourceToken,
      solver,
    )

    const config = await this.getConfig()
    if (!config) throw new Error('OIF not initialized')

    const destinationTxHash =
      typeof params.destinationTxHash === 'string'
        ? this.hexToBytes(params.destinationTxHash)
        : params.destinationTxHash

    const data = this.buildFillIntentData(params.fillAmount, destinationTxHash)
    const instructions: TransactionInstruction[] = []

    const solverAccountInfo =
      await this.connection.getAccountInfo(solverTokenAccount)
    if (!solverAccountInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          solver,
          solverTokenAccount,
          solver,
          intent.sourceToken,
        ),
      )
    }

    instructions.push(
      new TransactionInstruction({
        keys: [
          { pubkey: solver, isSigner: true, isWritable: true },
          { pubkey: configPDA, isSigner: false, isWritable: true },
          { pubkey: intentPDA, isSigner: false, isWritable: true },
          { pubkey: solverPDA, isSigner: false, isWritable: true },
          { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
          { pubkey: solverTokenAccount, isSigner: false, isWritable: true },
          { pubkey: config.authority, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          {
            pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
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

  async cancelIntentInstructions(
    intentId: Uint8Array,
    creator: PublicKey,
  ): Promise<TransactionInstruction[]> {
    const [intentPDA] = this.getIntentPDA(intentId)

    const intent = await this.getIntent(intentId)
    if (!intent) throw new Error('Intent not found')

    const escrowTokenAccount = await getAssociatedTokenAddress(
      intent.sourceToken,
      intentPDA,
      true,
    )

    const creatorTokenAccount = await getAssociatedTokenAddress(
      intent.sourceToken,
      creator,
    )

    const discriminator = Buffer.from([
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03,
    ])

    return [
      new TransactionInstruction({
        keys: [
          { pubkey: creator, isSigner: true, isWritable: false },
          { pubkey: intentPDA, isSigner: false, isWritable: true },
          { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
          { pubkey: creatorTokenAccount, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId: this.programId,
        data: discriminator,
      }),
    ]
  }

  async registerSolverInstructions(
    owner: PublicKey,
    _stake: bigint,
    supportedChains: number[],
  ): Promise<TransactionInstruction[]> {
    const [configPDA] = this.getConfigPDA()
    const [solverPDA] = this.getSolverPDA(owner)
    const [stakeVaultPDA] = this.getStakeVaultPDA()

    const data = this.buildRegisterSolverData(supportedChains)

    return [
      new TransactionInstruction({
        keys: [
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: configPDA, isSigner: false, isWritable: false },
          { pubkey: solverPDA, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: false, isWritable: true },
          { pubkey: stakeVaultPDA, isSigner: false, isWritable: true },
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

  private buildCreateIntentData(params: {
    intentId: Uint8Array
    sourceChain: number
    destinationChain: number
    sourceToken: PublicKey
    destinationToken: Uint8Array
    sourceAmount: bigint
    minDestinationAmount: bigint
    recipient: Uint8Array
    expiry: bigint
    partialFillAllowed: boolean
  }): Buffer {
    const data = Buffer.alloc(8 + 32 + 4 + 4 + 32 + 32 + 8 + 8 + 32 + 8 + 1)
    let offset = 0

    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02]).copy(
      data,
      offset,
    )
    offset += 8

    Buffer.from(params.intentId).copy(data, offset)
    offset += 32

    data.writeUInt32LE(params.sourceChain, offset)
    offset += 4

    data.writeUInt32LE(params.destinationChain, offset)
    offset += 4

    params.sourceToken.toBuffer().copy(data, offset)
    offset += 32

    Buffer.from(params.destinationToken).copy(data, offset)
    offset += 32

    data.writeBigUInt64LE(params.sourceAmount, offset)
    offset += 8

    data.writeBigUInt64LE(params.minDestinationAmount, offset)
    offset += 8

    Buffer.from(params.recipient).copy(data, offset)
    offset += 32

    data.writeBigInt64LE(params.expiry, offset)
    offset += 8

    data.writeUInt8(params.partialFillAllowed ? 1 : 0, offset)

    return data
  }

  private buildFillIntentData(
    fillAmount: bigint,
    destinationTxHash: Uint8Array,
  ): Buffer {
    const data = Buffer.alloc(8 + 8 + 32)

    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04]).copy(data, 0)
    data.writeBigUInt64LE(fillAmount, 8)
    Buffer.from(destinationTxHash).copy(data, 16)

    return data
  }

  private buildRegisterSolverData(supportedChains: number[]): Buffer {
    const data = Buffer.alloc(8 + 4 + supportedChains.length * 4)

    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]).copy(data, 0)
    data.writeUInt32LE(supportedChains.length, 8)

    let offset = 12
    for (const chain of supportedChains) {
      data.writeUInt32LE(chain, offset)
      offset += 4
    }

    return data
  }

  private addressToBytes(address: string): Uint8Array {
    if (address.startsWith('0x')) {
      return this.hexToBytes(address)
    }
    return new PublicKey(address).toBytes()
  }

  private hexToBytes(hex: string): Uint8Array {
    if (hex.length === 0 || (hex.startsWith('0x') && hex.length === 2)) {
      throw new Error('Empty hex string')
    }
    const rawBytes = sharedHexToBytes(hex)
    // Pad to 32 bytes for Solana compatibility
    const bytes = new Uint8Array(32)
    bytes.set(rawBytes.slice(0, 32))
    return bytes
  }

  private deserializeConfig(data: Buffer): OIFConfig {
    let offset = 8

    const authority = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const protocolFeeBps = data.readUInt16LE(offset)
    offset += 2

    const minSolverStake = data.readBigUInt64LE(offset)
    offset += 8

    const totalIntents = data.readBigUInt64LE(offset)
    offset += 8

    const totalFilled = data.readBigUInt64LE(offset)
    offset += 8

    const volumeLow = data.readBigUInt64LE(offset)
    offset += 8
    const volumeHigh = data.readBigUInt64LE(offset)
    const totalVolume = volumeLow + (volumeHigh << 64n)

    return {
      authority,
      protocolFeeBps,
      minSolverStake,
      totalIntents,
      totalFilled,
      totalVolume,
    }
  }

  private deserializeIntent(data: Buffer): Intent {
    let offset = 8

    const creator = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const intentId = new Uint8Array(data.subarray(offset, offset + 32))
    offset += 32

    const sourceChain = data.readUInt32LE(offset)
    offset += 4

    const destinationChain = data.readUInt32LE(offset)
    offset += 4

    const sourceToken = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const destinationToken = new Uint8Array(data.subarray(offset, offset + 32))
    offset += 32

    const sourceAmount = data.readBigUInt64LE(offset)
    offset += 8

    const minDestinationAmount = data.readBigUInt64LE(offset)
    offset += 8

    const recipient = new Uint8Array(data.subarray(offset, offset + 32))
    offset += 32

    const expiry = data.readBigInt64LE(offset)
    offset += 8

    const partialFillAllowed = data.readUInt8(offset) === 1
    offset += 1

    const amountFilled = data.readBigUInt64LE(offset)
    offset += 8

    const statusByte = data.readUInt8(offset)
    const status: IntentStatus =
      statusByte === 0
        ? 'open'
        : statusByte === 1
          ? 'filled'
          : statusByte === 2
            ? 'cancelled'
            : 'expired'
    offset += 1

    const createdAt = data.readBigInt64LE(offset)
    offset += 8

    const filledAt = data.readBigInt64LE(offset)

    return {
      creator,
      intentId,
      sourceChain,
      destinationChain,
      sourceToken,
      destinationToken,
      sourceAmount,
      minDestinationAmount,
      recipient,
      expiry,
      partialFillAllowed,
      amountFilled,
      status,
      createdAt,
      filledAt,
    }
  }

  private deserializeSolver(data: Buffer): Solver {
    let offset = 8

    const owner = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const stake = data.readBigUInt64LE(offset)
    offset += 8

    const chainCount = data.readUInt32LE(offset)
    offset += 4
    const supportedChains: number[] = []
    for (let i = 0; i < chainCount; i++) {
      supportedChains.push(data.readUInt32LE(offset))
      offset += 4
    }

    const intentsFilled = data.readBigUInt64LE(offset)
    offset += 8

    const volumeLow = data.readBigUInt64LE(offset)
    offset += 8
    const volumeHigh = data.readBigUInt64LE(offset)
    offset += 8
    const totalVolume = volumeLow + (volumeHigh << 64n)

    const reputationScore = data.readBigUInt64LE(offset)
    offset += 8

    const active = data.readUInt8(offset) === 1
    offset += 1

    const registeredAt = data.readBigInt64LE(offset)

    return {
      owner,
      stake,
      supportedChains,
      intentsFilled,
      totalVolume,
      reputationScore,
      active,
      registeredAt,
    }
  }
}

export function createOIFClient(
  connection: Connection,
  programId?: PublicKey,
): OIFClient {
  return new OIFClient(connection, programId)
}

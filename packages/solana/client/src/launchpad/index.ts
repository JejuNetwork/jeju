import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  type Connection,
  type Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  calculateBondingCurveBuy,
  calculateBondingCurveSell,
  getBondingCurvePrice,
} from '../dex/utils'

// Program ID - matches Anchor.toml
export const LAUNCHPAD_PROGRAM_ID = new PublicKey(
  '6q2T4SEeE2U4XsFNa5piNy6Vzv2qvdZXmAHhQH7BYVJd',
)

// Seeds
const CONFIG_SEED = Buffer.from('config')
const BONDING_CURVE_SEED = Buffer.from('bonding-curve')
const PRESALE_SEED = Buffer.from('presale')
const VAULT_SEED = Buffer.from('vault')
const CONTRIBUTION_SEED = Buffer.from('contribution')

// Types

export interface LaunchpadConfig {
  authority: PublicKey
  feeRecipient: PublicKey
  platformFeeBps: number
  totalLaunches: bigint
}

export interface BondingCurve {
  creator: PublicKey
  tokenMint: PublicKey
  virtualSolReserves: bigint
  virtualTokenReserves: bigint
  realSolReserves: bigint
  realTokenReserves: bigint
  tokensSold: bigint
  graduationThreshold: bigint
  creatorFeeBps: number
  graduated: boolean
  createdAt: bigint
}

export interface Presale {
  creator: PublicKey
  tokenMint: PublicKey
  softCap: bigint
  hardCap: bigint
  minContribution: bigint
  maxContribution: bigint
  startTime: bigint
  endTime: bigint
  tokenPrice: bigint
  vestingDuration: bigint
  totalRaised: bigint
  totalContributors: bigint
  finalized: boolean
  cancelled: boolean
  finalizedAt: bigint
}

export interface Contribution {
  contributor: PublicKey
  presale: PublicKey
  amount: bigint
  tokensClaimed: bigint
  claimed: boolean
}

export interface CreateBondingCurveParams {
  name: string
  symbol: string
  uri: string
  creatorFeeBps?: number
  graduationThreshold?: bigint
}

export interface CreatePresaleParams {
  tokenMint: PublicKey
  softCap: bigint
  hardCap: bigint
  minContribution: bigint
  maxContribution: bigint
  startTime: bigint
  endTime: bigint
  tokenPrice: bigint
  vestingDuration?: bigint
}

// Client Class

export class LaunchpadClient {
  private connection: Connection
  private programId: PublicKey

  constructor(connection: Connection, programId?: PublicKey) {
    this.connection = connection
    this.programId = programId ?? LAUNCHPAD_PROGRAM_ID
  }

  // PDA Derivation

  getConfigPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([CONFIG_SEED], this.programId)
  }

  getBondingCurvePDA(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [BONDING_CURVE_SEED, tokenMint.toBuffer()],
      this.programId,
    )
  }

  getPresalePDA(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [PRESALE_SEED, tokenMint.toBuffer()],
      this.programId,
    )
  }

  getVaultPDA(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [VAULT_SEED, tokenMint.toBuffer()],
      this.programId,
    )
  }

  getContributionPDA(
    presale: PublicKey,
    contributor: PublicKey,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [CONTRIBUTION_SEED, presale.toBuffer(), contributor.toBuffer()],
      this.programId,
    )
  }

  // Read Operations

  async getConfig(): Promise<LaunchpadConfig | null> {
    const [configPDA] = this.getConfigPDA()
    const accountInfo = await this.connection.getAccountInfo(configPDA)
    if (!accountInfo) return null

    return this.deserializeConfig(accountInfo.data)
  }

  async getBondingCurve(tokenMint: PublicKey): Promise<BondingCurve | null> {
    const [curvePDA] = this.getBondingCurvePDA(tokenMint)
    const accountInfo = await this.connection.getAccountInfo(curvePDA)
    if (!accountInfo) return null

    return this.deserializeBondingCurve(accountInfo.data)
  }

  async getPresale(tokenMint: PublicKey): Promise<Presale | null> {
    const [presalePDA] = this.getPresalePDA(tokenMint)
    const accountInfo = await this.connection.getAccountInfo(presalePDA)
    if (!accountInfo) return null

    return this.deserializePresale(accountInfo.data)
  }

  async getContribution(
    presale: PublicKey,
    contributor: PublicKey,
  ): Promise<Contribution | null> {
    const [contributionPDA] = this.getContributionPDA(presale, contributor)
    const accountInfo = await this.connection.getAccountInfo(contributionPDA)
    if (!accountInfo) return null

    return this.deserializeContribution(accountInfo.data)
  }

  // Bonding Curve Operations

  async createBondingCurveInstructions(
    params: CreateBondingCurveParams,
    creator: PublicKey,
    tokenMint: Keypair,
  ): Promise<TransactionInstruction[]> {
    const [configPDA] = this.getConfigPDA()
    const [bondingCurvePDA] = this.getBondingCurvePDA(tokenMint.publicKey)

    const curveTokenAccount = await getAssociatedTokenAddress(
      tokenMint.publicKey,
      bondingCurvePDA,
      true,
    )

    const instructions: TransactionInstruction[] = []

    // Build instruction data
    // Discriminator (8 bytes) + name (4 + len) + symbol (4 + len) + uri (4 + len) + creatorFeeBps (2) + graduationThreshold (8)
    const nameBytes = Buffer.from(params.name)
    const symbolBytes = Buffer.from(params.symbol)
    const uriBytes = Buffer.from(params.uri)

    const dataSize =
      8 +
      4 +
      nameBytes.length +
      4 +
      symbolBytes.length +
      4 +
      uriBytes.length +
      2 +
      8
    const data = Buffer.alloc(dataSize)

    let offset = 0
    // Discriminator for create_bonding_curve
    Buffer.from([0x18, 0x1e, 0xc8, 0x28, 0x05, 0x1c, 0x07, 0x77]).copy(
      data,
      offset,
    )
    offset += 8

    // Name (string = 4-byte length + bytes)
    data.writeUInt32LE(nameBytes.length, offset)
    offset += 4
    nameBytes.copy(data, offset)
    offset += nameBytes.length

    // Symbol
    data.writeUInt32LE(symbolBytes.length, offset)
    offset += 4
    symbolBytes.copy(data, offset)
    offset += symbolBytes.length

    // URI
    data.writeUInt32LE(uriBytes.length, offset)
    offset += 4
    uriBytes.copy(data, offset)
    offset += uriBytes.length

    // Creator fee bps
    data.writeUInt16LE(params.creatorFeeBps ?? 100, offset)
    offset += 2

    // Graduation threshold
    const threshold =
      params.graduationThreshold ?? BigInt(85 * LAMPORTS_PER_SOL)
    data.writeBigUInt64LE(threshold, offset)

    instructions.push(
      new TransactionInstruction({
        keys: [
          { pubkey: creator, isSigner: true, isWritable: true },
          { pubkey: configPDA, isSigner: false, isWritable: true },
          { pubkey: tokenMint.publicKey, isSigner: true, isWritable: true },
          { pubkey: bondingCurvePDA, isSigner: false, isWritable: true },
          { pubkey: curveTokenAccount, isSigner: false, isWritable: true },
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

  async buyInstructions(
    tokenMint: PublicKey,
    buyer: PublicKey,
    solAmount: bigint,
    minTokensOut: bigint,
  ): Promise<TransactionInstruction[]> {
    const [configPDA] = this.getConfigPDA()
    const [bondingCurvePDA] = this.getBondingCurvePDA(tokenMint)
    const [vaultPDA] = this.getVaultPDA(tokenMint)

    const curveTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      bondingCurvePDA,
      true,
    )

    const buyerTokenAccount = await getAssociatedTokenAddress(tokenMint, buyer)

    const config = await this.getConfig()
    if (!config) throw new Error('Launchpad not initialized')

    const curve = await this.getBondingCurve(tokenMint)
    if (!curve) throw new Error('Bonding curve not found')

    const instructions: TransactionInstruction[] = []

    // Create buyer token account if needed
    const buyerAccountInfo =
      await this.connection.getAccountInfo(buyerTokenAccount)
    if (!buyerAccountInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          buyer,
          buyerTokenAccount,
          buyer,
          tokenMint,
        ),
      )
    }

    // Build buy instruction
    const data = Buffer.alloc(8 + 8 + 8)
    // Discriminator for buy
    Buffer.from([0x66, 0x06, 0x3d, 0x12, 0x01, 0xda, 0xeb, 0xea]).copy(data, 0)
    data.writeBigUInt64LE(solAmount, 8)
    data.writeBigUInt64LE(minTokensOut, 16)

    instructions.push(
      new TransactionInstruction({
        keys: [
          { pubkey: buyer, isSigner: true, isWritable: true },
          { pubkey: configPDA, isSigner: false, isWritable: false },
          { pubkey: bondingCurvePDA, isSigner: false, isWritable: true },
          { pubkey: curveTokenAccount, isSigner: false, isWritable: true },
          { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: config.feeRecipient, isSigner: false, isWritable: true },
          { pubkey: curve.creator, isSigner: false, isWritable: true },
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

  async sellInstructions(
    tokenMint: PublicKey,
    seller: PublicKey,
    tokenAmount: bigint,
    minSolOut: bigint,
  ): Promise<TransactionInstruction[]> {
    const [configPDA] = this.getConfigPDA()
    const [bondingCurvePDA] = this.getBondingCurvePDA(tokenMint)
    const [vaultPDA] = this.getVaultPDA(tokenMint)

    const curveTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      bondingCurvePDA,
      true,
    )

    const sellerTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      seller,
    )

    // Build sell instruction
    const data = Buffer.alloc(8 + 8 + 8)
    // Discriminator for sell
    Buffer.from([0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad]).copy(data, 0)
    data.writeBigUInt64LE(tokenAmount, 8)
    data.writeBigUInt64LE(minSolOut, 16)

    return [
      new TransactionInstruction({
        keys: [
          { pubkey: seller, isSigner: true, isWritable: true },
          { pubkey: configPDA, isSigner: false, isWritable: false },
          { pubkey: bondingCurvePDA, isSigner: false, isWritable: true },
          { pubkey: curveTokenAccount, isSigner: false, isWritable: true },
          { pubkey: sellerTokenAccount, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
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
    ]
  }

  // Bonding Curve Calculations

  calculateBuyAmount(curve: BondingCurve, solAmount: bigint): bigint {
    return calculateBondingCurveBuy(curve, solAmount)
  }

  calculateSellAmount(curve: BondingCurve, tokenAmount: bigint): bigint {
    return calculateBondingCurveSell(curve, tokenAmount)
  }

  getCurrentPrice(curve: BondingCurve): number {
    return getBondingCurvePrice(curve)
  }

  getProgress(curve: BondingCurve): number {
    return (
      (Number(curve.realSolReserves) / Number(curve.graduationThreshold)) * 100
    )
  }

  getMarketCap(curve: BondingCurve, totalSupply: bigint): number {
    const price = this.getCurrentPrice(curve)
    return price * Number(totalSupply)
  }

  // Presale Operations

  async createPresaleInstructions(
    params: CreatePresaleParams,
    creator: PublicKey,
  ): Promise<TransactionInstruction[]> {
    const [presalePDA] = this.getPresalePDA(params.tokenMint)

    // Build instruction data
    const data = Buffer.alloc(8 + 8 * 8)
    let offset = 0

    // Discriminator for create_presale
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]).copy(
      data,
      offset,
    )
    offset += 8

    data.writeBigUInt64LE(params.softCap, offset)
    offset += 8
    data.writeBigUInt64LE(params.hardCap, offset)
    offset += 8
    data.writeBigUInt64LE(params.minContribution, offset)
    offset += 8
    data.writeBigUInt64LE(params.maxContribution, offset)
    offset += 8
    data.writeBigInt64LE(params.startTime, offset)
    offset += 8
    data.writeBigInt64LE(params.endTime, offset)
    offset += 8
    data.writeBigUInt64LE(params.tokenPrice, offset)
    offset += 8
    data.writeBigInt64LE(params.vestingDuration ?? 0n, offset)

    return [
      new TransactionInstruction({
        keys: [
          { pubkey: creator, isSigner: true, isWritable: true },
          { pubkey: params.tokenMint, isSigner: false, isWritable: false },
          { pubkey: presalePDA, isSigner: false, isWritable: true },
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

  async contributeInstructions(
    tokenMint: PublicKey,
    contributor: PublicKey,
    amount: bigint,
  ): Promise<TransactionInstruction[]> {
    const [presalePDA] = this.getPresalePDA(tokenMint)
    const [vaultPDA] = this.getVaultPDA(tokenMint)
    const [contributionPDA] = this.getContributionPDA(presalePDA, contributor)

    const data = Buffer.alloc(8 + 8)
    // Discriminator for contribute
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02]).copy(data, 0)
    data.writeBigUInt64LE(amount, 8)

    return [
      new TransactionInstruction({
        keys: [
          { pubkey: contributor, isSigner: true, isWritable: true },
          { pubkey: presalePDA, isSigner: false, isWritable: true },
          { pubkey: contributionPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
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

  // Deserialization Helpers

  private deserializeConfig(data: Buffer): LaunchpadConfig {
    // Skip 8-byte discriminator
    let offset = 8

    const authority = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const feeRecipient = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const platformFeeBps = data.readUInt16LE(offset)
    offset += 2

    const totalLaunches = data.readBigUInt64LE(offset)

    return {
      authority,
      feeRecipient,
      platformFeeBps,
      totalLaunches,
    }
  }

  private deserializeBondingCurve(data: Buffer): BondingCurve {
    let offset = 8 // Skip discriminator

    const creator = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const tokenMint = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const virtualSolReserves = data.readBigUInt64LE(offset)
    offset += 8

    const virtualTokenReserves = data.readBigUInt64LE(offset)
    offset += 8

    const realSolReserves = data.readBigUInt64LE(offset)
    offset += 8

    const realTokenReserves = data.readBigUInt64LE(offset)
    offset += 8

    const tokensSold = data.readBigUInt64LE(offset)
    offset += 8

    const graduationThreshold = data.readBigUInt64LE(offset)
    offset += 8

    const creatorFeeBps = data.readUInt16LE(offset)
    offset += 2

    const graduated = data.readUInt8(offset) === 1
    offset += 1

    const createdAt = data.readBigInt64LE(offset)

    return {
      creator,
      tokenMint,
      virtualSolReserves,
      virtualTokenReserves,
      realSolReserves,
      realTokenReserves,
      tokensSold,
      graduationThreshold,
      creatorFeeBps,
      graduated,
      createdAt,
    }
  }

  private deserializePresale(data: Buffer): Presale {
    let offset = 8 // Skip discriminator

    const creator = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const tokenMint = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const softCap = data.readBigUInt64LE(offset)
    offset += 8

    const hardCap = data.readBigUInt64LE(offset)
    offset += 8

    const minContribution = data.readBigUInt64LE(offset)
    offset += 8

    const maxContribution = data.readBigUInt64LE(offset)
    offset += 8

    const startTime = data.readBigInt64LE(offset)
    offset += 8

    const endTime = data.readBigInt64LE(offset)
    offset += 8

    const tokenPrice = data.readBigUInt64LE(offset)
    offset += 8

    const vestingDuration = data.readBigInt64LE(offset)
    offset += 8

    const totalRaised = data.readBigUInt64LE(offset)
    offset += 8

    const totalContributors = data.readBigUInt64LE(offset)
    offset += 8

    const finalized = data.readUInt8(offset) === 1
    offset += 1

    const cancelled = data.readUInt8(offset) === 1
    offset += 1

    const finalizedAt = data.readBigInt64LE(offset)

    return {
      creator,
      tokenMint,
      softCap,
      hardCap,
      minContribution,
      maxContribution,
      startTime,
      endTime,
      tokenPrice,
      vestingDuration,
      totalRaised,
      totalContributors,
      finalized,
      cancelled,
      finalizedAt,
    }
  }

  private deserializeContribution(data: Buffer): Contribution {
    let offset = 8 // Skip discriminator

    const contributor = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const presale = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const amount = data.readBigUInt64LE(offset)
    offset += 8

    const tokensClaimed = data.readBigUInt64LE(offset)
    offset += 8

    const claimed = data.readUInt8(offset) === 1

    return {
      contributor,
      presale,
      amount,
      tokensClaimed,
      claimed,
    }
  }
}

export function createLaunchpadClient(
  connection: Connection,
  programId?: PublicKey,
): LaunchpadClient {
  return new LaunchpadClient(connection, programId)
}

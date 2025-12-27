// Solana SPL Token + Hyperlane Warp Route integration
// Uses Hyperlane for permissionless cross-chain (you run your own validators)

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import type { Address, Hex } from 'viem'
import { getDomainId } from '../config/domains'
import type { BridgeStatus, ChainId } from '../types'

// Hyperlane program IDs
const HYPERLANE_MAILBOX_MAINNET = new PublicKey(
  'EitxJuv2iBjsg2d7jVy2LDC1e2zBrx4GB5Y9h2Ko3A9Y',
)
const HYPERLANE_MAILBOX_DEVNET = new PublicKey(
  'E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi',
)
const HYPERLANE_IGP_MAINNET = new PublicKey(
  'Hs7KVBU67nBnWhDj4MWXdUCMJd6v5tQYNrVDRHhhmDPF',
)
const HYPERLANE_IGP_DEVNET = new PublicKey(
  '3TJMcAhHRE7JN98URK7s5eeGfmVSvL4GAgegPq5K2nYg',
)

// Interchain gas fees (static estimates - production should query IGP dynamically)
// Ethereum ~0.01 SOL, L2s ~0.002 SOL, Alt-L1s ~0.003 SOL
const INTERCHAIN_GAS_FEES = {
  ETHEREUM: BigInt(LAMPORTS_PER_SOL * 0.01),
  OPTIMISM: BigInt(LAMPORTS_PER_SOL * 0.002),
  BASE: BigInt(LAMPORTS_PER_SOL * 0.002),
  ARBITRUM: BigInt(LAMPORTS_PER_SOL * 0.002),
  BSC: BigInt(LAMPORTS_PER_SOL * 0.003),
  POLYGON: BigInt(LAMPORTS_PER_SOL * 0.003),
  DEFAULT: BigInt(LAMPORTS_PER_SOL * 0.01),
} as const

const SOLANA_TX_FEE_LAMPORTS = BigInt(5000)
const ESTIMATED_DELIVERY_SECONDS = 60

export interface SolanaTokenConfig {
  mintAuthority: PublicKey
  freezeAuthority: PublicKey | null
  decimals: number
  initialSupply: bigint
}

export interface SolanaWarpRouteConfig {
  mint: PublicKey
  warpRoute: PublicKey
  ism: PublicKey
  owner: PublicKey
  rateLimitPerDay: bigint
}

export interface SolanaTransferParams {
  sourceChain: 'solana-mainnet' | 'solana-devnet'
  destinationChain: ChainId
  recipient: Address
  amount: bigint
  sender: PublicKey
}

export interface SolanaTransferQuote {
  interchainGasFee: bigint
  transactionFee: bigint
  totalFee: bigint
  estimatedTime: number
}

export class SolanaAdapter {
  private readonly connection: Connection
  private readonly mailbox: PublicKey
  private readonly igp: PublicKey

  constructor(rpcUrl: string, isMainnet: boolean = true) {
    this.connection = new Connection(rpcUrl, 'confirmed')
    this.mailbox = isMainnet
      ? HYPERLANE_MAILBOX_MAINNET
      : HYPERLANE_MAILBOX_DEVNET
    this.igp = isMainnet ? HYPERLANE_IGP_MAINNET : HYPERLANE_IGP_DEVNET
  }

  async createToken(
    payer: Keypair,
    config: SolanaTokenConfig,
  ): Promise<{ mint: PublicKey; tx: string }> {
    const mintKeypair = Keypair.generate()
    const lamports =
      await this.connection.getMinimumBalanceForRentExemption(MINT_SIZE)

    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        config.decimals,
        config.mintAuthority,
        config.freezeAuthority,
        TOKEN_PROGRAM_ID,
      ),
    )

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [payer, mintKeypair],
    )

    return {
      mint: mintKeypair.publicKey,
      tx: signature,
    }
  }

  async createTokenAccount(
    payer: Keypair,
    mint: PublicKey,
    owner: PublicKey,
  ): Promise<PublicKey> {
    const associatedTokenAccount = await getAssociatedTokenAddress(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        associatedTokenAccount,
        owner,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    )

    await sendAndConfirmTransaction(this.connection, transaction, [payer])

    return associatedTokenAccount
  }

  // Production should query IGP on-chain for real quotes
  async quoteTransfer(
    destinationDomain: number,
    _amount: bigint,
  ): Promise<SolanaTransferQuote> {
    const baseGasFee = this.getEstimatedGasFee(destinationDomain)

    return {
      interchainGasFee: baseGasFee,
      transactionFee: SOLANA_TX_FEE_LAMPORTS,
      totalFee: baseGasFee + SOLANA_TX_FEE_LAMPORTS,
      estimatedTime: ESTIMATED_DELIVERY_SECONDS,
    }
  }

  async initiateTransfer(
    payer: Keypair,
    warpRouteConfig: SolanaWarpRouteConfig,
    params: SolanaTransferParams,
  ): Promise<BridgeStatus> {
    // Validate transfer parameters
    if (params.amount <= 0n) {
      throw new Error('Transfer amount must be positive')
    }

    // Validate recipient address format (EVM address)
    if (!/^0x[a-fA-F0-9]{40}$/.test(params.recipient)) {
      throw new Error(
        `Invalid recipient address: ${params.recipient}. Must be a valid EVM address (0x + 40 hex chars).`,
      )
    }

    // Validate source chain
    if (
      params.sourceChain !== 'solana-mainnet' &&
      params.sourceChain !== 'solana-devnet'
    ) {
      throw new Error(
        `Invalid source chain: ${params.sourceChain}. Must be 'solana-mainnet' or 'solana-devnet'.`,
      )
    }

    const destinationDomain = this.getEvmDomainId(params.destinationChain)
    const quote = await this.quoteTransfer(destinationDomain, params.amount)
    const userTokenAccount = await getAssociatedTokenAddress(
      warpRouteConfig.mint,
      params.sender,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const transferInstruction = this.buildWarpTransferInstruction(
      warpRouteConfig.warpRoute,
      userTokenAccount,
      warpRouteConfig.mint,
      params.sender,
      destinationDomain,
      params.recipient,
      params.amount,
    )

    const gasPaymentInstruction = this.buildGasPaymentInstruction(
      params.sender,
      destinationDomain,
      quote.interchainGasFee,
    )

    const transaction = new Transaction().add(
      transferInstruction,
      gasPaymentInstruction,
    )

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [payer],
    )

    return {
      requestId: this.generateMessageId(signature),
      status: 'dispatched',
      sourceChain: params.sourceChain,
      destinationChain: params.destinationChain,
      amount: params.amount,
      sourceTxHash: signature as Hex,
    }
  }

  /**
   * Handle incoming cross-chain transfer from Hyperlane.
   * SECURITY: This function MUST only be called by the Hyperlane mailbox program
   * after message verification through the ISM (Interchain Security Module).
   *
   * The actual minting is performed via the warp route program which enforces:
   * 1. Message origin validation through the mailbox
   * 2. ISM signature verification (multisig or optimistic)
   * 3. Rate limiting per day
   *
   * This TypeScript function builds the instruction - the on-chain program
   * validates that the caller is the authorized warp route handler.
   */
  async handleIncomingTransfer(
    payer: Keypair,
    warpRouteConfig: SolanaWarpRouteConfig,
    originDomain: number,
    sender: Hex,
    recipient: PublicKey,
    amount: bigint,
    message: Buffer,
  ): Promise<string> {
    // Validate origin domain is a known EVM domain
    const knownDomains = [1, 10, 56, 137, 8453, 42161, 43114] // Ethereum, Optimism, BSC, Polygon, Base, Arbitrum, Avalanche
    if (!knownDomains.includes(originDomain)) {
      throw new Error(
        `Invalid origin domain: ${originDomain}. Must be one of: ${knownDomains.join(', ')}`,
      )
    }

    // Validate sender is a valid EVM address format (bytes32 with 12 leading zeros)
    if (!sender || !/^0x[0]{24}[a-fA-F0-9]{40}$/.test(sender)) {
      throw new Error(
        `Invalid sender address format: ${sender}. Expected bytes32 with EVM address in lower 20 bytes.`,
      )
    }

    // Validate message is not empty and has minimum expected length
    // Hyperlane message format: version(1) + nonce(4) + origin(4) + sender(32) + destination(4) + recipient(32) + body
    const MIN_MESSAGE_LENGTH = 77 // 1 + 4 + 4 + 32 + 4 + 32 = 77 bytes minimum
    if (!message || message.length < MIN_MESSAGE_LENGTH) {
      throw new Error(
        `Invalid message: expected at least ${MIN_MESSAGE_LENGTH} bytes, got ${message.length ?? 0}`,
      )
    }

    // Validate amount is positive and within rate limits
    if (amount <= 0n) {
      throw new Error('Transfer amount must be positive')
    }

    if (amount > warpRouteConfig.rateLimitPerDay) {
      throw new Error(
        `Amount ${amount} exceeds daily rate limit of ${warpRouteConfig.rateLimitPerDay}`,
      )
    }

    const recipientTokenAccount = await getAssociatedTokenAddress(
      warpRouteConfig.mint,
      recipient,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const accountInfo = await this.connection.getAccountInfo(
      recipientTokenAccount,
    )
    if (!accountInfo) {
      await this.createTokenAccount(payer, warpRouteConfig.mint, recipient)
    }

    // Build the warp route handle instruction that processes the Hyperlane message
    // The on-chain warp route program will verify:
    // 1. The message was dispatched from the origin mailbox
    // 2. The ISM has validated the message signatures
    // 3. The message hasn't been processed before (replay protection)
    const handleInstruction = this.buildWarpHandleInstruction(
      warpRouteConfig.warpRoute,
      warpRouteConfig.mint,
      recipientTokenAccount,
      payer.publicKey,
      originDomain,
      sender,
      amount,
      message,
    )

    const transaction = new Transaction().add(handleInstruction)
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [payer],
    )

    return signature
  }

  /**
   * Build warp route handle instruction for processing incoming Hyperlane messages.
   * This instruction is validated on-chain by the warp route program.
   */
  private buildWarpHandleInstruction(
    warpRouteProgram: PublicKey,
    mint: PublicKey,
    recipientTokenAccount: PublicKey,
    payer: PublicKey,
    originDomain: number,
    sender: Hex,
    amount: bigint,
    message: Buffer,
  ): TransactionInstruction {
    // Layout: 1B discriminator (0x03 = handle) + 4B origin + 32B sender + 8B amount + message
    const senderBytes = Buffer.from(sender.slice(2), 'hex')
    const data = Buffer.alloc(45 + message.length)
    data.writeUInt8(0x03, 0) // handle discriminator
    data.writeUInt32LE(originDomain, 1)
    senderBytes.copy(data, 5)
    data.writeBigUInt64LE(amount, 37)
    message.copy(data, 45)

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: recipientTokenAccount, isSigner: false, isWritable: true },
      { pubkey: this.mailbox, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]

    return new TransactionInstruction({
      keys,
      programId: warpRouteProgram,
      data,
    })
  }

  private buildWarpTransferInstruction(
    warpRouteProgram: PublicKey,
    userTokenAccount: PublicKey,
    mint: PublicKey,
    sender: PublicKey,
    destinationDomain: number,
    recipient: Address,
    amount: bigint,
  ): TransactionInstruction {
    // Validate amount fits in uint64 (Solana uses u64 for token amounts)
    const MAX_UINT64 = 18446744073709551615n
    if (amount > MAX_UINT64) {
      throw new Error(
        `Amount ${amount} exceeds maximum uint64 value (${MAX_UINT64})`,
      )
    }

    const recipientBytes = Buffer.alloc(32)
    Buffer.from(recipient.slice(2).toLowerCase(), 'hex').copy(
      recipientBytes,
      12,
    )

    // Layout: 1B discriminator + 4B domain + 32B recipient + 8B amount
    const data = Buffer.alloc(45)
    data.writeUInt8(0x01, 0)
    data.writeUInt32LE(destinationDomain, 1)
    recipientBytes.copy(data, 5)
    data.writeBigUInt64LE(amount, 37)

    const keys = [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: this.mailbox, isSigner: false, isWritable: true },
      { pubkey: this.igp, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]

    return new TransactionInstruction({
      keys,
      programId: warpRouteProgram,
      data,
    })
  }

  private buildGasPaymentInstruction(
    payer: PublicKey,
    destinationDomain: number,
    amount: bigint,
  ): TransactionInstruction {
    // Validate amount fits in uint64
    const MAX_UINT64 = 18446744073709551615n
    if (amount > MAX_UINT64) {
      throw new Error(
        `Gas payment amount ${amount} exceeds maximum uint64 value (${MAX_UINT64})`,
      )
    }

    const data = Buffer.alloc(13)
    data.writeUInt8(0x02, 0)
    data.writeUInt32LE(destinationDomain, 1)
    data.writeBigUInt64LE(amount, 5)

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: this.igp, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]

    return new TransactionInstruction({
      keys,
      programId: this.igp,
      data,
    })
  }

  private getEstimatedGasFee(destinationDomain: number): bigint {
    const feesByDomain: Record<number, bigint> = {
      1: INTERCHAIN_GAS_FEES.ETHEREUM,
      10: INTERCHAIN_GAS_FEES.OPTIMISM,
      8453: INTERCHAIN_GAS_FEES.BASE,
      42161: INTERCHAIN_GAS_FEES.ARBITRUM,
      56: INTERCHAIN_GAS_FEES.BSC,
      137: INTERCHAIN_GAS_FEES.POLYGON,
      43114: INTERCHAIN_GAS_FEES.DEFAULT, // Avalanche
    }
    const fee = feesByDomain[destinationDomain]
    if (fee === undefined) {
      throw new Error(
        `Unknown destination domain: ${destinationDomain}. Supported domains: ${Object.keys(feesByDomain).join(', ')}`,
      )
    }
    return fee
  }

  private getEvmDomainId(chainId: ChainId): number {
    return getDomainId(chainId)
  }

  private generateMessageId(signature: string): Hex {
    return `0x${Buffer.from(signature).toString('hex').padStart(64, '0').slice(0, 64)}` as Hex
  }

  async getTokenInfo(mint: PublicKey): Promise<{
    supply: bigint
    decimals: number
    mintAuthority: PublicKey | null
    freezeAuthority: PublicKey | null
  }> {
    const mintInfo = await getMint(this.connection, mint)
    return {
      supply: mintInfo.supply,
      decimals: mintInfo.decimals,
      mintAuthority: mintInfo.mintAuthority,
      freezeAuthority: mintInfo.freezeAuthority,
    }
  }

  async getTokenBalance(mint: PublicKey, owner: PublicKey): Promise<bigint> {
    const tokenAccount = await getAssociatedTokenAddress(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const accountInfo = await this.connection.getAccountInfo(tokenAccount)
    if (!accountInfo) {
      return 0n
    }

    const account = await getAccount(this.connection, tokenAccount)
    return account.amount
  }

  async getSolBalance(address: PublicKey): Promise<bigint> {
    const balance = await this.connection.getBalance(address)
    return BigInt(balance)
  }
}

/**
 * Solana x402 Payment Facilitator Client
 *
 * Enables x402 micropayments on Solana using SPL tokens (USDC, etc.)
 *
 * @example
 * ```typescript
 * import { SolanaX402Client } from '@jejunetwork/solana/x402';
 *
 * const client = new SolanaX402Client(connection, wallet);
 *
 * // Create payment authorization
 * const payment = await client.createPayment({
 *   recipient: 'service-wallet-pubkey',
 *   token: USDC_MINT,
 *   amount: 1_000_000, // 1 USDC
 *   resource: '/api/ai/inference',
 * });
 *
 * // Submit to service with X-Payment header
 * const response = await fetch('/api/ai/inference', {
 *   headers: { 'X-Payment': payment.encoded },
 * });
 * ```
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Program ID (matches Anchor declare_id!)
export const X402_FACILITATOR_PROGRAM_ID = new PublicKey(
  'x4o2Faci11111111111111111111111111111111111'
);

// Known SPL token mints
export const SPL_TOKENS = {
  // Mainnet
  USDC_MAINNET: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT_MAINNET: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
  
  // Devnet
  USDC_DEVNET: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
  
  // Testnet
  USDC_TESTNET: new PublicKey('CpMah17kQEL2wqyMKt3mZBdTnZbkbfx4nqmQMFDP5vwp'),
} as const;

export interface X402PaymentParams {
  /** Recipient public key */
  recipient: PublicKey | string;
  /** SPL token mint */
  token: PublicKey | string;
  /** Amount in token base units */
  amount: bigint | number;
  /** Resource being paid for */
  resource: string;
  /** Optional custom nonce (generated if not provided) */
  nonce?: string;
  /** Optional timestamp (current time if not provided) */
  timestamp?: number;
}

export interface X402Payment {
  /** Payer public key */
  payer: PublicKey;
  /** Recipient public key */
  recipient: PublicKey;
  /** Token mint */
  token: PublicKey;
  /** Amount in base units */
  amount: bigint;
  /** Resource identifier */
  resource: string;
  /** Unique nonce */
  nonce: string;
  /** Payment timestamp */
  timestamp: number;
  /** Ed25519 signature */
  signature: Uint8Array;
  /** Base64-encoded payment for X-Payment header */
  encoded: string;
}

export interface X402SettleParams {
  payment: X402Payment;
  /** Recipient's token account (created if not exists) */
  recipientTokenAccount?: PublicKey;
  /** Fee token account */
  feeTokenAccount?: PublicKey;
}

export interface X402FacilitatorConfig {
  /** Protocol fee in basis points */
  protocolFeeBps: number;
  /** Fee recipient */
  feeRecipient: PublicKey;
  /** Total settlements processed */
  totalSettlements: bigint;
  /** Total volume processed */
  totalVolume: bigint;
  /** Total fees collected */
  totalFees: bigint;
  /** Whether facilitator is paused */
  paused: boolean;
}

export class SolanaX402Client {
  private connection: Connection;
  private programId: PublicKey;

  constructor(
    connection: Connection,
    programId: PublicKey = X402_FACILITATOR_PROGRAM_ID
  ) {
    this.connection = connection;
    this.programId = programId;
  }

  /**
   * Create a signed x402 payment authorization
   */
  async createPayment(
    params: X402PaymentParams,
    payer: Keypair
  ): Promise<X402Payment> {
    const recipient = new PublicKey(params.recipient);
    const token = new PublicKey(params.token);
    const amount = BigInt(params.amount);
    const nonce = params.nonce || this.generateNonce();
    const timestamp = params.timestamp || Math.floor(Date.now() / 1000);

    // Build message for signing
    const message = this.buildPaymentMessage({
      recipient,
      token,
      amount,
      resource: params.resource,
      nonce,
      timestamp,
    });

    // Sign with Ed25519
    const ed25519 = await import('@noble/ed25519');
    const signature = await ed25519.sign(message, payer.secretKey.slice(0, 32));

    // Encode payment for HTTP header
    const encoded = this.encodePayment({
      payer: payer.publicKey,
      recipient,
      token,
      amount,
      resource: params.resource,
      nonce,
      timestamp,
      signature,
    });

    return {
      payer: payer.publicKey,
      recipient,
      token,
      amount,
      resource: params.resource,
      nonce,
      timestamp,
      signature,
      encoded,
    };
  }

  /**
   * Verify a payment authorization
   */
  async verifyPayment(payment: X402Payment): Promise<boolean> {
    const message = this.buildPaymentMessage({
      recipient: payment.recipient,
      token: payment.token,
      amount: payment.amount,
      resource: payment.resource,
      nonce: payment.nonce,
      timestamp: payment.timestamp,
    });

    // Verify Ed25519 signature
    const { verify } = await import('@noble/ed25519');
    return verify(payment.signature, message, payment.payer.toBytes());
  }

  /**
   * Decode an X-Payment header
   */
  decodePayment(encoded: string): X402Payment {
    const decoded = Buffer.from(encoded, 'base64');
    const json = JSON.parse(decoded.toString('utf-8')) as {
      payer: string;
      recipient: string;
      token: string;
      amount: string;
      resource: string;
      nonce: string;
      timestamp: number;
      signature: string;
    };

    return {
      payer: new PublicKey(json.payer),
      recipient: new PublicKey(json.recipient),
      token: new PublicKey(json.token),
      amount: BigInt(json.amount),
      resource: json.resource,
      nonce: json.nonce,
      timestamp: json.timestamp,
      signature: hexToBytes(json.signature),
      encoded,
    };
  }

  /**
   * Settle a payment on-chain
   */
  async settle(
    params: X402SettleParams,
    submitter: Keypair
  ): Promise<string> {
    const { payment } = params;

    // Get or create token accounts
    const payerTokenAccount = await getAssociatedTokenAddress(
      payment.token,
      payment.payer
    );

    const recipientTokenAccount =
      params.recipientTokenAccount ||
      (await getAssociatedTokenAddress(payment.token, payment.recipient));

    // Get facilitator state PDA
    const [statePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('facilitator_state')],
      this.programId
    );

    // Get token config PDA
    const [tokenConfigPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_config'), payment.token.toBuffer()],
      this.programId
    );

    // Get nonce PDA
    const [noncePDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('nonce'),
        payment.payer.toBuffer(),
        Buffer.from(payment.nonce),
      ],
      this.programId
    );

    // Get fee token account
    const config = await this.getFacilitatorConfig();
    const feeTokenAccount =
      params.feeTokenAccount ||
      (await getAssociatedTokenAddress(payment.token, config.feeRecipient));

    // Build transaction
    const tx = new Transaction();

    // Check if recipient token account exists
    const recipientAccountInfo = await this.connection.getAccountInfo(
      recipientTokenAccount
    );
    if (!recipientAccountInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          submitter.publicKey,
          recipientTokenAccount,
          payment.recipient,
          payment.token
        )
      );
    }

    // Add settle instruction
    tx.add(
      this.createSettleInstruction({
        state: statePDA,
        tokenConfig: tokenConfigPDA,
        nonceAccount: noncePDA,
        mint: payment.token,
        payer: payment.payer,
        payerTokenAccount,
        recipient: payment.recipient,
        recipientTokenAccount,
        feeTokenAccount,
        submitter: submitter.publicKey,
        amount: payment.amount,
        resource: payment.resource,
        nonce: payment.nonce,
        timestamp: payment.timestamp,
        signature: payment.signature,
      })
    );

    // Send transaction
    const signature = await this.connection.sendTransaction(tx, [submitter]);
    await this.connection.confirmTransaction(signature);

    return signature;
  }

  /**
   * Get facilitator configuration
   */
  async getFacilitatorConfig(): Promise<X402FacilitatorConfig> {
    const [statePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('facilitator_state')],
      this.programId
    );

    const accountInfo = await this.connection.getAccountInfo(statePDA);
    if (!accountInfo) {
      throw new Error('Facilitator not initialized');
    }

    // Parse account data (skip 8-byte discriminator)
    const data = accountInfo.data.slice(8);

    return {
      protocolFeeBps: data.readUInt16LE(64), // After admin + fee_recipient
      feeRecipient: new PublicKey(data.slice(32, 64)),
      totalSettlements: data.readBigUInt64LE(66),
      totalVolume: data.readBigUInt64LE(74),
      totalFees: data.readBigUInt64LE(82),
      paused: data.readUInt8(90) === 1,
    };
  }

  /**
   * Check if a token is supported
   */
  async isTokenSupported(token: PublicKey): Promise<boolean> {
    const [tokenConfigPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_config'), token.toBuffer()],
      this.programId
    );

    const accountInfo = await this.connection.getAccountInfo(tokenConfigPDA);
    if (!accountInfo) return false;

    // Check enabled flag (skip discriminator + mint + decimals)
    const data = accountInfo.data.slice(8);
    return data.readUInt8(33) === 1;
  }

  /**
   * Check if a nonce has been used
   */
  async isNonceUsed(payer: PublicKey, nonce: string): Promise<boolean> {
    const [noncePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('nonce'), payer.toBuffer(), Buffer.from(nonce)],
      this.programId
    );

    const accountInfo = await this.connection.getAccountInfo(noncePDA);
    if (!accountInfo) return false;

    // Check used flag
    const data = accountInfo.data.slice(8);
    return data.readUInt8(0) === 1;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private buildPaymentMessage(params: {
    recipient: PublicKey;
    token: PublicKey;
    amount: bigint;
    resource: string;
    nonce: string;
    timestamp: number;
  }): Uint8Array {
    const prefix = Buffer.from('x402:solana:payment:v1:');
    const recipient = params.recipient.toBuffer();
    const token = params.token.toBuffer();
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(params.amount);
    const resource = Buffer.from(params.resource);
    const nonce = Buffer.from(params.nonce);
    const timestamp = Buffer.alloc(8);
    timestamp.writeBigInt64LE(BigInt(params.timestamp));

    return Buffer.concat([
      prefix,
      recipient,
      Buffer.from(':'),
      token,
      Buffer.from(':'),
      amount,
      Buffer.from(':'),
      resource,
      Buffer.from(':'),
      nonce,
      Buffer.from(':'),
      timestamp,
    ]);
  }

  private encodePayment(payment: Omit<X402Payment, 'encoded'>): string {
    const json = JSON.stringify({
      payer: payment.payer.toBase58(),
      recipient: payment.recipient.toBase58(),
      token: payment.token.toBase58(),
      amount: payment.amount.toString(),
      resource: payment.resource,
      nonce: payment.nonce,
      timestamp: payment.timestamp,
      signature: bytesToHex(payment.signature),
    });

    return Buffer.from(json).toString('base64');
  }

  private generateNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }

  private createSettleInstruction(params: {
    state: PublicKey;
    tokenConfig: PublicKey;
    nonceAccount: PublicKey;
    mint: PublicKey;
    payer: PublicKey;
    payerTokenAccount: PublicKey;
    recipient: PublicKey;
    recipientTokenAccount: PublicKey;
    feeTokenAccount: PublicKey;
    submitter: PublicKey;
    amount: bigint;
    resource: string;
    nonce: string;
    timestamp: number;
    signature: Uint8Array;
  }): TransactionInstruction {
    // Instruction data layout:
    // - 8 bytes: discriminator (Anchor)
    // - 8 bytes: amount
    // - 4 bytes: resource length
    // - N bytes: resource
    // - 4 bytes: nonce length
    // - N bytes: nonce
    // - 8 bytes: timestamp
    // - 64 bytes: signature

    const resourceBuf = Buffer.from(params.resource);
    const nonceBuf = Buffer.from(params.nonce);

    const dataLen =
      8 + 8 + 4 + resourceBuf.length + 4 + nonceBuf.length + 8 + 64;
    const data = Buffer.alloc(dataLen);

    let offset = 0;

    // Discriminator for "settle" instruction
    const discriminator = sha256('global:settle').slice(0, 8);
    data.set(discriminator, offset);
    offset += 8;

    // Amount
    data.writeBigUInt64LE(params.amount, offset);
    offset += 8;

    // Resource
    data.writeUInt32LE(resourceBuf.length, offset);
    offset += 4;
    resourceBuf.copy(data, offset);
    offset += resourceBuf.length;

    // Nonce
    data.writeUInt32LE(nonceBuf.length, offset);
    offset += 4;
    nonceBuf.copy(data, offset);
    offset += nonceBuf.length;

    // Timestamp
    data.writeBigInt64LE(BigInt(params.timestamp), offset);
    offset += 8;

    // Signature
    data.set(params.signature, offset);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: params.state, isSigner: false, isWritable: true },
        { pubkey: params.tokenConfig, isSigner: false, isWritable: true },
        { pubkey: params.nonceAccount, isSigner: false, isWritable: true },
        { pubkey: params.mint, isSigner: false, isWritable: false },
        { pubkey: params.payer, isSigner: true, isWritable: false },
        { pubkey: params.payerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: params.recipient, isSigner: false, isWritable: false },
        {
          pubkey: params.recipientTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: params.feeTokenAccount, isSigner: false, isWritable: true },
        { pubkey: params.submitter, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }
}

// Export convenience functions
export async function createSolanaX402Payment(
  connection: Connection,
  payer: Keypair,
  params: X402PaymentParams
): Promise<X402Payment> {
  const client = new SolanaX402Client(connection);
  return client.createPayment(params, payer);
}

export async function verifySolanaX402Payment(
  connection: Connection,
  payment: X402Payment
): Promise<boolean> {
  const client = new SolanaX402Client(connection);
  return client.verifyPayment(payment);
}


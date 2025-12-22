// Solana x402 Payment Client

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Ed25519Program,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { z } from 'zod';
import { expectJson } from '@jejunetwork/types/validation';

export const X402_FACILITATOR_PROGRAM_ID = new PublicKey(
  'x4o2Faci11111111111111111111111111111111111'
);

// ============================================================================
// Zod Schemas for External Data Validation
// ============================================================================

/**
 * Schema for validating encoded payment JSON from external sources
 */
const X402EncodedPaymentSchema = z.object({
  payer: z.string().min(32).max(50), // Base58 Solana address
  recipient: z.string().min(32).max(50),
  token: z.string().min(32).max(50),
  amount: z.string().regex(/^\d+$/, 'Amount must be numeric string'),
  resource: z.string(),
  nonce: z.string().min(1),
  timestamp: z.number().int().positive(),
  signature: z.string().regex(/^[0-9a-fA-F]+$/, 'Signature must be hex string'),
});

export const SPL_TOKENS = {
  USDC_MAINNET: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT_MAINNET: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
  USDC_DEVNET: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
} as const;

export interface X402PaymentParams {
  recipient: PublicKey | string;
  token: PublicKey | string;
  amount: bigint | number;
  resource: string;
  nonce?: string;
  timestamp?: number;
}

export interface X402Payment {
  payer: PublicKey;
  recipient: PublicKey;
  token: PublicKey;
  amount: bigint;
  resource: string;
  nonce: string;
  timestamp: number;
  signature: Uint8Array;
  encoded: string;
}

const MESSAGE_PREFIX = Buffer.from('x402:solana:payment:v1:');

export class SolanaX402Client {
  constructor(
    private connection: Connection,
    private programId: PublicKey = X402_FACILITATOR_PROGRAM_ID
  ) {}

  async createPayment(params: X402PaymentParams, payer: Keypair): Promise<X402Payment> {
    const recipient = new PublicKey(params.recipient);
    const token = new PublicKey(params.token);
    const amount = BigInt(params.amount);
    const nonce = params.nonce ?? this.generateNonce();
    const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);

    const message = this.buildMessage({ recipient, token, amount, resource: params.resource, nonce, timestamp });
    const ed25519 = await import('@noble/ed25519');
    const signature = await ed25519.sign(message, payer.secretKey.slice(0, 32));

    const encoded = this.encode({
      payer: payer.publicKey,
      recipient,
      token,
      amount,
      resource: params.resource,
      nonce,
      timestamp,
      signature,
    });

    return { payer: payer.publicKey, recipient, token, amount, resource: params.resource, nonce, timestamp, signature, encoded };
  }

  async verifyPayment(payment: X402Payment): Promise<boolean> {
    const message = this.buildMessage(payment);
    const { verify } = await import('@noble/ed25519');
    return verify(payment.signature, message, payment.payer.toBytes());
  }

  decodePayment(encoded: string): X402Payment {
    const jsonString = Buffer.from(encoded, 'base64').toString('utf-8');
    const json = expectJson(jsonString, X402EncodedPaymentSchema, 'x402 encoded payment');
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

  async isNonceUsed(payer: PublicKey, nonce: string): Promise<boolean> {
    const [noncePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('nonce'), payer.toBuffer(), Buffer.from(nonce)],
      this.programId
    );
    const info = await this.connection.getAccountInfo(noncePDA);
    return info !== null && info.data[8] === 1;
  }

  async settle(payment: X402Payment, submitter: Keypair, feeRecipient: PublicKey): Promise<string> {
    const tx = new Transaction();

    // Ed25519 verification must come first
    const message = this.buildMessage(payment);
    tx.add(Ed25519Program.createInstructionWithPublicKey({
      publicKey: payment.payer.toBytes(),
      message,
      signature: payment.signature,
    }));

    const payerTokenAccount = await getAssociatedTokenAddress(payment.token, payment.payer);
    const recipientTokenAccount = await getAssociatedTokenAddress(payment.token, payment.recipient);
    const feeTokenAccount = await getAssociatedTokenAddress(payment.token, feeRecipient);

    // Create recipient token account if needed
    if (!(await this.connection.getAccountInfo(recipientTokenAccount))) {
      tx.add(createAssociatedTokenAccountInstruction(
        submitter.publicKey, recipientTokenAccount, payment.recipient, payment.token
      ));
    }

    const statePDA = this.getStatePDA();
    const tokenConfigPDA = this.getTokenConfigPDA(payment.token);
    const noncePDA = this.getNoncePDA(payment.payer, payment.nonce);

    // Anchor instruction data
    const discriminator = Buffer.from([175, 168, 155, 219, 86, 173, 53, 224]);
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(payment.amount);
    const resourceBuf = Buffer.from(payment.resource);
    const resourceLenBuf = Buffer.alloc(4);
    resourceLenBuf.writeUInt32LE(resourceBuf.length);
    const nonceBuf = Buffer.from(payment.nonce);
    const nonceLenBuf = Buffer.alloc(4);
    nonceLenBuf.writeUInt32LE(nonceBuf.length);
    const timestampBuf = Buffer.alloc(8);
    timestampBuf.writeBigInt64LE(BigInt(payment.timestamp));

    tx.add(new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: statePDA, isSigner: false, isWritable: true },
        { pubkey: tokenConfigPDA, isSigner: false, isWritable: true },
        { pubkey: noncePDA, isSigner: false, isWritable: true },
        { pubkey: payment.token, isSigner: false, isWritable: false },
        { pubkey: payment.payer, isSigner: false, isWritable: false },
        { pubkey: payerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: payment.recipient, isSigner: false, isWritable: false },
        { pubkey: recipientTokenAccount, isSigner: false, isWritable: true },
        { pubkey: feeTokenAccount, isSigner: false, isWritable: true },
        { pubkey: submitter.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([discriminator, amountBuf, resourceLenBuf, resourceBuf, nonceLenBuf, nonceBuf, timestampBuf, Buffer.from(payment.signature)]),
    }));

    const sig = await this.connection.sendTransaction(tx, [submitter]);
    await this.connection.confirmTransaction(sig);
    return sig;
  }

  getStatePDA(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('facilitator_state')], this.programId)[0];
  }

  getTokenConfigPDA(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('token_config'), mint.toBuffer()], this.programId)[0];
  }

  getNoncePDA(payer: PublicKey, nonce: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('nonce'), payer.toBuffer(), Buffer.from(nonce)],
      this.programId
    )[0];
  }

  private buildMessage(p: { recipient: PublicKey; token: PublicKey; amount: bigint; resource: string; nonce: string; timestamp: number }): Uint8Array {
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(p.amount);
    const tsBuf = Buffer.alloc(8);
    tsBuf.writeBigInt64LE(BigInt(p.timestamp));
    return Buffer.concat([
      MESSAGE_PREFIX,
      p.recipient.toBuffer(), Buffer.from(':'),
      p.token.toBuffer(), Buffer.from(':'),
      amountBuf, Buffer.from(':'),
      Buffer.from(p.resource), Buffer.from(':'),
      Buffer.from(p.nonce), Buffer.from(':'),
      tsBuf,
    ]);
  }

  private encode(p: Omit<X402Payment, 'encoded'>): string {
    return Buffer.from(JSON.stringify({
      payer: p.payer.toBase58(),
      recipient: p.recipient.toBase58(),
      token: p.token.toBase58(),
      amount: p.amount.toString(),
      resource: p.resource,
      nonce: p.nonce,
      timestamp: p.timestamp,
      signature: bytesToHex(p.signature),
    })).toString('base64');
  }

  private generateNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }
}

// Convenience exports
export async function createSolanaX402Payment(
  connection: Connection,
  payer: Keypair,
  params: X402PaymentParams
): Promise<X402Payment> {
  return new SolanaX402Client(connection).createPayment(params, payer);
}

export async function verifySolanaX402Payment(
  connection: Connection,
  payment: X402Payment
): Promise<boolean> {
  return new SolanaX402Client(connection).verifyPayment(payment);
}

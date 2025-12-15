// Solana SPL Token + Hyperlane Warp Route integration
// Uses Hyperlane for permissionless cross-chain (you run your own validators)

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { Address, Hex } from 'viem';
import { getDomainId } from '../config/domains';
import type { BridgeStatus, ChainId } from '../types';

// Hyperlane program IDs
const HYPERLANE_MAILBOX_MAINNET = new PublicKey(
  'EitxJuv2iBjsg2d7jVy2LDC1e2zBrx4GB5Y9h2Ko3A9Y'
);
const HYPERLANE_MAILBOX_DEVNET = new PublicKey(
  'E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi'
);
const HYPERLANE_IGP_MAINNET = new PublicKey(
  'Hs7KVBU67nBnWhDj4MWXdUCMJd6v5tQYNrVDRHhhmDPF'
);
const HYPERLANE_IGP_DEVNET = new PublicKey(
  '3TJMcAhHRE7JN98URK7s5eeGfmVSvL4GAgegPq5K2nYg'
);

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
} as const;

const SOLANA_TX_FEE_LAMPORTS = BigInt(5000);
const ESTIMATED_DELIVERY_SECONDS = 60;

export interface SolanaTokenConfig {
  mintAuthority: PublicKey;
  freezeAuthority: PublicKey | null;
  decimals: number;
  initialSupply: bigint;
}

export interface SolanaWarpRouteConfig {
  mint: PublicKey;
  warpRoute: PublicKey;
  ism: PublicKey;
  owner: PublicKey;
  rateLimitPerDay: bigint;
}

export interface SolanaTransferParams {
  sourceChain: 'solana-mainnet' | 'solana-devnet';
  destinationChain: ChainId;
  recipient: Address;
  amount: bigint;
  sender: PublicKey;
}

export interface SolanaTransferQuote {
  interchainGasFee: bigint;
  transactionFee: bigint;
  totalFee: bigint;
  estimatedTime: number;
}

export class SolanaAdapter {
  private readonly connection: Connection;
  private readonly mailbox: PublicKey;
  private readonly igp: PublicKey;

  constructor(rpcUrl: string, isMainnet: boolean = true) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.mailbox = isMainnet
      ? HYPERLANE_MAILBOX_MAINNET
      : HYPERLANE_MAILBOX_DEVNET;
    this.igp = isMainnet ? HYPERLANE_IGP_MAINNET : HYPERLANE_IGP_DEVNET;
  }

  async createToken(
    payer: Keypair,
    config: SolanaTokenConfig
  ): Promise<{ mint: PublicKey; tx: string }> {
    const mintKeypair = Keypair.generate();
    const lamports =
      await this.connection.getMinimumBalanceForRentExemption(MINT_SIZE);

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
        TOKEN_PROGRAM_ID
      )
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [payer, mintKeypair]
    );

    return {
      mint: mintKeypair.publicKey,
      tx: signature,
    };
  }

  async createTokenAccount(
    payer: Keypair,
    mint: PublicKey,
    owner: PublicKey
  ): Promise<PublicKey> {
    const associatedTokenAccount = await getAssociatedTokenAddress(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        associatedTokenAccount,
        owner,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(this.connection, transaction, [payer]);

    return associatedTokenAccount;
  }

  // Production should query IGP on-chain for real quotes
  async quoteTransfer(
    destinationDomain: number,
    _amount: bigint
  ): Promise<SolanaTransferQuote> {
    const baseGasFee = this.getEstimatedGasFee(destinationDomain);

    return {
      interchainGasFee: baseGasFee,
      transactionFee: SOLANA_TX_FEE_LAMPORTS,
      totalFee: baseGasFee + SOLANA_TX_FEE_LAMPORTS,
      estimatedTime: ESTIMATED_DELIVERY_SECONDS,
    };
  }

  async initiateTransfer(
    payer: Keypair,
    warpRouteConfig: SolanaWarpRouteConfig,
    params: SolanaTransferParams
  ): Promise<BridgeStatus> {
    const destinationDomain = this.getEvmDomainId(params.destinationChain);
    const quote = await this.quoteTransfer(destinationDomain, params.amount);
    const userTokenAccount = await getAssociatedTokenAddress(
      warpRouteConfig.mint,
      params.sender,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const transferInstruction = this.buildWarpTransferInstruction(
      warpRouteConfig.warpRoute,
      userTokenAccount,
      warpRouteConfig.mint,
      params.sender,
      destinationDomain,
      params.recipient,
      params.amount
    );

    const gasPaymentInstruction = this.buildGasPaymentInstruction(
      params.sender,
      destinationDomain,
      quote.interchainGasFee
    );

    const transaction = new Transaction().add(
      transferInstruction,
      gasPaymentInstruction
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [payer]
    );

    return {
      requestId: this.generateMessageId(signature),
      status: 'dispatched',
      sourceChain: params.sourceChain,
      destinationChain: params.destinationChain,
      amount: params.amount,
      sourceTxHash: signature as Hex,
    };
  }

  async handleIncomingTransfer(
    payer: Keypair,
    warpRouteConfig: SolanaWarpRouteConfig,
    _originDomain: number,
    _sender: Hex,
    recipient: PublicKey,
    amount: bigint,
    _message: Buffer
  ): Promise<string> {
    const recipientTokenAccount = await getAssociatedTokenAddress(
      warpRouteConfig.mint,
      recipient,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const accountInfo = await this.connection.getAccountInfo(
      recipientTokenAccount
    );
    if (!accountInfo) {
      await this.createTokenAccount(payer, warpRouteConfig.mint, recipient);
    }

    const mintInstruction = createMintToInstruction(
      warpRouteConfig.mint,
      recipientTokenAccount,
      warpRouteConfig.warpRoute,
      amount,
      [],
      TOKEN_PROGRAM_ID
    );

    const transaction = new Transaction().add(mintInstruction);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [payer]
    );

    return signature;
  }

  private buildWarpTransferInstruction(
    warpRouteProgram: PublicKey,
    userTokenAccount: PublicKey,
    mint: PublicKey,
    sender: PublicKey,
    destinationDomain: number,
    recipient: Address,
    amount: bigint
  ): TransactionInstruction {
    const recipientBytes = Buffer.alloc(32);
    Buffer.from(recipient.slice(2).toLowerCase(), 'hex').copy(
      recipientBytes,
      12
    );

    // Layout: 1B discriminator + 4B domain + 32B recipient + 8B amount
    const data = Buffer.alloc(45);
    data.writeUInt8(0x01, 0);
    data.writeUInt32LE(destinationDomain, 1);
    recipientBytes.copy(data, 5);
    data.writeBigUInt64LE(amount, 37);

    const keys = [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: this.mailbox, isSigner: false, isWritable: true },
      { pubkey: this.igp, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      keys,
      programId: warpRouteProgram,
      data,
    });
  }

  private buildGasPaymentInstruction(
    payer: PublicKey,
    destinationDomain: number,
    amount: bigint
  ): TransactionInstruction {
    const data = Buffer.alloc(13);
    data.writeUInt8(0x02, 0);
    data.writeUInt32LE(destinationDomain, 1);
    data.writeBigUInt64LE(amount, 5);

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: this.igp, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      keys,
      programId: this.igp,
      data,
    });
  }

  private getEstimatedGasFee(destinationDomain: number): bigint {
    const feesByDomain: Record<number, bigint> = {
      1: INTERCHAIN_GAS_FEES.ETHEREUM,
      10: INTERCHAIN_GAS_FEES.OPTIMISM,
      8453: INTERCHAIN_GAS_FEES.BASE,
      42161: INTERCHAIN_GAS_FEES.ARBITRUM,
      56: INTERCHAIN_GAS_FEES.BSC,
      137: INTERCHAIN_GAS_FEES.POLYGON,
    };
    return feesByDomain[destinationDomain] ?? INTERCHAIN_GAS_FEES.DEFAULT;
  }

  private getEvmDomainId(chainId: ChainId): number {
    return getDomainId(chainId);
  }

  private generateMessageId(signature: string): Hex {
    return `0x${Buffer.from(signature).toString('hex').padStart(64, '0').slice(0, 64)}` as Hex;
  }

  async getTokenInfo(mint: PublicKey): Promise<{
    supply: bigint;
    decimals: number;
    mintAuthority: PublicKey | null;
    freezeAuthority: PublicKey | null;
  }> {
    const mintInfo = await getMint(this.connection, mint);
    return {
      supply: mintInfo.supply,
      decimals: mintInfo.decimals,
      mintAuthority: mintInfo.mintAuthority,
      freezeAuthority: mintInfo.freezeAuthority,
    };
  }

  async getTokenBalance(mint: PublicKey, owner: PublicKey): Promise<bigint> {
    const tokenAccount = await getAssociatedTokenAddress(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const accountInfo = await this.connection.getAccountInfo(tokenAccount);
    if (!accountInfo) {
      return 0n;
    }

    const account = await getAccount(this.connection, tokenAccount);
    return account.amount;
  }

  async getSolBalance(address: PublicKey): Promise<bigint> {
    const balance = await this.connection.getBalance(address);
    return BigInt(balance);
  }
}

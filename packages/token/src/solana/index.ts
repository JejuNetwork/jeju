/**
 * Solana Token Module
 * 
 * Provides Solana-native token operations:
 * - SPL token creation and management
 * - Token account operations
 * - Metadata handling
 * 
 * For Solana DEX operations, use @jeju/solana-dex
 * For Solana launchpad, use @jeju/solana-launchpad-client
 * For EVM↔Solana bridging, use @jeju/zksolbridge
 */

import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  mintTo,
  getMint,
  getAccount,
  transfer,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// ============================================================================
// Types
// ============================================================================

export type SolanaCluster = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet';

export interface SolanaConfig {
  cluster: SolanaCluster;
  rpcUrl: string;
  wsUrl?: string;
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

export interface TokenCreateParams {
  decimals: number;
  mintAuthority?: PublicKey;
  freezeAuthority?: PublicKey | null;
}

export interface TokenMintParams {
  mint: PublicKey;
  destination: PublicKey;
  amount: bigint;
  authority: Keypair;
}

export interface TokenInfo {
  mint: PublicKey;
  supply: bigint;
  decimals: number;
  mintAuthority: PublicKey | null;
  freezeAuthority: PublicKey | null;
  isInitialized: boolean;
}

export interface TokenAccountInfo {
  address: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  delegate: PublicKey | null;
  delegatedAmount: bigint;
  isNative: boolean;
  isFrozen: boolean;
}

// ============================================================================
// Solana Token SDK
// ============================================================================

export class SolanaTokenSDK {
  private connection: Connection;
  private cluster: SolanaCluster;

  constructor(config: SolanaConfig) {
    this.cluster = config.cluster;
    this.connection = new Connection(config.rpcUrl, {
      commitment: config.commitment ?? 'confirmed',
      wsEndpoint: config.wsUrl,
    });
  }

  // ============================================================================
  // Token Creation
  // ============================================================================

  /**
   * Create a new SPL token mint
   */
  async createToken(
    params: TokenCreateParams,
    payer: Keypair
  ): Promise<{ mint: PublicKey; signature: string }> {
    const mintKeypair = Keypair.generate();
    
    const mint = await createMint(
      this.connection,
      payer,
      params.mintAuthority ?? payer.publicKey,
      params.freezeAuthority ?? null,
      params.decimals,
      mintKeypair
    );

    console.log(`Token created: ${mint.toBase58()}`);

    return {
      mint,
      signature: mintKeypair.publicKey.toBase58(),
    };
  }

  /**
   * Create token with initial supply
   */
  async createTokenWithSupply(
    params: TokenCreateParams & { initialSupply: bigint },
    payer: Keypair
  ): Promise<{ mint: PublicKey; tokenAccount: PublicKey; signature: string }> {
    const { mint, signature } = await this.createToken(params, payer);

    // Create token account for payer
    const tokenAccount = await this.createTokenAccount(mint, payer.publicKey, payer);

    // Mint initial supply
    if (params.initialSupply > 0n) {
      await this.mintTokens({
        mint,
        destination: tokenAccount,
        amount: params.initialSupply,
        authority: payer,
      });
    }

    console.log(`Minted ${params.initialSupply} tokens to ${tokenAccount.toBase58()}`);

    return { mint, tokenAccount, signature };
  }

  // ============================================================================
  // Token Account Operations
  // ============================================================================

  /**
   * Create an associated token account
   */
  async createTokenAccount(
    mint: PublicKey,
    owner: PublicKey,
    payer: Keypair
  ): Promise<PublicKey> {
    const tokenAccount = await createAssociatedTokenAccount(
      this.connection,
      payer,
      mint,
      owner
    );

    console.log(`Token account created: ${tokenAccount.toBase58()}`);
    return tokenAccount;
  }

  /**
   * Get or create associated token account
   */
  async getOrCreateTokenAccount(
    mint: PublicKey,
    owner: PublicKey,
    payer: Keypair
  ): Promise<PublicKey> {
    const ata = await getAssociatedTokenAddress(mint, owner);
    
    const accountInfo = await this.connection.getAccountInfo(ata);
    if (accountInfo) {
      return ata;
    }

    return this.createTokenAccount(mint, owner, payer);
  }

  /**
   * Get associated token address (without creating)
   */
  async getTokenAddress(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
    return getAssociatedTokenAddress(mint, owner);
  }

  // ============================================================================
  // Minting & Transfers
  // ============================================================================

  /**
   * Mint tokens to an account
   */
  async mintTokens(params: TokenMintParams): Promise<string> {
    const signature = await mintTo(
      this.connection,
      params.authority,
      params.mint,
      params.destination,
      params.authority,
      params.amount
    );

    console.log(`Minted ${params.amount} tokens: ${signature}`);
    return signature;
  }

  /**
   * Transfer tokens between accounts
   */
  async transferTokens(
    mint: PublicKey,
    from: PublicKey,
    to: PublicKey,
    owner: Keypair,
    amount: bigint
  ): Promise<string> {
    const signature = await transfer(
      this.connection,
      owner,
      from,
      to,
      owner,
      amount
    );

    console.log(`Transferred ${amount} tokens: ${signature}`);
    return signature;
  }

  // ============================================================================
  // Token Information
  // ============================================================================

  /**
   * Get token mint information
   */
  async getTokenInfo(mint: PublicKey): Promise<TokenInfo> {
    const mintInfo = await getMint(this.connection, mint);
    
    return {
      mint,
      supply: mintInfo.supply,
      decimals: mintInfo.decimals,
      mintAuthority: mintInfo.mintAuthority,
      freezeAuthority: mintInfo.freezeAuthority,
      isInitialized: mintInfo.isInitialized,
    };
  }

  /**
   * Get token account information
   */
  async getTokenAccountInfo(address: PublicKey): Promise<TokenAccountInfo> {
    const accountInfo = await getAccount(this.connection, address);
    
    return {
      address,
      mint: accountInfo.mint,
      owner: accountInfo.owner,
      amount: accountInfo.amount,
      delegate: accountInfo.delegate,
      delegatedAmount: accountInfo.delegatedAmount,
      isNative: accountInfo.isNative,
      isFrozen: accountInfo.isFrozen,
    };
  }

  /**
   * Get token balance for an owner
   */
  async getBalance(mint: PublicKey, owner: PublicKey): Promise<bigint> {
    const ata = await getAssociatedTokenAddress(mint, owner);
    
    try {
      const balance = await this.connection.getTokenAccountBalance(ata);
      return BigInt(balance.value.amount);
    } catch {
      return 0n;
    }
  }

  /**
   * Get all token accounts for an owner
   */
  async getTokenAccounts(owner: PublicKey): Promise<TokenAccountInfo[]> {
    const accounts = await this.connection.getTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    });

    const results: TokenAccountInfo[] = [];
    for (const { pubkey, account } of accounts.value) {
      try {
        const info = await this.getTokenAccountInfo(pubkey);
        results.push(info);
      } catch {
        // Skip invalid accounts
      }
    }

    return results;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get SOL balance
   */
  async getSolBalance(address: PublicKey): Promise<bigint> {
    const balance = await this.connection.getBalance(address);
    return BigInt(balance);
  }

  /**
   * Request airdrop (devnet/testnet only)
   */
  async requestAirdrop(address: PublicKey, amount: number = 1): Promise<string> {
    if (this.cluster === 'mainnet-beta') {
      throw new Error('Airdrop not available on mainnet');
    }

    const signature = await this.connection.requestAirdrop(
      address,
      amount * LAMPORTS_PER_SOL
    );

    await this.connection.confirmTransaction(signature, 'confirmed');
    return signature;
  }

  /**
   * Get connection instance
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Get cluster name
   */
  getCluster(): SolanaCluster {
    return this.cluster;
  }

  /**
   * Check if connection is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.connection.getSlot();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create Solana Token SDK for mainnet
 */
export function createMainnetTokenSDK(rpcUrl?: string): SolanaTokenSDK {
  return new SolanaTokenSDK({
    cluster: 'mainnet-beta',
    rpcUrl: rpcUrl ?? 'https://api.mainnet-beta.solana.com',
  });
}

/**
 * Create Solana Token SDK for devnet
 */
export function createDevnetTokenSDK(rpcUrl?: string): SolanaTokenSDK {
  return new SolanaTokenSDK({
    cluster: 'devnet',
    rpcUrl: rpcUrl ?? 'https://api.devnet.solana.com',
  });
}

/**
 * Create Solana Token SDK with custom config
 */
export function createSolanaTokenSDK(config: SolanaConfig): SolanaTokenSDK {
  return new SolanaTokenSDK(config);
}

// Re-export useful Solana types
export { PublicKey, Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

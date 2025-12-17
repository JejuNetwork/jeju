/**
 * Solana Cross-Chain Integration for Bazaar
 * Enables cross-chain liquidity and NFT operations between EVM and Solana
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type { Address } from 'viem';
import { SOLANA_RPC_URL, SOLANA_CHAIN_ID } from '@/config';

export interface CrossChainToken {
  symbol: string;
  name: string;
  evmAddress: Address | null;
  evmChainId: number | null;
  solanaMint: string | null;
  decimals: number;
  logoUri?: string;
}

export interface CrossChainNFT {
  collectionId: string;
  name: string;
  evmContract: Address | null;
  evmChainId: number | null;
  solanaMint: string | null;
  metadataUri: string;
  owner: {
    evmAddress?: Address;
    solanaPubkey?: string;
  };
}

export interface SolanaQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  routePlan: JupiterRoutePlan[];
}

interface JupiterRoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

const JUPITER_API = 'https://quote-api.jup.ag/v6';

const CROSS_CHAIN_TOKENS: CrossChainToken[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    evmAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    evmChainId: 1,
    solanaMint: 'EPjFWdd5AufqSSqeM2qN1xzybapT8G4wEGGkZwyTDt1v',
    decimals: 6,
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    evmAddress: null,
    evmChainId: null,
    solanaMint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  },
  {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    evmAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    evmChainId: 1,
    solanaMint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // Wormhole WETH
    decimals: 8,
  },
  {
    symbol: 'JUP',
    name: 'Jupiter',
    evmAddress: null,
    evmChainId: null,
    solanaMint: 'JUPyiwrYJFskUPiHa7hkeepFNjGXvMPGM2TQ5sUtjHA',
    decimals: 6,
  },
];

export async function getSolanaQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number = 50
): Promise<SolanaQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: slippageBps.toString(),
  });

  const response = await fetch(`${JUPITER_API}/quote?${params}`);
  if (!response.ok) {
    throw new Error(`Jupiter quote failed: ${response.statusText}`);
  }

  return response.json();
}

export async function getSolanaSwapTransaction(
  quoteResponse: SolanaQuote,
  userPublicKey: string
): Promise<{ swapTransaction: string }> {
  const response = await fetch(`${JUPITER_API}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Jupiter swap failed: ${response.statusText}`);
  }

  return response.json();
}

export function getCrossChainTokens(): CrossChainToken[] {
  return CROSS_CHAIN_TOKENS;
}

export function findTokenBySymbol(symbol: string): CrossChainToken | undefined {
  return CROSS_CHAIN_TOKENS.find(t => t.symbol.toLowerCase() === symbol.toLowerCase());
}

export function findTokenByEvmAddress(address: Address): CrossChainToken | undefined {
  return CROSS_CHAIN_TOKENS.find(t => 
    t.evmAddress?.toLowerCase() === address.toLowerCase()
  );
}

export function findTokenBySolanaMint(mint: string): CrossChainToken | undefined {
  return CROSS_CHAIN_TOKENS.find(t => t.solanaMint === mint);
}

export interface CrossChainSwapRoute {
  type: 'direct' | 'bridge';
  sourceChain: number;
  destChain: number;
  inputToken: CrossChainToken;
  outputToken: CrossChainToken;
  estimatedOutput: string;
  bridgeFee: string;
  estimatedTime: number; // seconds
}

export async function getCrossChainRoute(
  inputToken: CrossChainToken,
  outputToken: CrossChainToken,
  amount: string,
  sourceChain: number,
  destChain: number
): Promise<CrossChainSwapRoute | null> {
  const isSolanaSource = sourceChain === 101 || sourceChain === 102;
  const isSolanaDest = destChain === 101 || destChain === 102;

  // Direct Solana swap via Jupiter
  if (isSolanaSource && isSolanaDest && inputToken.solanaMint && outputToken.solanaMint) {
    const quote = await getSolanaQuote(inputToken.solanaMint, outputToken.solanaMint, amount);
    return {
      type: 'direct',
      sourceChain,
      destChain,
      inputToken,
      outputToken,
      estimatedOutput: quote.outAmount,
      bridgeFee: '0',
      estimatedTime: 1,
    };
  }

  // Cross-chain via ZKSolBridge
  if ((isSolanaSource && !isSolanaDest) || (!isSolanaSource && isSolanaDest)) {
    // Bridge route calculation would go here
    // For now, return a template
    const bridgeFeePercent = 0.3; // 30 bps
    const estimatedOutput = (BigInt(amount) * BigInt(10000 - Math.floor(bridgeFeePercent * 100)) / 10000n).toString();
    
    return {
      type: 'bridge',
      sourceChain,
      destChain,
      inputToken,
      outputToken,
      estimatedOutput,
      bridgeFee: (BigInt(amount) * BigInt(Math.floor(bridgeFeePercent * 100)) / 10000n).toString(),
      estimatedTime: 300, // ~5 minutes for ZK proof
    };
  }

  return null;
}

export class SolanaLiquidityClient {
  private connection: Connection;

  constructor(rpcUrl: string = SOLANA_RPC_URL) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async getTokenBalance(walletPubkey: string, mintAddress: string): Promise<bigint> {
    const wallet = new PublicKey(walletPubkey);
    const mint = new PublicKey(mintAddress);

    // Get token accounts for this wallet and mint
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(wallet, { mint });

    if (tokenAccounts.value.length === 0) return 0n;

    const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
    return BigInt(balance);
  }

  async getSolBalance(walletPubkey: string): Promise<bigint> {
    const wallet = new PublicKey(walletPubkey);
    const balance = await this.connection.getBalance(wallet);
    return BigInt(balance);
  }

  async getTokenAccountInfo(walletPubkey: string): Promise<TokenAccountInfo[]> {
    const wallet = new PublicKey(walletPubkey);
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(wallet, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });

    return tokenAccounts.value.map(account => ({
      mint: account.account.data.parsed.info.mint,
      amount: BigInt(account.account.data.parsed.info.tokenAmount.amount),
      decimals: account.account.data.parsed.info.tokenAmount.decimals,
    }));
  }
}

interface TokenAccountInfo {
  mint: string;
  amount: bigint;
  decimals: number;
}

export function createSolanaLiquidityClient(rpcUrl?: string): SolanaLiquidityClient {
  return new SolanaLiquidityClient(rpcUrl);
}

/**
 * Format Solana amount for display
 */
export function formatSolanaAmount(amount: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, 4);
  return `${whole}.${fractionStr}`;
}

/**
 * Parse Solana amount from user input
 */
export function parseSolanaAmount(input: string, decimals: number): bigint {
  const [whole, fraction = ''] = input.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFraction);
}


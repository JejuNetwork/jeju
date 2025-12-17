/**
 * Jupiter DEX Integration for XLP
 * Enables instant Solana swaps as part of cross-chain liquidity operations
 */

import {
  Connection,
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';
import { EventEmitter } from 'events';

const JUPITER_API_V6 = 'https://quote-api.jup.ag/v6';
const JUPITER_PRICE_API = 'https://price.jup.ag/v6';

// Common Solana token mints
const SOLANA_TOKENS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapT8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FsqcVc7eHvqZN9Y1FMx6ByGu',
  WETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  WBTC: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
  JUP: 'JUPyiwrYJFskUPiHa7hkeepFNjGXvMPGM2TQ5sUtjHA',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  priceImpactPct: number;
  routePlan: JupiterRoutePlan[];
  contextSlot: number;
  timeTaken: number;
}

export interface JupiterRoutePlan {
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

export interface JupiterSwapResult {
  signature: string;
  inputAmount: bigint;
  outputAmount: bigint;
  priceImpact: number;
  fee: bigint;
}

export interface JupiterPrice {
  id: string;
  mintSymbol: string;
  vsToken: string;
  vsTokenSymbol: string;
  price: number;
}

export interface JupiterConfig {
  rpcUrl: string;
  keypair?: Uint8Array;
  slippageBps?: number;
  priorityFeeLamports?: number;
  dynamicComputeUnitLimit?: boolean;
}

export class JupiterClient extends EventEmitter {
  private connection: Connection;
  private keypair: Keypair | null = null;
  private defaultSlippageBps: number;
  private priorityFeeLamports: number;
  private dynamicComputeUnitLimit: boolean;

  constructor(config: JupiterConfig) {
    super();
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.defaultSlippageBps = config.slippageBps || 50; // 0.5% default
    this.priorityFeeLamports = config.priorityFeeLamports || 10000;
    this.dynamicComputeUnitLimit = config.dynamicComputeUnitLimit ?? true;

    if (config.keypair) {
      this.keypair = Keypair.fromSecretKey(config.keypair);
    }
  }

  /**
   * Get quote for a swap
   */
  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps?: number;
    swapMode?: 'ExactIn' | 'ExactOut';
    onlyDirectRoutes?: boolean;
    asLegacyTransaction?: boolean;
    maxAccounts?: number;
  }): Promise<JupiterQuote> {
    const queryParams = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: (params.slippageBps || this.defaultSlippageBps).toString(),
      swapMode: params.swapMode || 'ExactIn',
      onlyDirectRoutes: (params.onlyDirectRoutes || false).toString(),
      asLegacyTransaction: (params.asLegacyTransaction || false).toString(),
    });

    if (params.maxAccounts) {
      queryParams.set('maxAccounts', params.maxAccounts.toString());
    }

    const response = await fetch(`${JUPITER_API_V6}/quote?${queryParams}`);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter quote failed: ${error}`);
    }

    return response.json() as Promise<JupiterQuote>;
  }

  /**
   * Get best quote across multiple routes
   */
  async getBestQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps?: number;
  }): Promise<JupiterQuote> {
    // Jupiter API automatically returns best route
    return this.getQuote({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: params.slippageBps,
      onlyDirectRoutes: false,
    });
  }

  /**
   * Execute a swap
   */
  async swap(quote: JupiterQuote, userPublicKey?: string): Promise<JupiterSwapResult> {
    const pubkey = userPublicKey || this.keypair?.publicKey.toBase58();
    if (!pubkey) {
      throw new Error('No user public key provided and no keypair configured');
    }

    // Get swap transaction
    const swapResponse = await fetch(`${JUPITER_API_V6}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: pubkey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: this.dynamicComputeUnitLimit,
        prioritizationFeeLamports: this.priorityFeeLamports,
      }),
    });

    if (!swapResponse.ok) {
      const error = await swapResponse.text();
      throw new Error(`Jupiter swap failed: ${error}`);
    }

    const swapData = await swapResponse.json() as { swapTransaction: string };
    const swapTransaction = swapData.swapTransaction;

    // Deserialize and sign
    const transactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuf);

    if (!this.keypair) {
      throw new Error('Cannot sign transaction: no keypair configured');
    }

    transaction.sign([this.keypair]);

    // Send and confirm
    const signature = await this.connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
    });

    await this.connection.confirmTransaction(signature, 'confirmed');

    this.emit('swapCompleted', {
      signature,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
    });

    return {
      signature,
      inputAmount: BigInt(quote.inAmount),
      outputAmount: BigInt(quote.outAmount),
      priceImpact: quote.priceImpactPct,
      fee: this.calculateTotalFees(quote),
    };
  }

  /**
   * Get swap transaction without executing
   */
  async getSwapTransaction(
    quote: JupiterQuote,
    userPublicKey: string
  ): Promise<{ transaction: VersionedTransaction; lastValidBlockHeight: number }> {
    const swapResponse = await fetch(`${JUPITER_API_V6}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: this.dynamicComputeUnitLimit,
        prioritizationFeeLamports: this.priorityFeeLamports,
      }),
    });

    if (!swapResponse.ok) {
      const error = await swapResponse.text();
      throw new Error(`Jupiter swap transaction failed: ${error}`);
    }

    const swapData = await swapResponse.json() as { swapTransaction: string; lastValidBlockHeight: number };
    const transactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuf);

    return {
      transaction,
      lastValidBlockHeight: swapData.lastValidBlockHeight,
    };
  }

  /**
   * Get token price in USD
   */
  async getPrice(tokenMint: string): Promise<number> {
    const response = await fetch(`${JUPITER_PRICE_API}/price?ids=${tokenMint}`);
    if (!response.ok) {
      throw new Error(`Jupiter price API failed: ${response.statusText}`);
    }

    const data = await response.json() as { data: Record<string, { price: number }> };
    const priceData = data.data[tokenMint];
    if (!priceData) {
      throw new Error(`Price not found for ${tokenMint}`);
    }

    return priceData.price;
  }

  /**
   * Get multiple token prices
   */
  async getPrices(tokenMints: string[]): Promise<Record<string, number>> {
    const response = await fetch(`${JUPITER_PRICE_API}/price?ids=${tokenMints.join(',')}`);
    if (!response.ok) {
      throw new Error(`Jupiter price API failed: ${response.statusText}`);
    }

    const data = await response.json() as { data: Record<string, { price: number }> };
    const prices: Record<string, number> = {};

    for (const mint of tokenMints) {
      if (data.data[mint]) {
        prices[mint] = data.data[mint].price;
      }
    }

    return prices;
  }

  /**
   * Get all tradeable tokens
   */
  async getTokenList(): Promise<{ address: string; symbol: string; name: string; decimals: number }[]> {
    const response = await fetch('https://token.jup.ag/all');
    if (!response.ok) {
      throw new Error(`Jupiter token list failed: ${response.statusText}`);
    }

    return response.json() as Promise<{ address: string; symbol: string; name: string; decimals: number }[]>;
  }

  /**
   * Get token mint by symbol
   */
  getTokenMint(symbol: string): string | undefined {
    return SOLANA_TOKENS[symbol.toUpperCase()];
  }

  /**
   * Check if swap route exists
   */
  async hasRoute(inputMint: string, outputMint: string): Promise<boolean> {
    const quote = await this.getQuote({
      inputMint,
      outputMint,
      amount: '1000000', // 1 USDC equivalent
      slippageBps: 1000, // 10% for route check
    });

    return quote.routePlan.length > 0;
  }

  /**
   * Calculate output amount after slippage
   */
  calculateMinOutput(quote: JupiterQuote): bigint {
    const output = BigInt(quote.outAmount);
    const slippageMultiplier = BigInt(10000 - quote.slippageBps);
    return (output * slippageMultiplier) / 10000n;
  }

  /**
   * Calculate total fees from route
   */
  private calculateTotalFees(quote: JupiterQuote): bigint {
    let totalFees = 0n;
    for (const step of quote.routePlan) {
      totalFees += BigInt(step.swapInfo.feeAmount);
    }
    return totalFees;
  }
}

/**
 * XLP Jupiter Filler - Uses Jupiter for instant Solana-side fills
 */
export class XLPJupiterFiller extends EventEmitter {
  private jupiter: JupiterClient;
  private running = false;
  private fillInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: JupiterConfig) {
    super();
    this.jupiter = new JupiterClient(config);
  }

  /**
   * Fill a cross-chain order using Jupiter
   */
  async fillOrder(params: {
    orderId: string;
    inputMint: string;
    outputMint: string;
    inputAmount: string;
    recipient: string;
    maxSlippageBps?: number;
  }): Promise<{
    success: boolean;
    signature?: string;
    outputAmount?: bigint;
    error?: string;
  }> {
    // Get best quote
    const quote = await this.jupiter.getQuote({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.inputAmount,
      slippageBps: params.maxSlippageBps || 100,
    });

    // Check price impact
    if (quote.priceImpactPct > 5) {
      console.warn(`[XLPJupiter] High price impact: ${quote.priceImpactPct}%`);
      return {
        success: false,
        error: `Price impact too high: ${quote.priceImpactPct}%`,
      };
    }

    // Execute swap
    const result = await this.jupiter.swap(quote, params.recipient);

    this.emit('orderFilled', {
      orderId: params.orderId,
      signature: result.signature,
      inputAmount: params.inputAmount,
      outputAmount: result.outputAmount.toString(),
      priceImpact: result.priceImpact,
    });

    return {
      success: true,
      signature: result.signature,
      outputAmount: result.outputAmount,
    };
  }

  /**
   * Get quote for cross-chain swap via Solana
   */
  async getXLPQuote(params: {
    sourceChainId: number;
    destChainId: number;
    inputToken: string; // Symbol
    outputToken: string; // Symbol
    amount: string;
  }): Promise<{
    inputAmount: string;
    outputAmount: string;
    priceImpact: number;
    route: string;
    estimatedTime: number;
  }> {
    const inputMint = this.jupiter.getTokenMint(params.inputToken);
    const outputMint = this.jupiter.getTokenMint(params.outputToken);

    if (!inputMint || !outputMint) {
      throw new Error(`Token not found: ${params.inputToken} or ${params.outputToken}`);
    }

    const quote = await this.jupiter.getQuote({
      inputMint,
      outputMint,
      amount: params.amount,
    });

    // Build route description
    const routeLabels = quote.routePlan.map(r => r.swapInfo.label).join(' → ');

    return {
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
      priceImpact: quote.priceImpactPct,
      route: routeLabels,
      estimatedTime: 1, // ~1 second on Solana
    };
  }

  /**
   * Start automatic order filling
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.fillInterval = setInterval(async () => {
      await this.checkPendingOrders();
    }, 2000);

    console.log('[XLPJupiter] Filler started');
  }

  /**
   * Stop automatic order filling
   */
  stop(): void {
    this.running = false;
    if (this.fillInterval) {
      clearInterval(this.fillInterval);
      this.fillInterval = null;
    }
    console.log('[XLPJupiter] Filler stopped');
  }

  /**
   * Check and fill pending orders
   */
  private async checkPendingOrders(): Promise<void> {
    // This would query pending XLP orders from the bridge
    // and fill profitable ones using Jupiter
    this.emit('checkingOrders', { timestamp: Date.now() });
  }
}

export function createJupiterClient(config: JupiterConfig): JupiterClient {
  return new JupiterClient(config);
}

export function createXLPJupiterFiller(config: JupiterConfig): XLPJupiterFiller {
  return new XLPJupiterFiller(config);
}

export { SOLANA_TOKENS };


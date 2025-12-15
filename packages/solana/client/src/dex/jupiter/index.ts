/**
 * Jupiter Aggregator Integration
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';
import type {
  SwapParams,
  SwapQuote,
  SwapTransaction,
  SwapRoute,
  DexAdapter,
  PoolInfo,
  AddLiquidityParams,
  AddLiquidityQuote,
  RemoveLiquidityParams,
  RemoveLiquidityQuote,
  LPPosition,
  DexType,
} from '../types';

const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap';
const JUPITER_TOKENS_API = 'https://token.jup.ag/all';

interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupiterRoutePlan[];
  contextSlot: number;
  timeTaken: number;
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

interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export class JupiterAdapter implements DexAdapter {
  readonly name = 'jupiter' as const;
  private connection: Connection;
  private tokenCache: Map<string, { symbol: string; decimals: number }> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getQuote(params: SwapParams): Promise<SwapQuote> {
    const url = new URL(JUPITER_QUOTE_API);
    url.searchParams.set('inputMint', params.inputMint.toBase58());
    url.searchParams.set('outputMint', params.outputMint.toBase58());
    url.searchParams.set('amount', params.amount.toString());
    url.searchParams.set('slippageBps', params.slippageBps.toString());
    url.searchParams.set('onlyDirectRoutes', 'false');
    url.searchParams.set('asLegacyTransaction', 'false');

    const response = await fetch(url.toString());
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter quote failed: ${error}`);
    }

    const data = await response.json() as JupiterQuoteResponse;

    let totalFee = 0n;
    for (const step of data.routePlan) {
      totalFee += BigInt(step.swapInfo.feeAmount);
    }

    const route: SwapRoute[] = data.routePlan.map(step => ({
      dex: this.labelToDex(step.swapInfo.label),
      poolAddress: new PublicKey(step.swapInfo.ammKey),
      inputMint: new PublicKey(step.swapInfo.inputMint),
      outputMint: new PublicKey(step.swapInfo.outputMint),
      inputAmount: BigInt(step.swapInfo.inAmount),
      outputAmount: BigInt(step.swapInfo.outAmount),
    }));

    return {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inputAmount: BigInt(data.inAmount),
      outputAmount: BigInt(data.outAmount),
      minOutputAmount: BigInt(data.otherAmountThreshold),
      priceImpactPct: parseFloat(data.priceImpactPct),
      fee: totalFee,
      route,
      dex: 'jupiter',
    };
  }

  async buildSwapTransaction(quote: SwapQuote): Promise<SwapTransaction> {
    const quoteResponse = await this.getJupiterQuoteRaw(
      quote.inputMint,
      quote.outputMint,
      quote.inputAmount
    );

    const response = await fetch(JUPITER_SWAP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: quote.route[0]?.inputMint.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter swap build failed: ${error}`);
    }

    const data = await response.json() as JupiterSwapResponse;
    const swapTransactionBuf = Buffer.from(data.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    return {
      transaction,
      lastValidBlockHeight: data.lastValidBlockHeight,
    };
  }

  async buildSwapTransactionForUser(
    quote: SwapQuote,
    userPublicKey: PublicKey
  ): Promise<SwapTransaction> {
    const quoteResponse = await this.getJupiterQuoteRaw(
      quote.inputMint,
      quote.outputMint,
      quote.inputAmount
    );

    const response = await fetch(JUPITER_SWAP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: userPublicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter swap build failed: ${error}`);
    }

    const data = await response.json() as JupiterSwapResponse;
    const swapTransactionBuf = Buffer.from(data.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    return {
      transaction,
      lastValidBlockHeight: data.lastValidBlockHeight,
    };
  }

  private async getJupiterQuoteRaw(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: bigint
  ): Promise<JupiterQuoteResponse> {
    const url = new URL(JUPITER_QUOTE_API);
    url.searchParams.set('inputMint', inputMint.toBase58());
    url.searchParams.set('outputMint', outputMint.toBase58());
    url.searchParams.set('amount', amount.toString());
    url.searchParams.set('slippageBps', '50');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Jupiter quote failed: ${await response.text()}`);
    }

    return response.json();
  }

  private labelToDex(label: string): DexType {
    const normalized = label.toLowerCase();
    if (normalized.includes('raydium')) return 'raydium';
    if (normalized.includes('meteora')) return 'meteora';
    if (normalized.includes('orca') || normalized.includes('whirlpool')) return 'orca';
    if (normalized.includes('pump')) return 'pumpswap';
    return 'jupiter';
  }

  async getPools(_tokenA?: PublicKey, _tokenB?: PublicKey): Promise<PoolInfo[]> {
    return [];
  }

  async getPoolInfo(_pool: PublicKey): Promise<PoolInfo> {
    throw new Error('Jupiter is an aggregator - use specific DEX adapter for pool info');
  }

  async getAddLiquidityQuote(_params: AddLiquidityParams): Promise<AddLiquidityQuote> {
    throw new Error('Jupiter is an aggregator - use specific DEX adapter for liquidity');
  }

  async buildAddLiquidityTransaction(
    _quote: AddLiquidityQuote,
    _params: AddLiquidityParams
  ): Promise<SwapTransaction> {
    throw new Error('Jupiter is an aggregator - use specific DEX adapter for liquidity');
  }

  async getRemoveLiquidityQuote(_params: RemoveLiquidityParams): Promise<RemoveLiquidityQuote> {
    throw new Error('Jupiter is an aggregator - use specific DEX adapter for liquidity');
  }

  async buildRemoveLiquidityTransaction(
    _quote: RemoveLiquidityQuote,
    _params: RemoveLiquidityParams
  ): Promise<SwapTransaction> {
    throw new Error('Jupiter is an aggregator - use specific DEX adapter for liquidity');
  }

  async getLPPositions(_userPublicKey: PublicKey): Promise<LPPosition[]> {
    return [];
  }

  async getTokenList(): Promise<Map<string, { symbol: string; decimals: number; name: string }>> {
    if (this.tokenCache.size > 0) {
      return this.tokenCache as Map<string, { symbol: string; decimals: number; name: string }>;
    }

    const response = await fetch(JUPITER_TOKENS_API);
    if (!response.ok) {
      throw new Error('Failed to fetch Jupiter token list');
    }

    const tokens = await response.json() as Array<{
      address: string;
      symbol: string;
      decimals: number;
      name: string;
    }>;

    const tokenMap = new Map<string, { symbol: string; decimals: number; name: string }>();
    for (const token of tokens) {
      tokenMap.set(token.address, {
        symbol: token.symbol,
        decimals: token.decimals,
        name: token.name,
      });
    }

    this.tokenCache = tokenMap as Map<string, { symbol: string; decimals: number }>;
    return tokenMap;
  }

  async getPrice(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: bigint = 1_000_000n
  ): Promise<number> {
    const quote = await this.getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps: 50,
      userPublicKey: PublicKey.default,
    });

    const inputDecimals = await this.getTokenDecimals(inputMint);
    const outputDecimals = await this.getTokenDecimals(outputMint);

    const inputNormalized = Number(quote.inputAmount) / Math.pow(10, inputDecimals);
    const outputNormalized = Number(quote.outputAmount) / Math.pow(10, outputDecimals);

    return outputNormalized / inputNormalized;
  }

  private async getTokenDecimals(mint: PublicKey): Promise<number> {
    const cached = this.tokenCache.get(mint.toBase58());
    if (cached) return cached.decimals;

    const accountInfo = await this.connection.getParsedAccountInfo(mint);
    if (!accountInfo.value) {
      throw new Error(`Token mint not found: ${mint.toBase58()}`);
    }

    const data = accountInfo.value.data;
    if ('parsed' in data) {
      return data.parsed.info.decimals;
    }

    throw new Error(`Could not parse token decimals: ${mint.toBase58()}`);
  }
}

export function createJupiterAdapter(connection: Connection): JupiterAdapter {
  return new JupiterAdapter(connection);
}


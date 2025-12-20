/**
 * Otto Trading Service
 * Handles all trading operations: swaps, bridges, token launches, etc.
 */

import { type Address, formatUnits, parseUnits, type Hex } from 'viem';
import type {
  TokenInfo,
  Balance,
  SwapQuote,
  SwapParams,
  SwapResult,
  BridgeQuote,
  BridgeParams,
  BridgeResult,
  TokenLaunchParams,
  TokenLaunchResult,
  LimitOrder,
  CreateLimitOrderParams,
  OttoUser,
} from '../types';
import { DEFAULT_CHAIN_ID, DEFAULT_SLIPPAGE_BPS, getChainName } from '../config';

// Service URLs - configured via environment
const BAZAAR_API = process.env.BAZAAR_API_URL ?? 'http://localhost:3001';
const GATEWAY_API = process.env.GATEWAY_API_URL ?? 'http://localhost:4003';
const INDEXER_API = process.env.INDEXER_API_URL ?? 'http://localhost:4350';

export class TradingService {
  private limitOrders = new Map<string, LimitOrder>();

  // ============================================================================
  // Token & Price Operations
  // ============================================================================

  async getTokenInfo(addressOrSymbol: string, chainId: number = DEFAULT_CHAIN_ID): Promise<TokenInfo | null> {
    const response = await fetch(`${INDEXER_API}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `
          query GetToken($input: String!, $chainId: Int!) {
            token(input: $input, chainId: $chainId) {
              address
              chainId
              symbol
              name
              decimals
              logoUrl
              price
              priceChange24h
            }
          }
        `,
        variables: { input: addressOrSymbol, chainId },
      }),
    });

    if (!response.ok) return null;

    const data = await response.json() as { data?: { token?: TokenInfo } };
    return data.data?.token ?? null;
  }

  async getTokenPrice(addressOrSymbol: string, chainId: number = DEFAULT_CHAIN_ID): Promise<number | null> {
    const token = await this.getTokenInfo(addressOrSymbol, chainId);
    return token?.price ?? null;
  }

  async getBalances(userAddress: Address, chainId?: number): Promise<Balance[]> {
    const chains = chainId ? [chainId] : [DEFAULT_CHAIN_ID, 1, 8453, 10, 42161];
    const balances: Balance[] = [];

    for (const chain of chains) {
      const response = await fetch(`${INDEXER_API}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `
            query GetBalances($address: String!, $chainId: Int!) {
              balances(address: $address, chainId: $chainId) {
                token {
                  address
                  chainId
                  symbol
                  name
                  decimals
                  logoUrl
                  price
                }
                balance
                balanceUsd
              }
            }
          `,
          variables: { address: userAddress, chainId: chain },
        }),
      });

      if (response.ok) {
        const data = await response.json() as { data?: { balances?: Balance[] } };
        if (data.data?.balances) {
          balances.push(...data.data.balances);
        }
      }
    }

    return balances;
  }

  // ============================================================================
  // Swap Operations
  // ============================================================================

  async getSwapQuote(params: SwapParams): Promise<SwapQuote | null> {
    const chainId = params.chainId ?? DEFAULT_CHAIN_ID;
    const slippageBps = params.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

    const response = await fetch(`${BAZAAR_API}/api/swap/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromToken: params.fromToken,
        toToken: params.toToken,
        amount: params.amount,
        chainId,
        slippageBps,
      }),
    });

    if (!response.ok) return null;

    return response.json() as Promise<SwapQuote>;
  }

  async executeSwap(user: OttoUser, params: SwapParams): Promise<SwapResult> {
    const quote = await this.getSwapQuote(params);
    if (!quote) {
      return { success: false, fromAmount: params.amount, toAmount: '0', error: 'Failed to get swap quote' };
    }

    // Use smart account if available, otherwise primary wallet
    const walletAddress = user.smartAccountAddress ?? user.primaryWallet;

    const response = await fetch(`${BAZAAR_API}/api/swap/execute`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Wallet-Address': walletAddress,
      },
      body: JSON.stringify({
        quoteId: quote.quoteId,
        fromToken: params.fromToken,
        toToken: params.toToken,
        amount: params.amount,
        minOutput: quote.toAmountMin,
        chainId: params.chainId ?? DEFAULT_CHAIN_ID,
        // For AA, we'd include session key signature here
        sessionKey: user.sessionKeyAddress,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, fromAmount: params.amount, toAmount: '0', error };
    }

    const result = await response.json() as { txHash: Hex; toAmount: string };
    
    return {
      success: true,
      txHash: result.txHash,
      fromAmount: params.amount,
      toAmount: result.toAmount,
    };
  }

  // ============================================================================
  // Bridge Operations
  // ============================================================================

  async getBridgeQuote(params: BridgeParams): Promise<BridgeQuote | null> {
    const response = await fetch(`${GATEWAY_API}/api/intents/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceChain: params.sourceChainId,
        destinationChain: params.destChainId,
        sourceToken: params.sourceToken,
        destinationToken: params.destToken,
        amount: params.amount,
      }),
    });

    if (!response.ok) return null;

    const quotes = await response.json() as BridgeQuote[];
    return quotes[0] ?? null; // Return best quote
  }

  async executeBridge(user: OttoUser, params: BridgeParams): Promise<BridgeResult> {
    const quote = await this.getBridgeQuote(params);
    if (!quote) {
      return { success: false, status: 'failed', error: 'Failed to get bridge quote' };
    }

    const walletAddress = user.smartAccountAddress ?? user.primaryWallet;

    const response = await fetch(`${GATEWAY_API}/api/intents`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Wallet-Address': walletAddress,
      },
      body: JSON.stringify({
        quoteId: quote.quoteId,
        sourceChain: params.sourceChainId,
        destinationChain: params.destChainId,
        sourceToken: params.sourceToken,
        destinationToken: params.destToken,
        amount: params.amount,
        recipient: params.recipient ?? walletAddress,
        maxSlippageBps: params.maxSlippageBps ?? DEFAULT_SLIPPAGE_BPS,
        sessionKey: user.sessionKeyAddress,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, status: 'failed', error };
    }

    const result = await response.json() as { intentId: string; sourceTxHash: Hex };
    
    return {
      success: true,
      intentId: result.intentId,
      sourceTxHash: result.sourceTxHash,
      status: 'pending',
    };
  }

  async getBridgeStatus(intentId: string): Promise<BridgeResult> {
    const response = await fetch(`${GATEWAY_API}/api/intents/${intentId}`);
    
    if (!response.ok) {
      return { success: false, status: 'failed', error: 'Failed to get intent status' };
    }

    const data = await response.json() as {
      status: 'open' | 'pending' | 'filled' | 'expired';
      sourceTxHash?: Hex;
      destinationTxHash?: Hex;
    };

    return {
      success: data.status === 'filled',
      intentId,
      sourceTxHash: data.sourceTxHash,
      destTxHash: data.destinationTxHash,
      status: data.status === 'open' || data.status === 'pending' ? 'pending' : 
              data.status === 'filled' ? 'filled' : 'expired',
    };
  }

  // ============================================================================
  // Token Launch (Clanker-style)
  // ============================================================================

  async launchToken(user: OttoUser, params: TokenLaunchParams): Promise<TokenLaunchResult> {
    const walletAddress = user.smartAccountAddress ?? user.primaryWallet;
    const chainId = params.chainId ?? DEFAULT_CHAIN_ID;

    const response = await fetch(`${BAZAAR_API}/api/launchpad/create`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Wallet-Address': walletAddress,
      },
      body: JSON.stringify({
        name: params.name,
        symbol: params.symbol,
        description: params.description,
        imageUrl: params.imageUrl,
        initialSupply: params.initialSupply,
        initialLiquidity: params.initialLiquidity,
        chainId,
        taxBuyBps: params.taxBuyBps ?? 0,
        taxSellBps: params.taxSellBps ?? 0,
        maxWalletBps: params.maxWalletBps ?? 10000, // 100% = no limit
        creator: walletAddress,
        sessionKey: user.sessionKeyAddress,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const result = await response.json() as { 
      tokenAddress: Address;
      poolAddress: Address;
      txHash: Hex;
    };

    return {
      success: true,
      tokenAddress: result.tokenAddress,
      poolAddress: result.poolAddress,
      txHash: result.txHash,
    };
  }

  // ============================================================================
  // Limit Orders
  // ============================================================================

  async createLimitOrder(user: OttoUser, params: CreateLimitOrderParams): Promise<LimitOrder> {
    const fromToken = await this.getTokenInfo(params.fromToken.toString(), params.chainId);
    const toToken = await this.getTokenInfo(params.toToken.toString(), params.chainId);

    if (!fromToken || !toToken) {
      throw new Error('Invalid tokens');
    }

    const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const order: LimitOrder = {
      orderId,
      userId: params.userId,
      fromToken,
      toToken,
      fromAmount: params.fromAmount,
      targetPrice: params.targetPrice,
      chainId: params.chainId ?? DEFAULT_CHAIN_ID,
      status: 'open',
      createdAt: Date.now(),
      expiresAt: params.expiresIn ? Date.now() + params.expiresIn : undefined,
    };

    this.limitOrders.set(orderId, order);

    // In production, this would be submitted to a limit order system
    // For now, we store it locally and check periodically

    return order;
  }

  async cancelLimitOrder(orderId: string, userId: string): Promise<boolean> {
    const order = this.limitOrders.get(orderId);
    if (!order || order.userId !== userId) return false;
    if (order.status !== 'open') return false;

    order.status = 'cancelled';
    return true;
  }

  getOpenOrders(userId: string): LimitOrder[] {
    return Array.from(this.limitOrders.values())
      .filter(o => o.userId === userId && o.status === 'open');
  }

  // ============================================================================
  // Send Operations
  // ============================================================================

  async sendTokens(
    user: OttoUser,
    tokenAddress: Address,
    amount: string,
    recipient: Address,
    chainId: number = DEFAULT_CHAIN_ID
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    const walletAddress = user.smartAccountAddress ?? user.primaryWallet;

    const response = await fetch(`${BAZAAR_API}/api/transfer`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Wallet-Address': walletAddress,
      },
      body: JSON.stringify({
        token: tokenAddress,
        amount,
        to: recipient,
        chainId,
        sessionKey: user.sessionKeyAddress,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const result = await response.json() as { txHash: Hex };
    return { success: true, txHash: result.txHash };
  }

  // ============================================================================
  // Portfolio
  // ============================================================================

  async getPortfolio(user: OttoUser, chainId?: number): Promise<{
    totalValueUsd: number;
    balances: Balance[];
    chains: { chainId: number; name: string; valueUsd: number }[];
  }> {
    const balances = await this.getBalances(user.primaryWallet, chainId);
    
    let totalValueUsd = 0;
    const chainValues = new Map<number, number>();

    for (const balance of balances) {
      const value = balance.balanceUsd ?? 0;
      totalValueUsd += value;
      
      const chainId = balance.token.chainId;
      chainValues.set(chainId, (chainValues.get(chainId) ?? 0) + value);
    }

    const chains = Array.from(chainValues.entries()).map(([chainId, valueUsd]) => ({
      chainId,
      name: getChainName(chainId),
      valueUsd,
    }));

    return { totalValueUsd, balances, chains };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  formatAmount(amount: string, decimals: number): string {
    return formatUnits(BigInt(amount), decimals);
  }

  parseAmount(amount: string, decimals: number): string {
    return parseUnits(amount, decimals).toString();
  }

  formatUsd(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  }
}

// Singleton instance
let tradingService: TradingService | null = null;

export function getTradingService(): TradingService {
  if (!tradingService) {
    tradingService = new TradingService();
  }
  return tradingService;
}


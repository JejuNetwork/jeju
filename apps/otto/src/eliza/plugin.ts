/**
 * Otto Eliza Plugin
 * Integrates Otto trading capabilities with ElizaOS
 */

import type { Address, Hex } from 'viem';
import { getTradingService } from '../services/trading';
import { getWalletService } from '../services/wallet';
import type { OttoUser } from '../types';
import { getChainId, getChainName, DEFAULT_CHAIN_ID } from '../config';

// ElizaOS Plugin Types (simplified for Otto)
interface Action {
  name: string;
  description: string;
  similes?: string[];
  examples?: string[][];
  handler: (params: ActionParams) => Promise<ActionResult>;
  validate: (params: ActionParams) => Promise<boolean>;
}

interface ActionParams {
  userId: string;
  content: string;
  entities: Record<string, string>;
  context: Record<string, unknown>;
}

interface ActionResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
}

interface Provider {
  name: string;
  description: string;
  handler: (userId: string) => Promise<Record<string, unknown>>;
}

interface Plugin {
  name: string;
  description: string;
  version: string;
  actions: Action[];
  providers: Provider[];
}

const tradingService = getTradingService();
const walletService = getWalletService();

// Helper to get user
async function getUser(userId: string): Promise<OttoUser | null> {
  // In production, this would use the actual platform mapping
  return walletService.getUser(userId);
}

// ============================================================================
// Actions
// ============================================================================

const swapAction: Action = {
  name: 'SWAP_TOKENS',
  description: 'Swap one token for another on a specific chain',
  similes: ['trade', 'exchange', 'convert', 'buy', 'sell'],
  examples: [
    ['I want to swap 1 ETH for USDC', 'Swap 100 USDC to ETH', 'Trade my ETH for USDC'],
  ],
  validate: async (params) => {
    const user = await getUser(params.userId);
    if (!user) return false;
    // Check for required entities
    return !!params.entities.amount && !!params.entities.fromToken && !!params.entities.toToken;
  },
  handler: async (params) => {
    const user = await getUser(params.userId);
    if (!user) {
      return { success: false, message: 'Please connect your wallet first.', error: 'NO_WALLET' };
    }

    const { amount, fromToken, toToken, chain } = params.entities;
    const chainId = chain ? getChainId(chain) : user.settings.defaultChainId;

    if (!chainId) {
      return { success: false, message: `Unknown chain: ${chain}`, error: 'INVALID_CHAIN' };
    }

    const fromTokenInfo = await tradingService.getTokenInfo(fromToken, chainId);
    const toTokenInfo = await tradingService.getTokenInfo(toToken, chainId);

    if (!fromTokenInfo || !toTokenInfo) {
      return { success: false, message: 'Unknown token(s)', error: 'INVALID_TOKEN' };
    }

    const amountWei = tradingService.parseAmount(amount, fromTokenInfo.decimals);
    const result = await tradingService.executeSwap(user, {
      userId: user.id,
      fromToken: fromTokenInfo.address,
      toToken: toTokenInfo.address,
      amount: amountWei,
      chainId,
    });

    if (!result.success) {
      return { success: false, message: result.error ?? 'Swap failed', error: 'SWAP_FAILED' };
    }

    return {
      success: true,
      message: `Swapped ${amount} ${fromToken} for ${tradingService.formatAmount(result.toAmount, toTokenInfo.decimals)} ${toToken}`,
      data: {
        txHash: result.txHash,
        fromAmount: result.fromAmount,
        toAmount: result.toAmount,
      },
    };
  },
};

const bridgeAction: Action = {
  name: 'BRIDGE_TOKENS',
  description: 'Bridge tokens from one chain to another',
  similes: ['transfer cross-chain', 'move to chain', 'bridge'],
  examples: [
    ['Bridge 1 ETH from Ethereum to Base', 'Move my USDC from Arbitrum to Optimism'],
  ],
  validate: async (params) => {
    const user = await getUser(params.userId);
    if (!user) return false;
    return !!params.entities.amount && !!params.entities.token && 
           !!params.entities.fromChain && !!params.entities.toChain;
  },
  handler: async (params) => {
    const user = await getUser(params.userId);
    if (!user) {
      return { success: false, message: 'Please connect your wallet first.', error: 'NO_WALLET' };
    }

    const { amount, token, fromChain, toChain } = params.entities;
    const sourceChainId = getChainId(fromChain);
    const destChainId = getChainId(toChain);

    if (!sourceChainId || !destChainId) {
      return { success: false, message: 'Unknown chain(s)', error: 'INVALID_CHAIN' };
    }

    const sourceToken = await tradingService.getTokenInfo(token, sourceChainId);
    const destToken = await tradingService.getTokenInfo(token, destChainId);

    if (!sourceToken || !destToken) {
      return { success: false, message: `${token} not available on both chains`, error: 'INVALID_TOKEN' };
    }

    const amountWei = tradingService.parseAmount(amount, sourceToken.decimals);
    const result = await tradingService.executeBridge(user, {
      userId: user.id,
      sourceChainId,
      destChainId,
      sourceToken: sourceToken.address,
      destToken: destToken.address,
      amount: amountWei,
    });

    if (!result.success) {
      return { success: false, message: result.error ?? 'Bridge failed', error: 'BRIDGE_FAILED' };
    }

    return {
      success: true,
      message: `Bridging ${amount} ${token} from ${getChainName(sourceChainId)} to ${getChainName(destChainId)}. Intent ID: ${result.intentId}`,
      data: {
        intentId: result.intentId,
        sourceTxHash: result.sourceTxHash,
        status: result.status,
      },
    };
  },
};

const sendAction: Action = {
  name: 'SEND_TOKENS',
  description: 'Send tokens to an address or ENS/JNS name',
  similes: ['transfer', 'pay', 'send crypto'],
  examples: [
    ['Send 1 ETH to vitalik.eth', 'Transfer 100 USDC to 0x...'],
  ],
  validate: async (params) => {
    const user = await getUser(params.userId);
    if (!user) return false;
    return !!params.entities.amount && !!params.entities.token && !!params.entities.recipient;
  },
  handler: async (params) => {
    const user = await getUser(params.userId);
    if (!user) {
      return { success: false, message: 'Please connect your wallet first.', error: 'NO_WALLET' };
    }

    const { amount, token, recipient, chain } = params.entities;
    const chainId = chain ? getChainId(chain) : user.settings.defaultChainId;

    if (!chainId) {
      return { success: false, message: `Unknown chain: ${chain}`, error: 'INVALID_CHAIN' };
    }

    const tokenInfo = await tradingService.getTokenInfo(token, chainId);
    if (!tokenInfo) {
      return { success: false, message: `Unknown token: ${token}`, error: 'INVALID_TOKEN' };
    }

    const resolvedAddress = await walletService.resolveAddress(recipient);
    if (!resolvedAddress) {
      return { success: false, message: `Could not resolve: ${recipient}`, error: 'INVALID_ADDRESS' };
    }

    const amountWei = tradingService.parseAmount(amount, tokenInfo.decimals);
    const result = await tradingService.sendTokens(user, tokenInfo.address, amountWei, resolvedAddress, chainId);

    if (!result.success) {
      return { success: false, message: result.error ?? 'Send failed', error: 'SEND_FAILED' };
    }

    const displayName = await walletService.getDisplayName(resolvedAddress);
    return {
      success: true,
      message: `Sent ${amount} ${token} to ${displayName}`,
      data: { txHash: result.txHash },
    };
  },
};

const launchTokenAction: Action = {
  name: 'LAUNCH_TOKEN',
  description: 'Launch a new token with initial liquidity',
  similes: ['create token', 'deploy token', 'mint token'],
  examples: [
    ['Launch a token called Moon Coin with symbol MOON', 'Create a new token named Test with 1M supply'],
  ],
  validate: async (params) => {
    const user = await getUser(params.userId);
    if (!user) return false;
    return !!params.entities.name && !!params.entities.symbol;
  },
  handler: async (params) => {
    const user = await getUser(params.userId);
    if (!user) {
      return { success: false, message: 'Please connect your wallet first.', error: 'NO_WALLET' };
    }

    const { name, symbol, supply, liquidity, chain } = params.entities;
    const chainId = chain ? getChainId(chain) : user.settings.defaultChainId;

    if (!chainId) {
      return { success: false, message: `Unknown chain: ${chain}`, error: 'INVALID_CHAIN' };
    }

    const result = await tradingService.launchToken(user, {
      userId: user.id,
      name,
      symbol,
      initialSupply: supply ?? '1000000000',
      initialLiquidity: liquidity,
      chainId,
    });

    if (!result.success) {
      return { success: false, message: result.error ?? 'Launch failed', error: 'LAUNCH_FAILED' };
    }

    return {
      success: true,
      message: `Token ${symbol} launched at ${result.tokenAddress}`,
      data: {
        tokenAddress: result.tokenAddress,
        poolAddress: result.poolAddress,
        txHash: result.txHash,
      },
    };
  },
};

const getBalanceAction: Action = {
  name: 'GET_BALANCE',
  description: 'Get token balances for the user',
  similes: ['check balance', 'show balance', 'how much do I have'],
  examples: [
    ['What is my ETH balance?', 'Show my token balances', 'How much USDC do I have?'],
  ],
  validate: async (params) => {
    const user = await getUser(params.userId);
    return !!user;
  },
  handler: async (params) => {
    const user = await getUser(params.userId);
    if (!user) {
      return { success: false, message: 'Please connect your wallet first.', error: 'NO_WALLET' };
    }

    const { token, chain } = params.entities;
    const chainId = chain ? getChainId(chain) : undefined;

    const balances = await tradingService.getBalances(user.primaryWallet, chainId);

    if (token) {
      const filtered = balances.filter(b => b.token.symbol.toLowerCase() === token.toLowerCase());
      if (filtered.length === 0) {
        return { success: true, message: `No ${token} found in your wallet.`, data: { balances: [] } };
      }

      const balance = filtered[0];
      return {
        success: true,
        message: `You have ${tradingService.formatAmount(balance.balance, balance.token.decimals)} ${balance.token.symbol}${balance.balanceUsd ? ` (${tradingService.formatUsd(balance.balanceUsd)})` : ''}`,
        data: { balances: filtered },
      };
    }

    const totalUsd = balances.reduce((sum, b) => sum + (b.balanceUsd ?? 0), 0);
    return {
      success: true,
      message: `Your portfolio is worth ${tradingService.formatUsd(totalUsd)} across ${balances.length} tokens.`,
      data: { balances, totalUsd },
    };
  },
};

const getPriceAction: Action = {
  name: 'GET_PRICE',
  description: 'Get the price of a token',
  similes: ['price check', 'how much is', 'token price'],
  examples: [
    ['What is the price of ETH?', 'How much is BTC worth?'],
  ],
  validate: async (params) => {
    return !!params.entities.token;
  },
  handler: async (params) => {
    const { token, chain } = params.entities;
    const chainId = chain ? getChainId(chain) : DEFAULT_CHAIN_ID;

    if (!chainId) {
      return { success: false, message: `Unknown chain: ${chain}`, error: 'INVALID_CHAIN' };
    }

    const tokenInfo = await tradingService.getTokenInfo(token, chainId);
    if (!tokenInfo || !tokenInfo.price) {
      return { success: false, message: `Could not find price for ${token}`, error: 'PRICE_NOT_FOUND' };
    }

    const changeStr = tokenInfo.priceChange24h 
      ? `${tokenInfo.priceChange24h >= 0 ? '+' : ''}${tokenInfo.priceChange24h.toFixed(2)}%`
      : '';

    return {
      success: true,
      message: `${tokenInfo.symbol} is ${tradingService.formatUsd(tokenInfo.price)}${changeStr ? ` (${changeStr} 24h)` : ''}`,
      data: {
        symbol: tokenInfo.symbol,
        price: tokenInfo.price,
        priceChange24h: tokenInfo.priceChange24h,
      },
    };
  },
};

// ============================================================================
// Providers
// ============================================================================

const walletProvider: Provider = {
  name: 'wallet',
  description: 'Provides wallet state and balances',
  handler: async (userId) => {
    const user = await getUser(userId);
    if (!user) {
      return { connected: false };
    }

    const balances = await tradingService.getBalances(user.primaryWallet);
    const totalUsd = balances.reduce((sum, b) => sum + (b.balanceUsd ?? 0), 0);

    return {
      connected: true,
      address: user.primaryWallet,
      smartAccount: user.smartAccountAddress,
      hasSessionKey: walletService.hasValidSessionKey(user),
      balances: balances.slice(0, 5), // Top 5 balances
      totalValueUsd: totalUsd,
    };
  },
};

const marketProvider: Provider = {
  name: 'market',
  description: 'Provides market data and prices',
  handler: async () => {
    // Fetch common token prices
    const tokens = ['ETH', 'BTC', 'USDC', 'USDT'];
    const prices: Record<string, number> = {};

    for (const token of tokens) {
      const price = await tradingService.getTokenPrice(token, DEFAULT_CHAIN_ID);
      if (price) {
        prices[token] = price;
      }
    }

    return { prices };
  },
};

// ============================================================================
// Plugin Export
// ============================================================================

export const ottoPlugin: Plugin = {
  name: 'otto',
  description: 'Otto trading plugin for ElizaOS - enables trading, bridging, and token operations',
  version: '1.0.0',
  actions: [
    swapAction,
    bridgeAction,
    sendAction,
    launchTokenAction,
    getBalanceAction,
    getPriceAction,
  ],
  providers: [
    walletProvider,
    marketProvider,
  ],
};

export default ottoPlugin;


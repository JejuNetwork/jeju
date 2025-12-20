/**
 * Otto ElizaOS Plugin
 * Trading actions for the Otto agent
 */

import type { Plugin, Action, Provider } from '@elizaos/core';
import { getTradingService } from '../services/trading';
import { getWalletService } from '../services/wallet';
import { getStateManager } from '../services/state';
import { getChainId, DEFAULT_CHAIN_ID, getChainName } from '../config';
import type { Platform } from '../types';

const tradingService = getTradingService();
const walletService = getWalletService();
const stateManager = getStateManager();

const PENDING_ACTION_TTL = 5 * 60 * 1000;

// Helper to parse swap params
function parseSwapParams(text: string): { amount?: string; from?: string; to?: string; chain?: string } {
  const result: { amount?: string; from?: string; to?: string; chain?: string } = {};
  const swapMatch = text.match(/(\d+(?:\.\d+)?)\s*(\w+)\s+(?:to|for|into)\s+(\w+)/i);
  if (swapMatch) {
    result.amount = swapMatch[1];
    result.from = swapMatch[2].toUpperCase();
    result.to = swapMatch[3].toUpperCase();
  }
  const chainMatch = text.match(/\bon\s+(\w+)/i);
  if (chainMatch) result.chain = chainMatch[1].toLowerCase();
  return result;
}

// Helper to parse bridge params
function parseBridgeParams(text: string): { amount?: string; token?: string; fromChain?: string; toChain?: string } {
  const result: { amount?: string; token?: string; fromChain?: string; toChain?: string } = {};
  const bridgeMatch = text.match(/(\d+(?:\.\d+)?)\s*(\w+)\s+from\s+(\w+)\s+to\s+(\w+)/i);
  if (bridgeMatch) {
    result.amount = bridgeMatch[1];
    result.token = bridgeMatch[2].toUpperCase();
    result.fromChain = bridgeMatch[3].toLowerCase();
    result.toChain = bridgeMatch[4].toLowerCase();
  }
  return result;
}

// ============================================================================
// Actions
// ============================================================================

export const swapAction: Action = {
  name: 'OTTO_SWAP',
  description: 'Swap tokens on the default chain or specified chain',
  similes: ['swap', 'exchange', 'trade', 'convert', 'buy', 'sell'],
  validate: async () => true,
  handler: async (_runtime, message, _state, _options, callback) => {
    const text = String(message.content?.text ?? '');
    const params = parseSwapParams(text);
    const userId = String(message.agentId ?? 'anonymous');
    const platform = (message.content?.source ?? 'web') as Platform;
    
    if (!params.amount || !params.from || !params.to) {
      callback?.({ text: 'Please specify what to swap. Example: "swap 1 ETH to USDC"' });
      return;
    }
    
    const user = walletService.getUserByPlatform(platform, userId);
    if (!user) {
      const connectUrl = walletService.getConnectUrl(platform, userId, userId);
      callback?.({ text: `Connect your wallet first:\n${connectUrl}` });
      return;
    }
    
    const chainId = params.chain ? getChainId(params.chain) ?? user.settings.defaultChainId : user.settings.defaultChainId;
    const fromToken = await tradingService.getTokenInfo(params.from, chainId);
    const toToken = await tradingService.getTokenInfo(params.to, chainId);
    
    if (!fromToken || !toToken) {
      callback?.({ text: `Could not find token info for ${params.from} or ${params.to}` });
      return;
    }
    
    const amount = tradingService.parseAmount(params.amount, fromToken.decimals);
    const quote = await tradingService.getSwapQuote({
      userId: user.id,
      fromToken: fromToken.address,
      toToken: toToken.address,
      amount,
      chainId,
    });
    
    if (!quote) {
      callback?.({ text: 'Could not get swap quote. Try again.' });
      return;
    }
    
    const channelId = String(message.roomId ?? '');
    const toAmount = tradingService.formatAmount(quote.toAmount, toToken.decimals);
    
    stateManager.setPendingAction(platform, channelId, {
      type: 'swap',
      quote,
      params: { amount: params.amount, from: params.from, to: params.to, chainId },
      expiresAt: Date.now() + PENDING_ACTION_TTL,
    });
    
    callback?.({
      text: `**Swap Quote**\n\n${params.amount} ${params.from} → ${toAmount} ${params.to}\nPrice Impact: ${(quote.priceImpact * 100).toFixed(2)}%\nChain: ${getChainName(chainId)}\n\nReply "confirm" to execute or "cancel" to abort.`,
    });
  },
  examples: [
    [{ name: 'user', content: { text: 'swap 1 ETH to USDC' } }, { name: 'Otto', content: { text: 'Getting quote...' } }],
  ],
};

export const bridgeAction: Action = {
  name: 'OTTO_BRIDGE',
  description: 'Bridge tokens across different blockchain networks',
  similes: ['bridge', 'cross-chain', 'transfer between chains'],
  validate: async () => true,
  handler: async (_runtime, message, _state, _options, callback) => {
    const text = String(message.content?.text ?? '');
    const params = parseBridgeParams(text);
    const userId = String(message.agentId ?? 'anonymous');
    const platform = (message.content?.source ?? 'web') as Platform;
    
    if (!params.amount || !params.token || !params.fromChain || !params.toChain) {
      callback?.({ text: 'Please specify bridge details. Example: "bridge 1 ETH from ethereum to base"' });
      return;
    }
    
    const user = walletService.getUserByPlatform(platform, userId);
    if (!user) {
      const connectUrl = walletService.getConnectUrl(platform, userId, userId);
      callback?.({ text: `Connect your wallet first:\n${connectUrl}` });
      return;
    }
    
    const sourceChainId = getChainId(params.fromChain);
    const destChainId = getChainId(params.toChain);
    
    if (!sourceChainId || !destChainId) {
      callback?.({ text: `Unknown chain: ${!sourceChainId ? params.fromChain : params.toChain}` });
      return;
    }
    
    const tokenInfo = await tradingService.getTokenInfo(params.token, sourceChainId);
    if (!tokenInfo) {
      callback?.({ text: `Could not find token ${params.token}` });
      return;
    }
    
    const amount = tradingService.parseAmount(params.amount, tokenInfo.decimals);
    const quote = await tradingService.getBridgeQuote({
      userId: user.id,
      sourceChainId,
      destChainId,
      sourceToken: tokenInfo.address,
      destToken: tokenInfo.address,
      amount,
    });
    
    if (!quote) {
      callback?.({ text: 'Could not get bridge quote. Try again.' });
      return;
    }
    
    const channelId = String(message.roomId ?? '');
    const outputAmount = tradingService.formatAmount(quote.outputAmount, tokenInfo.decimals);
    
    stateManager.setPendingAction(platform, channelId, {
      type: 'bridge',
      quote,
      params: { amount: params.amount, token: params.token, fromChain: params.fromChain, toChain: params.toChain, sourceChainId, destChainId },
      expiresAt: Date.now() + PENDING_ACTION_TTL,
    });
    
    callback?.({
      text: `**Bridge Quote**\n\n${params.amount} ${params.token} (${params.fromChain}) → ${outputAmount} ${params.token} (${params.toChain})\nFee: ${tradingService.formatUsd(quote.feeUsd ?? 0)}\nTime: ~${Math.ceil(quote.estimatedTimeSeconds / 60)} min\n\nReply "confirm" or "cancel".`,
    });
  },
  examples: [
    [{ name: 'user', content: { text: 'bridge 1 ETH from ethereum to base' } }, { name: 'Otto', content: { text: 'Getting quote...' } }],
  ],
};

export const balanceAction: Action = {
  name: 'OTTO_BALANCE',
  description: 'Check token balances for connected wallet',
  similes: ['balance', 'check balance', 'my tokens', 'portfolio'],
  validate: async () => true,
  handler: async (_runtime, message, _state, _options, callback) => {
    const userId = String(message.agentId ?? 'anonymous');
    const platform = (message.content?.source ?? 'web') as Platform;
    
    const user = walletService.getUserByPlatform(platform, userId);
    if (!user) {
      const connectUrl = walletService.getConnectUrl(platform, userId, userId);
      callback?.({ text: `Connect your wallet first:\n${connectUrl}` });
      return;
    }
    
    const balances = await tradingService.getBalances(
      user.smartAccountAddress ?? user.primaryWallet,
      user.settings.defaultChainId
    );
    
    if (balances.length === 0) {
      callback?.({ text: `No tokens found on ${getChainName(user.settings.defaultChainId)}` });
      return;
    }
    
    const lines = balances.map(b => {
      const amt = tradingService.formatAmount(b.balance, b.token.decimals);
      const usd = b.balanceUsd ? ` ($${b.balanceUsd.toFixed(2)})` : '';
      return `• ${amt} ${b.token.symbol}${usd}`;
    });
    
    callback?.({ text: `**Balances on ${getChainName(user.settings.defaultChainId)}**\n\n${lines.join('\n')}` });
  },
  examples: [
    [{ name: 'user', content: { text: 'check my balance' } }, { name: 'Otto', content: { text: 'Fetching balances...' } }],
  ],
};

export const priceAction: Action = {
  name: 'OTTO_PRICE',
  description: 'Get current token price',
  similes: ['price', 'price of', 'how much is'],
  validate: async () => true,
  handler: async (_runtime, message, _state, _options, callback) => {
    const text = String(message.content?.text ?? '');
    const tokenMatch = text.match(/(?:price\s+(?:of\s+)?)?(\w+)(?:\s+price)?/i);
    const token = tokenMatch?.[1]?.toUpperCase();
    
    if (!token || ['PRICE', 'OF', 'THE', 'GET'].includes(token)) {
      callback?.({ text: 'Which token? Example: "price of ETH"' });
      return;
    }
    
    const tokenInfo = await tradingService.getTokenInfo(token, DEFAULT_CHAIN_ID);
    if (!tokenInfo) {
      callback?.({ text: `Could not find token: ${token}` });
      return;
    }
    
    const price = tokenInfo.price?.toFixed(2) ?? 'N/A';
    const change = tokenInfo.priceChange24h ? `${tokenInfo.priceChange24h >= 0 ? '+' : ''}${tokenInfo.priceChange24h.toFixed(2)}%` : '';
    
    callback?.({ text: `**${tokenInfo.name} (${tokenInfo.symbol})**\nPrice: $${price} ${change}` });
  },
  examples: [
    [{ name: 'user', content: { text: 'price of ETH' } }, { name: 'Otto', content: { text: 'ETH: $2500' } }],
  ],
};

export const connectAction: Action = {
  name: 'OTTO_CONNECT',
  description: 'Connect wallet to start trading',
  similes: ['connect', 'connect wallet', 'link wallet', 'login'],
  validate: async () => true,
  handler: async (_runtime, message, _state, _options, callback) => {
    const userId = String(message.agentId ?? 'anonymous');
    const platform = (message.content?.source ?? 'web') as Platform;
    const connectUrl = walletService.getConnectUrl(platform, userId, userId);
    callback?.({ text: `Connect your wallet:\n${connectUrl}` });
  },
  examples: [
    [{ name: 'user', content: { text: 'connect wallet' } }, { name: 'Otto', content: { text: 'Connect: https://...' } }],
  ],
};

export const confirmAction: Action = {
  name: 'OTTO_CONFIRM',
  description: 'Confirm pending swap or bridge',
  similes: ['confirm', 'yes', 'execute', 'do it'],
  validate: async () => true,
  handler: async (_runtime, message, _state, _options, callback) => {
    const userId = String(message.agentId ?? 'anonymous');
    const platform = (message.content?.source ?? 'web') as Platform;
    const channelId = String(message.roomId ?? '');
    
    const user = walletService.getUserByPlatform(platform, userId);
    if (!user) {
      callback?.({ text: 'Connect your wallet first.' });
      return;
    }
    
    const pending = stateManager.getPendingAction(platform, channelId);
    if (!pending) {
      callback?.({ text: 'No pending action to confirm.' });
      return;
    }
    
    if (Date.now() > pending.expiresAt) {
      stateManager.clearPendingAction(platform, channelId);
      callback?.({ text: 'Quote expired. Request a new quote.' });
      return;
    }
    
    if (pending.type === 'swap' && pending.quote) {
      const result = await tradingService.executeSwap(user.id, pending.quote);
      stateManager.clearPendingAction(platform, channelId);
      callback?.({ text: result.success ? `Swap complete.\nTx: ${result.txHash}` : `Swap failed: ${result.error}` });
    } else if (pending.type === 'bridge' && pending.quote) {
      const result = await tradingService.executeBridge(user.id, pending.quote);
      stateManager.clearPendingAction(platform, channelId);
      callback?.({ text: result.success ? `Bridge initiated.\nTx: ${result.sourceTxHash}` : `Bridge failed: ${result.error}` });
    }
  },
  examples: [
    [{ name: 'user', content: { text: 'confirm' } }, { name: 'Otto', content: { text: 'Executing...' } }],
  ],
};

export const cancelAction: Action = {
  name: 'OTTO_CANCEL',
  description: 'Cancel pending swap or bridge',
  similes: ['cancel', 'no', 'abort', 'nevermind'],
  validate: async () => true,
  handler: async (_runtime, message, _state, _options, callback) => {
    const platform = (message.content?.source ?? 'web') as Platform;
    const channelId = String(message.roomId ?? '');
    stateManager.clearPendingAction(platform, channelId);
    callback?.({ text: 'Cancelled.' });
  },
  examples: [
    [{ name: 'user', content: { text: 'cancel' } }, { name: 'Otto', content: { text: 'Cancelled.' } }],
  ],
};

export const helpAction: Action = {
  name: 'OTTO_HELP',
  description: 'Show Otto capabilities and commands',
  similes: ['help', 'what can you do', 'commands'],
  validate: async () => true,
  handler: async (_runtime, _message, _state, _options, callback) => {
    callback?.({
      text: `**Otto Trading Agent**\n\nI can help you with:\n• **Swap** - "swap 1 ETH to USDC"\n• **Bridge** - "bridge 1 ETH from ethereum to base"\n• **Balance** - "check my balance"\n• **Price** - "price of ETH"\n• **Connect** - "connect wallet"\n\nAfter getting a quote, reply "confirm" or "cancel".`,
    });
  },
  examples: [
    [{ name: 'user', content: { text: 'help' } }, { name: 'Otto', content: { text: 'I can help with swap, bridge...' } }],
  ],
};

// ============================================================================
// Provider
// ============================================================================

export const ottoWalletProvider: Provider = {
  get: async (_runtime, message) => {
    const userId = String(message.agentId ?? 'anonymous');
    const platform = (message.content?.source ?? 'web') as Platform;
    const user = walletService.getUserByPlatform(platform, userId);
    
    if (!user) {
      return 'User not connected. Use "connect wallet" to link.';
    }
    
    const channelId = String(message.roomId ?? '');
    const pending = stateManager.getPendingAction(platform, channelId);
    
    return `Wallet: ${user.primaryWallet}\nChain: ${getChainName(user.settings.defaultChainId)}\nPending: ${pending ? pending.type : 'None'}`;
  },
};

// ============================================================================
// Plugin Export
// ============================================================================

export const ottoPlugin: Plugin = {
  name: 'otto',
  description: 'Otto Trading Agent - Swap, bridge, and manage tokens',
  actions: [swapAction, bridgeAction, balanceAction, priceAction, connectAction, confirmAction, cancelAction, helpAction],
  providers: [ottoWalletProvider],
  evaluators: [],
  services: [],
};

export default ottoPlugin;

/**
 * Otto ElizaOS Plugin
 * Exposes Otto trading capabilities as ElizaOS Actions
 * Uses official ElizaOS plugins for platform handling
 */

import type {
  Plugin,
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  Provider,
  HandlerOptions,
} from '@elizaos/core';
import { getTradingService } from '../services/trading';
import { getWalletService } from '../services/wallet';
import { getStateManager } from '../services/state';
import { getChainId, DEFAULT_CHAIN_ID, getChainName, PENDING_ACTION_TTL } from '../config';
import type { OttoUser, Platform } from '../types';
import { expectValid, OttoUserSchema } from '../schemas';
import { parseSwapParams, parseBridgeParams, validateSwapParams } from '../utils/parsing';

function getUserId(message: Memory): string {
  return String(message.content?.userId ?? message.agentId ?? '');
}

function getRoomId(message: Memory): string {
  return String(message.roomId ?? '');
}

function getPlatform(message: Memory): Platform {
  const source = message.content?.source;
  if (source === 'discord' || source === 'telegram' || source === 'whatsapp' || 
      source === 'farcaster' || source === 'twitter' || source === 'web') {
    return source;
  }
  return 'web';
}

// ============================================================================
// Helper Functions
// ============================================================================

async function getOrCreateUser(_runtime: IAgentRuntime, message: Memory): Promise<OttoUser | null> {
  const userId = getUserId(message);
  if (!userId) {
    throw new Error('Message must have userId');
  }
  
  const platform = getPlatform(message);
  const user = getWalletService().getUserByPlatform(platform, userId);
  
  if (!user) {
    return null;
  }
  
  return expectValid(OttoUserSchema, user, 'getOrCreateUser');
}

// ============================================================================
// Actions
// ============================================================================

export const swapAction: Action = {
  name: 'OTTO_SWAP',
  description: 'Swap tokens on the default chain or specified chain',
  similes: ['swap', 'exchange', 'trade', 'convert', 'buy', 'sell'],
  
  validate: async (_runtime: IAgentRuntime) => true,
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ) => {
    const text = String(message.content?.text ?? '');
    if (!text) {
      callback?.({ text: 'Invalid message content' });
      return;
    }
    
    const params = parseSwapParams(text);
    const validation = validateSwapParams(params);
    
    if (!validation.valid) {
      callback?.({
        text: validation.error ?? 'Please specify what to swap. Example: "swap 1 ETH to USDC" or "exchange 100 USDC for ETH on base"',
      });
      return;
    }
    
    const user = await getOrCreateUser(runtime, message);
    if (!user) {
      const userId = getUserId(message);
      const platform = getPlatform(message);
      const connectUrl = await getWalletService().generateConnectUrl(platform, userId, userId);
      callback?.({ text: `Connect your wallet first:\n${connectUrl}` });
      return;
    }
    
    const chainId = params.chain ? getChainId(params.chain) ?? user.settings.defaultChainId : user.settings.defaultChainId;
    const fromToken = await getTradingService().getTokenInfo(params.from ?? '', chainId);
    const toToken = await getTradingService().getTokenInfo(params.to ?? '', chainId);
    
    if (!fromToken || !toToken) {
      callback?.({ text: `Could not find token info for ${params.from} or ${params.to}` });
      return;
    }
    
    callback?.({ text: `Getting quote for ${params.amount} ${params.from} → ${params.to}...` });
    
    const amount = getTradingService().parseAmount(params.amount ?? '0', fromToken.decimals);
    const quote = await getTradingService().getSwapQuote({
      userId: user.id,
      fromToken: fromToken.address,
      toToken: toToken.address,
      amount,
      chainId,
    });
    
    if (!quote) {
      callback?.({ text: 'Could not get swap quote. Try again later.' });
      return;
    }
    
    const toAmount = getTradingService().formatAmount(quote.toAmount, toToken.decimals);
    const priceImpact = (quote.priceImpact * 100).toFixed(2);
    
    const platform = getPlatform(message);
    const channelId = getRoomId(message);
    getStateManager().setPendingAction(platform, channelId, {
      type: 'swap',
      quote,
      params: {
        amount: params.amount ?? '0',
        from: params.from ?? '',
        to: params.to ?? '',
        chainId,
      },
      expiresAt: Date.now() + PENDING_ACTION_TTL,
    });
    
    callback?.({
      text: `**Swap Quote**

${params.amount} ${params.from} → ${toAmount} ${params.to}
Price Impact: ${priceImpact}%
Chain: ${getChainName(chainId)}

Reply "confirm" to execute or "cancel" to abort.`,
    });
  },
  
  examples: [
    [
      { name: 'user', content: { text: 'swap 1 ETH to USDC' } },
      { name: 'agent', content: { text: 'Getting quote for 1 ETH → USDC...' } },
    ],
    [
      { name: 'user', content: { text: 'exchange 100 USDC for ETH on base' } },
      { name: 'agent', content: { text: 'Getting quote for 100 USDC → ETH...' } },
    ],
  ],
};

export const bridgeAction: Action = {
  name: 'OTTO_BRIDGE',
  description: 'Bridge tokens across different blockchain networks',
  similes: ['bridge', 'cross-chain', 'transfer between chains', 'move to'],
  
  validate: async (_runtime: IAgentRuntime) => true,
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ) => {
    const text = String(message.content?.text ?? '');
    const params = parseBridgeParams(text);
    
    if (!params.amount || !params.token || !params.fromChain || !params.toChain) {
      callback?.({ text: 'Please specify bridge details. Example: "bridge 1 ETH from ethereum to base"' });
      return;
    }
    
    const user = await getOrCreateUser(runtime, message);
    if (!user) {
      const userId = getUserId(message);
      const platform = getPlatform(message);
      const connectUrl = await getWalletService().generateConnectUrl(platform, userId, userId);
      callback?.({ text: `Connect your wallet first:\n${connectUrl}` });
      return;
    }
    
    const sourceChainId = getChainId(params.fromChain);
    const destChainId = getChainId(params.toChain);
    
    if (!sourceChainId || !destChainId) {
      callback?.({
        text: `Unknown chain: ${!sourceChainId ? params.fromChain : params.toChain}. Supported: ethereum, base, optimism, arbitrum, jeju`,
      });
      return;
    }
    
    callback?.({
      text: `Getting bridge quote for ${params.amount} ${params.token} from ${params.fromChain} to ${params.toChain}...`,
    });
    
    const sourceToken = await getTradingService().getTokenInfo(params.token, sourceChainId);
    const destToken = await getTradingService().getTokenInfo(params.token, destChainId);
    
    if (!sourceToken || !destToken) {
      callback?.({ text: `Could not find token ${params.token} on one of the chains.` });
      return;
    }
    
    const amount = getTradingService().parseAmount(params.amount, sourceToken.decimals);
    const quote = await getTradingService().getBridgeQuote({
      userId: user.id,
      sourceChainId,
      destChainId,
      sourceToken: sourceToken.address,
      destToken: destToken.address,
      amount,
    });
    
    if (!quote) {
      callback?.({ text: 'Could not get bridge quote. Try again later.' });
      return;
    }
    
    const outputAmount = getTradingService().formatAmount(quote.outputAmount, destToken.decimals);
    const fee = getTradingService().formatUsd(quote.feeUsd ?? 0);
    const time = Math.ceil(quote.estimatedTimeSeconds / 60);
    
    const platform = getPlatform(message);
    const channelId = getRoomId(message);
    getStateManager().setPendingAction(platform, channelId, {
      type: 'bridge',
      quote,
      params: {
        amount: params.amount,
        token: params.token,
        fromChain: params.fromChain,
        toChain: params.toChain,
        sourceChainId,
        destChainId,
      },
      expiresAt: Date.now() + PENDING_ACTION_TTL,
    });
    
    callback?.({
      text: `**Bridge Quote**

${params.amount} ${params.token} (${params.fromChain}) → ${outputAmount} ${params.token} (${params.toChain})
Fee: ${fee}
Estimated time: ~${time} min

Reply "confirm" to execute or "cancel" to abort.`,
    });
  },
  
  examples: [
    [
      { name: 'user', content: { text: 'bridge 1 ETH from ethereum to base' } },
      { name: 'agent', content: { text: 'Getting bridge quote...' } },
    ],
  ],
};

export const balanceAction: Action = {
  name: 'OTTO_BALANCE',
  description: 'Check token balances for connected wallet',
  similes: ['balance', 'check balance', 'my tokens', 'portfolio', 'holdings'],
  
  validate: async (_runtime: IAgentRuntime) => true,
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ) => {
    const user = await getOrCreateUser(runtime, message);
    if (!user) {
      const userId = getUserId(message);
      const platform = getPlatform(message);
      const connectUrl = await getWalletService().generateConnectUrl(platform, userId, userId);
      callback?.({ text: `Connect your wallet first:\n${connectUrl}` });
      return;
    }
    
    callback?.({ text: 'Fetching your balances...' });
    
    const balances = await getTradingService().getBalances(
      user.smartAccountAddress ?? user.primaryWallet,
      user.settings.defaultChainId
    );
    
    if (balances.length === 0) {
      callback?.({
        text: `No tokens found for ${user.primaryWallet.slice(0, 6)}...${user.primaryWallet.slice(-4)} on ${getChainName(user.settings.defaultChainId)}`,
      });
      return;
    }
    
    const lines = balances.map(b => {
      const amount = getTradingService().formatAmount(b.balance, b.token.decimals);
      const usd = b.balanceUsd ? ` ($${b.balanceUsd.toFixed(2)})` : '';
      return `• ${amount} ${b.token.symbol}${usd}`;
    });
    
    callback?.({ text: `**Balances on ${getChainName(user.settings.defaultChainId)}**\n\n${lines.join('\n')}` });
  },
  
  examples: [
    [
      { name: 'user', content: { text: 'check my balance' } },
      { name: 'agent', content: { text: 'Fetching your balances...' } },
    ],
  ],
};

export const priceAction: Action = {
  name: 'OTTO_PRICE',
  description: 'Get current token price',
  similes: ['price', 'price of', 'how much is', 'token price'],
  
  validate: async (_runtime: IAgentRuntime) => true,
  
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ) => {
    const text = String(message.content?.text ?? '');
    const tokenMatch = text.match(/(?:price\s+(?:of\s+)?)?(\w+)(?:\s+price)?/i);
    const token = tokenMatch?.[1]?.toUpperCase();
    
    if (!token || ['PRICE', 'OF', 'THE', 'GET', 'CHECK'].includes(token)) {
      callback?.({ text: 'Which token? Example: "price of ETH" or "USDC price"' });
      return;
    }
    
    const tokenInfo = await getTradingService().getTokenInfo(token, DEFAULT_CHAIN_ID);
    
    if (!tokenInfo) {
      callback?.({ text: `Could not find token: ${token}` });
      return;
    }
    
    const price = tokenInfo.price?.toFixed(2) ?? 'N/A';
    const change = tokenInfo.priceChange24h 
      ? `${tokenInfo.priceChange24h >= 0 ? '+' : ''}${tokenInfo.priceChange24h.toFixed(2)}%`
      : '';
    
    callback?.({ text: `**${tokenInfo.name} (${tokenInfo.symbol})**\nPrice: $${price} ${change}` });
  },
  
  examples: [
    [
      { name: 'user', content: { text: 'price of ETH' } },
      { name: 'agent', content: { text: '**Ethereum (ETH)**\nPrice: $2500 +2.5%' } },
    ],
  ],
};

export const connectAction: Action = {
  name: 'OTTO_CONNECT',
  description: 'Connect wallet to start trading',
  similes: ['connect', 'connect wallet', 'link wallet', 'login'],
  
  validate: async (_runtime: IAgentRuntime) => true,
  
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ) => {
    const userId = getUserId(message);
    const platform = getPlatform(message);
    const connectUrl = await getWalletService().generateConnectUrl(platform, userId, userId);
    callback?.({ text: `Connect your wallet:\n${connectUrl}` });
  },
  
  examples: [
    [
      { name: 'user', content: { text: 'connect my wallet' } },
      { name: 'agent', content: { text: 'Connect your wallet: https://...' } },
    ],
  ],
};

export const confirmAction: Action = {
  name: 'OTTO_CONFIRM',
  description: 'Confirm pending swap or bridge',
  similes: ['confirm', 'yes', 'execute', 'do it', 'proceed'],
  
  validate: async (_runtime: IAgentRuntime) => true,
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ) => {
    const user = await getOrCreateUser(runtime, message);
    if (!user) {
      callback?.({ text: 'Connect your wallet first.' });
      return;
    }
    
    const platform = getPlatform(message);
    const channelId = getRoomId(message);
    const pending = getStateManager().getPendingAction(platform, channelId);
    
    if (!pending) {
      callback?.({ text: 'No pending action to confirm. Start a new swap or bridge.' });
      return;
    }
    
    if (Date.now() > pending.expiresAt) {
      getStateManager().clearPendingAction(platform, channelId);
      callback?.({ text: 'Quote expired. Please request a new quote.' });
      return;
    }
    
    if (pending.type === 'swap' && pending.quote) {
      const swapParams = pending.params;
      callback?.({ text: `Executing swap: ${swapParams.amount} ${swapParams.from} → ${swapParams.to}...` });
      
      const result = await getTradingService().executeSwap(user, {
        userId: user.id,
        fromToken: pending.quote.fromToken.address,
        toToken: pending.quote.toToken.address,
        amount: pending.quote.fromAmount,
        chainId: swapParams.chainId,
      });
      getStateManager().clearPendingAction(platform, channelId);
      
      if (result.success) {
        callback?.({ text: `Swap complete.\nTx: ${result.txHash}` });
      } else {
        callback?.({ text: `Swap failed: ${result.error}` });
      }
    } else if (pending.type === 'bridge' && pending.quote) {
      const bridgeParams = pending.params;
      callback?.({
        text: `Executing bridge: ${bridgeParams.amount} ${bridgeParams.token} from ${bridgeParams.fromChain} to ${bridgeParams.toChain}...`,
      });
      
      const result = await getTradingService().executeBridge(user, {
        userId: user.id,
        sourceChainId: bridgeParams.sourceChainId,
        destChainId: bridgeParams.destChainId,
        sourceToken: pending.quote.sourceToken.address,
        destToken: pending.quote.destToken.address,
        amount: pending.quote.inputAmount,
      });
      getStateManager().clearPendingAction(platform, channelId);
      
      if (result.success) {
        callback?.({ text: `Bridge initiated.\nIntent ID: ${result.intentId}\nSource Tx: ${result.sourceTxHash}` });
      } else {
        callback?.({ text: `Bridge failed: ${result.error}` });
      }
    }
  },
  
  examples: [
    [
      { name: 'user', content: { text: 'confirm' } },
      { name: 'agent', content: { text: 'Executing swap...' } },
    ],
  ],
};

export const cancelAction: Action = {
  name: 'OTTO_CANCEL',
  description: 'Cancel pending swap or bridge',
  similes: ['cancel', 'no', 'abort', 'nevermind', 'stop'],
  
  validate: async (_runtime: IAgentRuntime) => true,
  
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ) => {
    const platform = getPlatform(message);
    const channelId = getRoomId(message);
    getStateManager().clearPendingAction(platform, channelId);
    callback?.({ text: 'Cancelled.' });
  },
  
  examples: [
    [
      { name: 'user', content: { text: 'cancel' } },
      { name: 'agent', content: { text: 'Cancelled.' } },
    ],
  ],
};

export const helpAction: Action = {
  name: 'OTTO_HELP',
  description: 'Show Otto capabilities and commands',
  similes: ['help', 'what can you do', 'commands', 'how to use'],
  
  validate: async (_runtime: IAgentRuntime) => true,
  
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ) => {
    callback?.({
      text: `**Otto Trading Agent**

I can help you with:
• **Swap** - "swap 1 ETH to USDC"
• **Bridge** - "bridge 1 ETH from ethereum to base"
• **Balance** - "check my balance"
• **Price** - "price of ETH"
• **Connect** - "connect wallet"

After getting a quote, reply "confirm" or "cancel".`,
    });
  },
  
  examples: [
    [
      { name: 'user', content: { text: 'help' } },
      { name: 'agent', content: { text: 'Otto Trading Agent...' } },
    ],
  ],
};

// ============================================================================
// Providers
// ============================================================================

export const ottoWalletProvider: Provider = {
  name: 'OTTO_WALLET_PROVIDER',
  description: 'Provides Otto wallet context and user state',
  
  get: async (_runtime: IAgentRuntime, message: Memory, _state: State) => {
    const userId = getUserId(message);
    const platform = getPlatform(message);
    const user = getWalletService().getUserByPlatform(platform, userId);
    
    if (!user) {
      return { text: 'User not connected. Use "connect wallet" to link your wallet.' };
    }
    
    const channelId = getRoomId(message);
    const pending = getStateManager().getPendingAction(platform, channelId);
    
    return {
      text: `User wallet: ${user.primaryWallet}
Smart account: ${user.smartAccountAddress ?? 'Not deployed'}
Default chain: ${getChainName(user.settings.defaultChainId)}
Pending action: ${pending ? pending.type : 'None'}`,
    };
  },
};

// ============================================================================
// Plugin Export
// ============================================================================

export const ottoPlugin: Plugin = {
  name: 'otto',
  description: 'Otto Trading Agent - Swap, bridge, and manage tokens across chains',
  
  actions: [
    swapAction,
    bridgeAction,
    balanceAction,
    priceAction,
    connectAction,
    confirmAction,
    cancelAction,
    helpAction,
  ],
  
  providers: [ottoWalletProvider],
  
  evaluators: [],
  
  services: [],
};

export default ottoPlugin;


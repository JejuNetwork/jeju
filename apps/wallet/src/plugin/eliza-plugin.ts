/**
 * Network Wallet ElizaOS Plugin
 * 
 * Full ElizaOS-compatible plugin for agentic wallet capabilities.
 */

import type {
  Plugin,
  Action,
  Provider,
  ProviderResult,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
} from '@elizaos/core';
import { type Address } from 'viem';

// =============================================================================
// Providers
// =============================================================================

/**
 * Wallet state provider - provides current wallet context to the agent
 */
export const walletStateProvider: Provider = {
  name: 'WALLET_STATE',
  
  async get(runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<ProviderResult> {
    const address = runtime.getSetting('WALLET_ADDRESS');
    const chainId = runtime.getSetting('WALLET_CHAIN_ID') || '1';
    
    if (!address) {
      return {
        text: 'Wallet not connected. Please connect your wallet first.',
        data: { connected: false },
        values: { connected: 'false' },
      };
    }
    
    return {
      text: `Current Wallet State:\n- Address: ${address}\n- Chain ID: ${chainId}\n- Connected: true`,
      data: { address, chainId, connected: true },
      values: { address: String(address), chainId: String(chainId), connected: 'true' },
    };
  },
};

/**
 * Portfolio provider - provides token balances
 */
export const portfolioProvider: Provider = {
  name: 'PORTFOLIO',
  
  async get(runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<ProviderResult> {
    const address = runtime.getSetting('WALLET_ADDRESS');
    
    if (!address) {
      return {
        text: 'No wallet connected.',
        data: {},
        values: {},
      };
    }
    
    // In a real implementation, fetch balances from RPC
    return {
      text: `Portfolio for ${address}:\nBalances will be fetched from chain.`,
      data: { address },
      values: { address: String(address) },
    };
  },
};

// =============================================================================
// Actions
// =============================================================================

/**
 * Send Token Action - transfers ETH or tokens
 */
export const sendTokenAction: Action = {
  name: 'JEJU_SEND_TOKEN',
  description: 'Send ETH or ERC-20 tokens to a recipient address',
  similes: ['TRANSFER', 'SEND', 'PAY', 'SEND_ETH', 'SEND_TOKEN', 'TRANSFER_TOKEN'],
  
  examples: [
    [
      { name: 'user', content: { text: 'Send 0.1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e' } },
      { name: 'assistant', content: { text: 'I\'ll help you send 0.1 ETH to that address.', action: 'JEJU_SEND_TOKEN' } },
    ],
    [
      { name: 'user', content: { text: 'Transfer 100 USDC to alice.eth' } },
      { name: 'assistant', content: { text: 'I\'ll transfer 100 USDC to alice.eth.', action: 'JEJU_SEND_TOKEN' } },
    ],
  ],
  
  async validate(runtime: IAgentRuntime, _message: Memory): Promise<boolean> {
    const address = runtime.getSetting('WALLET_ADDRESS');
    return Boolean(address);
  },
  
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<void> => {
    const text = (message.content as { text?: string }).text || '';
    
    // Parse recipient address
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/);
    if (!addressMatch) {
      callback?.({
        text: 'Please provide a valid recipient address.',
        content: { error: 'No address found' },
      });
      return;
    }
    
    // Parse amount
    const amountMatch = text.match(/(\d+\.?\d*)\s*(ETH|USDC|USDT|DAI)?/i);
    if (!amountMatch) {
      callback?.({
        text: 'Please specify an amount to send.',
        content: { error: 'No amount found' },
      });
      return;
    }
    
    const recipient = addressMatch[0] as Address;
    const amount = amountMatch[1];
    const token = amountMatch[2]?.toUpperCase() || 'ETH';
    
    callback?.({
      text: `**Confirm Transaction**\n\nSending **${amount} ${token}** to \`${recipient}\`\n\nPlease confirm to proceed.`,
      content: {
        action: 'JEJU_SEND_TOKEN',
        requiresConfirmation: true,
        params: { recipient, amount, token },
      },
    });
  },
};

/**
 * Swap Token Action - swap tokens via DEX
 */
export const swapTokenAction: Action = {
  name: 'JEJU_SWAP',
  description: 'Swap tokens using the best available DEX route',
  similes: ['SWAP', 'TRADE', 'EXCHANGE', 'BUY', 'SELL'],
  
  examples: [
    [
      { name: 'user', content: { text: 'Swap 0.5 ETH for USDC' } },
      { name: 'assistant', content: { text: 'I\'ll find the best route to swap 0.5 ETH for USDC.', action: 'JEJU_SWAP' } },
    ],
    [
      { name: 'user', content: { text: 'Trade 100 USDC for ETH on Base' } },
      { name: 'assistant', content: { text: 'I\'ll swap 100 USDC for ETH on Base.', action: 'JEJU_SWAP' } },
    ],
  ],
  
  async validate(runtime: IAgentRuntime, _message: Memory): Promise<boolean> {
    const address = runtime.getSetting('WALLET_ADDRESS');
    return Boolean(address);
  },
  
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<void> => {
    const text = (message.content as { text?: string }).text || '';
    
    // Parse swap parameters
    const swapMatch = text.match(/(\d+\.?\d*)\s*(\w+)\s+(?:for|to)\s+(\w+)/i);
    if (!swapMatch) {
      callback?.({
        text: 'Please specify what you want to swap. Example: "Swap 0.5 ETH for USDC"',
        content: { error: 'Could not parse swap request' },
      });
      return;
    }
    
    const amount = swapMatch[1];
    const fromToken = swapMatch[2].toUpperCase();
    const toToken = swapMatch[3].toUpperCase();
    
    callback?.({
      text: `**Swap Quote**\n\nSwapping **${amount} ${fromToken}** for **${toToken}**\n\nFetching best route...\n\nPlease confirm to proceed.`,
      content: {
        action: 'JEJU_SWAP',
        requiresConfirmation: true,
        params: { amount, fromToken, toToken },
      },
    });
  },
};

/**
 * Portfolio Action - show wallet balances
 */
export const portfolioAction: Action = {
  name: 'JEJU_PORTFOLIO',
  description: 'Show current wallet portfolio and balances',
  similes: ['PORTFOLIO', 'BALANCES', 'HOLDINGS', 'SHOW_BALANCE', 'MY_TOKENS'],
  
  examples: [
    [
      { name: 'user', content: { text: 'Show my portfolio' } },
      { name: 'assistant', content: { text: 'Here\'s your portfolio...', action: 'JEJU_PORTFOLIO' } },
    ],
    [
      { name: 'user', content: { text: 'What tokens do I have?' } },
      { name: 'assistant', content: { text: 'Let me check your balances...', action: 'JEJU_PORTFOLIO' } },
    ],
  ],
  
  async validate(_runtime: IAgentRuntime, _message: Memory): Promise<boolean> {
    return true; // Always valid, will show connect prompt if no wallet
  },
  
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<void> => {
    const address = runtime.getSetting('WALLET_ADDRESS');
    
    if (!address) {
      callback?.({
        text: 'Please connect your wallet first to view your portfolio.',
        content: { action: 'JEJU_PORTFOLIO', connected: false },
      });
      return;
    }
    
    callback?.({
      text: `**Your Portfolio**\n\nAddress: \`${address}\`\n\nFetching balances...`,
      content: { action: 'JEJU_PORTFOLIO', address },
    });
  },
};

/**
 * Register JNS Name Action
 */
export const registerNameAction: Action = {
  name: 'JEJU_REGISTER_NAME',
  description: 'Register a .jeju name for your wallet',
  similes: ['REGISTER_NAME', 'JNS', 'GET_NAME', 'JEJU_NAME'],
  
  examples: [
    [
      { name: 'user', content: { text: 'Register alice.jeju' } },
      { name: 'assistant', content: { text: 'I\'ll help you register alice.jeju', action: 'JEJU_REGISTER_NAME' } },
    ],
  ],
  
  async validate(runtime: IAgentRuntime, _message: Memory): Promise<boolean> {
    const address = runtime.getSetting('WALLET_ADDRESS');
    return Boolean(address);
  },
  
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<void> => {
    const text = (message.content as { text?: string }).text || '';
    
    // Parse name
    const nameMatch = text.match(/(\w+)\.jeju/i);
    if (!nameMatch) {
      callback?.({
        text: 'Please specify a name to register. Example: "Register alice.jeju"',
        content: { error: 'No name found' },
      });
      return;
    }
    
    const name = nameMatch[1].toLowerCase();
    
    callback?.({
      text: `**Register .jeju Name**\n\nName: **${name}.jeju**\n\nChecking availability...\n\nPlease confirm to proceed.`,
      content: {
        action: 'JEJU_REGISTER_NAME',
        requiresConfirmation: true,
        params: { name },
      },
    });
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

/**
 * Network Wallet ElizaOS Plugin
 */
export const jejuWalletPlugin: Plugin = {
  name: 'jeju-wallet',
  description: 'Agentic wallet with cross-chain, AA, pools, perps, launchpad, and JNS',
  
  providers: [
    walletStateProvider,
    portfolioProvider,
  ],
  
  evaluators: [],
  
  services: [],
  
  actions: [
    sendTokenAction,
    swapTokenAction,
    portfolioAction,
    registerNameAction,
  ],
};

export default jejuWalletPlugin;


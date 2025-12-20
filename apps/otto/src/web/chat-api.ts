/**
 * Otto Chat API
 * REST API for web-based chat - uses ElizaOS runtime via plugin actions
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Address, Hex } from 'viem';
import { verifyMessage } from 'viem';
import type { ChatMessage, PlatformMessage, CommandResult } from '../types';
import { getWalletService } from '../services/wallet';
import { getStateManager } from '../services/state';
import { getConfig, getChainName, getChainId, DEFAULT_CHAIN_ID } from '../config';
import { getTradingService } from '../services/trading';

const walletService = getWalletService();
const stateManager = getStateManager();
const tradingService = getTradingService();

// Chat message history per session
const sessionMessages = new Map<string, ChatMessage[]>();

const PENDING_ACTION_TTL = 5 * 60 * 1000;

// ============================================================================
// Simple message processor (mirrors ElizaOS action logic)
// ============================================================================

async function processMessage(message: PlatformMessage): Promise<CommandResult> {
  const text = message.content.toLowerCase().trim();
  const platform = message.platform;
  const channelId = message.channelId;
  const userId = message.userId;
  
  // Get user if connected
  const user = walletService.getUserByPlatform(platform, userId);
  const config = getConfig();
  
  // Help
  if (text === 'help' || text === 'what can you do' || text.includes('commands')) {
    return {
      success: true,
      message: `**Otto Trading Agent**

I can help you with:
• **Swap** - "swap 1 ETH to USDC"
• **Bridge** - "bridge 1 ETH from ethereum to base"
• **Balance** - "check my balance"
• **Price** - "price of ETH"
• **Connect** - "connect wallet"

After getting a quote, reply "confirm" or "cancel".`,
    };
  }
  
  // Connect
  if (text === 'connect' || text.includes('connect wallet') || text.includes('link wallet')) {
    const connectUrl = walletService.getConnectUrl(platform, userId, userId);
    return {
      success: true,
      message: `Connect your wallet:\n\n${connectUrl}`,
    };
  }
  
  // Confirm
  if (text === 'confirm' || text === 'yes' || text === 'execute') {
    const pending = stateManager.getPendingAction(platform, channelId);
    if (!pending) {
      return { success: false, message: 'No pending action to confirm. Start a new swap or bridge.' };
    }
    
    if (!user) {
      return { success: false, message: 'Connect your wallet first.' };
    }
    
    if (Date.now() > pending.expiresAt) {
      stateManager.clearPendingAction(platform, channelId);
      return { success: false, message: 'Quote expired. Please request a new quote.' };
    }
    
    if (pending.type === 'swap' && pending.quote) {
      const result = await tradingService.executeSwap(user.id, pending.quote);
      stateManager.clearPendingAction(platform, channelId);
      
      if (result.success) {
        return { success: true, message: `Swap complete.\nTx: ${result.txHash}` };
      }
      return { success: false, message: `Swap failed: ${result.error}` };
    }
    
    if (pending.type === 'bridge' && pending.quote) {
      const result = await tradingService.executeBridge(user.id, pending.quote);
      stateManager.clearPendingAction(platform, channelId);
      
      if (result.success) {
        return { success: true, message: `Bridge initiated.\nIntent: ${result.intentId}\nTx: ${result.sourceTxHash}` };
      }
      return { success: false, message: `Bridge failed: ${result.error}` };
    }
    
    return { success: false, message: 'Unknown pending action type.' };
  }
  
  // Cancel
  if (text === 'cancel' || text === 'no' || text === 'abort') {
    stateManager.clearPendingAction(platform, channelId);
    return { success: true, message: 'Cancelled.' };
  }
  
  // Swap pattern: "swap 1 ETH to USDC"
  const swapMatch = message.content.match(/(\d+(?:\.\d+)?)\s*(\w+)\s+(?:to|for|into)\s+(\w+)/i);
  if (swapMatch && (text.includes('swap') || text.includes('exchange') || text.includes('trade'))) {
    if (!user) {
      const connectUrl = walletService.getConnectUrl(platform, userId, userId);
      return { success: true, message: `Connect your wallet first:\n\n${connectUrl}` };
    }
    
    const amount = swapMatch[1];
    const from = swapMatch[2].toUpperCase();
    const to = swapMatch[3].toUpperCase();
    const chainId = user.settings.defaultChainId;
    
    const fromToken = await tradingService.getTokenInfo(from, chainId);
    const toToken = await tradingService.getTokenInfo(to, chainId);
    
    if (!fromToken || !toToken) {
      return { success: false, message: `Could not find token info for ${from} or ${to}` };
    }
    
    const parsedAmount = tradingService.parseAmount(amount, fromToken.decimals);
    const quote = await tradingService.getSwapQuote({
      userId: user.id,
      fromToken: fromToken.address,
      toToken: toToken.address,
      amount: parsedAmount,
      chainId,
    });
    
    if (!quote) {
      return { success: false, message: 'Could not get swap quote. Try again.' };
    }
    
    const toAmount = tradingService.formatAmount(quote.toAmount, toToken.decimals);
    
    stateManager.setPendingAction(platform, channelId, {
      type: 'swap',
      quote,
      params: { amount, from, to, chainId },
      expiresAt: Date.now() + PENDING_ACTION_TTL,
    });
    
    return {
      success: true,
      message: `**Swap Quote**

${amount} ${from} → ${toAmount} ${to}
Price Impact: ${(quote.priceImpact * 100).toFixed(2)}%
Chain: ${getChainName(chainId)}

Reply "confirm" to execute or "cancel" to abort.`,
    };
  }
  
  // Bridge pattern: "bridge 1 ETH from ethereum to base"
  const bridgeMatch = message.content.match(/(\d+(?:\.\d+)?)\s*(\w+)\s+from\s+(\w+)\s+to\s+(\w+)/i);
  if (bridgeMatch && text.includes('bridge')) {
    if (!user) {
      const connectUrl = walletService.getConnectUrl(platform, userId, userId);
      return { success: true, message: `Connect your wallet first:\n\n${connectUrl}` };
    }
    
    const amount = bridgeMatch[1];
    const token = bridgeMatch[2].toUpperCase();
    const fromChain = bridgeMatch[3].toLowerCase();
    const toChain = bridgeMatch[4].toLowerCase();
    
    const sourceChainId = getChainId(fromChain);
    const destChainId = getChainId(toChain);
    
    if (!sourceChainId || !destChainId) {
      return { success: false, message: `Unknown chain: ${!sourceChainId ? fromChain : toChain}` };
    }
    
    const tokenInfo = await tradingService.getTokenInfo(token, sourceChainId);
    if (!tokenInfo) {
      return { success: false, message: `Could not find token ${token}` };
    }
    
    const parsedAmount = tradingService.parseAmount(amount, tokenInfo.decimals);
    const quote = await tradingService.getBridgeQuote({
      userId: user.id,
      sourceChainId,
      destChainId,
      sourceToken: tokenInfo.address,
      destToken: tokenInfo.address,
      amount: parsedAmount,
    });
    
    if (!quote) {
      return { success: false, message: 'Could not get bridge quote. Try again.' };
    }
    
    const outputAmount = tradingService.formatAmount(quote.outputAmount, tokenInfo.decimals);
    
    stateManager.setPendingAction(platform, channelId, {
      type: 'bridge',
      quote,
      params: { amount, token, fromChain, toChain, sourceChainId, destChainId },
      expiresAt: Date.now() + PENDING_ACTION_TTL,
    });
    
    return {
      success: true,
      message: `**Bridge Quote**

${amount} ${token} (${fromChain}) → ${outputAmount} ${token} (${toChain})
Fee: ${tradingService.formatUsd(quote.feeUsd ?? 0)}
Time: ~${Math.ceil(quote.estimatedTimeSeconds / 60)} min

Reply "confirm" to execute or "cancel" to abort.`,
    };
  }
  
  // Balance
  if (text.includes('balance') || text.includes('portfolio')) {
    if (!user) {
      const connectUrl = walletService.getConnectUrl(platform, userId, userId);
      return { success: true, message: `Connect your wallet first:\n\n${connectUrl}` };
    }
    
    const balances = await tradingService.getBalances(
      user.smartAccountAddress ?? user.primaryWallet,
      user.settings.defaultChainId
    );
    
    if (balances.length === 0) {
      return { success: true, message: `No tokens found on ${getChainName(user.settings.defaultChainId)}` };
    }
    
    const lines = balances.map(b => {
      const amt = tradingService.formatAmount(b.balance, b.token.decimals);
      const usd = b.balanceUsd ? ` ($${b.balanceUsd.toFixed(2)})` : '';
      return `• ${amt} ${b.token.symbol}${usd}`;
    });
    
    return { success: true, message: `**Balances on ${getChainName(user.settings.defaultChainId)}**\n\n${lines.join('\n')}` };
  }
  
  // Price
  if (text.includes('price')) {
    const tokenMatch = message.content.match(/price\s+(?:of\s+)?(\w+)/i) || message.content.match(/(\w+)\s+price/i);
    const token = tokenMatch?.[1]?.toUpperCase();
    
    if (!token || ['OF', 'THE', 'GET', 'CHECK'].includes(token)) {
      return { success: false, message: 'Which token? Example: "price of ETH"' };
    }
    
    const tokenInfo = await tradingService.getTokenInfo(token, DEFAULT_CHAIN_ID);
    if (!tokenInfo) {
      return { success: false, message: `Could not find token: ${token}` };
    }
    
    const price = tokenInfo.price?.toFixed(2) ?? 'N/A';
    const change = tokenInfo.priceChange24h ? `${tokenInfo.priceChange24h >= 0 ? '+' : ''}${tokenInfo.priceChange24h.toFixed(2)}%` : '';
    
    return { success: true, message: `**${tokenInfo.name} (${tokenInfo.symbol})**\nPrice: $${price} ${change}` };
  }
  
  // Greeting / default
  if (text === 'hi' || text === 'hello' || text === 'hey') {
    return {
      success: true,
      message: `Hey. I'm Otto, your crypto trading assistant. I can help you swap tokens, bridge between chains, check balances, and get prices. What would you like to do?`,
    };
  }
  
  // Default response
  return {
    success: true,
    message: `I can help you with:
• **Swap** - "swap 1 ETH to USDC"
• **Bridge** - "bridge 1 ETH from ethereum to base"
• **Balance** - "check my balance"
• **Price** - "price of ETH"
• **Connect** - "connect wallet"`,
  };
}

// ============================================================================
// API Routes
// ============================================================================

export const chatApi = new Hono();

chatApi.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Session-Id', 'X-Wallet-Address'],
}));

// Create session
chatApi.post('/session', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { walletAddress?: Address };

  const session = stateManager.createSession(body.walletAddress);

  const welcome: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: body.walletAddress
      ? `Connected. Ready to trade. Try: \`swap 1 ETH to USDC\``
      : `Otto here. Type \`help\` or \`connect\` to start.`,
    timestamp: Date.now(),
  };

  sessionMessages.set(session.sessionId, [welcome]);
  return c.json({ sessionId: session.sessionId, messages: [welcome] });
});

// Get session
chatApi.get('/session/:id', (c) => {
  const session = stateManager.getSession(c.req.param('id'));
  if (!session) return c.json({ error: 'Session not found' }, 404);
  
  const messages = sessionMessages.get(session.sessionId) ?? [];
  return c.json({ sessionId: session.sessionId, messages, userId: session.userId });
});

// Send message
chatApi.post('/chat', async (c) => {
  const body = await c.req.json() as { sessionId?: string; message: string; userId?: string };
  const walletAddress = c.req.header('X-Wallet-Address') as Address | undefined;

  let sessionId = body.sessionId ?? c.req.header('X-Session-Id');
  let session = sessionId ? stateManager.getSession(sessionId) : null;

  if (!session) {
    session = stateManager.createSession(walletAddress);
    sessionId = session.sessionId;
    sessionMessages.set(sessionId, []);
  }

  const messages = sessionMessages.get(sessionId) ?? [];

  // Add user message
  const userMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: body.message,
    timestamp: Date.now(),
  };
  messages.push(userMsg);
  stateManager.updateSession(sessionId, {});

  // Process message
  const platformMessage: PlatformMessage = {
    platform: 'web',
    messageId: userMsg.id,
    channelId: sessionId,
    userId: session.userId,
    content: body.message.trim(),
    timestamp: Date.now(),
    isCommand: true,
  };

  const result = await processMessage(platformMessage);

  // Create response
  const assistantMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: result.message,
    timestamp: Date.now(),
  };
  messages.push(assistantMsg);

  const requiresAuth = !walletAddress && result.message.toLowerCase().includes('connect');
  const config = getConfig();

  return c.json({
    sessionId,
    message: assistantMsg,
    requiresAuth,
    authUrl: requiresAuth ? `${config.baseUrl}/auth/connect` : undefined,
  });
});

// Auth message for signing
chatApi.get('/auth/message', (c) => {
  const address = c.req.query('address') as Address;
  if (!address) return c.json({ error: 'Address required' }, 400);

  const nonce = crypto.randomUUID();
  const message = `Sign in to Otto\nAddress: ${address}\nNonce: ${nonce}`;
  return c.json({ message, nonce });
});

// Verify signature
chatApi.post('/auth/verify', async (c) => {
  const body = await c.req.json() as {
    address: Address;
    message: string;
    signature: Hex;
    sessionId: string;
  };

  const valid = await verifyMessage({
    address: body.address,
    message: body.message,
    signature: body.signature,
  });

  if (!valid) return c.json({ error: 'Invalid signature' }, 401);

  const session = stateManager.getSession(body.sessionId);
  if (session) {
    stateManager.updateSession(body.sessionId, { userId: body.address, walletAddress: body.address });
  }

  const nonce = body.message.match(/Nonce: ([a-zA-Z0-9-]+)/)?.[1];
  if (nonce) {
    await walletService.verifyAndConnect('web', body.sessionId, body.address, body.address, body.signature, nonce);
  }

  return c.json({ success: true, address: body.address });
});

export default chatApi;

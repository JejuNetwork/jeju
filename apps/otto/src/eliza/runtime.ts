/**
 * Otto AI Runtime
 * Uses Jeju DWS for decentralized AI inference
 * Handles confirm flows and pending actions
 */

import type { Address } from 'viem';
import { getTradingService } from '../services/trading';
import { getWalletService } from '../services/wallet';
import { getStateManager, type PendingSwap, type PendingBridge } from '../services/state';
import { getChainId, DEFAULT_CHAIN_ID } from '../config';
import type { OttoUser, PlatformMessage, CommandResult, SwapQuote, BridgeQuote } from '../types';

const DWS_URL = process.env.DWS_SERVER_URL ?? 'http://localhost:4030';
const AI_MODEL = process.env.AI_MODEL ?? 'llama-3.1-8b-instant';
const PENDING_ACTION_TTL = 5 * 60 * 1000; // 5 minutes

const tradingService = getTradingService();
const walletService = getWalletService();
const stateManager = getStateManager();

// ============================================================================
// Action Handlers
// ============================================================================

async function handleSwap(
  params: { amount: string; from: string; to: string; chain?: string },
  user: OttoUser,
  platform: string,
  channelId: string
): Promise<CommandResult> {
  const chainId = params.chain ? getChainId(params.chain) ?? user.settings.defaultChainId : user.settings.defaultChainId;
  const fromToken = await tradingService.getTokenInfo(params.from, chainId);
  const toToken = await tradingService.getTokenInfo(params.to, chainId);

  if (!fromToken || !toToken) {
    return { success: false, message: `Could not find token info for ${params.from} or ${params.to}` };
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
    return { success: false, message: 'Could not get swap quote. Try again.' };
  }

  // Store pending action
  const pendingSwap: PendingSwap = {
    type: 'swap',
    quote,
    params: { amount: params.amount, from: params.from, to: params.to, chainId },
    expiresAt: Date.now() + PENDING_ACTION_TTL,
  };
  stateManager.setPendingAction(platform as 'web', channelId, pendingSwap);

  const toAmount = tradingService.formatAmount(quote.toAmount, toToken.decimals);
  return {
    success: true,
    message: `Swap ${params.amount} ${params.from} → ${toAmount} ${params.to}\nPrice impact: ${quote.priceImpact.toFixed(2)}%\n\nSay "confirm" to execute or "cancel" to abort.`,
    data: { quoteId: quote.quoteId },
  };
}

async function handleBridge(
  params: { amount: string; token: string; fromChain: string; toChain: string },
  user: OttoUser,
  platform: string,
  channelId: string
): Promise<CommandResult> {
  const sourceChainId = getChainId(params.fromChain);
  const destChainId = getChainId(params.toChain);

  if (!sourceChainId || !destChainId) {
    return { success: false, message: `Unknown chain: ${!sourceChainId ? params.fromChain : params.toChain}` };
  }

  const tokenInfo = await tradingService.getTokenInfo(params.token, sourceChainId);
  if (!tokenInfo) {
    return { success: false, message: `Could not find token ${params.token}` };
  }

  const amount = tradingService.parseAmount(params.amount, tokenInfo.decimals);

  // Get bridge quote
  const quote = await tradingService.getBridgeQuote({
    userId: user.id,
    sourceChainId,
    destChainId,
    sourceToken: tokenInfo.address,
    destToken: tokenInfo.address, // Same token on dest chain
    amount,
  });

  // Store pending action
  const pendingBridge: PendingBridge = {
    type: 'bridge',
    quote: quote ?? undefined,
    params: {
      amount: params.amount,
      token: params.token,
      fromChain: params.fromChain,
      toChain: params.toChain,
      sourceChainId,
      destChainId,
    },
    expiresAt: Date.now() + PENDING_ACTION_TTL,
  };
  stateManager.setPendingAction(platform as 'web', channelId, pendingBridge);

  const feeInfo = quote ? `\nFee: ${tradingService.formatAmount(quote.fee, tokenInfo.decimals)} ${params.token}` : '';
  const timeInfo = quote ? `\nEstimated time: ~${Math.ceil(quote.estimatedTimeSeconds / 60)} min` : '';

  return {
    success: true,
    message: `Bridge ${params.amount} ${params.token} from ${params.fromChain} to ${params.toChain}${feeInfo}${timeInfo}\n\nSay "confirm" to execute or "cancel" to abort.`,
  };
}

async function handleConfirm(
  user: OttoUser,
  platform: string,
  channelId: string
): Promise<CommandResult> {
  const pending = stateManager.getPendingAction(platform as 'web', channelId);

  if (!pending) {
    return { success: false, message: 'Nothing to confirm. Start a swap or bridge first.' };
  }

  stateManager.clearPendingAction(platform as 'web', channelId);

  if (pending.type === 'swap') {
    const result = await tradingService.executeSwap(user, {
      userId: user.id,
      fromToken: pending.quote.fromToken.address,
      toToken: pending.quote.toToken.address,
      amount: pending.quote.fromAmount,
      chainId: pending.params.chainId,
    });

    if (!result.success) {
      return { success: false, message: `Swap failed: ${result.error}` };
    }

    const toAmount = tradingService.formatAmount(result.toAmount, pending.quote.toToken.decimals);
    return {
      success: true,
      message: `Swap executed.\n${pending.params.amount} ${pending.params.from} → ${toAmount} ${pending.params.to}\n\nTx: ${result.txHash}`,
    };
  }

  if (pending.type === 'bridge') {
    const tokenInfo = await tradingService.getTokenInfo(pending.params.token, pending.params.sourceChainId);
    if (!tokenInfo) {
      return { success: false, message: 'Token info unavailable' };
    }

    const result = await tradingService.executeBridge(user, {
      userId: user.id,
      sourceChainId: pending.params.sourceChainId,
      destChainId: pending.params.destChainId,
      sourceToken: tokenInfo.address,
      destToken: tokenInfo.address,
      amount: tradingService.parseAmount(pending.params.amount, tokenInfo.decimals),
    });

    if (!result.success) {
      return { success: false, message: `Bridge failed: ${result.error}` };
    }

    return {
      success: true,
      message: `Bridge initiated.\n${pending.params.amount} ${pending.params.token}: ${pending.params.fromChain} → ${pending.params.toChain}\n\nIntent ID: ${result.intentId}\nSource tx: ${result.sourceTxHash}`,
    };
  }

  return { success: false, message: 'Unknown pending action type' };
}

async function handleCancel(platform: string, channelId: string): Promise<CommandResult> {
  const pending = stateManager.getPendingAction(platform as 'web', channelId);

  if (!pending) {
    return { success: false, message: 'Nothing to cancel.' };
  }

  stateManager.clearPendingAction(platform as 'web', channelId);
  return { success: true, message: 'Cancelled.' };
}

async function handleBalance(params: { token?: string }, user: OttoUser): Promise<CommandResult> {
  const balances = await tradingService.getBalances(user.primaryWallet);

  if (params.token) {
    const b = balances.find(b => b.token.symbol.toLowerCase() === params.token?.toLowerCase());
    if (!b) return { success: true, message: `No ${params.token} found in wallet` };
    return {
      success: true,
      message: `${b.token.symbol}: ${tradingService.formatAmount(b.balance, b.token.decimals)}${b.balanceUsd ? ` ($${b.balanceUsd.toFixed(2)})` : ''}`,
    };
  }

  const totalUsd = balances.reduce((sum, b) => sum + (b.balanceUsd ?? 0), 0);
  const lines = balances.slice(0, 5).map(b =>
    `${b.token.symbol}: ${tradingService.formatAmount(b.balance, b.token.decimals)}`
  );
  return { success: true, message: `Portfolio: $${totalUsd.toFixed(2)}\n\n${lines.join('\n')}` };
}

async function handlePrice(params: { token: string }): Promise<CommandResult> {
  const token = await tradingService.getTokenInfo(params.token, DEFAULT_CHAIN_ID);
  if (!token?.price) {
    return { success: false, message: `Price not found for ${params.token}` };
  }
  const change = token.priceChange24h ? ` (${token.priceChange24h >= 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}%)` : '';
  return { success: true, message: `${token.symbol}: $${token.price.toFixed(2)}${change}` };
}

async function handleConnect(userId: string): Promise<CommandResult> {
  const url = await walletService.generateConnectUrl('web', userId, userId);
  return { success: true, message: `Connect your wallet:\n\n${url}`, data: { url } };
}

async function handleLimitOrder(
  params: { amount: string; from: string; to: string; price: string },
  user: OttoUser
): Promise<CommandResult> {
  const chainId = user.settings.defaultChainId;
  const fromToken = await tradingService.getTokenInfo(params.from, chainId);
  const toToken = await tradingService.getTokenInfo(params.to, chainId);

  if (!fromToken || !toToken) {
    return { success: false, message: `Could not find token info for ${params.from} or ${params.to}` };
  }

  const order = await tradingService.createLimitOrder(user, {
    userId: user.id,
    fromToken: fromToken.address,
    toToken: toToken.address,
    fromAmount: tradingService.parseAmount(params.amount, fromToken.decimals),
    targetPrice: params.price,
    chainId,
    expiresIn: 24 * 60 * 60 * 1000, // 24 hours
  });

  stateManager.addLimitOrder(order);

  return {
    success: true,
    message: `Limit order created.\nSell ${params.amount} ${params.from} when price reaches $${params.price}\n\nOrder ID: ${order.orderId}`,
  };
}

async function handleOrders(user: OttoUser): Promise<CommandResult> {
  const orders = stateManager.getUserLimitOrders(user.id);

  if (orders.length === 0) {
    return { success: true, message: 'No open limit orders.' };
  }

  const lines = orders.map(o =>
    `${o.orderId.slice(0, 8)}: ${tradingService.formatAmount(o.fromAmount, o.fromToken.decimals)} ${o.fromToken.symbol} @ $${o.targetPrice}`
  );

  return { success: true, message: `Open orders:\n\n${lines.join('\n')}` };
}

async function handleCancelOrder(params: { orderId: string }, user: OttoUser): Promise<CommandResult> {
  const result = await tradingService.cancelLimitOrder(params.orderId, user.id);

  if (!result) {
    stateManager.updateLimitOrder(params.orderId, { status: 'cancelled' });
  }

  return result
    ? { success: true, message: `Order ${params.orderId} cancelled.` }
    : { success: false, message: 'Order not found or already executed.' };
}

// ============================================================================
// AI Integration
// ============================================================================

const SYSTEM_PROMPT = `You are Otto, a crypto trading assistant on Jeju Network. Be helpful, friendly, and concise.

You can execute these trading actions by returning ONLY a JSON object (no other text):
- Swap tokens: {"action":"swap","amount":"1","from":"ETH","to":"USDC"}
- Bridge cross-chain: {"action":"bridge","amount":"1","token":"ETH","fromChain":"ethereum","toChain":"base"}
- Check balance: {"action":"balance"} or {"action":"balance","token":"ETH"}
- Get price: {"action":"price","token":"ETH"}
- Connect wallet: {"action":"connect"}
- Confirm pending action: {"action":"confirm"}
- Cancel pending action: {"action":"cancel"}
- Create limit order: {"action":"limit","amount":"1","from":"ETH","to":"USDC","price":"3000"}
- View orders: {"action":"orders"}
- Cancel order: {"action":"cancelOrder","orderId":"order_123"}

Chains: jeju, ethereum, base, optimism, arbitrum

When to use actions:
- User wants to swap/trade/buy/sell → swap action
- User wants to bridge/transfer between chains → bridge action
- User asks about balance/portfolio/holdings → balance action
- User asks token price → price action
- User needs wallet connected → connect action
- User says "yes", "confirm", "do it", "go", "execute" → confirm action
- User says "no", "cancel", "nevermind", "stop" → cancel action
- User wants to set a limit order → limit action
- User wants to see their orders → orders action

For everything else (greetings, questions, help), just respond with friendly text. Don't use JSON for conversations.

Examples:
- "hi" → "Hey! I'm Otto, your crypto trading assistant. I can help you swap tokens, bridge between chains, check balances, and get prices. What would you like to do?"
- "swap 1 eth to usdc" → {"action":"swap","amount":"1","from":"ETH","to":"USDC"}
- "yes" → {"action":"confirm"}
- "cancel" → {"action":"cancel"}`;

interface AIResponse {
  action?: string;
  [key: string]: string | undefined;
}

async function callAI(userMessage: string, conversationHistory: string[] = []): Promise<string> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory.map((msg, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: msg,
    })),
    { role: 'user', content: userMessage },
  ];

  const response = await fetch(`${DWS_URL}/compute/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI inference failed: ${error}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

function parseAIResponse(content: string): AIResponse | null {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]) as AIResponse;
  } catch {
    return null;
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function processMessage(msg: PlatformMessage): Promise<CommandResult> {
  const text = msg.content.trim();

  if (!text) {
    return { success: false, message: 'Send me a message.' };
  }

  const user = walletService.getUserByPlatform(msg.platform, msg.userId);
  const history = stateManager.getHistory(msg.platform, msg.channelId).flatMap(h => h.content);

  // Store user message in history
  stateManager.addToHistory(msg.platform, msg.channelId, 'user', text);

  // Call AI
  let aiContent: string;
  try {
    aiContent = await callAI(text, history);
  } catch (error) {
    console.error('[Otto] AI error:', error);
    return {
      success: false,
      message: 'AI service unavailable. Make sure DWS is running with GROQ_API_KEY set.',
    };
  }

  // Check if AI returned an action
  const parsed = parseAIResponse(aiContent);

  if (parsed?.action) {
    const action = parsed.action;

    // Handle confirm/cancel without wallet
    if (action === 'confirm') {
      if (!user) {
        const url = await walletService.generateConnectUrl('web', msg.userId, msg.userId);
        return { success: false, message: `Connect your wallet first:\n\n${url}`, data: { url } };
      }
      const result = await handleConfirm(user, msg.platform, msg.channelId);
      stateManager.addToHistory(msg.platform, msg.channelId, 'assistant', result.message);
      return result;
    }

    if (action === 'cancel') {
      const result = await handleCancel(msg.platform, msg.channelId);
      stateManager.addToHistory(msg.platform, msg.channelId, 'assistant', result.message);
      return result;
    }

    // Actions that don't require wallet
    if (action === 'connect') {
      const result = await handleConnect(msg.userId);
      stateManager.addToHistory(msg.platform, msg.channelId, 'assistant', result.message);
      return result;
    }

    if (action === 'price' && parsed.token) {
      const result = await handlePrice({ token: parsed.token });
      stateManager.addToHistory(msg.platform, msg.channelId, 'assistant', result.message);
      return result;
    }

    // Actions that require wallet
    if (!user) {
      const url = await walletService.generateConnectUrl('web', msg.userId, msg.userId);
      return { success: false, message: `Connect your wallet first:\n\n${url}`, data: { url } };
    }

    let result: CommandResult;

    switch (action) {
      case 'swap':
        if (!parsed.amount || !parsed.from || !parsed.to) {
          result = { success: false, message: 'Please specify amount, from token, and to token.' };
        } else {
          result = await handleSwap(
            { amount: parsed.amount, from: parsed.from, to: parsed.to, chain: parsed.chain },
            user,
            msg.platform,
            msg.channelId
          );
        }
        break;

      case 'bridge':
        if (!parsed.amount || !parsed.token || !parsed.fromChain || !parsed.toChain) {
          result = { success: false, message: 'Please specify amount, token, from chain, and to chain.' };
        } else {
          result = await handleBridge(
            { amount: parsed.amount, token: parsed.token, fromChain: parsed.fromChain, toChain: parsed.toChain },
            user,
            msg.platform,
            msg.channelId
          );
        }
        break;

      case 'balance':
        result = await handleBalance({ token: parsed.token }, user);
        break;

      case 'limit':
        if (!parsed.amount || !parsed.from || !parsed.to || !parsed.price) {
          result = { success: false, message: 'Please specify amount, from token, to token, and target price.' };
        } else {
          result = await handleLimitOrder(
            { amount: parsed.amount, from: parsed.from, to: parsed.to, price: parsed.price },
            user
          );
        }
        break;

      case 'orders':
        result = await handleOrders(user);
        break;

      case 'cancelOrder':
        if (!parsed.orderId) {
          result = { success: false, message: 'Please specify order ID.' };
        } else {
          result = await handleCancelOrder({ orderId: parsed.orderId }, user);
        }
        break;

      default:
        result = { success: true, message: aiContent.replace(/\{[\s\S]*\}/, '').trim() || "I'm not sure how to help with that." };
    }

    stateManager.addToHistory(msg.platform, msg.channelId, 'assistant', result.message);
    return result;
  }

  // AI returned natural language response
  stateManager.addToHistory(msg.platform, msg.channelId, 'assistant', aiContent);
  return { success: true, message: aiContent };
}

// ============================================================================
// Limit Order Monitor
// ============================================================================

export function startLimitOrderMonitor(): void {
  stateManager.startLimitOrderMonitor(
    async (token: string, chainId: number) => {
      return tradingService.getTokenPrice(token, chainId);
    },
    async (order) => {
      const user = stateManager.getUser(order.userId);
      if (!user) return { success: false };

      const result = await tradingService.executeSwap(user, {
        userId: user.id,
        fromToken: order.fromToken.address,
        toToken: order.toToken.address,
        amount: order.fromAmount,
        chainId: order.chainId,
      });

      return { success: result.success, txHash: result.txHash };
    }
  );
}

export function stopLimitOrderMonitor(): void {
  stateManager.stopLimitOrderMonitor();
}

// Export for tests
export function selectAction(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes('swap') || lower.includes('trade')) return { name: 'SWAP' };
  if (lower.includes('bridge')) return { name: 'BRIDGE' };
  if (lower.includes('balance')) return { name: 'BALANCE' };
  if (lower.includes('price')) return { name: 'PRICE' };
  if (lower.includes('connect')) return { name: 'CONNECT' };
  if (lower.includes('help')) return { name: 'HELP' };
  if (lower === 'confirm' || lower === 'yes') return { name: 'CONFIRM' };
  if (lower === 'cancel' || lower === 'no') return { name: 'CANCEL' };
  return null;
}

export function extractEntities(text: string) {
  const entities: Record<string, string> = {};
  const swapMatch = text.match(/(\d+(?:\.\d+)?)\s*(\w+)\s+(?:to|for)\s+(\w+)/i);
  if (swapMatch) {
    entities.amount = swapMatch[1];
    entities.fromToken = swapMatch[2].toUpperCase();
    entities.toToken = swapMatch[3].toUpperCase();
  }
  const bridgeMatch = text.match(/(\d+(?:\.\d+)?)\s*(\w+)\s+from\s+(\w+)\s+to\s+(\w+)/i);
  if (bridgeMatch) {
    entities.amount = bridgeMatch[1];
    entities.token = bridgeMatch[2].toUpperCase();
    entities.fromChain = bridgeMatch[3].toLowerCase();
    entities.toChain = bridgeMatch[4].toLowerCase();
  }
  return entities;
}

export const actions = ['swap', 'bridge', 'balance', 'price', 'connect', 'confirm', 'cancel', 'limit', 'orders', 'cancelOrder'];

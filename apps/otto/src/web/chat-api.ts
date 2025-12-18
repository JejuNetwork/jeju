/**
 * Otto Chat API
 * REST API for web-based chat - uses ElizaOS-style runtime
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Address, Hex } from 'viem';
import { verifyMessage } from 'viem';
import type { ChatMessage, PlatformMessage } from '../types';
import { processMessage } from '../eliza/runtime';
import { getWalletService } from '../services/wallet';
import { getStateManager } from '../services/state';
import { getConfig } from '../config';

const walletService = getWalletService();
const stateManager = getStateManager();

// Chat message history per session (ephemeral, not persisted)
const sessionMessages = new Map<string, ChatMessage[]>();

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

// Send message - USES ELIZA RUNTIME
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

  // Process through ElizaOS-style runtime
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

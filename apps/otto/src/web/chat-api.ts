/**
 * Otto Chat API
 * REST API for web-based chat - uses ElizaOS-style runtime
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Address } from 'viem';
import { z } from 'zod';
import { isAddress } from 'viem';
import type { PlatformMessage } from '../types';
import { processMessage } from '../eliza/runtime';
import { getConfig } from '../config';
import {
  expectValid,
  ChatRequestSchema,
  ChatResponseSchema,
  ChatMessageSchema,
  AuthMessageResponseSchema,
  AuthVerifyRequestSchema,
} from '../schemas';
import {
  createChatSession,
  getSessionMessages,
  addSessionMessage,
  getOrCreateSession,
} from '../hooks/useSession';
import {
  generateAuthMessage,
  verifyAndConnectWallet,
} from '../hooks/useAuth';
import { validateAddress, validateSessionId } from '../utils/validation';
import { getStateManager } from '../services/state';
import { createSuccessResponse } from '../utils/response';

export const chatApi = new Hono();

chatApi.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Session-Id', 'X-Wallet-Address'],
}));

// Create session
chatApi.post('/session', async (c) => {
  const rawBody = await c.req.json().catch(() => ({}));
  const SessionCreateSchema = z.object({
    walletAddress: z.string().refine((val) => !val || isAddress(val), { message: 'Invalid address' }).optional(),
  });
  const body = expectValid(SessionCreateSchema, rawBody, 'create session');

  const walletAddress = body.walletAddress ? validateAddress(body.walletAddress) as Address : undefined;
  const { sessionId, messages } = createChatSession(walletAddress);
  
  return c.json({ sessionId, messages });
});

// Get session
chatApi.get('/session/:id', (c) => {
  const sessionIdParam = c.req.param('id');
  const sessionId = validateSessionId(sessionIdParam);
  
  const stateManager = getStateManager();
  const session = stateManager.getSession(sessionId);
  
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  
  const messages = getSessionMessages(sessionId);
  
  return c.json({ sessionId: session.sessionId, messages, userId: session.userId });
});

// Send message - USES ELIZA RUNTIME
chatApi.post('/chat', async (c) => {
  const rawBody = await c.req.json();
  const body = expectValid(ChatRequestSchema, rawBody, 'chat request');
  
  const walletAddressHeader = c.req.header('X-Wallet-Address');
  const walletAddress = walletAddressHeader 
    ? validateAddress(walletAddressHeader) as Address
    : undefined;

  const { sessionId, session } = getOrCreateSession(
    body.sessionId ?? c.req.header('X-Session-Id'),
    walletAddress
  );

  // Add user message
  const userMsg = {
    id: crypto.randomUUID(),
    role: 'user' as const,
    content: body.message,
    timestamp: Date.now(),
  };
  const validatedUserMsg = expectValid(ChatMessageSchema, userMsg, 'user message');
  addSessionMessage(sessionId, validatedUserMsg);

  const stateManager = getStateManager();
  stateManager.updateSession(sessionId, {});

  // Process through ElizaOS-style runtime
  const platformMessage: PlatformMessage = {
    platform: 'web',
    messageId: validatedUserMsg.id,
    channelId: sessionId,
    userId: session.userId,
    content: body.message.trim(),
    timestamp: Date.now(),
    isCommand: true,
  };

  const result = await processMessage(platformMessage);

  // Create response
  const assistantMsg = {
    id: crypto.randomUUID(),
    role: 'assistant' as const,
    content: result.message,
    timestamp: Date.now(),
  };
  const validatedAssistantMsg = expectValid(ChatMessageSchema, assistantMsg, 'assistant message');
  addSessionMessage(sessionId, validatedAssistantMsg);

  const requiresAuth = !walletAddress && result.message.toLowerCase().includes('connect');
  const config = getConfig();

  const response = {
    sessionId,
    message: validatedAssistantMsg,
    requiresAuth,
    authUrl: requiresAuth ? `${config.baseUrl}/auth/connect` : undefined,
  };
  
  return c.json(expectValid(ChatResponseSchema, response, 'chat response'));
});

// Auth message for signing
chatApi.get('/auth/message', (c) => {
  const addressParam = c.req.query('address');
  if (!addressParam) {
    return c.json({ error: 'Address required' }, 400);
  }
  
  const address = validateAddress(addressParam) as Address;
  const { message, nonce } = generateAuthMessage(address);
  const response = { message, nonce };
  
  return c.json(expectValid(AuthMessageResponseSchema, response, 'auth message response'));
});

// Verify signature
chatApi.post('/auth/verify', async (c) => {
  const rawBody = await c.req.json();
  const body = expectValid(AuthVerifyRequestSchema, rawBody, 'auth verify request');

  const result = await verifyAndConnectWallet(
    body.address,
    body.message,
    body.signature,
    body.sessionId,
    'web'
  );

  if (!result.success) {
    return c.json({ error: result.error ?? 'Verification failed' }, 401);
  }

  return c.json(createSuccessResponse(body.address));
});

export default chatApi;

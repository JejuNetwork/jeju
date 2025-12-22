/**
 * Direct Cast REST API
 * 
 * HTTP API for DC operations.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { DirectCastClient } from './client';
import type { DirectCastEmbed } from './types';

// ============ Schemas ============

const SendDCSchema = z.object({
  recipientFid: z.number().int().positive(),
  text: z.string().min(1).max(2000),
  embeds: z.array(z.object({
    type: z.enum(['url', 'cast', 'image']),
    url: z.string().url().optional(),
    castId: z.object({
      fid: z.number().int().positive(),
      hash: z.string().regex(/^0x[a-fA-F0-9]+$/),
    }).optional(),
    alt: z.string().optional(),
  })).max(4).optional(),
  replyTo: z.string().optional(),
});

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().optional(),
  after: z.string().optional(),
});

// ============ API Factory ============

/**
 * Create Direct Cast REST API
 */
export function createDCApi(getClient: () => DirectCastClient | null): Hono {
  const app = new Hono();
  
  // ============ Middleware ============
  
  // Require authenticated client
  app.use('*', async (c, next) => {
    const client = getClient();
    if (!client) {
      return c.json({ error: 'Not authenticated' }, 401);
    }
    c.set('dcClient' as never, client as never);
    await next();
  });
  
  // ============ Conversations ============
  
  // List conversations
  app.get('/conversations', async (c) => {
    const client = c.get('dcClient' as never) as DirectCastClient;
    const conversations = await client.getConversations();
    
    return c.json({
      conversations,
      count: conversations.length,
    });
  });
  
  // Get conversation by FID
  app.get('/conversations/:fid', async (c) => {
    const client = c.get('dcClient' as never) as DirectCastClient;
    const fid = parseInt(c.req.param('fid'));
    
    if (isNaN(fid) || fid <= 0) {
      return c.json({ error: 'Invalid FID' }, 400);
    }
    
    const conversation = await client.getConversation(fid);
    return c.json({ conversation });
  });
  
  // Archive conversation
  app.post('/conversations/:fid/archive', async (c) => {
    const client = c.get('dcClient' as never) as DirectCastClient;
    const fid = parseInt(c.req.param('fid'));
    
    await client.archiveConversation(fid);
    return c.json({ success: true });
  });
  
  // Mute/unmute conversation
  app.post('/conversations/:fid/mute', async (c) => {
    const client = c.get('dcClient' as never) as DirectCastClient;
    const fid = parseInt(c.req.param('fid'));
    const { muted } = await c.req.json() as { muted?: boolean };
    
    await client.muteConversation(fid, muted ?? true);
    return c.json({ success: true });
  });
  
  // ============ Messages ============
  
  // Get messages in conversation
  app.get('/conversations/:fid/messages', async (c) => {
    const client = c.get('dcClient' as never) as DirectCastClient;
    const fid = parseInt(c.req.param('fid'));
    
    if (isNaN(fid) || fid <= 0) {
      return c.json({ error: 'Invalid FID' }, 400);
    }
    
    const parsed = PaginationSchema.safeParse({
      limit: c.req.query('limit'),
      before: c.req.query('before'),
      after: c.req.query('after'),
    });
    
    if (!parsed.success) {
      return c.json({ error: 'Invalid pagination params', details: parsed.error.issues }, 400);
    }
    
    const messages = await client.getMessages(fid, parsed.data);
    
    return c.json({
      messages,
      count: messages.length,
      hasMore: messages.length === parsed.data.limit,
    });
  });
  
  // Send message
  app.post('/conversations/:fid/messages', async (c) => {
    const client = c.get('dcClient' as never) as DirectCastClient;
    const fid = parseInt(c.req.param('fid'));
    
    if (isNaN(fid) || fid <= 0) {
      return c.json({ error: 'Invalid FID' }, 400);
    }
    
    const body = await c.req.json();
    const parsed = SendDCSchema.safeParse({ ...body, recipientFid: fid });
    
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }
    
    const message = await client.send({
      recipientFid: parsed.data.recipientFid,
      text: parsed.data.text,
      embeds: parsed.data.embeds as DirectCastEmbed[] | undefined,
      replyTo: parsed.data.replyTo,
    });
    
    return c.json({ message }, 201);
  });
  
  // Mark as read
  app.post('/conversations/:fid/read', async (c) => {
    const client = c.get('dcClient' as never) as DirectCastClient;
    const fid = parseInt(c.req.param('fid'));
    
    await client.markAsRead(fid);
    return c.json({ success: true });
  });
  
  // ============ Status ============
  
  // Get client state
  app.get('/status', async (c) => {
    const client = c.get('dcClient' as never) as DirectCastClient;
    const state = client.getState();
    const publicKey = client.getEncryptionPublicKey();
    
    return c.json({
      ...state,
      encryptionPublicKey: publicKey,
    });
  });
  
  // Publish encryption key
  app.post('/publish-key', async (c) => {
    const client = c.get('dcClient' as never) as DirectCastClient;
    await client.publishEncryptionKey();
    
    return c.json({ success: true });
  });
  
  return app;
}

// ============ Standalone Server ============

/**
 * Create standalone DC server
 */
export function createDCServer(client: DirectCastClient, port: number = 3300) {
  const app = createDCApi(() => client);
  
  // Health check
  app.get('/health', (c) => c.json({ status: 'ok' }));
  
  console.log(`[DC API] Starting server on port ${port}`);
  
  return Bun.serve({
    port,
    fetch: app.fetch,
  });
}


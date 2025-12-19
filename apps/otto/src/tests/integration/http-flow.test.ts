/**
 * HTTP Flow Integration Tests
 * Tests the ACTUAL server endpoints with real HTTP requests
 * Uses mocked AI responses since DWS isn't running in tests
 */

import { describe, test, expect, beforeAll, mock } from 'bun:test';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { chatApi } from '../../web/chat-api';
import { frameApi } from '../../web/frame';
import { miniappApi } from '../../web/miniapp';

// Mock fetch to intercept DWS calls
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();
  
  // Mock DWS AI responses
  if (url.includes('/compute/chat/completions')) {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const userMessage = body.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '';
    const lower = userMessage.toLowerCase();
    
    let response = "Hey! I'm Otto, your crypto trading assistant. I can help you swap tokens, bridge between chains, check balances, and get prices. What would you like to do?";
    
    if (lower.includes('help') || lower.includes('hi') || lower.includes('hello')) {
      response = "Hey! I'm Otto, your crypto trading assistant. I can help you swap tokens, bridge between chains, check balances, and get prices. What would you like to do?";
    } else if (lower.includes('connect')) {
      response = '{"action":"connect"}';
    } else if (lower.includes('swap')) {
      response = '{"action":"swap","amount":"1","from":"ETH","to":"USDC"}';
    } else if (lower.includes('price')) {
      response = '{"action":"price","token":"ETH"}';
    }
    
    return new Response(JSON.stringify({
      choices: [{ message: { content: response } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  
  // Pass through other requests
  return originalFetch(input, init);
};

// Create test app with same routes as server
const createApp = () => {
  const app = new Hono();
  app.use('/*', cors({ origin: '*' }));
  
  app.get('/health', (c) => c.json({ status: 'healthy' }));
  app.route('/api/chat', chatApi);
  app.route('/frame', frameApi);
  app.route('/miniapp', miniappApi);
  
  return app;
};

describe('HTTP Flow Tests', () => {
  let app: Hono;
  
  beforeAll(() => {
    app = createApp();
  });
  
  describe('Chat Flow', () => {
    test('full conversation: create session → send help → get response', async () => {
      // 1. Create session
      const sessionRes = await app.request('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(sessionRes.status).toBe(200);
      
      const { sessionId, messages } = await sessionRes.json();
      expect(sessionId).toBeDefined();
      expect(messages.length).toBe(1); // Welcome message
      
      // 2. Send "help" command
      const chatRes = await app.request('/api/chat/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({ message: 'help' }),
      });
      expect(chatRes.status).toBe(200);
      
      const chatData = await chatRes.json();
      expect(chatData.sessionId).toBe(sessionId);
      expect(chatData.message.role).toBe('assistant');
      expect(chatData.message.content.toLowerCase()).toContain('swap');
    });
    
    test('connect command returns wallet connection info', async () => {
      const sessionRes = await app.request('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const { sessionId } = await sessionRes.json();
      
      const chatRes = await app.request('/api/chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
        body: JSON.stringify({ message: 'connect' }),
      });
      
      const data = await chatRes.json();
      expect(data.message.content.toLowerCase()).toContain('wallet');
    });
    
    test('swap without wallet prompts connection', async () => {
      const sessionRes = await app.request('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const { sessionId } = await sessionRes.json();
      
      const chatRes = await app.request('/api/chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
        body: JSON.stringify({ message: 'swap 1 ETH to USDC' }),
      });
      
      const data = await chatRes.json();
      expect(data.message.content.toLowerCase()).toContain('connect');
      expect(data.requiresAuth).toBe(true);
    });
    
    test('greeting returns helpful message', async () => {
      const sessionRes = await app.request('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const { sessionId } = await sessionRes.json();
      
      const chatRes = await app.request('/api/chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
        body: JSON.stringify({ message: 'hi' }),
      });
      
      const data = await chatRes.json();
      expect(data.message.content.toLowerCase()).toContain('otto');
    });
  });
  
  describe('Frame Flow', () => {
    test('GET /frame returns valid frame HTML', async () => {
      const res = await app.request('/frame');
      expect(res.status).toBe(200);
      
      const html = await res.text();
      expect(html).toContain('fc:frame');
      expect(html).toContain('vNext');
      expect(html).toContain('fc:frame:button:1');
    });
    
    test('frame image endpoint returns SVG', async () => {
      const res = await app.request('/frame/img?t=Test');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/svg+xml');
      
      const svg = await res.text();
      expect(svg).toContain('<svg');
      expect(svg).toContain('Test');
    });
  });
  
  describe('Miniapp Flow', () => {
    test('GET /miniapp returns HTML with chat interface', async () => {
      // Note: Hono routes without trailing slash
      const res = await app.request('/miniapp');
      expect(res.status).toBe(200);
      
      const html = await res.text();
      expect(html).toContain('<input');
      expect(html).toContain('sendMsg');
      expect(html).toContain('/api/chat');
    });
    
    test('GET /miniapp/telegram includes Telegram WebApp script', async () => {
      const res = await app.request('/miniapp/telegram');
      expect(res.status).toBe(200);
      
      const html = await res.text();
      expect(html).toContain('telegram.org/js/telegram-web-app.js');
    });
  });
  
  describe('Auth Flow', () => {
    test('GET /api/chat/auth/message returns signing message', async () => {
      const res = await app.request('/api/chat/auth/message?address=0x1234567890123456789012345678901234567890');
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.message).toContain('Sign in to Otto');
      expect(data.message).toContain('0x1234');
      expect(data.nonce).toBeDefined();
    });
    
    test('GET /api/chat/auth/message without address returns 400', async () => {
      const res = await app.request('/api/chat/auth/message');
      expect(res.status).toBe(400);
    });
  });
});

describe('Response Format', () => {
  let app: Hono;
  
  beforeAll(() => {
    app = createApp();
  });
  
  test('all responses are JSON (not HTML error pages)', async () => {
    const endpoints = [
      { method: 'GET', path: '/health' },
      { method: 'POST', path: '/api/chat/session', body: '{}' },
    ];
    
    for (const ep of endpoints) {
      const res = await app.request(ep.path, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: ep.body,
      });
      
      const contentType = res.headers.get('content-type');
      expect(contentType).toContain('application/json');
    }
  });
  
  test('chat response has required fields', async () => {
    const sessionRes = await app.request('/api/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const { sessionId } = await sessionRes.json();
    
    const chatRes = await app.request('/api/chat/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({ message: 'help' }),
    });
    
    const data = await chatRes.json();
    
    // Required fields
    expect(data.sessionId).toBeDefined();
    expect(data.message).toBeDefined();
    expect(data.message.id).toBeDefined();
    expect(data.message.role).toBe('assistant');
    expect(data.message.content).toBeDefined();
    expect(data.message.timestamp).toBeDefined();
    expect(typeof data.requiresAuth).toBe('boolean');
  });
});

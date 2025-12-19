/**
 * E2E Tests for Otto Platform Integrations
 * Tests webhook endpoints and platform-specific flows
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.OTTO_BASE_URL ?? 'http://localhost:4040';

test.describe('Discord Webhook E2E', () => {
  test('discord webhook accepts valid interaction', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/webhooks/discord`, {
      data: {
        type: 1, // PING
        token: 'test-token',
      },
    });
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.type).toBe(1); // PONG
  });

  test('discord slash command interaction', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/webhooks/discord`, {
      data: {
        type: 2, // APPLICATION_COMMAND
        token: 'test-token',
        member: {
          user: { id: '123456789', username: 'testuser' },
        },
        channel_id: 'channel123',
        data: {
          name: 'otto',
          options: [{ name: 'help', type: 1 }],
        },
      },
    });
    
    expect(response.ok()).toBeTruthy();
  });
});

test.describe('Telegram Webhook E2E', () => {
  test('telegram webhook accepts message update', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/webhooks/telegram`, {
      data: {
        update_id: 123456,
        message: {
          message_id: 1,
          from: { id: 12345, username: 'testuser', first_name: 'Test' },
          chat: { id: 12345, type: 'private' },
          text: '/start',
          date: Math.floor(Date.now() / 1000),
        },
      },
    });
    
    expect(response.ok()).toBeTruthy();
  });

  test('telegram callback query', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/webhooks/telegram`, {
      data: {
        update_id: 123457,
        callback_query: {
          id: 'callback123',
          from: { id: 12345, username: 'testuser' },
          message: { chat: { id: 12345 } },
          data: 'swap_confirm',
        },
      },
    });
    
    expect(response.ok()).toBeTruthy();
  });
});

test.describe('Farcaster Webhook E2E', () => {
  test('farcaster frame interaction', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/webhooks/farcaster`, {
      data: {
        untrustedData: {
          fid: 12345,
          url: 'https://otto.jejunetwork.org/frame',
          messageHash: 'abc123',
          timestamp: Date.now(),
          network: 1,
          buttonIndex: 1,
          inputText: 'swap 1 ETH to USDC',
        },
        trustedData: {
          messageBytes: '',
        },
      },
    });
    
    expect(response.ok()).toBeTruthy();
  });
});

test.describe('Twitter Webhook E2E', () => {
  test('twitter CRC challenge', async ({ request }) => {
    const response = await request.get(
      `${BASE_URL}/webhooks/twitter?crc_token=test_token_123`
    );
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.response_token).toBeDefined();
    expect(data.response_token).toMatch(/^sha256=/);
  });

  test('twitter webhook accepts tweet event', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/webhooks/twitter`, {
      data: {
        for_user_id: '123456789',
        tweet_create_events: [
          {
            id_str: 'tweet123',
            text: '@otto_agent swap 1 ETH to USDC',
            user: { id_str: '987654321', screen_name: 'testuser' },
            created_at: new Date().toISOString(),
          },
        ],
      },
    });
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.ok).toBe(true);
  });

  test('twitter webhook accepts DM event', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/webhooks/twitter`, {
      data: {
        for_user_id: '123456789',
        direct_message_events: [
          {
            type: 'message_create',
            message_create: {
              sender_id: '987654321',
              message_data: { text: 'help' },
            },
          },
        ],
      },
    });
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.ok).toBe(true);
  });
});

test.describe('WhatsApp Webhook E2E', () => {
  test('whatsapp webhook accepts message', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/webhooks/whatsapp`, {
      data: {
        MessageSid: 'SM123',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        Body: 'otto help',
      },
    });
    
    expect(response.ok()).toBeTruthy();
  });
});

test.describe('Cross-Platform Integration', () => {
  test('same user can interact across platforms', async ({ request }) => {
    // Create session for web
    const webSession = await request.post(`${BASE_URL}/api/chat/session`, {
      data: {},
    });
    const webData = await webSession.json();
    
    // Send message on web
    const webMsg = await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': webData.sessionId },
      data: { message: 'connect' },
    });
    const webMsgData = await webMsg.json();
    expect(webMsgData.message.content).toContain('connect');
    
    // Simulate Telegram webhook with same intent
    const telegramWebhook = await request.post(`${BASE_URL}/webhooks/telegram`, {
      data: {
        update_id: 999999,
        message: {
          message_id: 1,
          from: { id: 99999, username: 'sameuser', first_name: 'Same' },
          chat: { id: 99999, type: 'private' },
          text: '/otto connect',
          date: Math.floor(Date.now() / 1000),
        },
      },
    });
    expect(telegramWebhook.ok()).toBeTruthy();
  });
});


/**
 * @fileoverview AGGRESSIVE tests for notification utilities
 * @module scripts/shared/notifications.test
 * 
 * These tests CRASH and THROW to find bugs.
 * No defensive programming. No silent failures.
 */

import { describe, it, expect, mock } from 'bun:test';
import {
  sendNotification,
  sendAlert,
  sendSuccess,
  sendWarning,
  type NotificationConfig,
  type NotificationLevel,
} from './notifications';

describe('Notification Utilities - AGGRESSIVE TESTS', () => {
  
  describe('sendNotification - Core Logic', () => {
    it('should construct message with correct emoji for each level', async () => {
      const levels: { level: NotificationLevel; expectedEmoji: string }[] = [
        { level: 'info', expectedEmoji: 'ℹ️' },
        { level: 'success', expectedEmoji: '✅' },
        { level: 'warning', expectedEmoji: '⚠️' },
        { level: 'error', expectedEmoji: '❌' },
        { level: 'critical', expectedEmoji: '🚨' },
      ];

      // Mock console.log to capture output
      const originalLog = console.log;
      const loggedMessages: string[] = [];
      console.log = mock((msg: string) => {
        loggedMessages.push(msg);
      });

      for (const { level, expectedEmoji } of levels) {
        loggedMessages.length = 0; // Clear
        await sendNotification('Test message', level);
        
        // ASSERT: Message was actually logged
        expect(loggedMessages.length).toBeGreaterThan(0);
        
        // ASSERT: Correct emoji used
        const message = loggedMessages[0];
        expect(message).toContain(expectedEmoji);
        expect(message).toContain('Test message');
        expect(message).toContain('**Jeju Notification**');
      }

      console.log = originalLog;
    });

    it('should default to info level when not specified', async () => {
      const originalLog = console.log;
      const loggedMessages: string[] = [];
      console.log = mock((msg: string) => { loggedMessages.push(msg); });

      await sendNotification('Test');
      
      // ASSERT: Info emoji used
      expect(loggedMessages[0]).toContain('ℹ️');
      
      console.log = originalLog;
    });

    it('should read config from environment variables', async () => {
      const originalEnv = { ...process.env };
      const mockFetch = mock(() => Promise.resolve(new Response('', { status: 200 })));
      global.fetch = mockFetch as any;

      process.env.DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/test/token';
      process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
      process.env.TELEGRAM_CHAT_ID = 'chat-id';

      await sendNotification('Test message', 'info');

      // ASSERT: fetch was called for Discord
      const discordCalls = mockFetch.mock.calls.filter((call: any) => 
        call[0]?.includes('discord.com')
      );
      expect(discordCalls.length).toBeGreaterThan(0);

      // ASSERT: fetch was called for Telegram
      const telegramCalls = mockFetch.mock.calls.filter((call: any) => 
        call[0]?.includes('api.telegram.org')
      );
      expect(telegramCalls.length).toBeGreaterThan(0);

      process.env = originalEnv;
    });
  });

  describe('sendAlert - MUST send critical level', () => {
    it('should use critical level, not error', async () => {
      const originalLog = console.log;
      const loggedMessages: string[] = [];
      console.log = mock((msg: string) => { loggedMessages.push(msg); });

      await sendAlert('Alert message');
      
      // ASSERT: Uses critical emoji, NOT error emoji
      expect(loggedMessages[0]).toContain('🚨');
      expect(loggedMessages[0]).not.toContain('❌');
      
      console.log = originalLog;
    });
  });

  describe('sendSuccess - MUST send success level', () => {
    it('should use success emoji', async () => {
      const originalLog = console.log;
      const loggedMessages: string[] = [];
      console.log = mock((msg: string) => { loggedMessages.push(msg); });

      await sendSuccess('Success message');
      
      // ASSERT: Uses success emoji
      expect(loggedMessages[0]).toContain('✅');
      
      console.log = originalLog;
    });
  });

  describe('sendWarning - MUST send warning level', () => {
    it('should use warning emoji', async () => {
      const originalLog = console.log;
      const loggedMessages: string[] = [];
      console.log = mock((msg: string) => { loggedMessages.push(msg); });

      await sendWarning('Warning message');
      
      // ASSERT: Uses warning emoji
      expect(loggedMessages[0]).toContain('⚠️');
      
      console.log = originalLog;
    });
  });

  describe('Discord Integration - VERIFY ACTUAL CALLS', () => {
    it('should call Discord webhook with correct payload', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response('', { status: 200 })));
      global.fetch = mockFetch as any;

      const config: NotificationConfig = {
        discordWebhook: 'https://discord.com/api/webhooks/123/abc',
      };

      await sendNotification('Test message', 'info', config);

      // ASSERT: fetch was called
      expect(mockFetch).toHaveBeenCalled();
      
      // ASSERT: Called correct URL
      const calls = mockFetch.mock.calls;
      expect(calls[0][0]).toContain('discord.com/api/webhooks');
      
      // ASSERT: Sent POST request
      expect(calls[0][1]?.method).toBe('POST');
      
      // ASSERT: Sent JSON body
      const body = JSON.parse(calls[0][1]?.body || '{}');
      expect(body.content).toContain('Test message');
      expect(body.content).toContain('ℹ️');
    });

    it('should NOT call Discord if webhook not configured', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response('', { status: 200 })));
      global.fetch = mockFetch as any;

      await sendNotification('Test', 'info', {});

      // ASSERT: fetch NOT called
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Telegram Integration - VERIFY ACTUAL CALLS', () => {
    it('should call Telegram API with correct payload', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response('', { status: 200 })));
      global.fetch = mockFetch as any;

      const config: NotificationConfig = {
        telegramBotToken: 'bot-token-123',
        telegramChatId: 'chat-456',
      };

      await sendNotification('Test message', 'info', config);

      // ASSERT: fetch was called
      expect(mockFetch).toHaveBeenCalled();
      
      // ASSERT: Called Telegram API
      const calls = mockFetch.mock.calls;
      const telegramCall = calls.find((c: any) => c[0]?.includes('api.telegram.org'));
      expect(telegramCall).toBeTruthy();
      
      // ASSERT: Correct endpoint
      expect(telegramCall[0]).toContain('/sendMessage');
      expect(telegramCall[0]).toContain('bot-token-123');
      
      // ASSERT: Correct payload
      const body = JSON.parse(telegramCall[1]?.body || '{}');
      expect(body.chat_id).toBe('chat-456');
      expect(body.text).toContain('Test message');
      expect(body.parse_mode).toBe('Markdown');
    });

    it('should NOT call Telegram if not fully configured', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response('', { status: 200 })));
      global.fetch = mockFetch as any;

      // Missing chatId
      await sendNotification('Test', 'info', {
        telegramBotToken: 'token',
      });

      // ASSERT: No Telegram calls
      const telegramCalls = mockFetch.mock.calls.filter((c: any) => 
        c[0]?.includes('telegram.org')
      );
      expect(telegramCalls.length).toBe(0);
    });
  });

  describe('Error Handling - MUST NOT THROW', () => {
    it('should log error but not throw when Discord fails', async () => {
      const mockFetch = mock(() => Promise.reject(new Error('Network error')));
      global.fetch = mockFetch as any;

      const originalError = console.error;
      let errorLogged = false;
      console.error = mock((...args: any[]) => {
        errorLogged = true;
        originalError(...args);
      });

      const config: NotificationConfig = {
        discordWebhook: 'https://discord.com/webhook',
      };

      // ASSERT: Should not throw
      await expect(sendNotification('Test', 'info', config)).resolves.toBeUndefined();
      
      // ASSERT: Error was logged
      expect(errorLogged).toBe(true);
      
      console.error = originalError;
    });

    it('should log error but not throw when Telegram fails', async () => {
      const mockFetch = mock(() => Promise.reject(new Error('API error')));
      global.fetch = mockFetch as any;

      const originalError = console.error;
      let errorLogged = false;
      console.error = mock((...args: any[]) => {
        errorLogged = true;
        originalError(...args);
      });

      const config: NotificationConfig = {
        telegramBotToken: 'token',
        telegramChatId: 'chat',
      };

      // ASSERT: Should not throw
      await expect(sendNotification('Test', 'info', config)).resolves.toBeUndefined();
      
      // ASSERT: Error was logged
      expect(errorLogged).toBe(true);
      
      console.error = originalError;
    });
  });

  describe('Integration - VERIFY ALL CHANNELS', () => {
    it('should call ALL configured channels', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response('', { status: 200 })));
      global.fetch = mockFetch as any;

      const config: NotificationConfig = {
        discordWebhook: 'https://discord.com/webhook',
        telegramBotToken: 'token',
        telegramChatId: 'chat',
      };

      await sendNotification('Test', 'info', config);

      // ASSERT: Both services called
      expect(mockFetch.mock.calls.length).toBe(2);
      
      // ASSERT: Discord called
      const discordCalls = mockFetch.mock.calls.filter((c: any) => 
        c[0]?.includes('discord.com')
      );
      expect(discordCalls.length).toBe(1);
      
      // ASSERT: Telegram called
      const telegramCalls = mockFetch.mock.calls.filter((c: any) => 
        c[0]?.includes('telegram.org')
      );
      expect(telegramCalls.length).toBe(1);
    });
  });
});

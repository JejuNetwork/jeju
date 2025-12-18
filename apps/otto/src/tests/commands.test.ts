/**
 * Otto Command Handler Tests
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { CommandHandler } from '../agent/commands';
import type { PlatformMessage } from '../types';

describe('CommandHandler', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    handler = new CommandHandler();
  });

  describe('parseCommand', () => {
    const createMessage = (content: string): PlatformMessage => ({
      platform: 'discord',
      messageId: 'test-123',
      channelId: 'channel-123',
      userId: 'user-123',
      content,
      timestamp: Date.now(),
      isCommand: true,
    });

    test('parses help command', () => {
      const result = handler.parseCommand(createMessage('help'));
      expect(result).not.toBeNull();
      expect(result?.command).toBe('help');
    });

    test('parses balance command', () => {
      const result = handler.parseCommand(createMessage('balance'));
      expect(result).not.toBeNull();
      expect(result?.command).toBe('balance');
    });

    test('parses balance with token argument', () => {
      const result = handler.parseCommand(createMessage('balance ETH'));
      expect(result).not.toBeNull();
      expect(result?.command).toBe('balance');
      expect(result?.args).toEqual(['eth']);
    });

    test('parses swap command', () => {
      const result = handler.parseCommand(createMessage('swap 1 ETH to USDC'));
      expect(result).not.toBeNull();
      expect(result?.command).toBe('swap');
      expect(result?.rawArgs).toBe('1 eth to usdc');
    });

    test('parses bridge command', () => {
      const result = handler.parseCommand(createMessage('bridge 1 ETH from ethereum to base'));
      expect(result).not.toBeNull();
      expect(result?.command).toBe('bridge');
    });

    test('parses send command', () => {
      const result = handler.parseCommand(createMessage('send 1 ETH to vitalik.eth'));
      expect(result).not.toBeNull();
      expect(result?.command).toBe('send');
    });

    test('parses launch command', () => {
      const result = handler.parseCommand(createMessage('launch "Moon Coin" MOON'));
      expect(result).not.toBeNull();
      expect(result?.command).toBe('launch');
    });

    test('parses settings command', () => {
      const result = handler.parseCommand(createMessage('settings'));
      expect(result).not.toBeNull();
      expect(result?.command).toBe('settings');
    });

    test('parses connect command', () => {
      const result = handler.parseCommand(createMessage('connect'));
      expect(result).not.toBeNull();
      expect(result?.command).toBe('connect');
    });

    test('returns null for unknown command', () => {
      const result = handler.parseCommand(createMessage('unknown command here'));
      expect(result).toBeNull();
    });

    test('parses command aliases', () => {
      expect(handler.parseCommand(createMessage('bal'))?.command).toBe('balance');
      expect(handler.parseCommand(createMessage('b'))?.command).toBe('balance');
      expect(handler.parseCommand(createMessage('p ETH'))?.command).toBe('price');
      expect(handler.parseCommand(createMessage('s 1 ETH to USDC'))?.command).toBe('swap');
      expect(handler.parseCommand(createMessage('trade 1 ETH to USDC'))?.command).toBe('swap');
      expect(handler.parseCommand(createMessage('port'))?.command).toBe('portfolio');
      expect(handler.parseCommand(createMessage('link'))?.command).toBe('connect');
    });
  });

  describe('execute', () => {
    test('help command returns command list', async () => {
      const result = await handler.execute({
        command: 'help',
        args: [],
        rawArgs: '',
        platform: 'discord',
        userId: 'user-123',
        channelId: 'channel-123',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Otto');
      expect(result.message).toContain('Commands');
    });

    test('help command with specific command', async () => {
      const result = await handler.execute({
        command: 'help',
        args: ['swap'],
        rawArgs: 'swap',
        platform: 'discord',
        userId: 'user-123',
        channelId: 'channel-123',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('swap');
      expect(result.message).toContain('Usage');
    });

    test('balance command without wallet returns connect prompt', async () => {
      const result = await handler.execute({
        command: 'balance',
        args: [],
        rawArgs: '',
        platform: 'discord',
        userId: 'user-123',
        channelId: 'channel-123',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('connect');
    });

    test('connect command returns link URL', async () => {
      const result = await handler.execute({
        command: 'connect',
        args: [],
        rawArgs: '',
        platform: 'discord',
        userId: 'user-123',
        channelId: 'channel-123',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Connect');
      expect(result.buttons).toBeDefined();
      expect(result.buttons?.length).toBeGreaterThan(0);
    });
  });
});


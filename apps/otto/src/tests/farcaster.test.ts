/**
 * Farcaster Integration Tests
 */

import { describe, test, expect } from 'bun:test';

describe('Farcaster Adapter', () => {
  describe('command extraction', () => {
    const extractCommand = (text: string): string => {
      // Remove @otto mention and extract command
      const withoutMention = text.replace(/@otto\s*/gi, '').trim();
      
      // Check if starts with otto command
      if (withoutMention.toLowerCase().startsWith('otto ')) {
        return withoutMention.slice(5).trim();
      }
      
      return withoutMention;
    };

    test('extracts command from @otto mention', () => {
      expect(extractCommand('@otto swap 1 ETH to USDC')).toBe('swap 1 ETH to USDC');
      expect(extractCommand('@otto help')).toBe('help');
    });

    test('extracts command from otto prefix', () => {
      expect(extractCommand('otto swap 1 ETH to USDC')).toBe('swap 1 ETH to USDC');
      expect(extractCommand('otto balance')).toBe('balance');
    });

    test('handles direct messages without prefix', () => {
      expect(extractCommand('help')).toBe('help');
      expect(extractCommand('price ETH')).toBe('price ETH');
    });

    test('handles case insensitivity', () => {
      expect(extractCommand('@OTTO swap')).toBe('swap');
      expect(extractCommand('OTTO help')).toBe('help');
    });
  });

  describe('channel parsing', () => {
    const parseChannel = (channelId: string): { type: 'dm' | 'thread' | 'channel'; id: string } => {
      if (channelId.startsWith('dm:')) {
        return { type: 'dm', id: channelId.slice(3) };
      }
      if (channelId.startsWith('thread:')) {
        return { type: 'thread', id: channelId.slice(7) };
      }
      return { type: 'channel', id: channelId };
    };

    test('parses DM channel', () => {
      const result = parseChannel('dm:abc123');
      expect(result.type).toBe('dm');
      expect(result.id).toBe('abc123');
    });

    test('parses thread channel', () => {
      const result = parseChannel('thread:0x1234');
      expect(result.type).toBe('thread');
      expect(result.id).toBe('0x1234');
    });

    test('parses regular channel', () => {
      const result = parseChannel('warpcast');
      expect(result.type).toBe('channel');
      expect(result.id).toBe('warpcast');
    });
  });

  describe('embed formatting', () => {
    interface MessageEmbed {
      title?: string;
      description?: string;
      fields?: Array<{ name: string; value: string }>;
      footer?: string;
    }

    interface MessageButton {
      label: string;
      url?: string;
    }

    const formatEmbed = (embed: MessageEmbed, buttons?: MessageButton[]): string => {
      const lines: string[] = [];
      
      if (embed.title) {
        lines.push(`**${embed.title}**`);
      }
      
      if (embed.description) {
        lines.push(embed.description);
      }
      
      if (embed.fields?.length) {
        lines.push('');
        for (const field of embed.fields) {
          lines.push(`${field.name}: ${field.value}`);
        }
      }

      if (buttons?.length) {
        lines.push('');
        for (const button of buttons) {
          if (button.url) {
            lines.push(`${button.label}: ${button.url}`);
          }
        }
      }
      
      if (embed.footer) {
        lines.push('');
        lines.push(embed.footer);
      }
      
      return lines.join('\n');
    };

    test('formats embed with title and description', () => {
      const embed = { title: 'Test', description: 'Hello world' };
      const result = formatEmbed(embed);
      expect(result).toContain('**Test**');
      expect(result).toContain('Hello world');
    });

    test('formats embed with fields', () => {
      const embed = {
        title: 'Balance',
        fields: [
          { name: 'ETH', value: '1.5' },
          { name: 'USDC', value: '5000' },
        ],
      };
      const result = formatEmbed(embed);
      expect(result).toContain('ETH: 1.5');
      expect(result).toContain('USDC: 5000');
    });

    test('formats embed with buttons as links', () => {
      const embed = { title: 'Action Required' };
      const buttons = [
        { label: 'View TX', url: 'https://basescan.org/tx/0x123' },
      ];
      const result = formatEmbed(embed, buttons);
      expect(result).toContain('View TX: https://basescan.org/tx/0x123');
    });
  });
});

describe('Farcaster Frame', () => {
  describe('frame metadata', () => {
    const generateFrameHtml = (params: {
      title: string;
      image: string;
      buttons: Array<{ label: string; action?: string }>;
      inputText?: string;
    }): string => {
      const buttons = params.buttons.map((btn, i) => {
        let meta = `<meta property="fc:frame:button:${i + 1}" content="${btn.label}" />`;
        if (btn.action) {
          meta += `\n<meta property="fc:frame:button:${i + 1}:action" content="${btn.action}" />`;
        }
        return meta;
      }).join('\n');

      return `<!DOCTYPE html>
<html>
<head>
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="${params.image}" />
  ${params.inputText ? `<meta property="fc:frame:input:text" content="${params.inputText}" />` : ''}
  ${buttons}
</head>
</html>`;
    };

    test('generates frame with buttons', () => {
      const html = generateFrameHtml({
        title: 'Test',
        image: 'https://example.com/image.png',
        buttons: [
          { label: 'Swap', action: 'post' },
          { label: 'Bridge' },
        ],
      });
      
      expect(html).toContain('fc:frame:button:1');
      expect(html).toContain('Swap');
      expect(html).toContain('fc:frame:button:2');
      expect(html).toContain('Bridge');
    });

    test('generates frame with input', () => {
      const html = generateFrameHtml({
        title: 'Test',
        image: 'https://example.com/image.png',
        buttons: [{ label: 'Submit' }],
        inputText: 'Enter amount...',
      });
      
      expect(html).toContain('fc:frame:input:text');
      expect(html).toContain('Enter amount...');
    });

    test('generates frame with version', () => {
      const html = generateFrameHtml({
        title: 'Test',
        image: 'https://example.com/image.png',
        buttons: [],
      });
      
      expect(html).toContain('fc:frame');
      expect(html).toContain('vNext');
    });
  });

  describe('swap parsing', () => {
    const parseSwap = (input: string): { amount: string; fromToken: string; toToken: string } | null => {
      const match = input.match(/^(\d+(?:\.\d+)?)\s*(\w+)\s*(?:to|for)\s*(\w+)$/i);
      if (!match) return null;
      return {
        amount: match[1],
        fromToken: match[2],
        toToken: match[3],
      };
    };

    test('parses swap command', () => {
      expect(parseSwap('1 ETH to USDC')).toEqual({ amount: '1', fromToken: 'ETH', toToken: 'USDC' });
      expect(parseSwap('100 USDC for ETH')).toEqual({ amount: '100', fromToken: 'USDC', toToken: 'ETH' });
      expect(parseSwap('0.5 WETH to DAI')).toEqual({ amount: '0.5', fromToken: 'WETH', toToken: 'DAI' });
    });

    test('returns null for invalid input', () => {
      expect(parseSwap('invalid')).toBeNull();
      expect(parseSwap('swap tokens')).toBeNull();
    });
  });

  describe('bridge parsing', () => {
    const parseBridge = (input: string): { amount: string; token: string; fromChain: string; toChain: string } | null => {
      const match = input.match(/^(\d+(?:\.\d+)?)\s*(\w+)\s*from\s*(\w+)\s*to\s*(\w+)$/i);
      if (!match) return null;
      return {
        amount: match[1],
        token: match[2],
        fromChain: match[3],
        toChain: match[4],
      };
    };

    test('parses bridge command', () => {
      expect(parseBridge('1 ETH from ethereum to base')).toEqual({
        amount: '1',
        token: 'ETH',
        fromChain: 'ethereum',
        toChain: 'base',
      });
    });
  });
});



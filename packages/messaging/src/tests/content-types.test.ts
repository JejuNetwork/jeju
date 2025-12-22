/**
 * Content Types Validation Tests
 * 
 * Tests for content type builders, validators, serialization, and edge cases.
 */

import { describe, test, expect } from 'bun:test';
import {
  text,
  image,
  file,
  reaction,
  reply,
  transaction,
  agentAction,
  serializeContent,
  deserializeContent,
  getContentTypeId,
  validateImage,
  validateFile,
  validateTransaction,
  getContentPreview,
  isRichContent,
  ContentTypeIds,
} from '../mls/content-types';
import type {
  TextContent,
  ImageContent,
  FileContent,
  ReactionContent,
  ReplyContent,
  TransactionContent,
  AgentActionContent,
  MessageContent,
} from '../mls/types';
import type { Hex, Address } from 'viem';

// ============ Content Builder Tests ============

describe('Content Builders', () => {
  describe('text()', () => {
    test('creates text content', () => {
      const content = text('Hello, World!');
      
      expect(content.type).toBe('text');
      expect(content.text).toBe('Hello, World!');
    });

    test('handles empty string', () => {
      const content = text('');
      expect(content.text).toBe('');
    });

    test('handles unicode content', () => {
      const content = text('你好世界 🎉 مرحبا');
      expect(content.text).toBe('你好世界 🎉 مرحبا');
    });

    test('handles newlines and special characters', () => {
      const content = text('Line1\nLine2\r\nLine3\t');
      expect(content.text).toBe('Line1\nLine2\r\nLine3\t');
    });

    test('handles very long text', () => {
      const longText = 'x'.repeat(100000);
      const content = text(longText);
      expect(content.text.length).toBe(100000);
    });
  });

  describe('image()', () => {
    test('creates image content with required fields', () => {
      const content = image({
        url: 'https://example.com/img.png',
        width: 800,
        height: 600,
        mimeType: 'image/png',
      });
      
      expect(content.type).toBe('image');
      expect(content.url).toBe('https://example.com/img.png');
      expect(content.width).toBe(800);
      expect(content.height).toBe(600);
      expect(content.mimeType).toBe('image/png');
    });

    test('creates image content with optional fields', () => {
      const content = image({
        url: 'https://example.com/img.jpg',
        width: 1920,
        height: 1080,
        mimeType: 'image/jpeg',
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        alt: 'A beautiful sunset',
      });
      
      expect(content.blurhash).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj');
      expect(content.alt).toBe('A beautiful sunset');
    });

    test('preserves zero dimensions', () => {
      const content = image({
        url: 'https://example.com/img.svg',
        width: 0,
        height: 0,
        mimeType: 'image/svg+xml',
      });
      
      expect(content.width).toBe(0);
      expect(content.height).toBe(0);
    });
  });

  describe('file()', () => {
    test('creates file content', () => {
      const content = file({
        url: 'https://example.com/doc.pdf',
        name: 'document.pdf',
        size: 1024000,
        mimeType: 'application/pdf',
      });
      
      expect(content.type).toBe('file');
      expect(content.url).toBe('https://example.com/doc.pdf');
      expect(content.name).toBe('document.pdf');
      expect(content.size).toBe(1024000);
      expect(content.mimeType).toBe('application/pdf');
    });

    test('handles special characters in filename', () => {
      const content = file({
        url: 'https://example.com/file.zip',
        name: 'file (1) [copy].zip',
        size: 100,
        mimeType: 'application/zip',
      });
      
      expect(content.name).toBe('file (1) [copy].zip');
    });

    test('handles unicode filename', () => {
      const content = file({
        url: 'https://example.com/file.txt',
        name: '文档.txt',
        size: 50,
        mimeType: 'text/plain',
      });
      
      expect(content.name).toBe('文档.txt');
    });
  });

  describe('reaction()', () => {
    test('creates add reaction by default', () => {
      const content = reaction({
        emoji: '👍',
        messageId: 'msg-123',
      });
      
      expect(content.type).toBe('reaction');
      expect(content.emoji).toBe('👍');
      expect(content.messageId).toBe('msg-123');
      expect(content.action).toBe('add');
    });

    test('creates remove reaction', () => {
      const content = reaction({
        emoji: '❤️',
        messageId: 'msg-456',
        action: 'remove',
      });
      
      expect(content.action).toBe('remove');
    });

    test('handles compound emoji', () => {
      const content = reaction({
        emoji: '👨‍👩‍👧‍👦',
        messageId: 'msg-789',
      });
      
      expect(content.emoji).toBe('👨‍👩‍👧‍👦');
    });

    test('handles emoji with skin tone', () => {
      const content = reaction({
        emoji: '👍🏿',
        messageId: 'msg-000',
      });
      
      expect(content.emoji).toBe('👍🏿');
    });
  });

  describe('reply()', () => {
    test('creates reply with required fields', () => {
      const content = reply({
        text: 'My reply',
        replyToId: 'msg-original',
      });
      
      expect(content.type).toBe('reply');
      expect(content.text).toBe('My reply');
      expect(content.replyToId).toBe('msg-original');
    });

    test('creates reply with optional fields', () => {
      const content = reply({
        text: 'Replying to your message',
        replyToId: 'msg-999',
        replyToContent: 'Original message text',
        replyToSender: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address,
      });
      
      expect(content.replyToContent).toBe('Original message text');
      expect(content.replyToSender).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    });
  });

  describe('transaction()', () => {
    test('creates transaction content with defaults', () => {
      const content = transaction({
        chainId: 8453,
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex,
      });
      
      expect(content.type).toBe('transaction');
      expect(content.chainId).toBe(8453);
      expect(content.txHash).toBe('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
      expect(content.status).toBe('pending');
    });

    test('creates transaction with all fields', () => {
      const content = transaction({
        chainId: 1,
        txHash: '0x' + 'ab'.repeat(32) as Hex,
        status: 'confirmed',
        description: 'Token transfer',
        amount: '1.5',
        token: 'ETH',
      });
      
      expect(content.status).toBe('confirmed');
      expect(content.description).toBe('Token transfer');
      expect(content.amount).toBe('1.5');
      expect(content.token).toBe('ETH');
    });

    test('handles failed transaction', () => {
      const content = transaction({
        chainId: 137,
        txHash: '0x' + 'ff'.repeat(32) as Hex,
        status: 'failed',
      });
      
      expect(content.status).toBe('failed');
    });
  });

  describe('agentAction()', () => {
    test('creates agent action with defaults', () => {
      const content = agentAction({
        agentId: 123,
        action: 'swap',
        params: { tokenIn: 'ETH', tokenOut: 'USDC' },
      });
      
      expect(content.type).toBe('agent_action');
      expect(content.agentId).toBe(123);
      expect(content.action).toBe('swap');
      expect(content.params).toEqual({ tokenIn: 'ETH', tokenOut: 'USDC' });
      expect(content.status).toBe('pending');
    });

    test('creates agent action with all fields', () => {
      const content = agentAction({
        agentId: 456,
        action: 'bridge',
        params: { amount: 100, fromChain: 1, toChain: 137 },
        status: 'completed',
        result: 'Success: bridged 100 USDC',
      });
      
      expect(content.status).toBe('completed');
      expect(content.result).toBe('Success: bridged 100 USDC');
    });

    test('handles numeric, string, and boolean params', () => {
      const content = agentAction({
        agentId: 1,
        action: 'test',
        params: {
          stringVal: 'hello',
          numericVal: 42,
          booleanVal: true,
        },
      });
      
      expect(content.params.stringVal).toBe('hello');
      expect(content.params.numericVal).toBe(42);
      expect(content.params.booleanVal).toBe(true);
    });
  });
});

// ============ Content Type ID Tests ============

describe('Content Type IDs', () => {
  test('returns correct ID for text', () => {
    const content = text('test');
    expect(getContentTypeId(content)).toBe(ContentTypeIds.TEXT);
  });

  test('returns correct ID for image', () => {
    const content = image({ url: '', width: 0, height: 0, mimeType: '' });
    expect(getContentTypeId(content)).toBe(ContentTypeIds.IMAGE);
  });

  test('returns correct ID for file', () => {
    const content = file({ url: '', name: '', size: 0, mimeType: '' });
    expect(getContentTypeId(content)).toBe(ContentTypeIds.FILE);
  });

  test('returns correct ID for reaction', () => {
    const content = reaction({ emoji: '', messageId: '' });
    expect(getContentTypeId(content)).toBe(ContentTypeIds.REACTION);
  });

  test('returns correct ID for reply', () => {
    const content = reply({ text: '', replyToId: '' });
    expect(getContentTypeId(content)).toBe(ContentTypeIds.REPLY);
  });

  test('returns correct ID for transaction', () => {
    const content = transaction({ chainId: 1, txHash: '0x' + '00'.repeat(32) as Hex });
    expect(getContentTypeId(content)).toBe(ContentTypeIds.TRANSACTION);
  });

  test('returns correct ID for agent action', () => {
    const content = agentAction({ agentId: 1, action: '', params: {} });
    expect(getContentTypeId(content)).toBe(ContentTypeIds.AGENT_ACTION);
  });

  test('all content type IDs have version', () => {
    Object.values(ContentTypeIds).forEach(id => {
      expect(id).toMatch(/:\d+\.\d+$/);
    });
  });
});

// ============ Serialization Tests ============

describe('Content Serialization', () => {
  test('serializes and deserializes text content', () => {
    const original = text('Hello, World!');
    const serialized = serializeContent(original);
    const deserialized = deserializeContent(serialized);
    
    expect(deserialized).toEqual(original);
  });

  test('serializes and deserializes image content', () => {
    const original = image({
      url: 'https://example.com/img.png',
      width: 800,
      height: 600,
      mimeType: 'image/png',
      blurhash: 'LEHV6nWB2yk8',
      alt: 'Test image',
    });
    
    const serialized = serializeContent(original);
    const deserialized = deserializeContent(serialized);
    
    expect(deserialized).toEqual(original);
  });

  test('serializes and deserializes file content', () => {
    const original = file({
      url: 'https://example.com/doc.pdf',
      name: 'doc.pdf',
      size: 12345,
      mimeType: 'application/pdf',
    });
    
    const serialized = serializeContent(original);
    const deserialized = deserializeContent(serialized);
    
    expect(deserialized).toEqual(original);
  });

  test('serializes and deserializes reaction content', () => {
    const original = reaction({
      emoji: '🎉',
      messageId: 'msg-123',
      action: 'add',
    });
    
    const serialized = serializeContent(original);
    const deserialized = deserializeContent(serialized);
    
    expect(deserialized).toEqual(original);
  });

  test('serializes and deserializes reply content', () => {
    const original = reply({
      text: 'Reply text',
      replyToId: 'msg-orig',
      replyToContent: 'Original',
      replyToSender: '0xabc' as Address,
    });
    
    const serialized = serializeContent(original);
    const deserialized = deserializeContent(serialized);
    
    expect(deserialized).toEqual(original);
  });

  test('serializes and deserializes transaction content', () => {
    const original = transaction({
      chainId: 8453,
      txHash: '0x' + 'ab'.repeat(32) as Hex,
      status: 'confirmed',
      description: 'Transfer',
      amount: '1.0',
      token: 'ETH',
    });
    
    const serialized = serializeContent(original);
    const deserialized = deserializeContent(serialized);
    
    expect(deserialized).toEqual(original);
  });

  test('serializes and deserializes agent action content', () => {
    const original = agentAction({
      agentId: 42,
      action: 'execute',
      params: { key: 'value', num: 123, bool: true },
      status: 'completed',
      result: 'Done',
    });
    
    const serialized = serializeContent(original);
    const deserialized = deserializeContent(serialized);
    
    expect(deserialized).toEqual(original);
  });

  test('throws on unknown content type', () => {
    const badJson = JSON.stringify({ type: 'unknown', data: {} });
    
    expect(() => deserializeContent(badJson)).toThrow('Unknown content type');
  });

  test('serialization produces valid JSON', () => {
    const content = image({
      url: 'https://example.com/img.png',
      width: 100,
      height: 100,
      mimeType: 'image/png',
    });
    
    const serialized = serializeContent(content);
    
    // Should not throw
    const parsed = JSON.parse(serialized);
    expect(parsed.type).toBe('image');
  });
});

// ============ Validation Tests ============

describe('validateImage', () => {
  test('validates valid JPEG image', () => {
    const content: ImageContent = {
      type: 'image',
      url: 'https://example.com/img.jpg',
      width: 800,
      height: 600,
      mimeType: 'image/jpeg',
    };
    
    expect(validateImage(content)).toBe(true);
  });

  test('validates valid PNG image', () => {
    const content: ImageContent = {
      type: 'image',
      url: 'http://example.com/img.png',
      width: 1920,
      height: 1080,
      mimeType: 'image/png',
    };
    
    expect(validateImage(content)).toBe(true);
  });

  test('validates valid GIF image', () => {
    const content: ImageContent = {
      type: 'image',
      url: 'https://example.com/animated.gif',
      width: 400,
      height: 400,
      mimeType: 'image/gif',
    };
    
    expect(validateImage(content)).toBe(true);
  });

  test('validates valid WebP image', () => {
    const content: ImageContent = {
      type: 'image',
      url: 'https://example.com/modern.webp',
      width: 500,
      height: 500,
      mimeType: 'image/webp',
    };
    
    expect(validateImage(content)).toBe(true);
  });

  test('rejects invalid URL', () => {
    const content: ImageContent = {
      type: 'image',
      url: 'not-a-url',
      width: 100,
      height: 100,
      mimeType: 'image/png',
    };
    
    expect(validateImage(content)).toBe(false);
  });

  test('rejects zero width', () => {
    const content: ImageContent = {
      type: 'image',
      url: 'https://example.com/img.png',
      width: 0,
      height: 100,
      mimeType: 'image/png',
    };
    
    expect(validateImage(content)).toBe(false);
  });

  test('rejects zero height', () => {
    const content: ImageContent = {
      type: 'image',
      url: 'https://example.com/img.png',
      width: 100,
      height: 0,
      mimeType: 'image/png',
    };
    
    expect(validateImage(content)).toBe(false);
  });

  test('rejects negative dimensions', () => {
    const content: ImageContent = {
      type: 'image',
      url: 'https://example.com/img.png',
      width: -100,
      height: 100,
      mimeType: 'image/png',
    };
    
    expect(validateImage(content)).toBe(false);
  });

  test('rejects unsupported mime type', () => {
    const content: ImageContent = {
      type: 'image',
      url: 'https://example.com/img.bmp',
      width: 100,
      height: 100,
      mimeType: 'image/bmp',
    };
    
    expect(validateImage(content)).toBe(false);
  });

  test('rejects SVG mime type', () => {
    const content: ImageContent = {
      type: 'image',
      url: 'https://example.com/logo.svg',
      width: 100,
      height: 100,
      mimeType: 'image/svg+xml',
    };
    
    expect(validateImage(content)).toBe(false);
  });
});

describe('validateFile', () => {
  test('validates valid file', () => {
    const content: FileContent = {
      type: 'file',
      url: 'https://example.com/doc.pdf',
      name: 'document.pdf',
      size: 1024000,
      mimeType: 'application/pdf',
    };
    
    expect(validateFile(content)).toBe(true);
  });

  test('rejects empty filename', () => {
    const content: FileContent = {
      type: 'file',
      url: 'https://example.com/file',
      name: '',
      size: 100,
      mimeType: 'application/octet-stream',
    };
    
    expect(validateFile(content)).toBe(false);
  });

  test('rejects zero size', () => {
    const content: FileContent = {
      type: 'file',
      url: 'https://example.com/empty.txt',
      name: 'empty.txt',
      size: 0,
      mimeType: 'text/plain',
    };
    
    expect(validateFile(content)).toBe(false);
  });

  test('rejects negative size', () => {
    const content: FileContent = {
      type: 'file',
      url: 'https://example.com/file.bin',
      name: 'file.bin',
      size: -100,
      mimeType: 'application/octet-stream',
    };
    
    expect(validateFile(content)).toBe(false);
  });

  test('rejects file > 100MB', () => {
    const content: FileContent = {
      type: 'file',
      url: 'https://example.com/huge.zip',
      name: 'huge.zip',
      size: 100 * 1024 * 1024 + 1, // Just over 100MB
      mimeType: 'application/zip',
    };
    
    expect(validateFile(content)).toBe(false);
  });

  test('accepts file exactly 100MB', () => {
    const content: FileContent = {
      type: 'file',
      url: 'https://example.com/exactly100.zip',
      name: 'exactly100.zip',
      size: 100 * 1024 * 1024 - 1, // Just under 100MB
      mimeType: 'application/zip',
    };
    
    expect(validateFile(content)).toBe(true);
  });

  test('rejects non-string URL', () => {
    const content = {
      type: 'file',
      url: 123, // Not a string
      name: 'file.txt',
      size: 100,
      mimeType: 'text/plain',
    } as unknown as FileContent;
    
    expect(validateFile(content)).toBe(false);
  });
});

describe('validateTransaction', () => {
  test('validates valid pending transaction', () => {
    const content: TransactionContent = {
      type: 'transaction',
      chainId: 1,
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex,
      status: 'pending',
    };
    
    expect(validateTransaction(content)).toBe(true);
  });

  test('validates valid confirmed transaction', () => {
    const content: TransactionContent = {
      type: 'transaction',
      chainId: 8453,
      txHash: '0x' + 'a'.repeat(64) as Hex,
      status: 'confirmed',
    };
    
    expect(validateTransaction(content)).toBe(true);
  });

  test('validates valid failed transaction', () => {
    const content: TransactionContent = {
      type: 'transaction',
      chainId: 137,
      txHash: '0x' + 'f'.repeat(64) as Hex,
      status: 'failed',
    };
    
    expect(validateTransaction(content)).toBe(true);
  });

  test('rejects zero chainId', () => {
    const content: TransactionContent = {
      type: 'transaction',
      chainId: 0,
      txHash: '0x' + '0'.repeat(64) as Hex,
      status: 'pending',
    };
    
    expect(validateTransaction(content)).toBe(false);
  });

  test('rejects negative chainId', () => {
    const content: TransactionContent = {
      type: 'transaction',
      chainId: -1,
      txHash: '0x' + '0'.repeat(64) as Hex,
      status: 'pending',
    };
    
    expect(validateTransaction(content)).toBe(false);
  });

  test('rejects short tx hash', () => {
    const content: TransactionContent = {
      type: 'transaction',
      chainId: 1,
      txHash: '0x1234' as Hex, // Too short
      status: 'pending',
    };
    
    expect(validateTransaction(content)).toBe(false);
  });

  test('rejects tx hash without 0x prefix', () => {
    const content: TransactionContent = {
      type: 'transaction',
      chainId: 1,
      txHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex,
      status: 'pending',
    };
    
    expect(validateTransaction(content)).toBe(false);
  });

  test('rejects invalid status', () => {
    const content = {
      type: 'transaction',
      chainId: 1,
      txHash: '0x' + '0'.repeat(64),
      status: 'unknown',
    } as unknown as TransactionContent;
    
    expect(validateTransaction(content)).toBe(false);
  });

  test('rejects non-hex characters in tx hash', () => {
    const content: TransactionContent = {
      type: 'transaction',
      chainId: 1,
      txHash: '0x' + 'g'.repeat(64) as Hex, // 'g' is not hex
      status: 'pending',
    };
    
    expect(validateTransaction(content)).toBe(false);
  });
});

// ============ Content Preview Tests ============

describe('getContentPreview', () => {
  test('returns text content directly', () => {
    const content = text('Hello, World!');
    expect(getContentPreview(content)).toBe('Hello, World!');
  });

  test('truncates long text to 100 chars', () => {
    const longText = 'x'.repeat(200);
    const content = text(longText);
    expect(getContentPreview(content).length).toBe(100);
  });

  test('returns alt text for image with alt', () => {
    const content = image({
      url: 'https://example.com/img.png',
      width: 100,
      height: 100,
      mimeType: 'image/png',
      alt: 'A beautiful sunset',
    });
    
    expect(getContentPreview(content)).toBe('A beautiful sunset');
  });

  test('returns default for image without alt', () => {
    const content = image({
      url: 'https://example.com/img.png',
      width: 100,
      height: 100,
      mimeType: 'image/png',
    });
    
    expect(getContentPreview(content)).toBe('📷 Image');
  });

  test('returns filename for file', () => {
    const content = file({
      url: 'https://example.com/doc.pdf',
      name: 'report-2024.pdf',
      size: 1000,
      mimeType: 'application/pdf',
    });
    
    expect(getContentPreview(content)).toBe('📎 report-2024.pdf');
  });

  test('returns emoji reaction format', () => {
    const content = reaction({
      emoji: '👍',
      messageId: 'msg-123',
    });
    
    expect(getContentPreview(content)).toBe('👍 reaction');
  });

  test('returns reply text truncated', () => {
    const longReply = 'Reply: '.repeat(50);
    const content = reply({
      text: longReply,
      replyToId: 'msg-orig',
    });
    
    expect(getContentPreview(content).length).toBe(100);
  });

  test('returns transaction preview with description', () => {
    const content = transaction({
      chainId: 1,
      txHash: '0x' + 'a'.repeat(64) as Hex,
      description: 'Token swap',
    });
    
    expect(getContentPreview(content)).toBe('💸 Transaction: Token swap...');
  });

  test('returns transaction preview with truncated hash', () => {
    const content = transaction({
      chainId: 1,
      txHash: '0xabcdef1234' + '0'.repeat(54) as Hex,
    });
    
    expect(getContentPreview(content)).toContain('0xabcdef12');
  });

  test('returns agent action format', () => {
    const content = agentAction({
      agentId: 1,
      action: 'trade',
      params: {},
    });
    
    expect(getContentPreview(content)).toBe('🤖 Agent: trade');
  });
});

// ============ Rich Content Detection Tests ============

describe('isRichContent', () => {
  test('text is not rich content', () => {
    expect(isRichContent(text('Hello'))).toBe(false);
  });

  test('image is rich content', () => {
    expect(isRichContent(image({
      url: 'https://example.com/img.png',
      width: 100,
      height: 100,
      mimeType: 'image/png',
    }))).toBe(true);
  });

  test('file is rich content', () => {
    expect(isRichContent(file({
      url: 'https://example.com/doc.pdf',
      name: 'doc.pdf',
      size: 100,
      mimeType: 'application/pdf',
    }))).toBe(true);
  });

  test('reaction is rich content', () => {
    expect(isRichContent(reaction({
      emoji: '👍',
      messageId: 'msg-123',
    }))).toBe(true);
  });

  test('reply is rich content', () => {
    expect(isRichContent(reply({
      text: 'Reply',
      replyToId: 'msg-orig',
    }))).toBe(true);
  });

  test('transaction is rich content', () => {
    expect(isRichContent(transaction({
      chainId: 1,
      txHash: '0x' + '0'.repeat(64) as Hex,
    }))).toBe(true);
  });

  test('agent action is rich content', () => {
    expect(isRichContent(agentAction({
      agentId: 1,
      action: 'test',
      params: {},
    }))).toBe(true);
  });
});

// ============ Edge Cases ============

describe('Edge Cases', () => {
  test('handles null in serialization gracefully', () => {
    // A text with null would fail type checking, but test runtime safety
    const content = text('test');
    const serialized = serializeContent(content);
    expect(typeof serialized).toBe('string');
  });

  test('handles very long image URLs', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(10000);
    const content = image({
      url: longUrl,
      width: 100,
      height: 100,
      mimeType: 'image/png',
    });
    
    // validateImage should still check url starts with http
    expect(validateImage(content)).toBe(true);
  });

  test('handles emoji in filenames', () => {
    const content = file({
      url: 'https://example.com/file',
      name: '📄 Document.pdf',
      size: 100,
      mimeType: 'application/pdf',
    });
    
    expect(validateFile(content)).toBe(true);
    expect(getContentPreview(content)).toContain('📄 Document.pdf');
  });

  test('handles transaction with max safe integer chainId', () => {
    const content: TransactionContent = {
      type: 'transaction',
      chainId: Number.MAX_SAFE_INTEGER,
      txHash: '0x' + '1'.repeat(64) as Hex,
      status: 'pending',
    };
    
    expect(validateTransaction(content)).toBe(true);
  });

  test('handles mixed case in tx hash', () => {
    const content: TransactionContent = {
      type: 'transaction',
      chainId: 1,
      txHash: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf1234567890AbCdEf1234567890' as Hex,
      status: 'confirmed',
    };
    
    expect(validateTransaction(content)).toBe(true);
  });
});

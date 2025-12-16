/**
 * Integration Tests for Storage System
 *
 * Tests the full flow without requiring external services:
 * - Backend management
 * - Content moderation
 * - Encryption/decryption
 * - Error handling
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { ContentTier, ContentViolationType } from '../../../../packages/types/src';
import { ContentModerationService } from '../src/moderation';
import { EncryptionService, type AccessPolicy } from '../src/encryption';
import {
  ContentTooLargeError,
  ContentBlockedError,
  InvalidInputError,
  isStorageError,
  toStorageError,
} from '../src/errors';

// ============ Content Moderation Tests ============

describe('ContentModerationService', () => {
  let moderation: ContentModerationService;

  beforeAll(() => {
    moderation = new ContentModerationService({
      enableLocalScanning: true,
      nsfwThreshold: 0.9,
      csamThreshold: 0.95,
      piiThreshold: 0.8,
      blocklistSyncInterval: 300000,
    });
  });

  describe('content scanning', () => {
    it('scans JSON content', async () => {
      const content = Buffer.from(JSON.stringify({ hello: 'world' }));
      const result = await moderation.scan(content, {
        mimeType: 'application/json',
        filename: 'data.json',
        size: content.length,
      });

      expect(result.safe).toBe(true);
      expect(result.violationType).toBe(ContentViolationType.NONE);
    });

    it('scans image content', async () => {
      // PNG header
      const content = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const result = await moderation.scan(content, {
        mimeType: 'image/png',
        filename: 'image.png',
        size: content.length,
      });

      expect(result.safe).toBe(true);
    });

    it('scans archive content', async () => {
      const content = Buffer.from('fake zip content');
      const result = await moderation.scan(content, {
        mimeType: 'application/zip',
        filename: 'archive.zip',
        size: content.length,
      });

      expect(result.safe).toBe(true);
      // Low confidence because we can not extract archives yet
      expect(result.confidence).toBe(50);
    });
  });

  describe('blocklist management', () => {
    it('adds content to blocklist', () => {
      const hash = '0xabc123';
      moderation.addToBlocklist(hash);
      expect(moderation.getBlocklistSize()).toBeGreaterThan(0);
    });
  });
});

// ============ Encryption Service Tests ============

describe('EncryptionService', () => {
  let encryption: EncryptionService;

  beforeAll(() => {
    encryption = new EncryptionService();
  });

  const testPolicy: AccessPolicy = {
    conditions: [
      {
        type: 'address',
        addresses: ['0x1234567890123456789012345678901234567890'],
      },
    ],
    operator: 'or',
  };

  describe('encryption', () => {
    it('generates unique keys', () => {
      const key1 = encryption.generateKey(testPolicy);
      const key2 = encryption.generateKey(testPolicy);

      expect(key1.keyId).not.toBe(key2.keyId);
      expect(key1.key.length).toBe(32); // AES-256
    });

    it('encrypts content', () => {
      const content = Buffer.from('secret data');
      const encrypted = encryption.encrypt(content, testPolicy);

      expect(encrypted.algorithm).toBe('aes-256-gcm');
      expect(encrypted.keyId).toBeDefined();
      expect(encrypted.iv.length).toBe(16);
      expect(encrypted.tag.length).toBe(16);
      expect(encrypted.ciphertext.toString()).not.toBe(content.toString());
    });

    it('decrypts content with valid signature', () => {
      const content = Buffer.from('secret data to decrypt');
      const encrypted = encryption.encrypt(content, testPolicy);

      const authSig = {
        sig: '0x' + '1'.repeat(130) as `0x${string}`,
        message: 'Access request',
        address: '0x1234567890123456789012345678901234567890' as `0x${string}`,
      };

      const decrypted = encryption.decrypt(encrypted, authSig);
      expect(decrypted.toString()).toBe(content.toString());
    });

    it('serializes and deserializes payload', () => {
      const content = Buffer.from('serialization test');
      const encrypted = encryption.encrypt(content, testPolicy);

      const serialized = encryption.serializePayload(encrypted);
      const deserialized = encryption.deserializePayload(serialized);

      expect(deserialized.keyId).toBe(encrypted.keyId);
      expect(deserialized.ciphertext.toString()).toBe(encrypted.ciphertext.toString());
    });
  });

  describe('access control', () => {
    it('checks address condition', async () => {
      const policy: AccessPolicy = {
        conditions: [
          {
            type: 'address',
            addresses: ['0xABCD' as `0x${string}`],
          },
        ],
        operator: 'or',
      };

      const hasAccess = await encryption.checkAccess(policy, '0xABCD' as `0x${string}`);
      expect(hasAccess).toBe(true);

      const noAccess = await encryption.checkAccess(policy, '0x1111' as `0x${string}`);
      expect(noAccess).toBe(false);
    });

    it('checks timestamp condition', async () => {
      const pastPolicy: AccessPolicy = {
        conditions: [
          {
            type: 'timestamp',
            timestamp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
          },
        ],
        operator: 'or',
      };

      const hasAccess = await encryption.checkAccess(pastPolicy, '0x1234' as `0x${string}`);
      expect(hasAccess).toBe(true);

      const futurePolicy: AccessPolicy = {
        conditions: [
          {
            type: 'timestamp',
            timestamp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
          },
        ],
        operator: 'or',
      };

      const noAccess = await encryption.checkAccess(futurePolicy, '0x1234' as `0x${string}`);
      expect(noAccess).toBe(false);
    });
  });
});

// ============ Error Tests ============

describe('Error Types', () => {
  it('creates ContentTooLargeError', () => {
    const error = new ContentTooLargeError(200, 100);
    expect(error.code).toBe('CONTENT_TOO_LARGE');
    expect(error.statusCode).toBe(413);
    expect(error.message).toContain('200');
    expect(error.message).toContain('100');
  });

  it('creates ContentBlockedError', () => {
    const error = new ContentBlockedError('0xabc');
    expect(error.code).toBe('CONTENT_BLOCKED');
    expect(error.statusCode).toBe(403);
  });

  it('creates InvalidInputError', () => {
    const error = new InvalidInputError('filename', 'cannot be empty');
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.statusCode).toBe(400);
  });

  it('isStorageError returns true for StorageError', () => {
    const error = new ContentTooLargeError(100, 50);
    expect(isStorageError(error)).toBe(true);
  });

  it('isStorageError returns false for regular Error', () => {
    const error = new Error('regular error');
    expect(isStorageError(error)).toBe(false);
  });

  it('toStorageError converts Error to StorageError', () => {
    const error = new Error('something went wrong');
    const storageError = toStorageError(error);
    expect(storageError.code).toBe('UNKNOWN_ERROR');
    expect(storageError.message).toBe('something went wrong');
  });

  it('toStorageError returns StorageError unchanged', () => {
    const original = new ContentBlockedError('0xabc');
    const converted = toStorageError(original);
    expect(converted).toBe(original);
  });
});

// ============ Content Tier Tests ============

describe('ContentTier', () => {
  it('has correct numeric values', () => {
    expect(ContentTier.NETWORK_FREE).toBe(0);
    expect(ContentTier.COMMUNITY).toBe(1);
    expect(ContentTier.STANDARD).toBe(2);
    expect(ContentTier.PRIVATE_ENCRYPTED).toBe(3);
    expect(ContentTier.PREMIUM_HOT).toBe(4);
  });

  it('can be used as index', () => {
    const rates = [0, 100, 500, 1000, 2000];
    expect(rates[ContentTier.STANDARD]).toBe(500);
    expect(rates[ContentTier.PREMIUM_HOT]).toBe(2000);
  });
});

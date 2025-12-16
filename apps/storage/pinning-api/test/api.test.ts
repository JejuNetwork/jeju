/**
 * Storage API Tests
 *
 * These tests focus on the moderation and backend logic without requiring
 * native WebTorrent modules (which don't work in Bun runtime).
 */

import { describe, it, expect } from 'bun:test';
import { ContentTier, ContentViolationType } from '../../../../packages/types/src';
import { ContentModerationService } from '../src/moderation';

describe('Content Moderation', () => {
  const moderation = new ContentModerationService({
    enableLocalScanning: true,
    nsfwThreshold: 0.9,
    csamThreshold: 0.95,
    piiThreshold: 0.8,
    blocklistSyncInterval: 300000,
  });

  describe('Text Scanning', () => {
    it('allows safe text content', async () => {
      const content = Buffer.from('This is normal text content');
      const result = await moderation.scan(content, {
        mimeType: 'text/plain',
        filename: 'test.txt',
        size: content.length,
      });

      expect(result.safe).toBe(true);
      expect(result.violationType).toBe(ContentViolationType.NONE);
    });

    it('detects bulk credit card numbers', async () => {
      const content = Buffer.from(
        Array(15)
          .fill('4111111111111111')
          .join('\n')
      );
      const result = await moderation.scan(content, {
        mimeType: 'text/plain',
        filename: 'data.txt',
        size: content.length,
      });

      expect(result.safe).toBe(false);
      expect(result.violationType).toBe(ContentViolationType.ILLEGAL_MATERIAL);
      expect(result.details.sensitiveDataFound).toBe(true);
    });

    it('allows small amounts of sensitive data', async () => {
      const content = Buffer.from(
        'Contact: 4111111111111111\nSSN: 123-45-6789'
      );
      const result = await moderation.scan(content, {
        mimeType: 'text/plain',
        filename: 'contact.txt',
        size: content.length,
      });

      expect(result.safe).toBe(true);
      expect(result.details.sensitiveDataFound).toBe(true);
    });
  });

  describe('Blocklist', () => {
    it('adds and checks blocklist', () => {
      const hash = '0x1234567890abcdef';
      moderation.addToBlocklist(hash);

      expect(moderation.getBlocklistSize()).toBeGreaterThan(0);
    });
  });
});

describe('Content Types', () => {
  it('has correct ContentTier values', () => {
    expect(ContentTier.NETWORK_FREE).toBe(0);
    expect(ContentTier.COMMUNITY).toBe(1);
    expect(ContentTier.STANDARD).toBe(2);
    expect(ContentTier.PRIVATE_ENCRYPTED).toBe(3);
    expect(ContentTier.PREMIUM_HOT).toBe(4);
  });

  it('has correct ContentViolationType values', () => {
    expect(ContentViolationType.NONE).toBe(0);
    expect(ContentViolationType.CSAM).toBe(1);
    expect(ContentViolationType.ILLEGAL_MATERIAL).toBe(2);
    expect(ContentViolationType.COPYRIGHT).toBe(3);
    expect(ContentViolationType.SPAM).toBe(4);
  });
});

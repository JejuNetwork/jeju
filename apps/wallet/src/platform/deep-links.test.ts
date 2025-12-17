/**
 * Deep Links Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { 
  parseDeepLink, 
  buildDeepLink, 
  buildUniversalLink,
  createPaymentRequestLink,
  DeepLinkActions,
} from './deep-links';

describe('Deep Links', () => {
  describe('parseDeepLink', () => {
    it('should parse jeju:// scheme deep links', () => {
      const result = parseDeepLink('jeju://wallet/send?to=0x1234&amount=1.0');
      
      expect(result).not.toBeNull();
      expect(result?.action).toBe('send');
      expect(result?.params.to).toBe('0x1234');
      expect(result?.params.amount).toBe('1.0');
    });

    it('should parse universal links', () => {
      const result = parseDeepLink('https://wallet.jejunetwork.org/swap?token=USDC');
      
      expect(result).not.toBeNull();
      expect(result?.action).toBe('swap');
      expect(result?.params.token).toBe('USDC');
    });

    it('should return null for invalid URLs', () => {
      const result = parseDeepLink('invalid-url');
      expect(result).toBeNull();
    });

    it('should return null for non-jeju URLs', () => {
      const result = parseDeepLink('https://example.com/send');
      expect(result).toBeNull();
    });

    it('should default action to open for root path', () => {
      const result = parseDeepLink('jeju://wallet/');
      
      expect(result).not.toBeNull();
      expect(result?.action).toBe('open');
    });
  });

  describe('buildDeepLink', () => {
    it('should build deep link with action', () => {
      const link = buildDeepLink('send');
      expect(link).toBe('jeju://wallet/send');
    });

    it('should build deep link with params', () => {
      const link = buildDeepLink('send', { to: '0x1234', amount: '1.0' });
      expect(link).toContain('jeju://wallet/send');
      expect(link).toContain('to=0x1234');
      expect(link).toContain('amount=1.0');
    });
  });

  describe('buildUniversalLink', () => {
    it('should build universal link', () => {
      const link = buildUniversalLink('send');
      expect(link).toBe('https://wallet.jejunetwork.org/send');
    });

    it('should build universal link with params', () => {
      const link = buildUniversalLink('send', { to: '0x1234' });
      expect(link).toContain('https://wallet.jejunetwork.org/send');
      expect(link).toContain('to=0x1234');
    });
  });

  describe('createPaymentRequestLink', () => {
    it('should create payment request link', () => {
      const link = createPaymentRequestLink({
        recipient: '0x1234',
        amount: '1.0',
        token: 'ETH',
        chainId: 8453,
        memo: 'test payment',
      });

      expect(link).toContain('https://wallet.jejunetwork.org/send');
      expect(link).toContain('to=0x1234');
      expect(link).toContain('amount=1.0');
      expect(link).toContain('token=ETH');
      expect(link).toContain('chainId=8453');
      expect(link).toContain('memo=test');
    });

    it('should only include required params', () => {
      const link = createPaymentRequestLink({
        recipient: '0x1234',
      });

      expect(link).toContain('to=0x1234');
      expect(link).not.toContain('amount=');
      expect(link).not.toContain('token=');
    });
  });

  describe('DeepLinkActions', () => {
    it('should have all action types', () => {
      expect(DeepLinkActions.SEND).toBe('send');
      expect(DeepLinkActions.RECEIVE).toBe('receive');
      expect(DeepLinkActions.SWAP).toBe('swap');
      expect(DeepLinkActions.CONNECT).toBe('connect');
      expect(DeepLinkActions.SIGN).toBe('sign');
      expect(DeepLinkActions.IMPORT).toBe('import');
    });
  });
});


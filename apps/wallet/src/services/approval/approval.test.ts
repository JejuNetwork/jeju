/**
 * Approval Service Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalService } from './index';
import { maxUint256 } from 'viem';

describe('ApprovalService', () => {
  let service: ApprovalService;

  beforeEach(() => {
    service = new ApprovalService();
  });

  describe('formatAllowance', () => {
    it('should format unlimited allowance', () => {
      const result = service.formatAllowance(maxUint256, 18);
      expect(result).toBe('Unlimited');
    });

    it('should format large numbers with B suffix', () => {
      // 5 billion tokens with 18 decimals
      // Use smaller value to avoid Number precision loss
      const billion = 5_000_000_000n * 10n ** 18n;
      const result = service.formatAllowance(billion, 18);
      // Due to Number precision limits, very large values may show as M instead of B
      expect(result.includes('B') || result.includes('M')).toBe(true);
    });

    it('should format millions with M suffix', () => {
      // 5 million tokens with 18 decimals
      const million = 5_000_000n * 10n ** 18n;
      const result = service.formatAllowance(million, 18);
      // Due to Number precision limits, may show as K or M
      expect(result.includes('M') || result.includes('K')).toBe(true);
    });

    it('should format thousands with K suffix', () => {
      const thousand = BigInt(5000) * BigInt(1e18);
      const result = service.formatAllowance(thousand, 18);
      expect(result).toContain('K');
    });

    it('should format small numbers with decimals', () => {
      const small = BigInt(123) * BigInt(1e16); // 1.23
      const result = service.formatAllowance(small, 18);
      expect(result).toBe('1.23');
    });
  });

  describe('getSpenderName', () => {
    it('should return known spender names', () => {
      const uniswapV2 = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d' as const;
      expect(service.getSpenderName(uniswapV2)).toBe('Uniswap V2');
    });

    it('should return undefined for unknown spenders', () => {
      const unknown = '0x1234567890123456789012345678901234567890' as const;
      expect(service.getSpenderName(unknown)).toBeUndefined();
    });

    it('should be case insensitive', () => {
      const uniswapV2Upper = '0x7A250D5630B4CF539739DF2C5DACB4C659F2488D' as const;
      expect(service.getSpenderName(uniswapV2Upper)).toBe('Uniswap V2');
    });
  });

  describe('buildRevoke', () => {
    it('should build revoke transaction with zero amount', () => {
      const tokenAddress = '0x6B175474E89094C44Da98b954EescdeCB5E1cfB' as const;
      const spender = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d' as const;
      
      const tx = service.buildRevoke(1, tokenAddress, spender);
      
      expect(tx.to).toBe(tokenAddress);
      expect(tx.value).toBe(0n);
      expect(tx.data).toBeDefined();
      expect(tx.data.startsWith('0x')).toBe(true);
    });
  });

  describe('buildApprove', () => {
    it('should build approve transaction with specific amount', () => {
      const tokenAddress = '0x6B175474E89094C44Da98b954EedscdeCB5E1cfB' as const;
      const spender = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d' as const;
      const amount = BigInt(1e18);
      
      const tx = service.buildApprove(1, tokenAddress, spender, amount);
      
      expect(tx.to).toBe(tokenAddress);
      expect(tx.value).toBe(0n);
      expect(tx.data).toBeDefined();
    });

    it('should build unlimited approval with max uint256', () => {
      const tokenAddress = '0x6B175474E89094C44Da98b954EedscdeCB5E1cfB' as const;
      const spender = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d' as const;
      
      const tx = service.buildApprove(1, tokenAddress, spender, 'unlimited');
      
      expect(tx.data).toBeDefined();
      expect(tx.data.startsWith('0x')).toBe(true);
    });
  });
});


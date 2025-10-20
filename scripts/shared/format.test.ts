/**
 * @fileoverview Tests for formatting utilities
 * @module scripts/shared/format.test
 */

import { describe, it, expect } from 'bun:test';
import {
  formatBytes,
  formatNumber,
  formatTimestamp,
  formatDuration,
  formatPercent,
  formatAddress,
  formatUSD,
  formatETH,
  formatGas,
  formatGasPrice,
} from './format';

describe('Formatting Utilities', () => {
  describe('formatBytes', () => {
    it('should format bytes', () => {
      expect(formatBytes(512)).toBe('512 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.00 KB');
      expect(formatBytes(1536)).toBe('1.50 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
      expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
    });

    it('should handle zero', () => {
      expect(formatBytes(0)).toBe('0 B');
    });
  });

  describe('formatNumber', () => {
    it('should format with K/M/B suffixes', () => {
      expect(formatNumber(1000)).toBe('1.0K');
      expect(formatNumber(1000000)).toBe('1.0M');
      expect(formatNumber(1234567890)).toBe('1.2B');
    });

    it('should handle small numbers', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(42)).toBe('42');
      expect(formatNumber(999)).toBe('999');
    });

    it('should format large numbers with suffix', () => {
      expect(formatNumber(1500)).toBe('1.5K');
      expect(formatNumber(2500000)).toBe('2.5M');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(30)).toBe('30s');
      expect(formatDuration(59)).toBe('59s');
    });

    it('should format minutes', () => {
      expect(formatDuration(60)).toBe('1m 0s');
      expect(formatDuration(90)).toBe('1m 30s');
      expect(formatDuration(125)).toBe('2m 5s');
    });

    it('should format hours', () => {
      expect(formatDuration(3600)).toBe('1h 0m');
      expect(formatDuration(3665)).toBe('1h 1m');
      expect(formatDuration(7200)).toBe('2h 0m');
    });

    it('should format days', () => {
      expect(formatDuration(86400)).toBe('1d 0h');
      expect(formatDuration(90000)).toBe('1d 1h');
    });

    it('should handle zero', () => {
      expect(formatDuration(0)).toBe('0s');
    });
  });

  describe('formatPercent', () => {
    it('should format percentages with default decimals', () => {
      expect(formatPercent(0.5)).toBe('50.00%');
      expect(formatPercent(0.7534)).toBe('75.34%');
      expect(formatPercent(1.0)).toBe('100.00%');
    });

    it('should respect custom decimal places', () => {
      expect(formatPercent(0.12345, 0)).toBe('12%');
      expect(formatPercent(0.12345, 1)).toBe('12.3%');
      expect(formatPercent(0.12345, 3)).toBe('12.345%');
    });

    it('should handle edge cases', () => {
      expect(formatPercent(0)).toBe('0.00%');
      expect(formatPercent(2.5)).toBe('250.00%');
    });
  });

  describe('formatAddress', () => {
    const testAddress = '0x1234567890123456789012345678901234567890';

    it('should shorten addresses with default length', () => {
      const formatted = formatAddress(testAddress);
      expect(formatted).toBe('0x1234...7890');
    });

    it('should support custom start length', () => {
      const formatted = formatAddress(testAddress, 10, 4);
      expect(formatted).toBe('0x12345678...7890');
    });

    it('should support custom end length', () => {
      const formatted = formatAddress(testAddress, 6, 8);
      expect(formatted).toBe('0x1234...34567890');
    });

    it('should handle short addresses gracefully', () => {
      const short = '0x123456';
      const formatted = formatAddress(short);
      // Should not break on short addresses
      expect(formatted).toBeTruthy();
    });
  });

  describe('formatUSD', () => {
    it('should format USD amounts', () => {
      expect(formatUSD(100)).toBe('$100.00');
      expect(formatUSD(1234.56)).toBe('$1234.56');
      expect(formatUSD(1000000)).toBe('$1000000.00');
    });

    it('should support custom decimals', () => {
      expect(formatUSD(1234.5678, 0)).toBe('$1235');
      expect(formatUSD(1234.5678, 4)).toBe('$1234.5678');
    });

    it('should handle negative amounts', () => {
      expect(formatUSD(-100)).toBe('$-100.00');
    });
  });

  describe('formatETH', () => {
    it('should format wei to ETH', () => {
      expect(formatETH('1000000000000000000')).toBe('1.0000 ETH');
      expect(formatETH('500000000000000000')).toBe('0.5000 ETH');
    });

    it('should handle bigint', () => {
      expect(formatETH(BigInt('1000000000000000000'))).toBe('1.0000 ETH');
    });

    it('should support custom decimals', () => {
      expect(formatETH('1234567890000000000', 2)).toBe('1.23 ETH');
      expect(formatETH('1234567890000000000', 6)).toBe('1.234568 ETH');
    });

    it('should handle zero', () => {
      expect(formatETH('0')).toBe('0.0000 ETH');
    });
  });

  describe('formatGas', () => {
    it('should format gas amounts', () => {
      expect(formatGas(21000)).toBe('21.0K gas');
      expect(formatGas(150000)).toBe('150.0K gas');
      expect(formatGas(1000000)).toBe('1.0M gas');
    });
  });

  describe('formatGasPrice', () => {
    it('should format gas prices in gwei', () => {
      expect(formatGasPrice(1)).toBe('1.00 gwei');
      expect(formatGasPrice(25.5)).toBe('25.50 gwei');
      expect(formatGasPrice(100)).toBe('100.00 gwei');
    });
  });

  describe('Real-world examples', () => {
    it('should format deployment gas report', () => {
      const gas = formatGas(3456789);
      const gasPrice = formatGasPrice(0.001);
      const cost = formatETH('3456789000000000'); // gas * gasPrice
      
      console.log(`\n   Gas Used: ${gas}`);
      console.log(`   Gas Price: ${gasPrice}`);
      console.log(`   Total Cost: ${cost}\n`);
      
      expect(gas).toBeTruthy();
      expect(gasPrice).toBeTruthy();
      expect(cost).toBeTruthy();
    });

    it('should format oracle price update', () => {
      const ethPrice = formatUSD(3245.67);
      const elizaPrice = formatUSD(0.0842);
      const timestamp = formatTimestamp(Date.now() / 1000);
      
      console.log(`\n   ETH: ${ethPrice}`);
      console.log(`   elizaOS: ${elizaPrice}`);
      console.log(`   Updated: ${timestamp}\n`);
      
      expect(ethPrice).toBe('$3245.67');
      expect(elizaPrice).toBe('$0.08');
    });

    it('should format node operator stats', () => {
      const uptime = formatPercent(0.9954, 2);
      const requests = formatNumber(1534892);
      const rewards = formatETH('240000000000000000000'); // 240 JEJU
      
      console.log(`\n   Uptime: ${uptime}`);
      console.log(`   Requests: ${requests}`);
      console.log(`   Rewards: ${rewards}\n`);
      
      expect(uptime).toBe('99.54%');
      expect(requests).toBe('1.5M');
    });
  });
});


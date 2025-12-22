/**
 * Utility Functions Unit Tests
 * 
 * Tests for parsePort, parseTimeout, and parseBoolean with edge cases,
 * boundary conditions, and property-based testing patterns.
 */

import { describe, it, expect } from 'bun:test';
import { parsePort, parseTimeout, parseBoolean } from './utils.js';

describe('parsePort', () => {
  describe('valid ports', () => {
    it('should return default when envValue is undefined', () => {
      expect(parsePort(undefined, 3000)).toBe(3000);
    });

    it('should return default when envValue is empty string', () => {
      expect(parsePort('', 3000)).toBe(3000);
    });

    it('should parse valid port number', () => {
      expect(parsePort('8080', 3000)).toBe(8080);
    });

    it('should parse minimum valid port (1)', () => {
      expect(parsePort('1', 3000)).toBe(1);
    });

    it('should parse maximum valid port (65535)', () => {
      expect(parsePort('65535', 3000)).toBe(65535);
    });

    it('should parse common ports', () => {
      expect(parsePort('80', 3000)).toBe(80);
      expect(parsePort('443', 3000)).toBe(443);
      expect(parsePort('3000', 8080)).toBe(3000);
      expect(parsePort('4000', 3000)).toBe(4000);
      expect(parsePort('8545', 3000)).toBe(8545);
    });

    it('should parse port with leading zeros', () => {
      // parseInt handles leading zeros
      expect(parsePort('0080', 3000)).toBe(80);
      expect(parsePort('00443', 3000)).toBe(443);
    });
  });

  describe('invalid ports', () => {
    it('should throw for port 0', () => {
      expect(() => parsePort('0', 3000)).toThrow();
    });

    it('should throw for negative port', () => {
      expect(() => parsePort('-1', 3000)).toThrow();
      expect(() => parsePort('-100', 3000)).toThrow();
    });

    it('should throw for port above 65535', () => {
      expect(() => parsePort('65536', 3000)).toThrow();
      expect(() => parsePort('70000', 3000)).toThrow();
      expect(() => parsePort('100000', 3000)).toThrow();
    });

    it('should truncate decimal port values (parseInt behavior)', () => {
      // parseInt truncates decimals, so 8080.5 becomes 8080
      expect(parsePort('8080.5', 3000)).toBe(8080);
      expect(parsePort('3000.999', 8080)).toBe(3000);
    });

    it('should throw for NaN input', () => {
      expect(() => parsePort('abc', 3000)).toThrow();
      expect(() => parsePort('not-a-number', 3000)).toThrow();
      expect(() => parsePort('port8080', 3000)).toThrow();
    });

    it('should throw for whitespace-only input', () => {
      // parseInt returns NaN for whitespace
      expect(() => parsePort('   ', 3000)).toThrow();
    });
  });

  describe('boundary testing (property-based patterns)', () => {
    it('should accept all ports from 1 to 100', () => {
      for (let port = 1; port <= 100; port++) {
        expect(parsePort(String(port), 0)).toBe(port);
      }
    });

    it('should accept ports near upper boundary', () => {
      for (let port = 65500; port <= 65535; port++) {
        expect(parsePort(String(port), 0)).toBe(port);
      }
    });

    it('should reject ports just above upper boundary', () => {
      for (let port = 65536; port <= 65550; port++) {
        expect(() => parsePort(String(port), 0)).toThrow();
      }
    });
  });
});

describe('parseTimeout', () => {
  describe('valid timeouts', () => {
    it('should return default when envValue is undefined', () => {
      expect(parseTimeout(undefined, 30000)).toBe(30000);
    });

    it('should return default when envValue is empty string', () => {
      expect(parseTimeout('', 30000)).toBe(30000);
    });

    it('should parse valid timeout', () => {
      expect(parseTimeout('5000', 30000)).toBe(5000);
    });

    it('should parse minimum valid timeout (1)', () => {
      expect(parseTimeout('1', 30000)).toBe(1);
    });

    it('should parse large timeouts', () => {
      expect(parseTimeout('60000', 30000)).toBe(60000);
      expect(parseTimeout('300000', 30000)).toBe(300000);
      expect(parseTimeout('1000000', 30000)).toBe(1000000);
    });

    it('should parse common timeout values', () => {
      expect(parseTimeout('1000', 5000)).toBe(1000);  // 1 second
      expect(parseTimeout('5000', 30000)).toBe(5000);  // 5 seconds
      expect(parseTimeout('10000', 30000)).toBe(10000);  // 10 seconds
      expect(parseTimeout('30000', 60000)).toBe(30000);  // 30 seconds
    });
  });

  describe('invalid timeouts', () => {
    it('should throw for zero timeout', () => {
      expect(() => parseTimeout('0', 30000)).toThrow();
    });

    it('should throw for negative timeout', () => {
      expect(() => parseTimeout('-1', 30000)).toThrow();
      expect(() => parseTimeout('-5000', 30000)).toThrow();
    });

    it('should truncate decimal timeout values (parseInt behavior)', () => {
      // parseInt truncates decimals, so 5000.5 becomes 5000
      expect(parseTimeout('5000.5', 30000)).toBe(5000);
      expect(parseTimeout('1000.001', 30000)).toBe(1000);
    });

    it('should throw for NaN input', () => {
      expect(() => parseTimeout('abc', 30000)).toThrow();
      expect(() => parseTimeout('timeout', 30000)).toThrow();
    });
  });

  describe('boundary testing (property-based patterns)', () => {
    it('should accept timeouts from 1 to 100', () => {
      for (let timeout = 1; timeout <= 100; timeout++) {
        expect(parseTimeout(String(timeout), 0)).toBe(timeout);
      }
    });

    it('should accept large timeouts', () => {
      const largeTimeouts = [100000, 500000, 1000000, 5000000, 10000000];
      for (const timeout of largeTimeouts) {
        expect(parseTimeout(String(timeout), 0)).toBe(timeout);
      }
    });
  });
});

describe('parseBoolean', () => {
  describe('truthy values', () => {
    it('should return true for "true"', () => {
      expect(parseBoolean('true', false)).toBe(true);
    });

    it('should return true for "1"', () => {
      expect(parseBoolean('1', false)).toBe(true);
    });

    it('should return true with default true', () => {
      expect(parseBoolean('true', true)).toBe(true);
      expect(parseBoolean('1', true)).toBe(true);
    });
  });

  describe('falsy values', () => {
    it('should return false for "false"', () => {
      expect(parseBoolean('false', true)).toBe(false);
    });

    it('should return false for "0"', () => {
      expect(parseBoolean('0', true)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(parseBoolean('', true)).toBe(false);
    });

    it('should return false for any other string', () => {
      expect(parseBoolean('yes', true)).toBe(false);
      expect(parseBoolean('no', true)).toBe(false);
      expect(parseBoolean('True', true)).toBe(false);  // Case sensitive
      expect(parseBoolean('TRUE', true)).toBe(false);
      expect(parseBoolean('False', true)).toBe(false);
    });
  });

  describe('undefined handling', () => {
    it('should return default when undefined', () => {
      expect(parseBoolean(undefined, true)).toBe(true);
      expect(parseBoolean(undefined, false)).toBe(false);
    });
  });

  describe('exhaustive value testing', () => {
    const trueValues = ['true', '1'];
    const falseValues = ['false', '0', '', 'yes', 'no', 'True', 'FALSE', 'TRUE', 'on', 'off', 'enabled', 'disabled'];

    it('should only accept "true" and "1" as truthy', () => {
      for (const val of trueValues) {
        expect(parseBoolean(val, false)).toBe(true);
      }
    });

    it('should treat all other values as falsy', () => {
      for (const val of falseValues) {
        expect(parseBoolean(val, false)).toBe(false);
      }
    });
  });
});

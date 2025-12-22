/**
 * Otto Parsing Utilities Tests
 * Tests natural language parsing for trading commands
 */

import { describe, expect, test } from 'bun:test';
import {
  parseSwapParams,
  parseBridgeParams,
  parseLimitOrderParams,
  validateSwapParams,
  validateBridgeParams,
  validateLimitOrderParams,
} from '../utils/parsing';

describe('parseSwapParams', () => {
  describe('standard swap patterns', () => {
    test('parses "swap X TOKEN to TOKEN"', () => {
      const result = parseSwapParams('swap 1 ETH to USDC');
      expect(result.amount).toBe('1');
      expect(result.from).toBe('ETH');
      expect(result.to).toBe('USDC');
    });

    test('parses "swap X TOKEN for TOKEN"', () => {
      const result = parseSwapParams('swap 100 USDC for ETH');
      expect(result.amount).toBe('100');
      expect(result.from).toBe('USDC');
      expect(result.to).toBe('ETH');
    });

    test('parses "exchange X TOKEN into TOKEN"', () => {
      const result = parseSwapParams('exchange 50 DAI into USDC');
      expect(result.amount).toBe('50');
      expect(result.from).toBe('DAI');
      expect(result.to).toBe('USDC');
    });

    test('parses decimal amounts', () => {
      const result = parseSwapParams('swap 0.5 ETH to USDC');
      expect(result.amount).toBe('0.5');
      expect(result.from).toBe('ETH');
      expect(result.to).toBe('USDC');
    });

    test('parses large amounts', () => {
      const result = parseSwapParams('swap 1000000 USDC to ETH');
      expect(result.amount).toBe('1000000');
      expect(result.from).toBe('USDC');
      expect(result.to).toBe('ETH');
    });
  });

  describe('chain specification', () => {
    test('extracts chain from "on base"', () => {
      const result = parseSwapParams('swap 1 ETH to USDC on base');
      expect(result.chain).toBe('base');
    });

    test('extracts chain from "on ethereum"', () => {
      const result = parseSwapParams('swap 1 ETH to USDC on ethereum');
      expect(result.chain).toBe('ethereum');
    });

    test('extracts chain from "on optimism"', () => {
      const result = parseSwapParams('swap 100 USDC to ETH on optimism');
      expect(result.chain).toBe('optimism');
    });

    test('handles missing chain gracefully', () => {
      const result = parseSwapParams('swap 1 ETH to USDC');
      expect(result.chain).toBeUndefined();
    });
  });

  describe('token case handling', () => {
    test('normalizes lowercase tokens to uppercase', () => {
      const result = parseSwapParams('swap 1 eth to usdc');
      expect(result.from).toBe('ETH');
      expect(result.to).toBe('USDC');
    });

    test('normalizes mixed case tokens', () => {
      const result = parseSwapParams('swap 1 Eth to Usdc');
      expect(result.from).toBe('ETH');
      expect(result.to).toBe('USDC');
    });
  });

  describe('edge cases', () => {
    test('returns empty object for invalid input', () => {
      const result = parseSwapParams('hello world');
      expect(result.amount).toBeUndefined();
      expect(result.from).toBeUndefined();
      expect(result.to).toBeUndefined();
    });

    test('returns empty object for empty string', () => {
      const result = parseSwapParams('');
      expect(result.amount).toBeUndefined();
    });

    test('handles string with only whitespace', () => {
      const result = parseSwapParams('   ');
      expect(result.amount).toBeUndefined();
    });
  });
});

describe('parseBridgeParams', () => {
  describe('standard bridge patterns', () => {
    test('parses "bridge X TOKEN from CHAIN to CHAIN"', () => {
      const result = parseBridgeParams('bridge 1 ETH from ethereum to base');
      expect(result.amount).toBe('1');
      expect(result.token).toBe('ETH');
      expect(result.fromChain).toBe('ethereum');
      expect(result.toChain).toBe('base');
    });

    test('parses decimal amounts', () => {
      const result = parseBridgeParams('bridge 0.5 ETH from base to optimism');
      expect(result.amount).toBe('0.5');
      expect(result.token).toBe('ETH');
    });

    test('parses large amounts', () => {
      const result = parseBridgeParams('bridge 10000 USDC from ethereum to arbitrum');
      expect(result.amount).toBe('10000');
      expect(result.token).toBe('USDC');
      expect(result.fromChain).toBe('ethereum');
      expect(result.toChain).toBe('arbitrum');
    });
  });

  describe('chain handling', () => {
    test('normalizes chain names to lowercase', () => {
      const result = parseBridgeParams('bridge 1 ETH from Ethereum to Base');
      expect(result.fromChain).toBe('ethereum');
      expect(result.toChain).toBe('base');
    });

    test('handles short chain names', () => {
      const result = parseBridgeParams('bridge 1 ETH from eth to op');
      expect(result.fromChain).toBe('eth');
      expect(result.toChain).toBe('op');
    });
  });

  describe('token handling', () => {
    test('normalizes token to uppercase', () => {
      const result = parseBridgeParams('bridge 1 eth from ethereum to base');
      expect(result.token).toBe('ETH');
    });
  });

  describe('edge cases', () => {
    test('returns empty object for invalid input', () => {
      const result = parseBridgeParams('hello world');
      expect(result.amount).toBeUndefined();
      expect(result.token).toBeUndefined();
    });

    test('returns empty object for partial match', () => {
      const result = parseBridgeParams('bridge 1 ETH from ethereum');
      expect(result.toChain).toBeUndefined();
    });

    test('returns empty object for empty string', () => {
      const result = parseBridgeParams('');
      expect(result.amount).toBeUndefined();
    });
  });
});

describe('parseLimitOrderParams', () => {
  describe('standard limit order patterns', () => {
    test('parses "limit X TOKEN at PRICE TOKEN"', () => {
      const result = parseLimitOrderParams('limit 1 ETH at 4000 USDC');
      expect(result.amount).toBe('1');
      expect(result.from).toBe('ETH');
      expect(result.price).toBe('4000');
      expect(result.to).toBe('USDC');
    });

    test('parses decimal amounts', () => {
      const result = parseLimitOrderParams('limit 0.5 ETH at 3500 USDC');
      expect(result.amount).toBe('0.5');
      expect(result.price).toBe('3500');
    });

    test('parses decimal prices', () => {
      const result = parseLimitOrderParams('limit 100 USDC at 0.0005 ETH');
      expect(result.amount).toBe('100');
      expect(result.from).toBe('USDC');
      expect(result.price).toBe('0.0005');
      expect(result.to).toBe('ETH');
    });
  });

  describe('token handling', () => {
    test('normalizes tokens to uppercase', () => {
      const result = parseLimitOrderParams('limit 1 eth at 4000 usdc');
      expect(result.from).toBe('ETH');
      expect(result.to).toBe('USDC');
    });
  });

  describe('edge cases', () => {
    test('returns empty object for invalid input', () => {
      const result = parseLimitOrderParams('hello world');
      expect(result.amount).toBeUndefined();
    });

    test('returns empty object for empty string', () => {
      const result = parseLimitOrderParams('');
      expect(result.amount).toBeUndefined();
    });

    test('returns empty object for partial match', () => {
      const result = parseLimitOrderParams('limit 1 ETH at');
      expect(result.price).toBeUndefined();
    });
  });
});

describe('validateSwapParams', () => {
  describe('valid params', () => {
    test('accepts valid swap params', () => {
      const result = validateSwapParams({
        amount: '1',
        from: 'ETH',
        to: 'USDC',
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('accepts valid swap params with chain', () => {
      const result = validateSwapParams({
        amount: '100.5',
        from: 'USDC',
        to: 'ETH',
        chain: 'base',
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid params', () => {
    test('rejects missing amount', () => {
      const result = validateSwapParams({
        from: 'ETH',
        to: 'USDC',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('amount');
    });

    test('rejects missing from token', () => {
      const result = validateSwapParams({
        amount: '1',
        to: 'USDC',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('from');
    });

    test('rejects missing to token', () => {
      const result = validateSwapParams({
        amount: '1',
        from: 'ETH',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('to');
    });

    test('rejects invalid amount format', () => {
      const result = validateSwapParams({
        amount: 'abc',
        from: 'ETH',
        to: 'USDC',
      });
      expect(result.valid).toBe(false);
    });

    test('rejects negative amount', () => {
      const result = validateSwapParams({
        amount: '-1',
        from: 'ETH',
        to: 'USDC',
      });
      expect(result.valid).toBe(false);
    });
  });
});

describe('validateBridgeParams', () => {
  describe('valid params', () => {
    test('accepts valid bridge params', () => {
      const result = validateBridgeParams({
        amount: '1',
        token: 'ETH',
        fromChain: 'ethereum',
        toChain: 'base',
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('accepts decimal amounts', () => {
      const result = validateBridgeParams({
        amount: '0.5',
        token: 'ETH',
        fromChain: 'base',
        toChain: 'optimism',
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid params', () => {
    test('rejects missing amount', () => {
      const result = validateBridgeParams({
        token: 'ETH',
        fromChain: 'ethereum',
        toChain: 'base',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('amount');
    });

    test('rejects missing token', () => {
      const result = validateBridgeParams({
        amount: '1',
        fromChain: 'ethereum',
        toChain: 'base',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('token');
    });

    test('rejects missing fromChain', () => {
      const result = validateBridgeParams({
        amount: '1',
        token: 'ETH',
        toChain: 'base',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('from chain');
    });

    test('rejects missing toChain', () => {
      const result = validateBridgeParams({
        amount: '1',
        token: 'ETH',
        fromChain: 'ethereum',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('to chain');
    });

    test('rejects invalid amount format', () => {
      const result = validateBridgeParams({
        amount: 'not-a-number',
        token: 'ETH',
        fromChain: 'ethereum',
        toChain: 'base',
      });
      expect(result.valid).toBe(false);
    });
  });
});

describe('validateLimitOrderParams', () => {
  describe('valid params', () => {
    test('accepts valid limit order params', () => {
      const result = validateLimitOrderParams({
        amount: '1',
        from: 'ETH',
        to: 'USDC',
        price: '4000',
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('accepts decimal amounts and prices', () => {
      const result = validateLimitOrderParams({
        amount: '0.5',
        from: 'ETH',
        to: 'USDC',
        price: '3500.50',
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid params', () => {
    test('rejects missing amount', () => {
      const result = validateLimitOrderParams({
        from: 'ETH',
        to: 'USDC',
        price: '4000',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('amount');
    });

    test('rejects missing from token', () => {
      const result = validateLimitOrderParams({
        amount: '1',
        to: 'USDC',
        price: '4000',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('from');
    });

    test('rejects missing to token', () => {
      const result = validateLimitOrderParams({
        amount: '1',
        from: 'ETH',
        price: '4000',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('to');
    });

    test('rejects missing price', () => {
      const result = validateLimitOrderParams({
        amount: '1',
        from: 'ETH',
        to: 'USDC',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('price');
    });

    test('rejects invalid price format', () => {
      const result = validateLimitOrderParams({
        amount: '1',
        from: 'ETH',
        to: 'USDC',
        price: 'expensive',
      });
      expect(result.valid).toBe(false);
    });
  });
});

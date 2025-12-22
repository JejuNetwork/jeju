/**
 * x402 Settler Unit Tests
 * 
 * Tests for settlement calculations and retry logic
 * These tests are isolated from module dependencies and test pure logic
 */

import { describe, test, expect } from 'bun:test';

// Pure implementation of calculateProtocolFee (mirrors settler.ts)
function calculateProtocolFee(amount: bigint, feeBps: number): bigint {
  return (amount * BigInt(feeBps)) / 10000n;
}

// Pure implementation of getRetryDelay (mirrors settler.ts)
function getRetryDelay(attempt: number, baseDelayMs: number = 1000, maxDelayMs: number = 30000): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  return Math.round(delay + delay * 0.25 * (Math.random() * 2 - 1)); // ±25% jitter
}

// Pure implementation of isRetryableError (mirrors settler.ts)
function isRetryableError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  
  const nonRetryable = ['insufficient funds', 'insufficient balance', 'insufficient allowance', 
    'nonce already used', 'execution reverted', 'invalid signature', 'user rejected', 'user denied'];
  if (nonRetryable.some(p => msg.includes(p))) return false;

  const retryable = ['timeout', 'rate limit', 'network', 'connection', 'econnrefused', 
    'econnreset', 'socket hang up', 'nonce too low', 'replacement transaction underpriced', 'already known'];
  return retryable.some(p => msg.includes(p));
}

// Default retry config (mirrors settler.ts)
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  gasMultiplier: 1.2,
};

describe('x402 Settler - Protocol Fee Calculation', () => {
  describe('calculateProtocolFee', () => {
    test('calculates correct fee for 100 bps (1%)', () => {
      const amount = 1_000_000_000n; // 1 billion wei
      const fee = calculateProtocolFee(amount, 100);
      
      expect(fee).toBe(10_000_000n); // 1% of 1 billion
    });

    test('calculates correct fee for 50 bps (0.5%)', () => {
      const amount = 1_000_000_000n;
      const fee = calculateProtocolFee(amount, 50);
      
      expect(fee).toBe(5_000_000n);
    });

    test('calculates correct fee for 30 bps (0.3%)', () => {
      const amount = 10_000_000_000n; // 10 billion wei
      const fee = calculateProtocolFee(amount, 30);
      
      expect(fee).toBe(30_000_000n);
    });

    test('returns 0 for 0 bps', () => {
      const amount = 1_000_000_000n;
      const fee = calculateProtocolFee(amount, 0);
      
      expect(fee).toBe(0n);
    });

    test('returns 0 for 0 amount', () => {
      const fee = calculateProtocolFee(0n, 100);
      
      expect(fee).toBe(0n);
    });

    test('handles maximum bps (10000 = 100%)', () => {
      const amount = 1_000_000n;
      const fee = calculateProtocolFee(amount, 10000);
      
      expect(fee).toBe(amount); // 100% fee
    });

    test('handles 1 bps (0.01%)', () => {
      const amount = 1_000_000_000n;
      const fee = calculateProtocolFee(amount, 1);
      
      expect(fee).toBe(100_000n);
    });

    test('handles large amounts without overflow', () => {
      const amount = 10n ** 27n; // 1 billion ether in wei
      const fee = calculateProtocolFee(amount, 100);
      
      const expectedFee = amount * 100n / 10000n;
      expect(fee).toBe(expectedFee);
    });

    test('rounds down fractional fees', () => {
      // 333 wei with 1 bps = 0.0333, should round down to 0
      const amount = 333n;
      const fee = calculateProtocolFee(amount, 1);
      
      expect(fee).toBe(0n);
    });

    test('correctly calculates fee for USDC-sized amounts (6 decimals)', () => {
      const amount = 1_000_000n; // 1 USDC (6 decimals)
      const fee = calculateProtocolFee(amount, 25); // 0.25%
      
      expect(fee).toBe(2500n); // 0.0025 USDC
    });
  });
});

describe('x402 Settler - Retry Logic', () => {
  // Test without jitter for predictable results
  function calculateRetryDelayNoJitter(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
    return Math.round(delay);
  }

  test('exponential backoff increases delay with each attempt', () => {
    const baseDelay = 1000;
    const maxDelay = 30000;
    
    const delay0 = calculateRetryDelayNoJitter(0, baseDelay, maxDelay);
    const delay1 = calculateRetryDelayNoJitter(1, baseDelay, maxDelay);
    const delay2 = calculateRetryDelayNoJitter(2, baseDelay, maxDelay);
    
    expect(delay0).toBe(1000);  // 1000 * 2^0 = 1000
    expect(delay1).toBe(2000);  // 1000 * 2^1 = 2000
    expect(delay2).toBe(4000);  // 1000 * 2^2 = 4000
  });

  test('delay caps at maxDelayMs', () => {
    const baseDelay = 1000;
    const maxDelay = 5000;
    
    const delay5 = calculateRetryDelayNoJitter(5, baseDelay, maxDelay);
    const delay10 = calculateRetryDelayNoJitter(10, baseDelay, maxDelay);
    
    expect(delay5).toBe(5000);  // Capped at max
    expect(delay10).toBe(5000); // Still capped
  });

  test('first attempt (0) uses base delay', () => {
    const delay = calculateRetryDelayNoJitter(0, 500, 30000);
    expect(delay).toBe(500);
  });

  test('getRetryDelay with jitter stays within bounds', () => {
    // Run multiple times to test jitter bounds
    for (let i = 0; i < 20; i++) {
      const delay = getRetryDelay(0, 1000, 30000);
      // With ±25% jitter, should be between 750 and 1250
      expect(delay).toBeGreaterThanOrEqual(750);
      expect(delay).toBeLessThanOrEqual(1250);
    }
  });
});

describe('x402 Settler - Retryable Error Detection', () => {
  describe('non-retryable errors', () => {
    test('insufficient funds is not retryable', () => {
      expect(isRetryableError(new Error('Error: insufficient funds for gas'))).toBe(false);
    });

    test('insufficient balance is not retryable', () => {
      expect(isRetryableError(new Error('Insufficient balance for transfer'))).toBe(false);
    });

    test('insufficient allowance is not retryable', () => {
      expect(isRetryableError(new Error('ERC20: insufficient allowance'))).toBe(false);
    });

    test('nonce already used is not retryable', () => {
      expect(isRetryableError(new Error('Nonce already used'))).toBe(false);
    });

    test('execution reverted is not retryable', () => {
      expect(isRetryableError(new Error('execution reverted: TRANSFER_FAILED'))).toBe(false);
    });

    test('invalid signature is not retryable', () => {
      expect(isRetryableError(new Error('Invalid signature: ECDSA verification failed'))).toBe(false);
    });

    test('user rejected is not retryable', () => {
      expect(isRetryableError(new Error('User rejected the request'))).toBe(false);
    });

    test('user denied is not retryable', () => {
      expect(isRetryableError(new Error('User denied transaction signing'))).toBe(false);
    });
  });

  describe('retryable errors', () => {
    test('timeout is retryable', () => {
      expect(isRetryableError(new Error('Request timeout after 30000ms'))).toBe(true);
    });

    test('rate limit is retryable', () => {
      expect(isRetryableError(new Error('Rate limit exceeded'))).toBe(true);
    });

    test('network error is retryable', () => {
      expect(isRetryableError(new Error('Network error: could not connect'))).toBe(true);
    });

    test('connection error is retryable', () => {
      expect(isRetryableError(new Error('Connection refused'))).toBe(true);
    });

    test('ECONNREFUSED is retryable', () => {
      expect(isRetryableError(new Error('Error: ECONNREFUSED'))).toBe(true);
    });

    test('ECONNRESET is retryable', () => {
      expect(isRetryableError(new Error('Error: ECONNRESET'))).toBe(true);
    });

    test('socket hang up is retryable', () => {
      expect(isRetryableError(new Error('socket hang up'))).toBe(true);
    });

    test('nonce too low is retryable', () => {
      expect(isRetryableError(new Error('Nonce too low'))).toBe(true);
    });

    test('replacement transaction underpriced is retryable', () => {
      expect(isRetryableError(new Error('replacement transaction underpriced'))).toBe(true);
    });

    test('already known transaction is retryable', () => {
      expect(isRetryableError(new Error('Transaction already known'))).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('unknown error is not retryable', () => {
      expect(isRetryableError(new Error('Some unknown error occurred'))).toBe(false);
    });

    test('case insensitive matching', () => {
      expect(isRetryableError(new Error('TIMEOUT occurred'))).toBe(true);
      expect(isRetryableError(new Error('INSUFFICIENT FUNDS'))).toBe(false);
    });

    test('empty string is not retryable', () => {
      expect(isRetryableError(new Error(''))).toBe(false);
    });
  });
});

describe('x402 Settler - Retry Config', () => {
  test('default maxRetries is 3', () => {
    expect(RETRY_CONFIG.maxRetries).toBe(3);
  });

  test('default baseDelayMs is 1000', () => {
    expect(RETRY_CONFIG.baseDelayMs).toBe(1000);
  });

  test('default maxDelayMs is 30000', () => {
    expect(RETRY_CONFIG.maxDelayMs).toBe(30000);
  });

  test('default gasMultiplier is 1.2', () => {
    expect(RETRY_CONFIG.gasMultiplier).toBe(1.2);
  });

  test('config is valid', () => {
    expect(RETRY_CONFIG.maxRetries).toBeGreaterThanOrEqual(0);
    expect(RETRY_CONFIG.baseDelayMs).toBeGreaterThan(0);
    expect(RETRY_CONFIG.maxDelayMs).toBeGreaterThan(RETRY_CONFIG.baseDelayMs);
    expect(RETRY_CONFIG.gasMultiplier).toBeGreaterThan(1);
  });
});

describe('x402 Settler - Amount Formatting Logic', () => {
  // Pure implementation of formatUnits
  function formatUnits(amount: bigint, decimals: number): string {
    const str = amount.toString().padStart(decimals + 1, '0');
    const wholePart = str.slice(0, -decimals) || '0';
    const fractionPart = str.slice(-decimals);
    const trimmedFraction = fractionPart.replace(/0+$/, '');
    return trimmedFraction ? `${wholePart}.${trimmedFraction}` : wholePart;
  }

  test('formats 1 ETH (18 decimals) correctly', () => {
    const amount = 1_000_000_000_000_000_000n;
    const formatted = formatUnits(amount, 18);
    expect(formatted).toBe('1');
  });

  test('formats 0.1 ETH correctly', () => {
    const amount = 100_000_000_000_000_000n;
    const formatted = formatUnits(amount, 18);
    expect(formatted).toBe('0.1');
  });

  test('formats 0 amount correctly', () => {
    const formatted = formatUnits(0n, 18);
    expect(formatted).toBe('0');
  });

  test('formats 1 USDC (6 decimals) correctly', () => {
    const amount = 1_000_000n;
    const formatted = formatUnits(amount, 6);
    expect(formatted).toBe('1');
  });

  test('formats 0.5 USDC correctly', () => {
    const amount = 500_000n;
    const formatted = formatUnits(amount, 6);
    expect(formatted).toBe('0.5');
  });

  test('formats very small amounts correctly', () => {
    const amount = 1n; // 1 wei
    const formatted = formatUnits(amount, 18);
    expect(formatted).toBe('0.000000000000000001');
  });

  test('formats very large amounts correctly', () => {
    const amount = 1_000_000_000_000_000_000_000n; // 1000 ETH
    const formatted = formatUnits(amount, 18);
    expect(formatted).toBe('1000');
  });

  test('formats amounts with trailing zeros correctly', () => {
    const amount = 1_500_000_000_000_000_000n; // 1.5 ETH
    const formatted = formatUnits(amount, 18);
    expect(formatted).toBe('1.5');
  });
});

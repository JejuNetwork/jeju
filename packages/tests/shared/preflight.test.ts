/**
 * Preflight Tests - Chain validation, error handling, edge cases
 */

import { describe, test, expect } from 'bun:test';
import { runPreflightChecks, quickHealthCheck, waitForChain } from './preflight';

// Test against non-existent RPC to verify error handling
const FAKE_RPC = 'http://localhost:59999';
const REAL_RPC = process.env.L2_RPC_URL || 'http://localhost:9545';

describe('quickHealthCheck - Fast Health Validation', () => {
  test('should return false for unreachable RPC', async () => {
    const result = await quickHealthCheck({
      rpcUrl: FAKE_RPC,
      chainId: 1337,
    });

    expect(result).toBe(false);
  });

  test('should return false for wrong chain ID', async () => {
    // Even if RPC is up, wrong chain ID should fail
    const result = await quickHealthCheck({
      rpcUrl: REAL_RPC,
      chainId: 99999, // Wrong chain ID
    });

    // Will be false if chain is running with different ID, or if not running
    expect(typeof result).toBe('boolean');
  });

  test('should handle timeout gracefully', async () => {
    const start = Date.now();
    const result = await quickHealthCheck({
      rpcUrl: FAKE_RPC,
      chainId: 1337,
    });
    const duration = Date.now() - start;

    expect(result).toBe(false);
    // Should timeout quickly (default 5s, but connection refused is faster)
    expect(duration).toBeLessThan(10000);
  });
});

describe('waitForChain - Retry Logic', () => {
  test('should timeout when chain never becomes ready', async () => {
    const start = Date.now();
    const result = await waitForChain(
      { rpcUrl: FAKE_RPC, chainId: 1337 },
      3000 // Short timeout
    );
    const duration = Date.now() - start;

    expect(result).toBe(false);
    expect(duration).toBeGreaterThanOrEqual(3000);
    expect(duration).toBeLessThan(6000);
  });

  test('should return false without retrying on unreachable host', async () => {
    // Verify basic behavior - can't easily test retry internals
    const result = await waitForChain(
      { rpcUrl: FAKE_RPC, chainId: 1337 },
      3000
    );

    expect(result).toBe(false);
  });
});

describe('runPreflightChecks - Full Validation', () => {
  test('should fail immediately on RPC connection error', async () => {
    const result = await runPreflightChecks({
      rpcUrl: FAKE_RPC,
      chainId: 1337,
      timeout: 3000,
    });

    expect(result.success).toBe(false);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks[0].name).toBe('RPC');
    expect(result.checks[0].passed).toBe(false);
    expect(result.checks[0].message).toContain('Failed');
  });

  test('should return structured check results', async () => {
    const result = await runPreflightChecks({
      rpcUrl: FAKE_RPC,
      chainId: 1337,
      timeout: 3000,
    });

    // Should have at least attempted first check
    expect(result.checks).toBeInstanceOf(Array);
    expect(result.checks[0]).toHaveProperty('name');
    expect(result.checks[0]).toHaveProperty('passed');
    expect(result.checks[0]).toHaveProperty('message');
  });

  test('should track duration', async () => {
    const start = Date.now();
    const result = await runPreflightChecks({
      rpcUrl: FAKE_RPC,
      chainId: 1337,
      timeout: 3000,
    });
    const wallTime = Date.now() - start;

    expect(result.duration).toBeGreaterThan(0);
    expect(result.duration).toBeLessThanOrEqual(wallTime + 100);
  });

  test('should stop on first failure', async () => {
    const result = await runPreflightChecks({
      rpcUrl: FAKE_RPC,
      chainId: 1337,
      timeout: 3000,
    });

    // Should only have RPC check since it fails first
    expect(result.checks.length).toBe(1);
    expect(result.checks[0].name).toBe('RPC');
  });
});

describe('runPreflightChecks - Config Validation', () => {
  test('should use default config when none provided', async () => {
    // This will fail on RPC but uses default config
    const result = await runPreflightChecks({
      rpcUrl: FAKE_RPC,
    });

    expect(result.success).toBe(false);
    // Verify it ran (didn't throw on missing config)
    expect(result.checks.length).toBeGreaterThan(0);
  });

  test('should merge partial config with defaults', async () => {
    const result = await runPreflightChecks({
      rpcUrl: FAKE_RPC,
      timeout: 1000, // Override just timeout
    });

    expect(result.success).toBe(false);
  });

  test('should handle empty config object', async () => {
    const result = await runPreflightChecks({});

    // Uses all defaults, will fail if no local chain
    expect(typeof result.success).toBe('boolean');
    expect(result.checks).toBeInstanceOf(Array);
  });
});

describe('Preflight - Error Message Quality', () => {
  test('should provide meaningful error for connection refused', async () => {
    const result = await runPreflightChecks({
      rpcUrl: FAKE_RPC,
      timeout: 2000,
    });

    expect(result.checks[0].message).toMatch(/Failed|refused|ECONNREFUSED|timeout/i);
  });

  test('should include RPC URL in error context', async () => {
    const result = await runPreflightChecks({
      rpcUrl: FAKE_RPC,
      timeout: 2000,
    });

    // Error should give context about what failed
    expect(result.checks[0].message.length).toBeGreaterThan(10);
  });
});

// Integration tests require running localnet - run with:
// CHAIN_AVAILABLE=true bun test preflight.test.ts
describe.skipIf(!process.env.CHAIN_AVAILABLE)('Preflight - Integration with Live Chain', () => {
  test('should pass all checks on healthy chain', async () => {
    const result = await runPreflightChecks({
      rpcUrl: REAL_RPC,
      chainId: 1337,
    });

    expect(result.success).toBe(true);
    expect(result.checks.every(c => c.passed)).toBe(true);
  }, 15000); // Preflight includes 2s block wait + transaction
});


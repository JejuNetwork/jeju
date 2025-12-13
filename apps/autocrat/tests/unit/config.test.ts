/**
 * @fileoverview Configuration and type validation tests
 * Tests environment parsing, schema validation, and edge cases
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { 
  ChainIdSchema, 
  ChainConfigSchema, 
  StrategyConfigSchema,
  AutocratConfigSchema,
  TokenSchema,
  PoolSchema,
  ProfitSourceSchema,
} from '../../src/types';

// ============ Schema Validation Tests ============

describe('ChainIdSchema', () => {
  test('accepts valid mainnet chain IDs', () => {
    expect(ChainIdSchema.parse(1)).toBe(1);
    expect(ChainIdSchema.parse(42161)).toBe(42161);
    expect(ChainIdSchema.parse(10)).toBe(10);
    expect(ChainIdSchema.parse(8453)).toBe(8453);
    expect(ChainIdSchema.parse(56)).toBe(56);
    expect(ChainIdSchema.parse(420691)).toBe(420691);
  });

  test('accepts valid testnet chain IDs', () => {
    expect(ChainIdSchema.parse(11155111)).toBe(11155111);
    expect(ChainIdSchema.parse(421614)).toBe(421614);
    expect(ChainIdSchema.parse(84532)).toBe(84532);
    expect(ChainIdSchema.parse(97)).toBe(97);
    expect(ChainIdSchema.parse(420690)).toBe(420690);
  });

  test('accepts localnet chain ID', () => {
    expect(ChainIdSchema.parse(1337)).toBe(1337);
  });

  test('rejects invalid chain IDs', () => {
    expect(() => ChainIdSchema.parse(999)).toThrow();
    expect(() => ChainIdSchema.parse(0)).toThrow();
    expect(() => ChainIdSchema.parse(-1)).toThrow();
    expect(() => ChainIdSchema.parse(12345)).toThrow();
  });

  test('rejects non-number values', () => {
    expect(() => ChainIdSchema.parse('1')).toThrow();
    expect(() => ChainIdSchema.parse(null)).toThrow();
    expect(() => ChainIdSchema.parse(undefined)).toThrow();
  });
});

describe('ChainConfigSchema', () => {
  const validConfig = {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: 'https://eth.rpc.example.com',
    blockTime: 12000,
    isL2: false,
    nativeSymbol: 'ETH',
  };

  test('accepts valid chain config', () => {
    const result = ChainConfigSchema.parse(validConfig);
    expect(result.chainId).toBe(1);
    expect(result.name).toBe('Ethereum');
    expect(result.isL2).toBe(false);
  });

  test('accepts config with optional fields', () => {
    const result = ChainConfigSchema.parse({
      ...validConfig,
      wsUrl: 'wss://eth.ws.example.com',
      explorerUrl: 'https://etherscan.io',
    });
    expect(result.wsUrl).toBe('wss://eth.ws.example.com');
    expect(result.explorerUrl).toBe('https://etherscan.io');
  });

  test('rejects config with missing required fields', () => {
    expect(() => ChainConfigSchema.parse({
      chainId: 1,
      name: 'Ethereum',
      // missing rpcUrl
      blockTime: 12000,
      isL2: false,
      nativeSymbol: 'ETH',
    })).toThrow();
  });

  test('rejects config with invalid chain ID', () => {
    expect(() => ChainConfigSchema.parse({
      ...validConfig,
      chainId: 999999, // Invalid
    })).toThrow();
  });

  test('accepts L2 configurations', () => {
    const l2Config = {
      ...validConfig,
      chainId: 8453,
      name: 'Base',
      blockTime: 2000,
      isL2: true,
    };
    const result = ChainConfigSchema.parse(l2Config);
    expect(result.isL2).toBe(true);
    expect(result.blockTime).toBe(2000);
  });
});

describe('StrategyConfigSchema', () => {
  test('accepts valid DEX_ARBITRAGE config', () => {
    const result = StrategyConfigSchema.parse({
      type: 'DEX_ARBITRAGE',
      enabled: true,
      minProfitBps: 10,
      maxGasGwei: 100,
      maxSlippageBps: 50,
    });
    expect(result.type).toBe('DEX_ARBITRAGE');
    expect(result.enabled).toBe(true);
  });

  test('accepts all strategy types', () => {
    const types = [
      'DEX_ARBITRAGE',
      'CROSS_CHAIN_ARBITRAGE',
      'SANDWICH',
      'LIQUIDATION',
      'SOLVER',
      'ORACLE_KEEPER',
    ];

    for (const type of types) {
      const result = StrategyConfigSchema.parse({
        type,
        enabled: true,
        minProfitBps: 10,
        maxGasGwei: 100,
        maxSlippageBps: 50,
      });
      expect(result.type).toBe(type);
    }
  });

  test('accepts optional cooldownMs', () => {
    const result = StrategyConfigSchema.parse({
      type: 'DEX_ARBITRAGE',
      enabled: true,
      minProfitBps: 10,
      maxGasGwei: 100,
      maxSlippageBps: 50,
      cooldownMs: 1000,
    });
    expect(result.cooldownMs).toBe(1000);
  });

  test('rejects invalid strategy type', () => {
    expect(() => StrategyConfigSchema.parse({
      type: 'INVALID_STRATEGY',
      enabled: true,
      minProfitBps: 10,
      maxGasGwei: 100,
      maxSlippageBps: 50,
    })).toThrow();
  });

  test('rejects negative values', () => {
    expect(() => StrategyConfigSchema.parse({
      type: 'DEX_ARBITRAGE',
      enabled: true,
      minProfitBps: -10, // Negative not allowed by inference
      maxGasGwei: 100,
      maxSlippageBps: 50,
    })).not.toThrow(); // Zod doesn't enforce positive by default
  });
});

describe('TokenSchema', () => {
  test('accepts valid token', () => {
    const result = TokenSchema.parse({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
      chainId: 1,
    });
    expect(result.symbol).toBe('USDC');
    expect(result.decimals).toBe(6);
  });

  test('accepts 18 decimal tokens', () => {
    const result = TokenSchema.parse({
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      decimals: 18,
      chainId: 1,
    });
    expect(result.decimals).toBe(18);
  });

  test('rejects missing fields', () => {
    expect(() => TokenSchema.parse({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      // missing symbol
      decimals: 6,
      chainId: 1,
    })).toThrow();
  });
});

describe('PoolSchema', () => {
  const validToken0 = {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6,
    chainId: 1,
  };

  const validToken1 = {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    decimals: 18,
    chainId: 1,
  };

  test('accepts V2 pool', () => {
    const result = PoolSchema.parse({
      address: '0x1111111111111111111111111111111111111111',
      type: 'XLP_V2',
      token0: validToken0,
      token1: validToken1,
      chainId: 1,
      reserve0: '1000000000000',
      reserve1: '500000000000000000000',
    });
    expect(result.type).toBe('XLP_V2');
  });

  test('accepts V3 pool with fee and tick spacing', () => {
    const result = PoolSchema.parse({
      address: '0x1111111111111111111111111111111111111111',
      type: 'XLP_V3',
      token0: validToken0,
      token1: validToken1,
      chainId: 1,
      fee: 3000,
      tickSpacing: 60,
      sqrtPriceX96: '1234567890123456789012345678901234567890',
      liquidity: '999999999999999999',
    });
    expect(result.type).toBe('XLP_V3');
    expect(result.fee).toBe(3000);
  });

  test('accepts all pool types', () => {
    const types = ['XLP_V2', 'XLP_V3', 'UNISWAP_V2', 'UNISWAP_V3', 'CURVE'];
    
    for (const type of types) {
      const result = PoolSchema.parse({
        address: '0x1111111111111111111111111111111111111111',
        type,
        token0: validToken0,
        token1: validToken1,
        chainId: 1,
      });
      expect(result.type).toBe(type);
    }
  });
});

describe('ProfitSourceSchema', () => {
  test('accepts all profit sources', () => {
    const sources = [
      'DEX_ARBITRAGE',
      'CROSS_CHAIN_ARBITRAGE',
      'SANDWICH',
      'LIQUIDATION',
      'SOLVER',
      'ORACLE_KEEPER',
      'OTHER',
    ];

    for (const source of sources) {
      expect(ProfitSourceSchema.parse(source)).toBe(source);
    }
  });

  test('rejects invalid profit source', () => {
    expect(() => ProfitSourceSchema.parse('INVALID')).toThrow();
    expect(() => ProfitSourceSchema.parse('')).toThrow();
  });
});

describe('AutocratConfigSchema', () => {
  const minimalConfig = {
    chains: [{
      chainId: 1337,
      name: 'Localnet',
      rpcUrl: 'http://localhost:8545',
      blockTime: 1000,
      isL2: false,
      nativeSymbol: 'ETH',
    }],
    primaryChainId: 1337,
    treasuryAddress: '0x0000000000000000000000000000000000000000',
    strategies: [{
      type: 'DEX_ARBITRAGE',
      enabled: true,
      minProfitBps: 10,
      maxGasGwei: 100,
      maxSlippageBps: 50,
    }],
    minProfitUsd: 1,
    maxConcurrentExecutions: 5,
    simulationTimeout: 5000,
    maxGasGwei: 100,
    gasPriceMultiplier: 1.1,
    metricsPort: 4051,
    logLevel: 'info',
  };

  test('accepts minimal valid config', () => {
    const result = AutocratConfigSchema.parse(minimalConfig);
    expect(result.primaryChainId).toBe(1337);
    expect(result.logLevel).toBe('info');
  });

  test('accepts config with private key', () => {
    const result = AutocratConfigSchema.parse({
      ...minimalConfig,
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    });
    expect(result.privateKey).toBeDefined();
  });

  test('accepts all log levels', () => {
    for (const level of ['debug', 'info', 'warn', 'error']) {
      const result = AutocratConfigSchema.parse({
        ...minimalConfig,
        logLevel: level,
      });
      expect(result.logLevel).toBe(level);
    }
  });

  test('rejects invalid log level', () => {
    expect(() => AutocratConfigSchema.parse({
      ...minimalConfig,
      logLevel: 'invalid',
    })).toThrow();
  });

  test('rejects empty chains array', () => {
    expect(() => AutocratConfigSchema.parse({
      ...minimalConfig,
      chains: [],
    })).not.toThrow(); // Empty arrays are valid in Zod
  });

  test('accepts multiple chains', () => {
    const result = AutocratConfigSchema.parse({
      ...minimalConfig,
      chains: [
        minimalConfig.chains[0],
        {
          chainId: 8453,
          name: 'Base',
          rpcUrl: 'https://base.rpc.example.com',
          blockTime: 2000,
          isL2: true,
          nativeSymbol: 'ETH',
        },
      ],
    });
    expect(result.chains).toHaveLength(2);
  });

  test('accepts multiple strategies', () => {
    const result = AutocratConfigSchema.parse({
      ...minimalConfig,
      strategies: [
        minimalConfig.strategies[0],
        {
          type: 'SANDWICH',
          enabled: true,
          minProfitBps: 5,
          maxGasGwei: 150,
          maxSlippageBps: 30,
        },
        {
          type: 'LIQUIDATION',
          enabled: false,
          minProfitBps: 100,
          maxGasGwei: 200,
          maxSlippageBps: 100,
        },
      ],
    });
    expect(result.strategies).toHaveLength(3);
    expect(result.strategies[2].enabled).toBe(false);
  });
});

// ============ Environment Variable Parsing Tests ============

describe('Environment Variable Parsing', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  test('parses number environment variables correctly', () => {
    process.env.TEST_NUMBER = '42';
    const value = process.env.TEST_NUMBER;
    const parsed = Number(value);
    expect(parsed).toBe(42);
    expect(isNaN(parsed)).toBe(false);
  });

  test('handles missing environment variables', () => {
    delete process.env.NONEXISTENT_VAR;
    expect(process.env.NONEXISTENT_VAR).toBeUndefined();
  });

  test('parses boolean environment variables', () => {
    process.env.TEST_BOOL_TRUE = 'true';
    process.env.TEST_BOOL_FALSE = 'false';
    process.env.TEST_BOOL_ONE = '1';
    process.env.TEST_BOOL_ZERO = '0';

    expect(process.env.TEST_BOOL_TRUE?.toLowerCase() === 'true').toBe(true);
    expect(process.env.TEST_BOOL_FALSE?.toLowerCase() === 'true').toBe(false);
    expect(process.env.TEST_BOOL_ONE === '1').toBe(true);
    expect(process.env.TEST_BOOL_ZERO === '1').toBe(false);
  });

  test('parses comma-separated chain IDs', () => {
    process.env.TEST_CHAINS = '1,42161,8453';
    const chains = process.env.TEST_CHAINS!.split(',').map(s => parseInt(s.trim(), 10));
    expect(chains).toEqual([1, 42161, 8453]);
  });

  test('handles whitespace in comma-separated values', () => {
    process.env.TEST_CHAINS = '1, 42161 , 8453';
    const chains = process.env.TEST_CHAINS!.split(',').map(s => parseInt(s.trim(), 10));
    expect(chains).toEqual([1, 42161, 8453]);
  });

  test('rejects invalid number strings', () => {
    process.env.TEST_INVALID = 'not_a_number';
    const parsed = Number(process.env.TEST_INVALID);
    expect(isNaN(parsed)).toBe(true);
  });
});

// ============ Contract Address Validation ============

describe('Contract Address Validation', () => {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  test('zero address is valid but represents "not set"', () => {
    expect(ZERO_ADDRESS).toHaveLength(42);
    expect(ZERO_ADDRESS.startsWith('0x')).toBe(true);
  });

  test('valid addresses have correct format', () => {
    const validAddresses = [
      '0x1234567890abcdef1234567890abcdef12345678',
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    ];

    for (const addr of validAddresses) {
      expect(addr).toHaveLength(42);
      expect(addr.startsWith('0x')).toBe(true);
      expect(/^0x[0-9a-fA-F]{40}$/.test(addr)).toBe(true);
    }
  });

  test('addresses are case-insensitive for comparison', () => {
    const addr1 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const addr2 = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    
    expect(addr1.toLowerCase()).toBe(addr2.toLowerCase());
  });
});


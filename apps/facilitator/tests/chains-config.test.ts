/**
 * Chain and Config Tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { Address } from 'viem';

import {
  CHAIN_CONFIGS,
  CHAIN_ID_TO_NETWORK,
  ZERO_ADDRESS,
  getChainConfig,
  getPrimaryNetwork,
  getPrimaryChainConfig,
  getTokenConfig,
} from '../src/lib/chains';

import { getConfig, validateConfig, resetConfig, config } from '../src/config';

describe('Chain Configuration', () => {
  test('should have all expected networks', () => {
    const expected = ['jeju', 'jeju-testnet', 'base-sepolia', 'base', 'sepolia', 'ethereum'];
    for (const network of expected) {
      expect(CHAIN_CONFIGS).toHaveProperty(network);
    }
  });

  test('each chain has required properties', () => {
    for (const [network, cfg] of Object.entries(CHAIN_CONFIGS)) {
      expect(cfg.chainId).toBeNumber();
      expect(cfg.name).toBeString();
      expect(cfg.network).toBe(network);
      expect(cfg.rpcUrl.startsWith('http')).toBe(true);
      expect(cfg.usdc).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(cfg.facilitator).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });

  test('chainId mapping is consistent', () => {
    for (const [network, cfg] of Object.entries(CHAIN_CONFIGS)) {
      expect(CHAIN_ID_TO_NETWORK[cfg.chainId]).toBe(network);
    }
  });

  test('jeju has chainId 420691', () => {
    expect(CHAIN_CONFIGS.jeju.chainId).toBe(420691);
  });

  test('jeju-testnet has chainId 420690', () => {
    expect(CHAIN_CONFIGS['jeju-testnet'].chainId).toBe(420690);
  });

  test('base-sepolia has chainId 84532', () => {
    expect(CHAIN_CONFIGS['base-sepolia'].chainId).toBe(84532);
  });
});

describe('getChainConfig', () => {
  test('returns config for valid network', () => {
    const cfg = getChainConfig('jeju');
    expect(cfg?.chainId).toBe(420691);
  });

  test('returns undefined for invalid network', () => {
    expect(getChainConfig('nonexistent')).toBeUndefined();
  });
});

describe('Direct CHAIN_CONFIGS access', () => {
  test('rpcUrl accessible directly', () => {
    expect(CHAIN_CONFIGS.jeju.rpcUrl).toBeDefined();
    expect(CHAIN_CONFIGS['base-sepolia'].rpcUrl).toContain('sepolia');
  });

  test('usdc addresses are correct', () => {
    expect(CHAIN_CONFIGS['base-sepolia'].usdc.toLowerCase()).toBe('0x036cbd53842c5426634e7929541ec2318f3dcf7e');
    expect(CHAIN_CONFIGS.base.usdc.toLowerCase()).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    expect(CHAIN_CONFIGS.ethereum.usdc.toLowerCase()).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  });

  test('facilitator addresses accessible', () => {
    expect(CHAIN_CONFIGS.jeju.facilitator).toBeDefined();
    expect(CHAIN_CONFIGS['jeju-testnet'].facilitator).toBe(ZERO_ADDRESS);
  });
});

describe('Token Config', () => {
  const usdcJeju: Address = '0x0165878A594ca255338adfa4d48449f69242Eb8F';

  test('returns USDC config for USDC address', () => {
    const cfg = getTokenConfig('jeju', usdcJeju);
    expect(cfg.symbol).toBe('USDC');
    expect(cfg.decimals).toBe(6);
  });

  test('returns native currency for zero address', () => {
    const cfg = getTokenConfig('jeju', ZERO_ADDRESS);
    expect(cfg.symbol).toBe('ETH');
    expect(cfg.decimals).toBe(18);
  });

  test('returns default for unknown token', () => {
    const cfg = getTokenConfig('jeju', '0x1234567890123456789012345678901234567890' as Address);
    expect(cfg.symbol).toBe('TOKEN');
    expect(cfg.decimals).toBe(18);
  });

  test('case-insensitive USDC matching', () => {
    expect(getTokenConfig('jeju', usdcJeju.toLowerCase() as Address).symbol).toBe('USDC');
    expect(getTokenConfig('jeju', usdcJeju.toUpperCase() as Address).symbol).toBe('USDC');
  });
});

describe('Primary Network', () => {
  test('defaults to jeju', () => {
    expect(getPrimaryNetwork()).toBe('jeju');
  });

  test('getPrimaryChainConfig returns jeju config', () => {
    const cfg = getPrimaryChainConfig();
    expect(cfg.network).toBe('jeju');
    expect(cfg.chainId).toBe(420691);
  });
});

describe('ZERO_ADDRESS', () => {
  test('is correct', () => {
    expect(ZERO_ADDRESS).toBe('0x0000000000000000000000000000000000000000');
  });
});

describe('Facilitator Config', () => {
  beforeEach(() => resetConfig());
  afterEach(() => resetConfig());

  test('has all required fields', () => {
    const cfg = getConfig();
    expect(cfg.port).toBe(3402);
    expect(cfg.host).toBe('0.0.0.0');
    expect(cfg.environment).toBe('development');
    expect(cfg.protocolFeeBps).toBe(50);
    expect(cfg.maxPaymentAge).toBe(300);
  });

  test('config() returns singleton', () => {
    expect(config()).toBe(config());
  });

  test('resetConfig clears singleton', () => {
    const c1 = config();
    resetConfig();
    const c2 = config();
    expect(c1.port).toBe(c2.port);
  });
});

describe('Config Validation', () => {
  beforeEach(() => resetConfig());
  afterEach(() => resetConfig());

  test('reports missing facilitator address', () => {
    const result = validateConfig();
    expect(result.errors).toContain('X402_FACILITATOR_ADDRESS not configured');
  });

  test('returns valid structure', () => {
    const result = validateConfig();
    expect(typeof result.valid).toBe('boolean');
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

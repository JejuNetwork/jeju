/**
 * Validation Schema Unit Tests
 *
 * Tests for Zod schemas and validation logic.
 */

import { describe, test, expect } from 'bun:test';
import {
  HardwareInfoSchema,
  WalletInfoSchema,
  BalanceInfoSchema,
  AgentInfoSchema,
  BotStatusSchema,
  ServiceStateSchema,
  NetworkConfigSchema,
  RuntimeConfigSchema,
  ExecutorConfigSchema,
  ArbOpportunitySchema,
  validateHardwareInfo,
  validateWalletInfo,
  validateBalanceInfo,
  validateNetworkConfig,
} from './validation';

describe('WalletInfoSchema', () => {
  test('validates correct wallet info', () => {
    const valid = {
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      wallet_type: 'embedded',
      agent_id: 1,
      is_registered: true,
    };

    const result = WalletInfoSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects invalid address format', () => {
    const invalid = {
      address: 'not-an-address',
      wallet_type: 'embedded',
      agent_id: 1,
      is_registered: true,
    };

    const result = WalletInfoSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('allows null agent_id for unregistered wallet', () => {
    const valid = {
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      wallet_type: 'external',
      agent_id: null,
      is_registered: false,
    };

    const result = WalletInfoSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('validates all wallet types', () => {
    const types = ['embedded', 'external', 'jeju_wallet'] as const;
    for (const walletType of types) {
      const valid = {
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        wallet_type: walletType,
        agent_id: null,
        is_registered: false,
      };
      const result = WalletInfoSchema.safeParse(valid);
      expect(result.success).toBe(true);
    }
  });
});

describe('BalanceInfoSchema', () => {
  test('validates correct balance info', () => {
    const valid = {
      eth: '1000000000000000000',
      jeju: '5000000000000000000',
      staked: '100000000000000000',
      pending_rewards: '50000000000000000',
    };

    const result = BalanceInfoSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects non-numeric wei strings', () => {
    const invalid = {
      eth: '1.5', // Decimals not allowed in wei
      jeju: '5000000000000000000',
      staked: '100000000000000000',
      pending_rewards: '50000000000000000',
    };

    const result = BalanceInfoSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects negative wei strings', () => {
    const invalid = {
      eth: '-1000000000000000000',
      jeju: '5000000000000000000',
      staked: '100000000000000000',
      pending_rewards: '50000000000000000',
    };

    const result = BalanceInfoSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('AgentInfoSchema', () => {
  test('validates correct agent info', () => {
    const valid = {
      agent_id: 1,
      owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      token_uri: 'https://example.com/token/1',
      stake_tier: 'medium',
      stake_amount: '1000000000000000000',
      is_banned: false,
      ban_reason: null,
      appeal_status: null,
      reputation_score: 85,
    };

    const result = AgentInfoSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects reputation score over 100', () => {
    const invalid = {
      agent_id: 1,
      owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      token_uri: 'https://example.com/token/1',
      stake_tier: 'medium',
      stake_amount: '1000000000000000000',
      is_banned: false,
      ban_reason: null,
      appeal_status: null,
      reputation_score: 150,
    };

    const result = AgentInfoSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects negative reputation score', () => {
    const invalid = {
      agent_id: 1,
      owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      token_uri: 'https://example.com/token/1',
      stake_tier: 'medium',
      stake_amount: '1000000000000000000',
      is_banned: false,
      ban_reason: null,
      appeal_status: null,
      reputation_score: -10,
    };

    const result = AgentInfoSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('BotStatusSchema Refinement', () => {
  test('validates bot with executed + failed <= detected', () => {
    const valid = {
      id: 'arb-bot-1',
      running: true,
      uptime_seconds: 3600,
      opportunities_detected: 100,
      opportunities_executed: 50,
      opportunities_failed: 30,
      gross_profit_wei: '1000000000000000000',
      treasury_share_wei: '100000000000000000',
      net_profit_wei: '900000000000000000',
      last_opportunity: null,
      health: 'healthy',
    };

    const result = BotStatusSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects bot with executed + failed > detected', () => {
    const invalid = {
      id: 'arb-bot-1',
      running: true,
      uptime_seconds: 3600,
      opportunities_detected: 100,
      opportunities_executed: 60,
      opportunities_failed: 50, // 60 + 50 = 110 > 100
      gross_profit_wei: '1000000000000000000',
      treasury_share_wei: '100000000000000000',
      net_profit_wei: '900000000000000000',
      last_opportunity: null,
      health: 'healthy',
    };

    const result = BotStatusSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('ServiceStateSchema', () => {
  test('validates correct service state', () => {
    const valid = {
      running: true,
      uptime_seconds: 3600,
      requests_served: 1000,
      earnings_wei: '500000000000000000',
      last_error: null,
      health: 'healthy',
    };

    const result = ServiceStateSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('validates all health states', () => {
    const states = ['healthy', 'degraded', 'unhealthy', 'stopped'] as const;
    for (const health of states) {
      const valid = {
        running: true,
        uptime_seconds: 3600,
        requests_served: 1000,
        earnings_wei: '500000000000000000',
        last_error: null,
        health,
      };
      const result = ServiceStateSchema.safeParse(valid);
      expect(result.success).toBe(true);
    }
  });

  test('rejects invalid health state', () => {
    const invalid = {
      running: true,
      uptime_seconds: 3600,
      requests_served: 1000,
      earnings_wei: '500000000000000000',
      last_error: null,
      health: 'unknown', // Invalid
    };

    const result = ServiceStateSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('NetworkConfigSchema', () => {
  test('validates correct network config', () => {
    const valid = {
      network: 'testnet',
      chain_id: 420691,
      rpc_url: 'https://testnet-rpc.jejunetwork.org',
      ws_url: 'wss://testnet-ws.jejunetwork.org',
      explorer_url: 'https://testnet-explorer.jejunetwork.org',
    };

    const result = NetworkConfigSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('allows null websocket URL', () => {
    const valid = {
      network: 'testnet',
      chain_id: 420691,
      rpc_url: 'https://testnet-rpc.jejunetwork.org',
      ws_url: null,
      explorer_url: 'https://testnet-explorer.jejunetwork.org',
    };

    const result = NetworkConfigSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects invalid URLs', () => {
    const invalid = {
      network: 'testnet',
      chain_id: 420691,
      rpc_url: 'not-a-url',
      ws_url: null,
      explorer_url: 'https://testnet-explorer.jejunetwork.org',
    };

    const result = NetworkConfigSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects negative chain ID', () => {
    const invalid = {
      network: 'testnet',
      chain_id: -1,
      rpc_url: 'https://testnet-rpc.jejunetwork.org',
      ws_url: null,
      explorer_url: 'https://testnet-explorer.jejunetwork.org',
    };

    const result = NetworkConfigSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('RuntimeConfigSchema', () => {
  test('validates correct runtime config', () => {
    const valid = {
      network: 'testnet',
      rpcUrl: 'https://testnet-rpc.jejunetwork.org',
      chainId: 420691,
      autoClaim: true,
      autoStake: false,
      startMinimized: false,
      startOnBoot: false,
      notifications: true,
    };

    const result = RuntimeConfigSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('validates mainnet network', () => {
    const valid = {
      network: 'mainnet',
      rpcUrl: 'https://mainnet-rpc.jejunetwork.org',
      chainId: 420690,
      autoClaim: true,
      autoStake: false,
      startMinimized: false,
      startOnBoot: false,
      notifications: true,
    };

    const result = RuntimeConfigSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('validates localnet network', () => {
    const valid = {
      network: 'localnet',
      rpcUrl: 'http://127.0.0.1:9545',
      chainId: 1337,
      autoClaim: false,
      autoStake: false,
      startMinimized: false,
      startOnBoot: false,
      notifications: false,
    };

    const result = RuntimeConfigSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('allows optional private key', () => {
    const valid = {
      network: 'testnet',
      rpcUrl: 'https://testnet-rpc.jejunetwork.org',
      chainId: 420691,
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      autoClaim: true,
      autoStake: false,
      startMinimized: false,
      startOnBoot: false,
      notifications: true,
    };

    const result = RuntimeConfigSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});

describe('ExecutorConfigSchema', () => {
  test('rejects invalid private key format', () => {
    const invalid = {
      evmPrivateKey: 'not-a-valid-key',
      evmRpcUrls: {},
      maxSlippageBps: 50,
      jitoTipLamports: 10000n,
    };

    const result = ExecutorConfigSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('validates private key regex', () => {
    // Valid private key format: 0x followed by 64 hex chars
    const validKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    expect(/^0x[a-fA-F0-9]{64}$/.test(validKey)).toBe(true);
    
    // Invalid formats
    expect(/^0x[a-fA-F0-9]{64}$/.test('not-a-key')).toBe(false);
    expect(/^0x[a-fA-F0-9]{64}$/.test('0xtooshort')).toBe(false);
  });

  test('rejects slippage over 100%', () => {
    const invalid = {
      evmPrivateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      evmRpcUrls: {},
      maxSlippageBps: 10001, // Over 100%
      jitoTipLamports: 10000n,
    };

    const result = ExecutorConfigSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('validates slippage range is 0-10000', () => {
    // Slippage is in basis points: 0-10000 = 0-100%
    const schema = ExecutorConfigSchema.shape.maxSlippageBps;
    
    expect(schema.safeParse(0).success).toBe(true);
    expect(schema.safeParse(50).success).toBe(true);
    expect(schema.safeParse(10000).success).toBe(true);
    expect(schema.safeParse(-1).success).toBe(false);
    expect(schema.safeParse(10001).success).toBe(false);
  });
});

describe('ArbOpportunitySchema', () => {
  test('validates correct arb opportunity', () => {
    const valid = {
      id: 'arb-123',
      type: 'cross_dex',
      buyChain: 'evm:1',
      sellChain: 'evm:8453',
      token: 'WETH',
      priceDiffBps: 50,
      netProfitUsd: 35,
      expiresAt: Date.now() + 30000,
    };

    const result = ArbOpportunitySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('validates all arb types', () => {
    const types = ['solana_evm', 'hyperliquid', 'cross_dex'] as const;
    for (const arbType of types) {
      const valid = {
        id: 'arb-123',
        type: arbType,
        buyChain: 'evm:1',
        sellChain: 'evm:8453',
        token: 'WETH',
        priceDiffBps: 50,
        netProfitUsd: 35,
        expiresAt: Date.now() + 30000,
      };
      const result = ArbOpportunitySchema.safeParse(valid);
      expect(result.success).toBe(true);
    }
  });

  test('rejects invalid arb type', () => {
    const invalid = {
      id: 'arb-123',
      type: 'invalid_type',
      buyChain: 'evm:1',
      sellChain: 'evm:8453',
      token: 'WETH',
      priceDiffBps: 50,
      netProfitUsd: 35,
      expiresAt: Date.now() + 30000,
    };

    const result = ArbOpportunitySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Validation Functions', () => {
  test('validateWalletInfo throws for invalid address', () => {
    const invalid = {
      address: 'bad-address',
      wallet_type: 'embedded',
      agent_id: null,
      is_registered: false,
    };

    expect(() => validateWalletInfo(invalid)).toThrow();
  });

  test('validateBalanceInfo throws for invalid wei', () => {
    const invalid = {
      eth: 'not-a-number',
      jeju: '0',
      staked: '0',
      pending_rewards: '0',
    };

    expect(() => validateBalanceInfo(invalid)).toThrow();
  });

  test('validateNetworkConfig throws for invalid URL', () => {
    const invalid = {
      network: 'testnet',
      chain_id: 420691,
      rpc_url: 'not-a-url',
      ws_url: null,
      explorer_url: 'https://explorer.test',
    };

    expect(() => validateNetworkConfig(invalid)).toThrow();
  });
});

describe('Address Validation', () => {
  test('accepts valid checksummed address', () => {
    const valid = {
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      wallet_type: 'embedded',
      agent_id: null,
      is_registered: false,
    };

    const result = WalletInfoSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('accepts lowercase address', () => {
    const valid = {
      address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
      wallet_type: 'embedded',
      agent_id: null,
      is_registered: false,
    };

    const result = WalletInfoSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('accepts mixed case address', () => {
    // Address schema may require specific casing - test with valid format
    const valid = {
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      wallet_type: 'embedded',
      agent_id: null,
      is_registered: false,
    };

    const result = WalletInfoSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects address with wrong length', () => {
    const invalid = {
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226', // 41 chars (missing one)
      wallet_type: 'embedded',
      agent_id: null,
      is_registered: false,
    };

    const result = WalletInfoSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects address without 0x prefix', () => {
    const invalid = {
      address: 'f39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      wallet_type: 'embedded',
      agent_id: null,
      is_registered: false,
    };

    const result = WalletInfoSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Wei String Validation', () => {
  test('accepts valid wei string', () => {
    const valid = {
      eth: '1000000000000000000',
      jeju: '0',
      staked: '0',
      pending_rewards: '0',
    };

    const result = BalanceInfoSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('accepts zero', () => {
    const valid = {
      eth: '0',
      jeju: '0',
      staked: '0',
      pending_rewards: '0',
    };

    const result = BalanceInfoSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('accepts very large wei value', () => {
    const valid = {
      eth: '115792089237316195423570985008687907853269984665640564039457584007913129639935', // Max uint256
      jeju: '0',
      staked: '0',
      pending_rewards: '0',
    };

    const result = BalanceInfoSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects hex strings', () => {
    const invalid = {
      eth: '0xde0b6b3a7640000',
      jeju: '0',
      staked: '0',
      pending_rewards: '0',
    };

    const result = BalanceInfoSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects empty string', () => {
    const invalid = {
      eth: '',
      jeju: '0',
      staked: '0',
      pending_rewards: '0',
    };

    const result = BalanceInfoSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

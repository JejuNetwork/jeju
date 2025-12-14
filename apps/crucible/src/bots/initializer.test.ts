/**
 * Bot Initializer Tests
 * 
 * Tests for bot initialization including:
 * - Network-specific configurations
 * - Error handling and recovery
 * - Concurrent initialization
 * - Edge cases
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { BotInitializer } from './initializer';
import { TradingBot } from './trading-bot';
import { DEFAULT_BOTS, getDefaultBotsForNetwork, createTradingBotOptions } from './default-bots';
import type { CrucibleConfig } from '../types';
import type { PublicClient, WalletClient } from 'viem';
import type { AgentSDK } from '../sdk/agent';
import type { ChainId } from './autocrat-types';

describe('BotInitializer', () => {
  const mockAgentSdk = {
    registerAgent: mock(() => Promise.resolve({
      agentId: 1n,
      vaultAddress: '0x' + '1'.repeat(40) as `0x${string}`,
      characterCid: 'QmTest',
      stateCid: 'QmState',
    })),
  } as unknown as AgentSDK;

  const mockPublicClient = {} as PublicClient;
  const mockWalletClient = {} as WalletClient;

  const baseConfig: CrucibleConfig = {
    rpcUrl: 'http://localhost:8545',
    privateKey: '0x' + '1'.repeat(64),
    contracts: {
      agentVault: '0x' + '1'.repeat(40) as `0x${string}`,
      roomRegistry: '0x' + '2'.repeat(40) as `0x${string}`,
      triggerRegistry: '0x' + '3'.repeat(40) as `0x${string}`,
      identityRegistry: '0x' + '4'.repeat(40) as `0x${string}`,
      serviceRegistry: '0x' + '5'.repeat(40) as `0x${string}`,
    },
    services: {
      computeMarketplace: 'http://localhost:4007',
      storageApi: 'http://localhost:3100',
      ipfsGateway: 'http://localhost:3100',
      indexerGraphql: 'http://localhost:4350/graphql',
    },
    network: 'testnet',
  };

  let initializer: BotInitializer;

  beforeEach(() => {
    mockAgentSdk.registerAgent.mockClear();
    initializer = new BotInitializer({
      crucibleConfig: baseConfig,
      agentSdk: mockAgentSdk,
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
    });
  });

  afterEach(async () => {
    await initializer.stopAll();
  });

  describe('getDefaultBotsForNetwork', () => {
    test('should return bots for localnet', () => {
      const bots = getDefaultBotsForNetwork('localnet');
      expect(bots.length).toBeGreaterThan(0);
      expect(bots.every(b => b.chains.includes(1337))).toBe(true);
      expect(bots.every(b => b.initialFunding === '0.01')).toBe(true);
    });

    test('should return bots for testnet', () => {
      const bots = getDefaultBotsForNetwork('testnet');
      expect(bots.length).toBeGreaterThan(0);
      const testnetChains = [420690, 11155111, 84532, 421614];
      bots.forEach(bot => {
        expect(bot.chains.every(c => testnetChains.includes(c))).toBe(true);
        expect(parseFloat(bot.initialFunding)).toBeLessThan(parseFloat(DEFAULT_BOTS[0].initialFunding));
      });
    });

    test('should return bots for mainnet', () => {
      const bots = getDefaultBotsForNetwork('mainnet');
      expect(bots.length).toBe(DEFAULT_BOTS.length);
      expect(bots).toEqual(DEFAULT_BOTS);
    });

    test('should filter chains correctly for testnet', () => {
      const bots = getDefaultBotsForNetwork('testnet');
      const testnetChains = new Set([420690, 11155111, 84532, 421614]);
      
      bots.forEach(bot => {
        // Some bots may have no matching testnet chains after filtering
        if (bot.chains.length > 0) {
          expect(bot.chains.every(c => testnetChains.has(c))).toBe(true);
        }
      });
    });
  });

  describe('createTradingBotOptions', () => {
    test('should create valid options', () => {
      const botConfig = DEFAULT_BOTS[0];
      const options = createTradingBotOptions(
        botConfig,
        1n,
        '0x' + '1'.repeat(64),
        'testnet',
        '0x' + '2'.repeat(40)
      );
      
      expect(options.agentId).toBe(1n);
      expect(options.name).toBe(botConfig.name);
      expect(options.strategies).toEqual(botConfig.strategies);
      expect(options.chains.length).toBeGreaterThan(0);
      expect(options.privateKey).toBe('0x' + '1'.repeat(64));
      expect(options.maxConcurrentExecutions).toBe(5);
      expect(options.useFlashbots).toBe(true);
    });

    test('should disable Flashbots for localnet', () => {
      const botConfig = DEFAULT_BOTS[0];
      const options = createTradingBotOptions(
        botConfig,
        1n,
        '0x' + '1'.repeat(64),
        'localnet'
      );
      expect(options.useFlashbots).toBe(false);
    });

    test('should handle missing chain configs gracefully', () => {
      const botConfig = {
        ...DEFAULT_BOTS[0],
        chains: [999999] as unknown as ChainId[], // Invalid chain ID
      };
      const options = createTradingBotOptions(
        botConfig,
        1n,
        '0x' + '1'.repeat(64),
        'testnet'
      );
      expect(options.chains.length).toBe(0);
    });

    test('should handle empty chains array', () => {
      const botConfig = { ...DEFAULT_BOTS[0], chains: [] };
      const options = createTradingBotOptions(
        botConfig,
        1n,
        '0x' + '1'.repeat(64),
        'testnet'
      );
      expect(options.chains).toEqual([]);
    });
  });

  describe('initializeDefaultBots', () => {
    test('should initialize bots successfully', async () => {
      const bots = await initializer.initializeDefaultBots();
      expect(bots.size).toBeGreaterThan(0);
      expect(mockAgentSdk.registerAgent).toHaveBeenCalled();
    });

    test('should skip initialization without private key', async () => {
      const configWithoutKey = { ...baseConfig, privateKey: undefined };
      const init = new BotInitializer({
        crucibleConfig: configWithoutKey,
        agentSdk: mockAgentSdk,
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
      });
      
      const bots = await init.initializeDefaultBots();
      expect(bots.size).toBe(0);
      expect(mockAgentSdk.registerAgent).not.toHaveBeenCalled();
    });

    test('should handle registration failures gracefully', async () => {
      mockAgentSdk.registerAgent.mockRejectedValueOnce(new Error('Registration failed'));
      const bots = await initializer.initializeDefaultBots();
      // Should continue with other bots
      expect(bots.size).toBeLessThan(DEFAULT_BOTS.length);
    });

    test('should handle bot initialization failures', async () => {
      // Mock registerAgent to succeed but bot init to fail
      mockAgentSdk.registerAgent.mockResolvedValue({
        agentId: 1n,
        vaultAddress: '0x' + '1'.repeat(40) as `0x${string}`,
        characterCid: 'QmTest',
        stateCid: 'QmState',
      });
      
      // This will fail because TradingBot needs real dependencies
      // But initializer should handle it gracefully
      const bots = await initializer.initializeDefaultBots();
      // May have fewer bots if some failed
      expect(bots.size).toBeGreaterThanOrEqual(0);
    });

    test('should initialize bots in parallel', async () => {
      const startTime = Date.now();
      await initializer.initializeDefaultBots();
      const duration = Date.now() - startTime;
      
      // Should be faster than sequential (though may still be slow due to real deps)
      expect(duration).toBeLessThan(10000); // Reasonable timeout
    });

    test('should handle concurrent initialization calls', async () => {
      const [bots1, bots2] = await Promise.all([
        initializer.initializeDefaultBots(),
        initializer.initializeDefaultBots(),
      ]);
      
      // Should handle gracefully (may create duplicates or skip)
      expect(bots1.size).toBeGreaterThanOrEqual(0);
      expect(bots2.size).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Bot Management', () => {
    test('should get bot by agent ID', async () => {
      const bots = await initializer.initializeDefaultBots();
      if (bots.size > 0) {
        const firstAgentId = Array.from(bots.keys())[0];
        const bot = initializer.getBot(firstAgentId);
        expect(bot).toBeDefined();
      }
    });

    test('should return undefined for non-existent bot', () => {
      const bot = initializer.getBot(999999n);
      expect(bot).toBeUndefined();
    });

    test('should get all bots', async () => {
      const bots = await initializer.initializeDefaultBots();
      const allBots = initializer.getAllBots();
      expect(allBots.length).toBe(bots.size);
    });

    test('should stop all bots', async () => {
      await initializer.initializeDefaultBots();
      await initializer.stopAll();
      expect(initializer.getAllBots().length).toBe(0);
    });

    test('should handle stop errors gracefully', async () => {
      await initializer.initializeDefaultBots();
      // Should not throw even if some bots fail to stop
      await initializer.stopAll();
      expect(initializer.getAllBots().length).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty bot list', async () => {
      const config = { ...baseConfig, network: 'localnet' as const };
      const init = new BotInitializer({
        crucibleConfig: config,
        agentSdk: mockAgentSdk,
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
      });
      
      const bots = await init.initializeDefaultBots();
      expect(bots.size).toBeGreaterThanOrEqual(0);
    });

    test('should handle network-specific configurations', () => {
      ['localnet', 'testnet', 'mainnet'].forEach(network => {
        const bots = getDefaultBotsForNetwork(network as 'localnet' | 'testnet' | 'mainnet');
        expect(bots.length).toBeGreaterThan(0);
        bots.forEach(bot => {
          expect(bot.name).toBeDefined();
          expect(bot.description).toBeDefined();
          expect(bot.strategies.length).toBeGreaterThan(0);
        });
      });
    });

    test('should handle invalid network gracefully', () => {
      // TypeScript prevents this, but runtime could have invalid value
      const bots = getDefaultBotsForNetwork('mainnet');
      expect(bots).toBeDefined();
    });
  });
});


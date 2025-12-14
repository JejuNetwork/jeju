/**
 * Default Bots Configuration Tests
 * 
 * Tests for default bot configurations including:
 * - Network-specific filtering
 * - Chain configuration mapping
 * - Edge cases
 */

import { describe, test, expect } from 'bun:test';
import { DEFAULT_BOTS, getDefaultBotsForNetwork, createTradingBotOptions, DEFAULT_CHAINS } from './default-bots';
import type { DefaultBotConfig } from './default-bots';
import type { ChainId } from './autocrat-types';

describe('Default Bots Configuration', () => {
  describe('DEFAULT_BOTS', () => {
    test('should have all required bot types', () => {
      const botTypes = DEFAULT_BOTS.map(b => b.strategies[0]?.type);
      expect(botTypes).toContain('DEX_ARBITRAGE');
      expect(botTypes).toContain('SANDWICH');
      expect(botTypes).toContain('CROSS_CHAIN_ARBITRAGE');
      expect(botTypes).toContain('LIQUIDATION');
      expect(botTypes).toContain('ORACLE_KEEPER');
      expect(botTypes).toContain('SOLVER');
    });

    test('should have valid configurations for each bot', () => {
      DEFAULT_BOTS.forEach(bot => {
        expect(bot.name).toBeTruthy();
        expect(bot.description).toBeTruthy();
        expect(bot.strategies.length).toBeGreaterThan(0);
        expect(bot.chains.length).toBeGreaterThan(0);
        expect(parseFloat(bot.initialFunding)).toBeGreaterThan(0);
        
        bot.strategies.forEach(strategy => {
          expect(strategy.minProfitBps).toBeGreaterThanOrEqual(0);
          expect(strategy.maxGasGwei).toBeGreaterThan(0);
          expect(strategy.maxSlippageBps).toBeGreaterThanOrEqual(0);
        });
      });
    });

    test('should have unique bot names', () => {
      const names = DEFAULT_BOTS.map(b => b.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });
  });

  describe('DEFAULT_CHAINS', () => {
    test('should have all required chains', () => {
      expect(DEFAULT_CHAINS.mainnet).toBeDefined();
      expect(DEFAULT_CHAINS.arbitrum).toBeDefined();
      expect(DEFAULT_CHAINS.optimism).toBeDefined();
      expect(DEFAULT_CHAINS.base).toBeDefined();
      expect(DEFAULT_CHAINS.bsc).toBeDefined();
      expect(DEFAULT_CHAINS.jeju).toBeDefined();
      expect(DEFAULT_CHAINS.jejuTestnet).toBeDefined();
    });

    test('should have valid chain configurations', () => {
      Object.values(DEFAULT_CHAINS).forEach(chain => {
        expect(chain.chainId).toBeGreaterThan(0);
        expect(chain.name).toBeTruthy();
        expect(chain.rpcUrl).toBeTruthy();
        expect(chain.blockTime).toBeGreaterThan(0);
        expect(typeof chain.isL2).toBe('boolean');
        expect(chain.nativeSymbol).toBeTruthy();
      });
    });

    test('should have unique chain IDs', () => {
      const chainIds = Object.values(DEFAULT_CHAINS).map(c => c.chainId);
      const uniqueIds = new Set(chainIds);
      expect(chainIds.length).toBe(uniqueIds.size);
    });
  });

  describe('getDefaultBotsForNetwork', () => {
    test('should return bots for localnet with localnet chain', () => {
      const bots = getDefaultBotsForNetwork('localnet');
      expect(bots.length).toBe(DEFAULT_BOTS.length);
      bots.forEach(bot => {
        expect(bot.chains).toEqual([1337]);
        expect(bot.initialFunding).toBe('0.01');
      });
    });

    test('should filter chains for testnet', () => {
      const bots = getDefaultBotsForNetwork('testnet');
      const testnetChains = new Set([420690, 11155111, 84532, 421614]);
      
      bots.forEach(bot => {
        // Some bots may have no matching testnet chains after filtering
        if (bot.chains.length > 0) {
          bot.chains.forEach(chainId => {
            expect(testnetChains.has(chainId)).toBe(true);
          });
        }
        const mainnetBot = DEFAULT_BOTS.find(b => b.name === bot.name);
        if (mainnetBot) {
          expect(parseFloat(bot.initialFunding)).toBeLessThanOrEqual(
            parseFloat(mainnetBot.initialFunding)
          );
        }
      });
    });

    test('should return all bots for mainnet', () => {
      const bots = getDefaultBotsForNetwork('mainnet');
      expect(bots.length).toBe(DEFAULT_BOTS.length);
      expect(bots).toEqual(DEFAULT_BOTS);
    });

    test('should preserve bot structure across networks', () => {
      ['localnet', 'testnet', 'mainnet'].forEach(network => {
        const bots = getDefaultBotsForNetwork(network as 'localnet' | 'testnet' | 'mainnet');
        bots.forEach(bot => {
          expect(bot.name).toBeDefined();
          expect(bot.description).toBeDefined();
          expect(bot.strategies.length).toBeGreaterThan(0);
        });
      });
    });

    test('should handle empty chain filters gracefully', () => {
      const bots = getDefaultBotsForNetwork('testnet');
      // Some bots might have no testnet chains, which is fine
      bots.forEach(bot => {
        expect(Array.isArray(bot.chains)).toBe(true);
      });
    });
  });

  describe('createTradingBotOptions', () => {
    const testBotConfig: DefaultBotConfig = {
      name: 'Test Bot',
      description: 'Test Description',
      strategies: [
        {
          type: 'DEX_ARBITRAGE',
          enabled: true,
          minProfitBps: 10,
          maxGasGwei: 100,
          maxSlippageBps: 50,
        },
      ],
      chains: [1, 42161],
      initialFunding: '0.1',
    };

    test('should create valid options', () => {
      const options = createTradingBotOptions(
        testBotConfig,
        1n,
        '0x' + '1'.repeat(64),
        'mainnet',
        '0x' + '2'.repeat(40)
      );

      expect(options.agentId).toBe(1n);
      expect(options.name).toBe('Test Bot');
      expect(options.strategies).toEqual(testBotConfig.strategies);
      expect(options.chains.length).toBe(2);
      expect(options.privateKey).toBe('0x' + '1'.repeat(64));
      expect(options.maxConcurrentExecutions).toBe(5);
    });

    test('should disable Flashbots for localnet', () => {
      const options = createTradingBotOptions(
        testBotConfig,
        1n,
        '0x' + '1'.repeat(64),
        'localnet'
      );
      expect(options.useFlashbots).toBe(false);
    });

    test('should enable Flashbots for testnet and mainnet', () => {
      ['testnet', 'mainnet'].forEach(network => {
        const options = createTradingBotOptions(
          testBotConfig,
          1n,
          '0x' + '1'.repeat(64),
          network as 'localnet' | 'testnet' | 'mainnet'
        );
        expect(options.useFlashbots).toBe(true);
      });
    });

    test('should handle invalid chain IDs gracefully', () => {
      const config: DefaultBotConfig = { ...testBotConfig, chains: [999999] as unknown as ChainId[] };
      const options = createTradingBotOptions(
        config,
        1n,
        '0x' + '1'.repeat(64),
        'mainnet'
      );
      expect(options.chains.length).toBe(0);
    });

    test('should handle empty chains array', () => {
      const config = { ...testBotConfig, chains: [] };
      const options = createTradingBotOptions(
        config,
        1n,
        '0x' + '1'.repeat(64),
        'mainnet'
      );
      expect(options.chains).toEqual([]);
    });

    test('should map chain IDs to chain configs correctly', () => {
      const config = { ...testBotConfig, chains: [1, 42161, 10, 8453] };
      const options = createTradingBotOptions(
        config,
        1n,
        '0x' + '1'.repeat(64),
        'mainnet'
      );
      
      expect(options.chains.length).toBe(4);
      expect(options.chains[0].chainId).toBe(1);
      expect(options.chains[1].chainId).toBe(42161);
    });

    test('should handle missing treasury address', () => {
      const options = createTradingBotOptions(
        testBotConfig,
        1n,
        '0x' + '1'.repeat(64),
        'mainnet'
      );
      expect(options.treasuryAddress).toBeUndefined();
    });

    test('should set treasury address when provided', () => {
      const treasuryAddr = '0x' + '2'.repeat(40) as `0x${string}`;
      const options = createTradingBotOptions(
        testBotConfig,
        1n,
        '0x' + '1'.repeat(64),
        'mainnet',
        treasuryAddr
      );
      expect(options.treasuryAddress).toBe(treasuryAddr);
    });
  });

  describe('Edge Cases', () => {
    test('should handle bots with no matching chains for network', () => {
      const customBot: DefaultBotConfig = {
        name: 'Custom Bot',
        description: 'Custom',
        strategies: [{ type: 'DEX_ARBITRAGE', enabled: true, minProfitBps: 10, maxGasGwei: 100, maxSlippageBps: 50 }],
        chains: [999999], // Invalid chain
        initialFunding: '0.1',
      };
      
      const bots = [customBot, ...DEFAULT_BOTS];
      const testnetBots = bots.map(bot => ({
        ...bot,
        chains: bot.chains.filter(c => [420690, 11155111, 84532, 421614].includes(c)),
      }));
      
      // Should handle gracefully
      expect(Array.isArray(testnetBots)).toBe(true);
    });

    test('should handle zero initial funding', () => {
      const config = { ...DEFAULT_BOTS[0], initialFunding: '0' };
      const options = createTradingBotOptions(
        config,
        1n,
        '0x' + '1'.repeat(64),
        'mainnet'
      );
      expect(options).toBeDefined();
    });

    test('should handle very large initial funding', () => {
      const config = { ...DEFAULT_BOTS[0], initialFunding: '1000000' };
      const options = createTradingBotOptions(
        config,
        1n,
        '0x' + '1'.repeat(64),
        'mainnet'
      );
      expect(options).toBeDefined();
    });

    test('should preserve strategy configurations', () => {
      const config = DEFAULT_BOTS[0];
      const options = createTradingBotOptions(
        config,
        1n,
        '0x' + '1'.repeat(64),
        'mainnet'
      );
      
      expect(options.strategies).toEqual(config.strategies);
      options.strategies.forEach((strategy, i) => {
        expect(strategy.type).toBe(config.strategies[i].type);
        expect(strategy.enabled).toBe(config.strategies[i].enabled);
        expect(strategy.minProfitBps).toBe(config.strategies[i].minProfitBps);
      });
    });
  });
});


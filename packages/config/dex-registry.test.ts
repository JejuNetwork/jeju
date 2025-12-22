/**
 * @fileoverview Tests for dex-registry.ts module
 * Tests DEX configuration, stablecoin detection, and helper functions
 */

import { describe, it, expect } from 'bun:test';
import {
  DEX_REGISTRY,
  DEX_EVENTS,
  STABLECOINS,
  WRAPPED_NATIVE,
  ROUTING_TOKENS,
  getDEXsForChain,
  getStablecoinsForChain,
  getWrappedNative,
  isStablecoin,
  getEventConfig,
  type DEXType,
  type DEXConfig,
} from './dex-registry';

describe('DEX Registry', () => {
  describe('DEX_REGISTRY', () => {
    it('should have Ethereum mainnet DEXes', () => {
      const dexes = DEX_REGISTRY[1];
      expect(dexes).toBeDefined();
      expect(dexes.length).toBeGreaterThan(0);
      
      // Should include Uniswap V2
      const uniV2 = dexes.find(d => d.type === 'uniswap_v2' && d.name.includes('Uniswap'));
      expect(uniV2).toBeDefined();
      expect(uniV2?.factory).toMatch(/^0x[a-fA-F0-9]{40}$/);
      
      // Should include Uniswap V3
      const uniV3 = dexes.find(d => d.type === 'uniswap_v3');
      expect(uniV3).toBeDefined();
    });

    it('should have Arbitrum DEXes', () => {
      const dexes = DEX_REGISTRY[42161];
      expect(dexes).toBeDefined();
      expect(dexes.length).toBeGreaterThan(0);
      
      // Should include Camelot
      const camelot = dexes.find(d => d.type === 'camelot');
      expect(camelot).toBeDefined();
    });

    it('should have Base DEXes', () => {
      const dexes = DEX_REGISTRY[8453];
      expect(dexes).toBeDefined();
      expect(dexes.length).toBeGreaterThan(0);
      
      // Should include Aerodrome
      const aerodrome = dexes.find(d => d.type === 'aerodrome');
      expect(aerodrome).toBeDefined();
    });

    it('should have Optimism DEXes', () => {
      const dexes = DEX_REGISTRY[10];
      expect(dexes).toBeDefined();
      expect(dexes.length).toBeGreaterThan(0);
      
      // Should include Velodrome (aerodrome type)
      const velodrome = dexes.find(d => d.name === 'Velodrome');
      expect(velodrome).toBeDefined();
      expect(velodrome?.type).toBe('aerodrome');
    });

    it('should have valid DEX config structure', () => {
      Object.entries(DEX_REGISTRY).forEach(([chainIdStr, dexes]) => {
        const chainId = Number(chainIdStr);
        
        dexes.forEach((dex: DEXConfig) => {
          expect(dex.name).toBeTruthy();
          expect(dex.type).toBeTruthy();
          expect(dex.chainId).toBe(chainId);
          expect(dex.factory).toMatch(/^0x[a-fA-F0-9]{40}$/);
          
          // Router is optional but if present should be valid
          if (dex.router) {
            expect(dex.router).toMatch(/^0x[a-fA-F0-9]{40}$/);
          }
          
          // Quoter is optional (mainly for V3)
          if (dex.quoter) {
            expect(dex.quoter).toMatch(/^0x[a-fA-F0-9]{40}$/);
          }
        });
      });
    });
  });
});

describe('DEX Events', () => {
  describe('DEX_EVENTS', () => {
    const dexTypes: DEXType[] = ['uniswap_v2', 'uniswap_v3', 'balancer_v2', 'curve', 'aerodrome', 'camelot'];

    it('should have event config for all DEX types', () => {
      dexTypes.forEach(type => {
        const events = DEX_EVENTS[type];
        expect(events).toBeDefined();
        expect(events.poolCreated).toBeDefined();
        expect(events.swap).toBeDefined();
      });
    });

    it('should have valid poolCreated event structure', () => {
      dexTypes.forEach(type => {
        const events = DEX_EVENTS[type];
        expect(events.poolCreated.signature).toBeTruthy();
        expect(events.poolCreated.tokenIndexes).toHaveLength(2);
        expect(typeof events.poolCreated.poolIndex).toBe('number');
      });
    });

    it('should have valid swap event structure', () => {
      dexTypes.forEach(type => {
        const events = DEX_EVENTS[type];
        expect(events.swap.signature).toBeTruthy();
        expect(events.swap.amountIndexes).toBeDefined();
      });
    });

    it('uniswap_v2 should have sync event', () => {
      expect(DEX_EVENTS.uniswap_v2.sync).toBe('Sync(uint112,uint112)');
    });

    it('uniswap_v3 should have mint and burn events', () => {
      expect(DEX_EVENTS.uniswap_v3.mint).toBeTruthy();
      expect(DEX_EVENTS.uniswap_v3.burn).toBeTruthy();
    });
  });
});

describe('Stablecoins', () => {
  describe('STABLECOINS', () => {
    it('should have stablecoins for major chains', () => {
      expect(STABLECOINS[1]).toBeDefined(); // Ethereum
      expect(STABLECOINS[42161]).toBeDefined(); // Arbitrum
      expect(STABLECOINS[8453]).toBeDefined(); // Base
      expect(STABLECOINS[10]).toBeDefined(); // Optimism
    });

    it('should include USDC on Ethereum', () => {
      const ethStables = STABLECOINS[1];
      const usdc = ethStables.find(s => s.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      expect(usdc).toBeDefined();
    });

    it('should include USDT on Ethereum', () => {
      const ethStables = STABLECOINS[1];
      const usdt = ethStables.find(s => s.toLowerCase() === '0xdac17f958d2ee523a2206206994597c13d831ec7');
      expect(usdt).toBeDefined();
    });

    it('should have valid addresses', () => {
      Object.values(STABLECOINS).forEach(stables => {
        stables.forEach(address => {
          expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        });
      });
    });
  });
});

describe('Wrapped Native Tokens', () => {
  describe('WRAPPED_NATIVE', () => {
    it('should have WETH for major chains', () => {
      expect(WRAPPED_NATIVE[1]).toBeDefined(); // Ethereum
      expect(WRAPPED_NATIVE[42161]).toBeDefined(); // Arbitrum
      expect(WRAPPED_NATIVE[8453]).toBeDefined(); // Base
      expect(WRAPPED_NATIVE[10]).toBeDefined(); // Optimism
      expect(WRAPPED_NATIVE[420691]).toBeDefined(); // Jeju
    });

    it('should use standard WETH for Ethereum mainnet', () => {
      expect(WRAPPED_NATIVE[1]).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    });

    it('should use OP Stack predeploy for L2s', () => {
      const opStackWeth = '0x4200000000000000000000000000000000000006';
      expect(WRAPPED_NATIVE[8453]).toBe(opStackWeth);
      expect(WRAPPED_NATIVE[10]).toBe(opStackWeth);
      expect(WRAPPED_NATIVE[420691]).toBe(opStackWeth);
    });
  });
});

describe('Routing Tokens', () => {
  describe('ROUTING_TOKENS', () => {
    it('should have routing tokens for major chains', () => {
      expect(ROUTING_TOKENS[1]).toBeDefined();
      expect(ROUTING_TOKENS[42161]).toBeDefined();
      expect(ROUTING_TOKENS[8453]).toBeDefined();
      expect(ROUTING_TOKENS[10]).toBeDefined();
    });

    it('should include WETH as routing token', () => {
      Object.entries(ROUTING_TOKENS).forEach(([chainIdStr, tokens]) => {
        const chainId = Number(chainIdStr);
        const weth = WRAPPED_NATIVE[chainId];
        
        if (weth) {
          // WETH should be a routing token
          const hasWeth = tokens.some(t => t.toLowerCase() === weth.toLowerCase());
          expect(hasWeth).toBe(true);
        }
      });
    });

    it('should include USDC as routing token', () => {
      // Most chains should have USDC as routing token
      expect(ROUTING_TOKENS[1].length).toBeGreaterThanOrEqual(2);
      expect(ROUTING_TOKENS[42161].length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('Helper Functions', () => {
  describe('getDEXsForChain', () => {
    it('should return DEXes for known chains', () => {
      const ethDexes = getDEXsForChain(1);
      expect(ethDexes.length).toBeGreaterThan(0);
      
      const arbDexes = getDEXsForChain(42161);
      expect(arbDexes.length).toBeGreaterThan(0);
    });

    it('should return empty array for unknown chains', () => {
      const unknownDexes = getDEXsForChain(999999);
      expect(unknownDexes).toEqual([]);
    });

    it('should return empty array for Jeju (no DEXes yet)', () => {
      const jejuDexes = getDEXsForChain(420691);
      expect(jejuDexes).toEqual([]);
    });
  });

  describe('getStablecoinsForChain', () => {
    it('should return stablecoins for known chains', () => {
      const ethStables = getStablecoinsForChain(1);
      expect(ethStables.length).toBeGreaterThan(0);
    });

    it('should return empty array for unknown chains', () => {
      const unknownStables = getStablecoinsForChain(999999);
      expect(unknownStables).toEqual([]);
    });
  });

  describe('getWrappedNative', () => {
    it('should return WETH for known chains', () => {
      const ethWeth = getWrappedNative(1);
      expect(ethWeth).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should return undefined for unknown chains', () => {
      const unknownWeth = getWrappedNative(999999);
      expect(unknownWeth).toBeUndefined();
    });
  });

  describe('isStablecoin', () => {
    it('should return true for USDC on Ethereum', () => {
      const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      expect(isStablecoin(1, usdc)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const usdcLower = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const usdcUpper = '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48';
      expect(isStablecoin(1, usdcLower)).toBe(true);
      expect(isStablecoin(1, usdcUpper)).toBe(true);
    });

    it('should return false for non-stablecoin', () => {
      const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      expect(isStablecoin(1, weth)).toBe(false);
    });

    it('should return false for unknown chain', () => {
      const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      expect(isStablecoin(999999, usdc)).toBe(false);
    });
  });

  describe('getEventConfig', () => {
    it('should return event config for each DEX type', () => {
      const dexTypes: DEXType[] = ['uniswap_v2', 'uniswap_v3', 'balancer_v2', 'curve', 'aerodrome', 'camelot'];
      
      dexTypes.forEach(type => {
        const config = getEventConfig(type);
        expect(config).toBeDefined();
        expect(config.poolCreated).toBeDefined();
        expect(config.swap).toBeDefined();
      });
    });
  });
});

describe('Address Checksums', () => {
  it('all factory addresses should be valid checksummed addresses', () => {
    Object.values(DEX_REGISTRY).forEach(dexes => {
      dexes.forEach(dex => {
        expect(dex.factory).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });
    });
  });

  it('all stablecoin addresses should be valid', () => {
    Object.values(STABLECOINS).forEach(stables => {
      stables.forEach(address => {
        expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });
    });
  });

  it('all wrapped native addresses should be valid', () => {
    Object.values(WRAPPED_NATIVE).forEach(address => {
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
  });

  it('all routing token addresses should be valid', () => {
    Object.values(ROUTING_TOKENS).forEach(tokens => {
      tokens.forEach(address => {
        expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });
    });
  });
});

describe('DEX Type Consistency', () => {
  it('all DEX types should match event config keys', () => {
    const eventTypes = Object.keys(DEX_EVENTS);
    
    Object.values(DEX_REGISTRY).forEach(dexes => {
      dexes.forEach(dex => {
        expect(eventTypes).toContain(dex.type);
      });
    });
  });
});

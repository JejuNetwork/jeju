/**
 * Token Equality Tests
 * 
 * Ensures all protocol tokens (elizaOS, CLANKER, VIRTUAL, CLANKERMON) are treated equally
 * and have complete configurations
 */

import { getProtocolTokens, getAllTokens, getTokenBySymbol, getTokenByAddress } from '../tokens';

describe('Token Equality and Completeness', () => {
  const protocolTokens = getProtocolTokens();
  const allTokens = getAllTokens();

  describe('elizaOS Token (Native)', () => {
    it('should be included in protocol tokens', () => {
      const elizaOS = getTokenBySymbol('elizaOS');
      expect(elizaOS).toBeDefined();
      expect(elizaOS?.symbol).toBe('elizaOS');
    });

    it('should be marked as native (not bridged)', () => {
      const elizaOS = protocolTokens.find(t => t.symbol === 'elizaOS');
      expect(elizaOS?.bridged).toBe(false);
      expect(elizaOS?.originChain).toBe('jeju');
    });

    it('should have paymaster deployed', () => {
      const elizaOS = protocolTokens.find(t => t.symbol === 'elizaOS');
      expect(elizaOS?.hasPaymaster).toBe(true);
    });

    it('should have all required addresses', () => {
      const elizaOS = protocolTokens.find(t => t.symbol === 'elizaOS');
      expect(elizaOS?.address).toBeDefined();
      expect(elizaOS?.address).not.toBe('0x0000000000000000000000000000000000000000');
    });

    it('should have complete configuration', () => {
      const elizaOS = protocolTokens.find(t => t.symbol === 'elizaOS');
      expect(elizaOS?.name).toBe('elizaOS Token');
      expect(elizaOS?.decimals).toBe(18);
      expect(elizaOS?.priceUSD).toBe(0.10);
      expect(elizaOS?.logoUrl).toBeDefined();
    });

    it('should NOT appear in bridgeable tokens', () => {
      const bridgeable = protocolTokens.filter(t => t.bridged);
      const hasElizaOS = bridgeable.some(t => t.symbol === 'elizaOS');
      expect(hasElizaOS).toBe(false);
    });

    it('should appear FIRST in token list', () => {
      expect(protocolTokens[0].symbol).toBe('elizaOS');
    });
  });

  describe('CLANKER Token (Bridged from Ethereum)', () => {
    it('should be included in protocol tokens', () => {
      const clanker = getTokenBySymbol('CLANKER');
      expect(clanker).toBeDefined();
      expect(clanker?.symbol).toBe('CLANKER');
    });

    it('should be marked as bridged from Ethereum', () => {
      const clanker = protocolTokens.find(t => t.symbol === 'CLANKER');
      expect(clanker?.bridged).toBe(true);
      expect(clanker?.originChain).toBe('ethereum');
      expect(clanker?.l1Address).toBeDefined();
    });

    it('should have paymaster deployed', () => {
      const clanker = protocolTokens.find(t => t.symbol === 'CLANKER');
      expect(clanker?.hasPaymaster).toBe(true);
    });

    it('should have complete configuration', () => {
      const clanker = protocolTokens.find(t => t.symbol === 'CLANKER');
      expect(clanker?.name).toBe('tokenbot');
      expect(clanker?.decimals).toBe(18);
      expect(clanker?.priceUSD).toBe(26.14);
      expect(clanker?.logoUrl).toBeDefined();
    });
  });

  describe('VIRTUAL Token (Bridged from Ethereum)', () => {
    it('should be included in protocol tokens', () => {
      const virtual = getTokenBySymbol('VIRTUAL');
      expect(virtual).toBeDefined();
      expect(virtual?.symbol).toBe('VIRTUAL');
    });

    it('should be marked as bridged from Ethereum', () => {
      const virtual = protocolTokens.find(t => t.symbol === 'VIRTUAL');
      expect(virtual?.bridged).toBe(true);
      expect(virtual?.originChain).toBe('ethereum');
      expect(virtual?.l1Address).toBeDefined();
    });

    it('should have paymaster deployed', () => {
      const virtual = protocolTokens.find(t => t.symbol === 'VIRTUAL');
      expect(virtual?.hasPaymaster).toBe(true);
    });

    it('should have complete configuration', () => {
      const virtual = protocolTokens.find(t => t.symbol === 'VIRTUAL');
      expect(virtual?.name).toBe('Virtuals Protocol');
      expect(virtual?.decimals).toBe(18);
      expect(virtual?.priceUSD).toBe(1.85);
      expect(virtual?.logoUrl).toBeDefined();
    });
  });

  describe('CLANKERMON Token (Bridged from Ethereum)', () => {
    it('should be included in protocol tokens', () => {
      const clankermon = getTokenBySymbol('CLANKERMON');
      expect(clankermon).toBeDefined();
      expect(clankermon?.symbol).toBe('CLANKERMON');
    });

    it('should be marked as bridged from Ethereum', () => {
      const clankermon = protocolTokens.find(t => t.symbol === 'CLANKERMON');
      expect(clankermon?.bridged).toBe(true);
      expect(clankermon?.originChain).toBe('ethereum');
      expect(clankermon?.l1Address).toBeDefined();
    });

    it('should have paymaster deployed', () => {
      const clankermon = protocolTokens.find(t => t.symbol === 'CLANKERMON');
      expect(clankermon?.hasPaymaster).toBe(true);
    });

    it('should have complete configuration', () => {
      const clankermon = protocolTokens.find(t => t.symbol === 'CLANKERMON');
      expect(clankermon?.name).toBe('Clankermon');
      expect(clankermon?.decimals).toBe(18);
      expect(clankermon?.priceUSD).toBe(0.15);
      expect(clankermon?.logoUrl).toBeDefined();
    });
  });

  describe('Token Equality', () => {
    it('should have exactly 4 protocol tokens', () => {
      expect(protocolTokens.length).toBe(4);
    });

    it('should include all 4 tokens: elizaOS, CLANKER, VIRTUAL, CLANKERMON', () => {
      const symbols = protocolTokens.map(t => t.symbol).sort();
      expect(symbols).toEqual(['CLANKER', 'CLANKERMON', 'VIRTUAL', 'elizaOS']);
    });

    it('should treat all tokens with equal structure', () => {
      protocolTokens.forEach(token => {
        expect(token.symbol).toBeDefined();
        expect(token.name).toBeDefined();
        expect(token.address).toBeDefined();
        expect(token.decimals).toBe(18); // All should be 18 decimals
        expect(token.priceUSD).toBeGreaterThan(0);
        expect(token.hasPaymaster).toBe(true); // All should have paymasters
        expect(token.logoUrl).toBeDefined();
      });
    });

    it('should have 1 native token (elizaOS) and 3 bridged tokens', () => {
      const native = protocolTokens.filter(t => !t.bridged);
      const bridged = protocolTokens.filter(t => t.bridged);
      
      expect(native.length).toBe(1);
      expect(bridged.length).toBe(3);
      expect(native[0].symbol).toBe('elizaOS');
    });

    it('should have Base addresses for all bridged tokens', () => {
      const bridged = protocolTokens.filter(t => t.bridged);
      bridged.forEach(token => {
        expect(token.l1Address).toBeDefined();
        expect(token.l1Address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });
    });

    it('should be retrievable by symbol (case-insensitive)', () => {
      expect(getTokenBySymbol('elizaOS')).toBeDefined();
      expect(getTokenBySymbol('ELIZAOS')).toBeDefined();
      expect(getTokenBySymbol('clanker')).toBeDefined();
      expect(getTokenBySymbol('VIRTUAL')).toBeDefined();
      expect(getTokenBySymbol('clankermon')).toBeDefined();
    });

    it('should be retrievable by address (case-insensitive)', () => {
      protocolTokens.forEach(token => {
        const found = getTokenByAddress(token.address);
        expect(found).toBeDefined();
        expect(found?.symbol).toBe(token.symbol);
        
        // Test uppercase
        const foundUpper = getTokenByAddress(token.address.toUpperCase());
        expect(foundUpper).toBeDefined();
      });
    });
  });

  describe('Bridge Filtering', () => {
    it('should exclude elizaOS from bridgeable tokens', () => {
      const bridgeable = protocolTokens.filter(t => t.bridged);
      const hasElizaOS = bridgeable.some(t => t.symbol === 'elizaOS');
      expect(hasElizaOS).toBe(false);
    });

    it('should include CLANKER, VIRTUAL, CLANKERMON in bridgeable tokens', () => {
      const bridgeable = protocolTokens.filter(t => t.bridged);
      const symbols = bridgeable.map(t => t.symbol).sort();
      expect(symbols).toEqual(['CLANKER', 'CLANKERMON', 'VIRTUAL']);
    });
  });

  describe('Complete Token Coverage', () => {
    const requiredTokens = ['elizaOS', 'CLANKER', 'VIRTUAL', 'CLANKERMON'];

    requiredTokens.forEach(symbol => {
      it(`should have ${symbol} in all token lists`, () => {
        // In protocol tokens
        const inProtocol = protocolTokens.find(t => t.symbol === symbol);
        expect(inProtocol).toBeDefined();

        // In all tokens
        const inAll = allTokens.find(t => t.symbol === symbol);
        expect(inAll).toBeDefined();

        // Retrievable by symbol
        const bySymbol = getTokenBySymbol(symbol);
        expect(bySymbol).toBeDefined();

        // Retrievable by address
        if (inProtocol?.address) {
          const byAddress = getTokenByAddress(inProtocol.address);
          expect(byAddress).toBeDefined();
        }
      });
    });
  });
});


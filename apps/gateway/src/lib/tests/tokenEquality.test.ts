/**
 * Token Equality Tests
 * 
 * Ensures all protocol tokens (JEJU, elizaOS, CLANKER, VIRTUAL, CLANKERMON) are treated equally
 * and have complete configurations.
 */

import { getProtocolTokens, getAllTokens, getTokenBySymbol, getTokenByAddress, getPreferredToken, getPaymasterTokens, hasBanEnforcement } from '../tokens';

describe('Token Equality and Completeness', () => {
  const protocolTokens = getProtocolTokens();
  const allTokens = getAllTokens();

  describe('JEJU Token (Native)', () => {
    it('should be included in protocol tokens', () => {
      const jeju = getTokenBySymbol('JEJU');
      expect(jeju).toBeDefined();
      expect(jeju?.symbol).toBe('JEJU');
    });

    it('should be marked as native (not bridged)', () => {
      const jeju = protocolTokens.find(t => t.symbol === 'JEJU');
      expect(jeju?.bridged).toBe(false);
      expect(jeju?.originChain).toBe('jeju');
    });

    it('should be marked as preferred', () => {
      const jeju = protocolTokens.find(t => t.symbol === 'JEJU');
      expect(jeju?.isPreferred).toBe(true);
    });

    it('should have ban enforcement enabled', () => {
      const jeju = protocolTokens.find(t => t.symbol === 'JEJU');
      expect(jeju?.hasBanEnforcement).toBe(true);
      expect(hasBanEnforcement('JEJU')).toBe(true);
    });

    it('should be returned by getPreferredToken', () => {
      const preferred = getPreferredToken();
      expect(preferred).toBeDefined();
      expect(preferred?.symbol).toBe('JEJU');
    });

    it('should appear FIRST in paymaster tokens', () => {
      const paymasterTokens = getPaymasterTokens();
      expect(paymasterTokens[0].symbol).toBe('JEJU');
    });

    it('should appear FIRST in protocol tokens list', () => {
      expect(protocolTokens[0].symbol).toBe('JEJU');
    });

    it('should have paymaster deployed', () => {
      const jeju = protocolTokens.find(t => t.symbol === 'JEJU');
      expect(jeju?.hasPaymaster).toBe(true);
    });

    it('should have complete configuration', () => {
      const jeju = protocolTokens.find(t => t.symbol === 'JEJU');
      expect(jeju?.name).toBe('Jeju');
      expect(jeju?.decimals).toBe(18);
      expect(jeju?.priceUSD).toBe(0.05);
      expect(jeju?.logoUrl).toBeDefined();
    });

    it('should NOT appear in bridgeable tokens', () => {
      const bridgeable = protocolTokens.filter(t => t.bridged);
      const hasJeju = bridgeable.some(t => t.symbol === 'JEJU');
      expect(hasJeju).toBe(false);
    });
  });

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

    it('should NOT be marked as preferred', () => {
      const elizaOS = protocolTokens.find(t => t.symbol === 'elizaOS');
      expect(elizaOS?.isPreferred).toBeFalsy();
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
    it('should have exactly 5 protocol tokens', () => {
      expect(protocolTokens.length).toBe(5);
    });

    it('should include all 5 tokens: JEJU, elizaOS, CLANKER, VIRTUAL, CLANKERMON', () => {
      const symbols = protocolTokens.map(t => t.symbol).sort();
      expect(symbols).toEqual(['CLANKER', 'CLANKERMON', 'JEJU', 'VIRTUAL', 'elizaOS']);
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

    it('should have 2 native tokens (JEJU, elizaOS) and 3 bridged tokens', () => {
      const native = protocolTokens.filter(t => !t.bridged);
      const bridged = protocolTokens.filter(t => t.bridged);
      
      expect(native.length).toBe(2);
      expect(bridged.length).toBe(3);
      // JEJU should be first, elizaOS second
      expect(native[0].symbol).toBe('JEJU');
      expect(native[1].symbol).toBe('elizaOS');
    });

    it('should have exactly 1 preferred token (JEJU)', () => {
      const preferred = protocolTokens.filter(t => t.isPreferred);
      expect(preferred.length).toBe(1);
      expect(preferred[0].symbol).toBe('JEJU');
    });

    it('should have Base addresses for all bridged tokens', () => {
      const bridged = protocolTokens.filter(t => t.bridged);
      bridged.forEach(token => {
        expect(token.l1Address).toBeDefined();
        expect(token.l1Address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });
    });

    it('should be retrievable by symbol (case-insensitive)', () => {
      expect(getTokenBySymbol('JEJU')).toBeDefined();
      expect(getTokenBySymbol('jeju')).toBeDefined();
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
    const requiredTokens = ['JEJU', 'elizaOS', 'CLANKER', 'VIRTUAL', 'CLANKERMON'];

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


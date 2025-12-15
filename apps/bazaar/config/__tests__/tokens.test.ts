import { describe, test, expect } from 'bun:test';
import { 
  getTokenBySymbol, 
  getTokenByAddress, 
  getAllTokens,
  isTokenDeployed,
  getDeployedTokens,
  getPreferredToken,
  getPaymasterTokensSorted,
  PREFERRED_TOKEN,
} from '../tokens';

describe('Token Config', () => {
  test('should get all tokens', () => {
    const tokens = getAllTokens();
    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('should get token by symbol', () => {
    const tokens = getAllTokens();
    if (tokens.length > 0) {
      const firstToken = tokens[0];
      const found = getTokenBySymbol(firstToken.symbol);
      expect(found).toBeDefined();
      expect(found?.symbol).toBe(firstToken.symbol);
    }
  });

  test('should get token by address', () => {
    const tokens = getAllTokens();
    if (tokens.length > 0) {
      const firstToken = tokens[0];
      const found = getTokenByAddress(firstToken.address);
      expect(found).toBeDefined();
      expect(found?.address).toBe(firstToken.address);
    }
  });

  test('should identify deployed tokens', () => {
    const tokens = getAllTokens();
    tokens.forEach(token => {
      const deployed = isTokenDeployed(token);
      expect(typeof deployed).toBe('boolean');
      
      if (token.address.startsWith('TBD_')) {
        expect(deployed).toBe(false);
      }
    });
  });

  test('should filter deployed tokens', () => {
    const deployed = getDeployedTokens();
    expect(Array.isArray(deployed)).toBe(true);
    
    deployed.forEach(token => {
      expect(token.address.startsWith('TBD_')).toBe(false);
    });
  });
});

describe('JEJU Token Integration', () => {
  test('JEJU should be the preferred token', () => {
    expect(PREFERRED_TOKEN).toBeDefined();
    expect(PREFERRED_TOKEN?.symbol).toBe('JEJU');
  });

  test('getPreferredToken should return JEJU', () => {
    const preferred = getPreferredToken();
    expect(preferred).toBeDefined();
    expect(preferred?.symbol).toBe('JEJU');
  });

  test('JEJU should appear first in paymaster tokens', () => {
    const sorted = getPaymasterTokensSorted();
    if (sorted.length > 0 && sorted.some(t => t.symbol === 'JEJU')) {
      expect(sorted[0].symbol).toBe('JEJU');
    }
  });

  test('JEJU should have hasPaymaster flag', () => {
    const jeju = getTokenBySymbol('JEJU');
    if (jeju) {
      expect(jeju.hasPaymaster).toBe(true);
    }
  });

  test('JEJU should be retrievable by symbol', () => {
    const jeju = getTokenBySymbol('JEJU');
    expect(jeju).toBeDefined();
    expect(jeju?.name).toBe('Jeju');
    expect(jeju?.decimals).toBe(18);
  });
});


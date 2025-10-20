import { describe, test, expect } from 'bun:test';
import { 
  getTokenBySymbol, 
  getTokenByAddress, 
  getAllTokens,
  isTokenDeployed,
  getDeployedTokens 
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


import { describe, test, expect } from 'bun:test';
import { 
  EvmChainIds, 
  isChainAvailable, 
  getAvailableChains,
  isLocalnetMode 
} from '../multi-chain';

describe('Multi-Chain Config', () => {
  test('should have chain IDs defined', () => {
    expect(EvmChainIds.JejuLocalnet).toBe(1337);
    expect(EvmChainIds.JejuTestnet).toBe(420690);
    expect(EvmChainIds.JejuMainnet).toBe(420691);
    expect(EvmChainIds.EthereumMainnet).toBe(1);
    expect(EvmChainIds.EthereumSepolia).toBe(11155111);
  });

  test('should check if chain is available', () => {
    const jejuAvailable = isChainAvailable(EvmChainIds.JejuLocalnet);
    expect(typeof jejuAvailable).toBe('boolean');
  });

  test('should get available chains', () => {
    const chains = getAvailableChains();
    expect(Array.isArray(chains)).toBe(true);
    expect(chains.length).toBeGreaterThan(0);
  });

  test('should detect localnet mode', () => {
    const isLocal = isLocalnetMode();
    expect(typeof isLocal).toBe('boolean');
  });
});


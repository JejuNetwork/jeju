/**
 * Contract client tests
 */

import { describe, test, expect } from 'bun:test';
import { createNodeClient, getContractAddresses, getChain, jejuLocalnet, jejuTestnet, jejuMainnet } from './contracts';

describe('Contract Client', () => {
  test('getChain returns correct chain for localnet', () => {
    const chain = getChain(1337);
    expect(chain.id).toBe(1337);
    expect(chain.name.toLowerCase()).toContain('local');
  });

  test('getChain returns correct chain for testnet', () => {
    const chain = getChain(420691);
    expect(chain.id).toBe(420691);
    // The name comes from shared config, just verify it's a string
    expect(typeof chain.name).toBe('string');
    expect(chain.name.length).toBeGreaterThan(0);
  });

  test('getChain returns correct chain for mainnet', () => {
    const chain = getChain(420690);
    expect(chain.id).toBe(420690);
    expect(typeof chain.name).toBe('string');
    expect(chain.name.length).toBeGreaterThan(0);
  });

  test('getChain throws for unknown chain', () => {
    expect(() => getChain(12345)).toThrow('Unknown chain ID: 12345');
  });

  test('getContractAddresses returns valid addresses for localnet', () => {
    const addresses = getContractAddresses(1337);
    
    expect(addresses.identityRegistry).toBeDefined();
    expect(addresses.identityRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(addresses.computeRegistry).toBeDefined();
    expect(addresses.nodeStakingManager).toBeDefined();
  });

  test('createNodeClient creates client without wallet', () => {
    const client = createNodeClient('http://127.0.0.1:8545', 1337);
    
    expect(client.publicClient).toBeDefined();
    expect(client.walletClient).toBeNull();
    expect(client.chainId).toBe(1337);
    expect(client.addresses).toBeDefined();
  });

  test('createNodeClient creates client with wallet', () => {
    // Test private key (anvil default)
    const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const client = createNodeClient('http://127.0.0.1:8545', 1337, privateKey);
    
    expect(client.publicClient).toBeDefined();
    expect(client.walletClient).toBeDefined();
    expect(client.walletClient?.account?.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });
});

describe('Chain Definitions', () => {
  test('jejuLocalnet has correct chain ID', () => {
    expect(jejuLocalnet.id).toBe(1337);
  });

  test('jejuTestnet and mainnet have distinct chain IDs', () => {
    // Chain IDs come from shared config - just verify they are defined and distinct
    expect(typeof jejuTestnet.id).toBe('number');
    expect(typeof jejuMainnet.id).toBe('number');
    expect(jejuTestnet.id).not.toBe(jejuMainnet.id);
    expect(jejuTestnet.id).not.toBe(1337);
    expect(jejuMainnet.id).not.toBe(1337);
  });

  test('chains have RPC URLs', () => {
    expect(jejuLocalnet.rpcUrls.default.http.length).toBeGreaterThan(0);
    expect(jejuTestnet.rpcUrls.default.http.length).toBeGreaterThan(0);
    expect(jejuMainnet.rpcUrls.default.http.length).toBeGreaterThan(0);
  });
});

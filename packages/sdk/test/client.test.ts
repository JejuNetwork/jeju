/**
 * SDK Client Tests
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createJejuClient, type JejuClient } from '../src';
import { privateKeyToAccount } from 'viem/accounts';
import { generatePrivateKey } from 'viem/accounts';

describe('JejuClient', () => {
  let client: JejuClient;
  const testPrivateKey = generatePrivateKey();

  beforeAll(async () => {
    client = await createJejuClient({
      network: 'localnet',
      privateKey: testPrivateKey,
      smartAccount: false, // Use EOA for tests
    });
  });

  test('creates client with correct address', () => {
    const account = privateKeyToAccount(testPrivateKey);
    expect(client.address).toBe(account.address);
  });

  test('has correct network info', () => {
    expect(client.network).toBe('localnet');
    expect(client.chainId).toBe(420690);
  });

  test('has all modules', () => {
    expect(client.compute).toBeDefined();
    expect(client.storage).toBeDefined();
    expect(client.defi).toBeDefined();
    expect(client.governance).toBeDefined();
    expect(client.names).toBeDefined();
    expect(client.identity).toBeDefined();
    expect(client.crosschain).toBeDefined();
    expect(client.payments).toBeDefined();
    expect(client.a2a).toBeDefined();
  });

  test('compute module has methods', () => {
    expect(typeof client.compute.listProviders).toBe('function');
    expect(typeof client.compute.createRental).toBe('function');
    expect(typeof client.compute.inference).toBe('function');
  });

  test('storage module has methods', () => {
    expect(typeof client.storage.upload).toBe('function');
    expect(typeof client.storage.retrieve).toBe('function');
    expect(typeof client.storage.listPins).toBe('function');
  });

  test('defi module has methods', () => {
    expect(typeof client.defi.getSwapQuote).toBe('function');
    expect(typeof client.defi.swap).toBe('function');
    expect(typeof client.defi.listPools).toBe('function');
  });

  test('governance module has methods', () => {
    expect(typeof client.governance.createProposal).toBe('function');
    expect(typeof client.governance.vote).toBe('function');
    expect(typeof client.governance.listProposals).toBe('function');
  });

  test('crosschain module has methods', () => {
    expect(typeof client.crosschain.getQuote).toBe('function');
    expect(typeof client.crosschain.transfer).toBe('function');
    expect(typeof client.crosschain.getSupportedChains).toBe('function');
  });

  test('crosschain returns supported chains', () => {
    const chains = client.crosschain.getSupportedChains();
    expect(chains).toContain('jeju');
    expect(chains).toContain('base');
    expect(chains).toContain('optimism');
    expect(chains).toContain('arbitrum');
    expect(chains).toContain('ethereum');
  });
});

describe('JejuClient with Smart Account', () => {
  test.skip('creates smart account client', async () => {
    // This test requires deployed contracts
    const testPrivateKey = generatePrivateKey();
    const client = await createJejuClient({
      network: 'localnet',
      privateKey: testPrivateKey,
      smartAccount: true,
    });

    expect(client.isSmartAccount).toBe(true);
  });
});


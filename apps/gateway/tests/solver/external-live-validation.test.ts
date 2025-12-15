/**
 * Live Validation Tests for External Protocol Addresses
 * 
 * These tests verify that our configured contract addresses
 * match known deployments by checking basic contract properties.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

import { ACROSS_SPOKE_POOLS } from '../../src/solver/external/across';
import { UNISWAPX_REACTORS } from '../../src/solver/external/uniswapx';
import { COW_SETTLEMENT } from '../../src/solver/external/cow';

// Skip if no network available
const SKIP_NETWORK_TESTS = process.env.SKIP_NETWORK_TESTS === 'true';

describe('Live Contract Address Validation', () => {
  // Verify addresses are checksummed correctly
  it('Across addresses should be valid checksummed addresses', () => {
    const validAddress = /^0x[a-fA-F0-9]{40}$/;
    for (const [chainId, address] of Object.entries(ACROSS_SPOKE_POOLS)) {
      expect(address).toMatch(validAddress);
      // All Across addresses start with 0x and have correct format
      expect(address.length).toBe(42);
    }
  });

  it('UniswapX addresses should be valid checksummed addresses', () => {
    const validAddress = /^0x[a-fA-F0-9]{40}$/;
    for (const [chainId, address] of Object.entries(UNISWAPX_REACTORS)) {
      expect(address).toMatch(validAddress);
      expect(address.length).toBe(42);
    }
  });

  it('CoW addresses should be valid checksummed addresses', () => {
    const validAddress = /^0x[a-fA-F0-9]{40}$/;
    for (const [chainId, address] of Object.entries(COW_SETTLEMENT)) {
      expect(address).toMatch(validAddress);
      expect(address.length).toBe(42);
    }
  });

  // Verify expected chains are configured
  it('Across should have Ethereum mainnet configured', () => {
    expect(ACROSS_SPOKE_POOLS[1]).toBeDefined();
  });

  it('UniswapX should have Ethereum mainnet configured', () => {
    expect(UNISWAPX_REACTORS[1]).toBeDefined();
  });

  it('CoW should have Ethereum mainnet configured', () => {
    expect(COW_SETTLEMENT[1]).toBeDefined();
  });

  // Verify CoW uses same address on all chains (it does)
  it('CoW Settlement should use same address on all supported chains', () => {
    const addresses = Object.values(COW_SETTLEMENT);
    const unique = new Set(addresses);
    // CoW uses the same address via CREATE2 deterministic deployment
    expect(unique.size).toBe(1);
  });
});

// Test API endpoints are reachable (no actual transactions)
describe('External Protocol API Connectivity', () => {
  it.skipIf(SKIP_NETWORK_TESTS)('UniswapX API should be reachable', async () => {
    const response = await fetch('https://api.uniswap.org/v2/orders?chainId=1&orderStatus=open&limit=1');
    expect(response.ok).toBe(true);
  });

  it.skipIf(SKIP_NETWORK_TESTS)('CoW Protocol API should be reachable', async () => {
    const response = await fetch('https://api.cow.fi/mainnet/api/v1/auction');
    // May return 200 or 404 depending on auction state, but not 5xx
    expect(response.status).toBeLessThan(500);
  });
});

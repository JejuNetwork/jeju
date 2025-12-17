/**
 * Federation Integration Tests
 * 
 * Tests the SDK's federation module against the contracts
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import {
  createFederationClient,
  TrustTier,
  RegistryType,
  ChainType,
  trustTierToString,
  registryTypeToString,
  chainTypeToString,
} from '../../src/federation';

describe('Federation Integration Tests', () => {
  // Note: These tests require a running chain with deployed contracts
  // Skip if not available
  const HUB_RPC = process.env.HUB_RPC || 'http://localhost:8545';
  const NETWORK_REGISTRY = process.env.NETWORK_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000';
  const REGISTRY_HUB = process.env.REGISTRY_HUB_ADDRESS || '0x0000000000000000000000000000000000000000';
  
  const skipTests = NETWORK_REGISTRY === '0x0000000000000000000000000000000000000000';

  if (skipTests) {
    console.log('⚠️ Federation contracts not deployed - some tests will be skipped');
  }

  describe('Type utilities', () => {
    it('trustTierToString converts correctly', () => {
      expect(trustTierToString(TrustTier.UNSTAKED)).toBe('UNSTAKED');
      expect(trustTierToString(TrustTier.STAKED)).toBe('STAKED');
      expect(trustTierToString(TrustTier.VERIFIED)).toBe('VERIFIED');
    });

    it('registryTypeToString converts correctly', () => {
      expect(registryTypeToString(RegistryType.IDENTITY)).toBe('IDENTITY');
      expect(registryTypeToString(RegistryType.COMPUTE)).toBe('COMPUTE');
      expect(registryTypeToString(RegistryType.STORAGE)).toBe('STORAGE');
      expect(registryTypeToString(RegistryType.SOLVER)).toBe('SOLVER');
    });

    it('chainTypeToString converts correctly', () => {
      expect(chainTypeToString(ChainType.EVM)).toBe('EVM');
      expect(chainTypeToString(ChainType.SOLANA)).toBe('SOLANA');
      expect(chainTypeToString(ChainType.COSMOS)).toBe('COSMOS');
      expect(chainTypeToString(ChainType.OTHER)).toBe('OTHER');
    });
  });

  describe('FederationClient creation', () => {
    it('creates client with valid config', async () => {
      if (skipTests) {
        console.log('  Skipped: No contracts deployed');
        return;
      }

      const client = await createFederationClient({
        hubRpc: HUB_RPC,
        networkRegistry: NETWORK_REGISTRY,
        registryHub: REGISTRY_HUB,
      });

      expect(client).toBeDefined();
      expect(typeof client.getNetwork).toBe('function');
      expect(typeof client.getAllNetworks).toBe('function');
      expect(typeof client.getStakedNetworks).toBe('function');
      expect(typeof client.getVerifiedNetworks).toBe('function');
      expect(typeof client.canParticipateInConsensus).toBe('function');
      expect(typeof client.isSequencerEligible).toBe('function');
      expect(typeof client.getChain).toBe('function');
      expect(typeof client.getAllChains).toBe('function');
      expect(typeof client.getRegistry).toBe('function');
      expect(typeof client.getAllRegistries).toBe('function');
      expect(typeof client.getRegistriesByType).toBe('function');
      expect(typeof client.getRegistriesByChain).toBe('function');
      expect(typeof client.isTrustedForConsensus).toBe('function');
      expect(typeof client.joinFederation).toBe('function');
      expect(typeof client.addStake).toBe('function');
      expect(typeof client.registerRegistry).toBe('function');
    });

    it('throws on write operations without private key', async () => {
      if (skipTests) {
        console.log('  Skipped: No contracts deployed');
        return;
      }

      const client = await createFederationClient({
        hubRpc: HUB_RPC,
        networkRegistry: NETWORK_REGISTRY,
        registryHub: REGISTRY_HUB,
      });

      await expect(client.joinFederation({
        chainId: 12345,
        name: 'Test Network',
        rpcUrl: 'http://localhost:8545',
      })).rejects.toThrow('Private key required');
    });
  });

  describe('Enum values', () => {
    it('TrustTier has correct values', () => {
      expect(TrustTier.UNSTAKED).toBe(0);
      expect(TrustTier.STAKED).toBe(1);
      expect(TrustTier.VERIFIED).toBe(2);
    });

    it('ChainType has correct values', () => {
      expect(ChainType.EVM).toBe(0);
      expect(ChainType.SOLANA).toBe(1);
      expect(ChainType.COSMOS).toBe(2);
      expect(ChainType.OTHER).toBe(3);
    });

    it('RegistryType has correct values', () => {
      expect(RegistryType.IDENTITY).toBe(0);
      expect(RegistryType.COMPUTE).toBe(1);
      expect(RegistryType.STORAGE).toBe(2);
      expect(RegistryType.SOLVER).toBe(3);
      expect(RegistryType.PACKAGE).toBe(4);
      expect(RegistryType.CONTAINER).toBe(5);
      expect(RegistryType.MODEL).toBe(6);
      expect(RegistryType.NAME_SERVICE).toBe(7);
      expect(RegistryType.REPUTATION).toBe(8);
      expect(RegistryType.OTHER).toBe(9);
    });
  });
});


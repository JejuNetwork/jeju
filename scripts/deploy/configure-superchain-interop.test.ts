/**
 * Superchain Interop Configuration Tests
 */

import { describe, it, expect } from 'bun:test';
import { SUPERCHAIN_L2S, generateSuperchainConfig } from './configure-superchain-interop';

describe('Superchain L2 Configuration', () => {
  describe('Chain List', () => {
    it('should have Optimism', () => {
      const optimism = SUPERCHAIN_L2S.find(l => l.chainId === 10);
      expect(optimism).toBeDefined();
      expect(optimism?.name).toBe('Optimism');
      expect(optimism?.superchainMember).toBe(true);
    });

    it('should have Base', () => {
      const base = SUPERCHAIN_L2S.find(l => l.chainId === 8453);
      expect(base).toBeDefined();
      expect(base?.name).toBe('Base');
      expect(base?.superchainMember).toBe(true);
    });

    it('should have Zora', () => {
      const zora = SUPERCHAIN_L2S.find(l => l.chainId === 7777777);
      expect(zora).toBeDefined();
      expect(zora?.name).toBe('Zora');
    });

    it('should have Mode', () => {
      const mode = SUPERCHAIN_L2S.find(l => l.chainId === 34443);
      expect(mode).toBeDefined();
      expect(mode?.name).toBe('Mode');
    });

    it('should have Jeju', () => {
      const jeju = SUPERCHAIN_L2S.find(l => l.chainId === 420691);
      expect(jeju).toBeDefined();
      expect(jeju?.name).toBe('Jeju');
      expect(jeju?.superchainMember).toBe(true);
    });

    it('should have at least 10 Superchain members', () => {
      const members = SUPERCHAIN_L2S.filter(l => l.superchainMember);
      expect(members.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Chain Properties', () => {
    it('all chains should have valid chain IDs', () => {
      for (const l2 of SUPERCHAIN_L2S) {
        expect(l2.chainId).toBeGreaterThan(0);
        expect(typeof l2.chainId).toBe('number');
      }
    });

    it('all chains should have RPC URLs', () => {
      for (const l2 of SUPERCHAIN_L2S) {
        expect(l2.rpcUrl).toBeDefined();
        expect(l2.rpcUrl.length).toBeGreaterThan(0);
        expect(l2.rpcUrl).toMatch(/^https?:\/\//);
      }
    });

    it('all chains should have names', () => {
      for (const l2 of SUPERCHAIN_L2S) {
        expect(l2.name).toBeDefined();
        expect(l2.name.length).toBeGreaterThan(0);
      }
    });

    it('all chains should have chain definitions', () => {
      for (const l2 of SUPERCHAIN_L2S) {
        expect(l2.chain).toBeDefined();
        expect(l2.chain.id).toBe(l2.chainId);
      }
    });

    it('chain IDs should be unique', () => {
      const chainIds = SUPERCHAIN_L2S.map(l => l.chainId);
      const unique = new Set(chainIds);
      expect(unique.size).toBe(chainIds.length);
    });
  });
});

describe('Superchain Config Generator', () => {
  it('should generate valid config', () => {
    const config = generateSuperchainConfig();
    
    expect(config.version).toBe('1.0.0');
    expect(config.generatedAt).toBeDefined();
    expect(config.superchainMembers).toBeDefined();
    expect(Array.isArray(config.superchainMembers)).toBe(true);
  });

  it('should include all Superchain members', () => {
    const config = generateSuperchainConfig();
    
    expect(config.superchainMembers.length).toBe(SUPERCHAIN_L2S.length);
  });

  it('should include predeploy addresses', () => {
    const config = generateSuperchainConfig();
    
    for (const member of config.superchainMembers) {
      expect(member.predeploys).toBeDefined();
      expect(member.predeploys.crossL2Inbox).toBe('0x4200000000000000000000000000000000000022');
      expect(member.predeploys.l2ToL2Messenger).toBe('0x4200000000000000000000000000000000000023');
    }
  });

  it('should include interop settings', () => {
    const config = generateSuperchainConfig();
    
    expect(config.interopSettings).toBeDefined();
    expect(typeof config.interopSettings.requireInboxVerification).toBe('boolean');
    expect(typeof config.interopSettings.allowTestnetInterop).toBe('boolean');
  });
});

describe('Superchain Predeploy Addresses', () => {
  const CROSS_L2_INBOX = '0x4200000000000000000000000000000000000022';
  const L2_TO_L2_MESSENGER = '0x4200000000000000000000000000000000000023';

  it('CrossL2Inbox should be at correct address', () => {
    expect(CROSS_L2_INBOX).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(CROSS_L2_INBOX.toLowerCase()).toBe('0x4200000000000000000000000000000000000022');
  });

  it('L2ToL2CrossDomainMessenger should be at correct address', () => {
    expect(L2_TO_L2_MESSENGER).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(L2_TO_L2_MESSENGER.toLowerCase()).toBe('0x4200000000000000000000000000000000000023');
  });

  it('predeploys should be in OP predeploy range (0x4200...)', () => {
    expect(CROSS_L2_INBOX.startsWith('0x4200')).toBe(true);
    expect(L2_TO_L2_MESSENGER.startsWith('0x4200')).toBe(true);
  });
});


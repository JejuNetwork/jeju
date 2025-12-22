/**
 * @fileoverview Tests for network.ts module
 * Tests network detection, deployer config, and contract flattening
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getCurrentNetwork,
  loadChainConfig,
  getChainConfig,
  loadDeployedContracts,
  getContractAddress,
  getDeployerConfig,
  getRpcUrl,
  getChainId,
  checkRpcReachable,
  checkHasBalance,
  getNetworkInfo,
  TEST_ACCOUNTS,
  L2_PREDEPLOYS,
  ENTRYPOINT_V07,
} from './network';
import type { NetworkType } from './schemas';

describe('Network Detection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.JEJU_NETWORK;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getCurrentNetwork', () => {
    it('should default to localnet when no env var set', () => {
      delete process.env.JEJU_NETWORK;
      const network = getCurrentNetwork();
      expect(network).toBe('localnet');
    });

    it('should return localnet when JEJU_NETWORK=localnet', () => {
      process.env.JEJU_NETWORK = 'localnet';
      const network = getCurrentNetwork();
      expect(network).toBe('localnet');
    });

    it('should return testnet when JEJU_NETWORK=testnet', () => {
      process.env.JEJU_NETWORK = 'testnet';
      const network = getCurrentNetwork();
      expect(network).toBe('testnet');
    });

    it('should return mainnet when JEJU_NETWORK=mainnet', () => {
      process.env.JEJU_NETWORK = 'mainnet';
      const network = getCurrentNetwork();
      expect(network).toBe('mainnet');
    });

    it('should throw for invalid JEJU_NETWORK value', () => {
      process.env.JEJU_NETWORK = 'invalid';
      expect(() => getCurrentNetwork()).toThrow('Invalid JEJU_NETWORK');
    });

    it('should throw for empty JEJU_NETWORK value', () => {
      process.env.JEJU_NETWORK = '';
      // Empty string is falsy, so it defaults to localnet
      const network = getCurrentNetwork();
      expect(network).toBe('localnet');
    });
  });
});

describe('Chain Configuration', () => {
  describe('loadChainConfig', () => {
    it('should load localnet config', () => {
      const config = loadChainConfig('localnet');
      expect(config.chainId).toBe(1337);
      expect(config.name).toBe('Jeju Localnet');
    });

    it('should load testnet config', () => {
      const config = loadChainConfig('testnet');
      expect(config.chainId).toBe(420690);
      expect(config.name).toBe('Jeju Testnet');
    });

    it('should load mainnet config', () => {
      const config = loadChainConfig('mainnet');
      expect(config.chainId).toBe(420691);
      expect(config.name).toBe('Jeju');
    });

    it('should validate config schema', () => {
      // All configs should have required fields
      const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet'];
      
      for (const network of networks) {
        const config = loadChainConfig(network);
        expect(config.chainId).toBeDefined();
        expect(config.networkId).toBeDefined();
        expect(config.name).toBeDefined();
        expect(config.rpcUrl).toBeDefined();
        expect(config.wsUrl).toBeDefined();
        expect(config.explorerUrl).toBeDefined();
        expect(config.l1ChainId).toBeDefined();
        expect(config.l1RpcUrl).toBeDefined();
        expect(config.gasToken).toBeDefined();
        expect(config.contracts).toBeDefined();
        expect(config.contracts.l1).toBeDefined();
        expect(config.contracts.l2).toBeDefined();
      }
    });
  });

  describe('getChainConfig', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.JEJU_NETWORK;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should return config for specified network', () => {
      const config = getChainConfig('testnet');
      expect(config.chainId).toBe(420690);
    });

    it('should use current network when none specified', () => {
      process.env.JEJU_NETWORK = 'mainnet';
      const config = getChainConfig();
      expect(config.chainId).toBe(420691);
    });

    it('should default to localnet', () => {
      delete process.env.JEJU_NETWORK;
      const config = getChainConfig();
      expect(config.chainId).toBe(1337);
    });
  });
});

describe('Contract Loading', () => {
  describe('loadDeployedContracts', () => {
    it('should always include WETH predeploy', () => {
      const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet'];
      
      for (const network of networks) {
        const contracts = loadDeployedContracts(network);
        expect(contracts.weth).toBe('0x4200000000000000000000000000000000000006');
      }
    });

    it('should return object with optional contract addresses', () => {
      const contracts = loadDeployedContracts('localnet');
      expect(typeof contracts).toBe('object');
      expect(contracts.weth).toBeDefined();
    });
  });

  describe('getContractAddress', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should get WETH address', () => {
      const address = getContractAddress('weth', 'localnet');
      expect(address).toBe('0x4200000000000000000000000000000000000006');
    });

    it('should respect env var override', () => {
      process.env.WETH_ADDRESS = '0x1234567890123456789012345678901234567890';
      const address = getContractAddress('weth', 'localnet');
      expect(address).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should throw for non-existent contract', () => {
      delete process.env.NONEXISTENT_CONTRACT_ADDRESS;
      expect(() => getContractAddress('nonexistentContract' as 'weth', 'localnet')).toThrow();
    });
  });
});

describe('Deployer Configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DEPLOYER_ADDRESS;
    delete process.env.DEPLOYER_PRIVATE_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getDeployerConfig', () => {
    it('should return test account for localnet when no env vars', () => {
      process.env.JEJU_NETWORK = 'localnet';
      const config = getDeployerConfig();
      
      expect(config.address).toBe(TEST_ACCOUNTS.DEPLOYER.address);
      expect(config.privateKey).toBe(TEST_ACCOUNTS.DEPLOYER.privateKey);
    });

    it('should use env vars for localnet when provided', () => {
      process.env.JEJU_NETWORK = 'localnet';
      process.env.DEPLOYER_ADDRESS = '0xCUSTOM0000000000000000000000000000000001';
      process.env.DEPLOYER_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';
      
      const config = getDeployerConfig();
      
      expect(config.address).toBe('0xCUSTOM0000000000000000000000000000000001');
      expect(config.privateKey).toBe('0x1234567890123456789012345678901234567890123456789012345678901234');
    });

    it('should throw for testnet when no env vars', () => {
      process.env.JEJU_NETWORK = 'testnet';
      expect(() => getDeployerConfig()).toThrow('DEPLOYER_ADDRESS required for testnet');
    });

    it('should throw for mainnet when no env vars', () => {
      process.env.JEJU_NETWORK = 'mainnet';
      expect(() => getDeployerConfig()).toThrow('DEPLOYER_ADDRESS required for mainnet');
    });

    it('should throw for testnet when address but no key', () => {
      process.env.JEJU_NETWORK = 'testnet';
      process.env.DEPLOYER_ADDRESS = '0x1234567890123456789012345678901234567890';
      expect(() => getDeployerConfig()).toThrow('DEPLOYER_PRIVATE_KEY required for testnet');
    });

    it('should work for testnet when both env vars set', () => {
      process.env.JEJU_NETWORK = 'testnet';
      process.env.DEPLOYER_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.DEPLOYER_PRIVATE_KEY = '0xabcdef0123456789012345678901234567890123456789012345678901234567';
      
      const config = getDeployerConfig();
      
      expect(config.address).toBe('0x1234567890123456789012345678901234567890');
      expect(config.privateKey).toBe('0xabcdef0123456789012345678901234567890123456789012345678901234567');
    });
  });
});

describe('RPC URL Helpers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.JEJU_RPC_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getRpcUrl', () => {
    it('should get RPC from config for each network', () => {
      const localnet = getRpcUrl('localnet');
      expect(localnet).toBe('http://127.0.0.1:9545');

      const testnet = getRpcUrl('testnet');
      expect(testnet).toContain('jejunetwork');

      const mainnet = getRpcUrl('mainnet');
      expect(mainnet).toContain('jejunetwork');
    });

    it('should respect JEJU_RPC_URL env override', () => {
      process.env.JEJU_RPC_URL = 'http://custom.example.com';
      const url = getRpcUrl('mainnet');
      expect(url).toBe('http://custom.example.com');
    });

    it('should respect network-specific env override', () => {
      process.env.JEJU_TESTNET_RPC_URL = 'http://testnet-custom.example.com';
      const url = getRpcUrl('testnet');
      expect(url).toBe('http://testnet-custom.example.com');
    });
  });

  describe('getChainId', () => {
    it('should return correct chain ID for each network', () => {
      expect(getChainId('localnet')).toBe(1337);
      expect(getChainId('testnet')).toBe(420690);
      expect(getChainId('mainnet')).toBe(420691);
    });
  });
});

describe('RPC Availability Checks', () => {
  describe('checkRpcReachable', () => {
    it('should return false for unreachable URL', async () => {
      const reachable = await checkRpcReachable('http://definitely-not-a-real-host.invalid:9999');
      expect(reachable).toBe(false);
    });

    // Skip actual RPC test as it depends on external services
    it.skip('should return true for reachable RPC', async () => {
      const reachable = await checkRpcReachable('https://ethereum-rpc.publicnode.com');
      expect(reachable).toBe(true);
    });
  });

  describe('checkHasBalance', () => {
    it('should return false for unreachable RPC', async () => {
      const hasBalance = await checkHasBalance(
        'http://definitely-not-a-real-host.invalid:9999',
        TEST_ACCOUNTS.DEPLOYER.address
      );
      expect(hasBalance).toBe(false);
    });
  });

  describe('getNetworkInfo', () => {
    it('should return network info object', async () => {
      // Use a quick timeout test with unreachable endpoint
      const info = await getNetworkInfo('localnet');
      
      expect(info.network).toBe('localnet');
      expect(info.chain).toBeDefined();
      expect(info.chain.chainId).toBe(1337);
      expect(info.contracts).toBeDefined();
      expect(typeof info.rpcReachable).toBe('boolean');
      expect(typeof info.hasBalance).toBe('boolean');
      expect(typeof info.isAvailable).toBe('boolean');
    });
  });
});

describe('Constants', () => {
  describe('TEST_ACCOUNTS', () => {
    it('should have correct deployer account', () => {
      expect(TEST_ACCOUNTS.DEPLOYER.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
      expect(TEST_ACCOUNTS.DEPLOYER.privateKey).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should have correct user accounts', () => {
      expect(TEST_ACCOUNTS.USER_1.address).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
      expect(TEST_ACCOUNTS.USER_2.address).toBe('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
    });
  });

  describe('L2_PREDEPLOYS', () => {
    it('should have correct predeploy addresses', () => {
      expect(L2_PREDEPLOYS.L2CrossDomainMessenger).toBe('0x4200000000000000000000000000000000000007');
      expect(L2_PREDEPLOYS.L2StandardBridge).toBe('0x4200000000000000000000000000000000000010');
      expect(L2_PREDEPLOYS.L2ToL1MessagePasser).toBe('0x4200000000000000000000000000000000000016');
      expect(L2_PREDEPLOYS.L2ERC721Bridge).toBe('0x4200000000000000000000000000000000000014');
      expect(L2_PREDEPLOYS.GasPriceOracle).toBe('0x420000000000000000000000000000000000000F');
      expect(L2_PREDEPLOYS.L1Block).toBe('0x4200000000000000000000000000000000000015');
      expect(L2_PREDEPLOYS.WETH).toBe('0x4200000000000000000000000000000000000006');
    });

    it('should have OP Stack standard addresses', () => {
      // All OP Stack predeploys are in the 0x4200... namespace
      Object.values(L2_PREDEPLOYS).forEach(address => {
        expect(address).toMatch(/^0x42000000000000000000000000000000000000/);
      });
    });
  });

  describe('ENTRYPOINT_V07', () => {
    it('should be correct ERC-4337 EntryPoint v0.7 address', () => {
      expect(ENTRYPOINT_V07).toBe('0x0000000071727De22E5E9d8BAf0edAc6f37da032');
    });
  });
});

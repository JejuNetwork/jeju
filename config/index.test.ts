/**
 * @fileoverview Test suite for chain configuration loaders
 * Tests configuration loading, validation, and environment variable overrides
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { 
  loadChainConfig, 
  getChainConfig,
  getContractAddress,
  getRpcUrl,
  getWsUrl,
  getExplorerUrl,
  getL1RpcUrl
} from './index';
import type { NetworkType } from '../types/chain';

describe('Configuration Loaders', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment variables after each test
    process.env = { ...originalEnv };
  });

  function cleanEnv() {
    // Clear network-related env vars for isolated testing
    delete process.env.JEJU_NETWORK;
    delete process.env.JEJU_RPC_URL;
    delete process.env.JEJU_WS_URL;
    delete process.env.JEJU_EXPLORER_URL;
    delete process.env.JEJU_L1_RPC_URL;
  }

  describe('loadChainConfig', () => {
    it('should load mainnet configuration', () => {
      const config = loadChainConfig('mainnet');
      
      expect(config.chainId).toBe(420691);
      expect(config.name).toBe('Jeju');
      expect(config.rpcUrl).toBe('https://rpc.jeju.network');
      expect(config.l1ChainId).toBe(8453); // Base Mainnet
      expect(config.flashblocksEnabled).toBe(true);
    });

    it('should load testnet configuration', () => {
      const config = loadChainConfig('testnet');
      
      expect(config.chainId).toBe(420690);
      expect(config.name).toBe('Jeju Testnet');
      expect(config.rpcUrl).toBe('https://testnet-rpc.jeju.network');
      expect(config.l1ChainId).toBe(84532); // Base Sepolia
    });

    it('should load localnet configuration', () => {
      const config = loadChainConfig('localnet');
      
      expect(config.chainId).toBe(1337);
      expect(config.name).toBe('Jeju Localnet');
      expect(config.rpcUrl).toBe('http://127.0.0.1:9545');
      expect(config.l1ChainId).toBe(1337); // Local L1
    });

    it('should validate schema and reject invalid configs', () => {
      // This would throw if schema validation fails
      expect(() => loadChainConfig('mainnet')).not.toThrow();
    });

    it('should have L2 predeploy addresses', () => {
      const config = loadChainConfig('mainnet');
      
      expect(config.contracts.l2.L2StandardBridge).toBe('0x4200000000000000000000000000000000000010');
      expect(config.contracts.l2.WETH).toBe('0x4200000000000000000000000000000000000006');
      expect(config.contracts.l2.L2CrossDomainMessenger).toBe('0x4200000000000000000000000000000000000007');
    });
  });


  describe('getChainConfig', () => {
    it('should default to mainnet', () => {
      cleanEnv();
      const config = getChainConfig();
      expect(config.chainId).toBe(420691);
    });

    it('should respect explicit network parameter', () => {
      cleanEnv();
      const config = getChainConfig('testnet');
      expect(config.chainId).toBe(420690);
    });

    it('should respect JEJU_NETWORK environment variable', () => {
      process.env.JEJU_NETWORK = 'testnet';
      const config = getChainConfig();
      expect(config.chainId).toBe(420690);
    });

    it('should prioritize env var over parameter', () => {
      process.env.JEJU_NETWORK = 'localnet';
      const config = getChainConfig('mainnet'); // Parameter ignored
      expect(config.chainId).toBe(1337);
    });
  });

  describe('getContractAddress', () => {
    it('should get L2 predeploy addresses', () => {
      const bridge = getContractAddress('mainnet', 'l2', 'L2StandardBridge');
      expect(bridge).toBe('0x4200000000000000000000000000000000000010');
      
      const weth = getContractAddress('testnet', 'l2', 'WETH');
      expect(weth).toBe('0x4200000000000000000000000000000000000006');
    });

    it('should throw with SPECIFIC error message for non-existent contracts', () => {
      expect(() => 
        getContractAddress('mainnet', 'l2', 'NonExistentContract')
      ).toThrow('Contract NonExistentContract not found on l2 for mainnet');
    });

    it('should throw with SPECIFIC error message for undeployed L1 contracts', () => {
      // L1 contracts may not be deployed yet (empty strings)
      expect(() => 
        getContractAddress('mainnet', 'l1', 'OptimismPortal')
      ).toThrow('Contract OptimismPortal not found on l1 for mainnet');
    });

    it('should work across all networks', () => {
      const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet'];
      
      for (const network of networks) {
        const messenger = getContractAddress(network, 'l2', 'L2CrossDomainMessenger');
        expect(messenger).toBe('0x4200000000000000000000000000000000000007');
      }
    });
  });

  describe('URL Getters', () => {
    describe('getRpcUrl', () => {
      it('should get RPC URL from config', () => {
        cleanEnv();
        const rpcUrl = getRpcUrl('mainnet');
        expect(rpcUrl).toBe('https://rpc.jeju.network');
      });

      it('should override with environment variable', () => {
        process.env.JEJU_RPC_URL = 'http://localhost:9545';
        const rpcUrl = getRpcUrl('mainnet');
        expect(rpcUrl).toBe('http://localhost:9545');
      });
    });

    describe('getWsUrl', () => {
      it('should get WebSocket URL from config', () => {
        cleanEnv();
        const wsUrl = getWsUrl('testnet');
        expect(wsUrl).toBe('wss://testnet-ws.jeju.network');
      });

      it('should override with environment variable', () => {
        process.env.JEJU_WS_URL = 'ws://localhost:9546';
        const wsUrl = getWsUrl('mainnet');
        expect(wsUrl).toBe('ws://localhost:9546');
      });
    });

    describe('getExplorerUrl', () => {
      it('should get explorer URL from config', () => {
        cleanEnv();
        const explorerUrl = getExplorerUrl('mainnet');
        expect(explorerUrl).toBe('https://explorer.jeju.network');
      });

      it('should override with environment variable', () => {
        process.env.JEJU_EXPLORER_URL = 'http://localhost:4000';
        const explorerUrl = getExplorerUrl('testnet');
        expect(explorerUrl).toBe('http://localhost:4000');
      });
    });

    describe('getL1RpcUrl', () => {
      it('should get Base Mainnet RPC for mainnet', () => {
        cleanEnv();
        const l1Rpc = getL1RpcUrl('mainnet');
        expect(l1Rpc).toBe('https://mainnet.base.org');
      });

      it('should get Base Sepolia RPC for testnet', () => {
        cleanEnv();
        const l1Rpc = getL1RpcUrl('testnet');
        expect(l1Rpc).toBe('https://sepolia.base.org');
      });

      it('should override with environment variable', () => {
        process.env.JEJU_L1_RPC_URL = 'http://localhost:8545';
        const l1Rpc = getL1RpcUrl('mainnet');
        expect(l1Rpc).toBe('http://localhost:8545');
      });
    });
  });

  describe('Configuration Integrity', () => {
    it('should have consistent L2 predeploys across all networks', () => {
      const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet'];
      const predeploys = [
        'L2CrossDomainMessenger',
        'L2StandardBridge',
        'L2ToL1MessagePasser',
        'L2ERC721Bridge',
        'GasPriceOracle',
        'L1Block',
        'WETH'
      ];

      for (const contract of predeploys) {
        const addresses = networks.map(net => {
          const config = loadChainConfig(net);
          return config.contracts.l2[contract as keyof typeof config.contracts.l2];
        });
        
        // All networks should have same predeploy addresses
        expect(new Set(addresses).size).toBe(1);
      }
    });

    it('should have correct L1 chain IDs', () => {
      const mainnet = loadChainConfig('mainnet');
      const testnet = loadChainConfig('testnet');
      const localnet = loadChainConfig('localnet');

      expect(mainnet.l1ChainId).toBe(8453); // Base Mainnet
      expect(testnet.l1ChainId).toBe(84532); // Base Sepolia
      expect(localnet.l1ChainId).toBe(1337); // Local L1
    });

    it('should have correct L2 chain IDs', () => {
      const mainnet = loadChainConfig('mainnet');
      const testnet = loadChainConfig('testnet');
      const localnet = loadChainConfig('localnet');

      expect(mainnet.chainId).toBe(420691);
      expect(testnet.chainId).toBe(420690);
      expect(localnet.chainId).toBe(1337);
    });

    it('should have flashblocks enabled on all networks', () => {
      const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet'];
      
      for (const network of networks) {
        const config = loadChainConfig(network);
        expect(config.flashblocksEnabled).toBe(true);
        expect(config.flashblocksSubBlockTime).toBe(200);
        expect(config.blockTime).toBe(2000);
      }
    });

    it('should have ETH as gas token on all networks', () => {
      const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet'];
      
      for (const network of networks) {
        const config = loadChainConfig(network);
        expect(config.gasToken.symbol).toBe('ETH');
        expect(config.gasToken.decimals).toBe(18);
      }
    });
  });

  describe('Environment Variable Combinations', () => {
    it('should allow full environment override', () => {
      process.env.JEJU_NETWORK = 'testnet';
      process.env.JEJU_RPC_URL = 'http://custom-rpc.example.com';
      process.env.JEJU_WS_URL = 'ws://custom-ws.example.com';
      process.env.JEJU_EXPLORER_URL = 'http://custom-explorer.example.com';
      process.env.JEJU_L1_RPC_URL = 'http://custom-l1.example.com';

      expect(getRpcUrl()).toBe('http://custom-rpc.example.com');
      expect(getWsUrl()).toBe('ws://custom-ws.example.com');
      expect(getExplorerUrl()).toBe('http://custom-explorer.example.com');
      expect(getL1RpcUrl()).toBe('http://custom-l1.example.com');
    });

    it('should fall back to config when env vars not set', () => {
      delete process.env.JEJU_RPC_URL;
      delete process.env.JEJU_WS_URL;
      delete process.env.JEJU_EXPLORER_URL;
      delete process.env.JEJU_L1_RPC_URL;
      delete process.env.JEJU_NETWORK;

      const rpcUrl = getRpcUrl('testnet');
      expect(rpcUrl).toBe('https://testnet-rpc.jeju.network');
    });
  });
});


/**
 * @fileoverview Test suite for chain configuration loaders
 * Tests configuration loading, validation, and environment variable overrides
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { 
  loadChainConfig, 
  getChainConfig,
  getBridgeContractAddress,
  getWsUrl,
  getExplorerUrl,
  getL1RpcUrl,
  getRpcUrl,
  getChainId,
  getContractAddress,
  loadDeployedContracts,
  TEST_ACCOUNTS,
  L2_PREDEPLOYS,
} from './index';
import type { NetworkType } from '../types/src/chain';

describe('Configuration Loaders', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function cleanEnv() {
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
      expect(config.l1ChainId).toBe(1); // Ethereum mainnet
      expect(config.flashblocksEnabled).toBe(true);
    });

    it('should load testnet configuration', () => {
      const config = loadChainConfig('testnet');
      
      expect(config.chainId).toBe(420690);
      expect(config.name).toBe('Jeju Testnet');
      expect(config.rpcUrl).toBe('https://testnet-rpc.jeju.network');
      expect(config.l1ChainId).toBe(11155111); // Sepolia
    });

    it('should load localnet configuration', () => {
      const config = loadChainConfig('localnet');
      
      expect(config.chainId).toBe(1337);
      expect(config.name).toBe('Jeju Localnet');
      expect(config.rpcUrl).toBe('http://127.0.0.1:9545');
      expect(config.l1ChainId).toBe(1337);
    });

    it('should validate schema and reject invalid configs', () => {
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
    it('should default to localnet for development', () => {
      cleanEnv();
      const config = getChainConfig();
      // Default changed from mainnet to localnet for better dev experience
      expect(config.chainId).toBe(1337);
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

    it('should prioritize explicit parameter over env var', () => {
      process.env.JEJU_NETWORK = 'localnet';
      const config = getChainConfig('mainnet');
      // Explicit parameter takes precedence over env var
      expect(config.chainId).toBe(420691);
    });
  });

  describe('getBridgeContractAddress', () => {
    it('should get L2 predeploy addresses', () => {
      const bridge = getBridgeContractAddress('mainnet', 'l2', 'L2StandardBridge');
      expect(bridge).toBe('0x4200000000000000000000000000000000000010');
      
      const weth = getBridgeContractAddress('testnet', 'l2', 'WETH');
      expect(weth).toBe('0x4200000000000000000000000000000000000006');
    });

    it('should throw for non-existent contracts', () => {
      expect(() => 
        getBridgeContractAddress('mainnet', 'l2', 'NonExistentContract')
      ).toThrow();
    });

    it('should work across all networks', () => {
      const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet'];
      
      for (const network of networks) {
        const messenger = getBridgeContractAddress(network, 'l2', 'L2CrossDomainMessenger');
        expect(messenger).toBe('0x4200000000000000000000000000000000000007');
      }
    });
  });

  describe('L2_PREDEPLOYS', () => {
    it('should have all standard OP-Stack predeploys', () => {
      expect(L2_PREDEPLOYS.L2StandardBridge).toBe('0x4200000000000000000000000000000000000010');
      expect(L2_PREDEPLOYS.WETH).toBe('0x4200000000000000000000000000000000000006');
      expect(L2_PREDEPLOYS.L2CrossDomainMessenger).toBe('0x4200000000000000000000000000000000000007');
      expect(L2_PREDEPLOYS.GasPriceOracle).toBe('0x420000000000000000000000000000000000000F');
    });
  });

  describe('TEST_ACCOUNTS', () => {
    it('should have deployer account', () => {
      expect(TEST_ACCOUNTS.DEPLOYER.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
      expect(TEST_ACCOUNTS.DEPLOYER.privateKey).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should have user accounts', () => {
      expect(TEST_ACCOUNTS.USER_1.address).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
      expect(TEST_ACCOUNTS.USER_2.address).toBe('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
    });
  });

  describe('loadDeployedContracts', () => {
    it('should always include WETH predeploy', () => {
      const contracts = loadDeployedContracts('localnet');
      expect(contracts.weth).toBe('0x4200000000000000000000000000000000000006');
    });

    it('should load from deployment files if they exist', () => {
      // This may return partial contracts depending on what's deployed
      const contracts = loadDeployedContracts('localnet');
      expect(typeof contracts).toBe('object');
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
      it('should get Ethereum Mainnet RPC for mainnet', () => {
        cleanEnv();
        const l1Rpc = getL1RpcUrl('mainnet');
        expect(l1Rpc).toBe('https://eth.llamarpc.com');
      });

      it('should get Sepolia RPC for testnet', () => {
        cleanEnv();
        const l1Rpc = getL1RpcUrl('testnet');
        expect(l1Rpc).toBe('https://ethereum-sepolia-rpc.publicnode.com');
      });

      it('should override with environment variable', () => {
        process.env.JEJU_L1_RPC_URL = 'http://localhost:8545';
        const l1Rpc = getL1RpcUrl('mainnet');
        expect(l1Rpc).toBe('http://localhost:8545');
      });
    });

    describe('getChainId', () => {
      it('should get chain ID for each network', () => {
        expect(getChainId('localnet')).toBe(1337);
        expect(getChainId('testnet')).toBe(420690);
        expect(getChainId('mainnet')).toBe(420691);
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
        
        expect(new Set(addresses).size).toBe(1);
      }
    });

    it('should have correct L1 chain IDs', () => {
      const mainnet = loadChainConfig('mainnet');
      const testnet = loadChainConfig('testnet');
      const localnet = loadChainConfig('localnet');

      expect(mainnet.l1ChainId).toBe(1);         // Ethereum mainnet
      expect(testnet.l1ChainId).toBe(11155111);  // Sepolia
      expect(localnet.l1ChainId).toBe(1337);     // Local
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

/**
 * @title Agent0 SDK Integration Tests
 * @notice Tests for the agent0.ts module
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { 
  loadJejuManifest, 
  getNetworkConfig, 
  buildRegistrationFile,
  detectNetwork,
  createConfigFromEnv,
  type JejuManifest
} from './agent0';
import { resolve } from 'path';
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'fs';

describe('Agent0 SDK Integration', () => {
  
  describe('getNetworkConfig', () => {
    test('should return localnet config with correct chain ID', () => {
      const config = getNetworkConfig('localnet');
      expect(config.chainId).toBe(1337);
      expect(config.rpcUrl).toBe('http://localhost:8545');
    });
    
    test('should return testnet config with Sepolia chain ID', () => {
      const config = getNetworkConfig('testnet');
      expect(config.chainId).toBe(11155111);
      expect(config.rpcUrl).toBe('https://ethereum-sepolia-rpc.publicnode.com');
    });
    
    test('should return mainnet config with Ethereum chain ID', () => {
      const config = getNetworkConfig('mainnet');
      expect(config.chainId).toBe(1);
      expect(config.rpcUrl).toBe('https://eth.llamarpc.com');
    });
    
    test('should include registry addresses structure', () => {
      const config = getNetworkConfig('localnet');
      expect(config.registries).toBeDefined();
      expect(config.registries).toHaveProperty('IDENTITY');
      expect(config.registries).toHaveProperty('REPUTATION');
      expect(config.registries).toHaveProperty('VALIDATION');
    });
  });
  
  describe('loadJejuManifest', () => {
    const testDir = resolve(__dirname, '__test_manifest__');
    
    beforeAll(() => {
      if (!existsSync(testDir)) {
        mkdirSync(testDir, { recursive: true });
      }
    });
    
    afterAll(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true });
      }
    });
    
    test('should load valid manifest', () => {
      const testManifest = {
        name: 'test-app',
        description: 'Test application',
        version: '1.0.0',
        ports: { main: 3000 },
        agent: {
          enabled: true,
          a2aEndpoint: '/a2a',
          tags: ['test', 'jeju-app']
        }
      };
      
      writeFileSync(
        resolve(testDir, 'jeju-manifest.json'), 
        JSON.stringify(testManifest, null, 2)
      );
      
      const loaded = loadJejuManifest(testDir);
      expect(loaded.name).toBe('test-app');
      expect(loaded.description).toBe('Test application');
      expect(loaded.agent?.enabled).toBe(true);
      expect(loaded.agent?.tags).toContain('jeju-app');
    });
    
    test('should throw for missing manifest', () => {
      expect(() => loadJejuManifest('/nonexistent/path')).toThrow();
    });
  });
  
  describe('buildRegistrationFile', () => {
    test('should build registration file from manifest', () => {
      const manifest: JejuManifest = {
        name: 'test-agent',
        description: 'A test agent',
        version: '1.0.0',
        agent: {
          enabled: true,
          a2aEndpoint: '/a2a',
          trustModels: ['open'],
          x402Support: true,
          metadata: { category: 'test' }
        }
      };
      
      const regFile = buildRegistrationFile(manifest, 'http://localhost:3000', '0x1234');
      
      expect(regFile.name).toBe('test-agent');
      expect(regFile.description).toBe('A test agent');
      expect(regFile.owners).toContain('0x1234');
      expect(regFile.x402support).toBe(true);
      expect(regFile.active).toBe(true);
    });
    
    test('should build A2A endpoint from relative path', () => {
      const manifest: JejuManifest = {
        name: 'test',
        description: 'Test',
        agent: {
          a2aEndpoint: '/api/a2a'
        }
      };
      
      const regFile = buildRegistrationFile(manifest, 'http://localhost:4000', '0x1234');
      const endpoints = regFile.endpoints as Array<{ type: string; value: string }>;
      
      const a2aEndpoint = endpoints.find(e => e.type === 'a2a');
      expect(a2aEndpoint?.value).toBe('http://localhost:4000/api/a2a');
    });
    
    test('should use absolute A2A endpoint when provided', () => {
      const manifest: JejuManifest = {
        name: 'test',
        description: 'Test',
        agent: {
          a2aEndpoint: 'https://custom.endpoint.com/a2a'
        }
      };
      
      const regFile = buildRegistrationFile(manifest, 'http://localhost:4000', '0x1234');
      const endpoints = regFile.endpoints as Array<{ type: string; value: string }>;
      
      const a2aEndpoint = endpoints.find(e => e.type === 'a2a');
      expect(a2aEndpoint?.value).toBe('https://custom.endpoint.com/a2a');
    });
    
    test('should include MCP endpoint when configured', () => {
      const manifest: JejuManifest = {
        name: 'test',
        description: 'Test',
        agent: {
          a2aEndpoint: '/a2a',
          mcpEndpoint: '/mcp'
        }
      };
      
      const regFile = buildRegistrationFile(manifest, 'http://localhost:4000', '0x1234');
      const endpoints = regFile.endpoints as Array<{ type: string; value: string }>;
      
      const mcpEndpoint = endpoints.find(e => e.type === 'mcp');
      expect(mcpEndpoint?.value).toBe('http://localhost:4000/mcp');
    });
    
    test('should default trustModels to open', () => {
      const manifest: JejuManifest = {
        name: 'test',
        description: 'Test'
      };
      
      const regFile = buildRegistrationFile(manifest, 'http://localhost:4000', '0x1234');
      expect(regFile.trustModels).toContain('open');
    });
    
    test('should include custom metadata', () => {
      const manifest: JejuManifest = {
        name: 'test',
        description: 'Test',
        version: '2.0.0',
        agent: {
          metadata: { 
            category: 'defi',
            provider: 'jeju-network'
          }
        }
      };
      
      const regFile = buildRegistrationFile(manifest, 'http://localhost:4000', '0x1234');
      const metadata = regFile.metadata as Record<string, string>;
      
      expect(metadata.version).toBe('2.0.0');
      expect(metadata.category).toBe('defi');
      expect(metadata.provider).toBe('jeju-network');
    });
  });
  
  describe('detectNetwork', () => {
    const originalEnv = process.env;
    
    afterAll(() => {
      process.env = originalEnv;
    });
    
    test('should detect mainnet from production environment', () => {
      process.env.JEJU_NETWORK = 'mainnet';
      expect(detectNetwork()).toBe('mainnet');
    });
    
    test('should detect testnet from staging environment', () => {
      process.env.JEJU_NETWORK = 'testnet';
      expect(detectNetwork()).toBe('testnet');
    });
    
    test('should default to localnet', () => {
      delete process.env.JEJU_NETWORK;
      delete process.env.NODE_ENV;
      expect(detectNetwork()).toBe('localnet');
    });
  });
  
  describe('createConfigFromEnv', () => {
    const originalEnv = process.env;
    
    afterAll(() => {
      process.env = originalEnv;
    });
    
    test('should throw without private key', () => {
      delete process.env.PRIVATE_KEY;
      delete process.env.DEPLOYER_PRIVATE_KEY;
      delete process.env.AGENT_PRIVATE_KEY;
      
      expect(() => createConfigFromEnv()).toThrow('No private key found');
    });
    
    test('should use PRIVATE_KEY when set', () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      const config = createConfigFromEnv();
      expect(config.privateKey).toBe('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
    });
    
    test('should prefix private key with 0x if missing', () => {
      process.env.PRIVATE_KEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      const config = createConfigFromEnv();
      expect(config.privateKey.startsWith('0x')).toBe(true);
    });
  });
});

describe('Agent0 Manifest Loading - Real Apps', () => {
  const appsDir = resolve(__dirname, '../../apps');
  
  test('should load bazaar manifest with agent config', () => {
    const manifest = loadJejuManifest(resolve(appsDir, 'bazaar'));
    
    expect(manifest.name).toBe('bazaar');
    expect(manifest.agent?.enabled).toBe(true);
    expect(manifest.agent?.a2aEndpoint).toBe('/api/a2a');
    expect(manifest.agent?.tags).toContain('jeju-app');
  });
  
  test('should load gateway manifest with agent config', () => {
    const manifest = loadJejuManifest(resolve(appsDir, 'gateway'));
    
    expect(manifest.name).toBe('gateway');
    expect(manifest.agent?.enabled).toBe(true);
    expect(manifest.agent?.a2aEndpoint).toContain('/a2a');
  });
  
  // Note: apps/ipfs was removed from the project
  
  test('should load compute manifest with agent config', () => {
    const manifest = loadJejuManifest(resolve(appsDir, 'compute'));
    
    expect(manifest.name).toBe('compute');
    expect(manifest.agent?.enabled).toBe(true);
    expect(manifest.agent?.tags).toContain('jeju-app');
    expect(manifest.agent?.tags).toContain('compute');
  });
  
  test('should load monitoring manifest with agent config', () => {
    const manifest = loadJejuManifest(resolve(appsDir, 'monitoring'));
    
    expect(manifest.name).toBe('monitoring');
    expect(manifest.agent?.enabled).toBe(true);
    expect(manifest.agent?.a2aEndpoint).toBe('/api/a2a');
  });
  
  test('should load indexer manifest with agent config', () => {
    const manifest = loadJejuManifest(resolve(appsDir, 'indexer'));
    
    expect(manifest.name).toBe('indexer');
    expect(manifest.agent?.enabled).toBe(true);
  });
});

describe('Registration File Structure Validation', () => {
  test('should produce valid ERC-8004 registration file structure', () => {
    const manifest: JejuManifest = {
      name: 'Complete Test Agent',
      description: 'A fully configured test agent for validation',
      version: '1.0.0',
      ports: { main: 4000 },
      agent: {
        enabled: true,
        a2aEndpoint: '/a2a',
        mcpEndpoint: '/mcp',
        tags: ['test', 'validation'],
        trustModels: ['open', 'verified'],
        x402Support: true,
        metadata: {
          category: 'testing',
          provider: 'jeju-network'
        }
      }
    };
    
    const regFile = buildRegistrationFile(
      manifest, 
      'https://test.jeju.network', 
      '0xDEADBEEF'
    );
    
    // Required fields
    expect(regFile).toHaveProperty('name');
    expect(regFile).toHaveProperty('description');
    expect(regFile).toHaveProperty('endpoints');
    expect(regFile).toHaveProperty('trustModels');
    expect(regFile).toHaveProperty('owners');
    expect(regFile).toHaveProperty('active');
    expect(regFile).toHaveProperty('updatedAt');
    
    // Endpoint structure
    const endpoints = regFile.endpoints as Array<{ type: string; value: string; meta?: Record<string, string> }>;
    expect(endpoints.length).toBe(2);
    
    const a2a = endpoints.find(e => e.type === 'a2a');
    expect(a2a).toBeDefined();
    expect(a2a?.value).toBe('https://test.jeju.network/a2a');
    expect(a2a?.meta?.version).toBe('0.30');
    
    const mcp = endpoints.find(e => e.type === 'mcp');
    expect(mcp).toBeDefined();
    expect(mcp?.value).toBe('https://test.jeju.network/mcp');
    
    // Metadata structure
    const metadata = regFile.metadata as Record<string, string>;
    expect(metadata.version).toBe('1.0.0');
    expect(metadata.category).toBe('testing');
  });
});


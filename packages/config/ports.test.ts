/**
 * @fileoverview Tests for ports.ts module
 * Tests port allocation, conflict detection, and URL building
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  CORE_PORTS,
  VENDOR_PORTS,
  INFRA_PORTS,
  getCoreAppUrl,
  getVendorAppUrl,
  getInfraUrl,
  getAllCorePorts,
  getAllVendorPorts,
  getAllInfraPorts,
  checkPortConflicts,
  getL1RpcUrl,
  getL2RpcUrl,
  getL2WsUrl,
  getJejuRpcUrl,
  isLocalnet,
} from './ports';

describe('Port Constants', () => {
  describe('CORE_PORTS', () => {
    it('should have correct default values', () => {
      expect(CORE_PORTS.GATEWAY.DEFAULT).toBe(4001);
      expect(CORE_PORTS.NODE_EXPLORER_API.DEFAULT).toBe(4002);
      expect(CORE_PORTS.NODE_EXPLORER_UI.DEFAULT).toBe(4003);
      expect(CORE_PORTS.DOCUMENTATION.DEFAULT).toBe(4004);
      expect(CORE_PORTS.BAZAAR.DEFAULT).toBe(4006);
      expect(CORE_PORTS.COMPUTE.DEFAULT).toBe(4007);
      expect(CORE_PORTS.IPFS.DEFAULT).toBe(3100);
      expect(CORE_PORTS.INDEXER_GRAPHQL.DEFAULT).toBe(4350);
      expect(CORE_PORTS.FACILITATOR.DEFAULT).toBe(3402);
    });

    it('should have ENV_VAR for each port', () => {
      Object.entries(CORE_PORTS).forEach(([name, config]) => {
        expect(config.ENV_VAR).toBeTruthy();
        expect(config.ENV_VAR).toContain('PORT');
      });
    });

    it('should have get() function for each port', () => {
      Object.entries(CORE_PORTS).forEach(([name, config]) => {
        expect(typeof config.get).toBe('function');
        expect(typeof config.get()).toBe('number');
      });
    });
  });

  describe('VENDOR_PORTS', () => {
    it('should have correct default values', () => {
      expect(VENDOR_PORTS.HYPERSCAPE_CLIENT.DEFAULT).toBe(3333);
      expect(VENDOR_PORTS.HYPERSCAPE_SERVER.DEFAULT).toBe(5555);
      expect(VENDOR_PORTS.LAUNCHPAD_FRONTEND.DEFAULT).toBe(5003);
      expect(VENDOR_PORTS.OTC_DESK.DEFAULT).toBe(5005);
      expect(VENDOR_PORTS.CLOUD.DEFAULT).toBe(5006);
    });

    it('should have Jeju-specific ports for some vendors', () => {
      expect(VENDOR_PORTS.HYPERSCAPE_CLIENT.JEJU).toBe(5013);
      expect(VENDOR_PORTS.HYPERSCAPE_SERVER.JEJU).toBe(5014);
    });
  });

  describe('INFRA_PORTS', () => {
    it('should have correct default values', () => {
      expect(INFRA_PORTS.L1_RPC.DEFAULT).toBe(6545);
      expect(INFRA_PORTS.L2_RPC.DEFAULT).toBe(6546);
      expect(INFRA_PORTS.L2_WS.DEFAULT).toBe(6547);
      expect(INFRA_PORTS.PROMETHEUS.DEFAULT).toBe(9090);
      expect(INFRA_PORTS.GRAFANA.DEFAULT).toBe(4010);
      expect(INFRA_PORTS.KURTOSIS_UI.DEFAULT).toBe(9711);
    });
  });
});

describe('Port Environment Overrides', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should use env var when set for CORE_PORTS', () => {
    process.env.GATEWAY_PORT = '9999';
    expect(CORE_PORTS.GATEWAY.get()).toBe(9999);
  });

  it('should fall back to default when env var not set', () => {
    delete process.env.GATEWAY_PORT;
    delete process.env.PAYMASTER_DASHBOARD_PORT;
    expect(CORE_PORTS.GATEWAY.get()).toBe(4001);
  });

  it('should respect alternative env var names', () => {
    delete process.env.GATEWAY_PORT;
    process.env.PAYMASTER_DASHBOARD_PORT = '8888';
    expect(CORE_PORTS.GATEWAY.get()).toBe(8888);
  });

  it('should use env var for VENDOR_PORTS', () => {
    process.env.VENDOR_LAUNCHPAD_FRONTEND_PORT = '7777';
    expect(VENDOR_PORTS.LAUNCHPAD_FRONTEND.get()).toBe(7777);
  });

  it('should use env var for INFRA_PORTS', () => {
    process.env.L2_RPC_PORT = '6666';
    expect(INFRA_PORTS.L2_RPC.get()).toBe(6666);
  });
});

describe('URL Builders', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.HOST;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getCoreAppUrl', () => {
    it('should build http URL with default port', () => {
      delete process.env.GATEWAY_PORT;
      delete process.env.GATEWAY_URL;
      delete process.env.PAYMASTER_DASHBOARD_PORT;
      
      const url = getCoreAppUrl('GATEWAY');
      expect(url).toBe('http://localhost:4001');
    });

    it('should build ws URL when specified', () => {
      delete process.env.INDEXER_GRAPHQL_PORT;
      delete process.env.INDEXER_GRAPHQL_URL;
      
      const url = getCoreAppUrl('INDEXER_GRAPHQL', 'ws');
      expect(url).toBe('ws://localhost:4350');
    });

    it('should respect full URL override from env', () => {
      process.env.GATEWAY_URL = 'https://gateway.example.com';
      const url = getCoreAppUrl('GATEWAY');
      expect(url).toBe('https://gateway.example.com');
    });

    it('should respect HOST env var', () => {
      process.env.HOST = 'myhost.local';
      delete process.env.GATEWAY_URL;
      delete process.env.GATEWAY_PORT;
      delete process.env.PAYMASTER_DASHBOARD_PORT;
      
      const url = getCoreAppUrl('GATEWAY');
      expect(url).toBe('http://myhost.local:4001');
    });
  });

  describe('getVendorAppUrl', () => {
    it('should build URL for vendor app', () => {
      delete process.env.VENDOR_CLOUD_PORT;
      delete process.env.VENDOR_CLOUD_URL;
      
      const url = getVendorAppUrl('CLOUD');
      expect(url).toBe('http://localhost:5006');
    });
  });

  describe('getInfraUrl', () => {
    it('should build URL for infra service', () => {
      delete process.env.PROMETHEUS_PORT;
      delete process.env.PROMETHEUS_URL;
      
      const url = getInfraUrl('PROMETHEUS');
      expect(url).toBe('http://localhost:9090');
    });

    it('should build ws URL for websocket service', () => {
      delete process.env.L2_WS_PORT;
      delete process.env.L2_WS_URL;
      
      const url = getInfraUrl('L2_WS', 'ws');
      expect(url).toBe('ws://localhost:6547');
    });
  });
});

describe('Port Conflict Detection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should detect no conflicts with default ports', () => {
    // Reset all port env vars to use defaults
    Object.values(CORE_PORTS).forEach(config => delete process.env[config.ENV_VAR]);
    Object.values(VENDOR_PORTS).forEach(config => delete process.env[config.ENV_VAR]);
    Object.values(INFRA_PORTS).forEach(config => delete process.env[config.ENV_VAR]);
    
    const result = checkPortConflicts();
    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it('should detect conflicts when ports overlap', () => {
    // Set two different ports to the same value
    process.env.GATEWAY_PORT = '9999';
    process.env.NODE_EXPLORER_API_PORT = '9999';
    
    const result = checkPortConflicts();
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0]).toContain('9999');
    expect(result.conflicts[0]).toContain('GATEWAY');
    expect(result.conflicts[0]).toContain('NODE_EXPLORER_API');
  });

  it('should detect multiple conflicts', () => {
    process.env.GATEWAY_PORT = '1111';
    process.env.NODE_EXPLORER_API_PORT = '1111';
    process.env.BAZAAR_PORT = '2222';
    process.env.COMPUTE_PORT = '2222';
    
    const result = checkPortConflicts();
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts.length).toBe(2);
  });
});

describe('Port Aggregators', () => {
  it('getAllCorePorts should return all core ports', () => {
    const ports = getAllCorePorts();
    
    expect(typeof ports).toBe('object');
    expect(Object.keys(ports)).toContain('GATEWAY');
    expect(Object.keys(ports)).toContain('BAZAAR');
    expect(Object.keys(ports)).toContain('COMPUTE');
    
    Object.values(ports).forEach(port => {
      expect(typeof port).toBe('number');
      expect(port).toBeGreaterThan(0);
    });
  });

  it('getAllVendorPorts should return all vendor ports', () => {
    const ports = getAllVendorPorts();
    
    expect(typeof ports).toBe('object');
    expect(Object.keys(ports)).toContain('HYPERSCAPE_CLIENT');
    expect(Object.keys(ports)).toContain('LAUNCHPAD_FRONTEND');
    
    Object.values(ports).forEach(port => {
      expect(typeof port).toBe('number');
      expect(port).toBeGreaterThan(0);
    });
  });

  it('getAllInfraPorts should return all infra ports', () => {
    const ports = getAllInfraPorts();
    
    expect(typeof ports).toBe('object');
    expect(Object.keys(ports)).toContain('L1_RPC');
    expect(Object.keys(ports)).toContain('L2_RPC');
    expect(Object.keys(ports)).toContain('PROMETHEUS');
    
    Object.values(ports).forEach(port => {
      expect(typeof port).toBe('number');
      expect(port).toBeGreaterThan(0);
    });
  });
});

describe('RPC URL Helpers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.L1_RPC_URL;
    delete process.env.L2_RPC_URL;
    delete process.env.L2_WS_URL;
    delete process.env.JEJU_RPC_URL;
    delete process.env.RPC_URL;
    delete process.env.RPC_HOST;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getL1RpcUrl', () => {
    it('should return default L1 RPC URL', () => {
      const url = getL1RpcUrl();
      expect(url).toBe('http://127.0.0.1:6545');
    });

    it('should respect L1_RPC_URL env var', () => {
      process.env.L1_RPC_URL = 'http://custom-l1.example.com';
      const url = getL1RpcUrl();
      expect(url).toBe('http://custom-l1.example.com');
    });

    it('should respect RPC_HOST env var', () => {
      process.env.RPC_HOST = '192.168.1.100';
      const url = getL1RpcUrl();
      expect(url).toBe('http://192.168.1.100:6545');
    });
  });

  describe('getL2RpcUrl', () => {
    it('should return default L2 RPC URL', () => {
      const url = getL2RpcUrl();
      expect(url).toBe('http://127.0.0.1:6546');
    });

    it('should respect L2_RPC_URL env var', () => {
      process.env.L2_RPC_URL = 'http://custom-l2.example.com';
      const url = getL2RpcUrl();
      expect(url).toBe('http://custom-l2.example.com');
    });

    it('should respect JEJU_RPC_URL env var', () => {
      process.env.JEJU_RPC_URL = 'http://jeju-rpc.example.com';
      const url = getL2RpcUrl();
      expect(url).toBe('http://jeju-rpc.example.com');
    });

    it('should respect RPC_URL env var', () => {
      process.env.RPC_URL = 'http://rpc.example.com';
      const url = getL2RpcUrl();
      expect(url).toBe('http://rpc.example.com');
    });

    it('should prioritize L2_RPC_URL over JEJU_RPC_URL', () => {
      process.env.L2_RPC_URL = 'http://l2-wins.example.com';
      process.env.JEJU_RPC_URL = 'http://jeju-loses.example.com';
      const url = getL2RpcUrl();
      expect(url).toBe('http://l2-wins.example.com');
    });
  });

  describe('getL2WsUrl', () => {
    it('should return default L2 WS URL', () => {
      const url = getL2WsUrl();
      expect(url).toBe('ws://127.0.0.1:6547');
    });

    it('should respect L2_WS_URL env var', () => {
      process.env.L2_WS_URL = 'ws://custom-ws.example.com';
      const url = getL2WsUrl();
      expect(url).toBe('ws://custom-ws.example.com');
    });
  });

  describe('getJejuRpcUrl', () => {
    it('should be alias for getL2RpcUrl', () => {
      const l2Url = getL2RpcUrl();
      const jejuUrl = getJejuRpcUrl();
      expect(jejuUrl).toBe(l2Url);
    });
  });
});

describe('isLocalnet', () => {
  it('should return true for localhost URLs', () => {
    expect(isLocalnet('http://localhost:8545')).toBe(true);
    expect(isLocalnet('http://localhost:9545')).toBe(true);
    expect(isLocalnet('ws://localhost:8546')).toBe(true);
  });

  it('should return true for 127.0.0.1 URLs', () => {
    expect(isLocalnet('http://127.0.0.1:8545')).toBe(true);
    expect(isLocalnet('http://127.0.0.1:6545')).toBe(true);
    expect(isLocalnet('ws://127.0.0.1:6547')).toBe(true);
  });

  it('should return true for default L1 port', () => {
    expect(isLocalnet('http://somehost:6545')).toBe(true);
  });

  it('should return true for default L2 port', () => {
    expect(isLocalnet('http://somehost:6546')).toBe(true);
  });

  it('should return false for production URLs', () => {
    expect(isLocalnet('https://rpc.jejunetwork.org')).toBe(false);
    expect(isLocalnet('https://mainnet.infura.io')).toBe(false);
    expect(isLocalnet('wss://ws.jejunetwork.org')).toBe(false);
  });
});

describe('Port Range Guidelines', () => {
  it('core ports should be in 3xxx-4xxx range (mostly)', () => {
    const corePorts = getAllCorePorts();
    
    Object.entries(corePorts).forEach(([name, port]) => {
      // Most core ports in 3100-4999 range (storage, apps, indexer)
      if (!['INDEXER_DATABASE'].includes(name)) {
        expect(port).toBeGreaterThanOrEqual(3100);
        expect(port).toBeLessThan(5000);
      }
    });
  });

  it('vendor ports should be in 5xxx range (mostly)', () => {
    const vendorPorts = getAllVendorPorts();
    
    Object.entries(vendorPorts).forEach(([name, port]) => {
      // Vendor ports in 3xxx-5xxx range
      expect(port).toBeGreaterThanOrEqual(3000);
      expect(port).toBeLessThan(6000);
    });
  });

  it('infra ports should be in 6xxx-9xxx range', () => {
    const infraPorts = getAllInfraPorts();
    
    Object.entries(infraPorts).forEach(([name, port]) => {
      // Infra ports: 6xxx for chain RPC, 4010 for grafana, 9xxx for monitoring
      expect(port).toBeGreaterThanOrEqual(4000);
      expect(port).toBeLessThan(10000);
    });
  });

  it('no ports should conflict by default', () => {
    // Reset all env vars
    const originalEnv = { ...process.env };
    
    // Clear all port env vars
    Object.values(CORE_PORTS).forEach(c => delete process.env[c.ENV_VAR]);
    Object.values(VENDOR_PORTS).forEach(c => delete process.env[c.ENV_VAR]);
    Object.values(INFRA_PORTS).forEach(c => delete process.env[c.ENV_VAR]);
    
    const result = checkPortConflicts();
    
    // Restore env
    process.env = { ...originalEnv };
    
    expect(result.hasConflicts).toBe(false);
  });
});

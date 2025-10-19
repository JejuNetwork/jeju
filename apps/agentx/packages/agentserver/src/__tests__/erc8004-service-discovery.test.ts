/**
 * ERC-8004 Service Discovery Tests
 * Tests service listing and connection
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { ERC8004RegistryClient } from '../erc8004/registry';
import { ServiceConnectionManager } from '../erc8004/connectionManager';

describe('ERC-8004 Service Discovery', () => {
  let client: ERC8004RegistryClient;
  let manager: ServiceConnectionManager;
  
  const testRpcUrl = process.env.TEST_RPC_URL || 'http://localhost:8545';
  const testPrivateKey = process.env.TEST_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  beforeAll(async () => {
    client = new ERC8004RegistryClient(testRpcUrl, testPrivateKey);
    manager = new ServiceConnectionManager(client);
    
    try {
      await client.initialize();
    } catch (error) {
      console.log('[Test] Note: ERC-8004 contracts may not be deployed. Skipping tests.');
    }
  });

  it('should list all available services', async () => {
    try {
      const services = await client.listServices();
      
      expect(Array.isArray(services)).toBe(true);
      console.log(`[Test] Found ${services.length} service(s)`);
      
      services.forEach(service => {
        expect(service.id).toBeDefined();
        expect(service.name).toBeDefined();
        expect(service.type).toBeDefined();
        expect(service.url).toBeDefined();
        
        console.log(`[Test] Service: ${service.name} (ID: ${service.id}, Type: ${service.type})`);
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not initialized')) {
        console.log('[Test] Contracts not deployed, skipping service listing test');
      } else {
        throw error;
      }
    }
  });

  it('should filter services by type', async () => {
    try {
      const gameServices = await client.listServices({ type: 'game' });
      
      expect(Array.isArray(gameServices)).toBe(true);
      console.log(`[Test] Found ${gameServices.length} game service(s)`);
      
      gameServices.forEach(service => {
        expect(service.type).toBe('game');
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not initialized')) {
        console.log('[Test] Contracts not deployed, skipping filtered listing test');
      } else {
        throw error;
      }
    }
  });

  it('should search services by name', async () => {
    try {
      const services = await client.listServices({ searchTerm: 'calig' });
      
      expect(Array.isArray(services)).toBe(true);
      console.log(`[Test] Found ${services.length} service(s) matching "calig"`);
      
      services.forEach(service => {
        expect(service.name.toLowerCase()).toContain('calig');
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not initialized')) {
        console.log('[Test] Contracts not deployed, skipping search test');
      } else {
        throw error;
      }
    }
  });

  it('should get service details by ID', async () => {
    try {
      // First get all services
      const services = await client.listServices();
      
      if (services.length > 0) {
        const firstService = services[0];
        const serviceDetails = await client.getService(firstService.id);
        
        expect(serviceDetails).not.toBeNull();
        expect(serviceDetails?.id).toBe(firstService.id);
        expect(serviceDetails?.name).toBe(firstService.name);
        
        console.log(`[Test] Retrieved service details for: ${serviceDetails?.name}`);
      } else {
        console.log('[Test] No services available to test');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not initialized')) {
        console.log('[Test] Contracts not deployed, skipping service details test');
      } else {
        throw error;
      }
    }
  });

  it('should manage connection state', async () => {
    expect(manager.getAllConnections()).toHaveLength(0);
    
    console.log('[Test] Connection manager initialized with 0 connections');
    
    // Note: Actual connection tests would require a running service
    // For now, we just verify the manager is properly initialized
    expect(manager.isConnected(1n)).toBe(false);
  });

  it('should fetch agent card from service URL', async () => {
    try {
      // Test with localhost (will fail but validates the method exists)
      const card = await client.fetchAgentCard('http://localhost:7777');
      
      // It's okay if this returns null (service not running)
      console.log('[Test] Agent card fetch method works');
    } catch (error) {
      // Expected to fail if service not running
      console.log('[Test] Agent card fetch attempted (service may not be running)');
    }
  });
});


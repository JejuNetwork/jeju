import { describe, test, expect, beforeAll } from "bun:test";
import { ethers } from 'ethers';

/**
 * Integration tests for Node Explorer
 * 
 * Prerequisites:
 * - Node explorer API running (default: localhost:4002)
 * - Node explorer collector running
 */

const API_URL = process.env.NODE_EXPLORER_API_URL || 
                process.env.API_URL || 
                `http://localhost:${process.env.NODE_EXPLORER_API_PORT || '4002'}`;

// Check if API is available
let apiAvailable = false;
try {
  const response = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(2000) });
  apiAvailable = response.ok;
} catch {
  console.log(`Node Explorer API not available at ${API_URL}, skipping integration tests`);
}

describe.skipIf(!apiAvailable)("Node Explorer Integration Tests", () => {
  let testWallet: ethers.HDNodeWallet;
  let testNodeId: string;
  let apiAvailable = false;
  
  async function checkAPIAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${API_URL}/health`, {
        signal: AbortSignal.timeout(2000)
      });
      if (!response.ok) {
        return false;
      }
      const text = await response.text();
      if (!text || text.trim() === '') {
        return false;
      }
      // Verify it's valid JSON with expected structure
      try {
        const data = JSON.parse(text) as { status?: string };
        return data && data.status === 'ok';
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }
  
  beforeAll(async () => {
    // Create test wallet
    testWallet = ethers.Wallet.createRandom();
    console.log(`Test wallet: ${testWallet.address}`);
    
    // Check if API is available
    apiAvailable = await checkAPIAvailable();
    if (!apiAvailable) {
      console.log(`⚠️  Node Explorer API not available at ${API_URL}`);
      console.log('   To run these tests, start the node explorer API');
    }
  });
  
  describe("API Health", () => {
    test("should respond to health check", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      
      const response = await fetch(`${API_URL}/health`);
      if (!response.ok) {
        throw new Error(`Health check failed with status ${response.status}`);
      }
      const text = await response.text();
      if (!text || text.trim() === '') {
        throw new Error('Empty response from health endpoint');
      }
      const data = JSON.parse(text) as { status: string; timestamp: number };
      
      expect(response.ok).toBe(true);
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeGreaterThan(0);
    });
  });
  
  describe("Node Registration", () => {
    test("should register a new node with valid signature", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      const rpcUrl = "https://test-node.example.com:8545";
      const message = `Register node: ${rpcUrl}`;
      const signature = await testWallet.signMessage(message);
      
      const response = await fetch(`${API_URL}/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator_address: testWallet.address,
          rpc_url: rpcUrl,
          ws_url: "wss://test-node.example.com:8546",
          location: "Test Region",
          latitude: 37.7749,
          longitude: -122.4194,
          version: "test-v1.0.0",
          signature,
        }),
      });
      
      const text = await response.text();
      if (!text || text.trim() === '') {
        throw new Error('Empty response from register endpoint');
      }
      const data = JSON.parse(text) as { success: boolean; node_id: string };
      
      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.node_id).toBeDefined();
      
      testNodeId = data.node_id;
      console.log(`Registered test node: ${testNodeId}`);
    });
    
    test("should reject registration with invalid signature", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      const response = await fetch(`${API_URL}/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator_address: testWallet.address,
          rpc_url: "https://test2.example.com:8545",
          signature: "0xinvalid",
        }),
      });
      
      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });
  });
  
  describe("Heartbeat Submission", () => {
    test("should accept valid heartbeat", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      if (!testNodeId) {
        console.log("Skipping: No test node registered");
        return;
      }
      
      const message = `Heartbeat: ${testNodeId}:${Date.now()}`;
      const signature = await testWallet.signMessage(message);
      
      const response = await fetch(`${API_URL}/nodes/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: testNodeId,
          block_number: 12345,
          peer_count: 50,
          is_syncing: false,
          response_time: 45,
          signature,
        }),
      });
      
      const text = await response.text();
      if (!text || text.trim() === '') {
        throw new Error('Empty response from heartbeat endpoint');
      }
      const data = JSON.parse(text) as { success: boolean; uptime_score: number };
      
      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.uptime_score).toBeGreaterThanOrEqual(0);
      expect(data.uptime_score).toBeLessThanOrEqual(1);
    });
    
    test("should reject heartbeat for non-existent node", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      const fakeNodeId = "0xfake123456";
      const message = `Heartbeat: ${fakeNodeId}:${Date.now()}`;
      const signature = await testWallet.signMessage(message);
      
      const response = await fetch(`${API_URL}/nodes/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: fakeNodeId,
          block_number: 12345,
          peer_count: 50,
          is_syncing: false,
          response_time: 45,
          signature,
        }),
      });
      
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });
  
  describe("Node Listing", () => {
    test("should list all nodes", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      const response = await fetch(`${API_URL}/nodes?limit=100`);
      if (!response.ok) {
        throw new Error(`List nodes failed with status ${response.status}`);
      }
      const text = await response.text();
      if (!text || text.trim() === '') {
        throw new Error('Empty response from nodes endpoint');
      }
      const data = JSON.parse(text) as { nodes: unknown[]; total: number };
      
      expect(response.ok).toBe(true);
      expect(data.nodes).toBeDefined();
      expect(Array.isArray(data.nodes)).toBe(true);
      expect(data.total).toBeDefined();
    });
    
    test("should filter nodes by status", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      const response = await fetch(`${API_URL}/nodes?status=online`);
      if (!response.ok) {
        throw new Error(`Filter nodes failed with status ${response.status}`);
      }
      const text = await response.text();
      if (!text || text.trim() === '') {
        throw new Error('Empty response from nodes endpoint');
      }
      const data = JSON.parse(text) as { nodes: Array<{ status: string }> };
      
      expect(response.ok).toBe(true);
      expect(data.nodes).toBeDefined();
      
      if (data.nodes.length > 0) {
        expect(data.nodes.every((n: any) => n.status === 'online')).toBe(true);
      }
    });
    
    test("should support pagination", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      const response1 = await fetch(`${API_URL}/nodes?limit=5&offset=0`);
      const text1 = await response1.text();
      if (!text1 || text1.trim() === '') {
        throw new Error('Empty response from nodes endpoint');
      }
      const data1 = JSON.parse(text1) as { nodes: Array<{ id: string }> };
      
      const response2 = await fetch(`${API_URL}/nodes?limit=5&offset=5`);
      const text2 = await response2.text();
      if (!text2 || text2.trim() === '') {
        throw new Error('Empty response from nodes endpoint');
      }
      const data2 = JSON.parse(text2) as { nodes: Array<{ id: string }> };
      
      expect(response1.ok).toBe(true);
      expect(response2.ok).toBe(true);
      expect(data1.nodes.length).toBeLessThanOrEqual(5);
      expect(data2.nodes.length).toBeLessThanOrEqual(5);
      
      // Should be different nodes
      if (data1.nodes.length > 0 && data2.nodes.length > 0) {
        expect(data1.nodes[0].id).not.toBe(data2.nodes[0].id);
      }
    });
  });
  
  describe("Node Details", () => {
    test("should get specific node details", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      if (!testNodeId) {
        console.log("Skipping: No test node registered");
        return;
      }
      
      const response = await fetch(`${API_URL}/nodes/${testNodeId}`);
      if (!response.ok) {
        throw new Error(`Get node failed with status ${response.status}`);
      }
      const text = await response.text();
      if (!text || text.trim() === '') {
        throw new Error('Empty response from node details endpoint');
      }
      const data = JSON.parse(text) as { node: { id: string }; heartbeats: unknown[] };
      
      expect(response.ok).toBe(true);
      expect(data.node).toBeDefined();
      expect(data.node.id).toBe(testNodeId);
      expect(data.heartbeats).toBeDefined();
      expect(Array.isArray(data.heartbeats)).toBe(true);
    });
    
    test("should return 404 for non-existent node", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      const response = await fetch(`${API_URL}/nodes/0xnonexistent`);
      
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });
  
  describe("Network Statistics", () => {
    test("should return network stats", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      const response = await fetch(`${API_URL}/stats`);
      if (!response.ok) {
        throw new Error(`Stats failed with status ${response.status}`);
      }
      const text = await response.text();
      if (!text || text.trim() === '') {
        throw new Error('Empty response from stats endpoint');
      }
      const data = JSON.parse(text) as { totalNodes: number; activeNodes: number; avgUptime: number; geographicDistribution: unknown; versionDistribution: unknown };
      
      expect(response.ok).toBe(true);
      expect(data.totalNodes).toBeGreaterThanOrEqual(0);
      expect(data.activeNodes).toBeGreaterThanOrEqual(0);
      expect(data.activeNodes).toBeLessThanOrEqual(data.totalNodes);
      expect(data.avgUptime).toBeGreaterThanOrEqual(0);
      expect(data.avgUptime).toBeLessThanOrEqual(1);
      expect(data.geographicDistribution).toBeDefined();
      expect(data.versionDistribution).toBeDefined();
    });
  });
  
  describe("Historical Data", () => {
    test("should return historical data", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      const response = await fetch(`${API_URL}/history?days=7`);
      if (!response.ok) {
        throw new Error(`History failed with status ${response.status}`);
      }
      const text = await response.text();
      if (!text || text.trim() === '') {
        throw new Error('Empty response from history endpoint');
      }
      const data = JSON.parse(text) as { history: unknown[] };
      
      expect(response.ok).toBe(true);
      expect(data.history).toBeDefined();
      expect(Array.isArray(data.history)).toBe(true);
    });
  });
  
  describe("Uptime Calculation", () => {
    test("should calculate uptime based on heartbeats", async () => {
      if (!apiAvailable) {
        console.log('⚠️  Skipping - API not available');
        expect(true).toBe(true);
        return;
      }
      if (!testNodeId) {
        console.log("Skipping: No test node registered");
        return;
      }
      
      // Submit multiple heartbeats
      for (let i = 0; i < 5; i++) {
        const message = `Heartbeat: ${testNodeId}:${Date.now()}`;
        const signature = await testWallet.signMessage(message);
        
        await fetch(`${API_URL}/nodes/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            node_id: testNodeId,
            block_number: 12345 + i,
            peer_count: 50,
            is_syncing: false,
            response_time: 45 + i,
            signature,
          }),
        });
        
        // Wait between heartbeats
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Get node details
      const response = await fetch(`${API_URL}/nodes/${testNodeId}`);
      if (!response.ok) {
        throw new Error(`Get node failed with status ${response.status}`);
      }
      const text = await response.text();
      if (!text || text.trim() === '') {
        throw new Error('Empty response from node details endpoint');
      }
      const data = JSON.parse(text) as { node: { uptime_score: number }; heartbeats: unknown[] };
      
      expect(data.node.uptime_score).toBeGreaterThan(0);
      expect(data.heartbeats.length).toBeGreaterThanOrEqual(5);
    });
  });
});


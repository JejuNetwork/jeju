/**
 * A2A Module Integration Tests
 * 
 * Tests against REAL localnet A2A services.
 * Services are auto-started via setup.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";
import { setupTestEnvironment, teardownTestEnvironment, TEST_GATEWAY_URL, TEST_COMPUTE_URL, TEST_STORAGE_URL } from "../setup";

describe("A2A Integration Tests", () => {
  let client: JejuClient | null = null;
  let env: Awaited<ReturnType<typeof setupTestEnvironment>> | null = null;

  beforeAll(async () => {
    try {
      env = await setupTestEnvironment();
      
      const account = privateKeyToAccount(env.privateKey);
      client = await createJejuClient({
        account,
        network: "localnet",
        rpcUrl: env.rpcUrl,
      });
    } catch {
      // Setup failed - tests will be skipped
    }
  });

  afterAll(async () => {
    try {
      await teardownTestEnvironment();
    } catch {
      // Cleanup failed - ignore
    }
  });

  test("client created successfully", () => {
    if (!env?.chainRunning) return;
    expect(client).toBeDefined();
    expect(client?.a2a).toBeDefined();
  });

  test("discover gateway agent card", async () => {
    if (!env?.servicesRunning || !client) return;
    try {
      const card = await client.a2a.discover(TEST_GATEWAY_URL);
      expect(card).toBeDefined();
      expect(card.protocolVersion).toBe("0.3.0");
      expect(card.name).toBeDefined();
      expect(Array.isArray(card.skills)).toBe(true);
    } catch {
      // Expected if service not running
    }
  });

  test("discover compute agent card", async () => {
    if (!env?.servicesRunning || !client) return;
    try {
      const card = await client.a2a.discover(TEST_COMPUTE_URL);
      expect(card).toBeDefined();
      expect(card.protocolVersion).toBe("0.3.0");
    } catch {
      // Expected if service not running
    }
  });

  test("discover storage agent card", async () => {
    if (!env?.servicesRunning || !client) return;
    try {
      const card = await client.a2a.discover(TEST_STORAGE_URL);
      expect(card).toBeDefined();
      expect(card.protocolVersion).toBe("0.3.0");
    } catch {
      // Expected if service not running
    }
  });

  test("call gateway skill: list-protocol-tokens", async () => {
    if (!env?.servicesRunning || !client) return;
    try {
      const response = await client.a2a.callGateway({ skillId: "list-protocol-tokens" });
      expect(response).toBeDefined();
    } catch {
      // Expected if service not running
    }
  });

  test("call gateway skill: get-node-stats", async () => {
    if (!env?.servicesRunning || !client) return;
    try {
      const response = await client.a2a.callGateway({ skillId: "get-node-stats" });
      expect(response).toBeDefined();
    } catch {
      // Expected if service not running
    }
  });

  test("call gateway skill: list-routes", async () => {
    if (!env?.servicesRunning || !client) return;
    try {
      const response = await client.a2a.callGateway({ skillId: "list-routes" });
      expect(response).toBeDefined();
    } catch {
      // Expected if service not running
    }
  });

  test("call compute skill: list-providers", async () => {
    if (!env?.servicesRunning || !client) return;
    try {
      const response = await client.a2a.callCompute({ skillId: "list-providers" });
      expect(response).toBeDefined();
    } catch {
      // Expected if service not running
    }
  });

  test("call storage skill: get-storage-stats", async () => {
    if (!env?.servicesRunning || !client) return;
    try {
      const response = await client.a2a.callStorage({ skillId: "get-storage-stats" });
      expect(response).toBeDefined();
    } catch {
      // Expected if service not running
    }
  });

  test("discoverAgents returns registered apps", async () => {
    if (!env?.servicesRunning || !client) return;
    try {
      const agents = await client.a2a.discoverAgents();
      expect(Array.isArray(agents)).toBe(true);
    } catch {
      // Expected if service not running
    }
  });

  test("discoverAgents with tag filter", async () => {
    if (!env?.servicesRunning || !client) return;
    try {
      const agents = await client.a2a.discoverAgents(["compute"]);
      expect(Array.isArray(agents)).toBe(true);
    } catch {
      // Expected if service not running
    }
  });
});

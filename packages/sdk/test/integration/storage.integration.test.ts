/**
 * Storage Module Integration Tests
 * 
 * Tests against REAL localnet IPFS services.
 * Services are auto-started via setup.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";
import { setupTestEnvironment, teardownTestEnvironment } from "../setup";

describe("Storage Integration Tests", () => {
  let client: JejuClient;
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let uploadedCid: string | null = null;

  beforeAll(async () => {
    env = await setupTestEnvironment();
    
    const account = privateKeyToAccount(env.privateKey);
    client = await createJejuClient({
      account,
      network: "localnet",
      rpcUrl: env.rpcUrl,
    });
  }, 90000); // 90 second timeout for service startup

  afterAll(async () => {
    // Cleanup: unpin uploaded file
    if (uploadedCid) {
      try {
        await client.storage.unpin(uploadedCid);
      } catch {
        // Ignore
      }
    }
    await teardownTestEnvironment();
  }, 10000);

  test("client created successfully", () => {
    expect(client).toBeDefined();
    expect(client.storage).toBeDefined();
  });

  test("estimateCost returns valid bigint", () => {
    const cost = client.storage.estimateCost(1024 * 1024, 1, "warm");
    expect(typeof cost).toBe("bigint");
    expect(cost > 0n).toBe(true);
  });

  test("getGatewayUrl returns valid URL", () => {
    const url = client.storage.getGatewayUrl("QmTest123");
    expect(url).toContain("QmTest123");
    expect(url.startsWith("http")).toBe(true);
  });

  test("upload file and get CID", async () => {
    if (!env.servicesRunning) return;

    const testContent = `Test content ${Date.now()}`;
    const blob = new Blob([testContent], { type: "text/plain" });

    const result = await client.storage.upload(blob, { name: "test.txt" });
    expect(result).toBeDefined();
    expect(result.cid).toBeDefined();
    expect(result.cid.length).toBeGreaterThan(10);
    uploadedCid = result.cid;
  });

  test("retrieve uploaded file", async () => {
    if (!env.servicesRunning || !uploadedCid) return;

    const content = await client.storage.retrieve(uploadedCid);
    expect(content).toBeDefined();
  });

  test("pin existing CID", async () => {
    if (!env.servicesRunning || !uploadedCid) return;

    await client.storage.pin(uploadedCid);
  });

  test("listPins returns array", async () => {
    if (!env.servicesRunning) return;

    const pins = await client.storage.listPins();
    expect(Array.isArray(pins)).toBe(true);
  });

  test("getStats returns storage statistics", async () => {
    if (!env.servicesRunning) return;

    const stats = await client.storage.getStats();
    expect(stats).toBeDefined();
    expect(typeof stats.totalPins).toBe("number");
    expect(typeof stats.totalSizeGB).toBe("number");
  });

  test("unpin file", async () => {
    if (!env.servicesRunning || !uploadedCid) return;

    await client.storage.unpin(uploadedCid);
    uploadedCid = null;
  });
});

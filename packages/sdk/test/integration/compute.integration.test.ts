/**
 * Compute Module Integration Tests
 * 
 * Tests against REAL localnet services.
 * Services are auto-started via setup.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";
import { setupTestEnvironment, teardownTestEnvironment } from "../setup";

describe("Compute Integration Tests", () => {
  let client: JejuClient;
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>;

  beforeAll(async () => {
    env = await setupTestEnvironment();
    
    const account = privateKeyToAccount(env.privateKey);
    client = await createJejuClient({
      account,
      network: "localnet",
      rpcUrl: env.rpcUrl,
    });
  });

  afterAll(async () => {
    await teardownTestEnvironment();
  });

  test("client created successfully", () => {
    expect(client).toBeDefined();
    expect(client.compute).toBeDefined();
  });

  test("listProviders returns array", async () => {
    if (!env.chainRunning) return;

    const providers = await client.compute.listProviders();
    expect(Array.isArray(providers)).toBe(true);
  });

  test("listProviders filters by GPU type", async () => {
    if (!env.chainRunning) return;

    const providers = await client.compute.listProviders({ gpuType: "NVIDIA_H100" });
    expect(Array.isArray(providers)).toBe(true);
    
    for (const p of providers) {
      if (p.resources?.gpuType) {
        expect(p.resources.gpuType).toBe("NVIDIA_H100");
      }
    }
  });

  test("listModels returns available AI models", async () => {
    if (!env.chainRunning) return;

    const models = await client.compute.listModels();
    expect(Array.isArray(models)).toBe(true);
  });

  test("listMyRentals returns user rentals", async () => {
    if (!env.chainRunning) return;

    const rentals = await client.compute.listMyRentals();
    expect(Array.isArray(rentals)).toBe(true);
  });

  test("listTriggers returns trigger list", async () => {
    if (!env.chainRunning) return;

    const triggers = await client.compute.listTriggers();
    expect(Array.isArray(triggers)).toBe(true);
  });

  test("getPrepaidBalance returns bigint", async () => {
    if (!env.chainRunning) return;

    const balance = await client.compute.getPrepaidBalance();
    expect(typeof balance).toBe("bigint");
  });

  test("getQuote returns price estimate", async () => {
    if (!env.chainRunning) return;

    const providers = await client.compute.listProviders();
    if (providers.length === 0) return;

    const quote = await client.compute.getQuote(providers[0].address, 1);
    expect(quote).toBeDefined();
    expect(typeof quote.cost).toBe("bigint");
    expect(quote.costFormatted).toBeDefined();
  });
});

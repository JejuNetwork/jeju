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
  }, 90000); // 90 second timeout for service startup

  afterAll(async () => {
    await teardownTestEnvironment();
  }, 10000);

  test("client created successfully", () => {
    expect(client).toBeDefined();
    expect(client.compute).toBeDefined();
  });

  test("listProviders returns array (requires contracts)", async () => {
    if (!env.contractsDeployed) return;

    const providers = await client.compute.listProviders();
    expect(Array.isArray(providers)).toBe(true);
  });

  test("listProviders filters by GPU type (requires contracts)", async () => {
    if (!env.contractsDeployed) return;

    const providers = await client.compute.listProviders({ gpuType: "NVIDIA_H100" });
    expect(Array.isArray(providers)).toBe(true);
    
    for (const p of providers) {
      if (p.resources?.gpuType) {
        expect(p.resources.gpuType).toBe("NVIDIA_H100");
      }
    }
  });

  test("listModels returns available AI models (requires contracts)", async () => {
    if (!env.contractsDeployed) return;

    const models = await client.compute.listModels();
    expect(Array.isArray(models)).toBe(true);
  });

  test("listMyRentals returns user rentals (requires contracts)", async () => {
    if (!env.contractsDeployed) return;

    const rentals = await client.compute.listMyRentals();
    expect(Array.isArray(rentals)).toBe(true);
  });

  test("listTriggers returns trigger list (requires contracts)", async () => {
    if (!env.contractsDeployed) return;

    const triggers = await client.compute.listTriggers();
    expect(Array.isArray(triggers)).toBe(true);
  });

  test("getPrepaidBalance returns bigint (requires contracts)", async () => {
    if (!env.contractsDeployed) return;

    const balance = await client.compute.getPrepaidBalance();
    expect(typeof balance).toBe("bigint");
  });

  test("getQuote returns price estimate (requires contracts)", async () => {
    if (!env.contractsDeployed) return;

    const providers = await client.compute.listProviders();
    if (providers.length === 0) return;

    const quote = await client.compute.getQuote(providers[0].address, 1);
    expect(quote).toBeDefined();
    expect(typeof quote.cost).toBe("bigint");
    expect(quote.costFormatted).toBeDefined();
  });
});

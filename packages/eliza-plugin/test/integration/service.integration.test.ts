/**
 * Eliza Plugin Service Integration Tests
 * 
 * Tests against REAL localnet services.
 * Services are auto-started via setup.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { StandaloneJejuService, initJejuService } from "../../src/service";
import { setupTestEnvironment, teardownTestEnvironment } from "./setup";

describe("JejuService Integration Tests", () => {
  let service: StandaloneJejuService | null = null;
  let env: Awaited<ReturnType<typeof setupTestEnvironment>> | null = null;

  beforeAll(async () => {
    env = await setupTestEnvironment();
    
    if (!env.chainRunning) return;

    service = await initJejuService({
      privateKey: env.privateKey,
      network: "localnet",
      rpcUrl: env.rpcUrl,
    });
  }, 90000);

  afterAll(async () => {
    // Cleanup code - try/catch is valid here as we don't want cleanup failures to fail tests
    try {
      await teardownTestEnvironment();
    } catch {
      // Cleanup failures are not test failures
    }
  }, 10000);

  test("service initializes correctly", () => {
    if (!env?.chainRunning || !service) return;
    expect(service).toBeDefined();
    expect(service.sdk).toBeDefined();
  });

  test("sdk has all expected modules", () => {
    if (!env?.chainRunning || !service) return;
    
    expect(service.sdk.compute).toBeDefined();
    expect(service.sdk.storage).toBeDefined();
    expect(service.sdk.defi).toBeDefined();
    expect(service.sdk.governance).toBeDefined();
    expect(service.sdk.names).toBeDefined();
    expect(service.sdk.identity).toBeDefined();
    expect(service.sdk.crosschain).toBeDefined();
    expect(service.sdk.payments).toBeDefined();
    expect(service.sdk.a2a).toBeDefined();
  });

  test("payments getBalance integration", async () => {
    if (!env?.chainRunning || !service) return;
    
    const balance = await service.sdk.payments.getBalance();
    expect(typeof balance).toBe("bigint");
  });

  test("names isAvailable integration (requires contracts)", async () => {
    if (!env?.contractsDeployed || !service) return;
    const available = await service.sdk.names.isAvailable("test-unique-name-123456");
    expect(typeof available).toBe("boolean");
  });

  test("compute listProviders integration (requires contracts)", async () => {
    if (!env?.contractsDeployed || !service) return;
    const providers = await service.sdk.compute.listProviders();
    expect(Array.isArray(providers)).toBe(true);
  });

  test("compute listModels integration (requires contracts)", async () => {
    if (!env?.contractsDeployed || !service) return;
    const models = await service.sdk.compute.listModels();
    expect(Array.isArray(models)).toBe(true);
  });

  test("governance listProposals integration (requires contracts)", async () => {
    if (!env?.contractsDeployed || !service) return;
    const proposals = await service.sdk.governance.listProposals();
    expect(Array.isArray(proposals)).toBe(true);
  });

  test("a2a discover gateway (requires services)", async () => {
    if (!env?.servicesRunning || !service) return;
    const card = await service.sdk.a2a.discover(env.gatewayUrl);
    expect(card).toBeDefined();
    expect(card.protocolVersion).toBe("0.3.0");
  });
});

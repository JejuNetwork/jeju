/**
 * Eliza Plugin Service Integration Tests
 * 
 * Tests against REAL localnet services.
 * Services are auto-started via setup.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { JejuService, initJejuService, getJejuService } from "../../src/service";
import { setupTestEnvironment, teardownTestEnvironment } from "./setup";

describe("JejuService Integration Tests", () => {
  let service: JejuService;
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>;

  beforeAll(async () => {
    env = await setupTestEnvironment();
    
    // Initialize service with test config
    service = await initJejuService({
      privateKey: env.privateKey,
      network: "localnet",
      rpcUrl: env.rpcUrl,
    });
  });

  afterAll(async () => {
    await teardownTestEnvironment();
  });

  test("service initializes correctly", () => {
    expect(service).toBeDefined();
    expect(service.sdk).toBeDefined();
    expect(service.config).toBeDefined();
    expect(service.config.network).toBe("localnet");
  });

  test("getJejuService returns same instance", () => {
    const retrieved = getJejuService();
    expect(retrieved).toBe(service);
  });

  test("service has wallet configured", () => {
    expect(service.sdk.wallet).toBeDefined();
    expect(service.sdk.wallet.address).toBeDefined();
    expect(service.sdk.wallet.address.startsWith("0x")).toBe(true);
  });

  test("service has compute module", () => {
    expect(service.sdk.compute).toBeDefined();
    expect(typeof service.sdk.compute.listProviders).toBe("function");
    expect(typeof service.sdk.compute.listModels).toBe("function");
  });

  test("service has storage module", () => {
    expect(service.sdk.storage).toBeDefined();
    expect(typeof service.sdk.storage.upload).toBe("function");
    expect(typeof service.sdk.storage.retrieve).toBe("function");
  });

  test("service has governance module", () => {
    expect(service.sdk.governance).toBeDefined();
    expect(typeof service.sdk.governance.listProposals).toBe("function");
    expect(typeof service.sdk.governance.vote).toBe("function");
  });

  test("service has names module", () => {
    expect(service.sdk.names).toBeDefined();
    expect(typeof service.sdk.names.resolve).toBe("function");
    expect(typeof service.sdk.names.lookup).toBe("function");
  });

  test("service has a2a module", () => {
    expect(service.sdk.a2a).toBeDefined();
    expect(typeof service.sdk.a2a.discover).toBe("function");
    expect(typeof service.sdk.a2a.callSkill).toBe("function");
  });

  test("service can refresh wallet data", async () => {
    if (!env.chainRunning) return;
    
    // Should not throw
    await service.refreshWalletData();
    expect(service.sdk.wallet.address).toBeDefined();
  });

  test("compute listProviders integration", async () => {
    if (!env.chainRunning) return;

    const providers = await service.sdk.compute.listProviders();
    expect(Array.isArray(providers)).toBe(true);
  });

  test("compute listModels integration", async () => {
    if (!env.chainRunning) return;

    const models = await service.sdk.compute.listModels();
    expect(Array.isArray(models)).toBe(true);
  });

  test("governance listProposals integration", async () => {
    if (!env.chainRunning) return;

    const proposals = await service.sdk.governance.listProposals();
    expect(Array.isArray(proposals)).toBe(true);
  });

  test("a2a discover gateway", async () => {
    if (!env.servicesRunning) return;

    const card = await service.sdk.a2a.discover(env.gatewayUrl);
    expect(card).toBeDefined();
    expect(card.protocolVersion).toBe("0.3.0");
  });
});

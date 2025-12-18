/**
 * DWS Module Integration Tests
 *
 * Tests Distributed Workflow System against live localnet.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createJejuClient, type JejuClient, TriggerType, JobStatus } from "../../src";
import { privateKeyToAccount } from "viem/accounts";
import { parseEther, type Hex } from "viem";
import { setupTestEnvironment, teardownTestEnvironment } from "../setup";

describe("DWS Module Integration Tests", () => {
  let client: JejuClient;
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let skipTests = false;

  beforeAll(async () => {
    env = await setupTestEnvironment();

    if (!env.chainRunning) {
      console.log("⚠ Chain not running - skipping DWS tests");
      skipTests = true;
      return;
    }

    const account = privateKeyToAccount(env.privateKey);
    client = await createJejuClient({
      account,
      network: "localnet",
      rpcUrl: env.rpcUrl,
      smartAccount: false,
    });
  }, 90000);

  afterAll(async () => {
    await teardownTestEnvironment();
  }, 10000);

  describe("Trigger Management", () => {
    test("listTriggers returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const triggers = await client.dws.listTriggers();
      expect(Array.isArray(triggers)).toBe(true);
    });

    test("getTrigger returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const trigger = await client.dws.getTrigger("0x" + "00".repeat(32) as Hex);
      expect(trigger).toBeNull();
    });
  });

  describe("Workflow Management", () => {
    test("listWorkflows returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const workflows = await client.dws.listWorkflows();
      expect(Array.isArray(workflows)).toBe(true);
    });

    test("getWorkflow returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const workflow = await client.dws.getWorkflow("0x" + "00".repeat(32) as Hex);
      expect(workflow).toBeNull();
    });
  });

  describe("Job Management", () => {
    test("listMyJobs returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const jobs = await client.dws.listMyJobs();
      expect(Array.isArray(jobs)).toBe(true);
    });

    test("listJobs with filter returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const jobs = await client.dws.listJobs({ status: JobStatus.COMPLETED });
      expect(Array.isArray(jobs)).toBe(true);
    });

    test("getJob returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const job = await client.dws.getJob("0x" + "00".repeat(32) as Hex);
      expect(job).toBeNull();
    });
  });

  describe("Statistics", () => {
    test("getStats returns statistics object", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const stats = await client.dws.getStats();
      expect(stats).toBeDefined();
      expect(typeof stats.totalJobs).toBe("number");
    });
  });
});



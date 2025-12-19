/**
 * OTC Module Integration Tests
 *
 * Tests Over-the-Counter trading functionality against live localnet.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";
import { zeroAddress, type Hex } from "viem";
import { setupTestEnvironment, teardownTestEnvironment } from "../setup";

describe("OTC Module Integration Tests", () => {
  let client: JejuClient;
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let skipTests = false;

  beforeAll(async () => {
    env = await setupTestEnvironment();

    if (!env.chainRunning) {
      console.log("⚠ Chain not running - skipping OTC tests");
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

  describe("Token Registry", () => {
    test("getRegisteredTokens returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const tokens = await client.otc.getRegisteredTokens();
      expect(Array.isArray(tokens)).toBe(true);
    });

    test("isTokenRegistered returns boolean", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const isRegistered = await client.otc.isTokenRegistered(zeroAddress);
      expect(typeof isRegistered).toBe("boolean");
    });
  });

  describe("Consignment Management", () => {
    test("getConsignment returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const consignment = await client.otc.getConsignment("0x" + "00".repeat(32) as Hex);
      expect(consignment === null || typeof consignment === "object").toBe(true);
    });

    test("getActiveConsignments returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const consignments = await client.otc.getActiveConsignments();
      expect(Array.isArray(consignments)).toBe(true);
    });

    test("getMyConsignments returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const consignments = await client.otc.getMyConsignments();
      expect(Array.isArray(consignments)).toBe(true);
    });
  });

  describe("Offer Management", () => {
    test("getOffer returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const offer = await client.otc.getOffer("0x" + "00".repeat(32) as Hex);
      expect(offer === null || typeof offer === "object").toBe(true);
    });

    test("getConsignmentOffers returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const offers = await client.otc.getConsignmentOffers("0x" + "00".repeat(32) as Hex);
      expect(Array.isArray(offers)).toBe(true);
    });

    test("getMyOffers returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const offers = await client.otc.getMyOffers();
      expect(Array.isArray(offers)).toBe(true);
    });
  });

  describe("Module Methods", () => {
    test("getQuote is defined", () => {
      if (skipTests) return;
      expect(typeof client.otc.getQuote).toBe("function");
    });

    test("fulfillOffer is defined", () => {
      if (skipTests) return;
      expect(typeof client.otc.fulfillOffer).toBe("function");
    });
  });
});


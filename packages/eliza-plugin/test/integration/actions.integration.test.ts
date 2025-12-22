/**
 * Eliza Plugin Actions Integration Tests
 * 
 * Tests plugin actions against REAL localnet services.
 * Run: jeju dev first, then bun test
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { createJejuClient, type JejuClient } from "@jejunetwork/sdk";
import { privateKeyToAccount } from "viem/accounts";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:9545";
const GATEWAY_URL = process.env.GATEWAY_URL || "http://127.0.0.1:4003";
const COMPUTE_URL = process.env.COMPUTE_URL || "http://127.0.0.1:4007";
const STORAGE_URL = process.env.STORAGE_URL || "http://127.0.0.1:4010";

describe("Eliza Plugin Actions Integration", () => {
  let client: JejuClient;
  let chainRunning = false;
  let gatewayRunning = false;
  let computeRunning = false;
  let storageRunning = false;

  beforeAll(async () => {
    // Health check functions - try/catch is valid here as network failures mean "not healthy"
    const checkHttp = async (url: string): Promise<boolean> => {
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
        return response.ok;
      } catch {
        return false;
      }
    };

    const checkRpc = async (url: string): Promise<boolean> => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 }),
          signal: AbortSignal.timeout(3000),
        });
        return response.ok;
      } catch {
        return false;
      }
    };

    chainRunning = await checkRpc(RPC_URL);
    gatewayRunning = await checkHttp(GATEWAY_URL);
    computeRunning = await checkHttp(COMPUTE_URL);
    storageRunning = await checkHttp(STORAGE_URL);

    if (!chainRunning) {
      console.log("⚠️ Chain not running - some tests will be skipped");
      console.log("   Start with: jeju dev");
      return;
    }

    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    try {
      client = await createJejuClient({
        account,
        network: "localnet",
        rpcUrl: RPC_URL,
        smartAccount: false,
      });
    } catch (e) {
      console.log("⚠️ Client creation failed (contracts may not be deployed):", (e as Error).message);
    }
  });

  describe("Compute Actions", () => {
    test("list providers via SDK", async () => {
      if (!computeRunning || !client) return;
      const providers = await client.compute.listProviders();
      expect(Array.isArray(providers)).toBe(true);
    });

    test("list AI models via SDK", async () => {
      if (!computeRunning || !client) return;
      const models = await client.compute.listModels();
      expect(Array.isArray(models)).toBe(true);
    });

    test("list rentals via SDK", async () => {
      if (!computeRunning || !client) return;
      const rentals = await client.compute.listMyRentals();
      expect(Array.isArray(rentals)).toBe(true);
    });
  });

  describe("Storage Actions", () => {
    test("estimate storage cost", () => {
      if (!client) return;
      const cost = client.storage.estimateCost(1024 * 1024, 1, "warm");
      expect(cost > 0n).toBe(true);
    });

    test("get gateway URL", () => {
      if (!client) return;
      const url = client.storage.getGatewayUrl("QmTest");
      expect(url).toContain("QmTest");
    });

    test("upload and retrieve file", async () => {
      if (!storageRunning || !client) return;
      const content = `test-${Date.now()}`;
      const blob = new Blob([content], { type: "text/plain" });
      
      const cid = await client.storage.upload(blob);
      expect(cid).toBeDefined();
      
      const retrieved = await client.storage.retrieve(cid);
      expect(retrieved).toBeDefined();
    });

    test("list pins via SDK", async () => {
      if (!storageRunning || !client) return;
      const pins = await client.storage.listPins();
      expect(Array.isArray(pins)).toBe(true);
    });

    test("get storage stats via SDK", async () => {
      if (!storageRunning || !client) return;
      const stats = await client.storage.getStats();
      expect(stats.totalPins).toBeDefined();
    });
  });

  describe("DeFi Actions", () => {
    test("list pools via SDK", async () => {
      if (!chainRunning || !client) return;
      const pools = await client.defi.listPools();
      expect(Array.isArray(pools)).toBe(true);
    });

    test("list positions via SDK", async () => {
      if (!chainRunning || !client) return;
      const positions = await client.defi.listPositions();
      expect(Array.isArray(positions)).toBe(true);
    });
  });

  describe("Governance Actions", () => {
    test("list proposals via SDK", async () => {
      if (!chainRunning || !client) return;
      const proposals = await client.governance.listProposals();
      expect(Array.isArray(proposals)).toBe(true);
    });

    test("get voting power via SDK", async () => {
      if (!chainRunning || !client) return;
      const power = await client.governance.getVotingPower();
      expect(typeof power).toBe("bigint");
    });
  });

  describe("Names (JNS) Actions", () => {
    test("check name availability", async () => {
      if (!chainRunning || !client) return;
      const available = await client.names.isAvailable("test-name-12345");
      expect(typeof available).toBe("boolean");
    });

    test("get registration cost", async () => {
      if (!chainRunning || !client) return;
      const cost = await client.names.getRegistrationCost("test", 1);
      expect(typeof cost).toBe("bigint");
    });
  });

  describe("Identity Actions", () => {
    test("get my agent returns null or agent", async () => {
      if (!chainRunning || !client) return;
      const agent = await client.identity.getAgent(client.address);
      expect(agent === null || typeof agent === "object").toBe(true);
    });

    test("check ban status", async () => {
      if (!chainRunning || !client) return;
      const banned = await client.identity.isBanned(client.address);
      expect(typeof banned).toBe("boolean");
    });
  });

  describe("Cross-chain Actions", () => {
    test("get supported chains", () => {
      if (!client) return;
      const chains = client.crosschain.getSupportedChains();
      expect(Array.isArray(chains)).toBe(true);
    });

    test("list solvers via SDK", async () => {
      if (!chainRunning || !client) return;
      const solvers = await client.crosschain.listSolvers();
      expect(Array.isArray(solvers)).toBe(true);
    });
  });

  describe("A2A Actions", () => {
    test("discover gateway agent", async () => {
      if (!gatewayRunning || !client) return;
      const card = await client.a2a.discover(GATEWAY_URL);
      expect(card).toBeDefined();
      expect(card.protocolVersion).toBe("0.3.0");
    });

    test("call compute skill", async () => {
      if (!computeRunning || !client) return;
      const response = await client.a2a.call(COMPUTE_URL, {
        skill: "compute/list-providers",
        input: {},
      });
      expect(response).toBeDefined();
    });
  });

  describe("Payments Actions", () => {
    test("get balance", async () => {
      if (!chainRunning || !client) return;
      const balance = await client.payments.getBalance();
      expect(typeof balance).toBe("bigint");
    });

    test("get credits returns bigint", async () => {
      if (!chainRunning || !client) return;
      const credits = await client.payments.getCredits();
      expect(typeof credits).toBe("bigint");
    });
  });
});

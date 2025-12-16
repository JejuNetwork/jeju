/**
 * Full Workflow E2E Tests
 * 
 * Tests complete user flows against REAL localnet.
 * Requires: jeju dev running
 * 
 * Run: bun test test/e2e/
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { parseEther } from "viem";

const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const STORAGE_URL = process.env.STORAGE_API_URL || "http://127.0.0.1:4010";
const COMPUTE_URL = process.env.COMPUTE_API_URL || "http://127.0.0.1:4007";
const GATEWAY_URL = process.env.GATEWAY_A2A_URL || "http://127.0.0.1:4003";

describe("Full Workflow E2E", () => {
  let deployerClient: JejuClient;
  let userClient: JejuClient;
  let chainRunning = false;
  let servicesRunning = false;

  // Track created resources for cleanup
  const testResources: {
    cids: string[];
    rentalIds: string[];
    proposalIds: bigint[];
    agentId?: bigint;
    registeredName?: string;
  } = { cids: [], rentalIds: [], proposalIds: [] };

  beforeAll(async () => {
    // Check chain
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 }),
        signal: AbortSignal.timeout(3000),
      });
      chainRunning = response.ok;
    } catch {
      console.log("⚠️ Chain not running - E2E tests will be skipped");
      console.log("   Start with: jeju dev");
    }

    // Check services
    const checkService = async (url: string): Promise<boolean> => {
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
        return response.ok;
      } catch {
        return false;
      }
    };

    const storageOk = await checkService(STORAGE_URL);
    const computeOk = await checkService(COMPUTE_URL);
    const gatewayOk = await checkService(GATEWAY_URL);
    servicesRunning = storageOk && computeOk && gatewayOk;

    if (!servicesRunning) {
      console.log("⚠️ Not all services running:");
      console.log(`   Storage: ${storageOk ? "✓" : "✗"}`);
      console.log(`   Compute: ${computeOk ? "✓" : "✗"}`);
      console.log(`   Gateway: ${gatewayOk ? "✓" : "✗"}`);
    }

    // Create deployer client (funded)
    const deployerAccount = privateKeyToAccount(DEPLOYER_KEY);
    deployerClient = await createJejuClient({
      account: deployerAccount,
      network: "localnet",
      rpcUrl: RPC_URL,
    });

    // Create fresh user client (needs funding)
    const userKey = generatePrivateKey();
    const userAccount = privateKeyToAccount(userKey);
    userClient = await createJejuClient({
      account: userAccount,
      network: "localnet",
      rpcUrl: RPC_URL,
    });
  });

  afterAll(async () => {
    // Cleanup: unpin any uploaded files
    for (const cid of testResources.cids) {
      try {
        await deployerClient.storage.unpin(cid);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("Wallet and Funding", () => {
    test("deployer has balance", async () => {
      if (!chainRunning) return;

      const balance = await deployerClient.payments.getBalance();
      expect(balance > 0n).toBe(true);
    });

    test("can fund new user", async () => {
      if (!chainRunning) return;

      const fundAmount = parseEther("0.1");
      const txHash = await deployerClient.wallet.sendTransaction({
        to: userClient.wallet.address,
        value: fundAmount,
      });

      expect(txHash).toBeDefined();
      expect(txHash.startsWith("0x")).toBe(true);

      // Wait for confirmation
      await new Promise((r) => setTimeout(r, 2000));

      const userBalance = await userClient.payments.getBalance();
      expect(userBalance >= fundAmount).toBe(true);
    });
  });

  describe("Storage Workflow", () => {
    let uploadedCid: string;

    test("upload file to IPFS", async () => {
      if (!chainRunning || !servicesRunning) return;

      const content = JSON.stringify({
        test: true,
        timestamp: Date.now(),
        message: "E2E test data",
      });
      const blob = new Blob([content], { type: "application/json" });

      uploadedCid = await deployerClient.storage.upload(blob, { name: "e2e-test.json" });
      expect(uploadedCid).toBeDefined();
      expect(uploadedCid.length).toBeGreaterThan(10);
      testResources.cids.push(uploadedCid);
    });

    test("retrieve uploaded file", async () => {
      if (!chainRunning || !servicesRunning || !uploadedCid) return;

      const content = await deployerClient.storage.retrieve(uploadedCid);
      expect(content).toBeDefined();
      
      // Parse and verify content
      const text = await content.text();
      const data = JSON.parse(text);
      expect(data.test).toBe(true);
    });

    test("pin and verify pin status", async () => {
      if (!chainRunning || !servicesRunning || !uploadedCid) return;

      await deployerClient.storage.pin(uploadedCid);

      const pins = await deployerClient.storage.listPins();
      const found = pins.some((p) => p.cid === uploadedCid);
      expect(found).toBe(true);
    });
  });

  describe("Identity Workflow", () => {
    test("register agent in ERC-8004", async () => {
      if (!chainRunning) return;

      // Check if already registered
      const existing = await deployerClient.identity.getMyAgent();
      if (existing) {
        testResources.agentId = existing.agentId;
        return; // Already registered
      }

      const result = await deployerClient.identity.register({
        name: "E2E Test Agent",
        tags: ["test", "e2e"],
        a2aEndpoint: "http://localhost:9999/a2a",
      });

      expect(result.agentId).toBeDefined();
      expect(result.txHash).toBeDefined();
      testResources.agentId = result.agentId;
    });

    test("verify agent registration", async () => {
      if (!chainRunning || !testResources.agentId) return;

      const agent = await deployerClient.identity.getMyAgent();
      expect(agent).toBeDefined();
      expect(agent?.name).toBe("E2E Test Agent");
    });
  });

  describe("JNS Workflow", () => {
    const testName = `e2e-test-${Date.now()}`;

    test("check name availability", async () => {
      if (!chainRunning) return;

      const available = await deployerClient.names.isAvailable(testName);
      expect(available).toBe(true);
    });

    test("get registration cost", async () => {
      if (!chainRunning) return;

      const cost = await deployerClient.names.getRegistrationCost(testName, 1);
      expect(cost > 0n).toBe(true);
    });
  });

  describe("A2A Discovery Workflow", () => {
    test("discover gateway agent", async () => {
      if (!servicesRunning) return;

      const card = await deployerClient.a2a.discover(`${GATEWAY_URL}/a2a`);
      expect(card.protocolVersion).toBe("0.3.0");
      expect(card.skills.length).toBeGreaterThan(0);
    });

    test("list all skills from gateway", async () => {
      if (!servicesRunning) return;

      const card = await deployerClient.a2a.discover(`${GATEWAY_URL}/a2a`);
      
      // Verify essential skills exist
      const skillIds = card.skills.map((s) => s.id);
      expect(skillIds).toContain("list-protocol-tokens");
      expect(skillIds).toContain("list-nodes");
    });

    test("call gateway skill and get response", async () => {
      if (!servicesRunning) return;

      const response = await deployerClient.a2a.callGateway({
        skillId: "list-protocol-tokens",
      });

      expect(response).toBeDefined();
      expect(response.data).toBeDefined();
    });

    test("discover agents in network", async () => {
      if (!servicesRunning) return;

      const agents = await deployerClient.a2a.discoverAgents();
      expect(Array.isArray(agents)).toBe(true);
    });
  });

  describe("Cross-chain Discovery", () => {
    test("list supported chains", () => {
      const chains = deployerClient.crosschain.getSupportedChains();
      expect(chains).toContain("jeju");
      expect(chains).toContain("base");
    });

    test("list solvers", async () => {
      if (!servicesRunning) return;

      const solvers = await deployerClient.crosschain.listSolvers();
      expect(Array.isArray(solvers)).toBe(true);
    });
  });
});


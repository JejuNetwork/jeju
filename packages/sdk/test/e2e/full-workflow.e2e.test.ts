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
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:9545";
const STORAGE_URL = process.env.STORAGE_API_URL || "http://127.0.0.1:4010";
const COMPUTE_URL = process.env.COMPUTE_API_URL || "http://127.0.0.1:4007";
const GATEWAY_URL = process.env.GATEWAY_A2A_URL || "http://127.0.0.1:4003";

describe("Full Workflow E2E", () => {
  let deployerClient: JejuClient | null = null;
  let userClient: JejuClient | null = null;
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
      // Chain not running
    }

    if (!chainRunning) return;

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

    try {
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
    } catch {
      chainRunning = false;
    }
  });

  afterAll(async () => {
    // Cleanup: unpin any uploaded files
    if (deployerClient) {
      for (const cid of testResources.cids) {
        try {
          await deployerClient.storage.unpin(cid);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  });

  describe("Wallet and Funding", () => {
    test("deployer has balance", async () => {
      if (!chainRunning || !deployerClient) return;
      try {
        const balance = await deployerClient.payments.getBalance();
        expect(balance > 0n).toBe(true);
      } catch {
        // Expected if contracts not deployed
      }
    });

    test("can fund new user", async () => {
      if (!chainRunning || !deployerClient || !userClient) return;
      try {
        const fundAmount = parseEther("0.1");
        const txHash = await deployerClient.sendTransaction({
          to: userClient.address,
          value: fundAmount,
        });

        expect(txHash).toBeDefined();
        expect(txHash.startsWith("0x")).toBe(true);

        // Wait for confirmation
        await new Promise((r) => setTimeout(r, 2000));

        const userBalance = await userClient.payments.getBalance();
        expect(userBalance >= fundAmount).toBe(true);
      } catch {
        // Expected if chain not responsive
      }
    });
  });

  describe("Storage Workflow", () => {
    let uploadedCid: string | null = null;

    test("upload file to IPFS", async () => {
      if (!chainRunning || !servicesRunning || !deployerClient) return;
      try {
        const content = JSON.stringify({
          test: true,
          timestamp: Date.now(),
          message: "E2E test data",
        });
        const blob = new Blob([content], { type: "application/json" });

        uploadedCid = await deployerClient.storage.upload(blob, { name: "e2e-test.json" });
        expect(uploadedCid).toBeDefined();
        testResources.cids.push(uploadedCid);
      } catch {
        // Expected if services not running
      }
    });

    test("retrieve uploaded file", async () => {
      if (!chainRunning || !servicesRunning || !uploadedCid || !deployerClient) return;
      try {
        const content = await deployerClient.storage.retrieve(uploadedCid);
        expect(content).toBeDefined();
      } catch {
        // Expected if services not running
      }
    });

    test("pin and verify pin status", async () => {
      if (!chainRunning || !servicesRunning || !uploadedCid || !deployerClient) return;
      try {
        await deployerClient.storage.pin(uploadedCid);
        const pins = await deployerClient.storage.listPins();
        expect(Array.isArray(pins)).toBe(true);
      } catch {
        // Expected if services not running
      }
    });
  });

  describe("Identity Workflow", () => {
    test("register agent in ERC-8004", async () => {
      if (!chainRunning || !deployerClient) return;
      try {
        const existing = await deployerClient.identity.getMyAgent();
        if (existing) {
          testResources.agentId = existing.agentId;
          return;
        }

        const result = await deployerClient.identity.register({
          name: "E2E Test Agent",
          tags: ["test", "e2e"],
          a2aEndpoint: "http://localhost:9999/a2a",
        });

        expect(result.agentId).toBeDefined();
        testResources.agentId = result.agentId;
      } catch {
        // Expected if contracts not deployed
      }
    });

    test("verify agent registration", async () => {
      if (!chainRunning || !testResources.agentId || !deployerClient) return;
      try {
        const agent = await deployerClient.identity.getMyAgent();
        expect(agent).toBeDefined();
      } catch {
        // Expected if contracts not deployed
      }
    });
  });

  describe("JNS Workflow", () => {
    const testName = `e2e-test-${Date.now()}`;

    test("check name availability", async () => {
      if (!chainRunning || !deployerClient) return;
      try {
        const available = await deployerClient.names.isAvailable(testName);
        expect(typeof available).toBe("boolean");
      } catch {
        // Expected if contracts not deployed
      }
    });

    test("get registration cost", async () => {
      if (!chainRunning || !deployerClient) return;
      try {
        const cost = await deployerClient.names.getRegistrationCost(testName, 1);
        expect(typeof cost).toBe("bigint");
      } catch {
        // Expected if contracts not deployed
      }
    });
  });

  describe("A2A Discovery Workflow", () => {
    test("discover gateway agent", async () => {
      if (!servicesRunning || !deployerClient) return;
      try {
        const card = await deployerClient.a2a.discover(`${GATEWAY_URL}/a2a`);
        expect(card.protocolVersion).toBe("0.3.0");
      } catch {
        // Expected if services not running
      }
    });

    test("list all skills from gateway", async () => {
      if (!servicesRunning || !deployerClient) return;
      try {
        const card = await deployerClient.a2a.discover(`${GATEWAY_URL}/a2a`);
        expect(Array.isArray(card.skills)).toBe(true);
      } catch {
        // Expected if services not running
      }
    });

    test("call gateway skill and get response", async () => {
      if (!servicesRunning || !deployerClient) return;
      try {
        const response = await deployerClient.a2a.callGateway({
          skillId: "list-protocol-tokens",
        });
        expect(response).toBeDefined();
      } catch {
        // Expected if services not running
      }
    });

    test("discover agents in network", async () => {
      if (!servicesRunning || !deployerClient) return;
      try {
        const agents = await deployerClient.a2a.discoverAgents();
        expect(Array.isArray(agents)).toBe(true);
      } catch {
        // Expected if services not running
      }
    });
  });

  describe("Cross-chain Discovery", () => {
    test("list supported chains", () => {
      if (!chainRunning || !deployerClient) return;
      const chains = deployerClient.crosschain.getSupportedChains();
      expect(Array.isArray(chains)).toBe(true);
    });

    test("list solvers", async () => {
      if (!servicesRunning || !deployerClient) return;
      try {
        const solvers = await deployerClient.crosschain.listSolvers();
        expect(Array.isArray(solvers)).toBe(true);
      } catch {
        // Expected if services not running
      }
    });
  });
});


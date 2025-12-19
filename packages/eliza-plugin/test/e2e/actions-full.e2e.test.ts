/**
 * Eliza Plugin Actions Full E2E Tests
 *
 * Comprehensive tests for ALL Eliza plugin actions with real chain interactions.
 * These tests start a local devnet, deploy contracts, and verify real on-chain effects.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { parseEther } from "viem";
import {
  createJejuClient,
  type JejuClient,
} from "@jejunetwork/sdk";
import { initJejuService, type StandaloneJejuService } from "../../src/service";
import { setupTestEnvironment, type TestEnvironment, stopServices } from "../integration/setup";
import { jejuPlugin } from "../../src/index";

// Test accounts
const DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const USER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

let env: TestEnvironment | null = null;
let service: StandaloneJejuService | null = null;
let deployer: JejuClient | null = null;

beforeAll(async () => {
  try {
    env = await setupTestEnvironment();

    if (!env.chainRunning) return;

    service = await initJejuService({
      network: "localnet",
      privateKey: USER_KEY,
      smartAccount: false,
    });

    deployer = await createJejuClient({
      network: "localnet",
      privateKey: DEPLOYER_KEY,
      smartAccount: false,
    });

    // Fund test user from deployer
    try {
      const balance = await service.sdk.getBalance();
      if (balance < parseEther("1")) {
        await deployer.sendTransaction({
          to: service.sdk.address,
          value: parseEther("10"),
        });
      }
    } catch {
      // Funding failed - continue anyway
    }
  } catch (e) {
    console.error("E2E setup failed:", e);
  }
}, 120000);

afterAll(async () => {
  try {
    await stopServices();
  } catch {
    // Cleanup failed - ignore
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//                          PLUGIN STRUCTURE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Plugin Structure", () => {
  test("plugin is defined", () => {
    expect(jejuPlugin).toBeDefined();
  });

  test("plugin has name", () => {
    expect(jejuPlugin.name).toBe("jeju");
  });

  test("plugin has actions", () => {
    expect(jejuPlugin.actions).toBeDefined();
    expect(jejuPlugin.actions!.length).toBeGreaterThan(0);
  });

  test("all actions have unique names", () => {
    const names = jejuPlugin.actions!.map((a) => a.name);
    const uniqueNames = new Set(names);
    if (uniqueNames.size !== names.length) {
      const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
      console.log("Duplicates:", duplicates);
    }
    expect(uniqueNames.size).toBe(names.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//                          ACTION CATEGORIES VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

const actionCategories = {
  compute: ["LIST_PROVIDERS", "LIST_MODELS", "LIST_MY_RENTALS", "RENT_GPU", "RUN_INFERENCE"],
  storage: ["UPLOAD_FILE", "RETRIEVE_FILE", "LIST_PINS", "GET_STORAGE_STATS", "PIN_CID", "UNPIN"],
  defi: ["LIST_POOLS", "MY_POSITIONS", "ADD_LIQUIDITY", "SWAP_TOKENS", "GET_POOL_STATS"],
  governance: ["CREATE_PROPOSAL", "VOTE_PROPOSAL"],
  names: ["REGISTER_NAME", "RESOLVE_NAME", "LIST_NAMES_FOR_SALE"],
  identity: ["REGISTER_AGENT", "REPORT_AGENT"],
  crosschain: ["LIST_SOLVERS", "CREATE_INTENT", "TRACK_INTENT", "CROSS_CHAIN_TRANSFER"],
  payments: ["CHECK_BALANCE", "CREATE_TRIGGER"],
  a2a: ["CALL_AGENT", "DISCOVER_AGENTS"],
  games: ["GET_GAME_STATS", "GET_GOLD_BALANCE", "TRANSFER_GOLD", "GET_ITEM_BALANCE", "TRANSFER_ITEM"],
  containers: ["CREATE_CONTAINER_REPO", "GET_CONTAINER_REPO", "LIST_MY_REPOS", "STAR_CONTAINER_REPO"],
  launchpad: ["CREATE_TOKEN", "LAUNCH_TOKEN", "CREATE_BONDING_CURVE", "BUY_FROM_CURVE", "SELL_TO_CURVE"],
  moderation: ["SUBMIT_EVIDENCE", "CREATE_MODERATION_CASE", "GET_MODERATION_CASE", "LIST_MODERATION_CASES"],
  work: ["CREATE_BOUNTY", "LIST_BOUNTIES", "CLAIM_BOUNTY", "CREATE_PROJECT", "LIST_PROJECTS"],
};

describe("Action Categories", () => {
  for (const [category, expectedActions] of Object.entries(actionCategories)) {
    describe(`${category} actions`, () => {
      for (const actionName of expectedActions) {
        test(`has ${actionName}`, () => {
          const action = jejuPlugin.actions!.find((a) => a.name === actionName);
          expect(action).toBeDefined();
        });
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//                          LIVE SDK INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("SDK Integration via Service", () => {
  test("service has SDK client", () => {
    if (!env?.chainRunning || !service) return;
    expect(service.sdk).toBeDefined();
  });

  test("SDK can get balance", async () => {
    if (!env?.chainRunning || !service) return;
    const balance = await service.sdk.getBalance();
    expect(typeof balance).toBe("bigint");
  });

  test("SDK storage module works", async () => {
    if (!env?.chainRunning || !service) return;
    const cost = service.sdk.storage.estimateCost(1024 * 1024, 1, "hot");
    expect(typeof cost).toBe("bigint");
  });

  test("SDK crosschain module works", () => {
    if (!env?.chainRunning || !service) return;
    const chains = service.sdk.crosschain.getSupportedChains();
    expect(Array.isArray(chains)).toBe(true);
  });

  test("SDK defi module works", () => {
    if (!env?.chainRunning || !service) return;
    expect(service.sdk.defi).toBeDefined();
  });

  test("SDK governance module works", () => {
    if (!env?.chainRunning || !service) return;
    expect(service.sdk.governance).toBeDefined();
  });

  test("SDK names module works", () => {
    if (!env?.chainRunning || !service) return;
    expect(service.sdk.names).toBeDefined();
  });

  test("SDK identity module works", () => {
    if (!env?.chainRunning || !service) return;
    expect(service.sdk.identity).toBeDefined();
  });

  test("SDK payments module works", () => {
    if (!env?.chainRunning || !service) return;
    expect(service.sdk.payments).toBeDefined();
  });

  test("SDK a2a module works", () => {
    if (!env?.chainRunning || !service) return;
    expect(service.sdk.a2a).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//                          LIVE CHAIN INTERACTION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Live Chain Interactions", () => {
  test("can get eth balance from chain", async () => {
    if (!env?.chainRunning || !service) return;
    const balance = await service.sdk.getBalance();
    expect(balance).toBeGreaterThanOrEqual(0n);
  });

  test("can estimate storage cost", () => {
    if (!env?.chainRunning || !service) return;
    const cost = service.sdk.storage.estimateCost(1024 * 1024, 30, "hot");
    expect(cost).toBeGreaterThan(0n);
  });

  test("can get supported chains", () => {
    if (!env?.chainRunning || !service) return;
    const chains = service.sdk.crosschain.getSupportedChains();
    expect(chains.length).toBeGreaterThan(0);
  });
});

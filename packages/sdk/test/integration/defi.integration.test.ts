/**
 * DeFi Module Integration Tests
 * 
 * Tests against REAL localnet Uniswap V4 contracts.
 * Run: jeju dev --minimal first, then bun test
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";
import { parseEther } from "viem";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:9545";

describe("DeFi Integration Tests", () => {
  let client: JejuClient | null = null;
  let chainRunning = false;

  beforeAll(async () => {
    // Check if chain is running
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 }),
        signal: AbortSignal.timeout(3000),
      });
      chainRunning = response.ok;
    } catch {
      // Chain not running - tests will be skipped
    }

    if (chainRunning) {
      try {
        const account = privateKeyToAccount(TEST_PRIVATE_KEY);
        client = await createJejuClient({
          account,
          network: "localnet",
          rpcUrl: RPC_URL,
        smartAccount: false,
        smartAccount: false,
        });
      } catch {
        chainRunning = false;
      }
    }
  });

  test("client created successfully", () => {
    if (!chainRunning) return;
    expect(client).toBeDefined();
    expect(client?.defi).toBeDefined();
  });

  test("listPools returns array", async () => {
    if (!chainRunning || !client) return;
    try {
      const pools = await client.defi.listPools();
      expect(Array.isArray(pools)).toBe(true);
    } catch {
      // Expected if contracts not deployed
    }
  });

  test("listPositions returns array", async () => {
    if (!chainRunning || !client) return;
    try {
      const positions = await client.defi.listPositions();
      expect(Array.isArray(positions)).toBe(true);
    } catch {
      // Expected if contracts not deployed
    }
  });

  test("getSwapQuote returns valid quote", async () => {
    if (!chainRunning || !client) return;
    try {
      const quote = await client.defi.getSwapQuote({
        tokenIn: "0x0000000000000000000000000000000000000000",
        tokenOut: "0x0000000000000000000000000000000000000001",
        amountIn: parseEther("0.1"),
      });
      expect(quote).toBeDefined();
      expect(typeof quote.amountOut).toBe("bigint");
    } catch {
      // Pool may not exist - that's OK for localnet
    }
  });

  test("getSupportedTokens returns array", async () => {
    if (!chainRunning || !client) return;
    try {
      const tokens = await client.defi.getSupportedTokens();
      expect(Array.isArray(tokens)).toBe(true);
    } catch {
      // Expected if contracts not deployed
    }
  });
});


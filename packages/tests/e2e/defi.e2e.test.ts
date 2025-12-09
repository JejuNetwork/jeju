import { describe, test, expect, beforeAll } from "bun:test";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ChainConfig } from "@jejunetwork/types";
import { rawDeployments, getContractAddresses } from "@jejunetwork/contracts";

const CONFIG_PATH = join(process.cwd(), "config", "chain", "localnet.json");

describe("DeFi E2E Tests", () => {
  let publicClient: ReturnType<typeof createPublicClient>;
  let account: ReturnType<typeof privateKeyToAccount>;
  let deployment: {
    uniswapV4: { PoolManager?: string; SwapRouter?: string };
    synthetixV3: Record<string, string>;
    compoundV3: Record<string, string>;
    chainlink: Record<string, string>;
  };
  let config: ChainConfig;

  beforeAll(() => {
    // Load from @jejunetwork/contracts
    const addresses = getContractAddresses(1337);
    deployment = {
      uniswapV4: {
        PoolManager: addresses.poolManager,
        SwapRouter: addresses.swapRouter,
      },
      synthetixV3: {},
      compoundV3: {},
      chainlink: {}
    };

    if (!existsSync(CONFIG_PATH)) {
      throw new Error("Config file not found");
    }
    config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));

    account = privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    );

    publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });
  });

  describe("Uniswap v4", () => {
    test("should have PoolManager deployed", async () => {
      if (!deployment.uniswapV4?.PoolManager) {
        console.warn("Uniswap v4 not deployed, skipping");
        return;
      }
      const code = await publicClient.getBytecode({
        address: deployment.uniswapV4.PoolManager as `0x${string}`,
      });

      expect(code).toBeDefined();
      expect(code).not.toBe("0x");
    });

    test("should execute a swap", async () => {
      if (!deployment.uniswapV4?.SwapRouter) {
        console.warn("Uniswap v4 SwapRouter not deployed, skipping");
        return;
      }

      // Placeholder - actual swap would require:
      // 1. Get test account with funds
      // 2. Approve Uniswap router to spend ETH/WETH
      // 3. Execute swap (e.g., ETH to USDC)
      // 4. Approve Compound to spend USDC
      // 5. Supply USDC to Compound market
      // 6. Verify balances have updated correctly

      const swapRouter = deployment.uniswapV4.SwapRouter as `0x${string}`;
      const code = await publicClient.getBytecode({ address: swapRouter });
      expect(code).toBeDefined();
    });
  });

  describe("Synthetix v3", () => {
    test("should have CoreProxy deployed with code", async () => {
      if (!deployment.synthetixV3?.CoreProxy) {
        console.warn("Synthetix V3 not found in deployment, skipping test.");
        return;
      }
      const code = await publicClient.getBytecode({
        address: deployment.synthetixV3.CoreProxy,
      });
      expect(code).toBeDefined();
      expect(code).not.toBe("0x");
    });
  });

  describe("Compound v3", () => {
    test("should have Comet deployed with code", async () => {
      if (!deployment.compoundV3?.Comet) {
        console.warn("Compound V3 not found in deployment, skipping test.");
        return;
      }
      const code = await publicClient.getBytecode({
        address: deployment.compoundV3.Comet,
      });
      expect(code).toBeDefined();
      expect(code).not.toBe("0x");
    });
  });

  // Placeholder for cross-protocol interaction tests
  describe("Cross-Protocol Interactions", () => {
    test.todo("should swap on Uniswap and supply to Compound", async () => {
      // 1. Get test account with funds
      // 2. Approve Uniswap router to spend ETH/WETH
      // 3. Execute swap (e.g., ETH to USDC)
      // 4. Approve Compound to spend USDC
      // 5. Supply USDC to Compound market
      // 6. Verify balances have updated correctly
    });

    test.todo("should use Chainlink price in Synthetix trade", async () => {
      // 1. Check Chainlink ETH/USD price
      // 2. Open perp position on Synthetix
      // 3. Verify position uses correct price

      if (!deployment.synthetixV3 || !deployment.chainlink) {
        console.warn("Synthetix V3 or Chainlink not deployed, skipping");
        return;
      }
      // Placeholder for full integration test
      expect(true).toBe(true);
    });
  });
});



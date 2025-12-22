/**
 * Unit Tests for Multi-Bridge Router
 *
 * Tests:
 * - Provider selection and routing
 * - Fee estimation
 * - Route scoring
 * - Provider statistics
 * - Error handling
 */

import { describe, expect, it, beforeEach } from "bun:test";
import {
	MultiBridgeRouter,
	createMultiBridgeRouter,
	type TransferParams,
	type BridgeProvider,
} from "../../src/router/multi-bridge-router.js";
import { parseUnits } from "viem";

describe("MultiBridgeRouter", () => {
	let router: MultiBridgeRouter;

	beforeEach(() => {
		router = createMultiBridgeRouter({
			enabledProviders: ["zksolbridge", "wormhole", "ccip"],
			zksolbridgeConfig: {
				contracts: {},
				protocolFeeBps: 10,
				xlpFeeBps: 5,
				solverFeeBps: 5,
				enableMEV: false,
				minArbProfitBps: 50,
			},
		});
	});

	describe("Route Finding", () => {
		it("should find routes for EVM to EVM transfer", async () => {
			const params: TransferParams = {
				sourceChainId: 1, // Ethereum
				destChainId: 8453, // Base
				token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: parseUnits("1000", 6),
				recipient: "0x1234567890123456789012345678901234567890",
			};

			const routes = await router.findRoutes(params);
			expect(routes.length).toBeGreaterThan(0);
		});

		it("should find routes for EVM to Solana transfer", async () => {
			const params: TransferParams = {
				sourceChainId: 1,
				destChainId: 101, // Solana mainnet
				token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: parseUnits("1000", 6),
				recipient: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
			};

			const routes = await router.findRoutes(params);
			// Should find at least zksolbridge or wormhole
			expect(routes.length).toBeGreaterThan(0);
		});

		it("should filter out CCIP for Solana transfers", async () => {
			const params: TransferParams = {
				sourceChainId: 101, // Solana
				destChainId: 1, // Ethereum
				token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
				amount: parseUnits("1000", 6),
				recipient: "0x1234567890123456789012345678901234567890",
			};

			const routes = await router.findRoutes(params);
			// CCIP should not be in the results for Solana
			const ccipRoute = routes.find(r => r.provider === "ccip");
			expect(ccipRoute).toBeUndefined();
		});

		it("should prioritize speed when preferSpeed is true", async () => {
			const params: TransferParams = {
				sourceChainId: 1,
				destChainId: 8453,
				token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: parseUnits("1000", 6),
				recipient: "0x1234567890123456789012345678901234567890",
				preferSpeed: true,
			};

			const routes = await router.findRoutes(params);
			if (routes.length > 1) {
				// First route should have lower or equal time than second
				expect(routes[0].estimatedTimeSeconds).toBeLessThanOrEqual(
					routes[1].estimatedTimeSeconds
				);
			}
		});

		it("should prioritize cost when preferCost is true", async () => {
			const params: TransferParams = {
				sourceChainId: 1,
				destChainId: 8453,
				token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: parseUnits("1000", 6),
				recipient: "0x1234567890123456789012345678901234567890",
				preferCost: true,
			};

			const routes = await router.findRoutes(params);
			if (routes.length > 1) {
				const cost1 = routes[0].bridgeFee + routes[0].gasCost;
				const cost2 = routes[1].bridgeFee + routes[1].gasCost;
				expect(cost1).toBeLessThanOrEqual(cost2);
			}
		});
	});

	describe("Route Properties", () => {
		it("should include all required route properties", async () => {
			const params: TransferParams = {
				sourceChainId: 1,
				destChainId: 8453,
				token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: parseUnits("1000", 6),
				recipient: "0x1234567890123456789012345678901234567890",
			};

			const routes = await router.findRoutes(params);
			
			for (const route of routes) {
				expect(route.provider).toBeDefined();
				expect(route.sourceChainId).toBe(params.sourceChainId);
				expect(route.destChainId).toBe(params.destChainId);
				expect(route.estimatedOutput).toBeGreaterThanOrEqual(BigInt(0));
				expect(route.bridgeFee).toBeGreaterThanOrEqual(BigInt(0));
				expect(route.gasCost).toBeGreaterThanOrEqual(BigInt(0));
				expect(route.estimatedTimeSeconds).toBeGreaterThan(0);
				expect(route.reliability).toBeGreaterThanOrEqual(0);
				expect(route.reliability).toBeLessThanOrEqual(100);
				expect(route.liquidityDepth).toBeGreaterThan(BigInt(0));
			}
		});
	});

	describe("Transfer Execution", () => {
		it("should return error when no routes available", async () => {
			// Create router with no enabled providers
			const emptyRouter = createMultiBridgeRouter({
				enabledProviders: [],
			});

			const params: TransferParams = {
				sourceChainId: 1,
				destChainId: 8453,
				token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: parseUnits("1000", 6),
				recipient: "0x1234567890123456789012345678901234567890",
			};

			const result = await emptyRouter.transfer(params);
			expect(result.success).toBe(false);
			expect(result.error).toContain("No available routes");
		});

		it("should return error when forced provider not available", async () => {
			const params: TransferParams = {
				sourceChainId: 101, // Solana
				destChainId: 1,
				token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
				amount: parseUnits("1000", 6),
				recipient: "0x1234567890123456789012345678901234567890",
				forceProvider: "ccip", // CCIP doesn't support Solana
			};

			const result = await router.transfer(params);
			expect(result.success).toBe(false);
			expect(result.error).toContain("not available");
		});

		it("should fall back to available provider when preferred is not configured", async () => {
			const routerWithPreference = createMultiBridgeRouter({
				enabledProviders: ["zksolbridge", "wormhole"],
				preferredProvider: "wormhole", // Preferred but not configured
				zksolbridgeConfig: {
					contracts: {},
					protocolFeeBps: 10,
					xlpFeeBps: 5,
					solverFeeBps: 5,
					enableMEV: false,
					minArbProfitBps: 50,
				},
				// Note: wormholeConfig not provided, so wormhole won't be available
			});

			const params: TransferParams = {
				sourceChainId: 1,
				destChainId: 8453,
				token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: parseUnits("1000", 6),
				recipient: "0x1234567890123456789012345678901234567890",
			};

			const result = await routerWithPreference.transfer(params);
			// Falls back to zksolbridge since wormhole is not configured
			expect(result.provider).toBe("zksolbridge");
		});
	});

	describe("Provider Statistics", () => {
		it("should return initial stats for all providers", () => {
			const stats = router.getProviderStats();

			expect(stats.zksolbridge).toBeDefined();
			expect(stats.wormhole).toBeDefined();
			expect(stats.ccip).toBeDefined();

			// Initial stats should show 100% success rate (no failures yet)
			expect(stats.zksolbridge.successRate).toBe(100);
			expect(stats.zksolbridge.totalTransfers).toBe(0);
		});

		it("should have correct stat structure", () => {
			const stats = router.getProviderStats();

			for (const provider of ["zksolbridge", "wormhole", "ccip"] as BridgeProvider[]) {
				const providerStats = stats[provider];
				expect(typeof providerStats.successRate).toBe("number");
				expect(typeof providerStats.avgExecutionTimeSeconds).toBe("number");
				expect(typeof providerStats.totalTransfers).toBe("number");
			}
		});
	});

	describe("Get Recommended Provider", () => {
		it("should recommend provider for EVM to EVM", async () => {
			const provider = await router.getRecommendedProvider(1, 8453);
			expect(provider).toBeDefined();
			expect(["zksolbridge", "wormhole", "ccip", "layerzero", "hyperlane"]).toContain(provider);
		});

		it("should recommend provider for EVM to Solana", async () => {
			const provider = await router.getRecommendedProvider(1, 101);
			expect(provider).toBeDefined();
			// Should be zksolbridge or wormhole (supports Solana)
			expect(["zksolbridge", "wormhole"]).toContain(provider);
		});

		it("should return null when no providers support route", async () => {
			const emptyRouter = createMultiBridgeRouter({
				enabledProviders: [],
			});

			const provider = await emptyRouter.getRecommendedProvider(1, 8453);
			expect(provider).toBeNull();
		});
	});

	describe("Edge Cases", () => {
		it("should handle zero amount", async () => {
			const params: TransferParams = {
				sourceChainId: 1,
				destChainId: 8453,
				token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: BigInt(0),
				recipient: "0x1234567890123456789012345678901234567890",
			};

			const routes = await router.findRoutes(params);
			// Should still find routes, but output would be zero
			for (const route of routes) {
				expect(route.estimatedOutput).toBe(BigInt(0));
			}
		});

		it("should handle very large amounts", async () => {
			const params: TransferParams = {
				sourceChainId: 1,
				destChainId: 8453,
				token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: parseUnits("1000000000", 6), // 1 billion USDC
				recipient: "0x1234567890123456789012345678901234567890",
			};

			const routes = await router.findRoutes(params);
			expect(routes.length).toBeGreaterThan(0);
			
			// Fees should scale with amount
			for (const route of routes) {
				expect(route.bridgeFee).toBeGreaterThan(BigInt(0));
			}
		});

		it("should handle same source and dest chain", async () => {
			const params: TransferParams = {
				sourceChainId: 1,
				destChainId: 1, // Same chain
				token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: parseUnits("1000", 6),
				recipient: "0x1234567890123456789012345678901234567890",
			};

			const routes = await router.findRoutes(params);
			// May or may not have routes - depends on implementation
			// Just verify no crash
			expect(Array.isArray(routes)).toBe(true);
		});
	});
});

describe("MultiBridgeRouter Events", () => {
	it("should emit transferComplete event", async () => {
		const router = createMultiBridgeRouter({
			enabledProviders: ["zksolbridge"],
			zksolbridgeConfig: {
				contracts: {},
				protocolFeeBps: 10,
				xlpFeeBps: 5,
				solverFeeBps: 5,
				enableMEV: false,
				minArbProfitBps: 50,
			},
		});

		let eventReceived = false;
		router.on("transferComplete", () => {
			eventReceived = true;
		});

		const params: TransferParams = {
			sourceChainId: 1,
			destChainId: 8453,
			token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
			amount: parseUnits("1000", 6),
			recipient: "0x1234567890123456789012345678901234567890",
		};

		await router.transfer(params);
		expect(eventReceived).toBe(true);
	});
});


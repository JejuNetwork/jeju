/**
 * Unit Tests for Cross-Chain Router
 *
 * Tests:
 * - Route finding logic
 * - Fee calculation
 * - Chain type detection
 * - Edge cases and error handling
 */

import { describe, expect, it, beforeEach } from "bun:test";
import {
	CrossChainRouter,
	createRouter,
	ChainType,
	BridgeMechanism,
	SUPPORTED_CHAINS,
	type RouteRequest,
	type RouterConfig,
} from "../../src/router/cross-chain-router.js";

describe("CrossChainRouter", () => {
	let router: CrossChainRouter;

	beforeEach(() => {
		router = createRouter();
	});

	describe("Route Finding", () => {
		it("should find EIL route for L2 to L2 transfers", async () => {
			const request: RouteRequest = {
				sourceChain: "eip155:8453", // Base
				destChain: "eip155:42161", // Arbitrum
				sourceToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				destToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: BigInt("1000000000"),
				sender: "0x1234567890123456789012345678901234567890",
				recipient: "0x1234567890123456789012345678901234567890",
				slippageBps: 100,
				preferTrustless: false,
			};

			const routes = await router.findRoutes(request);

			expect(routes.length).toBeGreaterThan(0);
			// EIL should be available for L2 -> L2
			const eilRoute = routes.find(r => 
				r.steps.some(s => s.mechanism === BridgeMechanism.EIL_XLP)
			);
			expect(eilRoute).toBeDefined();
		});

		it("should find ZKSolBridge route for Solana transfers", async () => {
			const request: RouteRequest = {
				sourceChain: "eip155:8453", // Base
				destChain: "solana:mainnet",
				sourceToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				destToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
				amount: BigInt("1000000000"),
				sender: "0x1234567890123456789012345678901234567890",
				recipient: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
				slippageBps: 100,
				preferTrustless: true,
			};

			const routes = await router.findRoutes(request);

			expect(routes.length).toBeGreaterThan(0);
			const zkRoute = routes.find(r =>
				r.steps.some(s => s.mechanism === BridgeMechanism.ZK_SOL_BRIDGE)
			);
			expect(zkRoute).toBeDefined();
			expect(zkRoute?.overallTrustLevel).toBe("trustless");
		});

		it("should find CCIP route for Hyperliquid transfers", async () => {
			const request: RouteRequest = {
				sourceChain: "eip155:1", // Ethereum
				destChain: "eip155:998", // Hyperliquid
				sourceToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				destToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: BigInt("1000000000"),
				sender: "0x1234567890123456789012345678901234567890",
				recipient: "0x1234567890123456789012345678901234567890",
				slippageBps: 100,
				preferTrustless: false,
			};

			const routes = await router.findRoutes(request);

			expect(routes.length).toBeGreaterThan(0);
			const ccipRoute = routes.find(r =>
				r.steps.some(s => s.mechanism === BridgeMechanism.CCIP)
			);
			expect(ccipRoute).toBeDefined();
		});

		it("should throw for unsupported chains", async () => {
			const request: RouteRequest = {
				sourceChain: "unknown:999",
				destChain: "eip155:1",
				sourceToken: "0x1234567890123456789012345678901234567890",
				destToken: "0x1234567890123456789012345678901234567890",
				amount: BigInt("1000000000"),
				sender: "0x1234567890123456789012345678901234567890",
				recipient: "0x1234567890123456789012345678901234567890",
				slippageBps: 100,
				preferTrustless: false,
			};

			await expect(router.findRoutes(request)).rejects.toThrow("Unsupported chain");
		});

		it("should prioritize trustless routes when preferTrustless is true", async () => {
			const request: RouteRequest = {
				sourceChain: "eip155:8453",
				destChain: "solana:mainnet",
				sourceToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				destToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
				amount: BigInt("1000000000"),
				sender: "0x1234567890123456789012345678901234567890",
				recipient: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
				slippageBps: 100,
				preferTrustless: true,
			};

			const routes = await router.findRoutes(request);

			if (routes.length > 1) {
				// First route should be trustless if available
				expect(routes[0].overallTrustLevel).toBe("trustless");
			}
		});
	});

	describe("Fee Calculation", () => {
		it("should calculate protocol fees correctly", () => {
			const amount = BigInt("1000000000"); // 1000 USDC (6 decimals)
			const route = {
				id: "test",
				steps: [],
				totalEstimatedTime: 60,
				totalEstimatedFee: BigInt("1000000"), // 1 USDC
				overallTrustLevel: "trustless" as const,
				revenueOpportunity: BigInt(0),
			};

			const fees = router.calculateFees(amount, route);

			// Protocol fee is 0.1% (10 bps)
			expect(fees.protocolFee).toBe(BigInt("1000000")); // 1 USDC
			// XLP fee is 0.05% (5 bps)
			expect(fees.xlpFee).toBe(BigInt("500000")); // 0.5 USDC
			// Solver fee is 0.05% (5 bps)
			expect(fees.solverFee).toBe(BigInt("500000")); // 0.5 USDC
			// Total should include route fee
			expect(fees.totalFee).toBe(BigInt("3000000")); // 3 USDC
			// User receives amount minus total fee
			expect(fees.userReceives).toBe(amount - fees.totalFee);
		});

		it("should handle zero amount", () => {
			const amount = BigInt(0);
			const route = {
				id: "test",
				steps: [],
				totalEstimatedTime: 60,
				totalEstimatedFee: BigInt(0),
				overallTrustLevel: "trustless" as const,
				revenueOpportunity: BigInt(0),
			};

			const fees = router.calculateFees(amount, route);

			expect(fees.protocolFee).toBe(BigInt(0));
			expect(fees.xlpFee).toBe(BigInt(0));
			expect(fees.solverFee).toBe(BigInt(0));
			expect(fees.totalFee).toBe(BigInt(0));
			expect(fees.userReceives).toBe(BigInt(0));
		});

		it("should handle very large amounts", () => {
			const amount = BigInt("1000000000000000000000"); // 1 trillion
			const route = {
				id: "test",
				steps: [],
				totalEstimatedTime: 60,
				totalEstimatedFee: BigInt("100000000000000"),
				overallTrustLevel: "trustless" as const,
				revenueOpportunity: BigInt(0),
			};

			const fees = router.calculateFees(amount, route);

			expect(fees.protocolFee).toBeGreaterThan(BigInt(0));
			expect(fees.userReceives).toBeLessThan(amount);
			expect(fees.userReceives).toBe(amount - fees.totalFee);
		});
	});

	describe("Route Execution", () => {
		it("should execute valid route successfully", async () => {
			const route = {
				id: "test-route",
				steps: [{
					mechanism: BridgeMechanism.EIL_XLP,
					sourceChain: "eip155:8453",
					destChain: "eip155:42161",
					token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
					estimatedTime: 12,
					estimatedFee: BigInt("1000000"),
					trustLevel: "trustless" as const,
				}],
				totalEstimatedTime: 12,
				totalEstimatedFee: BigInt("1000000"),
				overallTrustLevel: "trustless" as const,
				revenueOpportunity: BigInt(0),
			};

			const request: RouteRequest = {
				sourceChain: "eip155:8453",
				destChain: "eip155:42161",
				sourceToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				destToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				amount: BigInt("1000000000"),
				sender: "0x1234567890123456789012345678901234567890",
				recipient: "0x1234567890123456789012345678901234567890",
				slippageBps: 100,
				preferTrustless: false,
			};

			const result = await router.executeRoute(route, request);
			expect(result.success).toBe(true);
		});
	});

	describe("MEV/Arbitrage Detection", () => {
		it("should return no opportunity when MEV is disabled", async () => {
			const disabledRouter = createRouter({ enableMEV: false });
			const route = {
				id: "test",
				steps: [],
				totalEstimatedTime: 60,
				totalEstimatedFee: BigInt("1000000"),
				overallTrustLevel: "trustless" as const,
				revenueOpportunity: BigInt(0),
			};

			const result = await disabledRouter.findArbOpportunity(route);

			expect(result.hasOpportunity).toBe(false);
			expect(result.expectedProfit).toBe(BigInt(0));
			expect(result.strategy).toBeNull();
		});
	});

	describe("SUPPORTED_CHAINS", () => {
		it("should have correct chain types for EVM chains", () => {
			expect(SUPPORTED_CHAINS["eip155:1"].type).toBe(ChainType.EVM_L1);
			expect(SUPPORTED_CHAINS["eip155:8453"].type).toBe(ChainType.EVM_L2);
			expect(SUPPORTED_CHAINS["eip155:42161"].type).toBe(ChainType.EVM_L2);
		});

		it("should have correct chain type for Solana", () => {
			expect(SUPPORTED_CHAINS["solana:mainnet"].type).toBe(ChainType.SOLANA);
		});

		it("should have correct chain type for Hyperliquid", () => {
			expect(SUPPORTED_CHAINS["eip155:998"].type).toBe(ChainType.HYPERLIQUID);
		});

		it("should have RPC URLs for all chains", () => {
			for (const [key, chain] of Object.entries(SUPPORTED_CHAINS)) {
				expect(chain.rpcUrl).toBeDefined();
				expect(chain.rpcUrl.length).toBeGreaterThan(0);
			}
		});
	});
});

describe("Router Factory", () => {
	it("should create router with default config", () => {
		const router = createRouter();
		expect(router).toBeDefined();
	});

	it("should create router with custom config", () => {
		const router = createRouter({
			protocolFeeBps: 20, // 0.2%
			xlpFeeBps: 10,
			solverFeeBps: 10,
			enableMEV: false,
		});

		const fees = router.calculateFees(BigInt("1000000000"), {
			id: "test",
			steps: [],
			totalEstimatedTime: 0,
			totalEstimatedFee: BigInt(0),
			overallTrustLevel: "trustless",
			revenueOpportunity: BigInt(0),
		});

		// Protocol fee should be 0.2% = 2,000,000
		expect(fees.protocolFee).toBe(BigInt("2000000"));
	});
});


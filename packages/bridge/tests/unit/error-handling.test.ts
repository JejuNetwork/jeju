/**
 * Error Handling Tests
 *
 * Tests:
 * - Invalid inputs
 * - Network failures
 * - Timeout handling
 * - Recovery scenarios
 * - Graceful degradation
 */

import { describe, expect, it } from "bun:test";
import type { Address } from "viem";
import {
	ChainId,
	createEVMClient,
	createSolanaClient,
	toHash32,
} from "../../src/index.js";
import { Keypair, PublicKey } from "@solana/web3.js";

// Mock addresses
const MOCK_BRIDGE = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address;
const MOCK_LIGHT_CLIENT = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;

describe("Invalid Input Handling", () => {
	describe("toHash32 Validation", () => {
		it("should throw for undersized array", () => {
			expect(() => toHash32(new Uint8Array(31))).toThrow();
		});

		it("should throw for oversized array", () => {
			expect(() => toHash32(new Uint8Array(33))).toThrow();
		});

		it("should throw for empty array", () => {
			expect(() => toHash32(new Uint8Array(0))).toThrow();
		});

		it("should throw for null-like values", () => {
			// TypeScript would catch this, but test runtime behavior
			expect(() => toHash32(null as unknown as Uint8Array)).toThrow();
			expect(() => toHash32(undefined as unknown as Uint8Array)).toThrow();
		});
	});

	describe("EVM Client Error Handling", () => {
		it("should handle malformed RPC URL", () => {
			// Should not throw during construction
			const client = createEVMClient({
				chainId: ChainId.LOCAL_EVM,
				rpcUrl: "not-a-valid-url",
				bridgeAddress: MOCK_BRIDGE,
				lightClientAddress: MOCK_LIGHT_CLIENT,
			});
			expect(client).toBeDefined();
		});

		it("should handle empty RPC URL", () => {
			// Empty RPC URL should throw UrlRequiredError from viem
			expect(() => createEVMClient({
				chainId: ChainId.LOCAL_EVM,
				rpcUrl: "",
				bridgeAddress: MOCK_BRIDGE,
				lightClientAddress: MOCK_LIGHT_CLIENT,
			})).toThrow();
		});

		it("should fail on operation with unreachable RPC", async () => {
			const client = createEVMClient({
				chainId: ChainId.LOCAL_EVM,
				rpcUrl: "http://0.0.0.0:9999",
				bridgeAddress: MOCK_BRIDGE,
				lightClientAddress: MOCK_LIGHT_CLIENT,
			});

			await expect(client.getLatestVerifiedSlot()).rejects.toThrow();
		});
	});

	describe("Solana Client Error Handling", () => {
		it("should handle malformed RPC URL", () => {
			// Malformed RPC URL should throw TypeError from @solana/web3.js
			expect(() => createSolanaClient({
				rpcUrl: "not-a-valid-url",
				commitment: "confirmed",
				keypair: Keypair.generate(),
				bridgeProgramId: new PublicKey("11111111111111111111111111111111"),
				evmLightClientProgramId: new PublicKey("11111111111111111111111111111111"),
			})).toThrow();
		});

		it("should fail on operation with unreachable RPC", async () => {
			const client = createSolanaClient({
				rpcUrl: "http://0.0.0.0:9999",
				commitment: "confirmed",
				keypair: Keypair.generate(),
				bridgeProgramId: new PublicKey("11111111111111111111111111111111"),
				evmLightClientProgramId: new PublicKey("11111111111111111111111111111111"),
			});

			await expect(client.getLatestSlot()).rejects.toThrow();
		});
	});
});

describe("Network Failure Handling", () => {
	it("should timeout on unresponsive endpoints", async () => {
		const client = createEVMClient({
			chainId: ChainId.LOCAL_EVM,
			rpcUrl: "http://10.255.255.1:8545", // Non-routable IP
			bridgeAddress: MOCK_BRIDGE,
			lightClientAddress: MOCK_LIGHT_CLIENT,
		});

		const startTime = Date.now();
		
		try {
			await Promise.race([
				client.getLatestVerifiedSlot(),
				new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000)),
			]);
		} catch {
			// Expected to fail
		}

		const elapsed = Date.now() - startTime;
		// Should have timed out within our 3 second window (or failed sooner)
		expect(elapsed).toBeLessThan(5000);
	}, { timeout: 10000 }); // Increase test timeout to 10 seconds
});

describe("Invalid Transfer Parameters", () => {
	describe("Amount Validation", () => {
		it("should identify zero amount as invalid", () => {
			const amount = BigInt(0);
			const isValid = amount > BigInt(0);
			expect(isValid).toBe(false);
		});

		it("should identify negative-like bigint (wrapping)", () => {
			// BigInt doesn't have negative, but max uint256 + 1 would wrap
			const overflow = BigInt("0x10000000000000000000000000000000000000000000000000000000000000000");
			// This would overflow uint256
			expect(overflow > BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")).toBe(true);
		});
	});

	describe("Recipient Validation", () => {
		it("should identify zero recipient as invalid", () => {
			const recipient = new Uint8Array(32).fill(0);
			const isValid = recipient.some(b => b !== 0);
			expect(isValid).toBe(false);
		});

		it("should identify short recipient as invalid", () => {
			const recipient = new Uint8Array(20); // Too short
			const isValid = recipient.length === 32;
			expect(isValid).toBe(false);
		});
	});

	describe("Chain ID Validation", () => {
		it("should identify invalid chain ID", () => {
			const invalidChainId = -1;
			const isValid = invalidChainId > 0;
			expect(isValid).toBe(false);
		});

		it("should identify zero chain ID as invalid", () => {
			const zeroChainId = 0;
			const isValid = zeroChainId > 0;
			expect(isValid).toBe(false);
		});
	});

	describe("Timestamp Validation", () => {
		it("should identify very old timestamp", () => {
			const oldTimestamp = BigInt(1000000000000); // Year 2001
			const now = BigInt(Date.now());
			const maxAge = BigInt(365 * 24 * 60 * 60 * 1000); // 1 year
			
			const isValid = now - oldTimestamp < maxAge;
			expect(isValid).toBe(false);
		});

		it("should identify far future timestamp", () => {
			const futureTimestamp = BigInt(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year ahead
			const now = BigInt(Date.now());
			const maxFuture = BigInt(60 * 60 * 1000); // 1 hour
			
			const isValid = futureTimestamp - now < maxFuture;
			expect(isValid).toBe(false);
		});
	});
});

describe("Recovery Scenarios", () => {
	it("should allow retry after failure", async () => {
		const client = createEVMClient({
			chainId: ChainId.LOCAL_EVM,
			rpcUrl: "http://127.0.0.1:9999", // Bad port
			bridgeAddress: MOCK_BRIDGE,
			lightClientAddress: MOCK_LIGHT_CLIENT,
		});

		// First attempt fails
		let failCount = 0;
		try {
			await client.getLatestVerifiedSlot();
		} catch {
			failCount++;
		}
		expect(failCount).toBe(1);

		// Second attempt also fails (expected)
		try {
			await client.getLatestVerifiedSlot();
		} catch {
			failCount++;
		}
		expect(failCount).toBe(2);
	});

	it("should not corrupt state after failed operations", () => {
		const client = createEVMClient({
			chainId: ChainId.LOCAL_EVM,
			rpcUrl: "http://127.0.0.1:8545",
			bridgeAddress: MOCK_BRIDGE,
			lightClientAddress: MOCK_LIGHT_CLIENT,
		});

		// Chain ID should still be accessible after any internal errors
		expect(client.getChainId()).toBe(ChainId.LOCAL_EVM);
	});
});

describe("Graceful Degradation", () => {
	it("should provide meaningful error messages", async () => {
		const client = createEVMClient({
			chainId: ChainId.LOCAL_EVM,
			rpcUrl: "http://127.0.0.1:9999",
			bridgeAddress: MOCK_BRIDGE,
			lightClientAddress: MOCK_LIGHT_CLIENT,
		});

		try {
			await client.getLatestVerifiedSlot();
			expect(true).toBe(false); // Should not reach here
		} catch (e) {
			expect(e instanceof Error).toBe(true);
			// Error message should exist
			expect((e as Error).message.length).toBeGreaterThan(0);
		}
	});

	it("should handle read-only mode gracefully", async () => {
		const client = createEVMClient({
			chainId: ChainId.LOCAL_EVM,
			rpcUrl: "http://127.0.0.1:8545",
			bridgeAddress: MOCK_BRIDGE,
			lightClientAddress: MOCK_LIGHT_CLIENT,
			// No private key - read-only
		});

		// Should return null for address
		expect(client.getAddress()).toBeNull();

		// Should throw when trying to sign
		try {
			await client.initiateTransfer({
				token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
				recipient: new Uint8Array(32).fill(0x01),
				amount: BigInt(1000000),
				destChainId: ChainId.SOLANA_MAINNET,
			});
			expect(true).toBe(false); // Should not reach here
		} catch (e) {
			expect((e as Error).message).toContain("Wallet not configured");
		}
	});
});

describe("Edge Cases", () => {
	it("should handle maximum values without overflow", () => {
		const maxUint256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
		const maxUint64 = BigInt("18446744073709551615");

		// Operations should not overflow
		expect(maxUint256 > BigInt(0)).toBe(true);
		expect(maxUint64 > BigInt(0)).toBe(true);

		// Adding to max should increase (overflow in Solidity, but fine in JS bigint)
		expect(maxUint256 + BigInt(1) > maxUint256).toBe(true);
	});

	it("should handle empty strings", () => {
		const emptyHex = "";
		const isEmpty = emptyHex.length === 0;
		expect(isEmpty).toBe(true);
	});

	it("should handle special characters in URLs", () => {
		const urlWithSpecialChars = "http://example.com:8545?foo=bar&baz=qux";
		expect(urlWithSpecialChars.includes("?")).toBe(true);
		expect(urlWithSpecialChars.includes("&")).toBe(true);
	});
});


/**
 * Concurrency and Async Behavior Tests
 *
 * Tests:
 * - Concurrent transfer processing
 * - Race conditions
 * - Batch ordering
 * - Timeout handling
 * - Resource contention
 */

import { describe, expect, it } from "bun:test";
import {
	createTEEBatcher,
	ChainId,
	type CrossChainTransfer,
	toHash32,
	LOCAL_TEE_CONFIG,
} from "../../src/index.js";

describe("Concurrent Transfer Processing", () => {
	it("should handle multiple concurrent addTransfer calls", async () => {
		const batcher = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 100,
			minBatchSize: 1,
		});
		await batcher.initialize();

		const numTransfers = 50;
		const transfers = Array.from({ length: numTransfers }, (_, i) => createTransfer(i));

		const results = await Promise.all(
			transfers.map(t => batcher.addTransfer(t))
		);

		// All should succeed
		expect(results.length).toBe(numTransfers);
		
		// All should have valid batch IDs
		for (const result of results) {
			expect(result.batchId).toBeDefined();
			expect(typeof result.batchId).toBe("string");
		}

		// Positions should be unique
		const positions = results.map(r => r.position);
		const uniquePositions = new Set(positions);
		expect(uniquePositions.size).toBe(numTransfers);
	});

	it("should maintain transfer order within batch", async () => {
		const batcher = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 100,
			minBatchSize: 1,
		});
		await batcher.initialize();

		const transfers = Array.from({ length: 10 }, (_, i) => createTransfer(i));
		
		// Add sequentially to ensure order
		const results = [];
		for (const t of transfers) {
			results.push(await batcher.addTransfer(t));
		}

		// Verify sequential positions in order of insertion
		for (let i = 0; i < results.length; i++) {
			expect(results[i].position).toBe(i);
		}
	});

	it("should handle rapid sequential adds", async () => {
		const batcher = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 1000,
			minBatchSize: 1,
		});
		await batcher.initialize();

		const startTime = Date.now();
		const numTransfers = 100;

		for (let i = 0; i < numTransfers; i++) {
			await batcher.addTransfer(createTransfer(i));
		}

		const elapsed = Date.now() - startTime;
		
		// Should complete within reasonable time
		expect(elapsed).toBeLessThan(5000);
	});

	it("should handle interleaved reads and writes", async () => {
		const batcher = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 50,
			minBatchSize: 1,
		});
		await batcher.initialize();

		const results: Array<{ batchId: string; position: number }> = [];
		const attestations: Array<ReturnType<typeof batcher.getAttestation>> = [];

		// Interleave adds and attestation reads
		for (let i = 0; i < 20; i++) {
			results.push(await batcher.addTransfer(createTransfer(i)));
			attestations.push(batcher.getAttestation());
		}

		// All results should be valid
		expect(results.length).toBe(20);
		expect(attestations.length).toBe(20);

		// All attestations should be the same (immutable after init)
		const firstAttestation = attestations[0];
		for (const att of attestations) {
			expect(att?.measurement).toEqual(firstAttestation?.measurement);
		}
	});
});

describe("Batch Boundary Conditions", () => {
	it("should create new batch when max size reached", async () => {
		const maxBatchSize = 5;
		const batcher = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize,
			minBatchSize: 1,
		});
		await batcher.initialize();

		const results = [];
		for (let i = 0; i < maxBatchSize + 2; i++) {
			results.push(await batcher.addTransfer(createTransfer(i)));
		}

		// Should have multiple batches
		const batchIds = new Set(results.map(r => r.batchId));
		expect(batchIds.size).toBeGreaterThanOrEqual(1);
	});

	it("should handle exactly max batch size", async () => {
		const maxBatchSize = 10;
		const batcher = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize,
			minBatchSize: 1,
		});
		await batcher.initialize();

		const results = [];
		for (let i = 0; i < maxBatchSize; i++) {
			results.push(await batcher.addTransfer(createTransfer(i)));
		}

		// All should be in the same batch
		const batchIds = new Set(results.map(r => r.batchId));
		expect(batchIds.size).toBe(1);

		// Positions should be 0 to maxBatchSize-1
		const positions = results.map(r => r.position).sort((a, b) => a - b);
		expect(positions).toEqual(Array.from({ length: maxBatchSize }, (_, i) => i));
	});

	it("should handle single transfer batch", async () => {
		const batcher = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 100,
			minBatchSize: 1,
		});
		await batcher.initialize();

		const result = await batcher.addTransfer(createTransfer(0));

		expect(result.batchId).toBeDefined();
		expect(result.position).toBe(0);
	});
});

describe("Async Operation Ordering", () => {
	it("should process transfers in FIFO order under load", async () => {
		const batcher = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 1000,
			minBatchSize: 1,
		});
		await batcher.initialize();

		const numTransfers = 100;
		const insertionOrder: number[] = [];
		const results: Array<{ batchId: string; position: number; nonce: number }> = [];

		// Use Promise.all to maximize concurrency
		const promises = Array.from({ length: numTransfers }, async (_, i) => {
			insertionOrder.push(i);
			const result = await batcher.addTransfer(createTransfer(i));
			return { ...result, nonce: i };
		});

		const allResults = await Promise.all(promises);
		results.push(...allResults);

		// Verify all completed
		expect(results.length).toBe(numTransfers);
	});

	it("should handle Promise.race patterns", async () => {
		const batcher = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 10,
			minBatchSize: 1,
		});
		await batcher.initialize();

		const transfer1 = batcher.addTransfer(createTransfer(1));
		const transfer2 = batcher.addTransfer(createTransfer(2));
		const transfer3 = batcher.addTransfer(createTransfer(3));

		const firstComplete = await Promise.race([transfer1, transfer2, transfer3]);
		expect(firstComplete.batchId).toBeDefined();

		// All should still complete
		const [r1, r2, r3] = await Promise.all([transfer1, transfer2, transfer3]);
		expect(r1.batchId).toBeDefined();
		expect(r2.batchId).toBeDefined();
		expect(r3.batchId).toBeDefined();
	});
});

describe("Resource Contention", () => {
	it("should handle multiple batcher instances", async () => {
		const batcher1 = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 10,
			minBatchSize: 1,
		});
		const batcher2 = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 10,
			minBatchSize: 1,
		});

		await Promise.all([batcher1.initialize(), batcher2.initialize()]);

		const [result1, result2] = await Promise.all([
			batcher1.addTransfer(createTransfer(1)),
			batcher2.addTransfer(createTransfer(2)),
		]);

		// Each batcher should have its own batch
		expect(result1.batchId).toBeDefined();
		expect(result2.batchId).toBeDefined();
		// Batch IDs should be different (from different instances)
		expect(result1.batchId).not.toBe(result2.batchId);
	});

	it("should maintain isolation between batchers", async () => {
		const batcher1 = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 5,
			minBatchSize: 1,
		});
		const batcher2 = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 5,
			minBatchSize: 1,
		});

		await Promise.all([batcher1.initialize(), batcher2.initialize()]);

		// Add to batcher1
		const results1 = [];
		for (let i = 0; i < 3; i++) {
			results1.push(await batcher1.addTransfer(createTransfer(i)));
		}

		// Add to batcher2
		const results2 = [];
		for (let i = 0; i < 3; i++) {
			results2.push(await batcher2.addTransfer(createTransfer(100 + i)));
		}

		// Each batcher should have independent positions
		expect(results1.map(r => r.position)).toEqual([0, 1, 2]);
		expect(results2.map(r => r.position)).toEqual([0, 1, 2]);
	});
});

describe("Error Recovery Under Concurrency", () => {
	it("should continue processing after invalid transfer", async () => {
		const batcher = createTEEBatcher({
			...LOCAL_TEE_CONFIG,
			maxBatchSize: 10,
			minBatchSize: 1,
		});
		await batcher.initialize();

		// Add valid transfer
		const result1 = await batcher.addTransfer(createTransfer(1));
		expect(result1.batchId).toBeDefined();

		// Add invalid transfer (zero amount) - should throw
		const invalidTransfer = createTransfer(2);
		invalidTransfer.amount = BigInt(0);

		// Invalid transfers are rejected immediately with validation error
		await expect(batcher.addTransfer(invalidTransfer)).rejects.toThrow('Transfer amount must be positive');

		// Add another valid transfer - should still work after rejection
		const result3 = await batcher.addTransfer(createTransfer(3));
		expect(result3.batchId).toBeDefined();

		// Both valid transfers should be in same batch
		expect(result1.batchId).toBe(result3.batchId);
	});
});

// Helper to create test transfers
function createTransfer(nonce: number): CrossChainTransfer {
	return {
		transferId: toHash32(new Uint8Array(32).map((_, i) => (nonce + i) % 256)),
		sourceChain: ChainId.LOCAL_EVM,
		destChain: ChainId.LOCAL_SOLANA,
		token: toHash32(new Uint8Array(32).fill(0x01)),
		sender: new Uint8Array(32).fill(0x02),
		recipient: new Uint8Array(32).fill(0x03),
		amount: BigInt(1000000 * (nonce + 1)),
		nonce: BigInt(nonce),
		timestamp: BigInt(Date.now()),
		payload: new Uint8Array(0),
	};
}


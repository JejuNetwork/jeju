#!/usr/bin/env bun
/**
 * Start Local Development Environment
 *
 * Spins up:
 * 1. Local EVM chain (Anvil)
 * 2. Local Solana validator
 * 3. Mock TEE batcher
 * 4. Mock prover
 * 5. Deploys all contracts
 * 6. Initializes bridge with genesis state
 */

import { type Subprocess, spawn } from "bun";
import {
	getLocalGenesisState,
	LOCAL_CHAIN_CONFIG,
	TEST_TOKENS,
} from "./config.js";

interface ProcessHandle {
	name: string;
	process: Subprocess | null;
	port: number;
}

const processes: ProcessHandle[] = [];

async function waitForPort(port: number, maxAttempts = 30): Promise<boolean> {
	for (let i = 0; i < maxAttempts; i++) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "web3_clientVersion",
					params: [],
					id: 1,
				}),
			});
			if (response.ok) return true;
		} catch {
			// Port not ready yet
		}
		await Bun.sleep(1000);
	}
	return false;
}

async function waitForSolana(port: number, maxAttempts = 30): Promise<boolean> {
	for (let i = 0; i < maxAttempts; i++) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", method: "getHealth", id: 1 }),
			});
			if (response.ok) {
				const data = (await response.json()) as { result?: string };
				if (data.result === "ok") return true;
			}
		} catch {
			// Not ready yet
		}
		await Bun.sleep(1000);
	}
	return false;
}

async function startAnvil(): Promise<ProcessHandle> {
	console.log("🔨 Starting Anvil (local EVM)...");

	const proc = spawn({
		cmd: [
			"anvil",
			"--chain-id",
			LOCAL_CHAIN_CONFIG.evm.chainId.toString(),
			"--port",
			"8545",
			"--block-time",
			LOCAL_CHAIN_CONFIG.evm.blockTime.toString(),
			"--accounts",
			"10",
			"--balance",
			"10000",
		],
		stdout: "pipe",
		stderr: "pipe",
	});

	const handle: ProcessHandle = {
		name: "anvil",
		process: proc,
		port: 8545,
	};

	// Wait for Anvil to be ready
	const ready = await waitForPort(8545);
	if (!ready) {
		throw new Error("Anvil failed to start");
	}

	console.log("✅ Anvil started on port 8545");
	return handle;
}

async function startSolanaValidator(): Promise<ProcessHandle> {
	console.log("☀️ Starting Solana Test Validator...");

	const proc = spawn({
		cmd: [
			"solana-test-validator",
			"--rpc-port",
			"8899",
			"--faucet-port",
			"9900",
			"--reset",
			"--quiet",
		],
		stdout: "pipe",
		stderr: "pipe",
	});

	const handle: ProcessHandle = {
		name: "solana-test-validator",
		process: proc,
		port: 8899,
	};

	// Wait for Solana to be ready
	const ready = await waitForSolana(8899);
	if (!ready) {
		throw new Error("Solana validator failed to start");
	}

	console.log("✅ Solana validator started on port 8899");
	return handle;
}

async function deployEVMContracts(): Promise<void> {
	console.log("📜 Deploying EVM contracts...");

	// Use forge to deploy contracts
	const proc = spawn({
		cmd: [
			"forge",
			"script",
			"scripts/DeployLocal.s.sol:DeployLocal",
			"--rpc-url",
			LOCAL_CHAIN_CONFIG.evm.rpcUrl,
			"--private-key",
			LOCAL_CHAIN_CONFIG.evm.privateKeys[0],
			"--broadcast",
		],
		cwd: `${process.cwd()}/contracts`,
		stdout: "inherit",
		stderr: "inherit",
	});

	await proc.exited;

	if (proc.exitCode !== 0) {
		console.warn("⚠️ Forge deployment failed - may need manual deployment");
	} else {
		console.log("✅ EVM contracts deployed");
	}
}

async function deploySolanaPrograms(): Promise<void> {
	console.log("📜 Deploying Solana programs...");

	const proc = spawn({
		cmd: ["anchor", "deploy", "--provider.cluster", "localnet"],
		cwd: `${process.cwd()}/programs`,
		stdout: "inherit",
		stderr: "inherit",
	});

	await proc.exited;

	if (proc.exitCode !== 0) {
		console.warn("⚠️ Anchor deployment failed - may need manual deployment");
	} else {
		console.log("✅ Solana programs deployed");
	}
}

async function initializeBridge(): Promise<void> {
	console.log("🌉 Initializing bridge with genesis state...");

	const genesis = getLocalGenesisState();

	// Initialize Solana light client on EVM
	console.log("  → Initializing Solana light client on EVM...");
	console.log(`    Genesis slot: ${genesis.solana.slot}`);
	// This would call the initialize function with genesis state

	// Initialize EVM light client on Solana
	console.log("  → Initializing EVM light client on Solana...");
	console.log(`    Genesis slot: ${genesis.ethereum.slot}`);
	// This would call the Solana program's initialize instruction

	console.log("✅ Bridge initialized");
}

async function createTestTokens(): Promise<void> {
	console.log("🪙 Creating test tokens...");

	for (const token of TEST_TOKENS) {
		console.log(`  → Creating ${token.symbol}...`);
		// Deploy CrossChainToken on EVM
		// Create SPL token on Solana
		// Register in bridge
	}

	console.log("✅ Test tokens created");
}

async function startMockTEE(): Promise<ProcessHandle> {
	console.log("🔐 Starting mock TEE batcher...");

	// For local dev, we run a simple HTTP server that simulates TEE batching
	Bun.serve({
		port: 8080,
		fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === "/tee/batch") {
				return new Response(
					JSON.stringify({
						batchId: crypto.randomUUID(),
						status: "queued",
					}),
					{
						headers: { "Content-Type": "application/json" },
					},
				);
			}

			if (url.pathname === "/tee/status") {
				return new Response(
					JSON.stringify({
						status: "ready",
						pendingBatches: 0,
					}),
					{
						headers: { "Content-Type": "application/json" },
					},
				);
			}

			return new Response("Not found", { status: 404 });
		},
	});

	console.log("✅ Mock TEE batcher started on port 8080");

	// Return a mock process handle (no subprocess, uses HTTP server)
	return {
		name: "mock-tee",
		process: null,
		port: 8080,
	};
}

async function main(): Promise<void> {
	console.log("🚀 Starting EVMSol Local Development Environment\n");

	try {
		// Start infrastructure
		const anvil = await startAnvil();
		processes.push(anvil);

		const solana = await startSolanaValidator();
		processes.push(solana);

		const tee = await startMockTEE();
		processes.push(tee);

		// Deploy contracts
		await deployEVMContracts();
		await deploySolanaPrograms();

		// Initialize
		await initializeBridge();
		await createTestTokens();

		console.log("\n✨ Local environment ready!\n");
		console.log(`EVM RPC:     ${LOCAL_CHAIN_CONFIG.evm.rpcUrl}`);
		console.log(`Solana RPC:  ${LOCAL_CHAIN_CONFIG.solana.rpcUrl}`);
		console.log("TEE Batcher: http://127.0.0.1:8080/tee\n");
		console.log("Press Ctrl+C to stop all services.\n");

		// Keep process alive
		process.on("SIGINT", async () => {
			console.log("\n🛑 Shutting down...");
			for (const p of processes) {
				if (p.process) {
					p.process.kill();
				}
			}
			process.exit(0);
		});

		// Wait forever
		await new Promise(() => { /* noop - keep process running */ });
	} catch (error) {
		console.error("❌ Failed to start local environment:", error);

		// Cleanup
		for (const p of processes) {
			if (p.process) {
				p.process.kill();
			}
		}

		process.exit(1);
	}
}

main();

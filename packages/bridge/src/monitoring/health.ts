/**
 * Health Check and Monitoring
 *
 * Provides health endpoints and metrics for the EVMSol bridge infrastructure.
 */

import { Elysia } from "elysia";

// =============================================================================
// TYPES
// =============================================================================

export interface ComponentHealth {
	name: string;
	status: "healthy" | "degraded" | "unhealthy";
	latencyMs: number;
	lastCheck: number;
	error: string | null;
}

export interface SystemHealth {
	status: "healthy" | "degraded" | "unhealthy";
	components: ComponentHealth[];
	uptime: number;
	version: string;
}

export interface Metrics {
	// Transfer metrics
	transfersInitiated: number;
	transfersCompleted: number;
	transfersFailed: number;
	averageTransferTimeMs: number;

	// Proof metrics
	proofsGenerated: number;
	proofGenerationTimeMs: number;
	batchSize: number;

	// Chain metrics
	solanaSlot: bigint;
	ethereumSlot: bigint;
	evmBlockNumbers: Map<number, bigint>;

	// Resource metrics
	memoryUsageMb: number;
	cpuUsagePercent: number;
}

export interface HealthCheckConfig {
	evmRpcUrls: Map<number, string>;
	solanaRpcUrl: string;
	beaconRpcUrl: string;
	proverEndpoint: string;
	relayerEndpoint: string;
	checkIntervalMs: number;
}

// =============================================================================
// HEALTH CHECKER
// =============================================================================

export class HealthChecker {
	private config: HealthCheckConfig;
	private componentHealth: Map<string, ComponentHealth> = new Map();
	private metrics: Metrics;
	private startTime = Date.now();
	private checkInterval: ReturnType<typeof setInterval> | null = null;

	constructor(config: HealthCheckConfig) {
		this.config = config;
		this.metrics = this.initializeMetrics();
	}

	/**
	 * Start health checking
	 */
	start(): void {
		console.log("[Health] Starting health checker");
		this.runChecks();
		this.checkInterval = setInterval(
			() => this.runChecks(),
			this.config.checkIntervalMs,
		);
	}

	/**
	 * Stop health checking
	 */
	stop(): void {
		if (this.checkInterval) {
			clearInterval(this.checkInterval);
		}
	}

	/**
	 * Get system health
	 */
	getHealth(): SystemHealth {
		const components = Array.from(this.componentHealth.values());
		const hasUnhealthy = components.some((c) => c.status === "unhealthy");
		const hasDegraded = components.some((c) => c.status === "degraded");

		return {
			status: hasUnhealthy ? "unhealthy" : hasDegraded ? "degraded" : "healthy",
			components,
			uptime: Date.now() - this.startTime,
			version: "0.0.1",
		};
	}

	/**
	 * Get metrics
	 */
	getMetrics(): Metrics {
		// Update resource metrics
		this.metrics.memoryUsageMb = process.memoryUsage().heapUsed / 1024 / 1024;

		return this.metrics;
	}

	/**
	 * Update transfer metrics
	 */
	recordTransfer(
		type: "initiated" | "completed" | "failed",
		durationMs?: number,
	): void {
		switch (type) {
			case "initiated":
				this.metrics.transfersInitiated++;
				break;
			case "completed":
				this.metrics.transfersCompleted++;
				if (durationMs !== undefined) {
					this.updateAverageTransferTime(durationMs);
				}
				break;
			case "failed":
				this.metrics.transfersFailed++;
				break;
		}
	}

	/**
	 * Update proof metrics
	 */
	recordProof(generationTimeMs: number, batchSize: number): void {
		this.metrics.proofsGenerated++;
		this.metrics.proofGenerationTimeMs = generationTimeMs;
		this.metrics.batchSize = batchSize;
	}

	/**
	 * Update chain slots
	 */
	updateSlots(solanaSlot?: bigint, ethereumSlot?: bigint): void {
		if (solanaSlot !== undefined) {
			this.metrics.solanaSlot = solanaSlot;
		}
		if (ethereumSlot !== undefined) {
			this.metrics.ethereumSlot = ethereumSlot;
		}
	}

	/**
	 * Run all health checks
	 */
	private async runChecks(): Promise<void> {
		// Check EVM chains
		for (const [chainId, rpcUrl] of this.config.evmRpcUrls) {
			await this.checkEVMChain(chainId, rpcUrl);
		}

		// Check Solana
		await this.checkSolana();

		// Check Beacon node
		await this.checkBeacon();

		// Check Prover
		await this.checkProver();

		// Check Relayer
		await this.checkRelayer();
	}

	/**
	 * Check EVM chain health
	 */
	private async checkEVMChain(chainId: number, rpcUrl: string): Promise<void> {
		const name = `evm-${chainId}`;
		const startTime = Date.now();

		try {
			const response = await fetch(rpcUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "eth_blockNumber",
					params: [],
					id: 1,
				}),
			});

			const latency = Date.now() - startTime;

			if (!response.ok) {
				this.setComponentHealth(name, "unhealthy", latency, "RPC error");
				return;
			}

			const data = (await response.json()) as { result?: string };
			if (data.result) {
				this.metrics.evmBlockNumbers.set(chainId, BigInt(data.result));
			}

			this.setComponentHealth(
				name,
				latency > 1000 ? "degraded" : "healthy",
				latency,
				null,
			);
		} catch (error) {
			this.setComponentHealth(name, "unhealthy", 0, String(error));
		}
	}

	/**
	 * Check Solana health
	 */
	private async checkSolana(): Promise<void> {
		const name = "solana";
		const startTime = Date.now();

		try {
			const response = await fetch(this.config.solanaRpcUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "getHealth",
					id: 1,
				}),
			});

			const latency = Date.now() - startTime;

			if (!response.ok) {
				this.setComponentHealth(name, "unhealthy", latency, "RPC error");
				return;
			}

			const data = (await response.json()) as { result?: string };
			if (data.result === "ok") {
				this.setComponentHealth(
					name,
					latency > 500 ? "degraded" : "healthy",
					latency,
					null,
				);
			} else {
				this.setComponentHealth(name, "degraded", latency, "Not fully synced");
			}
		} catch (error) {
			this.setComponentHealth(name, "unhealthy", 0, String(error));
		}
	}

	/**
	 * Check Beacon node health
	 */
	private async checkBeacon(): Promise<void> {
		const name = "beacon";
		const startTime = Date.now();

		try {
			const response = await fetch(
				`${this.config.beaconRpcUrl}/eth/v1/node/health`,
			);

			const latency = Date.now() - startTime;

			this.setComponentHealth(
				name,
				response.ok ? (latency > 1000 ? "degraded" : "healthy") : "unhealthy",
				latency,
				response.ok ? null : "Beacon node unhealthy",
			);
		} catch (error) {
			this.setComponentHealth(name, "unhealthy", 0, String(error));
		}
	}

	/**
	 * Check Prover health
	 */
	private async checkProver(): Promise<void> {
		const name = "prover";
		const startTime = Date.now();

		try {
			const response = await fetch(`${this.config.proverEndpoint}/health`);
			const latency = Date.now() - startTime;

			this.setComponentHealth(
				name,
				response.ok ? "healthy" : "unhealthy",
				latency,
				response.ok ? null : "Prover unhealthy",
			);
		} catch (error) {
			this.setComponentHealth(name, "unhealthy", 0, String(error));
		}
	}

	/**
	 * Check Relayer health
	 */
	private async checkRelayer(): Promise<void> {
		const name = "relayer";
		const startTime = Date.now();

		try {
			const response = await fetch(`${this.config.relayerEndpoint}/health`);
			const latency = Date.now() - startTime;

			this.setComponentHealth(
				name,
				response.ok ? "healthy" : "unhealthy",
				latency,
				response.ok ? null : "Relayer unhealthy",
			);
		} catch (error) {
			this.setComponentHealth(name, "unhealthy", 0, String(error));
		}
	}

	/**
	 * Set component health status
	 */
	private setComponentHealth(
		name: string,
		status: "healthy" | "degraded" | "unhealthy",
		latencyMs: number,
		error: string | null,
	): void {
		this.componentHealth.set(name, {
			name,
			status,
			latencyMs,
			lastCheck: Date.now(),
			error,
		});
	}

	/**
	 * Update average transfer time
	 */
	private updateAverageTransferTime(durationMs: number): void {
		const completed = this.metrics.transfersCompleted;
		const currentAvg = this.metrics.averageTransferTimeMs;
		this.metrics.averageTransferTimeMs =
			(currentAvg * (completed - 1) + durationMs) / completed;
	}

	/**
	 * Initialize metrics
	 */
	private initializeMetrics(): Metrics {
		return {
			transfersInitiated: 0,
			transfersCompleted: 0,
			transfersFailed: 0,
			averageTransferTimeMs: 0,
			proofsGenerated: 0,
			proofGenerationTimeMs: 0,
			batchSize: 0,
			solanaSlot: BigInt(0),
			ethereumSlot: BigInt(0),
			evmBlockNumbers: new Map(),
			memoryUsageMb: 0,
			cpuUsagePercent: 0,
		};
	}
}

// =============================================================================
// ELYSIA PLUGIN
// =============================================================================

export function healthPlugin(checker: HealthChecker) {
	return new Elysia({ prefix: "/monitoring" })
		.get("/health", () => checker.getHealth())
		.get("/metrics", () => {
			const metrics = checker.getMetrics();
			return {
				...metrics,
				solanaSlot: metrics.solanaSlot.toString(),
				ethereumSlot: metrics.ethereumSlot.toString(),
				evmBlockNumbers: Object.fromEntries(
					Array.from(metrics.evmBlockNumbers.entries()).map(([k, v]) => [
						k,
						v.toString(),
					]),
				),
			};
		})
		.get("/ready", () => {
			const health = checker.getHealth();
			if (health.status === "unhealthy") {
				throw new Error("System unhealthy");
			}
			return { ready: true };
		})
		.get("/live", () => ({ live: true }));
}

// =============================================================================
// FACTORY
// =============================================================================

export function createHealthChecker(config: HealthCheckConfig): HealthChecker {
	return new HealthChecker(config);
}

/**
 * SP1 Prover Client
 *
 * Real implementation using Succinct's SP1 zkVM for ZK proof generation.
 * SP1 is a high-performance RISC-V zkVM that can prove arbitrary Rust programs.
 *
 * Features:
 * - Local proving with SP1 CLI
 * - Remote proving via Succinct Network
 * - Groth16 proof generation for on-chain verification
 *
 * @see https://docs.succinct.xyz/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "bun";
import type { Groth16Proof, Hash32, SP1Proof } from "../types/index.js";
import { toHash32 } from "../types/index.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("sp1");

// =============================================================================
// TYPES
// =============================================================================

export interface SP1Config {
	/** Path to SP1 programs directory */
	programsDir: string;
	/** Use mock proofs (for local development) */
	useMock?: boolean;
	/** Timeout for proof generation in ms */
	timeoutMs?: number;
	/** Use Succinct Network for remote proving */
	useSuccinctNetwork?: boolean;
	/** Succinct Network API key */
	succinctApiKey?: string;
	/** Number of parallel workers */
	workers?: number;
}

export interface ProofRequest {
	/** Type of proof to generate */
	type:
		| "solana_consensus"
		| "ethereum_consensus"
		| "token_transfer"
		| "batch_transfer";
	/** Input data for the proof */
	inputs: unknown;
	/** Priority (higher = faster) */
	priority?: number;
}

export interface ProofResult {
	/** Request ID */
	id: string;
	/** Type of proof */
	type: string;
	/** SP1 proof bytes */
	proof: SP1Proof;
	/** Groth16 proof for on-chain verification */
	groth16: Groth16Proof;
	/** Time to generate proof in ms */
	generationTimeMs: number;
	/** Whether proof generation succeeded */
	success: boolean;
	/** Error message if failed */
	error?: string;
}

// =============================================================================
// SP1 CLIENT
// =============================================================================

export class SP1Client {
	private config: SP1Config;
	private sp1Available: boolean = false;
	private initialized: boolean = false;
	private tempDir: string;

	constructor(config: SP1Config) {
		this.config = {
			useMock: false,
			timeoutMs: 600000, // 10 minutes default
			useSuccinctNetwork: false,
			workers: 2,
			...config,
		};
		this.tempDir = join(config.programsDir, ".sp1-temp");
	}

	/**
	 * Initialize the SP1 client
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		// Create temp directory
		if (!existsSync(this.tempDir)) {
			mkdirSync(this.tempDir, { recursive: true });
		}

		// Check if SP1 is available
		this.sp1Available = await this.checkSP1Available();

		if (this.sp1Available) {
			log.info("SP1 toolchain detected");
		} else if (this.config.useSuccinctNetwork && this.config.succinctApiKey) {
			log.info("Using Succinct Network for remote proving");
		} else if (this.config.useMock) {
			log.info("Using mock proofs (development mode)");
		} else {
			log.warn("SP1 not available, falling back to mock proofs");
		}

		this.initialized = true;
	}

	/**
	 * Generate a proof
	 */
	async prove(request: ProofRequest): Promise<ProofResult> {
		if (!this.initialized) {
			await this.initialize();
		}

		const id = `proof_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
		const startTime = Date.now();

		log.info("Generating proof", { type: request.type, id });

		// Try real proof generation first
		if (this.sp1Available && !this.config.useMock) {
			return await this.generateRealProof(id, request, startTime);
		}

		// Try Succinct Network
		if (
			this.config.useSuccinctNetwork &&
			this.config.succinctApiKey &&
			!this.config.useMock
		) {
			return await this.generateRemoteProof(id, request, startTime);
		}

		// Fall back to mock
		return await this.generateMockProof(id, request, startTime);
	}

	/**
	 * Generate Solana consensus proof
	 */
	async proveSolanaConsensus(inputs: {
		slot: bigint;
		bankHash: Hash32;
		votes: Array<{ validator: Uint8Array; signature: Uint8Array }>;
		epochStakes: Map<string, bigint>;
	}): Promise<ProofResult> {
		return await this.prove({
			type: "solana_consensus",
			inputs,
			priority: 10,
		});
	}

	/**
	 * Generate Ethereum consensus proof
	 */
	async proveEthereumConsensus(inputs: {
		slot: bigint;
		stateRoot: Hash32;
		syncCommitteeRoot: Hash32;
		signatures: Uint8Array[];
	}): Promise<ProofResult> {
		return await this.prove({
			type: "ethereum_consensus",
			inputs,
			priority: 10,
		});
	}

	/**
	 * Generate token transfer proof
	 */
	async proveTokenTransfer(inputs: {
		transferId: Hash32;
		sourceChainId: number;
		destChainId: number;
		sender: Uint8Array;
		recipient: Uint8Array;
		amount: bigint;
		stateRoot: Hash32;
	}): Promise<ProofResult> {
		return await this.prove({
			type: "token_transfer",
			inputs,
			priority: 5,
		});
	}

	/**
	 * Generate batch transfer proof
	 */
	async proveBatchTransfer(inputs: {
		batchId: Hash32;
		transfers: Array<{
			transferId: Hash32;
			amount: bigint;
		}>;
		stateRoot: Hash32;
	}): Promise<ProofResult> {
		return await this.prove({
			type: "batch_transfer",
			inputs,
			priority: 8,
		});
	}

	/**
	 * Check if SP1 is available
	 */
	async checkSP1Available(): Promise<boolean> {
		// Check for cargo-prove
		try {
			const cargoProve = spawn({
				cmd: ["cargo", "prove", "--version"],
				stdout: "pipe",
				stderr: "pipe",
			});
			await cargoProve.exited;

			if (cargoProve.exitCode === 0) {
				return true;
			}
		} catch {
			// cargo-prove not found
		}

		// Check for sp1 CLI in common paths
		const sp1Paths = [
			join(process.env.HOME ?? "", ".sp1", "bin", "sp1"),
			join(process.env.HOME ?? "", ".cargo", "bin", "sp1"),
		];

		for (const sp1Path of sp1Paths) {
			try {
				if (!existsSync(sp1Path)) continue;

				const proc = spawn({
					cmd: [sp1Path, "--version"],
					stdout: "pipe",
					stderr: "pipe",
				});
				await proc.exited;

				if (proc.exitCode === 0) {
					return true;
				}
			} catch {
				// This path not available
			}
		}

		return false;
	}

	// =============================================================================
	// PRIVATE METHODS
	// =============================================================================

	private async generateRealProof(
		id: string,
		request: ProofRequest,
		startTime: number,
	): Promise<ProofResult> {
		const programPath = this.getProgramPath(request.type);

		if (!existsSync(programPath)) {
			log.warn("Program not found, falling back to mock", { programPath });
			return await this.generateMockProof(id, request, startTime);
		}

		// Write inputs to temp file
		const inputPath = join(this.tempDir, `${id}_input.json`);
		const outputPath = join(this.tempDir, `${id}_output.json`);

		writeFileSync(
			inputPath,
			JSON.stringify(request.inputs, (_, v) =>
				typeof v === "bigint" ? v.toString() : v,
			),
		);

		// Get cargo-prove path
		const cargoProvePath = this.getCargoProvePath();
		log.debug("Using SP1 toolchain", { cargoProvePath, programPath });

		// Run SP1 prover with cargo-prove
		// First, build the program if not already built
		const buildProc = spawn({
			cmd: [cargoProvePath, "prove", "build"],
			cwd: programPath.includes("/target/")
				? join(programPath, "..", "..", "..")
				: programPath,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				RUSTUP_TOOLCHAIN: "succinct",
			},
		});

		const buildExitCode = await buildProc.exited;
		if (buildExitCode !== 0) {
			const stderr = await new Response(buildProc.stderr).text();
			log.error("Build failed", { stderr });
			return await this.generateMockProof(id, request, startTime);
		}

		// Now run the prover
		const programName = programPath.split("/").pop() ?? "program";
		const proc = spawn({
			cmd: [
				cargoProvePath,
				"prove",
				"--elf",
				programPath.includes("/target/")
					? programPath
					: join(programPath, "target", "release", programName),
				"--input",
				inputPath,
				"--output",
				outputPath,
			],
			cwd: this.config.programsDir,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				RUSTUP_TOOLCHAIN: "succinct",
			},
		});

		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			const stderr = await new Response(proc.stderr).text();
			log.error("Proof generation failed", { stderr });
			return await this.generateMockProof(id, request, startTime);
		}

		// Read output
		if (!existsSync(outputPath)) {
			log.warn("Output file not found, using mock proof", { outputPath });
			return await this.generateMockProof(id, request, startTime);
		}
		const outputData = JSON.parse(readFileSync(outputPath, "utf-8"));

		return {
			id,
			type: request.type,
			proof: this.parseProof(outputData.proof),
			groth16: this.parseGroth16(outputData.groth16),
			generationTimeMs: Date.now() - startTime,
			success: true,
		};
	}

	private async generateRemoteProof(
		id: string,
		request: ProofRequest,
		startTime: number,
	): Promise<ProofResult> {
		const response = await fetch("https://prover.succinct.xyz/api/v1/prove", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.config.succinctApiKey}`,
			},
			body: JSON.stringify({
				program_id: `evmsol_${request.type}`,
				inputs: request.inputs,
				priority: request.priority ?? 5,
			}),
			signal: AbortSignal.timeout(this.config.timeoutMs ?? 600000),
		});

		if (!response.ok) {
			const error = await response.text();
			log.error("Remote proving failed", { error });
			return {
				id,
				type: request.type,
				proof: this.emptyProof(),
				groth16: this.emptyGroth16(),
				generationTimeMs: Date.now() - startTime,
				success: false,
				error: `Remote proving failed: ${response.status}`,
			};
		}

		const result = (await response.json()) as {
			proof: string;
			groth16: {
				a: string[];
				b: string[][];
				c: string[];
			};
		};

		return {
			id,
			type: request.type,
			proof: this.parseProof(result.proof),
			groth16: this.parseGroth16(result.groth16),
			generationTimeMs: Date.now() - startTime,
			success: true,
		};
	}

	private async generateMockProof(
		id: string,
		request: ProofRequest,
		startTime: number,
	): Promise<ProofResult> {
		// Production guard: mock proofs are not allowed in production
		const isProduction = process.env.NODE_ENV === "production";
		const requireRealProof = process.env.REQUIRE_REAL_PROOFS === "true";

		if (isProduction || requireRealProof) {
			return {
				id,
				type: request.type,
				proof: this.emptyProof(),
				groth16: this.emptyGroth16(),
				generationTimeMs: Date.now() - startTime,
				success: false,
				error:
					"Mock proofs are disabled in production. " +
					"Install SP1 toolchain (sp1up) or configure SUCCINCT_API_KEY for remote proving.",
			};
		}

		// Development-only mock proof
		log.warn("Generating mock proof - DEVELOPMENT ONLY", { type: request.type });
		await Bun.sleep(100);

		const proofBytes = new Uint8Array(256);
		crypto.getRandomValues(proofBytes);

		const publicInputs = new Uint8Array(64);
		crypto.getRandomValues(publicInputs);

		const vkeyHash = new Uint8Array(32);
		crypto.getRandomValues(vkeyHash);

		const proof: SP1Proof = {
			proof: proofBytes,
			publicInputs,
			vkeyHash: toHash32(vkeyHash),
		};

		const groth16: Groth16Proof = {
			a: [BigInt(1), BigInt(2)],
			b: [
				[BigInt(3), BigInt(4)],
				[BigInt(5), BigInt(6)],
			],
			c: [BigInt(7), BigInt(8)],
		};

		return {
			id,
			type: request.type,
			proof,
			groth16,
			generationTimeMs: Date.now() - startTime,
			success: true,
		};
	}

	private getProgramPath(type: string): string {
		// SP1 programs are built to target/release after `cargo prove build`
		const programMap: Record<string, string> = {
			solana_consensus: "solana-consensus",
			ethereum_consensus: "ethereum-consensus",
			token_transfer: "token-transfer",
			batch_transfer: "token-transfer",
		};
		const programName = programMap[type] ?? "unknown";
		// Return program directory for cargo prove
		return join(this.config.programsDir, programName);
	}

	/**
	 * Get the path to cargo-prove binary
	 */
	private getCargoProvePath(): string {
		const paths = [
			join(process.env.HOME ?? "", ".sp1", "bin", "cargo-prove"),
			join(process.env.HOME ?? "", ".cargo", "bin", "cargo-prove"),
		];

		for (const p of paths) {
			if (existsSync(p)) {
				return p;
			}
		}

		return "cargo-prove"; // Hope it's in PATH
	}

	private parseProof(proofData: unknown): SP1Proof {
		if (typeof proofData === "string") {
			const bytes = Buffer.from(proofData, "hex");
			return {
				proof: bytes.slice(0, 256),
				publicInputs: bytes.slice(256, 320),
				vkeyHash: toHash32(bytes.slice(320, 352)),
			};
		}

		const p = proofData as {
			proof?: string;
			public_inputs?: string;
			vkey_hash?: string;
		};
		return {
			proof: Buffer.from(p.proof ?? "", "hex"),
			publicInputs: Buffer.from(p.public_inputs ?? "", "hex"),
			vkeyHash: toHash32(Buffer.from(p.vkey_hash ?? "00".repeat(32), "hex")),
		};
	}

	private parseGroth16(groth16Data: unknown): Groth16Proof {
		if (!groth16Data) return this.emptyGroth16();

		const g = groth16Data as { a?: string[]; b?: string[][]; c?: string[] };
		const aArr = (g.a ?? ["0", "0"]).map(BigInt);
		const bArr = (
			g.b ?? [
				["0", "0"],
				["0", "0"],
			]
		).map((arr) => arr.map(BigInt));
		const cArr = (g.c ?? ["0", "0"]).map(BigInt);

		return {
			a: [aArr[0] ?? BigInt(0), aArr[1] ?? BigInt(0)],
			b: [
				[bArr[0]?.[0] ?? BigInt(0), bArr[0]?.[1] ?? BigInt(0)],
				[bArr[1]?.[0] ?? BigInt(0), bArr[1]?.[1] ?? BigInt(0)],
			],
			c: [cArr[0] ?? BigInt(0), cArr[1] ?? BigInt(0)],
		};
	}

	private emptyProof(): SP1Proof {
		return {
			proof: new Uint8Array(0),
			publicInputs: new Uint8Array(0),
			vkeyHash: toHash32(new Uint8Array(32)),
		};
	}

	private emptyGroth16(): Groth16Proof {
		return {
			a: [BigInt(0), BigInt(0)],
			b: [
				[BigInt(0), BigInt(0)],
				[BigInt(0), BigInt(0)],
			],
			c: [BigInt(0), BigInt(0)],
		};
	}
}

// =============================================================================
// FACTORY
// =============================================================================

export function createSP1Client(config?: Partial<SP1Config>): SP1Client {
	const programsDir = config?.programsDir ?? join(process.cwd(), "circuits");

	return new SP1Client({
		programsDir,
		useMock: config?.useMock ?? !existsSync(programsDir),
		timeoutMs: config?.timeoutMs ?? 600000,
		useSuccinctNetwork:
			config?.useSuccinctNetwork ?? Boolean(process.env.SUCCINCT_API_KEY),
		succinctApiKey: config?.succinctApiKey ?? process.env.SUCCINCT_API_KEY,
		workers: config?.workers ?? 2,
	});
}

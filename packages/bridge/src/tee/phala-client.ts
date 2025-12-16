/**
 * Phala TEE Client
 *
 * Real implementation using Phala Network's TEE infrastructure.
 * Phala uses Intel TDX/SGX for secure enclaves with remote attestation.
 *
 * Features:
 * - Remote attestation via Phala's attestation service
 * - Secure key generation inside enclave
 * - Signed batch attestations for ZK proofs
 */

import type { Hex } from "viem";
import { bytesToHex, keccak256, toBytes } from "viem";
import type {
	CrossChainTransfer,
	Hash32,
	TEEAttestation,
} from "../types/index.js";
import { toHash32 } from "../types/index.js";

// =============================================================================
// TYPES
// =============================================================================

export interface PhalaConfig {
	/** Phala TEE endpoint URL */
	endpoint: string;
	/** API key for Phala (optional if using wallet auth) */
	apiKey?: string;
	/** Timeout for attestation requests in ms */
	timeoutMs?: number;
	/** Use mock attestation for local development */
	useMock?: boolean;
}

export interface PhalaAttestationRequest {
	/** Data to attest (batch hash, transfer IDs, etc.) */
	data: Hex;
	/** Operator's ethereum address */
	operatorAddress: Hex;
	/** Optional nonce for replay protection */
	nonce?: bigint;
}

export interface PhalaAttestationResponse {
	/** The attestation quote from Phala's TEE */
	quote: Uint8Array;
	/** Measurement hash of the enclave code */
	mrEnclave: Hex;
	/** Report data containing the attested data hash */
	reportData: Hex;
	/** Signature from the TEE */
	signature: Hex;
	/** Timestamp when attestation was generated */
	timestamp: number;
	/** Enclave ID for verification */
	enclaveId: string;
}

export interface PhalaBatchAttestation {
	/** Unique batch identifier */
	batchId: Hash32;
	/** Merkle root of all transfer IDs in batch */
	transfersRoot: Hash32;
	/** Number of transfers in batch */
	transferCount: number;
	/** TEE attestation */
	attestation: PhalaAttestationResponse;
	/** Chain of custody proof */
	chainOfCustody: Hex[];
}

// =============================================================================
// PHALA CLIENT
// =============================================================================

export class PhalaClient {
	private config: PhalaConfig;
	private initialized: boolean = false;
	private enclavePublicKey: Uint8Array | null = null;

	constructor(config: PhalaConfig) {
		this.config = {
			timeoutMs: 30000,
			useMock: false,
			...config,
		};
	}

	/**
	 * Initialize the Phala TEE connection
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		if (this.config.useMock) {
			console.log("[Phala] Initialized in mock mode");
			this.enclavePublicKey = new Uint8Array(33);
			crypto.getRandomValues(this.enclavePublicKey);
			this.enclavePublicKey[0] = 0x02;
			this.initialized = true;
			return;
		}

		// Verify Phala endpoint is reachable
		try {
			const response = await fetch(`${this.config.endpoint}/health`, {
				method: "GET",
				signal: AbortSignal.timeout(this.config.timeoutMs ?? 30000),
			});

			if (!response.ok) {
				throw new Error(`Phala endpoint returned ${response.status}`);
			}

			const healthData = (await response.json()) as {
				enclave_id?: string;
				public_key?: string;
			};
			console.log(
				`[Phala] Connected to TEE enclave: ${healthData.enclave_id ?? "unknown"}`,
			);

			if (healthData.public_key) {
				this.enclavePublicKey = Buffer.from(healthData.public_key, "hex");
			}

			this.initialized = true;
		} catch (error) {
			throw new Error(
				`Failed to connect to Phala: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	/**
	 * Request attestation for arbitrary data
	 */
	async requestAttestation(
		request: PhalaAttestationRequest,
	): Promise<PhalaAttestationResponse> {
		if (!this.initialized) {
			await this.initialize();
		}

		if (this.config.useMock) {
			return this.generateMockAttestation(request);
		}

		const payload = {
			data: request.data,
			operator_address: request.operatorAddress,
			nonce: request.nonce?.toString() ?? Date.now().toString(),
		};

		const response = await fetch(`${this.config.endpoint}/attestation`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(this.config.apiKey ? { "X-API-Key": this.config.apiKey } : {}),
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(this.config.timeoutMs ?? 30000),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Phala attestation failed: ${response.status} - ${errorText}`,
			);
		}

		const attestationData = (await response.json()) as {
			quote: string;
			mr_enclave: string;
			report_data: string;
			signature: string;
			timestamp: number;
			enclave_id: string;
		};

		return {
			quote: Buffer.from(attestationData.quote, "hex"),
			mrEnclave: attestationData.mr_enclave as Hex,
			reportData: attestationData.report_data as Hex,
			signature: attestationData.signature as Hex,
			timestamp: attestationData.timestamp,
			enclaveId: attestationData.enclave_id,
		};
	}

	/**
	 * Create an attestation for a batch of transfers
	 */
	async attestBatch(
		batchId: Hash32,
		transfers: CrossChainTransfer[],
		operatorAddress: Hex,
	): Promise<PhalaBatchAttestation> {
		// Compute merkle root of transfer IDs
		const transferIds = transfers.map((t) => t.transferId);
		const transfersRoot = this.computeMerkleRoot(transferIds);

		// Build data to attest
		const attestData = keccak256(
			new Uint8Array([
				...batchId,
				...transfersRoot,
				...toBytes(BigInt(transfers.length)),
			]),
		);

		// Request attestation from Phala TEE
		const attestation = await this.requestAttestation({
			data: attestData,
			operatorAddress,
			nonce: BigInt(Date.now()),
		});

		// Build chain of custody
		const chainOfCustody = transferIds.map((id) => bytesToHex(id) as Hex);

		return {
			batchId,
			transfersRoot,
			transferCount: transfers.length,
			attestation,
			chainOfCustody,
		};
	}

	/**
	 * Verify an attestation is valid
	 */
	async verifyAttestation(attestation: PhalaAttestationResponse): Promise<{
		valid: boolean;
		errors: string[];
	}> {
		const errors: string[] = [];

		// Check timestamp freshness (max 1 hour)
		const maxAge = 60 * 60 * 1000;
		if (Date.now() - attestation.timestamp > maxAge) {
			errors.push("Attestation is stale (> 1 hour old)");
		}

		// Check quote length
		if (attestation.quote.length < 256) {
			errors.push("Attestation quote is too short");
		}

		if (this.config.useMock) {
			return { valid: errors.length === 0, errors };
		}

		// For production, verify against Phala's verification service
		try {
			const response = await fetch(`${this.config.endpoint}/verify`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					quote: Buffer.from(attestation.quote).toString("hex"),
					mr_enclave: attestation.mrEnclave,
					report_data: attestation.reportData,
					signature: attestation.signature,
				}),
				signal: AbortSignal.timeout(this.config.timeoutMs ?? 30000),
			});

			if (!response.ok) {
				errors.push(`Verification service returned ${response.status}`);
			} else {
				const result = (await response.json()) as {
					valid: boolean;
					error?: string;
				};
				if (!result.valid) {
					errors.push(result.error ?? "Attestation verification failed");
				}
			}
		} catch (error) {
			errors.push(
				`Verification failed: ${error instanceof Error ? error.message : "Unknown"}`,
			);
		}

		return { valid: errors.length === 0, errors };
	}

	/**
	 * Convert attestation to format used by batcher
	 */
	toTEEAttestation(attestation: PhalaAttestationResponse): TEEAttestation {
		return {
			measurement: toHash32(
				attestation.mrEnclave.startsWith("0x")
					? Buffer.from(attestation.mrEnclave.slice(2), "hex")
					: Buffer.from(attestation.mrEnclave, "hex"),
			),
			quote: attestation.quote,
			publicKey: this.enclavePublicKey ?? new Uint8Array(33),
			timestamp: BigInt(attestation.timestamp),
		};
	}

	// =============================================================================
	// PRIVATE METHODS
	// =============================================================================

	private generateMockAttestation(
		request: PhalaAttestationRequest,
	): PhalaAttestationResponse {
		const timestamp = Date.now();

		// Generate mock measurement
		const mrEnclave = keccak256(
			new Uint8Array([...toBytes(request.data), ...toBytes(BigInt(timestamp))]),
		);

		// Generate mock quote
		const quote = new Uint8Array(256);
		crypto.getRandomValues(quote);

		// Generate mock signature
		const signature = keccak256(
			new Uint8Array([
				...Buffer.from(mrEnclave.slice(2), "hex"),
				...Buffer.from(request.operatorAddress.slice(2), "hex"),
				...toBytes(BigInt(timestamp)),
			]),
		);

		return {
			quote,
			mrEnclave,
			reportData: request.data,
			signature,
			timestamp,
			enclaveId: `mock-enclave-${timestamp.toString(36)}`,
		};
	}

	private computeMerkleRoot(leaves: Hash32[]): Hash32 {
		if (leaves.length === 0) {
			return toHash32(new Uint8Array(32));
		}

		if (leaves.length === 1) {
			return leaves[0];
		}

		// Convert Hash32[] to Uint8Array[] for hashing
		let currentLevel: Uint8Array[] = leaves.map((h) => new Uint8Array(h));

		while (currentLevel.length > 1) {
			const nextLevel: Uint8Array[] = [];

			for (let i = 0; i < currentLevel.length; i += 2) {
				const left = currentLevel[i];
				const right = currentLevel[i + 1] ?? currentLevel[i];

				const combined = new Uint8Array(64);
				combined.set(left, 0);
				combined.set(right, 32);

				const hash = keccak256(combined);
				nextLevel.push(Buffer.from(hash.slice(2), "hex"));
			}

			currentLevel = nextLevel;
		}

		return toHash32(currentLevel[0]);
	}
}

// =============================================================================
// FACTORY
// =============================================================================

export function createPhalaClient(config?: Partial<PhalaConfig>): PhalaClient {
	const endpoint = config?.endpoint ?? process.env.PHALA_ENDPOINT;

	if (!endpoint) {
		console.warn("[Phala] PHALA_ENDPOINT not set, using mock mode");
	}

	return new PhalaClient({
		endpoint: endpoint ?? "http://localhost:8000",
		apiKey: config?.apiKey ?? process.env.PHALA_API_KEY,
		useMock: !endpoint || config?.useMock,
		timeoutMs: config?.timeoutMs ?? 30000,
	});
}

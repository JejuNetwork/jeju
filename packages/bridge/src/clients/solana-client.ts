/**
 * Solana Client for Cross-Chain Bridge
 */

import { keccak_256 } from "@noble/hashes/sha3";
import {
	type Commitment,
	Connection,
	type Keypair,
	PublicKey,
	SystemProgram,
	sendAndConfirmTransaction,
	Transaction,
	TransactionInstruction,
} from "@solana/web3.js";
import type { ChainId, Hash32 } from "../types/index.js";
import { TransferStatus, toHash32 } from "../types/index.js";

// SPL Token constants (avoiding dependency on @solana/spl-token)
const TOKEN_PROGRAM_ID = new PublicKey(
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
	"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

async function getAssociatedTokenAddress(
	mint: PublicKey,
	owner: PublicKey,
): Promise<PublicKey> {
	const [address] = PublicKey.findProgramAddressSync(
		[owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
		ASSOCIATED_TOKEN_PROGRAM_ID,
	);
	return address;
}

function createAssociatedTokenAccountInstruction(
	payer: PublicKey,
	associatedToken: PublicKey,
	owner: PublicKey,
	mint: PublicKey,
): TransactionInstruction {
	return new TransactionInstruction({
		programId: ASSOCIATED_TOKEN_PROGRAM_ID,
		keys: [
			{ pubkey: payer, isSigner: true, isWritable: true },
			{ pubkey: associatedToken, isSigner: false, isWritable: true },
			{ pubkey: owner, isSigner: false, isWritable: false },
			{ pubkey: mint, isSigner: false, isWritable: false },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
		],
		data: Buffer.alloc(0),
	});
}

interface TokenAccountInfo {
	amount: bigint;
}

async function getAccount(
	connection: Connection,
	address: PublicKey,
): Promise<TokenAccountInfo> {
	const info = await connection.getAccountInfo(address);
	if (!info) {
		throw new Error("Account not found");
	}
	// Parse SPL token account data (simplified)
	const amount = info.data.readBigUInt64LE(64);
	return { amount };
}

const INSTRUCTION_DISCRIMINATORS = {
	INITIATE_TRANSFER: Buffer.from([0x01]),
	COMPLETE_TRANSFER: Buffer.from([0x02]),
	UPDATE_LIGHT_CLIENT: Buffer.from([0x03]),
	REGISTER_TOKEN: Buffer.from([0x04]),
};

export interface SolanaClientConfig {
	rpcUrl: string;
	commitment: Commitment;
	keypair?: Keypair;
	bridgeProgramId: PublicKey;
	evmLightClientProgramId: PublicKey;
}

export interface TransferResult {
	transferId: Hash32;
	signature: string;
	status: (typeof TransferStatus)[keyof typeof TransferStatus];
}

export class SolanaClient {
	private config: SolanaClientConfig;
	private connection: Connection;
	private keypair: Keypair | null = null;

	constructor(config: SolanaClientConfig) {
		this.config = config;
		this.connection = new Connection(config.rpcUrl, config.commitment);

		if (config.keypair) {
			this.keypair = config.keypair;
		}
	}

	async initiateTransfer(params: {
		mint: PublicKey;
		recipient: Uint8Array; // 20-byte EVM address (padded to 32)
		amount: bigint;
		destChainId: ChainId;
		payload?: Uint8Array;
	}): Promise<TransferResult> {
		if (!this.keypair) {
			throw new Error("Keypair not configured");
		}

		// Get token accounts
		const sourceTokenAccount = await getAssociatedTokenAddress(
			params.mint,
			this.keypair.publicKey,
		);

		// Derive bridge accounts
		const [bridgeState] = PublicKey.findProgramAddressSync(
			[Buffer.from("bridge_state")],
			this.config.bridgeProgramId,
		);

		const [bridgeTokenAccount] = PublicKey.findProgramAddressSync(
			[Buffer.from("bridge_token"), params.mint.toBuffer()],
			this.config.bridgeProgramId,
		);

		// Generate transfer ID
		const transferId = this.generateTransferId(
			this.keypair.publicKey,
			params.recipient,
			params.amount,
			params.destChainId,
		);

		const [transferState] = PublicKey.findProgramAddressSync(
			[Buffer.from("transfer"), transferId],
			this.config.bridgeProgramId,
		);

		// Build instruction data
		const data = this.encodeInitiateTransfer({
			recipient: params.recipient,
			amount: params.amount,
			destChainId: params.destChainId,
			payload: params.payload ?? new Uint8Array(0),
		});

		// Create instruction
		const instruction = new TransactionInstruction({
			programId: this.config.bridgeProgramId,
			keys: [
				{ pubkey: this.keypair.publicKey, isSigner: true, isWritable: true },
				{ pubkey: sourceTokenAccount, isSigner: false, isWritable: true },
				{ pubkey: bridgeTokenAccount, isSigner: false, isWritable: true },
				{ pubkey: bridgeState, isSigner: false, isWritable: true },
				{ pubkey: transferState, isSigner: false, isWritable: true },
				{ pubkey: params.mint, isSigner: false, isWritable: false },
				{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
				{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			],
			data,
		});

		// Send transaction
		const transaction = new Transaction().add(instruction);
		const signature = await sendAndConfirmTransaction(
			this.connection,
			transaction,
			[this.keypair],
		);

		return {
			transferId: toHash32(transferId),
			signature,
			status: TransferStatus.PENDING,
		};
	}

	/**
	 * Complete a transfer from EVM
	 */
	async completeTransfer(params: {
		transferId: Hash32;
		mint: PublicKey;
		sender: Uint8Array;
		recipient: PublicKey;
		amount: bigint;
		evmBlockNumber: bigint;
		proof: Uint8Array;
		publicInputs: Uint8Array;
	}): Promise<string> {
		if (!this.keypair) {
			throw new Error("Keypair not configured");
		}

		// Get token accounts
		const destTokenAccount = await getAssociatedTokenAddress(
			params.mint,
			params.recipient,
		);

		// Check if ATA exists, create if not
		try {
			await getAccount(this.connection, destTokenAccount);
		} catch {
			const createATAIx = createAssociatedTokenAccountInstruction(
				this.keypair.publicKey,
				destTokenAccount,
				params.recipient,
				params.mint,
			);
			const tx = new Transaction().add(createATAIx);
			await sendAndConfirmTransaction(this.connection, tx, [this.keypair]);
		}

		// Derive accounts
		const [bridgeState] = PublicKey.findProgramAddressSync(
			[Buffer.from("bridge_state")],
			this.config.bridgeProgramId,
		);

		const [bridgeTokenAccount] = PublicKey.findProgramAddressSync(
			[Buffer.from("bridge_token"), params.mint.toBuffer()],
			this.config.bridgeProgramId,
		);

		const [evmLightClientState] = PublicKey.findProgramAddressSync(
			[Buffer.from("evm_light_client")],
			this.config.evmLightClientProgramId,
		);

		const [transferState] = PublicKey.findProgramAddressSync(
			[Buffer.from("transfer"), params.transferId],
			this.config.bridgeProgramId,
		);

		// Build instruction data
		const data = this.encodeCompleteTransfer({
			transferId: params.transferId,
			sender: params.sender,
			amount: params.amount,
			evmBlockNumber: params.evmBlockNumber,
			proof: params.proof,
			publicInputs: params.publicInputs,
		});

		// Create instruction
		const instruction = new TransactionInstruction({
			programId: this.config.bridgeProgramId,
			keys: [
				{ pubkey: this.keypair.publicKey, isSigner: true, isWritable: true },
				{ pubkey: destTokenAccount, isSigner: false, isWritable: true },
				{ pubkey: bridgeTokenAccount, isSigner: false, isWritable: true },
				{ pubkey: bridgeState, isSigner: false, isWritable: true },
				{ pubkey: transferState, isSigner: false, isWritable: true },
				{ pubkey: evmLightClientState, isSigner: false, isWritable: false },
				{ pubkey: params.mint, isSigner: false, isWritable: false },
				{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
				{
					pubkey: this.config.evmLightClientProgramId,
					isSigner: false,
					isWritable: false,
				},
			],
			data,
		});

		// Send transaction
		const transaction = new Transaction().add(instruction);
		const signature = await sendAndConfirmTransaction(
			this.connection,
			transaction,
			[this.keypair],
		);

		return signature;
	}

	// =============================================================================
	// QUERY OPERATIONS
	// =============================================================================

	/**
	 * Get token balance
	 */
	async getTokenBalance(mint: PublicKey, owner?: PublicKey): Promise<bigint> {
		const ownerPubkey = owner ?? this.keypair?.publicKey;
		if (!ownerPubkey) {
			throw new Error("No owner specified");
		}

		const tokenAccount = await getAssociatedTokenAddress(mint, ownerPubkey);

		try {
			const account = await getAccount(this.connection, tokenAccount);
			return account.amount;
		} catch {
			// Account doesn't exist or is not initialized - return 0 balance
			// This is expected behavior for tokens the user has never held
			return BigInt(0);
		}
	}

	/**
	 * Get latest slot
	 */
	async getLatestSlot(): Promise<bigint> {
		const slot = await this.connection.getSlot();
		return BigInt(slot);
	}

	/**
	 * Get latest block hash
	 */
	async getLatestBlockhash(): Promise<string> {
		const { blockhash } = await this.connection.getLatestBlockhash();
		return blockhash;
	}

	/**
	 * Get EVM light client state
	 */
	async getEVMLightClientState(): Promise<{
		latestBlock: bigint;
		stateRoot: Uint8Array;
		syncCommitteeRoot: Uint8Array;
	}> {
		const [evmLightClientState] = PublicKey.findProgramAddressSync(
			[Buffer.from("evm_light_client")],
			this.config.evmLightClientProgramId,
		);

		const accountInfo =
			await this.connection.getAccountInfo(evmLightClientState);
		if (!accountInfo) {
			throw new Error("EVM light client not initialized");
		}

		// Parse account data
		// Layout: [8 bytes discriminator][8 bytes latest_block][32 bytes state_root][32 bytes sync_committee_root]
		const data = accountInfo.data;
		const latestBlock = data.readBigUInt64LE(8);
		const stateRoot = data.slice(16, 48);
		const syncCommitteeRoot = data.slice(48, 80);

		return {
			latestBlock,
			stateRoot: new Uint8Array(stateRoot),
			syncCommitteeRoot: new Uint8Array(syncCommitteeRoot),
		};
	}

	// =============================================================================
	// PRIVATE METHODS
	// =============================================================================

	private generateTransferId(
		sender: PublicKey,
		recipient: Uint8Array,
		amount: bigint,
		destChainId: ChainId,
	): Uint8Array {
		const data = Buffer.concat([
			sender.toBuffer(),
			Buffer.from(recipient),
			Buffer.from(amount.toString()),
			Buffer.from(destChainId.toString()),
			Buffer.from(Date.now().toString()),
		]);

		// Use keccak256 for cryptographically secure transfer ID generation
		return keccak_256(data);
	}

	private encodeInitiateTransfer(params: {
		recipient: Uint8Array;
		amount: bigint;
		destChainId: ChainId;
		payload: Uint8Array;
	}): Buffer {
		const recipientBuffer = Buffer.from(params.recipient);
		const amountBuffer = Buffer.alloc(8);
		amountBuffer.writeBigUInt64LE(params.amount);
		const destChainBuffer = Buffer.alloc(4);
		destChainBuffer.writeUInt32LE(params.destChainId);
		const payloadLenBuffer = Buffer.alloc(4);
		payloadLenBuffer.writeUInt32LE(params.payload.length);

		return Buffer.concat([
			INSTRUCTION_DISCRIMINATORS.INITIATE_TRANSFER,
			recipientBuffer,
			amountBuffer,
			destChainBuffer,
			payloadLenBuffer,
			Buffer.from(params.payload),
		]);
	}

	private encodeCompleteTransfer(params: {
		transferId: Uint8Array;
		sender: Uint8Array;
		amount: bigint;
		evmBlockNumber: bigint;
		proof: Uint8Array;
		publicInputs: Uint8Array;
	}): Buffer {
		const amountBuffer = Buffer.alloc(8);
		amountBuffer.writeBigUInt64LE(params.amount);
		const blockBuffer = Buffer.alloc(8);
		blockBuffer.writeBigUInt64LE(params.evmBlockNumber);
		const proofLenBuffer = Buffer.alloc(4);
		proofLenBuffer.writeUInt32LE(params.proof.length);
		const inputsLenBuffer = Buffer.alloc(4);
		inputsLenBuffer.writeUInt32LE(params.publicInputs.length);

		return Buffer.concat([
			INSTRUCTION_DISCRIMINATORS.COMPLETE_TRANSFER,
			Buffer.from(params.transferId),
			Buffer.from(params.sender),
			amountBuffer,
			blockBuffer,
			proofLenBuffer,
			Buffer.from(params.proof),
			inputsLenBuffer,
			Buffer.from(params.publicInputs),
		]);
	}

	// =============================================================================
	// UTILITIES
	// =============================================================================

	/**
	 * Get the configured public key
	 */
	getPublicKey(): PublicKey | null {
		return this.keypair?.publicKey ?? null;
	}

	/**
	 * Get the connection
	 */
	getConnection(): Connection {
		return this.connection;
	}

	/**
	 * Send an instruction as a transaction
	 */
	async sendInstruction(instruction: TransactionInstruction): Promise<string> {
		if (!this.keypair) {
			throw new Error("Keypair not configured");
		}

		const transaction = new Transaction().add(instruction);
		const signature = await sendAndConfirmTransaction(
			this.connection,
			transaction,
			[this.keypair],
		);

		return signature;
	}
}

export function createSolanaClient(config: SolanaClientConfig): SolanaClient {
	return new SolanaClient(config);
}

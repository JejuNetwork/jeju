/**
 * EVM Light Client SDK
 *
 * TypeScript client for the EVM Light Client on Solana.
 * Enables verification of Ethereum consensus and state proofs.
 */

import {
  type Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'

// NOTE: This must match the program ID in Anchor.toml
export const EVM_LIGHT_CLIENT_PROGRAM_ID = new PublicKey(
  '5TMUr2vv5TAUhKo4q8ibfkkw9SeBRzumYaRNo1iWvwsX',
)

const STATE_SEED = Buffer.from('evm_light_client')

// Groth16 proof size (256 bytes: 2x G1 + 1x G2)
export const GROTH16_PROOF_SIZE = 256

export interface LightClientState {
  admin: PublicKey
  latestSlot: bigint
  latestBlockRoot: Uint8Array
  latestStateRoot: Uint8Array
  currentSyncCommitteeRoot: Uint8Array
  nextSyncCommitteeRoot: Uint8Array
  updateCount: bigint
  initialized: boolean
}

export interface LatestState {
  slot: bigint
  blockRoot: Uint8Array
  stateRoot: Uint8Array
  syncCommitteeRoot: Uint8Array
}

export interface InitializeParams {
  genesisSlot: bigint
  genesisBlockRoot: Uint8Array
  genesisStateRoot: Uint8Array
  syncCommitteeRoot: Uint8Array
}

export interface UpdateStateParams {
  newSlot: bigint
  newBlockRoot: Uint8Array
  newStateRoot: Uint8Array
  newSyncCommitteeRoot?: Uint8Array
  proof: Uint8Array
  publicInputs: Uint8Array
}

export interface VerifyProofParams {
  account: Uint8Array
  storageSlot: Uint8Array
  expectedValue: Uint8Array
  proofData: Uint8Array
}

export class EVMLightClientClient {
  private connection: Connection
  private programId: PublicKey

  constructor(connection: Connection, programId?: PublicKey) {
    this.connection = connection
    this.programId = programId ?? EVM_LIGHT_CLIENT_PROGRAM_ID
  }

  getStatePDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([STATE_SEED], this.programId)
  }

  async getState(): Promise<LightClientState | null> {
    const [statePDA] = this.getStatePDA()
    const accountInfo = await this.connection.getAccountInfo(statePDA)
    if (!accountInfo) return null
    return this.deserializeState(accountInfo.data)
  }

  async getLatestState(): Promise<LatestState | null> {
    const state = await this.getState()
    if (!state) return null

    return {
      slot: state.latestSlot,
      blockRoot: state.latestBlockRoot,
      stateRoot: state.latestStateRoot,
      syncCommitteeRoot: state.currentSyncCommitteeRoot,
    }
  }

  async isInitialized(): Promise<boolean> {
    const state = await this.getState()
    if (!state) {
      return false
    }
    return state.initialized
  }

  async initializeInstructions(
    params: InitializeParams,
    admin: PublicKey,
  ): Promise<TransactionInstruction[]> {
    const [statePDA] = this.getStatePDA()

    const data = this.buildInitializeData(params)

    return [
      new TransactionInstruction({
        keys: [
          { pubkey: statePDA, isSigner: false, isWritable: true },
          { pubkey: admin, isSigner: true, isWritable: true },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        programId: this.programId,
        data,
      }),
    ]
  }

  async updateStateInstructions(
    params: UpdateStateParams,
    relayer: PublicKey,
  ): Promise<TransactionInstruction[]> {
    const [statePDA] = this.getStatePDA()

    const data = this.buildUpdateStateData(params)

    return [
      new TransactionInstruction({
        keys: [
          { pubkey: statePDA, isSigner: false, isWritable: true },
          { pubkey: relayer, isSigner: true, isWritable: false },
        ],
        programId: this.programId,
        data,
      }),
    ]
  }

  async verifyProofInstructions(
    params: VerifyProofParams,
  ): Promise<TransactionInstruction[]> {
    const [statePDA] = this.getStatePDA()

    const data = this.buildVerifyProofData(params)

    return [
      new TransactionInstruction({
        keys: [{ pubkey: statePDA, isSigner: false, isWritable: false }],
        programId: this.programId,
        data,
      }),
    ]
  }

  /**
   * Serialize proof nodes into the format expected by the program
   * Format: [num_nodes: u16][node1_len: u16][node1_data][node2_len: u16][node2_data]...
   */
  serializeProofNodes(nodes: Uint8Array[]): Uint8Array {
    let totalSize = 2 // num_nodes
    for (const node of nodes) {
      totalSize += 2 + node.length // length prefix + data
    }

    const result = new Uint8Array(totalSize)
    const view = new DataView(result.buffer)

    view.setUint16(0, nodes.length, true)
    let offset = 2

    for (const node of nodes) {
      view.setUint16(offset, node.length, true)
      offset += 2
      result.set(node, offset)
      offset += node.length
    }

    return result
  }

  private buildInitializeData(params: InitializeParams): Buffer {
    // Discriminator (8 bytes) + genesisSlot (8) + genesisBlockRoot (32) + genesisStateRoot (32) + syncCommitteeRoot (32)
    const data = Buffer.alloc(8 + 8 + 32 + 32 + 32)
    let offset = 0

    // Discriminator for initialize
    Buffer.from([0xaf, 0xaf, 0x6d, 0x1f, 0x0d, 0x98, 0x9b, 0xed]).copy(
      data,
      offset,
    )
    offset += 8

    data.writeBigUInt64LE(params.genesisSlot, offset)
    offset += 8

    Buffer.from(params.genesisBlockRoot).copy(data, offset)
    offset += 32

    Buffer.from(params.genesisStateRoot).copy(data, offset)
    offset += 32

    Buffer.from(params.syncCommitteeRoot).copy(data, offset)

    return data
  }

  private buildUpdateStateData(params: UpdateStateParams): Buffer {
    const hasNewCommittee = params.newSyncCommitteeRoot !== undefined

    // Discriminator (8) + newSlot (8) + newBlockRoot (32) + newStateRoot (32) +
    // option flag (1) + [newSyncCommitteeRoot (32)] + proof (256) + publicInputs length (4) + publicInputs
    const dataSize =
      8 +
      8 +
      32 +
      32 +
      1 +
      (hasNewCommittee ? 32 : 0) +
      GROTH16_PROOF_SIZE +
      4 +
      params.publicInputs.length
    const data = Buffer.alloc(dataSize)
    let offset = 0

    // Discriminator for update_state
    Buffer.from([0xc9, 0x5e, 0x7e, 0x1f, 0x08, 0x73, 0x1a, 0x2d]).copy(
      data,
      offset,
    )
    offset += 8

    data.writeBigUInt64LE(params.newSlot, offset)
    offset += 8

    Buffer.from(params.newBlockRoot).copy(data, offset)
    offset += 32

    Buffer.from(params.newStateRoot).copy(data, offset)
    offset += 32

    // Option flag and optional sync committee root
    if (hasNewCommittee && params.newSyncCommitteeRoot) {
      data.writeUInt8(1, offset)
      offset += 1
      Buffer.from(params.newSyncCommitteeRoot).copy(data, offset)
      offset += 32
    } else {
      data.writeUInt8(0, offset)
      offset += 1
    }

    // Proof
    Buffer.from(params.proof).copy(data, offset)
    offset += GROTH16_PROOF_SIZE

    // Public inputs (as Vec<u8>)
    data.writeUInt32LE(params.publicInputs.length, offset)
    offset += 4
    Buffer.from(params.publicInputs).copy(data, offset)

    return data
  }

  private buildVerifyProofData(params: VerifyProofParams): Buffer {
    // Discriminator (8) + account (20) + storageSlot (32) + expectedValue (32) + proofData length (4) + proofData
    const dataSize = 8 + 20 + 32 + 32 + 4 + params.proofData.length
    const data = Buffer.alloc(dataSize)
    let offset = 0

    // Discriminator for verify_account_proof
    Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]).copy(
      data,
      offset,
    )
    offset += 8

    Buffer.from(params.account).copy(data, offset)
    offset += 20

    Buffer.from(params.storageSlot).copy(data, offset)
    offset += 32

    Buffer.from(params.expectedValue).copy(data, offset)
    offset += 32

    data.writeUInt32LE(params.proofData.length, offset)
    offset += 4
    Buffer.from(params.proofData).copy(data, offset)

    return data
  }

  private deserializeState(data: Buffer): LightClientState {
    let offset = 8 // Skip discriminator

    const admin = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const latestSlot = data.readBigUInt64LE(offset)
    offset += 8

    const latestBlockRoot = new Uint8Array(data.subarray(offset, offset + 32))
    offset += 32

    const latestStateRoot = new Uint8Array(data.subarray(offset, offset + 32))
    offset += 32

    const currentSyncCommitteeRoot = new Uint8Array(
      data.subarray(offset, offset + 32),
    )
    offset += 32

    const nextSyncCommitteeRoot = new Uint8Array(
      data.subarray(offset, offset + 32),
    )
    offset += 32

    const updateCount = data.readBigUInt64LE(offset)
    offset += 8

    const initialized = data.readUInt8(offset) === 1

    return {
      admin,
      latestSlot,
      latestBlockRoot,
      latestStateRoot,
      currentSyncCommitteeRoot,
      nextSyncCommitteeRoot,
      updateCount,
      initialized,
    }
  }
}

export function createEVMLightClientClient(
  connection: Connection,
  programId?: PublicKey,
): EVMLightClientClient {
  return new EVMLightClientClient(connection, programId)
}

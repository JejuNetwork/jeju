import { describe, expect, it } from 'bun:test'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import {
  createEVMLightClientClient,
  EVM_LIGHT_CLIENT_PROGRAM_ID,
  EVMLightClientClient,
  GROTH16_PROOF_SIZE,
} from '../light-client'

const connection = new Connection('https://api.devnet.solana.com')

describe('EVMLightClientClient', () => {
  describe('instantiation', () => {
    it('creates client with default program ID', () => {
      const client = createEVMLightClientClient(connection)
      expect(client).toBeInstanceOf(EVMLightClientClient)
    })

    it('creates client with custom program ID', () => {
      const customProgramId = Keypair.generate().publicKey
      const client = createEVMLightClientClient(connection, customProgramId)
      expect(client).toBeInstanceOf(EVMLightClientClient)
    })
  })

  describe('PDA derivation', () => {
    const client = createEVMLightClientClient(connection)

    it('derives state PDA deterministically', () => {
      const [pda1, bump1] = client.getStatePDA()
      const [pda2, bump2] = client.getStatePDA()

      expect(pda1.equals(pda2)).toBe(true)
      expect(bump1).toBe(bump2)
      expect(bump1).toBeGreaterThanOrEqual(0)
      expect(bump1).toBeLessThanOrEqual(255)
    })
  })

  describe('constants', () => {
    it('exports EVM_LIGHT_CLIENT_PROGRAM_ID', () => {
      expect(EVM_LIGHT_CLIENT_PROGRAM_ID).toBeDefined()
      expect(EVM_LIGHT_CLIENT_PROGRAM_ID).toBeInstanceOf(PublicKey)
    })

    it('exports correct GROTH16_PROOF_SIZE', () => {
      // Groth16 proof = 2 G1 points (64 bytes each) + 1 G2 point (128 bytes) = 256 bytes
      expect(GROTH16_PROOF_SIZE).toBe(256)
    })
  })
})

describe('Proof node serialization', () => {
  const client = createEVMLightClientClient(connection)

  describe('serializeProofNodes', () => {
    it('serializes empty array correctly', () => {
      const serialized = client.serializeProofNodes([])

      expect(serialized.length).toBe(2) // Just the count
      expect(serialized[0]).toBe(0)
      expect(serialized[1]).toBe(0)
    })

    it('serializes single node correctly', () => {
      const node = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
      const serialized = client.serializeProofNodes([node])

      // 2 (count) + 2 (length) + 4 (data) = 8 bytes
      expect(serialized.length).toBe(8)

      // Check count (1 in little-endian)
      expect(serialized[0]).toBe(1)
      expect(serialized[1]).toBe(0)

      // Check length (4 in little-endian)
      expect(serialized[2]).toBe(4)
      expect(serialized[3]).toBe(0)

      // Check data
      expect(serialized[4]).toBe(0xde)
      expect(serialized[5]).toBe(0xad)
      expect(serialized[6]).toBe(0xbe)
      expect(serialized[7]).toBe(0xef)
    })

    it('serializes multiple nodes correctly', () => {
      const nodes = [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6, 7]),
        new Uint8Array([8, 9]),
      ]

      const serialized = client.serializeProofNodes(nodes)

      // 2 (count) + 2 (len1) + 3 (data1) + 2 (len2) + 4 (data2) + 2 (len3) + 2 (data3) = 17 bytes
      expect(serialized.length).toBe(17)

      // Check count (3 in little-endian)
      expect(serialized[0]).toBe(3)
      expect(serialized[1]).toBe(0)
    })

    it('handles large nodes', () => {
      const largeNode = new Uint8Array(1000).fill(0xaa)
      const serialized = client.serializeProofNodes([largeNode])

      // 2 (count) + 2 (length) + 1000 (data) = 1004 bytes
      expect(serialized.length).toBe(1004)

      // Check length (1000 = 0x03E8 in little-endian)
      expect(serialized[2]).toBe(0xe8)
      expect(serialized[3]).toBe(0x03)
    })

    it('serializes RLP-encoded trie nodes', () => {
      // Simulate typical Merkle Patricia Trie node (RLP encoded)
      const branchNode = new Uint8Array(532) // Typical branch node size
      const leafNode = new Uint8Array(68) // Typical leaf node size

      const nodes = [branchNode, leafNode]
      const serialized = client.serializeProofNodes(nodes)

      // Verify structure
      const view = new DataView(serialized.buffer)
      expect(view.getUint16(0, true)).toBe(2) // Node count
      expect(view.getUint16(2, true)).toBe(532) // First node length
    })

    it('maintains order of nodes', () => {
      const nodes = [
        new Uint8Array([1]),
        new Uint8Array([2]),
        new Uint8Array([3]),
      ]

      const serialized = client.serializeProofNodes(nodes)

      // Data should be in order: 1, 2, 3
      expect(serialized[4]).toBe(1) // First node data
      expect(serialized[7]).toBe(2) // Second node data
      expect(serialized[10]).toBe(3) // Third node data
    })
  })
})

describe('Instruction data building', () => {
  const client = createEVMLightClientClient(connection)

  describe('initializeInstructions', () => {
    it('builds initialize instructions with correct accounts', async () => {
      const admin = Keypair.generate().publicKey
      const params = {
        genesisSlot: 1000000n,
        genesisBlockRoot: new Uint8Array(32).fill(0xaa),
        genesisStateRoot: new Uint8Array(32).fill(0xbb),
        syncCommitteeRoot: new Uint8Array(32).fill(0xcc),
      }

      const instructions = await client.initializeInstructions(params, admin)

      expect(instructions.length).toBe(1)
      expect(instructions[0].keys.length).toBe(3) // state, admin, system_program
      expect(instructions[0].keys[0].isWritable).toBe(true) // state is writable
      expect(instructions[0].keys[1].isSigner).toBe(true) // admin is signer
    })
  })

  describe('updateStateInstructions', () => {
    it('builds update instructions without new sync committee', async () => {
      const relayer = Keypair.generate().publicKey
      const params = {
        newSlot: 2000000n,
        newBlockRoot: new Uint8Array(32).fill(0xaa),
        newStateRoot: new Uint8Array(32).fill(0xbb),
        proof: new Uint8Array(GROTH16_PROOF_SIZE).fill(0x11),
        publicInputs: new Uint8Array(64).fill(0x22),
      }

      const instructions = await client.updateStateInstructions(params, relayer)

      expect(instructions.length).toBe(1)
      expect(instructions[0].keys.length).toBe(2) // state, relayer
    })

    it('builds update instructions with new sync committee', async () => {
      const relayer = Keypair.generate().publicKey
      const params = {
        newSlot: 2000000n,
        newBlockRoot: new Uint8Array(32).fill(0xaa),
        newStateRoot: new Uint8Array(32).fill(0xbb),
        newSyncCommitteeRoot: new Uint8Array(32).fill(0xcc),
        proof: new Uint8Array(GROTH16_PROOF_SIZE).fill(0x11),
        publicInputs: new Uint8Array(64).fill(0x22),
      }

      const instructions = await client.updateStateInstructions(params, relayer)

      expect(instructions.length).toBe(1)
      // Instruction data should be larger with sync committee
      expect(instructions[0].data.length).toBeGreaterThan(
        8 + 8 + 32 + 32 + 1 + GROTH16_PROOF_SIZE + 4, // Minimum size without sync committee
      )
    })
  })

  describe('verifyProofInstructions', () => {
    it('builds verify proof instructions', async () => {
      const params = {
        account: new Uint8Array(20).fill(0xaa),
        storageSlot: new Uint8Array(32).fill(0xbb),
        expectedValue: new Uint8Array(32).fill(0xcc),
        proofData: new Uint8Array(500).fill(0xdd),
      }

      const instructions = await client.verifyProofInstructions(params)

      expect(instructions.length).toBe(1)
      expect(instructions[0].keys.length).toBe(1) // Just state (read-only)
      expect(instructions[0].keys[0].isWritable).toBe(false)
    })
  })
})

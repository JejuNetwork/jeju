#!/usr/bin/env bun
/**
 * Fraud Proof Generator Tests
 *
 * Tests for the Cannon fraud proof generation system including:
 * - State fetching
 * - MIPS instruction encoding/decoding
 * - Proof generation and verification
 * - Bisection game logic
 * - Memory Merkle tree construction
 * - Preimage generation
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { concat, encodeAbiParameters, type Hex, keccak256, pad } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  CannonInterface,
  HEAP_START,
  MIPS_FUNCTS,
  MIPS_OPCODES,
  MIPS_REGISTERS,
  type MIPSState,
} from '../../../../packages/deployment/scripts/dispute/cannon-interface'
import { FraudProofGenerator } from '../../../../packages/deployment/scripts/dispute/proof-generator'
import {
  type AccountProof,
  L2_TO_L1_MESSAGE_PASSER,
  type L2StateSnapshot,
  StateFetcher,
} from '../../../../packages/deployment/scripts/dispute/state-fetcher'
import { TEST_ACCOUNTS } from '../../shared/utils'

// Test account from shared constants (Anvil defaults)
const TEST_PRIVATE_KEY = TEST_ACCOUNTS.deployer.privateKey
const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY)

// Mock L1 RPC (local anvil)
const L1_RPC = 'http://127.0.0.1:6545'

// Create mock L2 state snapshot for testing
function createMockSnapshot(blockNumber: bigint): L2StateSnapshot {
  const stateRoot = keccak256(
    encodeAbiParameters([{ type: 'uint256' }], [blockNumber]),
  )
  const blockHash = keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'uint256' }],
      ['block', blockNumber],
    ),
  )
  const messagePasserRoot = keccak256(
    encodeAbiParameters([{ type: 'string' }], ['mpr']),
  )

  const mockAccountProof: AccountProof = {
    address: L2_TO_L1_MESSAGE_PASSER,
    nonce: 0n,
    balance: 0n,
    storageHash: messagePasserRoot,
    codeHash: keccak256('0x'),
    accountProof: [
      keccak256(encodeAbiParameters([{ type: 'string' }], ['proof_node_1'])),
      keccak256(encodeAbiParameters([{ type: 'string' }], ['proof_node_2'])),
    ],
    storageProofs: [],
  }

  return {
    blockNumber,
    blockHash,
    stateRoot,
    timestamp: BigInt(Date.now()) / 1000n,
    messagePasserStorageRoot: messagePasserRoot,
    outputRoot: keccak256(
      concat([
        pad('0x00', { size: 32 }),
        stateRoot,
        messagePasserRoot,
        blockHash,
      ]),
    ),
    accountProofs: new Map([[L2_TO_L1_MESSAGE_PASSER, mockAccountProof]]),
  }
}

describe('CannonInterface', () => {
  let cannon: CannonInterface

  beforeAll(() => {
    cannon = new CannonInterface()
  })

  describe('MIPS Instruction Encoding', () => {
    test('encodes R-type ADD instruction', () => {
      // add $t2, $t0, $t1  (rd=10, rs=8, rt=9, funct=0x20)
      const instruction = cannon.encodeRType(
        MIPS_REGISTERS.T0,
        MIPS_REGISTERS.T1,
        MIPS_REGISTERS.T2,
        0,
        MIPS_FUNCTS.ADD,
      )

      expect(instruction).toBe(0x01095020)
    })

    test('encodes R-type SUB instruction', () => {
      // sub $t2, $t0, $t1  (rd=10, rs=8, rt=9, funct=0x22)
      const instruction = cannon.encodeRType(
        MIPS_REGISTERS.T0,
        MIPS_REGISTERS.T1,
        MIPS_REGISTERS.T2,
        0,
        MIPS_FUNCTS.SUB,
      )

      expect(instruction).toBe(0x01095022)
    })

    test('encodes I-type ADDI instruction', () => {
      // addi $t1, $t0, 100
      const instruction = cannon.encodeIType(
        MIPS_OPCODES.ADDI,
        MIPS_REGISTERS.T0,
        MIPS_REGISTERS.T1,
        100,
      )

      expect(instruction).toBe(0x21090064)
    })

    test('encodes I-type LW instruction', () => {
      // lw $t1, 0($t0)
      const instruction = cannon.encodeIType(
        MIPS_OPCODES.LW,
        MIPS_REGISTERS.T0,
        MIPS_REGISTERS.T1,
        0,
      )

      // Use unsigned comparison for 32-bit instruction encoding
      expect(instruction >>> 0).toBe(0x8d090000 >>> 0)
    })

    test('encodes J-type JUMP instruction', () => {
      // j 0x1000
      const instruction = cannon.encodeJType(MIPS_OPCODES.J, 0x1000)
      expect(instruction).toBe(0x08001000)
    })
  })

  describe('MIPS Instruction Decoding', () => {
    test('decodes ADD instruction', () => {
      const decoded = cannon.decodeInstruction(0x01095020)
      expect(decoded.opcode).toBe(0)
      expect(decoded.rs).toBe(MIPS_REGISTERS.T0)
      expect(decoded.rt).toBe(MIPS_REGISTERS.T1)
      expect(decoded.rd).toBe(MIPS_REGISTERS.T2)
      expect(decoded.funct).toBe(MIPS_FUNCTS.ADD)
    })

    test('decodes ADDI instruction', () => {
      const decoded = cannon.decodeInstruction(0x21090064)
      expect(decoded.opcode).toBe(MIPS_OPCODES.ADDI)
      expect(decoded.rs).toBe(MIPS_REGISTERS.T0)
      expect(decoded.rt).toBe(MIPS_REGISTERS.T1)
      expect(decoded.imm).toBe(100)
    })

    test('decodes LW instruction', () => {
      const decoded = cannon.decodeInstruction(0x8d090000)
      expect(decoded.opcode).toBe(MIPS_OPCODES.LW)
      expect(decoded.rs).toBe(MIPS_REGISTERS.T0)
      expect(decoded.rt).toBe(MIPS_REGISTERS.T1)
      expect(decoded.imm).toBe(0)
    })
  })

  describe('MIPS Execution', () => {
    test('executes ADD instruction', () => {
      const memory = new Map<number, number>()
      memory.set(
        0,
        cannon.encodeRType(
          MIPS_REGISTERS.T0,
          MIPS_REGISTERS.T1,
          MIPS_REGISTERS.T2,
          0,
          MIPS_FUNCTS.ADD,
        ),
      )

      const initialState: MIPSState = {
        memRoot: pad('0x00', { size: 32 }) as Hex,
        preimageKey: pad('0x00', { size: 32 }) as Hex,
        preimageOffset: 0,
        pc: 0,
        nextPC: 4,
        lo: 0,
        hi: 0,
        heap: 0x40000000,
        exitCode: 0,
        exited: false,
        step: 0n,
        registers: new Array(32).fill(0),
      }
      initialState.registers[MIPS_REGISTERS.T0] = 10
      initialState.registers[MIPS_REGISTERS.T1] = 20

      const { newState } = cannon.executeStep(initialState, memory, new Map())

      expect(newState.registers[MIPS_REGISTERS.T2]).toBe(30)
      expect(newState.pc).toBe(4)
      expect(newState.step).toBe(1n)
    })

    test('executes SUB instruction', () => {
      const memory = new Map<number, number>()
      memory.set(
        0,
        cannon.encodeRType(
          MIPS_REGISTERS.T0,
          MIPS_REGISTERS.T1,
          MIPS_REGISTERS.T2,
          0,
          MIPS_FUNCTS.SUB,
        ),
      )

      const initialState: MIPSState = {
        memRoot: pad('0x00', { size: 32 }) as Hex,
        preimageKey: pad('0x00', { size: 32 }) as Hex,
        preimageOffset: 0,
        pc: 0,
        nextPC: 4,
        lo: 0,
        hi: 0,
        heap: 0x40000000,
        exitCode: 0,
        exited: false,
        step: 0n,
        registers: new Array(32).fill(0),
      }
      initialState.registers[MIPS_REGISTERS.T0] = 100
      initialState.registers[MIPS_REGISTERS.T1] = 30

      const { newState } = cannon.executeStep(initialState, memory, new Map())

      expect(newState.registers[MIPS_REGISTERS.T2]).toBe(70)
    })

    test('executes ADDI instruction', () => {
      const memory = new Map<number, number>()
      memory.set(
        0,
        cannon.encodeIType(
          MIPS_OPCODES.ADDI,
          MIPS_REGISTERS.T0,
          MIPS_REGISTERS.T1,
          50,
        ),
      )

      const initialState: MIPSState = {
        memRoot: pad('0x00', { size: 32 }) as Hex,
        preimageKey: pad('0x00', { size: 32 }) as Hex,
        preimageOffset: 0,
        pc: 0,
        nextPC: 4,
        lo: 0,
        hi: 0,
        heap: 0x40000000,
        exitCode: 0,
        exited: false,
        step: 0n,
        registers: new Array(32).fill(0),
      }
      initialState.registers[MIPS_REGISTERS.T0] = 100

      const { newState } = cannon.executeStep(initialState, memory, new Map())

      expect(newState.registers[MIPS_REGISTERS.T1]).toBe(150)
    })

    test('executes LW instruction', () => {
      const memory = new Map<number, number>()
      memory.set(
        0,
        cannon.encodeIType(
          MIPS_OPCODES.LW,
          MIPS_REGISTERS.T0,
          MIPS_REGISTERS.T1,
          0,
        ),
      )
      memory.set(0x1000, 0xdeadbeef)

      const initialState: MIPSState = {
        memRoot: pad('0x00', { size: 32 }) as Hex,
        preimageKey: pad('0x00', { size: 32 }) as Hex,
        preimageOffset: 0,
        pc: 0,
        nextPC: 4,
        lo: 0,
        hi: 0,
        heap: 0x40000000,
        exitCode: 0,
        exited: false,
        step: 0n,
        registers: new Array(32).fill(0),
      }
      initialState.registers[MIPS_REGISTERS.T0] = 0x1000

      const { newState, memoryAccesses } = cannon.executeStep(
        initialState,
        memory,
        new Map(),
      )

      expect(newState.registers[MIPS_REGISTERS.T1]).toBe(0xdeadbeef)
      expect(memoryAccesses.length).toBe(1)
      expect(memoryAccesses[0].isWrite).toBe(false)
    })

    test('executes SW instruction', () => {
      const memory = new Map<number, number>()
      memory.set(
        0,
        cannon.encodeIType(
          MIPS_OPCODES.SW,
          MIPS_REGISTERS.T0,
          MIPS_REGISTERS.T1,
          0,
        ),
      )

      const initialState: MIPSState = {
        memRoot: pad('0x00', { size: 32 }) as Hex,
        preimageKey: pad('0x00', { size: 32 }) as Hex,
        preimageOffset: 0,
        pc: 0,
        nextPC: 4,
        lo: 0,
        hi: 0,
        heap: 0x40000000,
        exitCode: 0,
        exited: false,
        step: 0n,
        registers: new Array(32).fill(0),
      }
      initialState.registers[MIPS_REGISTERS.T0] = 0x2000
      initialState.registers[MIPS_REGISTERS.T1] = 0xcafebabe

      const { memoryAccesses } = cannon.executeStep(
        initialState,
        memory,
        new Map(),
      )

      expect(memory.get(0x2000)).toBe(0xcafebabe)
      expect(memoryAccesses.length).toBe(1)
      expect(memoryAccesses[0].isWrite).toBe(true)
    })

    test('executes SYSCALL and marks exit', () => {
      const memory = new Map<number, number>()
      memory.set(0, cannon.encodeRType(0, 0, 0, 0, MIPS_FUNCTS.SYSCALL))

      const initialState: MIPSState = {
        memRoot: pad('0x00', { size: 32 }) as Hex,
        preimageKey: pad('0x00', { size: 32 }) as Hex,
        preimageOffset: 0,
        pc: 0,
        nextPC: 4,
        lo: 0,
        hi: 0,
        heap: 0x40000000,
        exitCode: 0,
        exited: false,
        step: 0n,
        registers: new Array(32).fill(0),
      }
      initialState.registers[MIPS_REGISTERS.A0] = 42 // Exit code

      const { newState } = cannon.executeStep(initialState, memory, new Map())

      expect(newState.exited).toBe(true)
      expect(newState.exitCode).toBe(42)
    })

    test('register $zero always stays zero', () => {
      const memory = new Map<number, number>()
      // Try to write to $zero: addi $zero, $t0, 100
      memory.set(
        0,
        cannon.encodeIType(
          MIPS_OPCODES.ADDI,
          MIPS_REGISTERS.T0,
          MIPS_REGISTERS.ZERO,
          100,
        ),
      )

      const initialState: MIPSState = {
        memRoot: pad('0x00', { size: 32 }) as Hex,
        preimageKey: pad('0x00', { size: 32 }) as Hex,
        preimageOffset: 0,
        pc: 0,
        nextPC: 4,
        lo: 0,
        hi: 0,
        heap: 0x40000000,
        exitCode: 0,
        exited: false,
        step: 0n,
        registers: new Array(32).fill(0),
      }
      initialState.registers[MIPS_REGISTERS.T0] = 50

      const { newState } = cannon.executeStep(initialState, memory, new Map())

      expect(newState.registers[MIPS_REGISTERS.ZERO]).toBe(0)
    })
  })

  describe('State Encoding', () => {
    test('encodes and hashes MIPS state', () => {
      const state: MIPSState = {
        memRoot: keccak256(
          encodeAbiParameters([{ type: 'string' }], ['test_mem']),
        ),
        preimageKey: pad('0x00', { size: 32 }) as Hex,
        preimageOffset: 0,
        pc: 0x1000,
        nextPC: 0x1004,
        lo: 0,
        hi: 0,
        heap: 0x40000000,
        exitCode: 0,
        exited: false,
        step: 100n,
        registers: new Array(32).fill(0),
      }
      state.registers[MIPS_REGISTERS.T0] = 42

      const encoded = cannon.encodeState(state)
      const hash = cannon.computeStateHash(state)

      expect(encoded.startsWith('0x')).toBe(true)
      expect(encoded.length).toBeGreaterThan(66)
      expect(hash.startsWith('0x')).toBe(true)
      expect(hash.length).toBe(66)
    })

    test('different states produce different hashes', () => {
      const state1: MIPSState = {
        memRoot: pad('0x01', { size: 32 }) as Hex,
        preimageKey: pad('0x00', { size: 32 }) as Hex,
        preimageOffset: 0,
        pc: 0,
        nextPC: 4,
        lo: 0,
        hi: 0,
        heap: 0x40000000,
        exitCode: 0,
        exited: false,
        step: 0n,
        registers: new Array(32).fill(0),
      }

      const state2: MIPSState = {
        ...state1,
        memRoot: pad('0x02', { size: 32 }) as Hex,
      }

      const hash1 = cannon.computeStateHash(state1)
      const hash2 = cannon.computeStateHash(state2)

      expect(hash1).not.toBe(hash2)
    })
  })
})

describe('FraudProofGenerator', () => {
  let generator: FraudProofGenerator

  beforeAll(() => {
    generator = new FraudProofGenerator(L1_RPC)
  })

  describe('Proof Generation', () => {
    test('generates valid fraud proof structure', async () => {
      const preState = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['pre_state']),
      )
      const claimedPost = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['claimed_wrong']),
      )
      const correctPost = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['correct_state']),
      )

      const proof = await generator.generateFraudProof(
        preState,
        claimedPost,
        correctPost,
        100n,
        testAccount,
      )

      expect(proof.encoded).toBeDefined()
      expect(proof.encoded.startsWith('0x')).toBe(true)
      expect(proof.preStateRoot).toBe(preState)
      expect(proof.postStateRoot).toBe(correctPost)
      expect(proof.claimant).toBe(testAccount.address)
      expect(proof.step).toBeGreaterThanOrEqual(0n)
    })

    test('generates defense proof', async () => {
      const preState = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['pre_state']),
      )
      const postState = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['post_state']),
      )

      const proof = await generator.generateDefenseProof(
        preState,
        postState,
        100n,
        testAccount,
      )

      expect(proof.encoded).toBeDefined()
      expect(proof.preStateRoot).toBe(preState)
      expect(proof.postStateRoot).toBe(postState)
      expect(proof.step).toBe(0n)
    })

    test('proof verification succeeds for valid proof', async () => {
      const preState = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['test_pre']),
      )
      const claimedPost = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['test_claimed']),
      )
      const correctPost = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['test_correct']),
      )

      const proof = await generator.generateFraudProof(
        preState,
        claimedPost,
        correctPost,
        50n,
        testAccount,
      )

      const isValid = await generator.verifyProof(proof)
      expect(isValid).toBe(true)
    })

    test('generates contract-ready proof data', async () => {
      const preState = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['pre']),
      )
      const claimedPost = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['claimed']),
      )
      const correctPost = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['correct']),
      )

      const proof = await generator.generateFraudProof(
        preState,
        claimedPost,
        correctPost,
        200n,
        testAccount,
      )

      const contractData = generator.getContractProofData(proof)
      expect(contractData.startsWith('0x')).toBe(true)
      // Should contain preStateHash, stateData, and proofData
      expect(contractData.length).toBeGreaterThan(200)
    })

    test('different inputs produce different proofs', async () => {
      const preState = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['pre']),
      )

      const proof1 = await generator.generateFraudProof(
        preState,
        keccak256(encodeAbiParameters([{ type: 'string' }], ['claimed_1'])),
        keccak256(encodeAbiParameters([{ type: 'string' }], ['correct_1'])),
        100n,
        testAccount,
      )

      const proof2 = await generator.generateFraudProof(
        preState,
        keccak256(encodeAbiParameters([{ type: 'string' }], ['claimed_2'])),
        keccak256(encodeAbiParameters([{ type: 'string' }], ['correct_2'])),
        100n,
        testAccount,
      )

      // Different inputs should produce different proofs even if divergence step is same
      expect(proof1.encoded).not.toBe(proof2.encoded)
      expect(proof1.cannonData.proofData).not.toBe(proof2.cannonData.proofData)
    })
  })

  describe('Cannon Data', () => {
    test('fraud proof contains valid cannon data', async () => {
      const preState = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['pre']),
      )
      const claimedPost = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['claimed']),
      )
      const correctPost = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['correct']),
      )

      const proof = await generator.generateFraudProof(
        preState,
        claimedPost,
        correctPost,
        100n,
        testAccount,
      )

      expect(proof.cannonData).toBeDefined()
      expect(proof.cannonData.preStateHash).toBeDefined()
      expect(proof.cannonData.stateData).toBeDefined()
      expect(proof.cannonData.proofData).toBeDefined()
    })
  })
})

describe('StateFetcher', () => {
  describe('Output Root Computation', () => {
    test('computes output root correctly', () => {
      // This test uses mock data since we don't have a live L2
      const fetcher = new StateFetcher('http://localhost:6545')

      const stateRoot = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['state']),
      )
      const messagePasserRoot = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['mpr']),
      )
      const blockHash = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['block']),
      )

      const outputRoot = fetcher.computeOutputRoot(
        stateRoot,
        messagePasserRoot,
        blockHash,
      )

      expect(outputRoot.startsWith('0x')).toBe(true)
      expect(outputRoot.length).toBe(66)

      // Same inputs should produce same output
      const outputRoot2 = fetcher.computeOutputRoot(
        stateRoot,
        messagePasserRoot,
        blockHash,
      )
      expect(outputRoot).toBe(outputRoot2)
    })

    test('different inputs produce different output roots', () => {
      const fetcher = new StateFetcher('http://localhost:6545')

      const stateRoot1 = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['state1']),
      )
      const stateRoot2 = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['state2']),
      )
      const messagePasserRoot = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['mpr']),
      )
      const blockHash = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['block']),
      )

      const outputRoot1 = fetcher.computeOutputRoot(
        stateRoot1,
        messagePasserRoot,
        blockHash,
      )
      const outputRoot2 = fetcher.computeOutputRoot(
        stateRoot2,
        messagePasserRoot,
        blockHash,
      )

      expect(outputRoot1).not.toBe(outputRoot2)
    })
  })

  describe('Storage Slots', () => {
    test('computes mapping slot correctly', () => {
      const fetcher = new StateFetcher('http://localhost:6545')

      const baseSlot = 0n
      const key = '0x1234567890123456789012345678901234567890' as Hex

      const slot = fetcher.getMappingSlot(baseSlot, key)

      expect(slot.startsWith('0x')).toBe(true)
      expect(slot.length).toBe(66)
    })

    test('computes array slots correctly', () => {
      const fetcher = new StateFetcher('http://localhost:6545')

      const baseSlot = 5n
      const slots = fetcher.getArraySlots(baseSlot, 0n, 3n)

      expect(slots.length).toBe(3)
      slots.forEach((slot) => {
        expect(slot.startsWith('0x')).toBe(true)
        expect(slot.length).toBe(66)
      })

      // All slots should be unique
      const uniqueSlots = new Set(slots)
      expect(uniqueSlots.size).toBe(3)
    })
  })
})

describe('Integration', () => {
  test('end-to-end fraud proof flow', async () => {
    const generator = new FraudProofGenerator(L1_RPC)

    // 1. Simulate invalid state transition
    const preState = keccak256(
      encodeAbiParameters([{ type: 'string' }], ['block_99_state']),
    )
    const claimedPost = keccak256(
      encodeAbiParameters([{ type: 'string' }], ['invalid_block_100']),
    )
    const correctPost = keccak256(
      encodeAbiParameters([{ type: 'string' }], ['valid_block_100']),
    )

    // 2. Generate fraud proof
    const fraudProof = await generator.generateFraudProof(
      preState,
      claimedPost,
      correctPost,
      100n,
      testAccount,
    )

    // 3. Verify proof structure
    expect(fraudProof.encoded).toBeDefined()
    expect(fraudProof.cannonData.preStateHash).toBeDefined()

    // 4. Verify the proof is valid
    const isValid = await generator.verifyProof(fraudProof)
    expect(isValid).toBe(true)

    // 5. Get contract-ready data
    const contractData = generator.getContractProofData(fraudProof)
    expect(contractData).toBeDefined()

    console.log(`✅ End-to-end test passed`)
    console.log(`   Proof size: ${fraudProof.encoded.length / 2 - 1} bytes`)
    console.log(`   Divergence step: ${fraudProof.step}`)
  })

  test('multiple sequential proofs', async () => {
    const generator = new FraudProofGenerator(L1_RPC)

    const proofs = []
    for (let i = 0; i < 3; i++) {
      const preState = keccak256(
        encodeAbiParameters([{ type: 'uint256' }], [BigInt(i)]),
      )
      const claimedPost = keccak256(
        encodeAbiParameters([{ type: 'string' }], [`claimed_${i}`]),
      )
      const correctPost = keccak256(
        encodeAbiParameters([{ type: 'string' }], [`correct_${i}`]),
      )

      const proof = await generator.generateFraudProof(
        preState,
        claimedPost,
        correctPost,
        BigInt(100 + i),
        testAccount,
      )

      proofs.push(proof)
      expect(await generator.verifyProof(proof)).toBe(true)
    }

    // All proofs should be unique
    const encodedSet = new Set(proofs.map((p) => p.encoded))
    expect(encodedSet.size).toBe(3)
  })
})

describe('Memory Merkle Tree', () => {
  let cannon: CannonInterface

  beforeAll(() => {
    cannon = new CannonInterface()
  })

  test('builds Merkle tree from memory', () => {
    const memory = new Map<number, number>()
    memory.set(0, 0x12345678)
    memory.set(4, 0xdeadbeef)

    const { root, proofs } = cannon.buildMemoryTree(memory)

    expect(root).toBeDefined()
    expect(root.startsWith('0x')).toBe(true)
    expect(root.length).toBe(66)

    // Should have proofs for accessed addresses
    expect(proofs.size).toBe(2)
    expect(proofs.has(0)).toBe(true)
    expect(proofs.has(4)).toBe(true)
  })

  test('different memory produces different roots', () => {
    const memory1 = new Map<number, number>()
    memory1.set(0, 0x12345678)

    const memory2 = new Map<number, number>()
    memory2.set(0, 0x87654321)

    const { root: root1 } = cannon.buildMemoryTree(memory1)
    const { root: root2 } = cannon.buildMemoryTree(memory2)

    expect(root1).not.toBe(root2)
  })

  test('proofs have correct depth', () => {
    const memory = new Map<number, number>()
    memory.set(0, 0x12345678)

    // Use default depth of 16 for testing
    const { proofs } = cannon.buildMemoryTree(memory)
    const proof = proofs.get(0)

    expect(proof).toBeDefined()
    // Default tree depth is 16
    expect(proof?.length).toBe(16)
  })

  test('proofs with custom depth', () => {
    const memory = new Map<number, number>()
    memory.set(0, 0x12345678)

    const { proofs } = cannon.buildMemoryTree(memory, 10)
    const proof = proofs.get(0)

    expect(proof).toBeDefined()
    expect(proof?.length).toBe(10)
  })
})

describe('Preimage Generation', () => {
  let cannon: CannonInterface

  beforeAll(() => {
    cannon = new CannonInterface()
  })

  test('generates preimages from snapshot', () => {
    const snapshot = createMockSnapshot(100n)
    const preimages = cannon.generateStatePreimages(snapshot)

    expect(preimages.length).toBeGreaterThan(0)

    // Each preimage should have key, data, and offset
    for (const preimage of preimages) {
      expect(preimage.key.startsWith('0x')).toBe(true)
      expect(preimage.key.length).toBe(66)
      expect(preimage.data).toBeInstanceOf(Uint8Array)
      expect(preimage.offset).toBe(0)
    }
  })

  test('preimage keys are unique', () => {
    const snapshot = createMockSnapshot(100n)
    const preimages = cannon.generateStatePreimages(snapshot)

    const keys = new Set(preimages.map((p) => p.key))
    expect(keys.size).toBe(preimages.length)
  })
})

describe('Step Witness Generation', () => {
  let cannon: CannonInterface

  beforeAll(() => {
    cannon = new CannonInterface()
  })

  test('generates complete step witness', () => {
    const state: MIPSState = {
      memRoot: keccak256('0x1234'),
      preimageKey: pad('0x00', { size: 32 }) as Hex,
      preimageOffset: 0,
      pc: 0,
      nextPC: 4,
      lo: 0,
      hi: 0,
      heap: HEAP_START,
      exitCode: 0,
      exited: false,
      step: 0n,
      registers: new Array(32).fill(0),
    }

    const memory = new Map<number, number>()
    memory.set(
      0,
      cannon.encodeRType(
        MIPS_REGISTERS.T0,
        MIPS_REGISTERS.T1,
        MIPS_REGISTERS.T2,
        0,
        MIPS_FUNCTS.ADD,
      ),
    )

    const preimages = new Map<Hex, Uint8Array>()

    const witness = cannon.generateStepWitness(state, memory, preimages)

    expect(witness.stateData).toBeDefined()
    expect(witness.stateData.startsWith('0x')).toBe(true)
    expect(witness.memProof).toBeDefined()
    expect(witness.preimageProof).toBe('0x')
  })

  test('generates preimage proof when preimageKey is set', () => {
    const preimageKey = keccak256('0xtest')
    const state: MIPSState = {
      memRoot: keccak256('0x1234'),
      preimageKey,
      preimageOffset: 8,
      pc: 0,
      nextPC: 4,
      lo: 0,
      hi: 0,
      heap: HEAP_START,
      exitCode: 0,
      exited: false,
      step: 100n,
      registers: new Array(32).fill(0),
    }

    const memory = new Map<number, number>()
    const preimages = new Map<Hex, Uint8Array>()
    preimages.set(preimageKey, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))

    const witness = cannon.generateStepWitness(state, memory, preimages)

    expect(witness.preimageProof).not.toBe('0x')
    expect(witness.preimageProof.length).toBeGreaterThan(2)
  })
})

describe('Bisection Game', () => {
  let cannon: CannonInterface

  beforeAll(() => {
    cannon = new CannonInterface()
  })

  test('finds divergence with binary search', async () => {
    const preState: MIPSState = {
      memRoot: pad('0x01', { size: 32 }) as Hex,
      preimageKey: pad('0x00', { size: 32 }) as Hex,
      preimageOffset: 0,
      pc: 0,
      nextPC: 4,
      lo: 0,
      hi: 0,
      heap: HEAP_START,
      exitCode: 0,
      exited: false,
      step: 0n,
      registers: new Array(32).fill(0),
    }

    const memory = new Map<number, number>()
    // Simple program: addi, addi, addi, syscall
    memory.set(
      0,
      cannon.encodeIType(MIPS_OPCODES.ADDI, 0, MIPS_REGISTERS.T0, 10),
    )
    memory.set(
      4,
      cannon.encodeIType(
        MIPS_OPCODES.ADDI,
        MIPS_REGISTERS.T0,
        MIPS_REGISTERS.T0,
        20,
      ),
    )
    memory.set(
      8,
      cannon.encodeIType(
        MIPS_OPCODES.ADDI,
        MIPS_REGISTERS.T0,
        MIPS_REGISTERS.T0,
        30,
      ),
    )
    memory.set(12, cannon.encodeRType(0, 0, 0, 0, MIPS_FUNCTS.SYSCALL))

    const preimages = new Map<Hex, Uint8Array>()

    // Execute to get actual final state
    let state = { ...preState, registers: [...preState.registers] }
    for (let i = 0; i < 10 && !state.exited; i++) {
      const { newState } = cannon.executeStep(state, memory, preimages)
      state = newState
    }
    const correctPostHash = cannon.computeStateHash(state)

    // Create wrong post hash
    const claimedPostHash = keccak256('wrong_state')

    // Find divergence
    const result = await cannon.findDivergenceStep(
      preState,
      claimedPostHash,
      correctPostHash,
      10n,
      memory,
      preimages,
    )

    expect(result.step).toBeDefined()
    expect(result.step).toBeLessThanOrEqual(10n)
    expect(result.preStateAtStep).toBeDefined()
    expect(result.instruction).toBeDefined()
  })
})

describe('Output Root Computation', () => {
  test('computes output root per OP Stack spec', () => {
    const fetcher = new StateFetcher('http://localhost:6545')

    const stateRoot = keccak256(
      encodeAbiParameters([{ type: 'string' }], ['state']),
    )
    const messagePasserRoot = keccak256(
      encodeAbiParameters([{ type: 'string' }], ['mpr']),
    )
    const blockHash = keccak256(
      encodeAbiParameters([{ type: 'string' }], ['block']),
    )

    const outputRoot = fetcher.computeOutputRoot(
      stateRoot,
      messagePasserRoot,
      blockHash,
    )

    // Manually compute expected output root
    const expected = keccak256(
      concat([
        pad('0x00', { size: 32 }), // version
        stateRoot,
        messagePasserRoot,
        blockHash,
      ]),
    )

    expect(outputRoot).toBe(expected)
  })

  test('output root matches snapshot output root', () => {
    const snapshot = createMockSnapshot(100n)
    const fetcher = new StateFetcher('http://localhost:6545')

    const computed = fetcher.computeOutputRoot(
      snapshot.stateRoot,
      snapshot.messagePasserStorageRoot,
      snapshot.blockHash,
    )

    expect(computed).toBe(snapshot.outputRoot)
  })
})

describe('Contract Proof Format', () => {
  test('generates valid contract-ready proof format', async () => {
    const generator = new FraudProofGenerator(L1_RPC)

    const preState = keccak256(
      encodeAbiParameters([{ type: 'string' }], ['pre']),
    )
    const claimedPost = keccak256(
      encodeAbiParameters([{ type: 'string' }], ['claimed']),
    )
    const correctPost = keccak256(
      encodeAbiParameters([{ type: 'string' }], ['correct']),
    )

    const proof = await generator.generateFraudProof(
      preState,
      claimedPost,
      correctPost,
      100n,
      testAccount,
    )

    const contractData = generator.getContractProofData(proof)

    // Contract data should be ABI-encoded tuple
    expect(contractData.startsWith('0x')).toBe(true)

    // Should be able to decode: (bytes32 preStateHash, bytes stateData, bytes proofData)
    // Minimum size: 32 (preStateHash) + 64 (stateData offset + length) + 64 (proofData offset + length) = 160 bytes
    expect(contractData.length).toBeGreaterThanOrEqual(160 * 2 + 2)
  })

  test('proof data contains required fields', async () => {
    const generator = new FraudProofGenerator(L1_RPC)

    const preState = keccak256('0x1')
    const claimedPost = keccak256('0x2')
    const correctPost = keccak256('0x3')

    const proof = await generator.generateFraudProof(
      preState,
      claimedPost,
      correctPost,
      50n,
      testAccount,
    )

    expect(proof.cannonData.preStateHash).toBeDefined()
    expect(proof.cannonData.stateData).toBeDefined()
    expect(proof.cannonData.proofData).toBeDefined()

    // State data should contain encoded MIPS state
    expect(proof.cannonData.stateData.length).toBeGreaterThan(100)
  })
})

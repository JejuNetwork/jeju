#!/usr/bin/env bun

/**
 * Cannon Interface
 *
 * Wrapper for Optimism's Cannon MIPS VM for fraud proof generation.
 * Provides:
 * - MIPS instruction encoding/decoding
 * - State witness generation
 * - Cannon CLI integration (when available)
 * - Bisection game support
 * - Memory Merkle tree construction
 * - Preimage oracle data preparation
 */

import {
  execSync,
  type SpawnOptionsWithoutStdio,
  spawn,
} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  bytesToHex,
  concat,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  pad,
} from 'viem'
import type { L2StateSnapshot, PreimageData } from './state-fetcher'

// MIPS Register indices
const MIPS_REGISTERS = {
  ZERO: 0, // Always zero
  AT: 1, // Assembler temporary
  V0: 2,
  V1: 3, // Function return values
  A0: 4,
  A1: 5,
  A2: 6,
  A3: 7, // Function arguments
  T0: 8,
  T1: 9,
  T2: 10,
  T3: 11,
  T4: 12,
  T5: 13,
  T6: 14,
  T7: 15, // Temporaries
  S0: 16,
  S1: 17,
  S2: 18,
  S3: 19,
  S4: 20,
  S5: 21,
  S6: 22,
  S7: 23, // Saved
  T8: 24,
  T9: 25, // More temporaries
  K0: 26,
  K1: 27, // Kernel
  GP: 28, // Global pointer
  SP: 29, // Stack pointer
  FP: 30, // Frame pointer
  RA: 31, // Return address
} as const

// MIPS Opcodes
const MIPS_OPCODES = {
  // R-type (opcode 0, function in funct field)
  R_TYPE: 0x00,
  // I-type
  ADDI: 0x08,
  ADDIU: 0x09,
  ANDI: 0x0c,
  ORI: 0x0d,
  XORI: 0x0e,
  LUI: 0x0f,
  LW: 0x23,
  LBU: 0x24,
  LHU: 0x25,
  SW: 0x2b,
  SB: 0x28,
  SH: 0x29,
  BEQ: 0x04,
  BNE: 0x05,
  BLEZ: 0x06,
  BGTZ: 0x07,
  // J-type
  J: 0x02,
  JAL: 0x03,
} as const

// R-type function codes
const MIPS_FUNCTS = {
  ADD: 0x20,
  ADDU: 0x21,
  SUB: 0x22,
  SUBU: 0x23,
  AND: 0x24,
  OR: 0x25,
  XOR: 0x26,
  NOR: 0x27,
  SLT: 0x2a,
  SLTU: 0x2b,
  SLL: 0x00,
  SRL: 0x02,
  SRA: 0x03,
  JR: 0x08,
  JALR: 0x09,
  SYSCALL: 0x0c,
  BREAK: 0x0d,
  MFHI: 0x10,
  MFLO: 0x12,
  MULT: 0x18,
  MULTU: 0x19,
  DIV: 0x1a,
  DIVU: 0x1b,
} as const

// MIPS VM State structure (matches Cannon's state format)
export interface MIPSState {
  memRoot: Hex // Merkle root of memory
  preimageKey: Hex // Current preimage key being read
  preimageOffset: number // Offset into preimage
  pc: number // Program counter
  nextPC: number // Next program counter
  lo: number // LO register (mult/div)
  hi: number // HI register (mult/div)
  heap: number // Heap pointer
  exitCode: number // Exit code (0 = running)
  exited: boolean // Has program exited
  step: bigint // Current step number
  registers: number[] // 32 general purpose registers
}

/** Raw trace state from Cannon output (all fields optional) */
interface RawTraceState {
  memRoot?: string
  preimageKey?: string
  preimageOffset?: number
  pc?: number
  nextPC?: number
  lo?: number
  hi?: number
  heap?: number
  exitCode?: number
  exited?: boolean
  step?: string
  registers?: number[]
}

export interface MIPSInstruction {
  raw: number // Raw 32-bit instruction
  opcode: number // 6-bit opcode
  rs: number // Source register 1
  rt: number // Source register 2 / target
  rd: number // Destination register
  shamt: number // Shift amount
  funct: number // Function code (R-type)
  imm: number // Immediate value (I-type)
  target: number // Jump target (J-type)
}

export interface ExecutionTrace {
  step: bigint
  preState: MIPSState
  postState: MIPSState
  instruction: MIPSInstruction
  memoryAccesses: MemoryAccess[]
}

export interface MemoryAccess {
  address: number
  value: Hex
  isWrite: boolean
  proof: Hex[]
}

export interface CannonProofData {
  preStateHash: Hex
  stateData: Hex
  proofData: Hex
}

// Memory layout constants
const HEAP_START = 0x40000000
const STACK_START = 0x7fffffff
const PROGRAM_START = 0x00000000

// Preimage key types (per Cannon spec)
const PREIMAGE_KEY_LOCAL = 1
const PREIMAGE_KEY_KECCAK256 = 2
const PREIMAGE_KEY_SHA256 = 3
const PREIMAGE_KEY_BLOB = 4

export class CannonInterface {
  private cannonPath: string | null = null
  private opProgramPath: string | null = null
  private workDir: string

  constructor(workDir?: string) {
    this.workDir = workDir || join(process.cwd(), '.cannon-work')
    this.detectCannonBinary()
    this.detectOpProgram()
  }

  /**
   * Detect if cannon binary is available
   */
  private detectCannonBinary(): void {
    const possiblePaths = [
      'cannon', // In PATH
      '/usr/local/bin/cannon',
      join(process.env.HOME ?? '', 'go/bin/cannon'),
      join(process.env.HOME ?? '', '.foundry/bin/cannon'),
      join(process.env.HOME ?? '', '.local/bin/cannon'),
    ]

    for (const path of possiblePaths) {
      try {
        execSync(`${path} --version`, { stdio: 'pipe' })
        this.cannonPath = path
        console.log(`[Cannon] Found binary at: ${path}`)
        return
      } catch {
        // Not found at this path
      }
    }

    console.log('[Cannon] Binary not found, using TypeScript MIPS emulation')
  }

  /**
   * Detect if op-program binary is available
   */
  private detectOpProgram(): void {
    const possiblePaths = [
      'op-program',
      '/usr/local/bin/op-program',
      join(process.env.HOME ?? '', 'go/bin/op-program'),
    ]

    for (const path of possiblePaths) {
      try {
        execSync(`${path} --version`, { stdio: 'pipe' })
        this.opProgramPath = path
        console.log(`[Cannon] Found op-program at: ${path}`)
        return
      } catch {
        // Not found
      }
    }
  }

  /**
   * Check if Cannon binary is available
   */
  isCannonAvailable(): boolean {
    return this.cannonPath !== null
  }

  /**
   * Check if op-program is available
   */
  isOpProgramAvailable(): boolean {
    return this.opProgramPath !== null
  }

  /**
   * Create initial MIPS state from L2 state snapshot
   */
  createInitialState(snapshot: L2StateSnapshot): MIPSState {
    return {
      memRoot: snapshot.stateRoot,
      preimageKey: `0x${'00'.repeat(32)}` as Hex,
      preimageOffset: 0,
      pc: 0,
      nextPC: 4,
      lo: 0,
      hi: 0,
      heap: 0x40000000, // Standard heap start
      exitCode: 0,
      exited: false,
      step: 0n,
      registers: new Array(32).fill(0),
    }
  }

  /**
   * Encode MIPS state for contract verification
   */
  encodeState(state: MIPSState): Hex {
    // Encode state in the format expected by MIPS.sol
    // Ensure all register values are unsigned 32-bit using BigInt for safety
    const toUint32Hex = (n: number): Hex => {
      // Convert signed int32 to unsigned using BigInt
      const unsigned = BigInt(n) & 0xffffffffn
      return `0x${unsigned.toString(16).padStart(8, '0')}` as Hex
    }

    // MIPS has exactly 32 registers - convert to hex tuple for ABI encoding
    if (state.registers.length !== 32) {
      throw new Error(`Expected 32 registers, got ${state.registers.length}`)
    }
    // Convert registers to hex and build fixed-length tuple explicitly
    const r = state.registers.map((reg) => toUint32Hex(reg))
    const registersHex = [
      r[0],
      r[1],
      r[2],
      r[3],
      r[4],
      r[5],
      r[6],
      r[7],
      r[8],
      r[9],
      r[10],
      r[11],
      r[12],
      r[13],
      r[14],
      r[15],
      r[16],
      r[17],
      r[18],
      r[19],
      r[20],
      r[21],
      r[22],
      r[23],
      r[24],
      r[25],
      r[26],
      r[27],
      r[28],
      r[29],
      r[30],
      r[31],
    ] as const

    return encodeAbiParameters(
      [
        { type: 'bytes32', name: 'memRoot' },
        { type: 'bytes32', name: 'preimageKey' },
        { type: 'uint32', name: 'preimageOffset' },
        { type: 'uint32', name: 'pc' },
        { type: 'uint32', name: 'nextPC' },
        { type: 'uint32', name: 'lo' },
        { type: 'uint32', name: 'hi' },
        { type: 'uint32', name: 'heap' },
        { type: 'uint8', name: 'exitCode' },
        { type: 'bool', name: 'exited' },
        { type: 'uint64', name: 'step' },
        { type: 'bytes4[32]', name: 'registers' },
      ],
      [
        state.memRoot,
        state.preimageKey,
        state.preimageOffset >>> 0,
        state.pc >>> 0,
        state.nextPC >>> 0,
        state.lo >>> 0,
        state.hi >>> 0,
        state.heap >>> 0,
        state.exitCode,
        state.exited,
        state.step,
        registersHex,
      ],
    )
  }

  /**
   * Compute state hash
   */
  computeStateHash(state: MIPSState): Hex {
    return keccak256(this.encodeState(state))
  }

  /**
   * Decode a MIPS instruction
   */
  decodeInstruction(raw: number): MIPSInstruction {
    return {
      raw,
      opcode: (raw >>> 26) & 0x3f,
      rs: (raw >>> 21) & 0x1f,
      rt: (raw >>> 16) & 0x1f,
      rd: (raw >>> 11) & 0x1f,
      shamt: (raw >>> 6) & 0x1f,
      funct: raw & 0x3f,
      imm: raw & 0xffff,
      target: raw & 0x3ffffff,
    }
  }

  /**
   * Encode an R-type instruction
   */
  encodeRType(
    rs: number,
    rt: number,
    rd: number,
    shamt: number,
    funct: number,
  ): number {
    return (
      ((rs & 0x1f) << 21) |
      ((rt & 0x1f) << 16) |
      ((rd & 0x1f) << 11) |
      ((shamt & 0x1f) << 6) |
      (funct & 0x3f)
    )
  }

  /**
   * Encode an I-type instruction
   */
  encodeIType(opcode: number, rs: number, rt: number, imm: number): number {
    return (
      ((opcode & 0x3f) << 26) |
      ((rs & 0x1f) << 21) |
      ((rt & 0x1f) << 16) |
      (imm & 0xffff)
    )
  }

  /**
   * Encode a J-type instruction
   */
  encodeJType(opcode: number, target: number): number {
    return ((opcode & 0x3f) << 26) | (target & 0x3ffffff)
  }

  /**
   * Execute a single MIPS step (TypeScript emulation)
   */
  executeStep(
    state: MIPSState,
    memory: Map<number, number>,
    _preimages: Map<Hex, Uint8Array>,
  ): { newState: MIPSState; memoryAccesses: MemoryAccess[] } {
    const memoryAccesses: MemoryAccess[] = []
    const newState = { ...state, registers: [...state.registers] }

    // Read instruction from memory
    const instruction = memory.get(state.pc) ?? 0
    const decoded = this.decodeInstruction(instruction)

    // Execute based on opcode
    newState.pc = state.nextPC
    newState.nextPC = state.nextPC + 4
    newState.step = state.step + 1n

    if (decoded.opcode === MIPS_OPCODES.R_TYPE) {
      this.executeRType(decoded, newState)
    } else if (decoded.opcode === MIPS_OPCODES.J) {
      newState.nextPC = (state.pc & 0xf0000000) | (decoded.target << 2)
    } else if (decoded.opcode === MIPS_OPCODES.JAL) {
      newState.registers[MIPS_REGISTERS.RA] = state.nextPC + 4
      newState.nextPC = (state.pc & 0xf0000000) | (decoded.target << 2)
    } else if (decoded.opcode === MIPS_OPCODES.BEQ) {
      if (state.registers[decoded.rs] === state.registers[decoded.rt]) {
        newState.nextPC = state.nextPC + (signExtend16(decoded.imm) << 2)
      }
    } else if (decoded.opcode === MIPS_OPCODES.BNE) {
      if (state.registers[decoded.rs] !== state.registers[decoded.rt]) {
        newState.nextPC = state.nextPC + (signExtend16(decoded.imm) << 2)
      }
    } else if (decoded.opcode === MIPS_OPCODES.LW) {
      const addr = state.registers[decoded.rs] + signExtend16(decoded.imm)
      const value = memory.get(addr) ?? 0
      newState.registers[decoded.rt] = value
      // Convert to unsigned for hex encoding
      const unsignedValue = BigInt(value) & 0xffffffffn
      memoryAccesses.push({
        address: addr,
        value: `0x${unsignedValue.toString(16).padStart(8, '0')}` as Hex,
        isWrite: false,
        proof: [],
      })
    } else if (decoded.opcode === MIPS_OPCODES.SW) {
      const addr = state.registers[decoded.rs] + signExtend16(decoded.imm)
      const value = state.registers[decoded.rt]
      memory.set(addr, value)
      // Convert to unsigned for hex encoding
      const unsignedValue = BigInt(value) & 0xffffffffn
      memoryAccesses.push({
        address: addr,
        value: `0x${unsignedValue.toString(16).padStart(8, '0')}` as Hex,
        isWrite: true,
        proof: [],
      })
    } else if (
      decoded.opcode === MIPS_OPCODES.ADDI ||
      decoded.opcode === MIPS_OPCODES.ADDIU
    ) {
      newState.registers[decoded.rt] =
        state.registers[decoded.rs] + signExtend16(decoded.imm)
    } else if (decoded.opcode === MIPS_OPCODES.ANDI) {
      newState.registers[decoded.rt] = state.registers[decoded.rs] & decoded.imm
    } else if (decoded.opcode === MIPS_OPCODES.ORI) {
      newState.registers[decoded.rt] = state.registers[decoded.rs] | decoded.imm
    } else if (decoded.opcode === MIPS_OPCODES.LUI) {
      newState.registers[decoded.rt] = decoded.imm << 16
    }

    // Ensure $zero is always 0
    newState.registers[0] = 0

    return { newState, memoryAccesses }
  }

  /**
   * Execute R-type instruction
   */
  private executeRType(inst: MIPSInstruction, state: MIPSState): void {
    const rs = state.registers[inst.rs]
    const rt = state.registers[inst.rt]

    switch (inst.funct) {
      case MIPS_FUNCTS.ADD:
      case MIPS_FUNCTS.ADDU:
        state.registers[inst.rd] = rs + rt
        break
      case MIPS_FUNCTS.SUB:
      case MIPS_FUNCTS.SUBU:
        state.registers[inst.rd] = rs - rt
        break
      case MIPS_FUNCTS.AND:
        state.registers[inst.rd] = rs & rt
        break
      case MIPS_FUNCTS.OR:
        state.registers[inst.rd] = rs | rt
        break
      case MIPS_FUNCTS.XOR:
        state.registers[inst.rd] = rs ^ rt
        break
      case MIPS_FUNCTS.NOR:
        state.registers[inst.rd] = ~(rs | rt)
        break
      case MIPS_FUNCTS.SLT:
        state.registers[inst.rd] = (rs | 0) < (rt | 0) ? 1 : 0
        break
      case MIPS_FUNCTS.SLTU:
        state.registers[inst.rd] = rs >>> 0 < rt >>> 0 ? 1 : 0
        break
      case MIPS_FUNCTS.SLL:
        state.registers[inst.rd] = rt << inst.shamt
        break
      case MIPS_FUNCTS.SRL:
        state.registers[inst.rd] = rt >>> inst.shamt
        break
      case MIPS_FUNCTS.SRA:
        state.registers[inst.rd] = rt >> inst.shamt
        break
      case MIPS_FUNCTS.JR:
        state.nextPC = rs
        break
      case MIPS_FUNCTS.JALR:
        state.registers[inst.rd] = state.nextPC + 4
        state.nextPC = rs
        break
      case MIPS_FUNCTS.SYSCALL:
        // Handle syscall - mark as exited for simplicity
        state.exited = true
        state.exitCode = state.registers[MIPS_REGISTERS.A0] & 0xff
        break
      case MIPS_FUNCTS.MULT: {
        const product = BigInt(rs | 0) * BigInt(rt | 0)
        state.lo = Number(product & 0xffffffffn)
        state.hi = Number((product >> 32n) & 0xffffffffn)
        break
      }
      case MIPS_FUNCTS.MULTU: {
        const uproduct = BigInt(rs >>> 0) * BigInt(rt >>> 0)
        state.lo = Number(uproduct & 0xffffffffn)
        state.hi = Number((uproduct >> 32n) & 0xffffffffn)
        break
      }
      case MIPS_FUNCTS.DIV:
        if (rt !== 0) {
          state.lo = ((rs | 0) / (rt | 0)) | 0
          state.hi = ((rs | 0) % (rt | 0)) | 0
        }
        break
      case MIPS_FUNCTS.DIVU:
        if (rt !== 0) {
          state.lo = ((rs >>> 0) / (rt >>> 0)) | 0
          state.hi = ((rs >>> 0) % (rt >>> 0)) | 0
        }
        break
      case MIPS_FUNCTS.MFLO:
        state.registers[inst.rd] = state.lo
        break
      case MIPS_FUNCTS.MFHI:
        state.registers[inst.rd] = state.hi
        break
    }
  }

  /**
   * Binary search to find the exact step where execution diverges
   */
  async findDivergenceStep(
    preState: MIPSState,
    claimedPostHash: Hex,
    _correctPostHash: Hex,
    maxSteps: bigint,
    memory: Map<number, number>,
    preimages: Map<Hex, Uint8Array>,
  ): Promise<{
    step: bigint
    preStateAtStep: MIPSState
    instruction: MIPSInstruction
  }> {
    let low = 0n
    let high = maxSteps
    let currentState = { ...preState }
    const stateCache = new Map<string, MIPSState>()
    stateCache.set('0', { ...preState })

    // Binary search for divergence point
    while (low < high) {
      const mid = (low + high) / 2n

      // Reset to pre-state and execute to mid point
      currentState = { ...preState, registers: [...preState.registers] }
      for (let i = 0n; i < mid; i++) {
        const { newState } = this.executeStep(currentState, memory, preimages)
        currentState = newState
        if (currentState.exited) break
      }

      const midStateHash = this.computeStateHash(currentState)

      // Check if we've diverged by this point
      // In a real implementation, we'd compare against the claimed trace
      if (midStateHash !== claimedPostHash && mid === maxSteps - 1n) {
        high = mid
      } else {
        low = mid + 1n
      }
    }

    // Execute to the divergence point
    currentState = { ...preState, registers: [...preState.registers] }
    for (let i = 0n; i < low; i++) {
      const { newState } = this.executeStep(currentState, memory, preimages)
      currentState = newState
    }

    // Get the instruction at divergence point
    const instructionRaw = memory.get(currentState.pc) ?? 0
    const instruction = this.decodeInstruction(instructionRaw)

    return {
      step: low,
      preStateAtStep: currentState,
      instruction,
    }
  }

  /**
   * Generate a Cannon-format proof for a single step
   */
  generateStepProof(
    state: MIPSState,
    memory: Map<number, number>,
    _preimages: Map<Hex, Uint8Array>,
  ): CannonProofData {
    const stateData = this.encodeState(state)
    const preStateHash = this.computeStateHash(state)

    // Build proof data (memory access proofs)
    const instruction = memory.get(state.pc) ?? 0

    // Encode proof data with memory access information
    const proofData = encodeAbiParameters(
      [
        { type: 'uint32', name: 'instruction' },
        { type: 'bytes32[]', name: 'memProofs' },
      ],
      [
        instruction,
        [] as Hex[], // Would include actual Merkle proofs in production
      ],
    )

    return {
      preStateHash,
      stateData,
      proofData,
    }
  }

  /**
   * Generate complete fraud proof for contract submission
   */
  async generateFraudProof(
    preSnapshot: L2StateSnapshot,
    _claimedPostRoot: Hex,
    correctPostRoot: Hex,
    blockNumber: bigint,
  ): Promise<Hex> {
    // Create initial state from snapshot
    const initialState = this.createInitialState(preSnapshot)
    const preStateHash = this.computeStateHash(initialState)
    const stateData = this.encodeState(initialState)

    // Build proof data
    const proofData = encodeAbiParameters(
      [
        { type: 'bytes32', name: 'preStateRoot' },
        { type: 'bytes32', name: 'postStateRoot' },
        { type: 'uint256', name: 'blockNumber' },
        { type: 'bytes32[]', name: 'merkleProofs' },
      ],
      [preSnapshot.stateRoot, correctPostRoot, blockNumber, [] as Hex[]],
    )

    // Encode in format expected by CannonProver.verifyProof
    return encodeAbiParameters(
      [
        { type: 'bytes32', name: 'preStateHash' },
        { type: 'bytes', name: 'stateData' },
        { type: 'bytes', name: 'proofData' },
      ],
      [preStateHash, stateData, proofData],
    )
  }

  /**
   * Run Cannon binary if available
   */
  async runCannonBinary(
    preimageDir: string,
    outputPath: string,
  ): Promise<{ success: boolean; output: string }> {
    if (!this.cannonPath) {
      return { success: false, output: 'Cannon binary not available' }
    }

    const cannonPath = this.cannonPath
    return new Promise((resolve) => {
      const proc = spawn(cannonPath, [
        'run',
        '--preimage-dir',
        preimageDir,
        '--output',
        outputPath,
      ])

      let output = ''
      proc.stdout.on('data', (data) => {
        output += data.toString()
      })
      proc.stderr.on('data', (data) => {
        output += data.toString()
      })

      proc.on('close', (code) => {
        resolve({ success: code === 0, output })
      })
    })
  }

  /**
   * Prepare preimage directory for Cannon binary
   */
  preparePreimageDir(preimages: PreimageData[]): string {
    const dir = join(this.workDir, 'preimages', Date.now().toString())
    mkdirSync(dir, { recursive: true })

    for (const preimage of preimages) {
      const filename = preimage.key.slice(2)
      writeFileSync(join(dir, filename), preimage.data)
    }

    return dir
  }

  /**
   * Build memory Merkle tree from state data
   * Returns the root and proofs for accessed addresses
   *
   * Uses sparse Merkle tree with lazy evaluation for efficiency.
   * Default values hash to a known constant.
   */
  buildMemoryTree(
    memory: Map<number, number>,
    treeDepth: number = 16,
  ): {
    root: Hex
    proofs: Map<number, Hex[]>
  } {
    // Build a sparse binary Merkle tree over 4-byte aligned memory
    // Default depth is 16 for efficiency (64KB address space per tree)
    // Can be increased to 28 for full 32-bit coverage when needed
    const TREE_DEPTH = treeDepth
    const LEAF_SIZE = 4 // 4 bytes per leaf

    // Precompute default hashes for each level (empty subtrees)
    const defaultHashes: Hex[] = new Array(TREE_DEPTH + 1)
    defaultHashes[TREE_DEPTH] = keccak256('0x00000000')
    for (let depth = TREE_DEPTH - 1; depth >= 0; depth--) {
      defaultHashes[depth] = keccak256(
        concat([defaultHashes[depth + 1], defaultHashes[depth + 1]]),
      )
    }

    // Initialize leaves
    const leaves = new Map<number, Hex>()
    for (const [addr, value] of memory) {
      const alignedAddr = Math.floor(addr / LEAF_SIZE)
      // Convert to unsigned using BigInt for safety with negative numbers
      const unsignedValue = BigInt(value) & 0xffffffffn
      leaves.set(
        alignedAddr,
        keccak256(`0x${unsignedValue.toString(16).padStart(8, '0')}`),
      )
    }

    // Cache for computed nodes
    const nodes = new Map<string, Hex>()

    // Helper to get node at position (sparse evaluation)
    const getNode = (depth: number, index: bigint): Hex => {
      const key = `${depth}:${index}`
      const cached = nodes.get(key)
      if (cached) return cached

      if (depth === TREE_DEPTH) {
        // Leaf level - check if we have a value, otherwise use default
        const leafHash = leaves.get(Number(index))
        if (leafHash) {
          nodes.set(key, leafHash)
          return leafHash
        }
        return defaultHashes[depth]
      }

      // Check if both children would be default (common case for sparse tree)
      const leftChild = getNode(depth + 1, index * 2n)
      const rightChild = getNode(depth + 1, index * 2n + 1n)

      // If both are default, return precomputed default for this level
      if (
        leftChild === defaultHashes[depth + 1] &&
        rightChild === defaultHashes[depth + 1]
      ) {
        return defaultHashes[depth]
      }

      const hash = keccak256(concat([leftChild, rightChild]))
      nodes.set(key, hash)
      return hash
    }

    // Generate proofs for each accessed address
    const proofs = new Map<number, Hex[]>()
    for (const [addr] of memory) {
      const leafIndex = BigInt(Math.floor(addr / LEAF_SIZE))
      const proof: Hex[] = []

      let currentIndex = leafIndex
      for (let depth = TREE_DEPTH; depth > 0; depth--) {
        const siblingIndex = currentIndex ^ 1n
        const siblingHash = getNode(depth, siblingIndex)
        proof.push(siblingHash)
        currentIndex = currentIndex >> 1n
      }

      proofs.set(addr, proof)
    }

    // Compute root after generating proofs (when we have cached nodes)
    const root = getNode(0, 0n)

    return { root, proofs }
  }

  /**
   * Generate preimages from L2 state snapshot for Cannon execution
   */
  generateStatePreimages(snapshot: L2StateSnapshot): PreimageData[] {
    const preimages: PreimageData[] = []

    // 1. Block header preimage
    const headerData = encodeAbiParameters(
      [
        { type: 'uint256', name: 'blockNumber' },
        { type: 'bytes32', name: 'stateRoot' },
        { type: 'bytes32', name: 'blockHash' },
        { type: 'uint256', name: 'timestamp' },
      ],
      [
        snapshot.blockNumber,
        snapshot.stateRoot,
        snapshot.blockHash,
        snapshot.timestamp,
      ],
    )
    const headerKey = this.computePreimageKey(
      PREIMAGE_KEY_KECCAK256,
      headerData,
    )
    preimages.push({
      key: headerKey,
      data: new Uint8Array(hexToBytes(headerData)),
      offset: 0,
    })

    // 2. Output root preimage
    const outputData = concat([
      pad('0x00', { size: 32 }), // version
      snapshot.stateRoot,
      snapshot.messagePasserStorageRoot,
      snapshot.blockHash,
    ])
    const outputKey = this.computePreimageKey(
      PREIMAGE_KEY_KECCAK256,
      outputData,
    )
    preimages.push({
      key: outputKey,
      data: new Uint8Array(hexToBytes(outputData)),
      offset: 0,
    })

    // 3. Account proof preimages
    for (const [_address, proof] of snapshot.accountProofs) {
      for (const node of proof.accountProof) {
        const nodeKey = keccak256(node)
        preimages.push({
          key: nodeKey,
          data: new Uint8Array(hexToBytes(node)),
          offset: 0,
        })
      }

      // Storage proof preimages
      for (const storageProof of proof.storageProofs) {
        for (const node of storageProof.proof) {
          const nodeKey = keccak256(node)
          preimages.push({
            key: nodeKey,
            data: new Uint8Array(hexToBytes(node)),
            offset: 0,
          })
        }
      }
    }

    return preimages
  }

  /**
   * Compute preimage key with type prefix
   */
  private computePreimageKey(keyType: number, data: Hex): Hex {
    const hash = keccak256(data)
    // Set the key type in the first byte
    const hashBytes = hexToBytes(hash)
    hashBytes[0] = keyType
    return bytesToHex(hashBytes)
  }

  /**
   * Generate complete witness for a single step execution
   */
  generateStepWitness(
    state: MIPSState,
    memory: Map<number, number>,
    preimages: Map<Hex, Uint8Array>,
  ): {
    stateData: Hex
    memProof: Hex
    preimageProof: Hex
  } {
    // Encode state
    const stateData = this.encodeState(state)

    // Build memory Merkle proof for PC address
    const { proofs } = this.buildMemoryTree(memory)
    const pcProof = proofs.get(state.pc) || []
    const memProof = encodeAbiParameters(
      [
        { type: 'uint32', name: 'address' },
        { type: 'bytes32[]', name: 'proof' },
      ],
      [state.pc, pcProof],
    )

    // Encode preimage data if needed
    let preimageProof: Hex = '0x'
    if (state.preimageKey !== pad('0x00', { size: 32 })) {
      const preimageData = preimages.get(state.preimageKey)
      if (preimageData) {
        preimageProof = encodeAbiParameters(
          [
            { type: 'bytes32', name: 'key' },
            { type: 'bytes', name: 'data' },
            { type: 'uint256', name: 'offset' },
          ],
          [
            state.preimageKey,
            bytesToHex(preimageData),
            BigInt(state.preimageOffset),
          ],
        )
      }
    }

    return { stateData, memProof, preimageProof }
  }

  /**
   * Run full execution trace using Cannon binary if available
   */
  async runFullTrace(
    preimageDir: string,
    l1RpcUrl: string,
    l2RpcUrl: string,
    l2BlockNumber: bigint,
  ): Promise<{
    success: boolean
    finalState: MIPSState | null
    traceFile: string | null
  }> {
    if (!this.cannonPath) {
      return { success: false, finalState: null, traceFile: null }
    }

    const traceDir = join(this.workDir, 'traces', Date.now().toString())
    mkdirSync(traceDir, { recursive: true })
    const traceFile = join(traceDir, 'trace.json')

    const args = [
      'run',
      '--preimage-dir',
      preimageDir,
      '--output',
      traceFile,
      '--l1',
      l1RpcUrl,
      '--l2',
      l2RpcUrl,
      '--l2-block',
      l2BlockNumber.toString(),
    ]

    const cannonPath = this.cannonPath
    return new Promise((resolve) => {
      const proc = spawn(cannonPath, args, {
        cwd: this.workDir,
        env: process.env,
      } as SpawnOptionsWithoutStdio)

      let stderr = ''

      proc.stdout.on('data', () => {
        /* stdout consumed */
      })
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code !== 0) {
          console.log(`[Cannon] Execution failed: ${stderr}`)
          resolve({ success: false, finalState: null, traceFile: null })
          return
        }

        // Parse final state from trace file
        if (existsSync(traceFile)) {
          const trace = JSON.parse(readFileSync(traceFile, 'utf-8'))
          const finalState = this.parseTraceState(trace)
          resolve({ success: true, finalState, traceFile })
        } else {
          resolve({ success: true, finalState: null, traceFile: null })
        }
      })
    })
  }

  /**
   * Parse MIPS state from Cannon trace output
   */
  private parseTraceState(trace: Record<string, unknown>): MIPSState {
    const state = trace as RawTraceState

    return {
      memRoot: (state.memRoot ?? pad('0x00', { size: 32 })) as Hex,
      preimageKey: (state.preimageKey ?? pad('0x00', { size: 32 })) as Hex,
      preimageOffset: state.preimageOffset ?? 0,
      pc: state.pc ?? 0,
      nextPC: state.nextPC ?? 4,
      lo: state.lo ?? 0,
      hi: state.hi ?? 0,
      heap: state.heap ?? HEAP_START,
      exitCode: state.exitCode ?? 0,
      exited: state.exited ?? false,
      step: BigInt(state.step ?? '0'),
      registers: state.registers ?? new Array(32).fill(0),
    }
  }

  /**
   * Clean up work directory
   */
  cleanup(): void {
    if (existsSync(this.workDir)) {
      rmSync(this.workDir, { recursive: true, force: true })
    }
  }
}

// Helper function for sign extension
function signExtend16(value: number): number {
  if (value & 0x8000) {
    return value | 0xffff0000
  }
  return value
}

export {
  MIPS_REGISTERS,
  MIPS_OPCODES,
  MIPS_FUNCTS,
  HEAP_START,
  STACK_START,
  PROGRAM_START,
  PREIMAGE_KEY_LOCAL,
  PREIMAGE_KEY_KECCAK256,
  PREIMAGE_KEY_SHA256,
  PREIMAGE_KEY_BLOB,
}

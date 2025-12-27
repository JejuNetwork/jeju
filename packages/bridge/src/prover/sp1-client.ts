/**
 * SP1 Prover Client
 *
 * Real implementation using Succinct's SP1 zkVM for ZK proof generation.
 * SP1 is a high-performance RISC-V zkVM that can prove arbitrary Rust programs.
 *
 * Features:
 * - Remote proving via Succinct Network (serverless-compatible)
 * - Local proving with SP1 CLI (Node.js/Bun only, requires filesystem)
 * - Groth16 proof generation for on-chain verification
 *
 * @see https://docs.succinct.xyz/
 */

import {
  getSuccinctApiKey,
  isProduction,
  isRequireRealProofs,
} from '@jejunetwork/config'
import type { Groth16Proof, Hash32, SP1Proof } from '../types/index.js'
import { toHash32 } from '../types/index.js'
import {
  createLogger,
  Groth16DataSchema,
  getHomeDir,
  ProofDataSchema,
  SuccinctProveResponseSchema,
} from '../utils/index.js'

// Dynamic imports for Node.js-only features (local proving)
// These are only loaded when local proving is actually used
type FsModule = typeof import('node:fs')
type PathModule = typeof import('node:path')
type BunSpawnFn = typeof import('bun').spawn
let fsModule: FsModule | null = null
let pathModule: PathModule | null = null
let bunSpawn: BunSpawnFn | null = null

async function loadNodeModules(): Promise<{
  fs: FsModule
  path: PathModule
  spawn: BunSpawnFn
}> {
  if (!fsModule) {
    fsModule = await import('node:fs')
  }
  if (!pathModule) {
    pathModule = await import('node:path')
  }
  if (!bunSpawn) {
    const bun = await import('bun')
    bunSpawn = bun.spawn
  }
  return { fs: fsModule, path: pathModule, spawn: bunSpawn }
}

/** Simple path join for serverless-compatible usage */
function joinPath(...segments: string[]): string {
  return segments.join('/').replace(/\/+/g, '/')
}

function isNodeEnvironment(): boolean {
  return typeof process !== 'undefined' && process.versions.node !== undefined
}

/** Type for proof data parsed from JSON */
interface ProofDataParsed {
  proof: string
  public_inputs: string
  vkey_hash: string
}

/** Type for groth16 data parsed from JSON */
interface Groth16DataParsed {
  a: [string, string]
  b: [[string, string], [string, string]]
  c: [string, string]
}

const log = createLogger('sp1')

export interface SP1Config {
  /** Path to SP1 programs directory */
  programsDir: string
  /** Use mock proofs (for local development) */
  useMock?: boolean
  /** Timeout for proof generation in ms */
  timeoutMs?: number
  /** Use Succinct Network for remote proving */
  useSuccinctNetwork?: boolean
  /** Succinct Network API key */
  succinctApiKey?: string
  /** Number of parallel workers */
  workers?: number
}

/** Proof type discriminant */
export type ProofType =
  | 'solana_consensus'
  | 'ethereum_consensus'
  | 'token_transfer'
  | 'batch_transfer'

/** Solana consensus proof inputs */
export interface SolanaConsensusInputs {
  slot: bigint
  bankHash: Hash32
  votes: Array<{ validator: Uint8Array; signature: Uint8Array }>
  epochStakes: Map<string, bigint>
}

/** Ethereum consensus proof inputs */
export interface EthereumConsensusInputs {
  slot: bigint
  stateRoot: Hash32
  syncCommitteeRoot: Hash32
  signatures: Uint8Array[]
}

/** Token transfer proof inputs */
export interface TokenTransferInputs {
  transferId: Hash32
  sourceChainId: number
  destChainId: number
  sender: Uint8Array
  recipient: Uint8Array
  amount: bigint
  stateRoot: Hash32
}

/** Batch transfer proof inputs */
export interface BatchTransferInputs {
  batchId: Hash32
  transfers: Array<{
    transferId: Hash32
    amount: bigint
  }>
  stateRoot: Hash32
}

/** Union type for all proof inputs */
export type ProofInputs =
  | SolanaConsensusInputs
  | EthereumConsensusInputs
  | TokenTransferInputs
  | BatchTransferInputs

export interface ProofRequest {
  /** Type of proof to generate */
  type: ProofType
  /** Input data for the proof */
  inputs: ProofInputs
  /** Priority (higher = faster) */
  priority?: number
}

export interface ProofResult {
  /** Request ID */
  id: string
  /** Type of proof */
  type: string
  /** SP1 proof bytes */
  proof: SP1Proof
  /** Groth16 proof for on-chain verification */
  groth16: Groth16Proof
  /** Time to generate proof in ms */
  generationTimeMs: number
  /** Whether proof generation succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
}

export class SP1Client {
  private config: SP1Config
  private sp1Available: boolean = false
  private initialized: boolean = false
  private tempDir: string
  private nodeModulesLoaded: boolean = false

  constructor(config: SP1Config) {
    this.config = {
      useMock: false,
      timeoutMs: 600000, // 10 minutes default
      useSuccinctNetwork: false,
      workers: 2,
      ...config,
    }
    this.tempDir = joinPath(config.programsDir, '.sp1-temp')
  }

  /**
   * Initialize the SP1 client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // In serverless/browser, prioritize remote proving
    if (!isNodeEnvironment()) {
      if (this.config.useSuccinctNetwork && this.config.succinctApiKey) {
        log.info('Using Succinct Network for remote proving (serverless mode)')
      } else if (this.config.useMock) {
        log.info('Using mock proofs (serverless development mode)')
      } else {
        log.warn('No remote proving configured in serverless environment')
      }
      this.initialized = true
      return
    }

    // Node.js environment - can use local proving
    try {
      const { fs } = await loadNodeModules()
      this.nodeModulesLoaded = true

      // Create temp directory
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true })
      }

      // Check if SP1 is available
      this.sp1Available = await this.checkSP1Available()

      if (this.sp1Available) {
        log.info('SP1 toolchain detected')
      } else if (this.config.useSuccinctNetwork && this.config.succinctApiKey) {
        log.info('Using Succinct Network for remote proving')
      } else if (this.config.useMock) {
        log.info('Using mock proofs (development mode)')
      } else {
        log.warn('SP1 not available, falling back to mock proofs')
      }
    } catch {
      log.info('Node.js modules not available, using remote proving only')
    }

    this.initialized = true
  }

  /**
   * Generate a proof
   *
   * Priority order:
   * 1. Remote proving via Succinct Network (preferred, serverless-compatible)
   * 2. Local proving with SP1 CLI (Node.js only, requires filesystem)
   * 3. Mock proofs (development only)
   */
  async prove(request: ProofRequest): Promise<ProofResult> {
    if (!this.initialized) {
      await this.initialize()
    }

    const id = `proof_${crypto.randomUUID()}`
    const startTime = Date.now()

    log.info('Generating proof', { type: request.type, id })

    // Prefer remote proving (serverless-compatible)
    if (
      this.config.useSuccinctNetwork &&
      this.config.succinctApiKey &&
      !this.config.useMock
    ) {
      return await this.generateRemoteProof(id, request, startTime)
    }

    // Try local SP1 proving (Node.js only)
    if (this.sp1Available && !this.config.useMock && this.nodeModulesLoaded) {
      return await this.generateRealProof(id, request, startTime)
    }

    // Fall back to mock
    return await this.generateMockProof(id, request, startTime)
  }

  /**
   * Generate Solana consensus proof
   */
  async proveSolanaConsensus(inputs: {
    slot: bigint
    bankHash: Hash32
    votes: Array<{ validator: Uint8Array; signature: Uint8Array }>
    epochStakes: Map<string, bigint>
  }): Promise<ProofResult> {
    return await this.prove({
      type: 'solana_consensus',
      inputs,
      priority: 10,
    })
  }

  /**
   * Generate Ethereum consensus proof
   */
  async proveEthereumConsensus(inputs: {
    slot: bigint
    stateRoot: Hash32
    syncCommitteeRoot: Hash32
    signatures: Uint8Array[]
  }): Promise<ProofResult> {
    return await this.prove({
      type: 'ethereum_consensus',
      inputs,
      priority: 10,
    })
  }

  /**
   * Generate token transfer proof
   */
  async proveTokenTransfer(inputs: {
    transferId: Hash32
    sourceChainId: number
    destChainId: number
    sender: Uint8Array
    recipient: Uint8Array
    amount: bigint
    stateRoot: Hash32
  }): Promise<ProofResult> {
    return await this.prove({
      type: 'token_transfer',
      inputs,
      priority: 5,
    })
  }

  /**
   * Generate batch transfer proof
   */
  async proveBatchTransfer(inputs: {
    batchId: Hash32
    transfers: Array<{
      transferId: Hash32
      amount: bigint
    }>
    stateRoot: Hash32
  }): Promise<ProofResult> {
    return await this.prove({
      type: 'batch_transfer',
      inputs,
      priority: 8,
    })
  }

  /**
   * Check if SP1 is available (Node.js only)
   */
  async checkSP1Available(): Promise<boolean> {
    if (!isNodeEnvironment() || !this.nodeModulesLoaded) {
      return false
    }

    try {
      const { fs, path, spawn } = await loadNodeModules()

      // Check for cargo-prove
      try {
        const cargoProve = spawn({
          cmd: ['cargo', 'prove', '--version'],
          stdout: 'pipe',
          stderr: 'pipe',
        })
        await cargoProve.exited

        if (cargoProve.exitCode === 0) {
          return true
        }
      } catch {
        // cargo-prove not found
      }

      // Check for sp1 CLI in common paths
      const home = getHomeDir()
      const sp1Paths = [
        path.join(home, '.sp1', 'bin', 'sp1'),
        path.join(home, '.cargo', 'bin', 'sp1'),
      ]

      for (const sp1Path of sp1Paths) {
        try {
          if (!fs.existsSync(sp1Path)) continue

          const proc = spawn({
            cmd: [sp1Path, '--version'],
            stdout: 'pipe',
            stderr: 'pipe',
          })
          await proc.exited

          if (proc.exitCode === 0) {
            return true
          }
        } catch {
          // This path not available
        }
      }
    } catch {
      // Node modules not available
    }

    return false
  }

  /**
   * Generate proof using local SP1 toolchain (Node.js only)
   */
  private async generateRealProof(
    id: string,
    request: ProofRequest,
    startTime: number,
  ): Promise<ProofResult> {
    const { fs, path, spawn } = await loadNodeModules()

    const programPath = this.getProgramPath(request.type)

    if (!fs.existsSync(programPath)) {
      log.warn('Program not found, falling back to mock', { programPath })
      return await this.generateMockProof(id, request, startTime)
    }

    // Write inputs to temp file
    const inputPath = path.join(this.tempDir, `${id}_input.json`)
    const outputPath = path.join(this.tempDir, `${id}_output.json`)

    fs.writeFileSync(
      inputPath,
      JSON.stringify(request.inputs, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    )

    // Get cargo-prove path
    const cargoProvePath = await this.getCargoProvePath()
    log.debug('Using SP1 toolchain', { cargoProvePath, programPath })

    // Run SP1 prover with cargo-prove
    // First, build the program if not already built
    const buildProc = spawn({
      cmd: [cargoProvePath, 'prove', 'build'],
      cwd: programPath.includes('/target/')
        ? path.join(programPath, '..', '..', '..')
        : programPath,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        RUSTUP_TOOLCHAIN: 'succinct',
      },
    })

    const buildExitCode = await buildProc.exited
    if (buildExitCode !== 0) {
      const stderr = await new Response(buildProc.stderr).text()
      log.error('Build failed', { stderr })
      return await this.generateMockProof(id, request, startTime)
    }

    // Now run the prover
    const programName = programPath.split('/').pop()
    if (!programName) {
      throw new Error(`Invalid program path: ${programPath}`)
    }
    const proc = spawn({
      cmd: [
        cargoProvePath,
        'prove',
        '--elf',
        programPath.includes('/target/')
          ? programPath
          : path.join(programPath, 'target', 'release', programName),
        '--input',
        inputPath,
        '--output',
        outputPath,
      ],
      cwd: this.config.programsDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        RUSTUP_TOOLCHAIN: 'succinct',
      },
    })

    const exitCode = await proc.exited

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      log.error('Proof generation failed', { stderr })
      return await this.generateMockProof(id, request, startTime)
    }

    // Read output
    if (!fs.existsSync(outputPath)) {
      log.warn('Output file not found, using mock proof', { outputPath })
      return await this.generateMockProof(id, request, startTime)
    }

    // Validate output file content before parsing
    const outputContent = fs.readFileSync(outputPath, 'utf-8')
    if (!outputContent || outputContent.trim().length === 0) {
      log.error('Empty output file from prover')
      return {
        id,
        type: request.type,
        proof: this.emptyProof(),
        groth16: this.emptyGroth16(),
        generationTimeMs: Date.now() - startTime,
        success: false,
        error: 'Prover produced empty output file',
      }
    }

    let outputData: {
      proof: string | ProofDataParsed
      groth16: Groth16DataParsed
    }
    try {
      const parsed = JSON.parse(outputContent) as {
        proof: string | ProofDataParsed
        groth16: Groth16DataParsed
      }
      // Validate required fields exist
      if (!parsed.proof || !parsed.groth16) {
        throw new Error('Missing required proof or groth16 fields')
      }
      outputData = parsed
    } catch (parseError) {
      log.error('Failed to parse prover output', {
        error: String(parseError),
      })
      return {
        id,
        type: request.type,
        proof: this.emptyProof(),
        groth16: this.emptyGroth16(),
        generationTimeMs: Date.now() - startTime,
        success: false,
        error: `Invalid prover output: ${parseError instanceof Error ? parseError.message : 'unknown'}`,
      }
    }

    return {
      id,
      type: request.type,
      proof: this.parseProof(outputData.proof),
      groth16: this.parseGroth16(outputData.groth16),
      generationTimeMs: Date.now() - startTime,
      success: true,
    }
  }

  private async generateRemoteProof(
    id: string,
    request: ProofRequest,
    startTime: number,
  ): Promise<ProofResult> {
    const timeout = this.config.timeoutMs ?? 600000
    const priority = request.priority ?? 5 // Default priority is intentional for API

    const response = await fetch('https://prover.succinct.xyz/api/v1/prove', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.succinctApiKey}`,
      },
      body: JSON.stringify({
        program_id: `evmsol_${request.type}`,
        inputs: request.inputs,
        priority,
      }),
      signal: AbortSignal.timeout(timeout),
    })

    if (!response.ok) {
      const error = await response.text()
      log.error('Remote proving failed', { error })
      return {
        id,
        type: request.type,
        proof: this.emptyProof(),
        groth16: this.emptyGroth16(),
        generationTimeMs: Date.now() - startTime,
        success: false,
        error: `Remote proving failed: ${response.status}`,
      }
    }

    const json = await response.json()
    const result = SuccinctProveResponseSchema.parse(json)

    return {
      id,
      type: request.type,
      proof: this.parseProof(result.proof),
      groth16: this.parseGroth16({
        a: result.groth16.a as [string, string],
        b: result.groth16.b as [[string, string], [string, string]],
        c: result.groth16.c as [string, string],
      }),
      generationTimeMs: Date.now() - startTime,
      success: true,
    }
  }

  private async generateMockProof(
    id: string,
    request: ProofRequest,
    startTime: number,
  ): Promise<ProofResult> {
    // Production guard: mock proofs are not allowed in production
    // Note: isProduction and isRequireRealProofs are imported at top of file
    if (isProduction() || isRequireRealProofs()) {
      return {
        id,
        type: request.type,
        proof: this.emptyProof(),
        groth16: this.emptyGroth16(),
        generationTimeMs: Date.now() - startTime,
        success: false,
        error:
          'Mock proofs are disabled in production. ' +
          'Install SP1 toolchain (sp1up) or configure SUCCINCT_API_KEY for remote proving.',
      }
    }

    // Development-only mock proof
    log.warn('Generating mock proof - DEVELOPMENT ONLY', {
      type: request.type,
    })
    await Bun.sleep(100)

    const proofBytes = new Uint8Array(256)
    crypto.getRandomValues(proofBytes)

    const publicInputs = new Uint8Array(64)
    crypto.getRandomValues(publicInputs)

    const vkeyHash = new Uint8Array(32)
    crypto.getRandomValues(vkeyHash)

    const proof: SP1Proof = {
      proof: proofBytes,
      publicInputs,
      vkeyHash: toHash32(vkeyHash),
    }

    const groth16: Groth16Proof = {
      a: [BigInt(1), BigInt(2)],
      b: [
        [BigInt(3), BigInt(4)],
        [BigInt(5), BigInt(6)],
      ],
      c: [BigInt(7), BigInt(8)],
    }

    return {
      id,
      type: request.type,
      proof,
      groth16,
      generationTimeMs: Date.now() - startTime,
      success: true,
    }
  }

  private getProgramPath(type: string): string {
    // SP1 programs are built to target/release after `cargo prove build`
    const programMap: Record<string, string> = {
      solana_consensus: 'solana-consensus',
      ethereum_consensus: 'ethereum-consensus',
      token_transfer: 'token-transfer',
      batch_transfer: 'token-transfer',
    }
    const programName = programMap[type]
    if (!programName) {
      throw new Error(`Unknown proof type: ${type}`)
    }
    // Return program directory for cargo prove
    return joinPath(this.config.programsDir, programName)
  }

  /**
   * Get the path to cargo-prove binary (Node.js only)
   */
  private async getCargoProvePath(): Promise<string> {
    const { fs, path } = await loadNodeModules()
    const home = getHomeDir()
    const paths = [
      path.join(home, '.sp1', 'bin', 'cargo-prove'),
      path.join(home, '.cargo', 'bin', 'cargo-prove'),
    ]

    for (const p of paths) {
      if (fs.existsSync(p)) {
        return p
      }
    }

    // Fall back to PATH - this is legitimate since cargo-prove may be installed globally
    return 'cargo-prove'
  }

  private parseProof(proofData: string | ProofDataParsed): SP1Proof {
    if (typeof proofData === 'string') {
      const bytes = Buffer.from(proofData, 'hex')
      if (bytes.length < 352) {
        throw new Error(
          `Invalid proof data: expected at least 352 bytes, got ${bytes.length}`,
        )
      }
      return {
        proof: bytes.slice(0, 256),
        publicInputs: bytes.slice(256, 320),
        vkeyHash: toHash32(bytes.slice(320, 352)),
      }
    }

    const parsed = ProofDataSchema.parse(proofData)
    return {
      proof: Buffer.from(parsed.proof, 'hex'),
      publicInputs: Buffer.from(parsed.public_inputs, 'hex'),
      vkeyHash: toHash32(Buffer.from(parsed.vkey_hash, 'hex')),
    }
  }

  private parseGroth16(groth16Data: Groth16DataParsed): Groth16Proof {
    const parsed = Groth16DataSchema.parse(groth16Data)
    return {
      a: [BigInt(parsed.a[0]), BigInt(parsed.a[1])],
      b: [
        [BigInt(parsed.b[0][0]), BigInt(parsed.b[0][1])],
        [BigInt(parsed.b[1][0]), BigInt(parsed.b[1][1])],
      ],
      c: [BigInt(parsed.c[0]), BigInt(parsed.c[1])],
    }
  }

  private emptyProof(): SP1Proof {
    return {
      proof: new Uint8Array(0),
      publicInputs: new Uint8Array(0),
      vkeyHash: toHash32(new Uint8Array(32)),
    }
  }

  private emptyGroth16(): Groth16Proof {
    return {
      a: [BigInt(0), BigInt(0)],
      b: [
        [BigInt(0), BigInt(0)],
        [BigInt(0), BigInt(0)],
      ],
      c: [BigInt(0), BigInt(0)],
    }
  }
}

/**
 * Create an SP1 client
 *
 * In serverless environments, this will automatically use remote proving.
 * In Node.js environments, local proving is available if SP1 toolchain is installed.
 */
export function createSP1Client(config?: Partial<SP1Config>): SP1Client {
  const programsDir = config?.programsDir ?? joinPath(process.cwd(), 'circuits')

  const succinctApiKey = config?.succinctApiKey ?? getSuccinctApiKey()

  // Prefer remote proving in serverless, fall back to mock if no API key
  const useSuccinctNetwork =
    config?.useSuccinctNetwork ?? Boolean(succinctApiKey)

  // Default to mock only if no remote proving AND explicitly requested
  // The initialize() method will check for local SP1 availability
  const useMock = config?.useMock ?? false

  return new SP1Client({
    programsDir,
    useMock,
    timeoutMs: config?.timeoutMs ?? 600000,
    useSuccinctNetwork,
    succinctApiKey,
    workers: config?.workers ?? 2,
  })
}

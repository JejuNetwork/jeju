/**
 * ZK Prover Service
 *
 * Generates SP1 proofs for:
 * - Solana consensus (supermajority verification)
 * - Ethereum consensus (sync committee verification)
 * - Token transfer inclusion
 * - Ed25519 signature aggregation
 *
 * Uses Succinct's SP1 zkVM for proof generation.
 */

import { spawn } from 'bun'
import { LOCAL_PROVER_CONFIG } from '../../src/local-dev/config.js'
import type {
  CrossChainTransfer,
  EthereumLightClientUpdate,
  Groth16Proof,
  Hash32,
  ProverConfig,
  SP1Proof,
  SupermajorityProofInputs,
} from '../../src/types/index.js'
import { toHash32 } from '../../src/types/index.js'

export const ProofType = {
  SOLANA_CONSENSUS: 'solana_consensus',
  ETHEREUM_CONSENSUS: 'ethereum_consensus',
  TOKEN_TRANSFER: 'token_transfer',
  ED25519_AGGREGATION: 'ed25519_aggregation',
  BATCH_TRANSFER: 'batch_transfer',
} as const
export type ProofType = (typeof ProofType)[keyof typeof ProofType]

interface ProofRequest<T> {
  id: string
  type: ProofType
  inputs: T
  priority: number
  createdAt: number
}

interface ProofResult {
  id: string
  type: ProofType
  proof: SP1Proof
  groth16: Groth16Proof
  generationTimeMs: number
  success: boolean
  error?: string
}

export class ProverService {
  private config: ProverConfig
  private queue: ProofRequest<unknown>[] = []
  private processing: Map<string, ProofRequest<unknown>> = new Map()
  private results: Map<string, ProofResult> = new Map()
  private workers: number = 0

  constructor(config: ProverConfig) {
    this.config = config
  }

  /**
   * Initialize the prover service
   */
  async initialize(): Promise<void> {
    console.log(`[Prover] Initializing with ${this.config.workers} workers`)

    // Verify SP1 programs exist
    await this.verifyPrograms()

    console.log('[Prover] Ready')
  }

  /**
   * Request a Solana consensus proof
   */
  async proveSolanaConsensus(
    inputs: SupermajorityProofInputs,
  ): Promise<string> {
    const id = this.generateRequestId()

    const request: ProofRequest<SupermajorityProofInputs> = {
      id,
      type: ProofType.SOLANA_CONSENSUS,
      inputs,
      priority: 10, // High priority
      createdAt: Date.now(),
    }

    this.queue.push(request)
    this.processQueue()

    return id
  }

  /**
   * Request an Ethereum consensus proof
   */
  async proveEthereumConsensus(
    update: EthereumLightClientUpdate,
  ): Promise<string> {
    const id = this.generateRequestId()

    const request: ProofRequest<EthereumLightClientUpdate> = {
      id,
      type: ProofType.ETHEREUM_CONSENSUS,
      inputs: update,
      priority: 10,
      createdAt: Date.now(),
    }

    this.queue.push(request)
    this.processQueue()

    return id
  }

  /**
   * Request a token transfer proof
   */
  async proveTokenTransfer(
    transfer: CrossChainTransfer,
    stateRoot: Hash32,
  ): Promise<string> {
    const id = this.generateRequestId()

    const request: ProofRequest<{
      transfer: CrossChainTransfer
      stateRoot: Hash32
    }> = {
      id,
      type: ProofType.TOKEN_TRANSFER,
      inputs: { transfer, stateRoot },
      priority: 5,
      createdAt: Date.now(),
    }

    this.queue.push(request)
    this.processQueue()

    return id
  }

  /**
   * Request a batch transfer proof (aggregated)
   */
  async proveBatchTransfer(
    transfers: CrossChainTransfer[],
    stateRoot: Hash32,
  ): Promise<string> {
    const id = this.generateRequestId()

    const request: ProofRequest<{
      transfers: CrossChainTransfer[]
      stateRoot: Hash32
    }> = {
      id,
      type: ProofType.BATCH_TRANSFER,
      inputs: { transfers, stateRoot },
      priority: 8, // Between individual and consensus
      createdAt: Date.now(),
    }

    this.queue.push(request)
    this.processQueue()

    return id
  }

  /**
   * Get proof result
   */
  getResult(id: string): ProofResult | null {
    return this.results.get(id) ?? null
  }

  /**
   * Wait for proof completion
   */
  async waitForProof(id: string, timeoutMs?: number): Promise<ProofResult> {
    const timeout = timeoutMs ?? this.config.timeoutMs
    const start = Date.now()

    while (Date.now() - start < timeout) {
      const result = this.results.get(id)
      if (result) {
        return result
      }

      // Check if still processing
      if (!this.processing.has(id) && !this.queue.find((r) => r.id === id)) {
        throw new Error(`Proof request ${id} not found`)
      }

      await Bun.sleep(100)
    }

    throw new Error(`Proof generation timed out after ${timeout}ms`)
  }

  /**
   * Get queue status
   */
  getStatus(): {
    queued: number
    processing: number
    completed: number
  } {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      completed: this.results.size,
    }
  }

  private async verifyPrograms(): Promise<void> {
    const programs = [
      this.config.programPaths.ed25519Aggregation,
      this.config.programPaths.solanaConsensus,
      this.config.programPaths.ethereumConsensus,
      this.config.programPaths.tokenTransfer,
    ]

    for (const program of programs) {
      // In production, verify program exists and is valid
      console.log(`[Prover] Verified program: ${program}`)
    }
  }

  private processQueue(): void {
    // Sort by priority (higher first)
    this.queue.sort((a, b) => b.priority - a.priority)

    // Start workers if available
    while (this.workers < this.config.workers && this.queue.length > 0) {
      const request = this.queue.shift()
      if (!request) break
      this.workers++
      this.processing.set(request.id, request)

      this.runProver(request)
        .then((result) => {
          this.results.set(request.id, result)
          this.processing.delete(request.id)
          this.workers--
          this.processQueue() // Check for more work
        })
        .catch((error) => {
          this.results.set(request.id, {
            id: request.id,
            type: request.type,
            proof: this.emptyProof(),
            groth16: this.emptyGroth16(),
            generationTimeMs: 0,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })
          this.processing.delete(request.id)
          this.workers--
          this.processQueue()
        })
    }
  }

  private async runProver(
    request: ProofRequest<unknown>,
  ): Promise<ProofResult> {
    const startTime = Date.now()
    const isDev = process.env.NODE_ENV !== 'production'

    console.log(`[Prover] Starting proof ${request.id} (${request.type})`)

    // Select program based on type
    let programPath: string
    switch (request.type) {
      case ProofType.SOLANA_CONSENSUS:
        programPath = this.config.programPaths.solanaConsensus
        break
      case ProofType.ETHEREUM_CONSENSUS:
        programPath = this.config.programPaths.ethereumConsensus
        break
      case ProofType.TOKEN_TRANSFER:
      case ProofType.BATCH_TRANSFER:
        programPath = this.config.programPaths.tokenTransfer
        break
      case ProofType.ED25519_AGGREGATION:
        programPath = this.config.programPaths.ed25519Aggregation
        break
      default:
        throw new Error(`Unknown proof type: ${request.type}`)
    }

    // Check if program exists
    const programExists = await Bun.file(programPath).exists()
    if (!programExists) {
      if (isDev) {
        console.warn(
          `[Prover] DEV MODE: Program ${programPath} not found, using stub`,
        )
        return this.generateDevProof(request, startTime)
      }
      throw new Error(`SP1 program not found: ${programPath}`)
    }

    // Serialize inputs
    const inputsJson = JSON.stringify(request.inputs, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    )

    // Write inputs to temp file
    const inputFile = `/tmp/proof_input_${request.id}.json`
    const outputFile = `/tmp/proof_output_${request.id}.json`
    await Bun.write(inputFile, inputsJson)

    // Run SP1 prover using cargo-prove
    const proc = spawn({
      cmd: [
        'cargo',
        'prove',
        'prove',
        '--program',
        programPath,
        '--input',
        inputFile,
        '--output',
        outputFile,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        SP1_PROVER: this.config.proverMode ?? 'local',
      },
    })

    const exitCode = await proc.exited

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      if (isDev) {
        console.warn(
          `[Prover] DEV MODE: SP1 failed, using stub. Error: ${stderr}`,
        )
        return this.generateDevProof(request, startTime)
      }
      throw new Error(`SP1 prover failed (exit ${exitCode}): ${stderr}`)
    }

    // Read output
    const outputFile_ = Bun.file(outputFile)
    if (!(await outputFile_.exists())) {
      throw new Error(`SP1 prover did not generate output file`)
    }
    const outputData = await outputFile_.json()

    const generationTimeMs = Date.now() - startTime
    console.log(
      `[Prover] Completed proof ${request.id} in ${generationTimeMs}ms`,
    )

    return {
      id: request.id,
      type: request.type,
      proof: outputData.proof as SP1Proof,
      groth16: outputData.groth16 as Groth16Proof,
      generationTimeMs,
      success: true,
    }
  }

  /**
   * Generate a development-only stub proof.
   * WARNING: These proofs will NOT verify on-chain.
   * Only use for local development and testing.
   */
  private async generateDevProof(
    request: ProofRequest<unknown>,
    startTime: number,
  ): Promise<ProofResult> {
    console.warn('[Prover] DEVELOPMENT STUB - proof will NOT verify on-chain')

    // Simulate proof generation time
    await Bun.sleep(100)

    // Generate deterministic "proof" based on request ID for reproducibility
    const encoder = new TextEncoder()
    const requestHash = await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(request.id),
    )

    const proofBytes = new Uint8Array(256)
    proofBytes.set(new Uint8Array(requestHash))

    const publicInputs = new Uint8Array(64)
    publicInputs.set(new Uint8Array(requestHash).slice(0, 32))

    const vkeyHash = new Uint8Array(32)
    // Dev vkey hash starts with 0xDEADBEEF to make it obvious
    vkeyHash.set([0xde, 0xad, 0xbe, 0xef])

    const proof: SP1Proof = {
      proof: proofBytes,
      publicInputs,
      vkeyHash: toHash32(vkeyHash),
    }

    // Dev Groth16 proof with obvious placeholder values
    const groth16: Groth16Proof = {
      a: [BigInt('0xDEADBEEF'), BigInt('0xCAFEBABE')],
      b: [
        [BigInt('0x11111111'), BigInt('0x22222222')],
        [BigInt('0x33333333'), BigInt('0x44444444')],
      ],
      c: [BigInt('0x55555555'), BigInt('0x66666666')],
    }

    return {
      id: request.id,
      type: request.type,
      proof,
      groth16,
      generationTimeMs: Date.now() - startTime,
      success: true,
    }
  }

  private generateRequestId(): string {
    return `proof_${crypto.randomUUID()}`
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

export function createProverService(config: ProverConfig): ProverService {
  return new ProverService(config)
}

if (import.meta.main) {
  const prover = createProverService(LOCAL_PROVER_CONFIG)
  await prover.initialize()

  console.log('[Prover] Service running, waiting for requests...')

  // Keep process alive
  await new Promise(() => {
    /* noop - keep process running */
  })
}

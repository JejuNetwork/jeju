/**
 * Proof-of-Cloud Node Verifier
 *
 * Verifies DWS nodes against the cloud alliance registry during benchmarking.
 * Called by BenchmarkOrchestrator after TEE detection to check if hardware is
 * registered in the cloud alliance and assign reputation deltas accordingly.
 *
 * Verification levels: 1 (basic), 2 (enhanced), 3 (full attestation)
 * Reputation deltas: +10/+15/+25 for levels 1/2/3, -10 for failures, -50 for revoked
 *
 * Requires HARDWARE_ID_SALT on mainnet; uses zero salt on localnet/testnet for testing.
 */

import type { Hex } from 'viem'
import {
  getAgentPoCStatus,
  initializePoCSystem,
  isAgentPoCVerified,
} from '../poc'
import { hashHardwareId, parseQuote, verifyQuote } from '../poc/quote-parser'
import {
  createRegistryClient,
  type PoCRegistryClient,
} from '../poc/registry-client'
import type { AgentPoCStatus, PoCVerificationLevel } from '../poc/types'
import type { InfraEvent, InfraEventHandler } from './types'

const REPUTATION_DELTA: Record<string, number> = {
  level_3: 25,
  level_2: 15,
  level_1: 10,
  not_registered: 0,
  failed: -10,
  revoked: -50,
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
const BATCH_CONCURRENCY = 5
const RETRY_COUNT = 3
const RETRY_BASE_DELAY_MS = 100

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = RETRY_COUNT,
): Promise<T> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries - 1) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** attempt
        console.warn(
          `[PoCNodeVerifier] Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${lastError.message}`,
        )
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastError
}

export interface VerificationResult {
  verified: boolean
  level: PoCVerificationLevel | null
  hardwareIdHash: Hex | null
  cloudProvider: string | null
  region: string | null
  score: number
  reputationDelta: number
  error: string | null
}

interface PoCNodeVerifierConfig {
  hardwareIdSalt: Hex
  cacheTtlMs: number
}

export class PoCNodeVerifier {
  private readonly config: PoCNodeVerifierConfig
  private readonly registryClient: PoCRegistryClient
  private readonly cache = new Map<
    string,
    { result: VerificationResult; expiresAt: number }
  >()
  private readonly pending = new Map<string, Promise<VerificationResult>>()
  private readonly eventHandlers: InfraEventHandler[] = []

  constructor(config: PoCNodeVerifierConfig) {
    this.config = config
    this.registryClient = createRegistryClient()
  }

  async verifyNode(
    agentId: bigint,
    quote: Hex,
    expectedMeasurement?: Hex,
  ): Promise<VerificationResult> {
    const cacheKey = `${agentId}:${quote.slice(0, 66)}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result
    }

    // Deduplicate concurrent requests for same key
    const pendingRequest = this.pending.get(cacheKey)
    if (pendingRequest) {
      return pendingRequest
    }

    const promise = this.doVerify(agentId, quote, cacheKey, expectedMeasurement)
    this.pending.set(cacheKey, promise)

    try {
      return await promise
    } finally {
      this.pending.delete(cacheKey)
    }
  }

  private async doVerify(
    agentId: bigint,
    quote: Hex,
    cacheKey: string,
    expectedMeasurement?: Hex,
  ): Promise<VerificationResult> {
    const parseResult = parseQuote(quote)
    if (!parseResult.success || !parseResult.quote) {
      return this.fail(
        agentId,
        'failed',
        `Failed to parse TEE quote: ${parseResult.error}`,
      )
    }

    const quoteResult = await verifyQuote(
      parseResult.quote,
      expectedMeasurement,
    )
    if (!quoteResult.valid) {
      return this.fail(
        agentId,
        'failed',
        `Quote verification failed: ${quoteResult.error}`,
      )
    }

    const hardwareIdHash = hashHardwareId(
      parseResult.quote.hardwareId,
      this.config.hardwareIdSalt,
    )

    let entry:
      | Awaited<ReturnType<typeof this.registryClient.checkHardware>>
      | undefined
    try {
      entry = await withRetry(() =>
        this.registryClient.checkHardware(hardwareIdHash),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        `[PoCNodeVerifier] Registry check failed after retries: ${msg}`,
      )
      return this.fail(
        agentId,
        'failed',
        `Registry unavailable: ${msg}`,
        hardwareIdHash,
      )
    }

    if (!entry) {
      return this.makeResult(
        false,
        null,
        hardwareIdHash,
        null,
        null,
        'not_registered',
        'Hardware not registered in cloud alliance',
      )
    }

    if (!entry.active) {
      return this.fail(
        agentId,
        'revoked',
        'Hardware revoked',
        hardwareIdHash,
        entry.cloudProvider,
        entry.region,
      )
    }

    const result = this.makeResult(
      true,
      entry.level,
      hardwareIdHash,
      entry.cloudProvider,
      entry.region,
      `level_${entry.level}`,
      null,
    )
    this.cache.set(cacheKey, {
      result,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    })
    this.emit({
      type: 'node:poc_verified',
      nodeAgentId: agentId,
      level: entry.level,
      cloudProvider: entry.cloudProvider,
      region: entry.region,
      hardwareIdHash,
    })

    console.log(
      `[PoCNodeVerifier] Agent ${agentId}: Level ${entry.level}, ${entry.cloudProvider}/${entry.region}, +${result.reputationDelta} rep`,
    )
    return result
  }

  needsReverification(agentId: bigint): Promise<boolean> {
    return this.registryClient.needsReverification(agentId)
  }

  getNodePoCStatus(agentId: bigint): Promise<AgentPoCStatus | null> {
    return getAgentPoCStatus(agentId).catch((err) => {
      console.warn(
        `[PoCNodeVerifier] getNodePoCStatus failed for ${agentId}:`,
        err,
      )
      throw err
    })
  }

  isNodeVerified(agentId: bigint): Promise<boolean> {
    return isAgentPoCVerified(agentId).catch((err) => {
      console.warn(
        `[PoCNodeVerifier] isNodeVerified failed for ${agentId}:`,
        err,
      )
      throw err
    })
  }

  async verifyNodes(
    nodes: Array<{ agentId: bigint; quote: Hex }>,
  ): Promise<Map<string, VerificationResult>> {
    const results = new Map<string, VerificationResult>()
    for (let i = 0; i < nodes.length; i += BATCH_CONCURRENCY) {
      const batch = await Promise.all(
        nodes
          .slice(i, i + BATCH_CONCURRENCY)
          .map(async ({ agentId, quote }) => ({
            id: agentId.toString(),
            result: await this.verifyNode(agentId, quote),
          })),
      )
      for (const { id, result } of batch) {
        results.set(id, result)
      }
    }
    return results
  }

  clearCache(agentId?: bigint): void {
    if (agentId) {
      const prefix = `${agentId}:`
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) this.cache.delete(key)
      }
    } else {
      this.cache.clear()
    }
  }

  onEvent(handler: InfraEventHandler): () => void {
    this.eventHandlers.push(handler)
    return () => {
      const idx = this.eventHandlers.indexOf(handler)
      if (idx >= 0) this.eventHandlers.splice(idx, 1)
    }
  }

  private makeResult(
    verified: boolean,
    level: PoCVerificationLevel | null,
    hardwareIdHash: Hex | null,
    cloudProvider: string | null,
    region: string | null,
    deltaKey: string,
    error: string | null,
  ): VerificationResult {
    return {
      verified,
      level,
      hardwareIdHash,
      cloudProvider,
      region,
      score: verified ? 100 : 0,
      reputationDelta: REPUTATION_DELTA[deltaKey] ?? 0,
      error,
    }
  }

  private fail(
    agentId: bigint,
    deltaKey: string,
    error: string,
    hardwareIdHash: Hex | null = null,
    cloudProvider: string | null = null,
    region: string | null = null,
  ): VerificationResult {
    this.emit({ type: 'node:poc_failed', nodeAgentId: agentId, reason: error })
    return this.makeResult(
      false,
      null,
      hardwareIdHash,
      cloudProvider,
      region,
      deltaKey,
      error,
    )
  }

  private emit(event: InfraEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        Promise.resolve(handler(event)).catch((err) =>
          console.error('[PoCNodeVerifier] Event handler error:', err),
        )
      } catch (err) {
        console.error('[PoCNodeVerifier] Event handler error:', err)
      }
    }
  }

  static fromEnv(): PoCNodeVerifier {
    const network = process.env.JEJU_NETWORK ?? 'localnet'
    const hardwareIdSalt = process.env.HARDWARE_ID_SALT

    if (!hardwareIdSalt && network === 'mainnet') {
      throw new Error('HARDWARE_ID_SALT required for mainnet')
    }

    initializePoCSystem()

    return new PoCNodeVerifier({
      hardwareIdSalt: (hardwareIdSalt ?? `0x${'00'.repeat(32)}`) as Hex,
      cacheTtlMs: DEFAULT_CACHE_TTL_MS,
    })
  }
}

let instance: PoCNodeVerifier | null = null

export function getPoCNodeVerifier(): PoCNodeVerifier {
  if (!instance) {
    instance = PoCNodeVerifier.fromEnv()
  }
  return instance
}

export function initializePoCNodeVerifier(
  config: PoCNodeVerifierConfig,
): PoCNodeVerifier {
  instance = new PoCNodeVerifier(config)
  return instance
}

export function shutdownPoCNodeVerifier(): void {
  instance?.clearCache()
  instance = null
}

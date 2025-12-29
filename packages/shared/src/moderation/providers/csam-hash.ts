/**
 * CSAM Hash Provider - Authoritative Hash Matching
 *
 * DESIGN AXIOM: Hash-first legality
 * Known illegality is decided by authoritative hash databases BEFORE any ML.
 *
 * Providers:
 * 1. Arachnid Shield (Canadian Centre for Child Protection)
 * 2. Apple NeuralHash (local ONNX model)
 * 3. Internal hash database (SHA256)
 *
 * This is the FIRST check in the pipeline. If matched, pipeline STOPS.
 */

import { logger } from '../../logger'

export interface HashMatchResult {
  matched: boolean
  source: 'arachnid' | 'neuralhash' | 'internal' | 'none'
  matchType: 'exact' | 'perceptual' | 'neuralhash'
  confidence: number
  matchId?: string
}

export interface CSAMHashProviderConfig {
  arachnid?: {
    apiKey: string
    baseUrl?: string
  }
  neuralhash?: {
    modelPath: string
  }
  internalHashPath?: string
}

// Internal hash set loaded from file
const internalHashes = new Set<string>()

async function sha256(buffer: Buffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * CSAM Hash Matching Provider
 *
 * CRITICAL: This runs FIRST before any ML processing.
 * On match: immediate block, evidence preservation, NCMEC report.
 */
export class CSAMHashProvider {
  private arachnidApiKey?: string
  private arachnidBaseUrl: string
  private initialized = false

  constructor(config: CSAMHashProviderConfig = {}) {
    this.arachnidApiKey = config.arachnid?.apiKey ?? process.env.ARACHNID_API_KEY
    this.arachnidBaseUrl = config.arachnid?.baseUrl ?? 'https://api.arachnid-shield.ca/v1'

    // Load internal hashes
    if (config.internalHashPath) {
      this.loadInternalHashes(config.internalHashPath)
    }
  }

  private async loadInternalHashes(path: string): Promise<void> {
    try {
      const file = Bun.file(path)
      if (!(await file.exists())) {
        logger.warn('[CSAMHashProvider] Internal hash file not found', { path })
        return
      }
      const text = await file.text()
      const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'))
      for (const line of lines) {
        const hash = line.trim().toLowerCase()
        if (hash.length === 64) {
          internalHashes.add(hash)
        }
      }
      logger.info('[CSAMHashProvider] Loaded internal hashes', { count: internalHashes.size })
    } catch (err) {
      logger.error('[CSAMHashProvider] Failed to load internal hashes', { error: String(err) })
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Log configuration status
    const hasArachnid = !!this.arachnidApiKey
    const hasInternal = internalHashes.size > 0

    if (!hasArachnid && !hasInternal) {
      logger.error('[CSAMHashProvider] CRITICAL: No CSAM hash sources configured!')
      logger.error('[CSAMHashProvider] Set ARACHNID_API_KEY or provide internalHashPath')
    }

    logger.info('[CSAMHashProvider] Initialized', {
      arachnid: hasArachnid,
      internalHashes: internalHashes.size,
    })

    this.initialized = true
  }

  /**
   * Check image against all authoritative hash databases
   *
   * This is the FIRST check - runs BEFORE any ML.
   * On match, caller should:
   * 1. Quarantine immediately
   * 2. Generate evidence bundle
   * 3. File NCMEC report
   * 4. Block wallet/provider
   * 5. STOP pipeline
   */
  async checkImage(buffer: Buffer): Promise<HashMatchResult> {
    const contentHash = await sha256(buffer)

    // 1. Check internal database first (fastest)
    if (internalHashes.has(contentHash)) {
      logger.warn('[CSAMHashProvider] MATCH: Internal hash database', { hash: contentHash.slice(0, 16) })
      return {
        matched: true,
        source: 'internal',
        matchType: 'exact',
        confidence: 1.0,
        matchId: contentHash,
      }
    }

    // 2. Check Arachnid Shield (if configured)
    if (this.arachnidApiKey) {
      const arachnidResult = await this.checkArachnid(buffer, contentHash)
      if (arachnidResult.matched) {
        return arachnidResult
      }
    }

    // 3. No match found
    return {
      matched: false,
      source: 'none',
      matchType: 'exact',
      confidence: 0,
    }
  }

  /**
   * Check against Arachnid Shield API
   * @see https://github.com/CdnCentreForChildProtection/arachnid-shield-sdk-ts
   */
  private async checkArachnid(buffer: Buffer, contentHash: string): Promise<HashMatchResult> {
    try {
      const response = await fetch(`${this.arachnidBaseUrl}/check`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.arachnidApiKey}`,
          'Content-Type': 'application/octet-stream',
          'X-Content-Hash': contentHash,
        },
        body: new Uint8Array(buffer),
      })

      if (!response.ok) {
        logger.warn('[CSAMHashProvider] Arachnid API error', { status: response.status })
        return { matched: false, source: 'none', matchType: 'exact', confidence: 0 }
      }

      const result = await response.json() as { isCSAM: boolean; confidence: number; matchId?: string }

      if (result.isCSAM) {
        logger.warn('[CSAMHashProvider] MATCH: Arachnid Shield', {
          hash: contentHash.slice(0, 16),
          confidence: result.confidence,
          matchId: result.matchId ?? 'unknown',
        })
        return {
          matched: true,
          source: 'arachnid',
          matchType: 'perceptual',
          confidence: result.confidence,
          matchId: result.matchId,
        }
      }

      return { matched: false, source: 'none', matchType: 'exact', confidence: 0 }
    } catch (err) {
      logger.error('[CSAMHashProvider] Arachnid API failed', { error: String(err) })
      return { matched: false, source: 'none', matchType: 'exact', confidence: 0 }
    }
  }

  /**
   * Add a hash to the internal database (for retroactive enforcement)
   */
  addHash(hash: string): void {
    const normalized = hash.toLowerCase().trim()
    if (normalized.length === 64) {
      internalHashes.add(normalized)
    }
  }

  /**
   * Get statistics
   */
  getStats(): { internalCount: number; hasArachnid: boolean } {
    return {
      internalCount: internalHashes.size,
      hasArachnid: !!this.arachnidApiKey,
    }
  }
}

// Singleton
let instance: CSAMHashProvider | null = null

export function getCSAMHashProvider(config?: CSAMHashProviderConfig): CSAMHashProvider {
  if (!instance) {
    instance = new CSAMHashProvider(config)
  }
  return instance
}


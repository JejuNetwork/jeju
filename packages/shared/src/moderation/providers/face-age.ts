/**
 * Face Detection + Age Estimation Provider
 *
 * DESIGN AXIOM: Conservative youth handling
 * Any ambiguity involving minors → quarantine + internal handling only.
 *
 * DESIGN AXIOM: No derivative contraband
 * - NO face embeddings stored
 * - NO face crops persisted
 * - Process in memory only
 * - Results discarded after decision
 *
 * This provider detects faces and estimates ages to determine
 * if content should be routed to the restricted review queue.
 */

import { logger } from '../../logger'

export interface FaceDetection {
  boundingBox: [x: number, y: number, width: number, height: number]
  confidence: number
}

export interface AgeEstimate {
  minAge: number
  maxAge: number
  confidence: number
}

export interface FaceAgeResult {
  faceCount: number
  faces: Array<{
    detection: FaceDetection
    age: AgeEstimate
  }>
  minAgeEstimate: number
  minAgeConfidence: number
  hasYouthAmbiguity: boolean
  processingTimeMs: number
}

export interface FaceAgeProviderConfig {
  /** Age threshold for adult determination (default: 18) */
  adultAgeThreshold?: number
  /** Buffer years to add to threshold for safety (default: 3) */
  ageBuffer?: number
  /** Minimum confidence to consider age estimate reliable (default: 0.85) */
  minConfidence?: number
}

const DEFAULT_CONFIG = {
  adultAgeThreshold: 18,
  ageBuffer: 3, // Conservative: treat anyone appearing under 21 as ambiguous
  minConfidence: 0.85,
}

/**
 * Face/Age Detection Provider
 *
 * Currently uses simple heuristics. Will be enhanced with:
 * - RetinaFace / SCRFD for face detection
 * - DEX (Deep EXpectation) for age estimation
 *
 * CRITICAL: All processing is in-memory.
 * No embeddings or crops are stored.
 */
export class FaceAgeProvider {
  private config: typeof DEFAULT_CONFIG
  private initialized = false

  constructor(config: FaceAgeProviderConfig = {}) {
    this.config = {
      adultAgeThreshold: config.adultAgeThreshold ?? DEFAULT_CONFIG.adultAgeThreshold,
      ageBuffer: config.ageBuffer ?? DEFAULT_CONFIG.ageBuffer,
      minConfidence: config.minConfidence ?? DEFAULT_CONFIG.minConfidence,
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // TODO: Load face detection and age estimation models
    // For now, using skin detection heuristics

    logger.info('[FaceAgeProvider] Initialized', {
      mode: 'heuristic', // Will be 'ml' when models are loaded
      adultThreshold: this.config.adultAgeThreshold + this.config.ageBuffer,
    })

    this.initialized = true
  }

  /**
   * Analyze image for faces and estimate ages
   *
   * Conservative approach:
   * - If ANY face appears potentially under 21, mark as youth-ambiguous
   * - If confidence is low, mark as youth-ambiguous
   * - When in doubt, quarantine
   */
  async analyze(buffer: Buffer): Promise<FaceAgeResult> {
    const start = Date.now()

    // Basic validation
    if (!buffer || buffer.length < 100) {
      return this.emptyResult(start)
    }

    // Detect skin/person presence first
    const hasSkin = this.detectSkinPresence(buffer)
    if (!hasSkin) {
      return this.emptyResult(start)
    }

    // For now, use conservative heuristics
    // Any image with detected skin should be checked for CSAM
    // We mark as potentially having faces to trigger the NSFW check
    const result: FaceAgeResult = {
      faceCount: 1, // Assume potential face if skin detected
      faces: [{
        detection: {
          boundingBox: [0, 0, 0, 0], // Placeholder
          confidence: 0.5,
        },
        age: {
          minAge: 0, // Unknown - conservative
          maxAge: 100,
          confidence: 0.1, // Low confidence triggers ambiguity
        },
      }],
      minAgeEstimate: 0,
      minAgeConfidence: 0.1,
      hasYouthAmbiguity: true, // Conservative: if skin detected, assume potential minor
      processingTimeMs: Date.now() - start,
    }

    return result
  }

  /**
   * Quick check: does image likely contain a person?
   *
   * Used for early-exit optimization.
   * If no person detected, skip age estimation.
   */
  async quickPersonCheck(buffer: Buffer): Promise<boolean> {
    return this.detectSkinPresence(buffer)
  }

  /**
   * Detect skin-like colors in image
   *
   * Simple heuristic: look for pixels in skin-tone ranges.
   * This is intentionally conservative - false positives are acceptable.
   */
  private detectSkinPresence(buffer: Buffer): boolean {
    // Sample pixels from raw buffer
    // This is a very rough heuristic - will be replaced with proper detection
    let skinPixels = 0
    const sampleSize = Math.min(1000, Math.floor(buffer.length / 3))

    for (let i = 0; i < sampleSize; i++) {
      const offset = i * 3
      const r = buffer[offset] ?? 0
      const g = buffer[offset + 1] ?? 0
      const b = buffer[offset + 2] ?? 0

      // Rough skin detection in RGB space
      // Very permissive to catch all potential skin tones
      if (this.isSkinColor(r, g, b)) {
        skinPixels++
      }
    }

    // If more than 5% of sampled pixels are skin-like, flag for review
    const skinRatio = skinPixels / sampleSize
    return skinRatio > 0.05
  }

  /**
   * Check if RGB values could be skin
   *
   * Very permissive - better to have false positives than miss anything
   */
  private isSkinColor(r: number, g: number, b: number): boolean {
    // Minimum brightness
    if (r + g + b < 100) return false

    // R should be highest or close
    if (r < g - 20 || r < b - 20) return false

    // Not too saturated
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max - min > 150) return false

    // Common skin ranges
    if (r > 95 && g > 40 && b > 20 && r > g && r > b) {
      return true
    }

    return false
  }

  private emptyResult(start: number): FaceAgeResult {
    return {
      faceCount: 0,
      faces: [],
      minAgeEstimate: 100, // No face = assume adult content
      minAgeConfidence: 1.0,
      hasYouthAmbiguity: false,
      processingTimeMs: Date.now() - start,
    }
  }

  /**
   * Determine if content should be quarantined based on age analysis
   */
  shouldQuarantine(result: FaceAgeResult, hasNudity: boolean): boolean {
    // No faces, no quarantine needed for age reasons
    if (result.faceCount === 0) return false

    // If there's nudity AND any youth ambiguity, quarantine
    if (hasNudity && result.hasYouthAmbiguity) return true

    // Conservative: low confidence on age + any nudity = quarantine
    if (hasNudity && result.minAgeConfidence < this.config.minConfidence) return true

    // Age estimate below threshold + buffer
    const effectiveThreshold = this.config.adultAgeThreshold + this.config.ageBuffer
    if (hasNudity && result.minAgeEstimate < effectiveThreshold) return true

    return false
  }
}

// Singleton
let instance: FaceAgeProvider | null = null

export function getFaceAgeProvider(config?: FaceAgeProviderConfig): FaceAgeProvider {
  if (!instance) {
    instance = new FaceAgeProvider(config)
  }
  return instance
}


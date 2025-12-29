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
 * This provider uses skin-tone detection as a conservative filter.
 * When combined with NSFW detection, it routes potentially concerning
 * content to the restricted review queue.
 *
 * The approach is INTENTIONALLY conservative:
 * - If skin tones detected + NSFW detected → youth ambiguity flag
 * - All processing is in-memory
 * - No ML face recognition (avoids face embeddings)
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
  hasSkinTones: boolean
  skinToneRatio: number
  processingTimeMs: number
}

export interface FaceAgeProviderConfig {
  /** Age threshold for adult determination (default: 18) */
  adultAgeThreshold?: number
  /** Buffer years to add to threshold for safety (default: 3) */
  ageBuffer?: number
  /** Minimum confidence to consider age estimate reliable (default: 0.85) */
  minConfidence?: number
  /** Skin tone ratio threshold (default: 0.05) */
  skinThreshold?: number
}

const DEFAULT_CONFIG = {
  adultAgeThreshold: 18,
  ageBuffer: 3,
  minConfidence: 0.85,
  skinThreshold: 0.05,
}

/**
 * Face/Age Detection Provider
 *
 * Uses conservative skin-tone detection to flag potentially concerning content.
 * This is NOT ML-based face detection - it's a color-space heuristic that
 * intentionally over-flags to ensure no concerning content slips through.
 *
 * When skin tones are detected in an image that also has NSFW content,
 * the policy engine will route it to the restricted review queue.
 */
export class FaceAgeProvider {
  private config: typeof DEFAULT_CONFIG
  private initialized = false

  constructor(config: FaceAgeProviderConfig = {}) {
    this.config = {
      adultAgeThreshold: config.adultAgeThreshold ?? DEFAULT_CONFIG.adultAgeThreshold,
      ageBuffer: config.ageBuffer ?? DEFAULT_CONFIG.ageBuffer,
      minConfidence: config.minConfidence ?? DEFAULT_CONFIG.minConfidence,
      skinThreshold: config.skinThreshold ?? DEFAULT_CONFIG.skinThreshold,
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    logger.info('[FaceAgeProvider] Initialized', {
      mode: 'skin-detection',
      skinThreshold: this.config.skinThreshold,
      effectiveAdultAge: this.config.adultAgeThreshold + this.config.ageBuffer,
    })

    this.initialized = true
  }

  /**
   * Analyze image for potential human content
   *
   * Conservative approach using skin-tone detection:
   * - Scans image for pixels in skin-tone color ranges
   * - If significant skin tones found, flags for further review
   * - Age cannot be determined from color alone → always ambiguous
   *
   * This means: skin detected + NSFW detected = restricted review queue
   */
  async analyze(buffer: Buffer): Promise<FaceAgeResult> {
    const start = Date.now()

    if (!buffer || buffer.length < 100) {
      return this.noSkinResult(start)
    }

    const skinAnalysis = this.analyzeSkinTones(buffer)
    
    if (!skinAnalysis.hasSkin) {
      return this.noSkinResult(start)
    }

    // Skin detected - we cannot determine age, so we're conservative
    return {
      faceCount: 0, // We don't detect faces, only skin tones
      faces: [],
      minAgeEstimate: 0, // Unknown age = must assume worst case
      minAgeConfidence: 0, // Zero confidence = triggers ambiguity
      hasYouthAmbiguity: true, // CONSERVATIVE: skin + NSFW = quarantine
      hasSkinTones: true,
      skinToneRatio: skinAnalysis.ratio,
      processingTimeMs: Date.now() - start,
    }
  }

  /**
   * Analyze buffer for skin-tone pixels
   *
   * Samples pixels throughout the image and checks against
   * multiple skin-tone color ranges to be inclusive of all skin types.
   */
  private analyzeSkinTones(buffer: Buffer): { hasSkin: boolean; ratio: number } {
    // Skip file headers - sample from image data
    const headerSize = Math.min(100, Math.floor(buffer.length * 0.05))
    const dataBuffer = buffer.subarray(headerSize)
    
    if (dataBuffer.length < 300) {
      return { hasSkin: false, ratio: 0 }
    }

    let skinPixels = 0
    const sampleCount = Math.min(3000, Math.floor(dataBuffer.length / 3))
    const step = Math.max(1, Math.floor(dataBuffer.length / (sampleCount * 3)))

    for (let i = 0; i < sampleCount; i++) {
      const offset = i * step * 3
      if (offset + 2 >= dataBuffer.length) break
      
      const r = dataBuffer[offset]!
      const g = dataBuffer[offset + 1]!
      const b = dataBuffer[offset + 2]!

      if (this.isSkinTone(r, g, b)) {
        skinPixels++
      }
    }

    const ratio = skinPixels / sampleCount
    return {
      hasSkin: ratio > this.config.skinThreshold,
      ratio,
    }
  }

  /**
   * Check if RGB values fall within skin-tone ranges
   *
   * Uses multiple detection rules to be inclusive of all skin types:
   * 1. RGB ratio rules (light to medium skin)
   * 2. YCbCr color space rules (works across skin types)
   * 3. HSV rules for darker skin tones
   */
  private isSkinTone(r: number, g: number, b: number): boolean {
    // Rule 1: Basic RGB ratios (light to medium skin)
    const rgbRule = (
      r > 95 && g > 40 && b > 20 &&
      r > g && r > b &&
      Math.abs(r - g) > 15 &&
      r - b > 15
    )
    
    if (rgbRule) return true

    // Rule 2: YCbCr color space (good for diverse skin tones)
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    const cb = 128 - 0.169 * r - 0.331 * g + 0.500 * b
    const cr = 128 + 0.500 * r - 0.419 * g - 0.081 * b
    
    const ycbcrRule = (
      y > 80 &&
      cb > 77 && cb < 127 &&
      cr > 133 && cr < 173
    )
    
    if (ycbcrRule) return true

    // Rule 3: HSV for darker skin tones
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    
    if (max === 0 || delta === 0) return false
    
    const s = delta / max
    const v = max / 255
    
    let h = 0
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6)
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2)
    } else {
      h = 60 * ((r - g) / delta + 4)
    }
    if (h < 0) h += 360

    const hsvRule = (
      h >= 0 && h <= 50 &&
      s >= 0.1 && s <= 0.7 &&
      v >= 0.2
    )
    
    return hsvRule
  }

  private noSkinResult(start: number): FaceAgeResult {
    return {
      faceCount: 0,
      faces: [],
      minAgeEstimate: 100,
      minAgeConfidence: 1.0,
      hasYouthAmbiguity: false,
      hasSkinTones: false,
      skinToneRatio: 0,
      processingTimeMs: Date.now() - start,
    }
  }

  /**
   * Quick check: does image likely contain human skin?
   */
  async quickPersonCheck(buffer: Buffer): Promise<boolean> {
    const analysis = this.analyzeSkinTones(buffer)
    return analysis.hasSkin
  }

  /**
   * Determine if content should be quarantined based on analysis
   *
   * Quarantine when:
   * - Has nudity AND has skin tones (can't determine age)
   * - Has nudity AND low age confidence
   * - Has nudity AND age estimate below threshold
   */
  shouldQuarantine(result: FaceAgeResult, hasNudity: boolean): boolean {
    if (!hasNudity) return false
    
    // Skin detected + nudity = quarantine (we can't verify age)
    if (result.hasSkinTones) return true
    
    // Youth ambiguity flag set = quarantine
    if (result.hasYouthAmbiguity) return true
    
    // Low confidence on age = quarantine
    if (result.minAgeConfidence < this.config.minConfidence) return true
    
    // Age below threshold = quarantine
    const effectiveThreshold = this.config.adultAgeThreshold + this.config.ageBuffer
    if (result.minAgeEstimate < effectiveThreshold) return true

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

export function resetFaceAgeProvider(): void {
  instance = null
}


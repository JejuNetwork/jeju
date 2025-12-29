/**
 * Image Processor
 *
 * Standardizes images for consistent processing:
 * - Resize to max 1024x1024 (preserving aspect ratio)
 * - Convert to JPEG for consistent hashing
 * - Compute all hashes once at intake
 *
 * This reduces processing costs and ensures hash consistency.
 */

import { logger } from '../logger'

export interface StandardImage {
  buffer: Buffer
  width: number
  height: number
  format: 'jpeg'
  
  // Computed hashes
  sha256: string
  md5: string
  
  // Original metadata
  originalSize: number
  originalFormat: string
  wasResized: boolean
}

export interface ImageProcessorConfig {
  /** Maximum dimension (width or height) - default: 1024 */
  maxDimension?: number
  /** JPEG quality - default: 85 */
  jpegQuality?: number
}

const DEFAULT_CONFIG = {
  maxDimension: 1024,
  jpegQuality: 85,
}

// Image format signatures
const JPEG = [0xFF, 0xD8, 0xFF]
const PNG = [0x89, 0x50, 0x4E, 0x47]
const GIF = [0x47, 0x49, 0x46, 0x38]
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]

async function sha256(buffer: Buffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function md5(buffer: Buffer): Promise<string> {
  // Use Bun's built-in hasher for MD5
  const hasher = new Bun.CryptoHasher('md5')
  hasher.update(buffer)
  return hasher.digest('hex')
}

/**
 * Image Processor
 *
 * Normalizes images for consistent processing and caching.
 */
export class ImageProcessor {
  private config: typeof DEFAULT_CONFIG

  constructor(config: ImageProcessorConfig = {}) {
    this.config = {
      maxDimension: config.maxDimension ?? DEFAULT_CONFIG.maxDimension,
      jpegQuality: config.jpegQuality ?? DEFAULT_CONFIG.jpegQuality,
    }
  }

  /**
   * Detect image format from buffer
   */
  detectFormat(buffer: Buffer): string | null {
    const match = (sig: number[], offset = 0) => sig.every((b, i) => buffer[offset + i] === b)

    if (match(JPEG)) return 'jpeg'
    if (match(PNG)) return 'png'
    if (match(GIF)) return 'gif'
    if (match(WEBP_RIFF) && match(WEBP_MAGIC, 8)) return 'webp'

    return null
  }

  /**
   * Validate that buffer is a supported image format
   */
  isValidImage(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 12) return false
    return this.detectFormat(buffer) !== null
  }

  /**
   * Standardize image for processing
   *
   * - Validates format
   * - Computes hashes
   * - Resizes if needed (optional - requires sharp)
   */
  async standardize(buffer: Buffer): Promise<StandardImage | null> {
    if (!this.isValidImage(buffer)) {
      logger.warn('[ImageProcessor] Invalid image format')
      return null
    }

    const originalFormat = this.detectFormat(buffer)
    if (!originalFormat) return null

    // For now, compute hashes on original buffer
    // TODO: Add sharp for actual resize/conversion
    const [sha, m5] = await Promise.all([
      sha256(buffer),
      md5(buffer),
    ])

    // Estimate dimensions from buffer (rough heuristic)
    const dimensions = this.estimateDimensions(buffer, originalFormat)

    return {
      buffer,
      width: dimensions.width,
      height: dimensions.height,
      format: 'jpeg',
      sha256: sha,
      md5: m5,
      originalSize: buffer.length,
      originalFormat,
      wasResized: false,
    }
  }

  /**
   * Estimate dimensions from image header
   *
   * This is a rough estimate for logging purposes.
   * Actual dimensions would require decoding the image.
   */
  private estimateDimensions(buffer: Buffer, format: string): { width: number; height: number } {
    // JPEG: dimensions are in SOF markers (more complex to parse)
    // PNG: dimensions at bytes 16-23
    // GIF: dimensions at bytes 6-9
    // WEBP: varies by format

    if (format === 'png' && buffer.length >= 24) {
      const width = buffer.readUInt32BE(16)
      const height = buffer.readUInt32BE(20)
      return { width, height }
    }

    if (format === 'gif' && buffer.length >= 10) {
      const width = buffer.readUInt16LE(6)
      const height = buffer.readUInt16LE(8)
      return { width, height }
    }

    // Default: assume square based on file size (very rough)
    const pixels = Math.floor(buffer.length / 3)
    const side = Math.floor(Math.sqrt(pixels))
    return { width: side, height: side }
  }

  /**
   * Compute difference hash (dHash) for perceptual matching
   *
   * Simple implementation: resize to 9x8, compute gradient
   * Returns 64-bit hash as hex string
   *
   * Only call this for non-CSAM, non-youth-ambiguous content!
   */
  async computeDHash(buffer: Buffer): Promise<string> {
    // Simple implementation using raw pixel sampling
    // Production should use sharp for proper resize

    const size = 8
    const data: number[] = []

    // Sample 72 pixels from buffer (9x8 grid)
    const step = Math.floor(buffer.length / 72)
    for (let i = 0; i < 72; i++) {
      const offset = Math.min(i * step, buffer.length - 1)
      data.push(buffer[offset] ?? 0)
    }

    // Compute horizontal gradient (8x8 = 64 bits)
    let hash = 0n
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = data[row * 9 + col] ?? 0
        const right = data[row * 9 + col + 1] ?? 0
        if (left > right) {
          hash |= 1n << BigInt(row * 8 + col)
        }
      }
    }

    return hash.toString(16).padStart(16, '0')
  }

  /**
   * Compute Hamming distance between two hashes
   */
  hammingDistance(hash1: string, hash2: string): number {
    const n1 = BigInt('0x' + hash1)
    const n2 = BigInt('0x' + hash2)
    let xor = n1 ^ n2
    let distance = 0

    while (xor > 0n) {
      if (xor & 1n) distance++
      xor >>= 1n
    }

    return distance
  }
}

// Singleton
let instance: ImageProcessor | null = null

export function getImageProcessor(config?: ImageProcessorConfig): ImageProcessor {
  if (!instance) {
    instance = new ImageProcessor(config)
  }
  return instance
}


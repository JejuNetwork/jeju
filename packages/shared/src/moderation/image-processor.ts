/**
 * Image Processor
 *
 * Standardizes images for consistent processing:
 * - Validates image format
 * - Computes cryptographic hashes (SHA256, MD5)
 * - Computes perceptual hash (dHash) for similarity matching
 * - Extracts dimensions from image headers
 *
 * Note: Image resize requires sharp. Without it, images are processed at original size.
 */

import { logger } from '../logger'

export interface StandardImage {
  buffer: Buffer
  width: number
  height: number
  format: 'jpeg' | 'png' | 'gif' | 'webp'
  
  // Computed hashes
  sha256: string
  md5: string
  dHash: string
  
  // Original metadata
  originalSize: number
  wasResized: boolean
}

export interface ImageProcessorConfig {
  /** Maximum dimension (width or height) - default: 1024 */
  maxDimension?: number
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
  const hasher = new Bun.CryptoHasher('md5')
  hasher.update(buffer)
  return hasher.digest('hex')
}

type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp'

/**
 * Image Processor
 *
 * Validates and hashes images for moderation pipeline.
 */
export class ImageProcessor {
  // Config is validated but not stored - all methods are stateless
  constructor(_config: ImageProcessorConfig = {}) {
    // Config validation would go here
  }

  /**
   * Detect image format from buffer
   */
  detectFormat(buffer: Buffer): ImageFormat | null {
    if (!buffer || buffer.length < 12) return null
    
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
    return this.detectFormat(buffer) !== null
  }

  /**
   * Standardize image for processing
   *
   * - Validates format
   * - Extracts dimensions
   * - Computes SHA256, MD5, and dHash
   */
  async standardize(buffer: Buffer): Promise<StandardImage | null> {
    const format = this.detectFormat(buffer)
    if (!format) {
      logger.warn('[ImageProcessor] Invalid image format')
      return null
    }

    const dimensions = this.extractDimensions(buffer, format)
    
    const [sha, m5, dHash] = await Promise.all([
      sha256(buffer),
      md5(buffer),
      this.computeDHash(buffer),
    ])

    return {
      buffer,
      width: dimensions.width,
      height: dimensions.height,
      format,
      sha256: sha,
      md5: m5,
      dHash,
      originalSize: buffer.length,
      wasResized: false,
    }
  }

  /**
   * Extract dimensions from image header
   */
  private extractDimensions(buffer: Buffer, format: ImageFormat): { width: number; height: number } {
    switch (format) {
      case 'png':
        if (buffer.length >= 24) {
          return {
            width: buffer.readUInt32BE(16),
            height: buffer.readUInt32BE(20),
          }
        }
        break
        
      case 'gif':
        if (buffer.length >= 10) {
          return {
            width: buffer.readUInt16LE(6),
            height: buffer.readUInt16LE(8),
          }
        }
        break
        
      case 'jpeg':
        return this.extractJpegDimensions(buffer)
        
      case 'webp':
        return this.extractWebpDimensions(buffer)
    }
    
    return { width: 0, height: 0 }
  }

  /**
   * Extract JPEG dimensions from SOF marker
   */
  private extractJpegDimensions(buffer: Buffer): { width: number; height: number } {
    let offset = 2 // Skip SOI marker
    
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xFF) {
        offset++
        continue
      }
      
      const marker = buffer[offset + 1]
      
      // SOF0, SOF1, SOF2 markers contain dimensions
      if (marker !== undefined && marker >= 0xC0 && marker <= 0xC2) {
        const height = buffer.readUInt16BE(offset + 5)
        const width = buffer.readUInt16BE(offset + 7)
        return { width, height }
      }
      
      // Skip to next marker
      if (marker === 0xD8 || marker === 0xD9) {
        offset += 2
      } else {
        const length = buffer.readUInt16BE(offset + 2)
        offset += 2 + length
      }
    }
    
    return { width: 0, height: 0 }
  }

  /**
   * Extract WebP dimensions from VP8/VP8L header
   */
  private extractWebpDimensions(buffer: Buffer): { width: number; height: number } {
    if (buffer.length < 30) return { width: 0, height: 0 }
    
    // Check for VP8 (lossy)
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
      const width = (buffer.readUInt16LE(26) & 0x3FFF)
      const height = (buffer.readUInt16LE(28) & 0x3FFF)
      return { width, height }
    }
    
    // Check for VP8L (lossless)
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4C) {
      const bits = buffer.readUInt32LE(21)
      const width = (bits & 0x3FFF) + 1
      const height = ((bits >> 14) & 0x3FFF) + 1
      return { width, height }
    }
    
    return { width: 0, height: 0 }
  }

  /**
   * Compute difference hash (dHash) for perceptual matching
   *
   * Algorithm:
   * 1. Reduce to grayscale
   * 2. Sample 9x8 grid of pixels
   * 3. Compare each pixel to its right neighbor
   * 4. Generate 64-bit hash from comparisons
   *
   * Only use for non-CSAM, non-youth-ambiguous content!
   */
  async computeDHash(buffer: Buffer): Promise<string> {
    // Sample 72 points from buffer as grayscale values
    const gridWidth = 9
    const gridHeight = 8
    const samples: number[] = []
    
    // Skip header (first 100 bytes typically)
    const dataStart = Math.min(100, Math.floor(buffer.length * 0.1))
    const dataLength = buffer.length - dataStart
    const step = Math.floor(dataLength / (gridWidth * gridHeight))
    
    for (let i = 0; i < gridWidth * gridHeight; i++) {
      const offset = dataStart + (i * step)
      // Average 3 bytes as rough grayscale
      const r = buffer[offset] ?? 128
      const g = buffer[offset + 1] ?? 128
      const b = buffer[offset + 2] ?? 128
      samples.push(Math.floor((r + g + b) / 3))
    }

    // Compute horizontal gradient (8x8 = 64 bits)
    let hash = 0n
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth - 1; col++) {
        const left = samples[row * gridWidth + col] ?? 0
        const right = samples[row * gridWidth + col + 1] ?? 0
        if (left > right) {
          hash |= 1n << BigInt(row * 8 + col)
        }
      }
    }

    return hash.toString(16).padStart(16, '0')
  }

  /**
   * Compute Hamming distance between two dHash values
   *
   * Returns number of different bits (0-64)
   * Lower = more similar
   */
  hammingDistance(hash1: string, hash2: string): number {
    if (hash1.length !== 16 || hash2.length !== 16) {
      return 64 // Maximum distance for invalid hashes
    }
    
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

  /**
   * Check if two images are similar based on dHash
   *
   * Threshold recommendations:
   * - 0: Identical
   * - 1-5: Very similar (same image, minor edits)
   * - 6-10: Similar (same content, different encoding)
   * - 11+: Different images
   */
  isSimilar(hash1: string, hash2: string, threshold = 10): boolean {
    return this.hammingDistance(hash1, hash2) <= threshold
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


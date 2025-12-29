/**
 * NSFW/Adult Content Detection
 *
 * Tags adult content, flags for CSAM verification.
 * Local fallback - for real detection use Hive/AWS Rekognition.
 */

import type { ModerationProvider, ModerationResult } from '../types'

// Image magic bytes
const JPEG = [0xff, 0xd8, 0xff]
const PNG = [0x89, 0x50, 0x4e, 0x47]
const GIF = [0x47, 0x49, 0x46, 0x38]
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]

export interface NSFWProviderConfig {
  alwaysCheckCsam?: boolean
}

export class NSFWDetectionProvider {
  readonly name: ModerationProvider = 'nsfw_local'
  private alwaysCheckCsam: boolean

  constructor(config: NSFWProviderConfig = {}) {
    this.alwaysCheckCsam = config.alwaysCheckCsam ?? true
  }

  async moderateImage(buf: Buffer): Promise<ModerationResult & { metadata?: { needsCsamCheck: boolean } }> {
    const start = Date.now()

    if (!buf || buf.length < 12) {
      return this.error('Empty or invalid image', start)
    }

    if (!this.isValidImage(buf)) {
      return this.error('Invalid image format', start)
    }

    // Local provider can't detect adult content - flag all for CSAM check
    return {
      safe: true,
      action: 'allow',
      severity: 'none',
      categories: [],
      reviewRequired: false,
      processingTimeMs: Date.now() - start,
      providers: ['nsfw_local'],
      metadata: this.alwaysCheckCsam ? { needsCsamCheck: true } : undefined,
    }
  }

  private isValidImage(buf: Buffer): boolean {
    const match = (sig: number[], offset = 0) => sig.every((b, i) => buf[offset + i] === b)
    return match(JPEG) || match(PNG) || match(GIF) ||
      (match(WEBP_RIFF) && match(WEBP_MAGIC, 8))
  }

  private error(reason: string, start: number): ModerationResult {
    return {
      safe: false,
      action: 'block',
      severity: 'low',
      categories: [],
      blockedReason: reason,
      reviewRequired: false,
      processingTimeMs: Date.now() - start,
      providers: ['nsfw_local'],
    }
  }
}

export function needsCsamVerification(result: ModerationResult): boolean {
  return (result as ModerationResult & { metadata?: { needsCsamCheck?: boolean } }).metadata?.needsCsamCheck === true
}

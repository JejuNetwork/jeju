/**
 * Media Optimizer - On-the-fly image and video processing
 *
 * Features:
 * - Image resizing, cropping, format conversion
 * - Video transcoding to multiple qualities
 * - Thumbnail generation
 * - CDN cache integration
 * - WebP/AVIF modern format support
 * - Responsive image generation
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

// ============ Types ============

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'svg'
export type VideoFormat = 'mp4' | 'webm' | 'hls' | 'dash'
export type FitMode = 'cover' | 'contain' | 'fill' | 'inside' | 'outside'

export interface ImageTransformOptions {
  width?: number
  height?: number
  fit?: FitMode
  format?: ImageFormat
  quality?: number
  blur?: number
  sharpen?: number
  grayscale?: boolean
  rotate?: number
  flip?: boolean
  flop?: boolean
  tint?: string
  background?: string
  crop?: { x: number; y: number; width: number; height: number }
  // Advanced options
  progressive?: boolean
  lossless?: boolean
  effort?: number // AVIF/WebP encoding effort (0-9)
}

export interface VideoTransformOptions {
  width?: number
  height?: number
  format?: VideoFormat
  quality?: 'low' | 'medium' | 'high' | 'ultra'
  fps?: number
  bitrate?: string
  codec?: string
  audioCodec?: string
  audioBitrate?: string
  startTime?: number
  duration?: number
  thumbnail?: boolean
  thumbnailTime?: number
}

export interface ResponsiveImageSet {
  srcset: string
  sizes: string
  placeholder?: string
  images: ResponsiveImage[]
}

export interface ResponsiveImage {
  src: string
  width: number
  height: number
  format: ImageFormat
  size: number
}

export interface VideoVariant {
  src: string
  format: VideoFormat
  quality: string
  width: number
  height: number
  bitrate: string
  size: number
}

export interface ThumbnailOptions {
  width?: number
  height?: number
  format?: ImageFormat
  quality?: number
  position?:
    | 'center'
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'entropy'
    | 'attention'
}

export interface MediaMetadata {
  type: 'image' | 'video'
  format: string
  width: number
  height: number
  size: number
  duration?: number // Video only
  hasAudio?: boolean // Video only
  colorSpace?: string
  hasAlpha?: boolean
  density?: number
  orientation?: number
}

export interface MediaCacheEntry {
  cid: string
  transformKey: string
  data: Buffer
  format: string
  width: number
  height: number
  size: number
  createdAt: number
  lastAccessed: number
  accessCount: number
}

export interface MediaOptimizerConfig {
  cacheDir: string
  maxCacheSize: number // Bytes
  maxCacheAge: number // Milliseconds
  defaultImageQuality: number
  defaultVideoQuality: 'low' | 'medium' | 'high' | 'ultra'
  enableWebP: boolean
  enableAVIF: boolean
  avifEnabled: boolean
  ffmpegPath?: string
}

// ============ Video Quality Presets ============

const VIDEO_QUALITY_PRESETS = {
  low: { width: 480, bitrate: '500k', audioBitrate: '64k' },
  medium: { width: 720, bitrate: '1500k', audioBitrate: '128k' },
  high: { width: 1080, bitrate: '4000k', audioBitrate: '192k' },
  ultra: { width: 2160, bitrate: '10000k', audioBitrate: '320k' },
} as const

// ============ Responsive Breakpoints ============

const RESPONSIVE_BREAKPOINTS = [
  320, 480, 640, 768, 1024, 1280, 1536, 1920, 2560,
]

// ============ Default Configuration ============

const DEFAULT_CONFIG: MediaOptimizerConfig = {
  cacheDir: join(tmpdir(), 'dws-media-cache'),
  maxCacheSize: 1024 * 1024 * 1024, // 1GB
  maxCacheAge: 86400000, // 24 hours
  defaultImageQuality: 80,
  defaultVideoQuality: 'medium',
  enableWebP: true,
  enableAVIF: true,
  avifEnabled: true,
  ffmpegPath: process.env.FFMPEG_PATH,
}

// ============ Media Optimizer Class ============

export class MediaOptimizer {
  private config: MediaOptimizerConfig
  private cache: Map<string, MediaCacheEntry> = new Map()
  private cacheSize = 0

  constructor(config?: Partial<MediaOptimizerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.ensureCacheDir()
  }

  private ensureCacheDir(): void {
    if (!existsSync(this.config.cacheDir)) {
      mkdirSync(this.config.cacheDir, { recursive: true })
    }
  }

  // ============ Image Processing ============

  async transformImage(
    input: Buffer,
    options: ImageTransformOptions,
  ): Promise<{ data: Buffer; metadata: MediaMetadata }> {
    // Check cache first
    const cacheKey = this.createCacheKey(input, options)
    const cached = this.getFromCache(cacheKey)
    if (cached) {
      return {
        data: cached.data,
        metadata: {
          type: 'image',
          format: cached.format,
          width: cached.width,
          height: cached.height,
          size: cached.size,
        },
      }
    }

    let pipeline = sharp(input)

    // Get original metadata
    const originalMeta = await pipeline.metadata()

    // Apply crop first if specified
    if (options.crop) {
      pipeline = pipeline.extract({
        left: options.crop.x,
        top: options.crop.y,
        width: options.crop.width,
        height: options.crop.height,
      })
    }

    // Resize
    if (options.width || options.height) {
      pipeline = pipeline.resize({
        width: options.width,
        height: options.height,
        fit: options.fit ?? 'cover',
        background: options.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
      })
    }

    // Rotation
    if (options.rotate) {
      pipeline = pipeline.rotate(options.rotate, {
        background: options.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
      })
    }

    // Flip/Flop
    if (options.flip) {
      pipeline = pipeline.flip()
    }
    if (options.flop) {
      pipeline = pipeline.flop()
    }

    // Effects
    if (options.blur) {
      pipeline = pipeline.blur(options.blur)
    }
    if (options.sharpen) {
      pipeline = pipeline.sharpen(options.sharpen)
    }
    if (options.grayscale) {
      pipeline = pipeline.grayscale()
    }
    if (options.tint) {
      pipeline = pipeline.tint(options.tint)
    }

    // Format conversion
    const format = options.format ?? this.detectBestFormat(originalMeta.format)
    const quality = options.quality ?? this.config.defaultImageQuality

    switch (format) {
      case 'jpeg':
        pipeline = pipeline.jpeg({
          quality,
          progressive: options.progressive ?? true,
        })
        break
      case 'png':
        pipeline = pipeline.png({
          quality,
          progressive: options.progressive,
          compressionLevel: 9 - Math.floor((options.effort ?? 6) / 1.5),
        })
        break
      case 'webp':
        pipeline = pipeline.webp({
          quality,
          lossless: options.lossless,
          effort: options.effort ?? 4,
        })
        break
      case 'avif':
        if (this.config.avifEnabled) {
          pipeline = pipeline.avif({
            quality,
            lossless: options.lossless,
            effort: options.effort ?? 4,
          })
        } else {
          // Fall back to WebP
          pipeline = pipeline.webp({ quality })
        }
        break
      case 'gif':
        pipeline = pipeline.gif()
        break
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })

    // Cache the result
    this.addToCache(cacheKey, {
      cid: createHash('sha256').update(input).digest('hex'),
      transformKey: cacheKey,
      data,
      format,
      width: info.width,
      height: info.height,
      size: data.length,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 1,
    })

    return {
      data,
      metadata: {
        type: 'image',
        format,
        width: info.width,
        height: info.height,
        size: data.length,
        hasAlpha: info.channels === 4,
        colorSpace: info.format ?? 'unknown',
      },
    }
  }

  private detectBestFormat(originalFormat: string | undefined): ImageFormat {
    // Prefer modern formats if enabled
    if (this.config.enableAVIF) return 'avif'
    if (this.config.enableWebP) return 'webp'

    // Fall back to original format or JPEG
    switch (originalFormat) {
      case 'png':
        return 'png'
      case 'gif':
        return 'gif'
      case 'webp':
        return 'webp'
      default:
        return 'jpeg'
    }
  }

  async generateResponsiveSet(
    input: Buffer,
    options?: {
      formats?: ImageFormat[]
      maxWidth?: number
      quality?: number
      includeOriginal?: boolean
      generatePlaceholder?: boolean
    },
  ): Promise<ResponsiveImageSet> {
    const formats = options?.formats ?? ['webp', 'jpeg']
    const maxWidth = options?.maxWidth ?? 2560
    const quality = options?.quality ?? this.config.defaultImageQuality

    // Get original dimensions
    const originalMeta = await sharp(input).metadata()
    const originalWidth = originalMeta.width ?? 1920

    // Filter breakpoints to only include smaller than original
    const breakpoints = RESPONSIVE_BREAKPOINTS.filter(
      (bp) => bp <= Math.min(originalWidth, maxWidth),
    )

    // Add original width if requested
    if (options?.includeOriginal && !breakpoints.includes(originalWidth)) {
      breakpoints.push(originalWidth)
    }

    const images: ResponsiveImage[] = []
    const srcsetParts: string[] = []

    // Generate each size/format combination
    for (const width of breakpoints) {
      for (const format of formats) {
        const { data, metadata } = await this.transformImage(input, {
          width,
          format,
          quality,
        })

        const cid = createHash('sha256').update(data).digest('hex')
        const src = `/storage/${cid}.${format}`

        images.push({
          src,
          width: metadata.width,
          height: metadata.height,
          format,
          size: data.length,
        })

        // Add to srcset (only for first format, typically WebP)
        if (format === formats[0]) {
          srcsetParts.push(`${src} ${width}w`)
        }
      }
    }

    // Generate placeholder (tiny blurred image)
    let placeholder: string | undefined
    if (options?.generatePlaceholder) {
      const { data } = await this.transformImage(input, {
        width: 20,
        format: 'webp',
        quality: 20,
        blur: 5,
      })
      placeholder = `data:image/webp;base64,${data.toString('base64')}`
    }

    // Generate sizes attribute
    const sizes = breakpoints
      .map((bp, i) => {
        if (i === breakpoints.length - 1) return `${bp}px`
        return `(max-width: ${bp}px) ${bp}px`
      })
      .join(', ')

    return {
      srcset: srcsetParts.join(', '),
      sizes,
      placeholder,
      images,
    }
  }

  async generateThumbnail(
    input: Buffer,
    options?: ThumbnailOptions,
  ): Promise<{ data: Buffer; metadata: MediaMetadata }> {
    const width = options?.width ?? 200
    const height = options?.height ?? 200
    const format = options?.format ?? 'webp'
    const quality = options?.quality ?? 60

    let pipeline = sharp(input).resize({
      width,
      height,
      fit: 'cover',
      position: options?.position ?? 'attention', // Smart crop
    })

    switch (format) {
      case 'webp':
        pipeline = pipeline.webp({ quality })
        break
      case 'jpeg':
        pipeline = pipeline.jpeg({ quality })
        break
      case 'png':
        pipeline = pipeline.png({ quality })
        break
      case 'avif':
        pipeline = pipeline.avif({ quality })
        break
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })

    return {
      data,
      metadata: {
        type: 'image',
        format,
        width: info.width,
        height: info.height,
        size: data.length,
      },
    }
  }

  async getImageMetadata(input: Buffer): Promise<MediaMetadata> {
    const meta = await sharp(input).metadata()

    return {
      type: 'image',
      format: meta.format ?? 'unknown',
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      size: input.length,
      colorSpace: meta.space,
      hasAlpha: meta.hasAlpha,
      density: meta.density,
      orientation: meta.orientation,
    }
  }

  // ============ Video Processing ============

  async transcodeVideo(
    inputPath: string,
    options: VideoTransformOptions,
  ): Promise<{ outputPath: string; metadata: MediaMetadata }> {
    const ffmpeg = this.config.ffmpegPath ?? 'ffmpeg'
    const outputFormat = options.format ?? 'mp4'
    const qualityPreset =
      VIDEO_QUALITY_PRESETS[options.quality ?? this.config.defaultVideoQuality]

    const outputId = createHash('sha256')
      .update(inputPath + JSON.stringify(options))
      .digest('hex')
    const outputPath = join(this.config.cacheDir, `${outputId}.${outputFormat}`)

    // Skip if already cached
    if (existsSync(outputPath)) {
      const metadata = await this.getVideoMetadata(outputPath)
      return { outputPath, metadata }
    }

    const args: string[] = [
      '-i',
      inputPath,
      '-y', // Overwrite output
    ]

    // Video settings
    const width = options.width ?? qualityPreset.width
    args.push('-vf', `scale=${width}:-2`) // Maintain aspect ratio

    if (options.fps) {
      args.push('-r', String(options.fps))
    }

    const bitrate = options.bitrate ?? qualityPreset.bitrate
    args.push('-b:v', bitrate)

    // Codec settings
    if (outputFormat === 'mp4') {
      args.push('-c:v', options.codec ?? 'libx264')
      args.push('-preset', 'medium')
      args.push('-crf', '23')
      args.push('-movflags', '+faststart') // Web optimization
    } else if (outputFormat === 'webm') {
      args.push('-c:v', options.codec ?? 'libvpx-vp9')
      args.push('-crf', '30')
    }

    // Audio settings
    if (options.audioCodec) {
      args.push('-c:a', options.audioCodec)
    } else if (outputFormat === 'mp4') {
      args.push('-c:a', 'aac')
    } else if (outputFormat === 'webm') {
      args.push('-c:a', 'libopus')
    }

    args.push('-b:a', options.audioBitrate ?? qualityPreset.audioBitrate)

    // Time range
    if (options.startTime !== undefined) {
      args.push('-ss', String(options.startTime))
    }
    if (options.duration !== undefined) {
      args.push('-t', String(options.duration))
    }

    args.push(outputPath)

    await this.runFFmpeg(ffmpeg, args)

    const metadata = await this.getVideoMetadata(outputPath)
    return { outputPath, metadata }
  }

  async generateVideoVariants(
    inputPath: string,
    options?: {
      formats?: VideoFormat[]
      qualities?: Array<'low' | 'medium' | 'high' | 'ultra'>
    },
  ): Promise<VideoVariant[]> {
    const formats = options?.formats ?? ['mp4', 'webm']
    const qualities = options?.qualities ?? ['medium', 'high']

    const variants: VideoVariant[] = []

    for (const format of formats) {
      for (const quality of qualities) {
        const preset = VIDEO_QUALITY_PRESETS[quality]
        const { outputPath, metadata } = await this.transcodeVideo(inputPath, {
          format,
          quality,
        })

        variants.push({
          src: outputPath,
          format,
          quality,
          width: metadata.width,
          height: metadata.height,
          bitrate: preset.bitrate,
          size: metadata.size,
        })
      }
    }

    return variants
  }

  async generateVideoThumbnail(
    inputPath: string,
    options?: {
      time?: number
      width?: number
      height?: number
      format?: ImageFormat
    },
  ): Promise<{ data: Buffer; metadata: MediaMetadata }> {
    const ffmpeg = this.config.ffmpegPath ?? 'ffmpeg'
    const time = options?.time ?? 1 // Default to 1 second
    const width = options?.width ?? 320
    const format = options?.format ?? 'webp'

    const outputId = createHash('sha256')
      .update(inputPath + String(time) + String(width) + format)
      .digest('hex')
    const outputPath = join(this.config.cacheDir, `thumb_${outputId}.${format}`)

    const args = [
      '-i',
      inputPath,
      '-ss',
      String(time),
      '-vframes',
      '1',
      '-vf',
      `scale=${width}:-2`,
    ]

    if (format === 'webp') {
      args.push('-c:v', 'libwebp')
    } else if (format === 'png') {
      args.push('-c:v', 'png')
    } else {
      args.push('-c:v', 'mjpeg')
    }

    args.push('-y', outputPath)

    await this.runFFmpeg(ffmpeg, args)

    const data = readFileSync(outputPath)
    const metadata = await this.getImageMetadata(data)

    // Clean up temp file
    rmSync(outputPath, { force: true })

    return { data, metadata }
  }

  async getVideoMetadata(inputPath: string): Promise<MediaMetadata> {
    const ffprobe =
      this.config.ffmpegPath?.replace('ffmpeg', 'ffprobe') ?? 'ffprobe'

    const args = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ]

    const output = await this.runCommand(ffprobe, args)
    const data = JSON.parse(output)

    const videoStream = data.streams?.find(
      (s: { codec_type: string }) => s.codec_type === 'video',
    )
    const audioStream = data.streams?.find(
      (s: { codec_type: string }) => s.codec_type === 'audio',
    )

    return {
      type: 'video',
      format: data.format?.format_name ?? 'unknown',
      width: videoStream?.width ?? 0,
      height: videoStream?.height ?? 0,
      size: Number(data.format?.size ?? 0),
      duration: Number(data.format?.duration ?? 0),
      hasAudio: !!audioStream,
    }
  }

  private runFFmpeg(ffmpegPath: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, args)

      let stderr = ''
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`))
        }
      })

      proc.on('error', (err) => {
        reject(err)
      })
    })
  }

  private runCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args)

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`))
        }
      })

      proc.on('error', (err) => {
        reject(err)
      })
    })
  }

  // ============ Caching ============

  private createCacheKey(
    input: Buffer,
    options: ImageTransformOptions | VideoTransformOptions,
  ): string {
    const inputHash = createHash('sha256')
      .update(input)
      .digest('hex')
      .slice(0, 16)
    const optionsHash = createHash('sha256')
      .update(JSON.stringify(options))
      .digest('hex')
      .slice(0, 8)
    return `${inputHash}_${optionsHash}`
  }

  private getFromCache(key: string): MediaCacheEntry | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    // Check if expired
    if (Date.now() - entry.createdAt > this.config.maxCacheAge) {
      this.cache.delete(key)
      this.cacheSize -= entry.size
      return undefined
    }

    entry.lastAccessed = Date.now()
    entry.accessCount++
    return entry
  }

  private addToCache(key: string, entry: MediaCacheEntry): void {
    // Evict if necessary
    while (this.cacheSize + entry.size > this.config.maxCacheSize) {
      this.evictLRU()
    }

    this.cache.set(key, entry)
    this.cacheSize += entry.size
  }

  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed
        oldestKey = key
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey)
      if (entry) {
        this.cacheSize -= entry.size
      }
      this.cache.delete(oldestKey)
    }
  }

  clearCache(): void {
    this.cache.clear()
    this.cacheSize = 0
  }

  getCacheStats(): {
    entries: number
    size: number
    maxSize: number
    hitRate: number
  } {
    let totalAccesses = 0
    for (const entry of this.cache.values()) {
      totalAccesses += entry.accessCount
    }

    return {
      entries: this.cache.size,
      size: this.cacheSize,
      maxSize: this.config.maxCacheSize,
      hitRate: this.cache.size > 0 ? totalAccesses / this.cache.size : 0,
    }
  }
}

// ============ Singleton Factory ============

let mediaOptimizer: MediaOptimizer | null = null

export function getMediaOptimizer(
  config?: Partial<MediaOptimizerConfig>,
): MediaOptimizer {
  if (!mediaOptimizer) {
    mediaOptimizer = new MediaOptimizer(config)
  }
  return mediaOptimizer
}

// ============ URL Parser for Transform Parameters ============

export function parseTransformParams(
  params: URLSearchParams,
): ImageTransformOptions {
  const options: ImageTransformOptions = {}

  const width = params.get('w') ?? params.get('width')
  if (width) options.width = Number.parseInt(width, 10)

  const height = params.get('h') ?? params.get('height')
  if (height) options.height = Number.parseInt(height, 10)

  const fit = params.get('fit')
  if (fit && ['cover', 'contain', 'fill', 'inside', 'outside'].includes(fit)) {
    options.fit = fit as FitMode
  }

  const format = params.get('f') ?? params.get('format')
  if (format && ['jpeg', 'png', 'webp', 'avif', 'gif'].includes(format)) {
    options.format = format as ImageFormat
  }

  const quality = params.get('q') ?? params.get('quality')
  if (quality) options.quality = Number.parseInt(quality, 10)

  const blur = params.get('blur')
  if (blur) options.blur = Number.parseFloat(blur)

  const sharpen = params.get('sharpen')
  if (sharpen) options.sharpen = Number.parseFloat(sharpen)

  if (params.has('grayscale') || params.has('gray')) options.grayscale = true

  const rotate = params.get('rotate')
  if (rotate) options.rotate = Number.parseInt(rotate, 10)

  if (params.has('flip')) options.flip = true
  if (params.has('flop')) options.flop = true

  const bg = params.get('bg') ?? params.get('background')
  if (bg) options.background = bg

  return options
}

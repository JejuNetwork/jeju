/**
 * Release types and schemas for app distribution
 */

import { z } from 'zod'

// Platform types
export const ReleasePlatformSchema = z.enum([
  'macos',
  'windows',
  'linux',
  'chrome',
  'firefox',
  'edge',
  'safari',
  'ios',
  'android',
])
export type ReleasePlatform = z.infer<typeof ReleasePlatformSchema>

// Architecture types
export const ReleaseArchSchema = z.enum(['x64', 'arm64', 'universal'])
export type ReleaseArch = z.infer<typeof ReleaseArchSchema>

// Release artifact schema
export const ReleaseArtifactSchema = z.object({
  platform: ReleasePlatformSchema,
  arch: ReleaseArchSchema.optional(),
  filename: z.string(),
  cid: z.string(), // IPFS CID for download
  size: z.number(),
  sha256: z.string(),
  minOsVersion: z.string().optional(),
  storeUrl: z.string().url().optional(), // App store / extension store URL
})
export type ReleaseArtifact = z.infer<typeof ReleaseArtifactSchema>

// Release manifest schema
export const ReleaseManifestSchema = z.object({
  app: z.string(),
  version: z.string(),
  releasedAt: z.string(),
  channel: z.enum(['stable', 'beta', 'nightly']).default('stable'),
  artifacts: z.array(ReleaseArtifactSchema),
  changelog: z.string().optional(),
  releaseNotes: z.string().optional(),
  minAppVersion: z.string().optional(), // Minimum version for auto-update
  signatures: z.record(z.string(), z.string()).optional(), // Code signing attestations
})
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>

// Release index (all versions for an app)
export const ReleaseIndexSchema = z.object({
  app: z.string(),
  latest: z.string(), // Latest stable version
  latestBeta: z.string().optional(),
  latestNightly: z.string().optional(),
  versions: z.array(
    z.object({
      version: z.string(),
      channel: z.enum(['stable', 'beta', 'nightly']),
      releasedAt: z.string(),
      manifestCid: z.string(),
    }),
  ),
})
export type ReleaseIndex = z.infer<typeof ReleaseIndexSchema>

// Platform detection helper types
export interface DetectedPlatform {
  os: 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'unknown'
  arch: 'arm64' | 'x64' | 'unknown'
  browser: 'chrome' | 'firefox' | 'edge' | 'safari' | 'unknown'
}

// Download info for UI
export interface DownloadInfo {
  platform: ReleasePlatform
  arch?: ReleaseArch
  label: string
  icon: string
  url: string
  size: string
  recommended: boolean
}

// App-specific release configuration
export const AppReleaseConfigSchema = z.object({
  appName: z.string(),
  displayName: z.string(),
  description: z.string(),
  platforms: z.array(ReleasePlatformSchema),
  hasDesktopApp: z.boolean().default(false),
  hasExtension: z.boolean().default(false),
  hasMobileApp: z.boolean().default(false),
  extensionStores: z
    .object({
      chrome: z.string().url().optional(),
      firefox: z.string().url().optional(),
      edge: z.string().url().optional(),
      safari: z.string().url().optional(),
    })
    .optional(),
  mobileStores: z
    .object({
      ios: z.string().url().optional(),
      android: z.string().url().optional(),
    })
    .optional(),
  autoUpdate: z.boolean().default(true),
  codeSigningRequired: z.boolean().default(false),
})
export type AppReleaseConfig = z.infer<typeof AppReleaseConfigSchema>

// Helper functions
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function getPlatformLabel(platform: ReleasePlatform): string {
  const labels: Record<ReleasePlatform, string> = {
    macos: 'macOS',
    windows: 'Windows',
    linux: 'Linux',
    chrome: 'Chrome',
    firefox: 'Firefox',
    edge: 'Edge',
    safari: 'Safari',
    ios: 'iOS',
    android: 'Android',
  }
  return labels[platform]
}

export function getPlatformIcon(platform: ReleasePlatform): string {
  const icons: Record<ReleasePlatform, string> = {
    macos: '🍎',
    windows: '🪟',
    linux: '🐧',
    chrome: '🌐',
    firefox: '🦊',
    edge: '🔵',
    safari: '🧭',
    ios: '📱',
    android: '🤖',
  }
  return icons[platform]
}

export function getArchLabel(arch: ReleaseArch): string {
  const labels: Record<ReleaseArch, string> = {
    x64: 'Intel/AMD (x64)',
    arm64: 'Apple Silicon / ARM',
    universal: 'Universal',
  }
  return labels[arch]
}

export function detectPlatform(): DetectedPlatform {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { os: 'unknown', arch: 'unknown', browser: 'unknown' }
  }

  const ua = navigator.userAgent.toLowerCase()
  const platform = navigator.platform?.toLowerCase() ?? ''

  // Detect OS
  let os: DetectedPlatform['os'] = 'unknown'
  if (ua.includes('iphone') || ua.includes('ipad')) {
    os = 'ios'
  } else if (ua.includes('android')) {
    os = 'android'
  } else if (ua.includes('mac') || platform.includes('mac')) {
    os = 'macos'
  } else if (ua.includes('win') || platform.includes('win')) {
    os = 'windows'
  } else if (ua.includes('linux')) {
    os = 'linux'
  }

  // Detect arch (best effort)
  let arch: DetectedPlatform['arch'] = 'unknown'
  if (os === 'macos') {
    // Check for Apple Silicon indicators
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl')
    const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info')
    if (debugInfo) {
      const renderer = gl?.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      if (renderer?.includes('Apple M') || renderer?.includes('Apple GPU')) {
        arch = 'arm64'
      } else {
        arch = 'x64'
      }
    }
  } else if (os === 'windows') {
    // Windows ARM detection
    if (ua.includes('arm') || platform.includes('arm')) {
      arch = 'arm64'
    } else {
      arch = 'x64'
    }
  } else if (os === 'linux') {
    if (ua.includes('aarch64') || ua.includes('arm64')) {
      arch = 'arm64'
    } else {
      arch = 'x64'
    }
  }

  // Detect browser
  let browser: DetectedPlatform['browser'] = 'unknown'
  if (ua.includes('edg/')) {
    browser = 'edge'
  } else if (ua.includes('chrome') && !ua.includes('edg')) {
    browser = 'chrome'
  } else if (ua.includes('firefox')) {
    browser = 'firefox'
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'safari'
  }

  return { os, arch, browser }
}

export function getRecommendedDownloads(
  artifacts: ReleaseArtifact[],
  detected: DetectedPlatform,
): DownloadInfo[] {
  const downloads: DownloadInfo[] = []

  // Find matching artifacts for detected platform
  for (const artifact of artifacts) {
    let recommended = false

    // Desktop app recommendation
    if (artifact.platform === detected.os) {
      if (!artifact.arch || artifact.arch === 'universal') {
        recommended = true
      } else if (artifact.arch === detected.arch) {
        recommended = true
      }
    }

    // Browser extension recommendation
    if (
      artifact.platform === detected.browser &&
      ['chrome', 'firefox', 'edge', 'safari'].includes(artifact.platform)
    ) {
      recommended = true
    }

    const label =
      artifact.arch && artifact.platform !== detected.browser
        ? `${getPlatformLabel(artifact.platform)} (${getArchLabel(artifact.arch)})`
        : getPlatformLabel(artifact.platform)

    downloads.push({
      platform: artifact.platform,
      arch: artifact.arch,
      label,
      icon: getPlatformIcon(artifact.platform),
      url: `/storage/download/${artifact.cid}?filename=${encodeURIComponent(artifact.filename)}`,
      size: formatFileSize(artifact.size),
      recommended,
    })
  }

  // Sort with recommended first
  return downloads.sort((a, b) => {
    if (a.recommended && !b.recommended) return -1
    if (!a.recommended && b.recommended) return 1
    return 0
  })
}

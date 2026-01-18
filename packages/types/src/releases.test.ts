/**
 * Release Types and Utilities Tests
 *
 * Comprehensive tests for release-related types, schemas, and helper functions:
 * - Schema validation edge cases
 * - Helper function boundary conditions
 * - Platform detection scenarios
 * - Download recommendation logic
 */

import { describe, expect, test } from 'bun:test'
import {
  type DetectedPlatform,
  formatFileSize,
  getArchLabel,
  getPlatformIcon,
  getPlatformLabel,
  getRecommendedDownloads,
  type ReleaseArch,
  ReleaseArchSchema,
  type ReleaseArtifact,
  ReleaseArtifactSchema,
  ReleaseManifestSchema,
  type ReleasePlatform,
  ReleasePlatformSchema,
} from './releases'

describe('ReleasePlatformSchema', () => {
  test('accepts all valid platforms', () => {
    const validPlatforms = [
      'macos',
      'windows',
      'linux',
      'chrome',
      'firefox',
      'edge',
      'safari',
      'ios',
      'android',
    ]

    for (const platform of validPlatforms) {
      const result = ReleasePlatformSchema.safeParse(platform)
      expect(result.success).toBe(true)
    }
  })

  test('rejects invalid platforms', () => {
    const invalidPlatforms = [
      '',
      'MacOS',
      'WINDOWS',
      'ubuntu',
      'debian',
      'freebsd',
      'win32',
      'darwin',
    ]

    for (const platform of invalidPlatforms) {
      const result = ReleasePlatformSchema.safeParse(platform)
      expect(result.success).toBe(false)
    }
  })
})

describe('ReleaseArchSchema', () => {
  test('accepts all valid architectures', () => {
    const validArches = ['x64', 'arm64', 'universal']

    for (const arch of validArches) {
      const result = ReleaseArchSchema.safeParse(arch)
      expect(result.success).toBe(true)
    }
  })

  test('rejects invalid architectures', () => {
    const invalidArches = [
      '',
      'x86',
      'i386',
      'amd64',
      'aarch64',
      'ARM64',
      'X64',
    ]

    for (const arch of invalidArches) {
      const result = ReleaseArchSchema.safeParse(arch)
      expect(result.success).toBe(false)
    }
  })
})

describe('ReleaseArtifactSchema', () => {
  const validArtifact = {
    platform: 'macos',
    arch: 'arm64',
    filename: 'App-1.0.0-arm64.dmg',
    cid: 'QmTestCid123456789',
    size: 85000000,
    sha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  }

  test('accepts valid artifact with all fields', () => {
    const result = ReleaseArtifactSchema.safeParse(validArtifact)
    expect(result.success).toBe(true)
  })

  test('accepts artifact without optional arch', () => {
    const { arch, ...artifactWithoutArch } = validArtifact
    const result = ReleaseArtifactSchema.safeParse(artifactWithoutArch)
    expect(result.success).toBe(true)
  })

  test('accepts artifact with storeUrl', () => {
    const artifactWithStore = {
      ...validArtifact,
      platform: 'chrome',
      storeUrl: 'https://chrome.google.com/webstore/detail/myapp/abc123',
    }
    const result = ReleaseArtifactSchema.safeParse(artifactWithStore)
    expect(result.success).toBe(true)
  })

  test('rejects artifact with invalid storeUrl', () => {
    const artifactWithBadStore = {
      ...validArtifact,
      storeUrl: 'not-a-valid-url',
    }
    const result = ReleaseArtifactSchema.safeParse(artifactWithBadStore)
    expect(result.success).toBe(false)
  })

  test('rejects artifact without required fields', () => {
    const requiredFields = ['platform', 'filename', 'cid', 'size', 'sha256']

    for (const field of requiredFields) {
      const artifact = { ...validArtifact }
      delete artifact[field as keyof typeof artifact]
      const result = ReleaseArtifactSchema.safeParse(artifact)
      expect(result.success).toBe(false)
    }
  })

  test('rejects artifact with invalid size type', () => {
    const badArtifact = { ...validArtifact, size: '85000000' }
    const result = ReleaseArtifactSchema.safeParse(badArtifact)
    expect(result.success).toBe(false)
  })
})

describe('ReleaseManifestSchema', () => {
  const validManifest = {
    app: 'node',
    version: '1.0.0',
    releasedAt: '2025-01-04T12:00:00.000Z',
    channel: 'stable',
    artifacts: [
      {
        platform: 'macos',
        arch: 'arm64',
        filename: 'App-1.0.0-arm64.dmg',
        cid: 'QmTestCid',
        size: 85000000,
        sha256: 'abc123',
      },
    ],
  }

  test('accepts valid manifest', () => {
    const result = ReleaseManifestSchema.safeParse(validManifest)
    expect(result.success).toBe(true)
  })

  test('accepts manifest with optional fields', () => {
    const fullManifest = {
      ...validManifest,
      changelog: '- Fixed bugs\n- Added features',
      releaseNotes: 'This release includes important updates.',
      minAppVersion: '0.9.0',
      signatures: {
        key1: 'sig1',
        key2: 'sig2',
      },
    }
    const result = ReleaseManifestSchema.safeParse(fullManifest)
    expect(result.success).toBe(true)
  })

  test('accepts all valid channels', () => {
    const channels = ['stable', 'beta', 'nightly']

    for (const channel of channels) {
      const result = ReleaseManifestSchema.safeParse({
        ...validManifest,
        channel,
      })
      expect(result.success).toBe(true)
    }
  })

  test('rejects invalid channel', () => {
    const result = ReleaseManifestSchema.safeParse({
      ...validManifest,
      channel: 'alpha',
    })
    expect(result.success).toBe(false)
  })

  test('defaults channel to stable', () => {
    const { channel, ...manifestWithoutChannel } = validManifest
    const result = ReleaseManifestSchema.safeParse(manifestWithoutChannel)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.channel).toBe('stable')
    }
  })

  test('accepts empty artifacts array', () => {
    const result = ReleaseManifestSchema.safeParse({
      ...validManifest,
      artifacts: [],
    })
    expect(result.success).toBe(true)
  })

  test('rejects manifest without required fields', () => {
    const requiredFields = ['app', 'version', 'releasedAt', 'artifacts']

    for (const field of requiredFields) {
      const manifest = { ...validManifest }
      delete manifest[field as keyof typeof manifest]
      const result = ReleaseManifestSchema.safeParse(manifest)
      expect(result.success).toBe(false)
    }
  })
})

describe('formatFileSize', () => {
  test('formats bytes correctly', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1)).toBe('1 B')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })

  test('formats kilobytes correctly', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(10240)).toBe('10.0 KB')
    expect(formatFileSize(1024 * 1024 - 1)).toMatch(/KB$/)
  })

  test('formats megabytes correctly', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(85 * 1024 * 1024)).toBe('85.0 MB')
    expect(formatFileSize(1024 * 1024 * 500)).toBe('500.0 MB')
    expect(formatFileSize(1024 * 1024 * 1024 - 1)).toMatch(/MB$/)
  })

  test('formats gigabytes correctly', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB')
    expect(formatFileSize(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB')
    expect(formatFileSize(10 * 1024 * 1024 * 1024)).toBe('10.00 GB')
  })

  test('handles boundary conditions', () => {
    // Just under 1KB
    expect(formatFileSize(1023)).toBe('1023 B')
    // Exactly 1KB
    expect(formatFileSize(1024)).toBe('1.0 KB')
    // Just under 1MB
    expect(formatFileSize(1024 * 1024 - 1)).toMatch(/^\d+\.\d+ KB$/)
    // Exactly 1MB
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
  })

  test('handles large file sizes', () => {
    const result = formatFileSize(100 * 1024 * 1024 * 1024)
    expect(result).toBe('100.00 GB')
  })
})

describe('getPlatformLabel', () => {
  test('returns correct labels for all platforms', () => {
    const expectations: Record<ReleasePlatform, string> = {
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

    for (const [platform, label] of Object.entries(expectations)) {
      expect(getPlatformLabel(platform as ReleasePlatform)).toBe(label)
    }
  })
})

describe('getPlatformIcon', () => {
  test('returns emoji icons for all platforms', () => {
    const platforms: ReleasePlatform[] = [
      'macos',
      'windows',
      'linux',
      'chrome',
      'firefox',
      'edge',
      'safari',
      'ios',
      'android',
    ]

    for (const platform of platforms) {
      const icon = getPlatformIcon(platform)
      expect(typeof icon).toBe('string')
      expect(icon.length).toBeGreaterThan(0)
    }
  })

  test('returns distinct icons for each platform', () => {
    const platforms: ReleasePlatform[] = [
      'macos',
      'windows',
      'linux',
      'chrome',
      'firefox',
      'edge',
      'safari',
      'ios',
      'android',
    ]
    const icons = platforms.map(getPlatformIcon)
    const uniqueIcons = new Set(icons)
    expect(uniqueIcons.size).toBe(platforms.length)
  })
})

describe('getArchLabel', () => {
  test('returns correct labels for all architectures', () => {
    const expectations: Record<ReleaseArch, string> = {
      x64: 'Intel/AMD (x64)',
      arm64: 'Apple Silicon / ARM',
      universal: 'Universal',
    }

    for (const [arch, label] of Object.entries(expectations)) {
      expect(getArchLabel(arch as ReleaseArch)).toBe(label)
    }
  })
})

describe('getRecommendedDownloads', () => {
  const testArtifacts: ReleaseArtifact[] = [
    {
      platform: 'macos',
      arch: 'arm64',
      filename: 'App-arm64.dmg',
      cid: 'QmMacArm',
      size: 85000000,
      sha256: 'abc',
    },
    {
      platform: 'macos',
      arch: 'x64',
      filename: 'App-x64.dmg',
      cid: 'QmMacX64',
      size: 90000000,
      sha256: 'def',
    },
    {
      platform: 'windows',
      arch: 'x64',
      filename: 'App.msi',
      cid: 'QmWin',
      size: 80000000,
      sha256: 'ghi',
    },
    {
      platform: 'linux',
      arch: 'x64',
      filename: 'App.AppImage',
      cid: 'QmLinux',
      size: 95000000,
      sha256: 'jkl',
    },
    {
      platform: 'chrome',
      filename: 'extension.zip',
      cid: 'QmChrome',
      size: 2000000,
      sha256: 'mno',
    },
  ]

  test('recommends correct artifact for macOS arm64 user', () => {
    const detected: DetectedPlatform = {
      os: 'macos',
      arch: 'arm64',
      browser: 'safari',
    }

    const downloads = getRecommendedDownloads(testArtifacts, detected)
    const recommended = downloads.filter((d) => d.recommended)

    expect(recommended.length).toBeGreaterThan(0)
    expect(recommended[0].platform).toBe('macos')
    expect(recommended[0].arch).toBe('arm64')
  })

  test('recommends correct artifact for macOS x64 user', () => {
    const detected: DetectedPlatform = {
      os: 'macos',
      arch: 'x64',
      browser: 'chrome',
    }

    const downloads = getRecommendedDownloads(testArtifacts, detected)
    const recommendedMac = downloads.find(
      (d) => d.recommended && d.platform === 'macos',
    )

    expect(recommendedMac).toBeDefined()
    expect(recommendedMac?.arch).toBe('x64')
  })

  test('recommends Chrome extension for Chrome users', () => {
    const detected: DetectedPlatform = {
      os: 'windows',
      arch: 'x64',
      browser: 'chrome',
    }

    const downloads = getRecommendedDownloads(testArtifacts, detected)
    const recommendedChrome = downloads.find(
      (d) => d.recommended && d.platform === 'chrome',
    )

    expect(recommendedChrome).toBeDefined()
  })

  test('recommends Windows artifact for Windows users', () => {
    const detected: DetectedPlatform = {
      os: 'windows',
      arch: 'x64',
      browser: 'edge',
    }

    const downloads = getRecommendedDownloads(testArtifacts, detected)
    const recommendedWin = downloads.find(
      (d) => d.recommended && d.platform === 'windows',
    )

    expect(recommendedWin).toBeDefined()
    expect(recommendedWin?.platform).toBe('windows')
  })

  test('recommends Linux artifact for Linux users', () => {
    const detected: DetectedPlatform = {
      os: 'linux',
      arch: 'x64',
      browser: 'firefox',
    }

    const downloads = getRecommendedDownloads(testArtifacts, detected)
    const recommendedLinux = downloads.find(
      (d) => d.recommended && d.platform === 'linux',
    )

    expect(recommendedLinux).toBeDefined()
  })

  test('sorts recommended downloads first', () => {
    const detected: DetectedPlatform = {
      os: 'macos',
      arch: 'arm64',
      browser: 'chrome',
    }

    const downloads = getRecommendedDownloads(testArtifacts, detected)

    // First downloads should be recommended
    let sawNonRecommended = false
    for (const download of downloads) {
      if (!download.recommended) {
        sawNonRecommended = true
      } else if (sawNonRecommended) {
        // Found recommended after non-recommended - sorting is wrong
        throw new Error('Recommended downloads should be first')
      }
    }
  })

  test('includes download URLs with correct format', () => {
    const detected: DetectedPlatform = {
      os: 'macos',
      arch: 'arm64',
      browser: 'safari',
    }

    const downloads = getRecommendedDownloads(testArtifacts, detected)

    for (const download of downloads) {
      expect(download.url).toContain('/storage/download/')
      expect(download.url).toContain('?filename=')
    }
  })

  test('includes formatted file sizes', () => {
    const detected: DetectedPlatform = {
      os: 'macos',
      arch: 'arm64',
      browser: 'safari',
    }

    const downloads = getRecommendedDownloads(testArtifacts, detected)

    for (const download of downloads) {
      expect(download.size).toMatch(/\d+(\.\d+)?\s*(B|KB|MB|GB)/)
    }
  })

  test('handles universal arch as recommended', () => {
    const universalArtifacts: ReleaseArtifact[] = [
      {
        platform: 'macos',
        arch: 'universal',
        filename: 'App-universal.dmg',
        cid: 'QmUniversal',
        size: 150000000,
        sha256: 'xyz',
      },
    ]

    const detected: DetectedPlatform = {
      os: 'macos',
      arch: 'arm64',
      browser: 'safari',
    }

    const downloads = getRecommendedDownloads(universalArtifacts, detected)
    expect(downloads[0].recommended).toBe(true)
  })

  test('handles empty artifacts array', () => {
    const detected: DetectedPlatform = {
      os: 'macos',
      arch: 'arm64',
      browser: 'safari',
    }

    const downloads = getRecommendedDownloads([], detected)
    expect(downloads).toEqual([])
  })

  test('handles unknown platform with no recommendations', () => {
    const detected: DetectedPlatform = {
      os: 'unknown',
      arch: 'unknown',
      browser: 'unknown',
    }

    const downloads = getRecommendedDownloads(testArtifacts, detected)
    const recommended = downloads.filter((d) => d.recommended)

    expect(recommended.length).toBe(0)
    expect(downloads.length).toBe(testArtifacts.length)
  })
})

/**
 * Comprehensive tests for release types and helper functions
 *
 * Tests cover:
 * - formatFileSize with various byte sizes including edge cases
 * - getPlatformLabel for all platforms
 * - getPlatformIcon for all platforms
 * - getArchLabel for all architectures
 * - detectPlatform for browser environment detection
 * - getRecommendedDownloads with various artifact/platform combinations
 * - Zod schema validation for all release types
 */

import { describe, expect, it } from 'bun:test'
import {
  AppReleaseConfigSchema,
  detectPlatform,
  formatFileSize,
  getArchLabel,
  getPlatformIcon,
  getPlatformLabel,
  getRecommendedDownloads,
  type ReleaseArch,
  ReleaseArchSchema,
  type ReleaseArtifact,
  ReleaseArtifactSchema,
  ReleaseIndexSchema,
  ReleaseManifestSchema,
  type ReleasePlatform,
  ReleasePlatformSchema,
} from '../releases'

describe('Release Types', () => {
  describe('formatFileSize', () => {
    it('formats bytes correctly', () => {
      expect(formatFileSize(0)).toBe('0 B')
      expect(formatFileSize(1)).toBe('1 B')
      expect(formatFileSize(512)).toBe('512 B')
      expect(formatFileSize(1023)).toBe('1023 B')
    })

    it('formats kilobytes correctly', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB')
      expect(formatFileSize(1536)).toBe('1.5 KB')
      expect(formatFileSize(10240)).toBe('10.0 KB')
      expect(formatFileSize(1024 * 1023)).toBe('1023.0 KB')
    })

    it('formats megabytes correctly', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
      expect(formatFileSize(1024 * 1024 * 1.5)).toBe('1.5 MB')
      expect(formatFileSize(1024 * 1024 * 100)).toBe('100.0 MB')
      expect(formatFileSize(1024 * 1024 * 1023)).toBe('1023.0 MB')
    })

    it('formats gigabytes correctly', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB')
      expect(formatFileSize(1024 * 1024 * 1024 * 1.5)).toBe('1.50 GB')
      expect(formatFileSize(1024 * 1024 * 1024 * 100)).toBe('100.00 GB')
    })

    it('handles edge cases', () => {
      expect(formatFileSize(-1)).toBe('-1 B') // Negative should still work
      expect(formatFileSize(Number.MAX_SAFE_INTEGER)).toContain('GB')
    })
  })

  describe('getPlatformLabel', () => {
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

    it('returns correct labels for all platforms', () => {
      expect(getPlatformLabel('macos')).toBe('macOS')
      expect(getPlatformLabel('windows')).toBe('Windows')
      expect(getPlatformLabel('linux')).toBe('Linux')
      expect(getPlatformLabel('chrome')).toBe('Chrome')
      expect(getPlatformLabel('firefox')).toBe('Firefox')
      expect(getPlatformLabel('edge')).toBe('Edge')
      expect(getPlatformLabel('safari')).toBe('Safari')
      expect(getPlatformLabel('ios')).toBe('iOS')
      expect(getPlatformLabel('android')).toBe('Android')
    })

    it('covers all ReleasePlatform values', () => {
      for (const platform of platforms) {
        const label = getPlatformLabel(platform)
        expect(typeof label).toBe('string')
        expect(label.length).toBeGreaterThan(0)
      }
    })
  })

  describe('getPlatformIcon', () => {
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

    it('returns emoji icons for all platforms', () => {
      expect(getPlatformIcon('macos')).toBe('🍎')
      expect(getPlatformIcon('windows')).toBe('🪟')
      expect(getPlatformIcon('linux')).toBe('🐧')
      expect(getPlatformIcon('chrome')).toBe('🌐')
      expect(getPlatformIcon('firefox')).toBe('🦊')
      expect(getPlatformIcon('edge')).toBe('🔵')
      expect(getPlatformIcon('safari')).toBe('🧭')
      expect(getPlatformIcon('ios')).toBe('📱')
      expect(getPlatformIcon('android')).toBe('🤖')
    })

    it('covers all ReleasePlatform values', () => {
      for (const platform of platforms) {
        const icon = getPlatformIcon(platform)
        expect(typeof icon).toBe('string')
        expect(icon.length).toBeGreaterThan(0)
      }
    })
  })

  describe('getArchLabel', () => {
    const architectures: ReleaseArch[] = ['x64', 'arm64', 'universal']

    it('returns correct labels for all architectures', () => {
      expect(getArchLabel('x64')).toBe('Intel/AMD (x64)')
      expect(getArchLabel('arm64')).toBe('Apple Silicon / ARM')
      expect(getArchLabel('universal')).toBe('Universal')
    })

    it('covers all ReleaseArch values', () => {
      for (const arch of architectures) {
        const label = getArchLabel(arch)
        expect(typeof label).toBe('string')
        expect(label.length).toBeGreaterThan(0)
      }
    })
  })

  describe('detectPlatform', () => {
    it('returns unknown values when not in browser environment', () => {
      const detected = detectPlatform()
      // In Node/Bun environment, should return unknown
      expect(detected.os).toBe('unknown')
      expect(detected.arch).toBe('unknown')
      expect(detected.browser).toBe('unknown')
    })
  })

  describe('getRecommendedDownloads', () => {
    const sampleArtifacts: ReleaseArtifact[] = [
      {
        platform: 'macos',
        arch: 'arm64',
        filename: 'app-arm64.dmg',
        cid: 'QmArm64',
        size: 1024 * 1024 * 50,
        sha256: 'abc123',
      },
      {
        platform: 'macos',
        arch: 'x64',
        filename: 'app-x64.dmg',
        cid: 'QmX64',
        size: 1024 * 1024 * 55,
        sha256: 'def456',
      },
      {
        platform: 'windows',
        arch: 'x64',
        filename: 'app-x64.msi',
        cid: 'QmWin',
        size: 1024 * 1024 * 45,
        sha256: 'ghi789',
      },
      {
        platform: 'chrome',
        filename: 'app-chrome.zip',
        cid: 'QmChrome',
        size: 1024 * 512,
        sha256: 'jkl012',
      },
      {
        platform: 'firefox',
        filename: 'app-firefox.xpi',
        cid: 'QmFirefox',
        size: 1024 * 480,
        sha256: 'mno345',
      },
    ]

    it('returns all artifacts as download info', () => {
      const downloads = getRecommendedDownloads(sampleArtifacts, {
        os: 'unknown',
        arch: 'unknown',
        browser: 'unknown',
      })
      expect(downloads.length).toBe(5)
    })

    it('recommends matching desktop platform', () => {
      const downloads = getRecommendedDownloads(sampleArtifacts, {
        os: 'macos',
        arch: 'arm64',
        browser: 'chrome',
      })

      const macosArm = downloads.find(
        (d) => d.platform === 'macos' && d.arch === 'arm64',
      )
      expect(macosArm?.recommended).toBe(true)

      const macosX64 = downloads.find(
        (d) => d.platform === 'macos' && d.arch === 'x64',
      )
      expect(macosX64?.recommended).toBe(false)
    })

    it('recommends matching browser extension', () => {
      const downloads = getRecommendedDownloads(sampleArtifacts, {
        os: 'macos',
        arch: 'arm64',
        browser: 'chrome',
      })

      const chrome = downloads.find((d) => d.platform === 'chrome')
      expect(chrome?.recommended).toBe(true)

      const firefox = downloads.find((d) => d.platform === 'firefox')
      expect(firefox?.recommended).toBe(false)
    })

    it('sorts recommended downloads first', () => {
      const downloads = getRecommendedDownloads(sampleArtifacts, {
        os: 'macos',
        arch: 'arm64',
        browser: 'chrome',
      })

      // First items should be recommended
      const recommendedCount = downloads.filter((d) => d.recommended).length
      for (let i = 0; i < recommendedCount; i++) {
        expect(downloads[i].recommended).toBe(true)
      }
    })

    it('includes formatted size in download info', () => {
      const downloads = getRecommendedDownloads(sampleArtifacts, {
        os: 'unknown',
        arch: 'unknown',
        browser: 'unknown',
      })

      const macosArm = downloads.find(
        (d) => d.platform === 'macos' && d.arch === 'arm64',
      )
      expect(macosArm?.size).toBe('50.0 MB')
    })

    it('generates correct download URLs', () => {
      const downloads = getRecommendedDownloads(sampleArtifacts, {
        os: 'unknown',
        arch: 'unknown',
        browser: 'unknown',
      })

      const chrome = downloads.find((d) => d.platform === 'chrome')
      expect(chrome?.url).toContain('/storage/download/QmChrome')
      expect(chrome?.url).toContain('filename=app-chrome.zip')
    })

    it('handles empty artifacts array', () => {
      const downloads = getRecommendedDownloads([], {
        os: 'macos',
        arch: 'arm64',
        browser: 'chrome',
      })
      expect(downloads).toEqual([])
    })

    it('handles universal architecture', () => {
      const artifactsWithUniversal: ReleaseArtifact[] = [
        {
          platform: 'macos',
          arch: 'universal',
          filename: 'app-universal.dmg',
          cid: 'QmUniversal',
          size: 1024 * 1024 * 100,
          sha256: 'pqr678',
        },
      ]

      const downloads = getRecommendedDownloads(artifactsWithUniversal, {
        os: 'macos',
        arch: 'arm64',
        browser: 'unknown',
      })

      expect(downloads[0].recommended).toBe(true)
    })
  })
})

describe('Zod Schemas', () => {
  describe('ReleasePlatformSchema', () => {
    it('validates all valid platforms', () => {
      const platforms = [
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
        expect(ReleasePlatformSchema.safeParse(platform).success).toBe(true)
      }
    })

    it('rejects invalid platforms', () => {
      expect(ReleasePlatformSchema.safeParse('invalid').success).toBe(false)
      expect(ReleasePlatformSchema.safeParse('').success).toBe(false)
      expect(ReleasePlatformSchema.safeParse(null).success).toBe(false)
      expect(ReleasePlatformSchema.safeParse(123).success).toBe(false)
    })
  })

  describe('ReleaseArchSchema', () => {
    it('validates all valid architectures', () => {
      const archs = ['x64', 'arm64', 'universal']

      for (const arch of archs) {
        expect(ReleaseArchSchema.safeParse(arch).success).toBe(true)
      }
    })

    it('rejects invalid architectures', () => {
      expect(ReleaseArchSchema.safeParse('x86').success).toBe(false)
      expect(ReleaseArchSchema.safeParse('arm').success).toBe(false)
      expect(ReleaseArchSchema.safeParse('').success).toBe(false)
    })
  })

  describe('ReleaseArtifactSchema', () => {
    it('validates complete artifact', () => {
      const artifact = {
        platform: 'macos',
        arch: 'arm64',
        filename: 'app.dmg',
        cid: 'QmTest123',
        size: 1024 * 1024,
        sha256: 'abc123def456',
      }

      const result = ReleaseArtifactSchema.safeParse(artifact)
      expect(result.success).toBe(true)
    })

    it('validates artifact without optional arch', () => {
      const artifact = {
        platform: 'chrome',
        filename: 'extension.zip',
        cid: 'QmTest123',
        size: 1024,
        sha256: 'abc123',
      }

      const result = ReleaseArtifactSchema.safeParse(artifact)
      expect(result.success).toBe(true)
    })

    it('validates artifact with optional storeUrl', () => {
      const artifact = {
        platform: 'chrome',
        filename: 'extension.zip',
        cid: 'QmTest123',
        size: 1024,
        sha256: 'abc123',
        storeUrl: 'https://chrome.google.com/webstore/detail/...',
      }

      const result = ReleaseArtifactSchema.safeParse(artifact)
      expect(result.success).toBe(true)
    })

    it('rejects artifact with missing required fields', () => {
      expect(
        ReleaseArtifactSchema.safeParse({ platform: 'macos' }).success,
      ).toBe(false)
      expect(
        ReleaseArtifactSchema.safeParse({ filename: 'test' }).success,
      ).toBe(false)
      expect(ReleaseArtifactSchema.safeParse({}).success).toBe(false)
    })

    it('rejects artifact with invalid storeUrl', () => {
      const artifact = {
        platform: 'chrome',
        filename: 'extension.zip',
        cid: 'QmTest123',
        size: 1024,
        sha256: 'abc123',
        storeUrl: 'not-a-url',
      }

      const result = ReleaseArtifactSchema.safeParse(artifact)
      expect(result.success).toBe(false)
    })
  })

  describe('ReleaseManifestSchema', () => {
    it('validates complete manifest', () => {
      const manifest = {
        app: 'test-app',
        version: '1.0.0',
        releasedAt: '2024-01-01T00:00:00Z',
        channel: 'stable',
        artifacts: [
          {
            platform: 'macos',
            arch: 'arm64',
            filename: 'app.dmg',
            cid: 'QmTest',
            size: 1024,
            sha256: 'abc',
          },
        ],
      }

      const result = ReleaseManifestSchema.safeParse(manifest)
      expect(result.success).toBe(true)
    })

    it('defaults channel to stable', () => {
      const manifest = {
        app: 'test-app',
        version: '1.0.0',
        releasedAt: '2024-01-01T00:00:00Z',
        artifacts: [],
      }

      const result = ReleaseManifestSchema.safeParse(manifest)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.channel).toBe('stable')
      }
    })

    it('validates all channel types', () => {
      for (const channel of ['stable', 'beta', 'nightly']) {
        const manifest = {
          app: 'test-app',
          version: '1.0.0',
          releasedAt: '2024-01-01T00:00:00Z',
          channel,
          artifacts: [],
        }

        const result = ReleaseManifestSchema.safeParse(manifest)
        expect(result.success).toBe(true)
      }
    })

    it('rejects invalid channel', () => {
      const manifest = {
        app: 'test-app',
        version: '1.0.0',
        releasedAt: '2024-01-01T00:00:00Z',
        channel: 'alpha',
        artifacts: [],
      }

      const result = ReleaseManifestSchema.safeParse(manifest)
      expect(result.success).toBe(false)
    })

    it('validates optional fields', () => {
      const manifest = {
        app: 'test-app',
        version: '1.0.0',
        releasedAt: '2024-01-01T00:00:00Z',
        artifacts: [],
        changelog: '## Changes\n- Fixed bugs',
        releaseNotes: 'New release with fixes',
        minAppVersion: '0.9.0',
        signatures: {
          macos: 'signature123',
        },
      }

      const result = ReleaseManifestSchema.safeParse(manifest)
      expect(result.success).toBe(true)
    })
  })

  describe('ReleaseIndexSchema', () => {
    it('validates complete index', () => {
      const index = {
        app: 'test-app',
        latest: '1.0.0',
        latestBeta: '1.1.0-beta.1',
        latestNightly: '1.2.0-nightly.123',
        versions: [
          {
            version: '1.0.0',
            channel: 'stable',
            releasedAt: '2024-01-01T00:00:00Z',
            manifestCid: 'QmManifest1',
          },
          {
            version: '1.1.0-beta.1',
            channel: 'beta',
            releasedAt: '2024-01-15T00:00:00Z',
            manifestCid: 'QmManifest2',
          },
        ],
      }

      const result = ReleaseIndexSchema.safeParse(index)
      expect(result.success).toBe(true)
    })

    it('validates index with only required fields', () => {
      const index = {
        app: 'test-app',
        latest: '1.0.0',
        versions: [],
      }

      const result = ReleaseIndexSchema.safeParse(index)
      expect(result.success).toBe(true)
    })

    it('rejects index with missing required fields', () => {
      expect(ReleaseIndexSchema.safeParse({ app: 'test' }).success).toBe(false)
      expect(ReleaseIndexSchema.safeParse({ latest: '1.0.0' }).success).toBe(
        false,
      )
    })
  })

  describe('AppReleaseConfigSchema', () => {
    it('validates complete config', () => {
      const config = {
        appName: 'test-app',
        displayName: 'Test App',
        description: 'A test application',
        platforms: ['macos', 'windows', 'chrome'],
        hasDesktopApp: true,
        hasExtension: true,
        hasMobileApp: false,
        extensionStores: {
          chrome: 'https://chrome.google.com/webstore/detail/...',
          firefox: 'https://addons.mozilla.org/...',
        },
        autoUpdate: true,
        codeSigningRequired: true,
      }

      const result = AppReleaseConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
    })

    it('applies default values', () => {
      const config = {
        appName: 'test-app',
        displayName: 'Test App',
        description: 'A test application',
        platforms: ['macos'],
      }

      const result = AppReleaseConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.hasDesktopApp).toBe(false)
        expect(result.data.hasExtension).toBe(false)
        expect(result.data.hasMobileApp).toBe(false)
        expect(result.data.autoUpdate).toBe(true)
        expect(result.data.codeSigningRequired).toBe(false)
      }
    })
  })
})

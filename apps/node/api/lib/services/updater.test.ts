import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

// Version Schema
const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/)

// Update Info Schema
const UpdateInfoSchema = z.object({
  version: VersionSchema,
  releaseDate: z.string().datetime(),
  downloadUrl: z.string().url(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  releaseNotes: z.string(),
  mandatory: z.boolean(),
  minVersion: VersionSchema.optional(),
})

type UpdateInfo = z.infer<typeof UpdateInfoSchema>

// Update Check Response Schema
const UpdateCheckResponseSchema = z.object({
  currentVersion: VersionSchema,
  latestVersion: VersionSchema,
  updateAvailable: z.boolean(),
  updates: z.array(UpdateInfoSchema),
})

type UpdateCheckResponse = z.infer<typeof UpdateCheckResponseSchema>

function validateVersion(version: string): boolean {
  return VersionSchema.safeParse(version).success
}

function validateUpdateInfo(data: unknown): UpdateInfo {
  return UpdateInfoSchema.parse(data)
}

function validateUpdateCheckResponse(data: unknown): UpdateCheckResponse {
  return UpdateCheckResponseSchema.parse(data)
}

describe('Version Validation', () => {
  test.each([
    '1.0.0',
    '2.3.4',
    '10.20.30',
    '0.0.1',
    '1.0.0-alpha',
    '2.0.0-beta1',
    '3.0.0-rc2',
  ])('accepts valid version: %s', (version) => {
    expect(validateVersion(version)).toBe(true)
  })

  test.each([
    'v1.0.0',
    '1.0',
    '1',
    'latest',
    '1.0.0.0',
    '',
    '1.0.0-',
  ])('rejects invalid version: %s', (version) => {
    expect(validateVersion(version)).toBe(false)
  })
})

describe('Version Comparison', () => {
  function parseVersion(version: string): {
    major: number
    minor: number
    patch: number
    prerelease?: string
  } {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-(.+))?$/)
    if (!match) throw new Error(`Invalid version: ${version}`)

    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      prerelease: match[5],
    }
  }

  function compareVersions(a: string, b: string): number {
    const va = parseVersion(a)
    const vb = parseVersion(b)

    if (va.major !== vb.major) return va.major - vb.major
    if (va.minor !== vb.minor) return va.minor - vb.minor
    if (va.patch !== vb.patch) return va.patch - vb.patch

    // Prerelease versions are lower than release versions
    if (va.prerelease && !vb.prerelease) return -1
    if (!va.prerelease && vb.prerelease) return 1
    if (va.prerelease && vb.prerelease) {
      return va.prerelease.localeCompare(vb.prerelease)
    }

    return 0
  }

  function isNewerVersion(current: string, candidate: string): boolean {
    return compareVersions(candidate, current) > 0
  }

  test('compares major versions', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  test('compares minor versions', () => {
    expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0)
    expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0)
  })

  test('compares patch versions', () => {
    expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.1', '1.0.2')).toBeLessThan(0)
  })

  test('handles prerelease versions', () => {
    expect(compareVersions('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0)
  })

  test('detects newer version', () => {
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true)
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
  })
})

describe('Update Info Validation', () => {
  test('validates valid update info', () => {
    const info: UpdateInfo = {
      version: '1.1.0',
      releaseDate: new Date().toISOString(),
      downloadUrl:
        'https://releases.jeju.network/node/1.1.0/jeju-node-linux-x64.tar.gz',
      checksum: 'a'.repeat(64),
      releaseNotes: 'Bug fixes and performance improvements',
      mandatory: false,
    }

    const result = validateUpdateInfo(info)
    expect(result.version).toBe('1.1.0')
    expect(result.mandatory).toBe(false)
  })

  test('validates mandatory update with min version', () => {
    const info: UpdateInfo = {
      version: '2.0.0',
      releaseDate: new Date().toISOString(),
      downloadUrl:
        'https://releases.jeju.network/node/2.0.0/jeju-node-linux-x64.tar.gz',
      checksum: 'b'.repeat(64),
      releaseNotes: 'Breaking changes - mandatory update',
      mandatory: true,
      minVersion: '1.5.0',
    }

    const result = validateUpdateInfo(info)
    expect(result.mandatory).toBe(true)
    expect(result.minVersion).toBe('1.5.0')
  })

  test('rejects invalid version', () => {
    const info = {
      version: 'v1.0.0', // Invalid format
      releaseDate: new Date().toISOString(),
      downloadUrl: 'https://releases.jeju.network/node/1.0.0/file.tar.gz',
      checksum: 'a'.repeat(64),
      releaseNotes: 'Test',
      mandatory: false,
    }

    expect(() => validateUpdateInfo(info)).toThrow()
  })

  test('rejects invalid checksum', () => {
    const info = {
      version: '1.0.0',
      releaseDate: new Date().toISOString(),
      downloadUrl: 'https://releases.jeju.network/node/1.0.0/file.tar.gz',
      checksum: 'not-a-valid-checksum',
      releaseNotes: 'Test',
      mandatory: false,
    }

    expect(() => validateUpdateInfo(info)).toThrow()
  })

  test('rejects invalid download URL', () => {
    const info = {
      version: '1.0.0',
      releaseDate: new Date().toISOString(),
      downloadUrl: 'not-a-url',
      checksum: 'a'.repeat(64),
      releaseNotes: 'Test',
      mandatory: false,
    }

    expect(() => validateUpdateInfo(info)).toThrow()
  })
})

describe('Update Check Response', () => {
  test('validates no update available', () => {
    const response: UpdateCheckResponse = {
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
      updateAvailable: false,
      updates: [],
    }

    const result = validateUpdateCheckResponse(response)
    expect(result.updateAvailable).toBe(false)
    expect(result.updates).toEqual([])
  })

  test('validates single update available', () => {
    const response: UpdateCheckResponse = {
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      updateAvailable: true,
      updates: [
        {
          version: '1.1.0',
          releaseDate: new Date().toISOString(),
          downloadUrl: 'https://releases.example.com/1.1.0.tar.gz',
          checksum: 'c'.repeat(64),
          releaseNotes: 'New features',
          mandatory: false,
        },
      ],
    }

    const result = validateUpdateCheckResponse(response)
    expect(result.updateAvailable).toBe(true)
    expect(result.updates.length).toBe(1)
  })

  test('validates multiple updates available', () => {
    const response: UpdateCheckResponse = {
      currentVersion: '1.0.0',
      latestVersion: '1.2.0',
      updateAvailable: true,
      updates: [
        {
          version: '1.1.0',
          releaseDate: new Date().toISOString(),
          downloadUrl: 'https://releases.example.com/1.1.0.tar.gz',
          checksum: 'd'.repeat(64),
          releaseNotes: 'Bug fixes',
          mandatory: false,
        },
        {
          version: '1.2.0',
          releaseDate: new Date().toISOString(),
          downloadUrl: 'https://releases.example.com/1.2.0.tar.gz',
          checksum: 'e'.repeat(64),
          releaseNotes: 'New features',
          mandatory: true,
          minVersion: '1.1.0',
        },
      ],
    }

    const result = validateUpdateCheckResponse(response)
    expect(result.updates.length).toBe(2)
    expect(result.updates[1].mandatory).toBe(true)
  })
})

describe('Update Strategy', () => {
  interface UpdateDecision {
    shouldUpdate: boolean
    targetVersion: string | null
    requiresRestart: boolean
    steps: string[]
  }

  function planUpdate(_current: string, updates: UpdateInfo[]): UpdateDecision {
    if (updates.length === 0) {
      return {
        shouldUpdate: false,
        targetVersion: null,
        requiresRestart: false,
        steps: [],
      }
    }

    // Check for mandatory updates
    const mandatoryUpdates = updates.filter((u) => u.mandatory)
    const _hasMandatory = mandatoryUpdates.length > 0

    // Get the latest version
    const latestUpdate = updates[updates.length - 1]

    const steps: string[] = [
      `Download ${latestUpdate.version}`,
      'Verify checksum',
      'Stop current services',
      'Apply update',
      'Restart services',
    ]

    return {
      shouldUpdate: true,
      targetVersion: latestUpdate.version,
      requiresRestart: true,
      steps,
    }
  }

  test('returns no update when no updates available', () => {
    const decision = planUpdate('1.0.0', [])

    expect(decision.shouldUpdate).toBe(false)
    expect(decision.targetVersion).toBeNull()
  })

  test('plans update to latest version', () => {
    const updates: UpdateInfo[] = [
      {
        version: '1.1.0',
        releaseDate: new Date().toISOString(),
        downloadUrl: 'https://example.com/1.1.0.tar.gz',
        checksum: 'a'.repeat(64),
        releaseNotes: 'Update',
        mandatory: false,
      },
    ]

    const decision = planUpdate('1.0.0', updates)

    expect(decision.shouldUpdate).toBe(true)
    expect(decision.targetVersion).toBe('1.1.0')
    expect(decision.requiresRestart).toBe(true)
    expect(decision.steps.length).toBeGreaterThan(0)
  })

  test('plans update steps correctly', () => {
    const updates: UpdateInfo[] = [
      {
        version: '2.0.0',
        releaseDate: new Date().toISOString(),
        downloadUrl: 'https://example.com/2.0.0.tar.gz',
        checksum: 'b'.repeat(64),
        releaseNotes: 'Major update',
        mandatory: true,
      },
    ]

    const decision = planUpdate('1.0.0', updates)

    expect(decision.steps).toContain('Download 2.0.0')
    expect(decision.steps).toContain('Verify checksum')
    expect(decision.steps).toContain('Restart services')
  })
})

describe('Checksum Verification', () => {
  function verifyChecksum(data: Uint8Array, expected: string): boolean {
    const crypto = require('node:crypto')
    const hash = crypto.createHash('sha256').update(data).digest('hex')
    return hash === expected
  }

  test('verifies correct checksum', () => {
    const data = new TextEncoder().encode('test data')
    const crypto = require('node:crypto')
    const hash = crypto.createHash('sha256').update(data).digest('hex')

    expect(verifyChecksum(data, hash)).toBe(true)
  })

  test('rejects incorrect checksum', () => {
    const data = new TextEncoder().encode('test data')
    const wrongHash = 'f'.repeat(64)

    expect(verifyChecksum(data, wrongHash)).toBe(false)
  })
})

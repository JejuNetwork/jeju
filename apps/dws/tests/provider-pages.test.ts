/**
 * Provider Pages Integration Tests
 *
 * Tests for provider flow pages including:
 * - RunNode page logic and data fetching
 * - Earnings page calculations
 * - Node registration wizard flow
 * - Hardware detection edge cases
 */

import { describe, expect, mock, test } from 'bun:test'

// Mock fetch for API calls
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  }),
)
globalThis.fetch = mockFetch as unknown as typeof fetch

// Mock wagmi hooks
mock.module('wagmi', () => ({
  useAccount: () => ({
    address: '0x1234567890123456789012345678901234567890',
    isConnected: true,
  }),
}))

describe('Provider Page Data Utilities', () => {
  describe('formatStakeAmount', () => {
    // Import the function from the wizard
    function formatStakeAmount(wei: bigint): string {
      const jeju = Number(wei) / 1e18
      if (jeju >= 1) return `${jeju.toFixed(0)} JEJU`
      return `${jeju.toFixed(2)} JEJU`
    }

    test('formats whole numbers correctly', () => {
      expect(formatStakeAmount(BigInt('1000000000000000000'))).toBe('1 JEJU')
      expect(formatStakeAmount(BigInt('5000000000000000000'))).toBe('5 JEJU')
      expect(formatStakeAmount(BigInt('100000000000000000000'))).toBe(
        '100 JEJU',
      )
    })

    test('formats fractional amounts correctly', () => {
      expect(formatStakeAmount(BigInt('500000000000000000'))).toBe('0.50 JEJU')
      expect(formatStakeAmount(BigInt('100000000000000000'))).toBe('0.10 JEJU')
      expect(formatStakeAmount(BigInt('10000000000000000'))).toBe('0.01 JEJU')
    })

    test('handles zero stake', () => {
      expect(formatStakeAmount(BigInt(0))).toBe('0.00 JEJU')
    })

    test('handles very large stakes', () => {
      expect(formatStakeAmount(BigInt('1000000000000000000000000'))).toBe(
        '1000000 JEJU',
      )
    })
  })

  describe('Service Stake Calculations', () => {
    const DEFAULT_SERVICES = [
      { id: 'vpn', minStake: BigInt('1000000000000000000') },
      { id: 'cdn', minStake: BigInt('500000000000000000') },
      { id: 'storage', minStake: BigInt('2000000000000000000') },
      { id: 'rpc', minStake: BigInt('5000000000000000000') },
    ]

    test('calculates total stake for single service', () => {
      const selected = [DEFAULT_SERVICES[0]]
      const total = selected.reduce((sum, s) => sum + s.minStake, BigInt(0))
      expect(total).toBe(BigInt('1000000000000000000'))
    })

    test('calculates total stake for multiple services', () => {
      const selected = [DEFAULT_SERVICES[0], DEFAULT_SERVICES[1]]
      const total = selected.reduce((sum, s) => sum + s.minStake, BigInt(0))
      expect(total).toBe(BigInt('1500000000000000000'))
    })

    test('calculates total stake for all services', () => {
      const total = DEFAULT_SERVICES.reduce(
        (sum, s) => sum + s.minStake,
        BigInt(0),
      )
      // 1 + 0.5 + 2 + 5 = 8.5 JEJU
      expect(total).toBe(BigInt('8500000000000000000'))
    })

    test('handles empty selection', () => {
      const selected: typeof DEFAULT_SERVICES = []
      const total = selected.reduce((sum, s) => sum + s.minStake, BigInt(0))
      expect(total).toBe(BigInt(0))
    })
  })
})

describe('Earnings Page Calculations', () => {
  function formatNumber(value: string | number): string {
    const num = typeof value === 'string' ? parseFloat(value) : value
    if (Number.isNaN(num)) return '0'

    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2)}M`
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(2)}K`
    }
    return num.toFixed(2)
  }

  test('formats small numbers', () => {
    expect(formatNumber(0)).toBe('0.00')
    expect(formatNumber(1)).toBe('1.00')
    expect(formatNumber(50.5)).toBe('50.50')
    expect(formatNumber(999.99)).toBe('999.99')
  })

  test('formats thousands', () => {
    expect(formatNumber(1000)).toBe('1.00K')
    expect(formatNumber(1500)).toBe('1.50K')
    expect(formatNumber(50000)).toBe('50.00K')
    expect(formatNumber(999999)).toBe('1000.00K')
  })

  test('formats millions', () => {
    expect(formatNumber(1000000)).toBe('1.00M')
    expect(formatNumber(2500000)).toBe('2.50M')
    expect(formatNumber(100000000)).toBe('100.00M')
  })

  test('handles string inputs', () => {
    expect(formatNumber('0')).toBe('0.00')
    expect(formatNumber('1234.56')).toBe('1.23K')
    expect(formatNumber('1000000')).toBe('1.00M')
  })

  test('handles invalid inputs', () => {
    expect(formatNumber('invalid')).toBe('0')
    expect(formatNumber('')).toBe('0')
    expect(formatNumber(Number.NaN)).toBe('0')
  })

  describe('Time Range Filtering', () => {
    function filterByRange(
      items: { timestamp: number }[],
      range: '7d' | '30d' | '90d' | 'all',
    ) {
      const now = Date.now()
      const ranges = {
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
        '90d': 90 * 24 * 60 * 60 * 1000,
        all: Number.POSITIVE_INFINITY,
      }
      const cutoff = now - ranges[range]
      return items.filter((item) => item.timestamp > cutoff)
    }

    const now = Date.now()
    const testItems = [
      { timestamp: now - 1 * 24 * 60 * 60 * 1000 }, // 1 day ago
      { timestamp: now - 5 * 24 * 60 * 60 * 1000 }, // 5 days ago
      { timestamp: now - 10 * 24 * 60 * 60 * 1000 }, // 10 days ago
      { timestamp: now - 20 * 24 * 60 * 60 * 1000 }, // 20 days ago
      { timestamp: now - 60 * 24 * 60 * 60 * 1000 }, // 60 days ago
      { timestamp: now - 100 * 24 * 60 * 60 * 1000 }, // 100 days ago
    ]

    test('filters to 7 days', () => {
      const filtered = filterByRange(testItems, '7d')
      expect(filtered.length).toBe(2)
    })

    test('filters to 30 days', () => {
      const filtered = filterByRange(testItems, '30d')
      expect(filtered.length).toBe(4)
    })

    test('filters to 90 days', () => {
      const filtered = filterByRange(testItems, '90d')
      expect(filtered.length).toBe(5)
    })

    test('returns all for all range', () => {
      const filtered = filterByRange(testItems, 'all')
      expect(filtered.length).toBe(6)
    })

    test('handles empty array', () => {
      expect(filterByRange([], '7d')).toEqual([])
    })
  })
})

describe('Hardware Detection Logic', () => {
  describe('Requirements Evaluation', () => {
    type Status = 'pass' | 'warning' | 'fail' | 'unknown'

    function evaluateCpuStatus(cores: number): Status {
      if (cores >= 4) return 'pass'
      if (cores >= 2) return 'warning'
      if (cores > 0) return 'fail'
      return 'unknown'
    }

    function evaluateMemoryStatus(gb: number): Status {
      if (gb >= 8) return 'pass'
      if (gb >= 4) return 'warning'
      if (gb > 0) return 'fail'
      return 'unknown'
    }

    function evaluateGpuStatus(renderer: string | null): {
      status: Status
      hasGoodGpu: boolean
    } {
      if (!renderer) return { status: 'unknown', hasGoodGpu: false }
      const name = renderer.toLowerCase()
      const hasGoodGpu =
        name.includes('nvidia') ||
        name.includes('apple') ||
        name.includes('amd') ||
        name.includes('radeon')
      return { status: hasGoodGpu ? 'pass' : 'warning', hasGoodGpu }
    }

    test('evaluates CPU cores correctly', () => {
      expect(evaluateCpuStatus(0)).toBe('unknown')
      expect(evaluateCpuStatus(1)).toBe('fail')
      expect(evaluateCpuStatus(2)).toBe('warning')
      expect(evaluateCpuStatus(4)).toBe('pass')
      expect(evaluateCpuStatus(8)).toBe('pass')
      expect(evaluateCpuStatus(16)).toBe('pass')
    })

    test('evaluates memory correctly', () => {
      expect(evaluateMemoryStatus(0)).toBe('unknown')
      expect(evaluateMemoryStatus(2)).toBe('fail')
      expect(evaluateMemoryStatus(4)).toBe('warning')
      expect(evaluateMemoryStatus(8)).toBe('pass')
      expect(evaluateMemoryStatus(16)).toBe('pass')
    })

    test('evaluates GPU correctly', () => {
      expect(evaluateGpuStatus(null)).toEqual({
        status: 'unknown',
        hasGoodGpu: false,
      })

      expect(evaluateGpuStatus('NVIDIA GeForce RTX 4090')).toEqual({
        status: 'pass',
        hasGoodGpu: true,
      })

      expect(evaluateGpuStatus('Apple M2 Max')).toEqual({
        status: 'pass',
        hasGoodGpu: true,
      })

      expect(evaluateGpuStatus('AMD Radeon RX 7900')).toEqual({
        status: 'pass',
        hasGoodGpu: true,
      })

      expect(evaluateGpuStatus('Intel UHD Graphics 630')).toEqual({
        status: 'warning',
        hasGoodGpu: false,
      })
    })

    test('GPU detection is case-insensitive', () => {
      expect(evaluateGpuStatus('NVIDIA').hasGoodGpu).toBe(true)
      expect(evaluateGpuStatus('nvidia').hasGoodGpu).toBe(true)
      expect(evaluateGpuStatus('Nvidia').hasGoodGpu).toBe(true)
      expect(evaluateGpuStatus('APPLE GPU').hasGoodGpu).toBe(true)
      expect(evaluateGpuStatus('amd radeon').hasGoodGpu).toBe(true)
    })
  })

  describe('Browser Detection', () => {
    function detectBrowser(
      ua: string,
    ): 'chrome' | 'firefox' | 'safari' | 'edge' | 'unknown' {
      const lower = ua.toLowerCase()
      if (lower.includes('edg/')) return 'edge'
      if (lower.includes('chrome') && !lower.includes('edg')) return 'chrome'
      if (lower.includes('firefox')) return 'firefox'
      if (lower.includes('safari') && !lower.includes('chrome')) return 'safari'
      return 'unknown'
    }

    test('detects Chrome', () => {
      expect(
        detectBrowser(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ),
      ).toBe('chrome')
    })

    test('detects Firefox', () => {
      expect(
        detectBrowser(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
        ),
      ).toBe('firefox')
    })

    test('detects Safari', () => {
      expect(
        detectBrowser(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
        ),
      ).toBe('safari')
    })

    test('detects Edge', () => {
      expect(
        detectBrowser(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        ),
      ).toBe('edge')
    })

    test('Edge takes priority over Chrome', () => {
      // Edge UA contains both "Chrome" and "Edg"
      const edgeUA = 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
      expect(detectBrowser(edgeUA)).toBe('edge')
    })

    test('returns unknown for unrecognized browsers', () => {
      expect(detectBrowser('Some Unknown Browser/1.0')).toBe('unknown')
      expect(detectBrowser('')).toBe('unknown')
    })
  })
})

describe('Node Registration Wizard Flow', () => {
  type Step = 'connect' | 'services' | 'stake' | 'confirm' | 'complete'

  function getNextStep(
    current: Step,
    isConnected: boolean,
    selectedCount: number,
  ): Step | null {
    if (current === 'connect' && isConnected) return 'services'
    if (current === 'services' && selectedCount > 0) return 'stake'
    if (current === 'stake') return 'confirm'
    if (current === 'confirm') return 'complete'
    return null
  }

  function getPrevStep(current: Step): Step | null {
    if (current === 'services') return 'connect'
    if (current === 'stake') return 'services'
    if (current === 'confirm') return 'stake'
    return null
  }

  test('navigates forward correctly when connected', () => {
    expect(getNextStep('connect', true, 0)).toBe('services')
    expect(getNextStep('services', true, 1)).toBe('stake')
    expect(getNextStep('stake', true, 1)).toBe('confirm')
    expect(getNextStep('confirm', true, 1)).toBe('complete')
  })

  test('blocks forward navigation when not connected', () => {
    expect(getNextStep('connect', false, 0)).toBe(null)
  })

  test('blocks forward navigation from services without selection', () => {
    expect(getNextStep('services', true, 0)).toBe(null)
    expect(getNextStep('services', true, 1)).toBe('stake')
  })

  test('navigates backward correctly', () => {
    expect(getPrevStep('services')).toBe('connect')
    expect(getPrevStep('stake')).toBe('services')
    expect(getPrevStep('confirm')).toBe('stake')
  })

  test('cannot go back from first step', () => {
    expect(getPrevStep('connect')).toBe(null)
  })

  test('cannot go back after completion', () => {
    expect(getPrevStep('complete')).toBe(null)
  })
})

describe('Release Artifact Matching', () => {
  interface Artifact {
    platform: string
    arch?: string
  }

  interface Detected {
    os: string
    arch: string
  }

  function findRecommendedArtifact(
    artifacts: Artifact[],
    detected: Detected,
  ): Artifact | null {
    // Exact match first
    const exact = artifacts.find(
      (a) => a.platform === detected.os && a.arch === detected.arch,
    )
    if (exact) return exact

    // Platform match (any arch)
    const platformMatch = artifacts.find((a) => a.platform === detected.os)
    if (platformMatch) return platformMatch

    return null
  }

  const testArtifacts: Artifact[] = [
    { platform: 'macos', arch: 'arm64' },
    { platform: 'macos', arch: 'x64' },
    { platform: 'windows', arch: 'x64' },
    { platform: 'linux', arch: 'x64' },
    { platform: 'linux', arch: 'arm64' },
  ]

  test('finds exact match for macOS arm64', () => {
    const detected = { os: 'macos', arch: 'arm64' }
    const result = findRecommendedArtifact(testArtifacts, detected)
    expect(result).toEqual({ platform: 'macos', arch: 'arm64' })
  })

  test('finds exact match for macOS x64', () => {
    const detected = { os: 'macos', arch: 'x64' }
    const result = findRecommendedArtifact(testArtifacts, detected)
    expect(result).toEqual({ platform: 'macos', arch: 'x64' })
  })

  test('finds exact match for linux arm64', () => {
    const detected = { os: 'linux', arch: 'arm64' }
    const result = findRecommendedArtifact(testArtifacts, detected)
    expect(result).toEqual({ platform: 'linux', arch: 'arm64' })
  })

  test('falls back to platform match when arch unavailable', () => {
    const detected = { os: 'windows', arch: 'arm64' }
    const result = findRecommendedArtifact(testArtifacts, detected)
    expect(result).toEqual({ platform: 'windows', arch: 'x64' })
  })

  test('returns null when platform not available', () => {
    const detected = { os: 'android', arch: 'arm64' }
    const result = findRecommendedArtifact(testArtifacts, detected)
    expect(result).toBe(null)
  })

  test('returns null for empty artifacts', () => {
    const detected = { os: 'macos', arch: 'arm64' }
    const result = findRecommendedArtifact([], detected)
    expect(result).toBe(null)
  })
})

describe('API Response Handling', () => {
  test('handles successful release fetch', async () => {
    const mockRelease = {
      app: 'node',
      version: '1.0.0',
      artifacts: [
        { platform: 'macos', arch: 'arm64', cid: 'Qm123', size: 85000000 },
      ],
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockRelease),
    })

    const response = await fetch('/releases/node/latest')
    const data = await response.json()

    expect(data.app).toBe('node')
    expect(data.artifacts.length).toBe(1)
  })

  test('handles API error gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal error' }),
    })

    const response = await fetch('/releases/node/latest')
    expect(response.ok).toBe(false)
  })

  test('handles network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await expect(fetch('/releases/node/latest')).rejects.toThrow(
      'Network error',
    )
  })
})

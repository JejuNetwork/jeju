/**
 * Unit tests for localnet deployment utilities
 *
 * Tests architecture detection, port configuration, and installation logic.
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

const PortsConfigSchema = z.object({
  l1Rpc: z.string().url(),
  l2Rpc: z.string().url(),
  chainId: z.number().positive(),
  timestamp: z.string().datetime(),
})

type PortsConfig = z.infer<typeof PortsConfigSchema>
type Architecture = 'amd64' | 'arm64'

/**
 * Get Docker-compatible architecture string from Node.js process.arch
 */
function getArchitecture(processArch: string): Architecture {
  if (processArch === 'x64') return 'amd64'
  if (processArch === 'arm64') return 'arm64'
  throw new Error(`Unsupported architecture: ${processArch}`)
}

/**
 * Parse port from RPC URL string
 * Expected format: "http://localhost:6545" or similar
 */
function parsePortFromUrl(url: string): number {
  const match = url.match(/:(\d+)$/)
  if (!match) {
    throw new Error(`Failed to parse port from URL: ${url}`)
  }
  return parseInt(match[1], 10)
}

/**
 * Construct RPC URL from host and port
 */
function constructRpcUrl(host: string, port: number): string {
  return `http://${host}:${port}`
}

/**
 * Validate ports config
 */
function validatePortsConfig(config: Record<string, unknown>): PortsConfig {
  return PortsConfigSchema.parse(config)
}

/**
 * Get Kurtosis download URL for architecture
 */
function getKurtosisDownloadUrl(version: string, arch: Architecture): string {
  const tarball = `kurtosis-cli_${version}_linux_${arch}.tar.gz`
  return `https://github.com/kurtosis-tech/kurtosis-cli-release-artifacts/releases/download/${version}/${tarball}`
}

/**
 * Get Homebrew path based on architecture (macOS)
 */
function getHomebrewPath(arch: string): string {
  if (arch === 'arm64') return '/opt/homebrew/bin'
  return '/usr/local/bin'
}
describe('getArchitecture', () => {
  it('should map x64 to amd64', () => {
    expect(getArchitecture('x64')).toBe('amd64')
  })

  it('should map arm64 to arm64', () => {
    expect(getArchitecture('arm64')).toBe('arm64')
  })

  it('should throw for unsupported architectures', () => {
    expect(() => getArchitecture('ia32')).toThrow(
      'Unsupported architecture: ia32',
    )
    expect(() => getArchitecture('arm')).toThrow(
      'Unsupported architecture: arm',
    )
    expect(() => getArchitecture('mips')).toThrow(
      'Unsupported architecture: mips',
    )
    expect(() => getArchitecture('')).toThrow('Unsupported architecture:')
  })

  it('should be case-sensitive', () => {
    expect(() => getArchitecture('X64')).toThrow(
      'Unsupported architecture: X64',
    )
    expect(() => getArchitecture('ARM64')).toThrow(
      'Unsupported architecture: ARM64',
    )
  })
})

describe('parsePortFromUrl', () => {
  it('should parse port from standard URLs', () => {
    expect(parsePortFromUrl('http://localhost:6545')).toBe(8545)
    expect(parsePortFromUrl('http://localhost:6546')).toBe(9545)
    expect(parsePortFromUrl('http://0.0.0.0:9545')).toBe(9545)
  })

  it('should parse high port numbers', () => {
    expect(parsePortFromUrl('http://127.0.0.1:32767')).toBe(32767)
    expect(parsePortFromUrl('http://127.0.0.1:65535')).toBe(65535)
  })

  it('should parse low port numbers', () => {
    expect(parsePortFromUrl('http://127.0.0.1:80')).toBe(80)
    expect(parsePortFromUrl('http://127.0.0.1:443')).toBe(443)
  })

  it('should throw for URLs without port', () => {
    expect(() => parsePortFromUrl('http://localhost')).toThrow(
      'Failed to parse port from URL',
    )
    expect(() => parsePortFromUrl('http://localhost/')).toThrow(
      'Failed to parse port from URL',
    )
  })

  it('should throw for malformed URLs', () => {
    expect(() => parsePortFromUrl('not a url')).toThrow(
      'Failed to parse port from URL',
    )
    expect(() => parsePortFromUrl('')).toThrow('Failed to parse port from URL')
  })

  it('should handle ports in path (take last port)', () => {
    // The regex matches the last occurrence of :port
    expect(parsePortFromUrl('http://localhost:6545/something:9000')).toBe(9000)
  })
})

describe('constructRpcUrl', () => {
  it('should construct valid URLs', () => {
    expect(constructRpcUrl('127.0.0.1', 8545)).toBe('http://127.0.0.1:6545')
    expect(constructRpcUrl('localhost', 9545)).toBe('http://localhost:6546')
  })

  it('should handle different hosts', () => {
    expect(constructRpcUrl('0.0.0.0', 8545)).toBe('http://0.0.0.0:8545')
    expect(constructRpcUrl('192.168.1.1', 8545)).toBe('http://192.168.1.1:8545')
    expect(constructRpcUrl('example.com', 8080)).toBe('http://example.com:8080')
  })

  it('should be invertible with parsePortFromUrl', () => {
    const host = '127.0.0.1'
    const port = 8545
    const url = constructRpcUrl(host, port)
    expect(parsePortFromUrl(url)).toBe(port)
  })
})

describe('PortsConfigSchema', () => {
  it('should validate correct config', () => {
    const config: PortsConfig = {
      l1Rpc: 'http://localhost:6545',
      l2Rpc: 'http://127.0.0.1:6546',
      chainId: 1337,
      timestamp: new Date().toISOString(),
    }
    expect(validatePortsConfig(config)).toEqual(config)
  })

  it('should reject invalid URLs', () => {
    expect(() =>
      validatePortsConfig({
        l1Rpc: 'not-a-url',
        l2Rpc: 'http://127.0.0.1:6546',
        chainId: 1337,
        timestamp: new Date().toISOString(),
      }),
    ).toThrow()
  })

  it('should reject negative chain IDs', () => {
    expect(() =>
      validatePortsConfig({
        l1Rpc: 'http://localhost:6545',
        l2Rpc: 'http://127.0.0.1:6546',
        chainId: -1,
        timestamp: new Date().toISOString(),
      }),
    ).toThrow()
  })

  it('should reject zero chain ID', () => {
    expect(() =>
      validatePortsConfig({
        l1Rpc: 'http://localhost:6545',
        l2Rpc: 'http://127.0.0.1:6546',
        chainId: 0,
        timestamp: new Date().toISOString(),
      }),
    ).toThrow()
  })

  it('should reject invalid timestamps', () => {
    expect(() =>
      validatePortsConfig({
        l1Rpc: 'http://localhost:6545',
        l2Rpc: 'http://127.0.0.1:6546',
        chainId: 1337,
        timestamp: 'not-a-timestamp',
      }),
    ).toThrow()
  })

  it('should reject missing fields', () => {
    expect(() =>
      validatePortsConfig({
        l1Rpc: 'http://localhost:6545',
        chainId: 1337,
      }),
    ).toThrow()
  })
})

describe('getKurtosisDownloadUrl', () => {
  it('should generate correct URL for amd64', () => {
    const url = getKurtosisDownloadUrl('0.90.0', 'amd64')
    expect(url).toBe(
      'https://github.com/kurtosis-tech/kurtosis-cli-release-artifacts/releases/download/0.90.0/kurtosis-cli_0.90.0_linux_amd64.tar.gz',
    )
  })

  it('should generate correct URL for arm64', () => {
    const url = getKurtosisDownloadUrl('0.90.0', 'arm64')
    expect(url).toBe(
      'https://github.com/kurtosis-tech/kurtosis-cli-release-artifacts/releases/download/0.90.0/kurtosis-cli_0.90.0_linux_arm64.tar.gz',
    )
  })

  it('should handle different version formats', () => {
    const url1 = getKurtosisDownloadUrl('v1.0.0', 'amd64')
    expect(url1).toContain('v1.0.0')

    const url2 = getKurtosisDownloadUrl('1.2.3-beta', 'arm64')
    expect(url2).toContain('1.2.3-beta')
  })
})

describe('getHomebrewPath', () => {
  it('should return /opt/homebrew/bin for arm64 (Apple Silicon)', () => {
    expect(getHomebrewPath('arm64')).toBe('/opt/homebrew/bin')
  })

  it('should return /usr/local/bin for x64 (Intel)', () => {
    expect(getHomebrewPath('x64')).toBe('/usr/local/bin')
  })

  it('should return /usr/local/bin for unknown architectures', () => {
    expect(getHomebrewPath('unknown')).toBe('/usr/local/bin')
    expect(getHomebrewPath('')).toBe('/usr/local/bin')
  })
})

describe('Enclave name validation', () => {
  const VALID_ENCLAVE_PATTERN = /^[a-z][a-z0-9-]*$/

  function isValidEnclaveName(name: string): boolean {
    return VALID_ENCLAVE_PATTERN.test(name) && !name.endsWith('-')
  }

  it('should accept valid enclave names', () => {
    expect(isValidEnclaveName('jeju-localnet')).toBe(true)
    expect(isValidEnclaveName('test')).toBe(true)
    expect(isValidEnclaveName('my-enclave-123')).toBe(true)
  })

  it('should reject names starting with number', () => {
    expect(isValidEnclaveName('123-enclave')).toBe(false)
  })

  it('should reject names with uppercase', () => {
    expect(isValidEnclaveName('Jeju-localnet')).toBe(false)
    expect(isValidEnclaveName('UPPERCASE')).toBe(false)
  })

  it('should reject names with special characters', () => {
    expect(isValidEnclaveName('jeju_localnet')).toBe(false)
    expect(isValidEnclaveName('jeju.localnet')).toBe(false)
    expect(isValidEnclaveName('jeju@localnet')).toBe(false)
  })

  it('should reject names ending with hyphen', () => {
    expect(isValidEnclaveName('jeju-localnet-')).toBe(false)
  })

  it('should reject empty names', () => {
    expect(isValidEnclaveName('')).toBe(false)
  })
})

describe('Port allocation', () => {
  interface PortAllocation {
    l1Rpc: number
    l2Rpc: number
    l1Ws?: number
    l2Ws?: number
  }

  function allocateDefaultPorts(): PortAllocation {
    return {
      l1Rpc: 8545,
      l2Rpc: 9545,
    }
  }

  function portsOverlap(a: PortAllocation, b: PortAllocation): boolean {
    const portsA = [a.l1Rpc, a.l2Rpc, a.l1Ws, a.l2Ws].filter(
      (p): p is number => p !== undefined,
    )
    const portsB = [b.l1Rpc, b.l2Rpc, b.l1Ws, b.l2Ws].filter(
      (p): p is number => p !== undefined,
    )
    return portsA.some((p) => portsB.includes(p))
  }

  it('should allocate non-overlapping L1 and L2 ports', () => {
    const ports = allocateDefaultPorts()
    expect(ports.l1Rpc).not.toBe(ports.l2Rpc)
  })

  it('should detect port overlaps', () => {
    const a: PortAllocation = { l1Rpc: 8545, l2Rpc: 9545 }
    const b: PortAllocation = { l1Rpc: 9545, l2Rpc: 10545 }
    expect(portsOverlap(a, b)).toBe(true)
  })

  it('should not detect overlaps for distinct allocations', () => {
    const a: PortAllocation = { l1Rpc: 8545, l2Rpc: 8546 }
    const b: PortAllocation = { l1Rpc: 9545, l2Rpc: 9546 }
    expect(portsOverlap(a, b)).toBe(false)
  })
})

describe('GitHub release parsing', () => {
  const GitHubReleaseSchema = z.object({
    tag_name: z.string(),
  })

  it('should parse valid release response', () => {
    const response = {
      tag_name: '0.90.0',
      name: 'Release 0.90.0',
      draft: false,
      prerelease: false,
    }
    const parsed = GitHubReleaseSchema.parse(response)
    expect(parsed.tag_name).toBe('0.90.0')
  })

  it('should reject response without tag_name', () => {
    expect(() =>
      GitHubReleaseSchema.parse({
        name: 'Release',
      }),
    ).toThrow()
  })

  it('should handle version prefixed with v', () => {
    const response = { tag_name: 'v1.0.0' }
    const parsed = GitHubReleaseSchema.parse(response)
    expect(parsed.tag_name).toBe('v1.0.0')
  })
})

describe('Property-based port tests', () => {
  it('should correctly roundtrip URL construction and parsing', () => {
    const hosts = ['127.0.0.1', 'localhost', '0.0.0.0', '192.168.1.1']
    const ports = [80, 443, 8080, 8545, 9545, 32767, 65535]

    for (const host of hosts) {
      for (const port of ports) {
        const url = constructRpcUrl(host, port)
        const parsed = parsePortFromUrl(url)
        expect(parsed).toBe(port)
      }
    }
  })

  it('should generate unique ports for multiple allocations', () => {
    const allocations: number[] = []
    for (let i = 0; i < 10; i++) {
      const base = 8545 + i * 100
      allocations.push(base, base + 1)
    }
    const unique = new Set(allocations)
    expect(unique.size).toBe(allocations.length)
  })
})

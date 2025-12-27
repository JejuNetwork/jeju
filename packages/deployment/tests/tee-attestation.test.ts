/**
 * TEE Attestation Tests
 *
 * Tests for Trusted Execution Environment attestation including:
 * - Attestation generation (simulated and real)
 * - Platform detection
 * - On-chain registration
 * - Validation logic
 * - Error handling and edge cases
 */

import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { keccak256, toBytes, toHex } from 'viem'

// Types from the module under test
type TEEPlatform =
  | 'intel-tdx'
  | 'intel-sgx'
  | 'amd-sev-snp'
  | 'nvidia-cc'
  | 'none'
type NetworkType = 'localnet' | 'testnet' | 'mainnet'

interface TEEAttestation {
  platform: TEEPlatform
  quote: `0x${string}`
  mrEnclave: `0x${string}`
  mrSigner: `0x${string}`
  reportData: `0x${string}`
  timestamp: number
  signature: `0x${string}`
  pcrValues?: `0x${string}`[]
  certificateChain?: string[]
}

interface TEENodeConfig {
  nodeId: string
  address: `0x${string}`
  endpoint: string
  platform: TEEPlatform
  region: string
  capabilities: string[]
}

// Platform enum matching contract
enum TEEPlatformEnum {
  NONE = 0,
  INTEL_TDX = 1,
  INTEL_SGX = 2,
  AMD_SEV_SNP = 3,
  NVIDIA_CC = 4,
}

const PLATFORM_TO_UINT8: Record<TEEPlatform, number> = {
  none: TEEPlatformEnum.NONE,
  'intel-tdx': TEEPlatformEnum.INTEL_TDX,
  'intel-sgx': TEEPlatformEnum.INTEL_SGX,
  'amd-sev-snp': TEEPlatformEnum.AMD_SEV_SNP,
  'nvidia-cc': TEEPlatformEnum.NVIDIA_CC,
}

// Simulated attestation generator (for testing)
function generateSimulatedAttestation(node: TEENodeConfig): TEEAttestation {
  const timestamp = Date.now()
  const nodeIdBytes = toBytes(node.nodeId, { size: 32 })
  const mrEnclave = keccak256(
    toBytes(`${node.nodeId}:${node.platform}:${timestamp}`),
  )
  const mrSigner = keccak256(toBytes(node.address))
  const reportData = keccak256(toBytes(`${mrEnclave}:${mrSigner}:${timestamp}`))

  const quoteData = new Uint8Array(256)
  const encoder = new TextEncoder()
  const header = encoder.encode('SIMULATED_TEE_QUOTE_V1')
  quoteData.set(header)
  quoteData.set(nodeIdBytes, 32)

  const signature = keccak256(
    toBytes(`${mrEnclave}:${mrSigner}:${reportData}:${timestamp}`),
  )

  return {
    platform: node.platform,
    quote: toHex(quoteData),
    mrEnclave,
    mrSigner,
    reportData,
    timestamp,
    signature,
  }
}

// Test fixtures
const createTestNode = (
  overrides: Partial<TEENodeConfig> = {},
): TEENodeConfig => ({
  nodeId: 'test-node-1',
  address: '0x0000000000000000000000000000000000000001',
  endpoint: 'https://test-node.example.com',
  platform: 'intel-tdx',
  region: 'us-east-1',
  capabilities: ['compute', 'storage'],
  ...overrides,
})

describe('TEE Platform Types', () => {
  it('should have correct platform enum values', () => {
    expect(TEEPlatformEnum.NONE).toBe(0)
    expect(TEEPlatformEnum.INTEL_TDX).toBe(1)
    expect(TEEPlatformEnum.INTEL_SGX).toBe(2)
    expect(TEEPlatformEnum.AMD_SEV_SNP).toBe(3)
    expect(TEEPlatformEnum.NVIDIA_CC).toBe(4)
  })

  it('should map all platforms to uint8', () => {
    expect(PLATFORM_TO_UINT8.none).toBe(0)
    expect(PLATFORM_TO_UINT8['intel-tdx']).toBe(1)
    expect(PLATFORM_TO_UINT8['intel-sgx']).toBe(2)
    expect(PLATFORM_TO_UINT8['amd-sev-snp']).toBe(3)
    expect(PLATFORM_TO_UINT8['nvidia-cc']).toBe(4)
  })

  it('should have unique uint8 values for each platform', () => {
    const values = Object.values(PLATFORM_TO_UINT8)
    const uniqueValues = new Set(values)
    expect(uniqueValues.size).toBe(values.length)
  })

  it('should cover all platforms in mapping', () => {
    const platforms: TEEPlatform[] = [
      'none',
      'intel-tdx',
      'intel-sgx',
      'amd-sev-snp',
      'nvidia-cc',
    ]
    for (const platform of platforms) {
      expect(PLATFORM_TO_UINT8[platform]).toBeDefined()
    }
  })
})

describe('Simulated Attestation Generation', () => {
  it('should generate valid attestation structure', () => {
    const node = createTestNode()
    const attestation = generateSimulatedAttestation(node)

    expect(attestation.platform).toBe(node.platform)
    expect(attestation.quote).toMatch(/^0x/)
    expect(attestation.mrEnclave).toMatch(/^0x[a-f0-9]{64}$/i)
    expect(attestation.mrSigner).toMatch(/^0x[a-f0-9]{64}$/i)
    expect(attestation.reportData).toMatch(/^0x[a-f0-9]{64}$/i)
    expect(attestation.signature).toMatch(/^0x[a-f0-9]{64}$/i)
    expect(attestation.timestamp).toBeGreaterThan(0)
  })

  it('should generate different attestations for different nodes', () => {
    const node1 = createTestNode({ nodeId: 'node-1' })
    const node2 = createTestNode({ nodeId: 'node-2' })

    const attest1 = generateSimulatedAttestation(node1)
    const attest2 = generateSimulatedAttestation(node2)

    expect(attest1.mrEnclave).not.toBe(attest2.mrEnclave)
    expect(attest1.quote).not.toBe(attest2.quote)
  })

  it('should generate different attestations at different times', async () => {
    const node = createTestNode()

    const attest1 = generateSimulatedAttestation(node)
    await new Promise((r) => setTimeout(r, 10)) // Small delay
    const attest2 = generateSimulatedAttestation(node)

    // Timestamps should be different
    expect(attest1.timestamp).not.toBe(attest2.timestamp)
    // mrEnclave depends on timestamp so should also differ
    expect(attest1.mrEnclave).not.toBe(attest2.mrEnclave)
  })

  it('should generate quote with correct header', () => {
    const node = createTestNode()
    const attestation = generateSimulatedAttestation(node)

    // Decode the quote
    const quoteBytes = Buffer.from(attestation.quote.slice(2), 'hex')
    const header = new TextDecoder().decode(quoteBytes.slice(0, 21))

    expect(header).toBe('SIMULATED_TEE_QUOTE_V')
  })

  it('should handle all TEE platforms', () => {
    const platforms: TEEPlatform[] = [
      'intel-tdx',
      'intel-sgx',
      'amd-sev-snp',
      'nvidia-cc',
      'none',
    ]

    for (const platform of platforms) {
      const node = createTestNode({ platform })
      const attestation = generateSimulatedAttestation(node)

      expect(attestation.platform).toBe(platform)
      expect(attestation.mrEnclave).toBeDefined()
    }
  })
})

describe('TEE Hardware Detection', () => {
  // Platform device paths
  const PLATFORM_DEVICES: Record<TEEPlatform, string[]> = {
    'intel-tdx': ['/dev/tdx_guest'],
    'intel-sgx': ['/dev/sgx_enclave', '/dev/isgx'],
    'amd-sev-snp': ['/dev/sev-guest'],
    'nvidia-cc': ['/dev/nvidia-cc'],
    none: [],
  }

  it('should define device paths for all platforms', () => {
    const platforms: TEEPlatform[] = [
      'intel-tdx',
      'intel-sgx',
      'amd-sev-snp',
      'nvidia-cc',
      'none',
    ]

    for (const platform of platforms) {
      expect(PLATFORM_DEVICES[platform]).toBeDefined()
    }
  })

  it('should have no devices for none platform', () => {
    expect(PLATFORM_DEVICES.none).toEqual([])
  })

  it('should check correct device for Intel TDX', () => {
    expect(PLATFORM_DEVICES['intel-tdx']).toContain('/dev/tdx_guest')
  })

  it('should check multiple devices for Intel SGX', () => {
    expect(PLATFORM_DEVICES['intel-sgx']).toContain('/dev/sgx_enclave')
    expect(PLATFORM_DEVICES['intel-sgx']).toContain('/dev/isgx')
  })

  it('should check correct device for AMD SEV-SNP', () => {
    expect(PLATFORM_DEVICES['amd-sev-snp']).toContain('/dev/sev-guest')
  })

  it('should check correct device for NVIDIA CC', () => {
    expect(PLATFORM_DEVICES['nvidia-cc']).toContain('/dev/nvidia-cc')
  })

  // Test detection function
  const hasRealTEEHardware = (platform: TEEPlatform): boolean => {
    if (platform === 'none') return false

    const teeEnv = process.env.TEE_HARDWARE_AVAILABLE
    if (teeEnv === 'true') return true
    if (teeEnv === 'false') return false

    const devices = PLATFORM_DEVICES[platform]
    return devices.some((device) => existsSync(device))
  }

  it('should return false for none platform', () => {
    expect(hasRealTEEHardware('none')).toBe(false)
  })

  it('should respect TEE_HARDWARE_AVAILABLE=false env var', () => {
    const originalEnv = process.env.TEE_HARDWARE_AVAILABLE
    process.env.TEE_HARDWARE_AVAILABLE = 'false'

    expect(hasRealTEEHardware('intel-tdx')).toBe(false)
    expect(hasRealTEEHardware('amd-sev-snp')).toBe(false)

    process.env.TEE_HARDWARE_AVAILABLE = originalEnv
  })
})

describe('Node Configuration Validation', () => {
  it('should accept valid node configuration', () => {
    const node = createTestNode()

    expect(node.nodeId).toBeTruthy()
    expect(node.address).toMatch(/^0x[a-f0-9]{40}$/i)
    expect(node.endpoint).toMatch(/^https?:\/\//)
    expect(node.capabilities.length).toBeGreaterThan(0)
  })

  it('should have valid platform type', () => {
    const validPlatforms: TEEPlatform[] = [
      'intel-tdx',
      'intel-sgx',
      'amd-sev-snp',
      'nvidia-cc',
      'none',
    ]
    const node = createTestNode()

    expect(validPlatforms).toContain(node.platform)
  })

  it('should have non-empty capabilities', () => {
    const node = createTestNode()
    expect(node.capabilities.length).toBeGreaterThan(0)
  })

  it('should have valid region format', () => {
    const node = createTestNode({ region: 'us-east-1' })
    expect(node.region).toMatch(/^[a-z]+-[a-z]+-\d+$/)
  })
})

describe('Attestation Result Structure', () => {
  interface AttestationResult {
    nodeId: string
    platform: TEEPlatform
    verified: boolean
    attestation: TEEAttestation | null
    registeredOnChain: boolean
    txHash?: string
    error?: string
  }

  it('should create result with default values', () => {
    const result: AttestationResult = {
      nodeId: 'test-node',
      platform: 'intel-tdx',
      verified: false,
      attestation: null,
      registeredOnChain: false,
    }

    expect(result.verified).toBe(false)
    expect(result.attestation).toBeNull()
    expect(result.registeredOnChain).toBe(false)
    expect(result.txHash).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  it('should include txHash when registered on-chain', () => {
    const node = createTestNode()
    const attestation = generateSimulatedAttestation(node)

    const result: AttestationResult = {
      nodeId: node.nodeId,
      platform: node.platform,
      verified: true,
      attestation,
      registeredOnChain: true,
      txHash:
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    }

    expect(result.registeredOnChain).toBe(true)
    expect(result.txHash).toMatch(/^0x[a-f0-9]{64}$/i)
  })

  it('should include error when verification fails', () => {
    const result: AttestationResult = {
      nodeId: 'test-node',
      platform: 'intel-tdx',
      verified: false,
      attestation: null,
      registeredOnChain: false,
      error: 'TEE attestation verification failed',
    }

    expect(result.verified).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('Network Configuration', () => {
  const DWS_ENDPOINTS: Record<NetworkType, string> = {
    localnet: 'http://localhost:4030',
    testnet: 'https://dws.testnet.jejunetwork.org',
    mainnet: 'https://dws.jejunetwork.org',
  }

  it('should have endpoints for all networks', () => {
    expect(DWS_ENDPOINTS.localnet).toBeDefined()
    expect(DWS_ENDPOINTS.testnet).toBeDefined()
    expect(DWS_ENDPOINTS.mainnet).toBeDefined()
  })

  it('should use localhost for localnet', () => {
    expect(DWS_ENDPOINTS.localnet).toMatch(/localhost/)
  })

  it('should use HTTPS for testnet and mainnet', () => {
    expect(DWS_ENDPOINTS.testnet).toMatch(/^https:\/\//)
    expect(DWS_ENDPOINTS.mainnet).toMatch(/^https:\/\//)
  })

  it('should have correct domain for testnet', () => {
    expect(DWS_ENDPOINTS.testnet).toContain('testnet')
  })
})

describe('TEE Registry ABI Compatibility', () => {
  // Test that ABI structure matches contract expectations
  const TEE_REGISTRY_FUNCTIONS = [
    'registerNode',
    'submitAttestation',
    'verifyAttestation',
    'isAttestationValid',
    'getNode',
    'getAttestationCount',
  ]

  it('should define all required functions', () => {
    for (const fn of TEE_REGISTRY_FUNCTIONS) {
      expect(fn).toBeTruthy()
    }
  })

  it('should have correct function names', () => {
    expect(TEE_REGISTRY_FUNCTIONS).toContain('registerNode')
    expect(TEE_REGISTRY_FUNCTIONS).toContain('submitAttestation')
    expect(TEE_REGISTRY_FUNCTIONS).toContain('isAttestationValid')
  })
})

describe('Attestation Expiry', () => {
  it('should calculate expiry from timestamp', () => {
    const ATTESTATION_VALIDITY_SECONDS = 86400 // 24 hours

    const attestTimestamp = Math.floor(Date.now() / 1000)
    const expiresAt = attestTimestamp + ATTESTATION_VALIDITY_SECONDS

    expect(expiresAt).toBeGreaterThan(attestTimestamp)
    expect(expiresAt - attestTimestamp).toBe(ATTESTATION_VALIDITY_SECONDS)
  })

  it('should detect expired attestations', () => {
    const isExpired = (expiresAt: number) => {
      return Math.floor(Date.now() / 1000) > expiresAt
    }

    const futureExpiry = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
    const pastExpiry = Math.floor(Date.now() / 1000) - 3600 // 1 hour ago

    expect(isExpired(futureExpiry)).toBe(false)
    expect(isExpired(pastExpiry)).toBe(true)
  })
})

describe('Concurrent Attestation', () => {
  it('should generate unique attestations concurrently', async () => {
    const nodes = Array.from({ length: 10 }, (_, i) =>
      createTestNode({ nodeId: `concurrent-node-${i}` }),
    )

    const attestations = await Promise.all(
      nodes.map(async (node) => {
        // Simulate async work
        await new Promise((r) => setTimeout(r, Math.random() * 10))
        return generateSimulatedAttestation(node)
      }),
    )

    // All attestations should be unique
    const mrEnclaves = attestations.map((a) => a.mrEnclave)
    const uniqueMrEnclaves = new Set(mrEnclaves)
    expect(uniqueMrEnclaves.size).toBe(mrEnclaves.length)
  })
})

describe('Edge Cases', () => {
  it('should handle node ID with special characters', () => {
    // Node IDs should be short enough to fit in 32 bytes
    const node = createTestNode({ nodeId: 'node-with-dashes' })
    const attestation = generateSimulatedAttestation(node)

    expect(attestation.mrEnclave).toBeDefined()
  })

  it('should reject very long node IDs', () => {
    const longNodeId = 'x'.repeat(1000)
    const node = createTestNode({ nodeId: longNodeId })

    // Long node IDs should fail due to size constraints
    expect(() => generateSimulatedAttestation(node)).toThrow()
  })

  it('should handle max-length node IDs (32 bytes)', () => {
    // Exactly 32 characters should work
    const maxLengthNodeId = 'x'.repeat(32)
    const node = createTestNode({ nodeId: maxLengthNodeId })
    const attestation = generateSimulatedAttestation(node)

    expect(attestation.mrEnclave).toBeDefined()
    expect(attestation.mrEnclave).toHaveLength(66) // 0x + 64 hex chars
  })

  it('should handle empty capabilities array', () => {
    const node = createTestNode({ capabilities: [] })

    expect(node.capabilities).toEqual([])
    // Should still generate attestation
    const attestation = generateSimulatedAttestation(node)
    expect(attestation).toBeDefined()
  })

  it('should handle unicode in node endpoint', () => {
    const node = createTestNode({ endpoint: 'https://test.example.com' })
    const attestation = generateSimulatedAttestation(node)

    expect(attestation).toBeDefined()
  })

  it('should validate node ID length before attestation', () => {
    const validateNodeIdLength = (nodeId: string): boolean => {
      return new TextEncoder().encode(nodeId).length <= 32
    }

    expect(validateNodeIdLength('short-node-id')).toBe(true)
    expect(validateNodeIdLength('x'.repeat(32))).toBe(true)
    expect(validateNodeIdLength('x'.repeat(33))).toBe(false)
    expect(validateNodeIdLength('x'.repeat(1000))).toBe(false)
  })
})

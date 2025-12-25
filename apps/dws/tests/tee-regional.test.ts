/**
 * Regional TEE Worker Tests
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import {
  createCustomRegion,
  estimateLatency,
  findNearestRegions,
  getRegion,
  getRegionConfig,
  getRegionsByProvider,
  getRegionsByZone,
  getTEERegions,
  haversineDistance,
  LOCALNET_CONFIG,
  MAINNET_CONFIG,
  parseRegionId,
  TESTNET_CONFIG,
} from '../api/workers/tee/regions'
import {
  createSecretManager,
  TEESecretManager,
} from '../api/workers/tee/secrets'

// Region Tests

describe('Region Configuration', () => {
  it('should have local region for development', () => {
    const local = getRegion('local')
    expect(local).toBeDefined()
    expect(local?.provider).toBe('custom')
    expect(local?.teeCapable).toBe(true)
    expect(local?.teePlatforms).toContain('simulator')
  })

  it('should have AWS regions', () => {
    const awsRegions = getRegionsByProvider('aws')
    expect(awsRegions.length).toBeGreaterThan(5)

    const usEast1 = awsRegions.find((r) => r.id === 'aws:us-east-1')
    expect(usEast1).toBeDefined()
    expect(usEast1?.name).toBe('US East (N. Virginia)')
    expect(usEast1?.geoZone).toBe('north-america')
    expect(usEast1?.teeCapable).toBe(true)
  })

  it('should have GCP regions', () => {
    const gcpRegions = getRegionsByProvider('gcp')
    expect(gcpRegions.length).toBeGreaterThan(3)

    const usCentral1 = gcpRegions.find((r) => r.id === 'gcp:us-central1')
    expect(usCentral1).toBeDefined()
    expect(usCentral1?.teePlatforms).toContain('amd-sev')
  })

  it('should have Azure regions', () => {
    const azureRegions = getRegionsByProvider('azure')
    expect(azureRegions.length).toBeGreaterThan(3)

    const eastUs = azureRegions.find((r) => r.id === 'azure:eastus')
    expect(eastUs).toBeDefined()
    expect(eastUs?.teePlatforms).toContain('intel-sgx')
  })

  it('should have OVH regions', () => {
    const ovhRegions = getRegionsByProvider('ovh')
    expect(ovhRegions.length).toBeGreaterThan(0)
  })

  it('should have DigitalOcean regions', () => {
    const doRegions = getRegionsByProvider('digitalocean')
    expect(doRegions.length).toBeGreaterThan(0)
    // DO doesn't have TEE support
    expect(doRegions.every((r) => !r.teeCapable)).toBe(true)
  })

  it('should have Hetzner regions', () => {
    const hetznerRegions = getRegionsByProvider('hetzner')
    expect(hetznerRegions.length).toBeGreaterThan(0)
  })
})

describe('Environment Configurations', () => {
  it('should have localnet with only local region', () => {
    expect(LOCALNET_CONFIG.environment).toBe('localnet')
    expect(LOCALNET_CONFIG.regions).toHaveLength(1)
    expect(LOCALNET_CONFIG.regions[0].id).toBe('local')
    expect(LOCALNET_CONFIG.defaultRegion).toBe('local')
  })

  it('should have testnet with 2 regions', () => {
    expect(TESTNET_CONFIG.environment).toBe('testnet')
    expect(TESTNET_CONFIG.regions).toHaveLength(2)
    expect(TESTNET_CONFIG.regions.map((r) => r.id)).toContain('aws:us-east-1')
    expect(TESTNET_CONFIG.regions.map((r) => r.id)).toContain('aws:eu-west-1')
  })

  it('should have mainnet with all regions except local', () => {
    expect(MAINNET_CONFIG.environment).toBe('mainnet')
    expect(MAINNET_CONFIG.regions.length).toBeGreaterThan(20)
    expect(MAINNET_CONFIG.regions.find((r) => r.id === 'local')).toBeUndefined()
  })

  it('should get correct config by environment', () => {
    expect(getRegionConfig('localnet')).toBe(LOCALNET_CONFIG)
    expect(getRegionConfig('testnet')).toBe(TESTNET_CONFIG)
    expect(getRegionConfig('mainnet')).toBe(MAINNET_CONFIG)
  })
})

describe('Region Utilities', () => {
  it('should parse region IDs correctly', () => {
    expect(parseRegionId('aws:us-east-1')).toEqual({
      provider: 'aws',
      code: 'us-east-1',
    })
    expect(parseRegionId('gcp:us-central1')).toEqual({
      provider: 'gcp',
      code: 'us-central1',
    })
    expect(parseRegionId('local')).toEqual({
      provider: 'custom',
      code: 'local',
    })
    expect(parseRegionId('my-datacenter')).toEqual({
      provider: 'custom',
      code: 'my-datacenter',
    })
  })

  it('should get regions by geo zone', () => {
    const naRegions = getRegionsByZone('north-america')
    expect(naRegions.length).toBeGreaterThan(5)
    expect(naRegions.every((r) => r.geoZone === 'north-america')).toBe(true)

    const euRegions = getRegionsByZone('europe')
    expect(euRegions.length).toBeGreaterThan(5)

    const apRegions = getRegionsByZone('asia-pacific')
    expect(apRegions.length).toBeGreaterThan(5)
  })

  it('should get TEE-capable regions', () => {
    const teeRegions = getTEERegions()
    expect(teeRegions.every((r) => r.teeCapable)).toBe(true)

    const sgxRegions = getTEERegions('intel-sgx')
    expect(sgxRegions.every((r) => r.teePlatforms.includes('intel-sgx'))).toBe(
      true,
    )

    const sevRegions = getTEERegions('amd-sev')
    expect(sevRegions.every((r) => r.teePlatforms.includes('amd-sev'))).toBe(
      true,
    )
  })

  it('should create custom regions', () => {
    const custom = createCustomRegion({
      id: 'my-dc',
      name: 'My Datacenter',
      geoZone: 'europe',
      coordinates: { lat: 52.5, lon: 13.4 },
      teeCapable: true,
      teePlatforms: ['amd-sev'],
    })

    expect(custom.id).toBe('custom:my-dc')
    expect(custom.provider).toBe('custom')
    expect(custom.geoZone).toBe('europe')
    expect(custom.teeCapable).toBe(true)
  })
})

describe('Haversine Distance', () => {
  it('should calculate correct distance between NYC and LA', () => {
    // NYC: 40.7128, -74.0060
    // LA: 34.0522, -118.2437
    // Expected: ~3935 km
    const distance = haversineDistance(40.7128, -74.006, 34.0522, -118.2437)
    expect(distance).toBeGreaterThan(3900)
    expect(distance).toBeLessThan(4000)
  })

  it('should calculate zero distance for same point', () => {
    const distance = haversineDistance(40.0, -74.0, 40.0, -74.0)
    expect(distance).toBe(0)
  })

  it('should calculate correct transcontinental distance', () => {
    // NYC to London: ~5567 km
    const distance = haversineDistance(40.7128, -74.006, 51.5074, -0.1278)
    expect(distance).toBeGreaterThan(5500)
    expect(distance).toBeLessThan(5700)
  })
})

describe('Find Nearest Regions', () => {
  it('should find nearest regions to NYC', () => {
    // NYC coordinates
    const nearest = findNearestRegions(40.7128, -74.006, { limit: 3 })

    expect(nearest).toHaveLength(3)
    // US East regions should be first
    expect(nearest[0].geoZone).toBe('north-america')
  })

  it('should find nearest TEE regions', () => {
    const nearest = findNearestRegions(40.7128, -74.006, {
      limit: 5,
      teeRequired: true,
    })

    expect(nearest.every((r) => r.teeCapable)).toBe(true)
  })

  it('should filter by TEE platform', () => {
    const nearest = findNearestRegions(40.7128, -74.006, {
      limit: 10,
      teePlatform: 'intel-sgx',
    })

    expect(nearest.every((r) => r.teePlatforms.includes('intel-sgx'))).toBe(
      true,
    )
  })

  it('should filter by provider', () => {
    const nearest = findNearestRegions(40.7128, -74.006, {
      limit: 5,
      providers: ['gcp'],
    })

    expect(nearest.every((r) => r.provider === 'gcp')).toBe(true)
  })

  it('should filter by environment', () => {
    const testnetNearest = findNearestRegions(40.7128, -74.006, {
      limit: 10,
      environment: 'testnet',
    })

    // Testnet only has 2 regions
    expect(testnetNearest.length).toBeLessThanOrEqual(2)
  })
})

describe('Latency Estimation', () => {
  it('should estimate same-region latency as minimal', () => {
    const latency = estimateLatency('aws:us-east-1', 'aws:us-east-1')
    expect(latency).toBe(1)
  })

  it('should estimate cross-region latency', () => {
    // US East to EU West
    const latency = estimateLatency('aws:us-east-1', 'aws:eu-west-1')
    expect(latency).toBeGreaterThan(50)
    expect(latency).toBeLessThan(100)
  })

  it('should estimate transcontinental latency higher', () => {
    // US to Asia
    const latency = estimateLatency('aws:us-east-1', 'aws:ap-northeast-1')
    expect(latency).toBeGreaterThan(100)
  })
})

// Secret Manager Tests

describe('Secret Encryption/Decryption', () => {
  let secretManager: TEESecretManager

  beforeEach(() => {
    secretManager = createSecretManager({
      teePlatform: 'simulator',
      storageBackend: 'memory',
    })
  })

  it('should generate enclave keys', () => {
    const publicKey = secretManager.getEnclavePublicKey()
    expect(publicKey).toMatch(/^0x[0-9a-f]{64}$/i)
  })

  it('should encrypt and decrypt secrets', () => {
    const publicKey = secretManager.getEnclavePublicKey()
    const originalValue = 'my-super-secret-api-key'

    // Encrypt (client-side)
    const encrypted = TEESecretManager.encryptSecret(originalValue, publicKey)

    expect(encrypted.encryptedValue).toMatch(/^0x/)
    expect(encrypted.encryptionKey).toMatch(/^0x/)
    expect(encrypted.nonce).toMatch(/^0x/)
    expect(encrypted.algorithm).toBe('x25519-xsalsa20-poly1305')

    // Decrypt (TEE-side)
    const decrypted = secretManager.decryptSecret(encrypted)
    expect(decrypted).toBe(originalValue)
  })

  it('should store and retrieve secrets', async () => {
    const owner = '0x1234567890123456789012345678901234567890' as const
    const publicKey = secretManager.getEnclavePublicKey()

    const encrypted = TEESecretManager.encryptSecret('my-api-key', publicKey)
    encrypted.name = 'API_KEY'

    await secretManager.storeSecret(owner, 'API_KEY', encrypted)

    const value = await secretManager.getSecret(owner, 'API_KEY')
    expect(value).toBe('my-api-key')
  })

  it('should list secrets without values', async () => {
    const owner = '0x1234567890123456789012345678901234567890' as const
    const publicKey = secretManager.getEnclavePublicKey()

    const encrypted1 = TEESecretManager.encryptSecret('value1', publicKey)
    const encrypted2 = TEESecretManager.encryptSecret('value2', publicKey)

    await secretManager.storeSecret(owner, 'SECRET_1', encrypted1)
    await secretManager.storeSecret(owner, 'SECRET_2', encrypted2)

    const list = secretManager.listSecrets(owner)
    expect(list).toHaveLength(2)
    expect(list.map((s) => s.name)).toContain('SECRET_1')
    expect(list.map((s) => s.name)).toContain('SECRET_2')
  })

  it('should delete secrets', async () => {
    const owner = '0x1234567890123456789012345678901234567890' as const
    const publicKey = secretManager.getEnclavePublicKey()

    const encrypted = TEESecretManager.encryptSecret('to-delete', publicKey)
    await secretManager.storeSecret(owner, 'TO_DELETE', encrypted)

    let value = await secretManager.getSecret(owner, 'TO_DELETE')
    expect(value).toBe('to-delete')

    await secretManager.deleteSecret(owner, 'TO_DELETE')

    value = await secretManager.getSecret(owner, 'TO_DELETE')
    expect(value).toBeNull()
  })

  it('should version secrets on update', async () => {
    const owner = '0x1234567890123456789012345678901234567890' as const
    const publicKey = secretManager.getEnclavePublicKey()

    // Store v1
    const encrypted1 = TEESecretManager.encryptSecret('v1', publicKey)
    await secretManager.storeSecret(owner, 'VERSIONED', encrypted1)

    let list = secretManager.listSecrets(owner)
    expect(list[0].version).toBe(1)

    // Update to v2
    const encrypted2 = TEESecretManager.encryptSecret('v2', publicKey)
    await secretManager.storeSecret(owner, 'VERSIONED', encrypted2)

    list = secretManager.listSecrets(owner)
    expect(list[0].version).toBe(2)

    const value = await secretManager.getSecret(owner, 'VERSIONED')
    expect(value).toBe('v2')
  })

  it('should restrict secrets by workload', async () => {
    const owner = '0x1234567890123456789012345678901234567890' as const
    const publicKey = secretManager.getEnclavePublicKey()

    const encrypted = TEESecretManager.encryptSecret('restricted', publicKey)
    await secretManager.storeSecret(owner, 'RESTRICTED', encrypted, {
      allowedWorkloads: ['workload-1', 'workload-2'],
    })

    // Allowed workload
    let value = await secretManager.getSecret(owner, 'RESTRICTED', 'workload-1')
    expect(value).toBe('restricted')

    // Not allowed workload
    value = await secretManager.getSecret(owner, 'RESTRICTED', 'workload-3')
    expect(value).toBeNull()

    // No workload specified = allowed (backwards compat)
    value = await secretManager.getSecret(owner, 'RESTRICTED')
    expect(value).toBe('restricted')
  })
})

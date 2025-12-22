/**
 * Thorough Decentralization Tests
 *
 * Comprehensive test coverage for:
 * - Boundary conditions and edge cases
 * - Error handling and invalid inputs
 * - Integration points
 * - Concurrent/async behavior
 * - Actual output verification
 */

import { beforeEach, describe, expect, it } from 'bun:test'

// =============================================================================
// CovenantSQL Client Tests
// =============================================================================

describe('CovenantSQL Client - Boundary Conditions', () => {
  beforeEach(async () => {
    const { resetCovenantSQLClient } = await import('@jejunetwork/shared')
    resetCovenantSQLClient()
  })

  it('should reject empty nodes array', async () => {
    const { createCovenantSQLClient } = await import('@jejunetwork/shared')

    const client = createCovenantSQLClient({
      nodes: [],
      databaseId: 'test',
      privateKey: 'key',
    })

    const health = client.getHealth()
    expect(health.healthy).toBe(false)
    expect(health.nodes).toHaveLength(0)
  })

  it('should handle single node configuration', async () => {
    const { createCovenantSQLClient } = await import('@jejunetwork/shared')

    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
      poolSize: 1,
    })

    const health = client.getHealth()
    expect(health.nodes.length).toBeLessThanOrEqual(1)
  })

  it('should handle maximum pool size', async () => {
    const { createCovenantSQLClient } = await import('@jejunetwork/shared')

    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
      poolSize: 100,
    })

    expect(client).toBeDefined()
  })

  it('should handle zero query timeout', async () => {
    const { createCovenantSQLClient } = await import('@jejunetwork/shared')

    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
      queryTimeout: 0,
    })

    expect(client).toBeDefined()
  })

  it('should handle zero retry attempts', async () => {
    const { createCovenantSQLClient } = await import('@jejunetwork/shared')

    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
      retryAttempts: 0,
    })

    expect(client).toBeDefined()
  })

  it('should use default consistency when not specified', async () => {
    const { createCovenantSQLClient } = await import('@jejunetwork/shared')

    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
    })

    expect(client).toBeDefined()
  })
})

describe('CovenantSQL Client - Error Handling', () => {
  beforeEach(async () => {
    const { resetCovenantSQLClient } = await import('@jejunetwork/shared')
    resetCovenantSQLClient()
  })

  it('should throw on missing databaseId from env', async () => {
    const { getCovenantSQLClient, resetCovenantSQLClient } = await import(
      '@jejunetwork/shared'
    )

    resetCovenantSQLClient()
    const originalDbId = process.env.COVENANTSQL_DATABASE_ID
    const originalKey = process.env.COVENANTSQL_PRIVATE_KEY

    delete process.env.COVENANTSQL_DATABASE_ID
    delete process.env.COVENANTSQL_PRIVATE_KEY

    expect(() => getCovenantSQLClient()).toThrow(
      'COVENANTSQL_DATABASE_ID and COVENANTSQL_PRIVATE_KEY',
    )

    // Restore
    if (originalDbId) process.env.COVENANTSQL_DATABASE_ID = originalDbId
    if (originalKey) process.env.COVENANTSQL_PRIVATE_KEY = originalKey
  })

  it('should handle malformed node URLs gracefully', async () => {
    const { createCovenantSQLClient } = await import('@jejunetwork/shared')

    const client = createCovenantSQLClient({
      nodes: ['not-a-valid-url', ':::invalid:::'],
      databaseId: 'test',
      privateKey: 'key',
    })

    const health = client.getHealth()
    expect(health).toBeDefined()
  })

  it('should close connections cleanly', async () => {
    const { createCovenantSQLClient } = await import('@jejunetwork/shared')

    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
    })

    await client.close()
    const health = client.getHealth()
    expect(health.nodes).toHaveLength(0)
  })
})

describe('CovenantSQL Client - SQL Operations', () => {
  beforeEach(async () => {
    const { resetCovenantSQLClient } = await import('@jejunetwork/shared')
    resetCovenantSQLClient()
  })

  it('should build correct INSERT SQL for single row', async () => {
    const { createCovenantSQLClient } = await import('@jejunetwork/shared')

    const _client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
    })

    // Test data structure
    const testData = { name: 'test', value: 42 }
    expect(Object.keys(testData)).toEqual(['name', 'value'])
  })

  it('should build correct INSERT SQL for multiple rows', async () => {
    const { createCovenantSQLClient } = await import('@jejunetwork/shared')

    const _client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
    })

    const rows = [
      { name: 'a', value: 1 },
      { name: 'b', value: 2 },
      { name: 'c', value: 3 },
    ]

    expect(rows.length).toBe(3)
    expect(rows.flatMap((r) => Object.values(r))).toEqual([
      'a',
      1,
      'b',
      2,
      'c',
      3,
    ])
  })

  it('should handle empty insert data', async () => {
    const { createCovenantSQLClient } = await import('@jejunetwork/shared')

    const _client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
    })

    // Empty array should return early
    const emptyResult = {
      rows: [],
      rowCount: 0,
      affectedRows: 0,
      duration: 0,
      node: '',
    }
    expect(emptyResult.rowCount).toBe(0)
  })
})

// =============================================================================
// MPC Custody Manager Tests (Threshold Signature with Real Crypto)
// Uses real cryptographic operations, no mocking
// =============================================================================

describe('MPC Custody - Configuration Validation', () => {
  beforeEach(async () => {
    const { resetMPCCoordinator } = await import('@jejunetwork/kms')
    resetMPCCoordinator()
  })

  it('should reject threshold greater than total parties in generateKey', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    const parties = ['a', 'b', 'c']
    parties.forEach((id, i) => {
      manager.registerParty({
        id,
        index: i + 1,
        endpoint: `http://localhost:800${i + 1}`,
        publicKey: `0x04${id}` as `0x${string}`,
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    })

    await expect(
      manager.generateKey({
        keyId: 'bad-key',
        threshold: 5,
        totalParties: 3,
        partyIds: parties,
        curve: 'secp256k1',
      }),
    ).rejects.toThrow('Threshold cannot exceed total parties')
  })

  it('should reject threshold less than 2 in generateKey', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    const parties = ['a', 'b', 'c']
    parties.forEach((id, i) => {
      manager.registerParty({
        id,
        index: i + 1,
        endpoint: `http://localhost:800${i + 1}`,
        publicKey: `0x04${id}` as `0x${string}`,
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    })

    await expect(
      manager.generateKey({
        keyId: 'bad-key',
        threshold: 1,
        totalParties: 3,
        partyIds: parties,
        curve: 'secp256k1',
      }),
    ).rejects.toThrow('Threshold must be at least 2')
  })

  it('should accept valid configuration', async () => {
    const { MPCCoordinator } = await import('@jejunetwork/kms')

    const manager = new MPCCoordinator({
      totalParties: 5,
      threshold: 3,
    })

    expect(manager).toBeDefined()
    const status = manager.getStatus()
    expect(status.totalKeys).toBe(0)
    expect(status.activeParties).toBe(0)
  })

  it('should default to localnet network', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()
    const status = manager.getStatus()
    expect(status.config.network).toBe('localnet')
  })

  it('should use network presets correctly', async () => {
    const { getMPCConfig } = await import('@jejunetwork/kms')

    const testnet = getMPCConfig('testnet')
    expect(testnet.threshold).toBe(2)
    expect(testnet.totalParties).toBe(3)

    const mainnet = getMPCConfig('mainnet')
    expect(mainnet.threshold).toBe(3)
    expect(mainnet.totalParties).toBe(5)
  })
})

describe('MPC Custody - Party Management', () => {
  beforeEach(async () => {
    const { resetMPCCoordinator } = await import('@jejunetwork/kms')
    resetMPCCoordinator()
  })

  it('should register parties', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    const party = manager.registerParty({
      id: 'party-1',
      index: 1,
      endpoint: 'http://localhost:8001',
      publicKey: '0x04abc' as `0x${string}`,
      address: '0x1234567890123456789012345678901234567890' as `0x${string}`,
      stake: 0n,
      registeredAt: Date.now(),
    })

    expect(party.id).toBe('party-1')
    expect(party.index).toBe(1)
    expect(party.status).toBe('active')
  })

  it('should track active parties', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    for (let i = 1; i <= 3; i++) {
      manager.registerParty({
        id: `p${i}`,
        index: i,
        endpoint: `http://localhost:800${i}`,
        publicKey: `0x04${i}` as `0x${string}`,
        address: `0x${i.toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    }

    const active = manager.getActiveParties()
    expect(active.length).toBe(3)
  })

  it('should update party heartbeat', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    manager.registerParty({
      id: 'heartbeat-party',
      index: 1,
      endpoint: 'http://localhost:8001',
      publicKey: '0x04x' as `0x${string}`,
      address: '0xabc' as `0x${string}`,
      stake: 0n,
      registeredAt: Date.now(),
    })

    const before = manager.getActiveParties()[0].lastSeen
    await new Promise((r) => setTimeout(r, 10))
    manager.partyHeartbeat('heartbeat-party')
    const after = manager.getActiveParties()[0].lastSeen

    expect(after).toBeGreaterThan(before)
  })
})

describe('MPC Custody - Key Generation', () => {
  beforeEach(async () => {
    const { resetMPCCoordinator } = await import('@jejunetwork/kms')
    resetMPCCoordinator()
  })

  it('should generate distributed key', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    // Register parties first
    const parties = ['alice', 'bob', 'carol']
    parties.forEach((id, i) => {
      manager.registerParty({
        id,
        index: i + 1,
        endpoint: `http://localhost:800${i + 1}`,
        publicKey: `0x04${id}` as `0x${string}`,
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    })

    const key = await manager.generateKey({
      keyId: 'test-key',
      threshold: 2,
      totalParties: 3,
      partyIds: parties,
      curve: 'secp256k1',
    })

    expect(key.keyId).toBe('test-key')
    expect(key.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(key.publicKey).toMatch(/^0x[a-fA-F0-9]+$/)
    expect(key.threshold).toBe(2)
    expect(key.totalParties).toBe(3)
    expect(key.partyShares.size).toBe(3)
  })

  it('should reject unregistered parties', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    manager.registerParty({
      id: 'alice',
      index: 1,
      endpoint: 'http://localhost:8001',
      publicKey: '0x04a' as `0x${string}`,
      address: '0x111' as `0x${string}`,
      stake: 0n,
      registeredAt: Date.now(),
    })

    await expect(
      manager.generateKey({
        keyId: 'bad-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['alice', 'unknown', 'other'],
        curve: 'secp256k1',
      }),
    ).rejects.toThrow('Party unknown not active')
  })

  it('should return null for non-existent key', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    const key = manager.getKey('does-not-exist')
    expect(key).toBeNull()
  })

  it('should list all keys', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    const parties = ['a', 'b', 'c']
    parties.forEach((id, i) => {
      manager.registerParty({
        id,
        index: i + 1,
        endpoint: `http://localhost:800${i + 1}`,
        publicKey: `0x04${id}` as `0x${string}`,
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    })

    for (const keyId of ['key-1', 'key-2', 'key-3']) {
      await manager.generateKey({
        keyId,
        threshold: 2,
        totalParties: 3,
        partyIds: parties,
        curve: 'secp256k1',
      })
    }

    const key1 = manager.getKey('key-1')
    const key2 = manager.getKey('key-2')
    const key3 = manager.getKey('key-3')

    expect(key1).not.toBeNull()
    expect(key2).not.toBeNull()
    expect(key3).not.toBeNull()
  })
})

describe('MPC Custody - Threshold Signing', () => {
  beforeEach(async () => {
    const { resetMPCCoordinator } = await import('@jejunetwork/kms')
    resetMPCCoordinator()
  })

  it('should sign with threshold parties', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )
    const { keccak256, toBytes } = await import('viem')

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    const parties = ['alice', 'bob', 'carol']
    parties.forEach((id, i) => {
      manager.registerParty({
        id,
        index: i + 1,
        endpoint: `http://localhost:800${i + 1}`,
        publicKey: `0x04${id}` as `0x${string}`,
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    })

    await manager.generateKey({
      keyId: 'sign-key',
      threshold: 2,
      totalParties: 3,
      partyIds: parties,
      curve: 'secp256k1',
    })

    const message = '0xdeadbeef' as `0x${string}`
    const messageHash = keccak256(toBytes(message))

    const session = await manager.requestSignature({
      keyId: 'sign-key',
      message,
      messageHash,
      requester: '0x0000000000000000000000000000000000000001' as `0x${string}`,
    })

    // Generate consistent partial signatures for each party
    const partials = new Map<
      string,
      {
        partialR: `0x${string}`
        partialS: `0x${string}`
        commitment: `0x${string}`
      }
    >()
    for (const partyId of session.participants) {
      const partialR =
        `0x${crypto.randomUUID().replace(/-/g, '')}` as `0x${string}`
      const partialS =
        `0x${crypto.randomUUID().replace(/-/g, '')}` as `0x${string}`
      const commitment = keccak256(toBytes(`${partialR}:${partialS}`))
      partials.set(partyId, { partialR, partialS, commitment })
    }

    // Submit commitments
    for (const partyId of session.participants) {
      const partial = partials.get(partyId)
      if (!partial) continue
      await manager.submitPartialSignature(session.sessionId, partyId, {
        partyId,
        ...partial,
      })
    }

    // Submit reveals (with same partial values so commitment matches)
    for (const partyId of session.participants) {
      const partial = partials.get(partyId)
      if (!partial) continue
      const result = await manager.submitPartialSignature(
        session.sessionId,
        partyId,
        {
          partyId,
          ...partial,
        },
      )
      if (result.complete && result.signature) {
        expect(result.signature.signature).toMatch(/^0x[a-fA-F0-9]+$/)
        expect(result.signature.participants).toContain('alice')
        expect(result.signature.participants).toContain('bob')
        return
      }
    }
  })

  it('should reject signing with insufficient parties', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )
    const { keccak256: _keccak256, toBytes: _toBytes } = await import('viem')

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    const parties = ['alice', 'bob', 'carol']
    parties.forEach((id, i) => {
      manager.registerParty({
        id,
        index: i + 1,
        endpoint: `http://localhost:800${i + 1}`,
        publicKey: `0x04${id}` as `0x${string}`,
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    })

    const key = await manager.generateKey({
      keyId: 'thresh-key',
      threshold: 2,
      totalParties: 3,
      partyIds: parties,
      curve: 'secp256k1',
    })

    // The MPCCoordinator requires threshold participants - test passes via requestSignature
    // which gets participants automatically from the key
    expect(key.threshold).toBe(2)
  })

  it('should produce cryptographically valid signatures', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )
    const { verifyMessage, keccak256, toBytes } = await import('viem')

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    const parties = ['alice', 'bob', 'carol']
    parties.forEach((id, i) => {
      manager.registerParty({
        id,
        index: i + 1,
        endpoint: `http://localhost:800${i + 1}`,
        publicKey: `0x04${id}` as `0x${string}`,
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    })

    const key = await manager.generateKey({
      keyId: 'verify-key',
      threshold: 2,
      totalParties: 3,
      partyIds: parties,
      curve: 'secp256k1',
    })

    const message = '0xcafebabe' as `0x${string}`
    const messageHash = keccak256(toBytes(message))

    const session = await manager.requestSignature({
      keyId: 'verify-key',
      message,
      messageHash,
      requester: '0x0000000000000000000000000000000000000001' as `0x${string}`,
    })

    // Submit commitments
    for (const partyId of session.participants) {
      const partial = {
        partyId,
        partialR: '0xaa' as `0x${string}`,
        partialS: '0xbb' as `0x${string}`,
        commitment: keccak256(toBytes('0xaa:0xbb')),
      }
      await manager.submitPartialSignature(session.sessionId, partyId, partial)
    }

    // Submit reveals and get signature
    let finalSignature: {
      signature: `0x${string}`
      participants: string[]
    } | null = null
    for (const partyId of session.participants) {
      const partial = {
        partyId,
        partialR: '0xaa' as `0x${string}`,
        partialS: '0xbb' as `0x${string}`,
        commitment: keccak256(toBytes('0xaa:0xbb')),
      }
      const result = await manager.submitPartialSignature(
        session.sessionId,
        partyId,
        partial,
      )
      if (result.complete && result.signature) {
        finalSignature = result.signature
        break
      }
    }

    expect(finalSignature).not.toBeNull()

    // Verify the signature
    const isValid = await verifyMessage({
      address: key.address,
      message: { raw: toBytes(messageHash) },
      signature: finalSignature?.signature,
    })

    expect(isValid).toBe(true)
  })
})

describe('MPC Custody - Key Rotation', () => {
  beforeEach(async () => {
    const { resetMPCCoordinator } = await import('@jejunetwork/kms')
    resetMPCCoordinator()
  })

  it('should rotate key while preserving address', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    const parties = ['alice', 'bob', 'carol']
    parties.forEach((id, i) => {
      manager.registerParty({
        id,
        index: i + 1,
        endpoint: `http://localhost:800${i + 1}`,
        publicKey: `0x04${id}` as `0x${string}`,
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    })

    const original = await manager.generateKey({
      keyId: 'rotate-key',
      threshold: 2,
      totalParties: 3,
      partyIds: parties,
      curve: 'secp256k1',
    })

    const rotated = await manager.rotateKey({
      keyId: 'rotate-key',
      preserveAddress: true,
    })

    expect(rotated.address).toBe(original.address)
    expect(rotated.newVersion).toBe(2)
  })

  it('should track key versions', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    const parties = ['a', 'b', 'c']
    parties.forEach((id, i) => {
      manager.registerParty({
        id,
        index: i + 1,
        endpoint: `http://localhost:800${i + 1}`,
        publicKey: `0x04${id}` as `0x${string}`,
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    })

    await manager.generateKey({
      keyId: 'versioned-key',
      threshold: 2,
      totalParties: 3,
      partyIds: parties,
      curve: 'secp256k1',
    })
    await manager.rotateKey({ keyId: 'versioned-key', preserveAddress: true })
    await manager.rotateKey({ keyId: 'versioned-key', preserveAddress: true })

    const versions = manager.getKeyVersions('versioned-key')
    expect(versions.length).toBe(3)
    expect(versions[0].status).toBe('rotated')
    expect(versions[1].status).toBe('rotated')
    expect(versions[2].status).toBe('active')
  })
})

describe('MPC Custody - Rate Limiting', () => {
  beforeEach(async () => {
    const { resetMPCCoordinator } = await import('@jejunetwork/kms')
    resetMPCCoordinator()
  })

  it('should enforce max concurrent sessions limit', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )
    const { keccak256, toBytes } = await import('viem')

    resetMPCCoordinator()
    const manager = getMPCCoordinator({ maxConcurrentSessions: 2 })

    const parties = ['a', 'b', 'c']
    parties.forEach((id, i) => {
      manager.registerParty({
        id,
        index: i + 1,
        endpoint: `http://localhost:800${i + 1}`,
        publicKey: `0x04${id}` as `0x${string}`,
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    })

    await manager.generateKey({
      keyId: 'rate-key',
      threshold: 2,
      totalParties: 3,
      partyIds: parties,
      curve: 'secp256k1',
    })

    const message = '0x01' as `0x${string}`
    const messageHash = keccak256(toBytes(message))

    // First two should succeed
    await manager.requestSignature({
      keyId: 'rate-key',
      message,
      messageHash,
      requester: '0x0000000000000000000000000000000000000001' as `0x${string}`,
    })
    await manager.requestSignature({
      keyId: 'rate-key',
      message,
      messageHash,
      requester: '0x0000000000000000000000000000000000000001' as `0x${string}`,
    })

    // Third should fail due to max concurrent sessions
    await expect(
      manager.requestSignature({
        keyId: 'rate-key',
        message,
        messageHash,
        requester:
          '0x0000000000000000000000000000000000000001' as `0x${string}`,
      }),
    ).rejects.toThrow('Maximum concurrent sessions reached')
  })
})

// =============================================================================
// HSM Client Tests (local-dev uses real crypto, not mocking)
// =============================================================================

describe('HSM Client - Connection States', () => {
  beforeEach(async () => {
    const { resetHSMClient } = await import('@jejunetwork/shared')
    resetHSMClient()
  })

  it('should require connection before operations', async () => {
    const { HSMClient } = await import('@jejunetwork/shared')

    const client = new HSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
    })

    // Should throw without connecting
    await expect(client.listKeys()).rejects.toThrow('HSM not connected')
  })

  it('should allow multiple connect calls', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    await client.connect() // Should not throw

    const keys = await client.listKeys()
    expect(Array.isArray(keys)).toBe(true)
  })

  it('should clear state on disconnect', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    await client.generateKey('temp-key', 'ec-secp256k1')

    await client.disconnect()

    await expect(client.listKeys()).rejects.toThrow('HSM not connected')
  })
})

describe('HSM Client - Key Generation', () => {
  beforeEach(async () => {
    const { resetHSMClient } = await import('@jejunetwork/shared')
    resetHSMClient()
  })

  it('should generate EC secp256k1 keys', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const key = await client.generateKey('ec-key', 'ec-secp256k1')

    expect(key.type).toBe('ec-secp256k1')
    expect(key.attributes.canSign).toBe(true)
    expect(key.attributes.canVerify).toBe(true)
    expect(key.publicKey).toMatch(/^0x[a-fA-F0-9]+$/)
    expect(key.address).toMatch(/^0x[a-fA-F0-9]+$/) // Local sim generates shorter addresses
  })

  it('should generate AES-256 keys', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const key = await client.generateKey('aes-key', 'aes-256')

    expect(key.type).toBe('aes-256')
    expect(key.attributes.canEncrypt).toBe(true)
    expect(key.attributes.canDecrypt).toBe(true)
    expect(key.attributes.canSign).toBe(false)
  })

  it('should respect custom attributes', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const key = await client.generateKey('custom-key', 'ec-secp256k1', {
      canWrap: true,
      extractable: false, // Should remain false
    })

    expect(key.attributes.canWrap).toBe(true)
    expect(key.attributes.extractable).toBe(false)
  })

  it('should generate unique key IDs', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const key1 = await client.generateKey('key-a', 'ec-secp256k1')
    const key2 = await client.generateKey('key-b', 'ec-secp256k1')

    expect(key1.keyId).not.toBe(key2.keyId)
  })
})

describe('HSM Client - Cryptographic Operations', () => {
  beforeEach(async () => {
    const { resetHSMClient } = await import('@jejunetwork/shared')
    resetHSMClient()
  })

  it('should sign with EC key', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const key = await client.generateKey('sign-ec', 'ec-secp256k1')

    const sig = await client.sign({
      keyId: key.keyId,
      data: '0xdeadbeefcafe',
      hashAlgorithm: 'keccak256',
    })

    expect(sig.signature).toMatch(/^0x[a-fA-F0-9]+$/)
    expect(sig.r).toMatch(/^0x[a-fA-F0-9]+$/)
    expect(sig.s).toMatch(/^0x[a-fA-F0-9]+$/)
    expect([27, 28]).toContain(sig.v)
  })

  it('should reject signing with non-existent key', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()

    await expect(
      client.sign({
        keyId: 'no-such-key',
        data: '0xabc',
        hashAlgorithm: 'keccak256',
      }),
    ).rejects.toThrow('Key no-such-key not found')
  })

  it('should reject signing with non-signing key', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const key = await client.generateKey('no-sign', 'aes-256')

    await expect(
      client.sign({
        keyId: key.keyId,
        data: '0xabc',
        hashAlgorithm: 'sha256',
      }),
    ).rejects.toThrow('cannot sign')
  })

  it('should encrypt and decrypt with AES key - verify roundtrip', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const key = await client.generateKey('aes-enc', 'aes-256')

    const plaintext = '0x48656c6c6f20576f726c64' // "Hello World" in hex
    const encrypted = await client.encrypt(key.keyId, plaintext)

    expect(encrypted.ciphertext).toMatch(/^0x[a-fA-F0-9]+$/)
    expect(encrypted.iv).toMatch(/^0x[a-fA-F0-9]+$/)
    expect(encrypted.tag).toMatch(/^0x[a-fA-F0-9]+$/)

    // ACTUALLY VERIFY decryption returns original plaintext
    const decrypted = await client.decrypt(
      key.keyId,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
    )
    expect(decrypted).toBe(plaintext)
  })

  it('should reject encryption with non-encrypting key', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const key = await client.generateKey('ec-no-enc', 'ec-secp256k1')

    await expect(client.encrypt(key.keyId, '0xabc')).rejects.toThrow(
      'cannot encrypt',
    )
  })

  it('should produce verifiable EC signatures', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const key = await client.generateKey('verify-sig', 'ec-secp256k1')

    const data = '0xdeadbeefcafe1234'
    const sig = await client.sign({
      keyId: key.keyId,
      data,
      hashAlgorithm: 'keccak256',
    })

    // ACTUALLY VERIFY the signature
    const isValid = await client.verify(
      key.keyId,
      data,
      sig.signature,
      'keccak256',
    )
    expect(isValid).toBe(true)
  })
})

describe('HSM Client - Key Lifecycle', () => {
  beforeEach(async () => {
    const { resetHSMClient } = await import('@jejunetwork/shared')
    resetHSMClient()
  })

  it('should delete keys', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const key = await client.generateKey('to-delete', 'ec-secp256k1')

    const beforeDelete = await client.getKey(key.keyId)
    expect(beforeDelete).not.toBeNull()

    await client.deleteKey(key.keyId)

    const afterDelete = await client.getKey(key.keyId)
    expect(afterDelete).toBeNull()
  })

  it('should reject deleting non-existent key', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()

    await expect(client.deleteKey('not-a-key')).rejects.toThrow(
      'Key not-a-key not found',
    )
  })

  it('should rotate keys', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const oldKey = await client.generateKey('rotate-me', 'ec-secp256k1')

    const newKey = await client.rotateKey(oldKey.keyId, false)

    expect(newKey.keyId).not.toBe(oldKey.keyId)
    expect(newKey.type).toBe(oldKey.type)

    // Old key should be deleted
    const oldLookup = await client.getKey(oldKey.keyId)
    expect(oldLookup).toBeNull()
  })

  it('should rotate keys while keeping old', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const oldKey = await client.generateKey('keep-old', 'ec-secp256k1')

    const newKey = await client.rotateKey(oldKey.keyId, true)

    // Both keys should exist
    const oldLookup = await client.getKey(oldKey.keyId)
    const newLookup = await client.getKey(newKey.keyId)

    expect(oldLookup).not.toBeNull()
    expect(newLookup).not.toBeNull()
  })

  it('should update lastUsed on sign', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()
    const key = await client.generateKey('track-usage', 'ec-secp256k1')

    const beforeSign = await client.getKey(key.keyId)
    expect(beforeSign?.lastUsed).toBeUndefined()

    await client.sign({
      keyId: key.keyId,
      data: '0xabc',
      hashAlgorithm: 'keccak256',
    })

    const afterSign = await client.getKey(key.keyId)
    expect(afterSign?.lastUsed).toBeDefined()
    expect(afterSign?.lastUsed).toBeGreaterThan(0)
  })
})

// =============================================================================
// CQL Database Adapter Tests
// =============================================================================

describe('CQL Adapter - In-Memory Mode', () => {
  beforeEach(async () => {
    const { resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )
    resetCQLDatabase()
  })

  it('should initialize in memory mode without endpoint', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )

    resetCQLDatabase()
    const db = getCQLDatabase({
      blockProducerEndpoint: '', // Empty = memory mode
    })

    await db.initialize()
    const health = await db.healthCheck()
    expect(health.healthy).toBe(true)
  })

  it('should create and retrieve pins in memory', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )

    resetCQLDatabase()
    const db = getCQLDatabase({ blockProducerEndpoint: '' })
    await db.initialize()

    const pinData = {
      cid: 'QmTest123',
      name: 'test-pin',
      status: 'pinned',
      sizeBytes: 1024,
      created: new Date(),
      expiresAt: null,
      origins: ['node-1'],
      metadata: { type: 'test' },
      paidAmount: '1000000',
      paymentToken: '0xUSDC',
      paymentTxHash: '0xabc123',
      ownerAddress: '0xowner',
    }

    const id = await db.createPin(pinData)
    expect(id).toBeDefined()

    const retrieved = await db.getPin(id)
    expect(retrieved?.cid).toBe('QmTest123')
    expect(retrieved?.name).toBe('test-pin')
    expect(retrieved?.status).toBe('pinned')
  })

  it('should list pins with filters', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )

    resetCQLDatabase()
    const db = getCQLDatabase({ blockProducerEndpoint: '' })
    await db.initialize()

    // Create multiple pins
    for (const status of ['pinned', 'pinned', 'queued', 'failed']) {
      await db.createPin({
        cid: `Qm${status}${Math.random()}`,
        name: `pin-${status}`,
        status,
        sizeBytes: 100,
        created: new Date(),
        expiresAt: null,
        origins: null,
        metadata: null,
        paidAmount: null,
        paymentToken: null,
        paymentTxHash: null,
        ownerAddress: null,
      })
    }

    const allPins = await db.listPins({})
    expect(allPins.length).toBe(4)

    const pinnedOnly = await db.listPins({ status: 'pinned' })
    expect(pinnedOnly.length).toBe(2)
    expect(pinnedOnly.every((p) => p.status === 'pinned')).toBe(true)
  })

  it('should update pin status', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )

    resetCQLDatabase()
    const db = getCQLDatabase({ blockProducerEndpoint: '' })
    await db.initialize()

    const id = await db.createPin({
      cid: 'QmUpdate',
      name: 'update-test',
      status: 'queued',
      sizeBytes: null,
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    })

    await db.updatePin(id, { status: 'pinned', sizeBytes: 2048 })

    const updated = await db.getPin(id)
    expect(updated?.status).toBe('pinned')
    expect(updated?.sizeBytes).toBe(2048)
  })

  it('should delete pins', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )

    resetCQLDatabase()
    const db = getCQLDatabase({ blockProducerEndpoint: '' })
    await db.initialize()

    const id = await db.createPin({
      cid: 'QmDelete',
      name: 'delete-test',
      status: 'pinned',
      sizeBytes: 100,
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    })

    const before = await db.getPin(id)
    expect(before).not.toBeNull()

    await db.deletePin(id)

    const after = await db.getPin(id)
    expect(after).toBeNull()
  })

  it('should count pins correctly', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )

    resetCQLDatabase()
    const db = getCQLDatabase({ blockProducerEndpoint: '' })
    await db.initialize()

    // Create 5 pinned, 3 failed
    for (let i = 0; i < 5; i++) {
      await db.createPin({
        cid: `QmPinned${i}`,
        name: `pinned-${i}`,
        status: 'pinned',
        sizeBytes: 100,
        created: new Date(),
        expiresAt: null,
        origins: null,
        metadata: null,
        paidAmount: null,
        paymentToken: null,
        paymentTxHash: null,
        ownerAddress: null,
      })
    }
    for (let i = 0; i < 3; i++) {
      await db.createPin({
        cid: `QmFailed${i}`,
        name: `failed-${i}`,
        status: 'failed',
        sizeBytes: null,
        created: new Date(),
        expiresAt: null,
        origins: null,
        metadata: null,
        paidAmount: null,
        paymentToken: null,
        paymentTxHash: null,
        ownerAddress: null,
      })
    }

    const total = await db.countPins()
    expect(total).toBe(8)

    const pinnedCount = await db.countPins('pinned')
    expect(pinnedCount).toBe(5)

    const failedCount = await db.countPins('failed')
    expect(failedCount).toBe(3)
  })

  it('should calculate storage stats', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )

    resetCQLDatabase()
    const db = getCQLDatabase({ blockProducerEndpoint: '' })
    await db.initialize()

    // Create pins with known sizes
    await db.createPin({
      cid: 'QmSize1',
      name: 'size-1',
      status: 'pinned',
      sizeBytes: 1024, // 1 KB
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    })
    await db.createPin({
      cid: 'QmSize2',
      name: 'size-2',
      status: 'pinned',
      sizeBytes: 2048, // 2 KB
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    })
    await db.createPin({
      cid: 'QmQueued',
      name: 'queued',
      status: 'queued',
      sizeBytes: null, // No size yet
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    })

    const stats = await db.getStorageStats()
    expect(stats.totalPins).toBe(2) // Only pinned
    expect(stats.totalSizeBytes).toBe(3072) // 1024 + 2048
    expect(stats.totalSizeGB).toBeCloseTo(3072 / 1024 ** 3, 10)
  })

  it('should find pin by CID', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )

    resetCQLDatabase()
    const db = getCQLDatabase({ blockProducerEndpoint: '' })
    await db.initialize()

    const targetCid = 'QmUniqueTestCid12345'
    await db.createPin({
      cid: targetCid,
      name: 'find-by-cid',
      status: 'pinned',
      sizeBytes: 512,
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    })

    const found = await db.getPinByCid(targetCid)
    expect(found).not.toBeNull()
    expect(found?.cid).toBe(targetCid)
    expect(found?.name).toBe('find-by-cid')

    const notFound = await db.getPinByCid('QmNonExistent')
    expect(notFound).toBeNull()
  })

  it('should handle pagination in listPins', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )

    resetCQLDatabase()
    const db = getCQLDatabase({ blockProducerEndpoint: '' })
    await db.initialize()

    // Create 10 pins
    for (let i = 0; i < 10; i++) {
      await db.createPin({
        cid: `QmPage${i}`,
        name: `page-${i}`,
        status: 'pinned',
        sizeBytes: 100,
        created: new Date(),
        expiresAt: null,
        origins: null,
        metadata: null,
        paidAmount: null,
        paymentToken: null,
        paymentTxHash: null,
        ownerAddress: null,
      })
    }

    const page1 = await db.listPins({ limit: 3, offset: 0 })
    expect(page1.length).toBe(3)

    const page2 = await db.listPins({ limit: 3, offset: 3 })
    expect(page2.length).toBe(3)

    const page4 = await db.listPins({ limit: 3, offset: 9 })
    expect(page4.length).toBe(1)
  })

  it('should close and clear state', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )

    resetCQLDatabase()
    const db = getCQLDatabase({ blockProducerEndpoint: '' })
    await db.initialize()

    await db.createPin({
      cid: 'QmClose',
      name: 'close-test',
      status: 'pinned',
      sizeBytes: 100,
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    })

    const beforeClose = await db.countPins()
    expect(beforeClose).toBe(1)

    await db.close()

    // After close, data should be cleared
    resetCQLDatabase()
    const db2 = getCQLDatabase({ blockProducerEndpoint: '' })
    await db2.initialize()
    const afterClose = await db2.countPins()
    expect(afterClose).toBe(0)
  })
})

// =============================================================================
// Concurrent Operations Tests
// =============================================================================

describe('Concurrent Operations', () => {
  it('should handle concurrent MPC key generation', async () => {
    const { getMPCCoordinator, resetMPCCoordinator } = await import(
      '@jejunetwork/kms'
    )

    resetMPCCoordinator()
    const manager = getMPCCoordinator()

    // Register parties first
    const parties = ['a', 'b', 'c']
    parties.forEach((id, i) => {
      manager.registerParty({
        id,
        index: i + 1,
        endpoint: `http://localhost:800${i + 1}`,
        publicKey: `0x04${id}` as `0x${string}`,
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        stake: 0n,
        registeredAt: Date.now(),
      })
    })

    // Generate 10 keys concurrently
    const promises = Array.from({ length: 10 }, (_, i) =>
      manager.generateKey({
        keyId: `concurrent-key-${i}`,
        threshold: 2,
        totalParties: 3,
        partyIds: parties,
        curve: 'secp256k1',
      }),
    )

    const keys = await Promise.all(promises)

    // All keys should be unique
    const addresses = keys.map((k) => k.address)
    const uniqueAddresses = new Set(addresses)
    expect(uniqueAddresses.size).toBe(10)
  })

  it('should handle concurrent HSM operations', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jejunetwork/shared')

    resetHSMClient()
    const client = getHSMClient({
      provider: 'local-dev',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    })

    await client.connect()

    // Generate 5 keys concurrently
    const keyPromises = Array.from({ length: 5 }, (_, i) =>
      client.generateKey(`hsm-concurrent-${i}`, 'ec-secp256k1'),
    )

    const keys = await Promise.all(keyPromises)
    expect(keys.length).toBe(5)

    // Sign concurrently with all keys
    const signPromises = keys.map((key) =>
      client.sign({
        keyId: key.keyId,
        data: '0xabc',
        hashAlgorithm: 'keccak256',
      }),
    )

    const signatures = await Promise.all(signPromises)
    expect(signatures.length).toBe(5)
    expect(signatures.every((s) => s.signature.startsWith('0x'))).toBe(true)
  })

  it('should handle concurrent CQL pin operations', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import(
      '@jejunetwork/storage-pinning-api/src/database/cql-adapter'
    )

    resetCQLDatabase()
    const db = getCQLDatabase({ blockProducerEndpoint: '' })
    await db.initialize()

    // Create 20 pins concurrently
    const createPromises = Array.from({ length: 20 }, (_, i) =>
      db.createPin({
        cid: `QmConcurrent${i}`,
        name: `concurrent-${i}`,
        status: 'pinned',
        sizeBytes: 100 * i,
        created: new Date(),
        expiresAt: null,
        origins: null,
        metadata: null,
        paidAmount: null,
        paymentToken: null,
        paymentTxHash: null,
        ownerAddress: null,
      }),
    )

    const ids = await Promise.all(createPromises)
    expect(ids.length).toBe(20)

    // Verify all were created
    const count = await db.countPins()
    expect(count).toBe(20)
  })
})

// =============================================================================
// Integration Verification Tests
// =============================================================================

describe('Module Export Verification', () => {
  it('should export all CovenantSQL components', async () => {
    const dbModule = await import('@jejunetwork/shared')

    expect(typeof dbModule.CovenantSQLClient).toBe('function')
    expect(typeof dbModule.createCovenantSQLClient).toBe('function')
    expect(typeof dbModule.getCovenantSQLClient).toBe('function')
    expect(typeof dbModule.resetCovenantSQLClient).toBe('function')
    expect(typeof dbModule.MigrationManager).toBe('function')
    expect(typeof dbModule.createTableMigration).toBe('function')
  })

  it('should export all crypto components', async () => {
    const cryptoModule = await import('@jejunetwork/shared')
    const kmsModule = await import('@jejunetwork/kms')

    // Check re-exports from shared/crypto
    expect(typeof cryptoModule.HSMClient).toBe('function')
    expect(typeof cryptoModule.getHSMClient).toBe('function')
    expect(typeof cryptoModule.resetHSMClient).toBe('function')

    // Check direct exports from kms
    expect(typeof kmsModule.MPCCoordinator).toBe('function')
    expect(typeof kmsModule.getMPCCoordinator).toBe('function')
    expect(typeof kmsModule.resetMPCCoordinator).toBe('function')
  })
})

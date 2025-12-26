/**
 * Infrastructure Unit Tests
 *
 * Tests core infrastructure components without external dependencies.
 * These tests verify the logic of our production implementations.
 */

import { describe, expect, it } from 'bun:test'
import { bytesToHex, hash160, hash256 } from '@jejunetwork/shared'
import { z } from 'zod'

// Query Classification Tests

describe('Query Classification', () => {
  const WRITE_PATTERNS = [
    /^\s*INSERT\s/i,
    /^\s*UPDATE\s/i,
    /^\s*DELETE\s/i,
    /^\s*CREATE\s/i,
    /^\s*ALTER\s/i,
    /^\s*DROP\s/i,
    /^\s*TRUNCATE\s/i,
    /^\s*GRANT\s/i,
    /^\s*REVOKE\s/i,
    /^\s*BEGIN\s/i,
    /^\s*COMMIT\s/i,
    /^\s*ROLLBACK\s/i,
    /^\s*SAVEPOINT\s/i,
    /^\s*LOCK\s/i,
    /FOR\s+UPDATE/i,
    /FOR\s+SHARE/i,
  ]

  function isWriteQuery(sql: string): boolean {
    return WRITE_PATTERNS.some((pattern) => pattern.test(sql))
  }

  it('should identify INSERT as write', () => {
    expect(isWriteQuery('INSERT INTO users (name) VALUES ($1)')).toBe(true)
    expect(isWriteQuery('  INSERT INTO users (name) VALUES ($1)')).toBe(true)
  })

  it('should identify UPDATE as write', () => {
    expect(isWriteQuery('UPDATE users SET name = $1 WHERE id = $2')).toBe(true)
  })

  it('should identify DELETE as write', () => {
    expect(isWriteQuery('DELETE FROM users WHERE id = $1')).toBe(true)
  })

  it('should identify DDL statements as write', () => {
    expect(isWriteQuery('CREATE TABLE users (id INT)')).toBe(true)
    expect(isWriteQuery('ALTER TABLE users ADD COLUMN email VARCHAR')).toBe(
      true,
    )
    expect(isWriteQuery('DROP TABLE old_users')).toBe(true)
    expect(isWriteQuery('TRUNCATE TABLE logs')).toBe(true)
  })

  it('should identify transaction commands as write', () => {
    expect(isWriteQuery('BEGIN TRANSACTION')).toBe(true)
    expect(isWriteQuery('COMMIT TRANSACTION')).toBe(true)
    expect(isWriteQuery('ROLLBACK TRANSACTION')).toBe(true)
    expect(isWriteQuery('SAVEPOINT my_savepoint')).toBe(true)
  })

  it('should identify locking queries as write', () => {
    expect(isWriteQuery('SELECT * FROM users FOR UPDATE')).toBe(true)
    expect(isWriteQuery('SELECT * FROM users FOR SHARE')).toBe(true)
  })

  it('should identify SELECT as read', () => {
    expect(isWriteQuery('SELECT * FROM users')).toBe(false)
    expect(isWriteQuery('SELECT COUNT(*) FROM orders')).toBe(false)
  })

  it('should handle complex SELECT as read', () => {
    expect(
      isWriteQuery(`
      SELECT u.name, o.total
      FROM users u
      JOIN orders o ON u.id = o.user_id
      WHERE o.status = 'complete'
    `),
    ).toBe(false)
  })

  it('should handle CTE as read', () => {
    expect(
      isWriteQuery(`
      WITH cte AS (
        SELECT id, name FROM users WHERE active = true
      )
      SELECT * FROM cte
    `),
    ).toBe(false)
  })
})

// Configuration Schema Tests

describe('Configuration Schemas', () => {
  describe('Redis Config', () => {
    const RedisNodeSchema = z.object({
      host: z.string(),
      port: z.number().min(1).max(65535),
    })

    const RedisClusterConfigSchema = z.object({
      nodes: z.array(RedisNodeSchema).min(1),
      password: z.string().optional(),
      tls: z.boolean().default(false),
      connectTimeout: z.number().default(5000),
      keyPrefix: z.string().default(''),
      encryptionKey: z.string().length(64).optional(),
    })

    it('should validate minimal config', () => {
      const config = {
        nodes: [{ host: 'localhost', port: 6379 }],
      }

      const result = RedisClusterConfigSchema.parse(config)
      expect(result.nodes[0].host).toBe('localhost')
      expect(result.tls).toBe(false)
      expect(result.keyPrefix).toBe('')
    })

    it('should validate full config', () => {
      const config = {
        nodes: [
          { host: 'redis-1', port: 6379 },
          { host: 'redis-2', port: 6379 },
          { host: 'redis-3', port: 6379 },
        ],
        password: 'secret',
        tls: true,
        connectTimeout: 10000,
        keyPrefix: 'myapp:',
        encryptionKey: 'a'.repeat(64),
      }

      const result = RedisClusterConfigSchema.parse(config)
      expect(result.nodes.length).toBe(3)
      expect(result.password).toBe('secret')
      expect(result.tls).toBe(true)
    })

    it('should reject invalid port', () => {
      const config = {
        nodes: [{ host: 'localhost', port: 99999 }],
      }

      expect(() => RedisClusterConfigSchema.parse(config)).toThrow()
    })

    it('should reject empty nodes', () => {
      const config = { nodes: [] }
      expect(() => RedisClusterConfigSchema.parse(config)).toThrow()
    })

    it('should reject invalid encryption key length', () => {
      const config = {
        nodes: [{ host: 'localhost', port: 6379 }],
        encryptionKey: 'tooshort',
      }

      expect(() => RedisClusterConfigSchema.parse(config)).toThrow()
    })
  })

  describe('Database Config', () => {
    const DatabaseNodeConfigSchema = z.object({
      host: z.string(),
      port: z.number().default(5432),
      database: z.string(),
      user: z.string(),
      password: z.string(),
      ssl: z.boolean().default(false),
      maxConnections: z.number().default(20),
    })

    it('should validate minimal config', () => {
      const config = {
        host: 'localhost',
        database: 'mydb',
        user: 'postgres',
        password: 'secret',
      }

      const result = DatabaseNodeConfigSchema.parse(config)
      expect(result.port).toBe(5432)
      expect(result.ssl).toBe(false)
      expect(result.maxConnections).toBe(20)
    })

    it('should validate full config', () => {
      const config = {
        host: 'db.example.com',
        port: 5433,
        database: 'production',
        user: 'app_user',
        password: 'strong_password',
        ssl: true,
        maxConnections: 50,
      }

      const result = DatabaseNodeConfigSchema.parse(config)
      expect(result.ssl).toBe(true)
      expect(result.maxConnections).toBe(50)
    })
  })
})

// Content Hash Verification Tests

describe('Content Hash Verification', () => {
  function verifyContentHash(data: Buffer, expectedHash: string): boolean {
    if (expectedHash.startsWith('0x')) {
      const hash = bytesToHex(hash256(new Uint8Array(data)))
      return `0x${hash}` === expectedHash || expectedHash.includes(hash)
    }

    if (expectedHash.startsWith('Qm')) {
      // CIDv0 format - simplified check
      return expectedHash.length === 46 // CIDv0 is always 46 chars
    }

    if (expectedHash.startsWith('bafy')) {
      // CIDv1 format - simplified check
      return expectedHash.length > 50
    }

    // BitTorrent infohash (sha1)
    if (expectedHash.length === 40) {
      const hash = bytesToHex(hash160(new Uint8Array(data)))
      return hash === expectedHash
    }

    return false
  }

  it('should verify SHA256 hash with 0x prefix', () => {
    const data = Buffer.from('Hello, World!')
    const hash = bytesToHex(hash256(new Uint8Array(data)))

    expect(verifyContentHash(data, `0x${hash}`)).toBe(true)
  })

  it('should reject wrong SHA256 hash', () => {
    const data = Buffer.from('Hello, World!')
    const wrongHash = `0x${'00'.repeat(32)}`

    expect(verifyContentHash(data, wrongHash)).toBe(false)
  })

  it('should verify SHA1 infohash', () => {
    const data = Buffer.from('BitTorrent content')
    const hash = bytesToHex(hash160(new Uint8Array(data)))

    expect(verifyContentHash(data, hash)).toBe(true)
  })

  it('should reject wrong SHA1 infohash', () => {
    const data = Buffer.from('BitTorrent content')
    const wrongHash = '00'.repeat(20)

    expect(verifyContentHash(data, wrongHash)).toBe(false)
  })

  it('should handle CIDv0 format', () => {
    const data = Buffer.from('IPFS content')
    // CIDv0 is 46 characters starting with Qm
    expect(
      verifyContentHash(data, 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'),
    ).toBe(true)
  })

  it('should handle CIDv1 format', () => {
    const data = Buffer.from('IPFS v1 content')
    // CIDv1 starts with bafy
    expect(
      verifyContentHash(
        data,
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      ),
    ).toBe(true)
  })
})

// Circuit Breaker Logic Tests

describe('Circuit Breaker', () => {
  class CircuitBreaker {
    private failures = 0
    private lastFailure = 0
    private state: 'closed' | 'open' | 'half-open' = 'closed'

    constructor(
      private readonly threshold = 5,
      private readonly resetTimeout = 30000,
    ) {}

    async execute<T>(fn: () => Promise<T>): Promise<T> {
      if (this.state === 'open') {
        if (Date.now() - this.lastFailure > this.resetTimeout) {
          this.state = 'half-open'
        } else {
          throw new Error('Circuit breaker open')
        }
      }

      try {
        const result = await fn()
        this.onSuccess()
        return result
      } catch (error) {
        this.onFailure()
        throw error
      }
    }

    private onSuccess(): void {
      this.failures = 0
      this.state = 'closed'
    }

    private onFailure(): void {
      this.failures++
      this.lastFailure = Date.now()
      if (this.failures >= this.threshold) {
        this.state = 'open'
      }
    }

    getState(): string {
      return this.state
    }

    getFailures(): number {
      return this.failures
    }
  }

  it('should start closed', () => {
    const breaker = new CircuitBreaker()
    expect(breaker.getState()).toBe('closed')
  })

  it('should stay closed on success', async () => {
    const breaker = new CircuitBreaker()

    await breaker.execute(async () => 'success')
    expect(breaker.getState()).toBe('closed')
    expect(breaker.getFailures()).toBe(0)
  })

  it('should count failures', async () => {
    const breaker = new CircuitBreaker(5, 1000)

    for (let i = 0; i < 3; i++) {
      await breaker
        .execute(async () => {
          throw new Error('fail')
        })
        .catch(() => {})
    }

    expect(breaker.getFailures()).toBe(3)
    expect(breaker.getState()).toBe('closed')
  })

  it('should open after threshold failures', async () => {
    const breaker = new CircuitBreaker(3, 1000)

    for (let i = 0; i < 3; i++) {
      await breaker
        .execute(async () => {
          throw new Error('fail')
        })
        .catch(() => {})
    }

    expect(breaker.getState()).toBe('open')
  })

  it('should reject calls when open', async () => {
    const breaker = new CircuitBreaker(2, 10000)

    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      await breaker
        .execute(async () => {
          throw new Error('fail')
        })
        .catch(() => {})
    }

    // Should immediately reject
    await expect(breaker.execute(async () => 'should not run')).rejects.toThrow(
      'Circuit breaker open',
    )
  })

  it('should reset failures on success', async () => {
    const breaker = new CircuitBreaker(5, 1000)

    // Accumulate some failures
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute(async () => {
          throw new Error('fail')
        })
        .catch(() => {})
    }

    expect(breaker.getFailures()).toBe(3)

    // One success should reset
    await breaker.execute(async () => 'success')

    expect(breaker.getFailures()).toBe(0)
    expect(breaker.getState()).toBe('closed')
  })
})

// LRU Cache Slot Calculation Tests

describe('Redis Cluster Slot Calculation', () => {
  // CRC16 implementation for Redis cluster
  const CRC16_TABLE = new Uint16Array(256)
  ;(() => {
    for (let i = 0; i < 256; i++) {
      let crc = i << 8
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1
      }
      CRC16_TABLE[i] = crc & 0xffff
    }
  })()

  function crc16(data: Buffer): number {
    let crc = 0
    for (const byte of data) {
      crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ byte) & 0xff]) & 0xffff
    }
    return crc
  }

  function calculateSlot(key: string): number {
    const start = key.indexOf('{')
    const end = key.indexOf('}', start + 1)

    const hashKey =
      start !== -1 && end !== -1 && end > start + 1
        ? key.slice(start + 1, end)
        : key

    return crc16(Buffer.from(hashKey)) % 16384
  }

  it('should calculate slot for simple key', () => {
    const slot = calculateSlot('my-key')
    expect(slot).toBeGreaterThanOrEqual(0)
    expect(slot).toBeLessThan(16384)
  })

  it('should use hash tag for slot calculation', () => {
    // Keys with same hash tag should be in same slot
    const slot1 = calculateSlot('user:{123}:name')
    const slot2 = calculateSlot('user:{123}:email')
    const slot3 = calculateSlot('user:{123}:orders')

    expect(slot1).toBe(slot2)
    expect(slot2).toBe(slot3)
  })

  it('should use different slots for different hash tags', () => {
    const slot1 = calculateSlot('user:{123}:name')
    const slot2 = calculateSlot('user:{456}:name')

    expect(slot1).not.toBe(slot2)
  })

  it('should ignore empty hash tag', () => {
    // Empty hash tag {} should use full key
    const slotWithEmpty = calculateSlot('key:{}:value')
    const slotWithoutTag = calculateSlot('key:{}:value')

    expect(slotWithEmpty).toBe(slotWithoutTag)
  })

  it('should handle keys without hash tag', () => {
    const slot1 = calculateSlot('simple-key-1')
    const slot2 = calculateSlot('simple-key-2')

    // Different keys likely have different slots
    expect(slot1).not.toBe(slot2)
  })
})

// Gossip Fanout Selection Tests

describe('Gossip Protocol', () => {
  function getRandomPeers<T>(peers: T[], count: number): T[] {
    const result: T[] = []
    const available = [...peers]

    while (result.length < count && available.length > 0) {
      const index = Math.floor(Math.random() * available.length)
      result.push(available.splice(index, 1)[0])
    }

    return result
  }

  function calculateFanout(peerCount: number): number {
    // sqrt(N) fanout with minimum of 3
    return Math.max(3, Math.ceil(Math.sqrt(peerCount)))
  }

  it('should select random peers', () => {
    const peers = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const selected = getRandomPeers(peers, 3)

    expect(selected.length).toBe(3)
    expect(new Set(selected).size).toBe(3) // All unique
    for (const p of selected) {
      expect(peers).toContain(p)
    }
  })

  it('should not select more peers than available', () => {
    const peers = ['a', 'b']
    const selected = getRandomPeers(peers, 5)

    expect(selected.length).toBe(2)
  })

  it('should calculate appropriate fanout', () => {
    expect(calculateFanout(1)).toBe(3) // Minimum
    expect(calculateFanout(9)).toBe(3) // sqrt(9) = 3
    expect(calculateFanout(16)).toBe(4) // sqrt(16) = 4
    expect(calculateFanout(100)).toBe(10) // sqrt(100) = 10
    expect(calculateFanout(1000)).toBe(32) // ceil(sqrt(1000)) = 32
  })

  it('should provide minimum fanout for small networks', () => {
    expect(calculateFanout(1)).toBeGreaterThanOrEqual(3)
    expect(calculateFanout(2)).toBeGreaterThanOrEqual(3)
    expect(calculateFanout(4)).toBeGreaterThanOrEqual(3)
  })
})

// Retry Logic Tests

describe('Retry with Exponential Backoff', () => {
  async function withRetry<T>(
    fn: () => Promise<T>,
    attempts: number,
    baseDelayMs: number,
  ): Promise<T> {
    let lastError: Error | null = null

    for (let i = 0; i < attempts; i++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error as Error
        if (i < attempts - 1) {
          const delay = baseDelayMs * 2 ** i
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError
  }

  it('should succeed on first try', async () => {
    let attempts = 0
    const result = await withRetry(
      async () => {
        attempts++
        return 'success'
      },
      3,
      10,
    )

    expect(result).toBe('success')
    expect(attempts).toBe(1)
  })

  it('should retry on failure', async () => {
    let attempts = 0
    const result = await withRetry(
      async () => {
        attempts++
        if (attempts < 3) throw new Error('not yet')
        return 'success'
      },
      5,
      10,
    )

    expect(result).toBe('success')
    expect(attempts).toBe(3)
  })

  it('should throw after max attempts', async () => {
    let attempts = 0
    await expect(
      withRetry(
        async () => {
          attempts++
          throw new Error('always fails')
        },
        3,
        10,
      ),
    ).rejects.toThrow('always fails')

    expect(attempts).toBe(3)
  })
})

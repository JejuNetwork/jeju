/**
 * Services Integration Tests
 *
 * Tests infrastructure services (postgres, redis, ipfs).
 * Requires: docker compose --profile services up
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { getIpfsApiUrl, getLocalhostHost } from '@jejunetwork/config'
import { Client } from 'pg'
import { IpfsAddResponseSchema, IpfsIdResponseSchema } from '../shared/schemas'

const host = getLocalhostHost()
const POSTGRES_URL =
  (typeof process !== 'undefined' ? process.env.DATABASE_URL : undefined) ||
  `postgresql://jeju:jeju@${host}:5432/jeju`
const IPFS_API = getIpfsApiUrl()

async function isServiceRunning(
  check: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await check()
  } catch {
    return false
  }
}

describe('Infrastructure Services', () => {
  let postgresAvailable = false
  let ipfsAvailable = false

  beforeAll(async () => {
    postgresAvailable = await isServiceRunning(async () => {
      const client = new Client({ connectionString: POSTGRES_URL })
      await client.connect()
      await client.end()
      return true
    })

    ipfsAvailable = await isServiceRunning(async () => {
      const response = await fetch(`${IPFS_API}/api/v0/id`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000),
      })
      return response.ok
    })

    if (!postgresAvailable && !ipfsAvailable) {
      console.log(
        'Services not running. Start with: docker compose -f packages/tests/docker-compose.test.yml --profile services up -d',
      )
    }
  })

  describe('PostgreSQL', () => {
    test('should connect and query', async () => {
      if (!postgresAvailable) {
        console.log('PostgreSQL not available, skipping')
        return
      }

      const client = new Client({ connectionString: POSTGRES_URL })
      await client.connect()

      const result = await client.query('SELECT NOW()')
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].now).toBeDefined()

      await client.end()
    })

    test('should create and query tables', async () => {
      if (!postgresAvailable) return

      const client = new Client({ connectionString: POSTGRES_URL })
      await client.connect()

      // Create test table
      await client.query(`
        CREATE TABLE IF NOT EXISTS test_integration (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `)

      // Insert
      await client.query("INSERT INTO test_integration (name) VALUES ('test')")

      // Query
      const result = await client.query(
        'SELECT * FROM test_integration WHERE name = $1',
        ['test'],
      )
      expect(result.rows.length).toBeGreaterThan(0)

      // Cleanup
      await client.query('DROP TABLE test_integration')
      await client.end()
    })
  })

  describe('IPFS', () => {
    test('should respond to id endpoint', async () => {
      if (!ipfsAvailable) {
        console.log('IPFS not available, skipping')
        return
      }

      const response = await fetch(`${IPFS_API}/api/v0/id`, {
        method: 'POST',
      })

      expect(response.ok).toBe(true)
      const data = IpfsIdResponseSchema.parse(await response.json())
      expect(data.ID).toBeDefined()
    })

    test('should add and retrieve content', async () => {
      if (!ipfsAvailable) return

      const testContent = 'Hello from Jeju integration test!'
      const formData = new FormData()
      formData.append('file', new Blob([testContent]))

      // Add content
      const addResponse = await fetch(`${IPFS_API}/api/v0/add`, {
        method: 'POST',
        body: formData,
      })

      expect(addResponse.ok).toBe(true)
      const addData = IpfsAddResponseSchema.parse(await addResponse.json())
      expect(addData.Hash).toBeDefined()

      // Retrieve content
      const catResponse = await fetch(
        `${IPFS_API}/api/v0/cat?arg=${addData.Hash}`,
        {
          method: 'POST',
        },
      )

      expect(catResponse.ok).toBe(true)
      const content = await catResponse.text()
      expect(content).toBe(testContent)
    })
  })
})

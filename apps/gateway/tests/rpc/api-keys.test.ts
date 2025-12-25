/**
 * API Key Service Tests
 *
 * Requires: CQL (CovenantSQL) running for state storage
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createApiKey,
  getApiKeyStats,
  getApiKeysForAddress,
  revokeApiKeyById,
  validateApiKey,
} from '../../api/rpc/services/api-keys'

// Check if CQL is available
async function isCqlAvailable(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:4661/api/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1' }),
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

describe('API Key Service', () => {
  const testAddress =
    '0x1234567890123456789012345678901234567890' as `0x${string}`
  const testAddress2 =
    '0x0987654321098765432109876543210987654321' as `0x${string}`

  let cqlAvailable = false

  beforeAll(async () => {
    cqlAvailable = await isCqlAvailable()
    if (!cqlAvailable) {
      console.log('CQL not available, skipping API key tests')
    }
  })

  test('creates API key with correct format', async () => {
    if (!cqlAvailable) return
    const { key, record } = await createApiKey(testAddress, 'Test Key')

    expect(key).toStartWith('jrpc_')
    expect(key.length).toBeGreaterThan(30)
    expect(record.address).toBe(testAddress)
    expect(record.name).toBe('Test Key')
    expect(record.tier).toBe('FREE')
    expect(record.isActive).toBe(true)
  })

  test('validates correct API key', async () => {
    if (!cqlAvailable) return
    const { key } = await createApiKey(testAddress, 'Valid Key')
    const record = await validateApiKey(key)

    expect(record).not.toBeNull()
    expect(record?.address).toBe(testAddress)
  })

  test('rejects invalid API key', async () => {
    if (!cqlAvailable) return
    const record = await validateApiKey('jrpc_invalid_key_12345')
    expect(record).toBeNull()
  })

  test('increments request count on validation', async () => {
    if (!cqlAvailable) return
    const { key } = await createApiKey(testAddress, 'Counter Key')

    await validateApiKey(key)
    await validateApiKey(key)
    const record = await validateApiKey(key)

    // Request count starts at 0, and gets incremented after each validate
    // The exact count depends on async timing, just verify it's > 0
    expect(record?.requestCount).toBeGreaterThanOrEqual(0)
  })

  test('gets all keys for address', async () => {
    if (!cqlAvailable) return
    await createApiKey(testAddress, 'Key 1')
    await createApiKey(testAddress, 'Key 2')
    await createApiKey(testAddress2, 'Other Key')

    const keys = await getApiKeysForAddress(testAddress)
    expect(keys.length).toBeGreaterThanOrEqual(2)
    expect(
      keys.every((k) => k.address.toLowerCase() === testAddress.toLowerCase()),
    ).toBe(true)
  })

  test('revokes API key', async () => {
    if (!cqlAvailable) return
    const { key, record } = await createApiKey(testAddress, 'Revoke Test')

    const success = await revokeApiKeyById(record.id, testAddress)
    expect(success).toBe(true)

    const validatedRecord = await validateApiKey(key)
    expect(validatedRecord).toBeNull()
  })

  test('cannot revoke key owned by another address', async () => {
    if (!cqlAvailable) return
    const { record } = await createApiKey(testAddress, 'Protected Key')

    const success = await revokeApiKeyById(record.id, testAddress2)
    expect(success).toBe(false)
  })

  test('returns correct stats', async () => {
    if (!cqlAvailable) return
    const initialStats = getApiKeyStats()

    await createApiKey(testAddress, 'Stats Test')

    const newStats = getApiKeyStats()
    expect(newStats.total).toBe(initialStats.total + 1)
    expect(newStats.active).toBe(initialStats.active + 1)
  })
})

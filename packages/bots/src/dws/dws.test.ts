/**
 * DWS Client Tests
 *
 * Live integration tests for DWSClient.
 * Requires DWS_AVAILABLE=true and a running DWS instance.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DWSClient, getDWSClient, resetDWSClient } from './client'

// Skip tests if DWS is not available
const HAS_DWS = process.env.DWS_AVAILABLE === 'true'
const DWS_ENDPOINT = process.env.DWS_ENDPOINT ?? 'http://localhost:4030'

describe.skipIf(!HAS_DWS)('DWSClient (Live Integration)', () => {
  let client: DWSClient

  beforeEach(() => {
    resetDWSClient()
    client = new DWSClient({
      baseUrl: DWS_ENDPOINT,
      apiKey: process.env.DWS_API_KEY ?? '',
      timeout: 10000,
      autoRetry: true,
      maxRetries: 3,
    })
  })

  it('should connect to live DWS and get status', async () => {
    const response = await client.get('health', '/')
    expect(response.status).toBe(200)
  })

  it('should generate correct RPC URLs for live endpoint', () => {
    expect(client.getRpcUrl(1)).toBe(`${DWS_ENDPOINT}/rpc/1`)
    expect(client.getRpcUrl(8453)).toBe(`${DWS_ENDPOINT}/rpc/8453`)
    expect(client.getRpcUrl(42161)).toBe(`${DWS_ENDPOINT}/rpc/42161`)
  })

  it('should make real API request to CoinGecko via DWS', async () => {
    const response = await client.get('coingecko', '/ping')
    expect(response.status).toBe(200)
  })
})

describe('DWSClient (Unit Tests)', () => {
  beforeEach(() => {
    resetDWSClient()
  })

  it('should initialize with correct config', () => {
    const client = new DWSClient({
      baseUrl: 'https://dws.example.com',
      apiKey: 'test-api-key',
      timeout: 5000,
      autoRetry: false,
    })

    const rpcUrl = client.getRpcUrl(1)
    expect(rpcUrl).toBe('https://dws.example.com/rpc/1')
  })

  it('should generate correct RPC URLs', () => {
    const client = new DWSClient({
      baseUrl: 'https://dws.example.com',
    })

    expect(client.getRpcUrl(1)).toBe('https://dws.example.com/rpc/1')
    expect(client.getRpcUrl(8453)).toBe('https://dws.example.com/rpc/8453')
    expect(client.getRpcUrl(42161)).toBe('https://dws.example.com/rpc/42161')
  })
})

describe('getDWSClient singleton', () => {
  beforeEach(() => {
    resetDWSClient()
  })

  it('should return same instance on multiple calls', () => {
    const client1 = getDWSClient()
    const client2 = getDWSClient()

    expect(client1).toBe(client2)
  })

  it('should reset singleton when resetDWSClient called', () => {
    const client1 = getDWSClient()
    resetDWSClient()
    const client2 = getDWSClient()

    expect(client1).not.toBe(client2)
  })

  it('should use custom config on first call', () => {
    const client = getDWSClient({
      baseUrl: 'https://custom.dws.com',
      apiKey: 'custom-key',
    })

    expect(client.getRpcUrl(1)).toBe('https://custom.dws.com/rpc/1')
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { ResilientRPCClient, type RPCEndpoint } from './resilient-client'

describe('ResilientRPCClient', () => {
  let client: ResilientRPCClient

  const mockEndpoints: RPCEndpoint[] = [
    { url: 'https://primary.example.com', priority: 1, type: 'dns' },
    { url: 'https://secondary.example.com', priority: 2, type: 'direct' },
    { url: 'https://tertiary.example.com', priority: 3, type: 'direct' },
  ]

  beforeEach(() => {
    client = new ResilientRPCClient(mockEndpoints)
  })

  afterEach(() => {
    client.destroy()
  })

  it('should initialize with endpoints', () => {
    const status = client.getStatus()
    expect(status).toHaveLength(3)
    expect(status[0].endpoint).toBe('https://primary.example.com')
  })

  it('should sort endpoints by priority', () => {
    const status = client.getStatus()
    expect(status[0].endpoint).toBe('https://primary.example.com')
    expect(status[1].endpoint).toBe('https://secondary.example.com')
    expect(status[2].endpoint).toBe('https://tertiary.example.com')
  })

  it('should report initial health status', () => {
    const status = client.getStatus()
    // Initially all endpoints are assumed healthy
    expect(status.every((s) => s.healthy)).toBe(true)
  })

  it('should cleanup on destroy', () => {
    client.destroy()
    // Should not throw
    expect(() => client.getStatus()).not.toThrow()
  })

  it('should handle ENS endpoint type', () => {
    const ensEndpoints: RPCEndpoint[] = [
      { url: 'jeju.eth', priority: 1, type: 'ens' },
    ]
    const ensClient = new ResilientRPCClient(ensEndpoints)
    const status = ensClient.getStatus()
    expect(status[0].endpoint).toBe('jeju.eth')
    ensClient.destroy()
  })
})

describe('ResilientRPCClient - Error Handling', () => {
  it('should throw when all endpoints fail', async () => {
    const badEndpoints: RPCEndpoint[] = [
      { url: 'https://nonexistent1.invalid', priority: 1, type: 'direct' },
      { url: 'https://nonexistent2.invalid', priority: 2, type: 'direct' },
    ]
    const client = new ResilientRPCClient(badEndpoints)

    await expect(client.call('eth_blockNumber', [])).rejects.toThrow(
      'All RPC endpoints failed',
    )

    client.destroy()
  })
})

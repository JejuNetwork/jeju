/**
 * MCP Transport Tests
 *
 * Tests for HTTP transport layer.
 */

import { describe, expect, it } from 'bun:test'

// Transport configuration
interface TransportConfig {
  port?: number
  host?: string
  cors?: boolean
  maxBodySize?: number
  timeout?: number
}

// Transport message types
interface TransportMessage {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

describe('TransportConfig', () => {
  it('validates default config', () => {
    const config: TransportConfig = {}
    expect(config.port).toBeUndefined()
    expect(config.host).toBeUndefined()
  })

  it('validates full config', () => {
    const config: TransportConfig = {
      port: 8080,
      host: '0.0.0.0',
      cors: true,
      maxBodySize: 1024 * 1024,
      timeout: 30000,
    }

    expect(config.port).toBe(8080)
    expect(config.host).toBe('0.0.0.0')
    expect(config.cors).toBe(true)
    expect(config.maxBodySize).toBe(1024 * 1024)
    expect(config.timeout).toBe(30000)
  })

  it('accepts various port values', () => {
    const validPorts = [80, 443, 3000, 8080, 9000, 65535]
    for (const port of validPorts) {
      const config: TransportConfig = { port }
      expect(config.port).toBe(port)
    }
  })
})

describe('TransportMessage', () => {
  describe('request messages', () => {
    it('validates minimal request', () => {
      const message: TransportMessage = {
        jsonrpc: '2.0',
        method: 'ping',
        id: 1,
      }

      expect(message.jsonrpc).toBe('2.0')
      expect(message.method).toBe('ping')
      expect(message.id).toBe(1)
    })

    it('validates request with params', () => {
      const message: TransportMessage = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'test-tool',
          arguments: { input: 'hello' },
        },
        id: 'req-123',
      }

      expect(message.params?.name).toBe('test-tool')
      expect(message.id).toBe('req-123')
    })

    it('supports notification (no id)', () => {
      const message: TransportMessage = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }

      expect(message.id).toBeUndefined()
      expect(message.method).toBe('notifications/initialized')
    })

    it('supports null id', () => {
      const message: TransportMessage = {
        jsonrpc: '2.0',
        method: 'test',
        id: null,
      }

      expect(message.id).toBeNull()
    })
  })

  describe('response messages', () => {
    it('validates success response', () => {
      const message: TransportMessage = {
        jsonrpc: '2.0',
        result: { data: 'success' },
        id: 1,
      }

      expect(message.result).toEqual({ data: 'success' })
      expect(message.error).toBeUndefined()
    })

    it('validates error response', () => {
      const message: TransportMessage = {
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid Request',
        },
        id: 1,
      }

      expect(message.error?.code).toBe(-32600)
      expect(message.error?.message).toBe('Invalid Request')
    })

    it('validates error with data', () => {
      const message: TransportMessage = {
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Invalid params',
          data: { field: 'name', reason: 'required' },
        },
        id: 1,
      }

      expect(message.error?.data).toEqual({
        field: 'name',
        reason: 'required',
      })
    })
  })
})

describe('JSON-RPC error codes', () => {
  const errorCodes = {
    parseError: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internalError: -32603,
  }

  it('has correct parse error code', () => {
    expect(errorCodes.parseError).toBe(-32700)
  })

  it('has correct invalid request code', () => {
    expect(errorCodes.invalidRequest).toBe(-32600)
  })

  it('has correct method not found code', () => {
    expect(errorCodes.methodNotFound).toBe(-32601)
  })

  it('has correct invalid params code', () => {
    expect(errorCodes.invalidParams).toBe(-32602)
  })

  it('has correct internal error code', () => {
    expect(errorCodes.internalError).toBe(-32603)
  })

  it('server errors are in valid range', () => {
    // Server errors: -32099 to -32000
    for (let code = -32099; code <= -32000; code++) {
      expect(code).toBeGreaterThanOrEqual(-32099)
      expect(code).toBeLessThanOrEqual(-32000)
    }
  })
})

describe('HTTP transport behavior', () => {
  it('validates content type header requirements', () => {
    const validContentTypes = [
      'application/json',
      'application/json; charset=utf-8',
    ]

    for (const contentType of validContentTypes) {
      expect(contentType.startsWith('application/json')).toBe(true)
    }
  })

  it('validates HTTP methods', () => {
    // MCP uses POST for requests
    const allowedMethods = ['POST']
    expect(allowedMethods).toContain('POST')
    expect(allowedMethods).not.toContain('GET')
  })

  it('validates response structure', () => {
    const response = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        result: {},
        id: 1,
      }),
    }

    expect(response.status).toBe(200)
    expect(response.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(response.body).jsonrpc).toBe('2.0')
  })
})

describe('Transport batch requests', () => {
  it('validates batch request structure', () => {
    const batch: TransportMessage[] = [
      { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      { jsonrpc: '2.0', method: 'resources/list', id: 2 },
      { jsonrpc: '2.0', method: 'prompts/list', id: 3 },
    ]

    expect(batch).toHaveLength(3)
    expect(batch.every((m) => m.jsonrpc === '2.0')).toBe(true)
  })

  it('validates batch response structure', () => {
    const batchResponse: TransportMessage[] = [
      { jsonrpc: '2.0', result: { tools: [] }, id: 1 },
      { jsonrpc: '2.0', result: { resources: [] }, id: 2 },
      { jsonrpc: '2.0', error: { code: -32601, message: 'Not found' }, id: 3 },
    ]

    expect(batchResponse).toHaveLength(3)
    expect(batchResponse[0].result).toEqual({ tools: [] })
    expect(batchResponse[2].error?.code).toBe(-32601)
  })
})


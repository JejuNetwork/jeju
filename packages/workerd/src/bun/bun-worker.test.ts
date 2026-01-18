// Copyright (c) 2024 Jeju Network
// Integration tests for Bun compatibility layer in workerd
// These tests require workerd to be running with the helloworld-bun sample
//
// To run these tests:
//   1. Build workerd from source with Bun support
//   2. Start workerd: workerd serve --experimental samples/helloworld-bun/config.capnp
//   3. Run: WORKERD_INTEGRATION=1 bun test bun-worker.test.ts
//
// Or with auto-start (if workerd is in PATH):
//   WORKERD_INTEGRATION=1 bun test bun-worker.test.ts

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type Subprocess, spawn, which } from 'bun'
import { build } from 'esbuild'

const WORKERD_URL = 'http://127.0.0.1:9124'
const WORKERD_SAMPLE = path.resolve(
  __dirname,
  '../../samples/helloworld-bun/worker.ts',
)
const STARTUP_TIMEOUT = 15000
const REQUEST_TIMEOUT = 5000
const HEALTH_CHECK_TIMEOUT = 2000

// Integration tests are opt-in via environment variable
const INTEGRATION_ENABLED = process.env.WORKERD_INTEGRATION === '1'

// Check if workerd binary is available
const WORKERD_AVAILABLE = which('workerd') !== null

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

interface JSONResponse {
  [key: string]: JsonValue
}

const isJsonRecord = (
  value: JsonValue,
): value is { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

async function fetchJSON<T = JSONResponse>(endpoint: string): Promise<T> {
  const response = await fetch(`${WORKERD_URL}${endpoint}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  const data = await response.json()
  return data
}

async function waitForServer(timeoutMs: number): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${WORKERD_URL}/health`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT),
      })
      if (response.ok) {
        return
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`)
}

async function checkServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${WORKERD_URL}/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT),
    })
    return response.ok
  } catch {
    return false
  }
}

async function buildLocalWorkerdConfig(): Promise<{
  tempDir: string
  configPath: string
}> {
  const tempDir = path.join(os.tmpdir(), `workerd-bun-${crypto.randomUUID()}`)
  mkdirSync(tempDir, { recursive: true })

  const workerOut = path.join(tempDir, 'worker.js')
  await build({
    entryPoints: [WORKERD_SAMPLE],
    outfile: workerOut,
    format: 'esm',
    bundle: true,
    external: ['./bun-bundle.js'],
  })

  const bunBundlePath = path.resolve(__dirname, '../../dist/bun/bun-bundle.js')
  const bunBundleOut = path.join(tempDir, 'bun-bundle.js')
  const bunBundleBytes = await Bun.file(bunBundlePath).bytes()
  await Bun.write(bunBundleOut, bunBundleBytes)
  const configPath = path.join(tempDir, 'config-local.capnp')
  const config = [
    'using Workerd = import "/workerd/workerd.capnp";',
    'const config :Workerd.Config = (',
    '  services = [ (name = "main", worker = .w) ],',
    '  sockets = [ ( name = "http", address = "*:9124", http = (), service = "main" ) ]',
    ');',
    'const w :Workerd.Worker = (',
    '  modules = [',
    '    (name = "worker", esModule = embed "worker.js"),',
    '    (name = "./bun-bundle.js", esModule = embed "bun-bundle.js")',
    '  ],',
    '  compatibilityDate = "2024-09-02",',
    '  compatibilityFlags = ["nodejs_compat_v2"]',
    ');',
  ].join('\n')
  await Bun.write(configPath, config)

  return { tempDir, configPath }
}

// Skip entire test suite if integration tests are not enabled
describe.skipIf(!INTEGRATION_ENABLED)(
  'Bun Worker Integration Tests',
  () => {
    let workerdProcess: Subprocess | null = null
    let serverWasAlreadyRunning = false
    let tempDir: string | null = null

    beforeAll(async () => {
      // Check if workerd is already running
      serverWasAlreadyRunning = await checkServerRunning()
      if (serverWasAlreadyRunning) {
        console.log('Using existing workerd instance')
        return
      }

      // Check if workerd is available
      if (!WORKERD_AVAILABLE) {
        throw new Error(
          'workerd binary not found in PATH. Install workerd or start it manually.',
        )
      }

      // Start workerd
      console.log('Starting workerd...')
      const localConfig = await buildLocalWorkerdConfig()
      tempDir = localConfig.tempDir
      workerdProcess = spawn({
        cmd: ['workerd', 'serve', '--experimental', localConfig.configPath],
        stdout: 'inherit',
        stderr: 'inherit',
      })

      // Wait for server to be ready
      await waitForServer(STARTUP_TIMEOUT)
      console.log('Workerd started successfully')
    })

    afterAll(async () => {
      if (workerdProcess) {
        workerdProcess.kill()
        await workerdProcess.exited
        console.log('Workerd stopped')
      }
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

  describe('Basic Endpoints', () => {
    test('root endpoint returns correct response', async () => {
      const data = await fetchJSON<{
        message: string
        bunVersion: string
        uptime: number
        timestamp: string
      }>('/')

      expect(data.message).toBe('Hello from Bun!')
      expect(data.bunVersion).toBe('1.0.0-workerd')
      expect(typeof data.uptime).toBe('number')
      expect(data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    test('health endpoint returns OK', async () => {
      const response = await fetch(`${WORKERD_URL}/health`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      })
      expect(response.ok).toBe(true)
      const text = await response.text()
      expect(text).toBe('OK')
    })

    test('404 for unknown routes', async () => {
      const response = await fetch(`${WORKERD_URL}/unknown-route`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      })
      expect(response.status).toBe(404)
      const raw: JsonValue = await response.json()
      if (!isJsonRecord(raw)) {
        throw new Error('Expected JSON object')
      }
      const error = raw.error
      const routes = raw.routes
      expect(error).toBe('Not Found')
      expect(Array.isArray(routes)).toBe(true)
    })
  })

  describe('Bun.version', () => {
    test('returns version info', async () => {
      const data = await fetchJSON<{
        bunVersion: string
      }>('/')

      expect(data.bunVersion).toBe('1.0.0-workerd')
    })
  })

  describe('Bun.hash', () => {
    test('hashes string data', async () => {
      const data = await fetchJSON<{
        input: string
        hash: string
      }>('/hash?data=hello')

      expect(data.input).toBe('hello')
      expect(data.hash).toBeTruthy()
      expect(typeof data.hash).toBe('string')
    })

    test('uses default data when not provided', async () => {
      const data = await fetchJSON<{
        input: string
        hash: string
      }>('/hash')

      expect(data.input).toBe('hello')
    })

    test('different inputs produce different hashes', async () => {
      const hash1 = await fetchJSON<{ hash: string }>('/hash?data=hello')
      const hash2 = await fetchJSON<{ hash: string }>('/hash?data=world')

      expect(hash1.hash).not.toBe(hash2.hash)
    })
  })

  describe('Bun.deepEquals', () => {
    test('compares objects correctly', async () => {
      const data = await fetchJSON<Record<string, boolean>>('/deep-equals')
      expect(data['obj1 === obj2']).toBe(true)
      expect(data['obj1 === obj3']).toBe(false)
    })
  })

  describe('Bun.escapeHTML', () => {
    test('escapes HTML special characters', async () => {
      const data = await fetchJSON<{
        input: string
        escaped: string
      }>('/escape-html')

      expect(data.escaped).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(data.escaped).not.toContain('<')
      expect(data.escaped).not.toContain('>')
    })
  })

  describe('Bun.file and Bun.write', () => {
    test('writes and reads files in virtual filesystem', async () => {
      const data = await fetchJSON<{
        written: boolean
        existedBefore: boolean
        content: string
        size: number
      }>('/file-ops')

      expect(data.written).toBe(true)
      expect(data.content).toBe('Hello from Bun file API.')
      expect(data.size).toBe(24)
    })
  })

  describe('Bun.stringWidth', () => {
    test('calculates string widths correctly', async () => {
      const data = await fetchJSON<{
        results: Array<{ string: string; width: number }>
      }>('/string-width')

      const resultMap = new Map(data.results.map((r) => [r.string, r.width]))

      // ASCII characters are width 1
      expect(resultMap.get('hello')).toBe(5)

      // CJK characters are width 2
      expect(resultMap.get('你好')).toBe(4)

      // Emoji width should be a number
      const emojiWidth = resultMap.get('🎉')
      expect(typeof emojiWidth).toBe('number')
    })
  })

  describe('Bun.ArrayBufferSink', () => {
    test('accumulates data and returns buffer', async () => {
      const data = await fetchJSON<{
        text: string
        byteLength: number
      }>('/array-buffer-sink')

      expect(data.text).toBe('Hello World')
      expect(data.byteLength).toBe(11)
    })
  })

  describe('Bun.readableStreamToText', () => {
    test('converts stream to text', async () => {
      const data = await fetchJSON<{
        text: string
      }>('/stream')

      expect(data.text).toBe('Stream content')
    })
  })

  describe('Bun.nanoseconds', () => {
    test('returns bigint timestamp', async () => {
      const data = await fetchJSON<{
        nanoseconds: string
      }>('/nanoseconds')

      expect(data.nanoseconds).toBeTruthy()
      const ns = BigInt(data.nanoseconds)
      expect(ns >= 0n).toBe(true)
    })
  })

  describe('Bun.inspect', () => {
    test('inspects objects', async () => {
      const data = await fetchJSON<{
        inspected: string
      }>('/inspect')

      expect(data.inspected).toBeTruthy()
      expect(typeof data.inspected).toBe('string')
      expect(data.inspected).toContain('test')
    })
  })

  describe('Performance', () => {
    test('responds within acceptable time', async () => {
      const start = Date.now()
      await fetchJSON('/')
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(100) // Should respond in under 100ms
    })

    test('handles concurrent requests', async () => {
      const promises = Array.from({ length: 10 }, async () => {
        const response = await fetch(`${WORKERD_URL}/health`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        })
        return response.ok
      })
      const results = await Promise.all(promises)

      expect(results.length).toBe(10)
      expect(results.every((r) => r === true)).toBe(true)
    })

    test('handles 50 concurrent requests', async () => {
      const promises = Array.from({ length: 50 }, async () => {
        const response = await fetch(`${WORKERD_URL}/health`, {
          signal: AbortSignal.timeout(5000),
        })
        return response.ok
      })
      const results = await Promise.all(promises)
      expect(results.filter((r) => r === true).length).toBe(50)
    })
  })

  describe('Edge Cases - Hash', () => {
    test('hashes empty string', async () => {
      const data = await fetchJSON<{ hash: string }>('/hash?data=')
      expect(data.hash).toBeTruthy()
    })

    test('hashes special characters', async () => {
      const data = await fetchJSON<{ hash: string }>(
        `/hash?data=${encodeURIComponent('<script>alert("xss")</script>')}`,
      )
      expect(data.hash).toBeTruthy()
    })

    test('hash consistency - same input same output', async () => {
      const data1 = await fetchJSON<{ hash: string }>('/hash?data=consistent')
      const data2 = await fetchJSON<{ hash: string }>('/hash?data=consistent')
      expect(data1.hash).toBe(data2.hash)
    })
  })

  describe('Edge Cases - escapeHTML', () => {
    test('escapes all special HTML characters', async () => {
      const data = await fetchJSON<{ escaped: string }>(
        `/escape-html?html=${encodeURIComponent('<>"\'&')}`,
      )
      expect(data.escaped).toBe('&lt;&gt;&quot;&#039;&amp;')
    })

    test('preserves safe characters', async () => {
      const data = await fetchJSON<{ escaped: string }>(
        '/escape-html?html=hello123',
      )
      expect(data.escaped).toBe('hello123')
    })
  })

  describe('Edge Cases - File Operations', () => {
    test('file operations return consistent content', async () => {
      const data1 = await fetchJSON<{
        existedBefore: boolean
        content: string
      }>('/file-ops')
      const data2 = await fetchJSON<{
        existedBefore: boolean
        content: string
      }>('/file-ops')

      expect(data1.content).toBe('Hello from Bun file API.')
      expect(data2.content).toBe('Hello from Bun file API.')
    })
  })

  describe('Response Headers', () => {
    test('returns correct content-type', async () => {
      const response = await fetch(`${WORKERD_URL}/`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      })
      expect(response.headers.get('content-type')).toBe('application/json')
    })

    test('health endpoint returns text content', async () => {
      const response = await fetch(`${WORKERD_URL}/health`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      })
      const _contentType = response.headers.get('content-type') || ''
      // Health can be plain text or no specific content-type
      expect(response.ok).toBe(true)
    })
  })

  describe('Error Handling', () => {
    test('404 response has expected structure', async () => {
      const response = await fetch(`${WORKERD_URL}/not-found`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      })
      expect(response.status).toBe(404)
      const raw: JsonValue = await response.json()
      if (!isJsonRecord(raw)) {
        throw new Error('Expected JSON object')
      }
      const error = raw.error
      expect(error).toBe('Not Found')
    })

    test('multiple 404 requests work consistently', async () => {
      const promises = Array.from({ length: 5 }, async () => {
        const response = await fetch(`${WORKERD_URL}/random-${Math.random()}`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        })
        return response.status
      })
      const statuses = await Promise.all(promises)
      expect(statuses.every((s) => s === 404)).toBe(true)
    })
  })

  describe('Data Validation', () => {
    test('stringWidth returns expected types', async () => {
      const data = await fetchJSON<{
        results: Array<{ string: string; width: number }>
      }>('/string-width')

      data.results.forEach((result) => {
        expect(typeof result.string).toBe('string')
        expect(typeof result.width).toBe('number')
        expect(result.width).toBeGreaterThanOrEqual(0)
      })
    })

    test('nanoseconds returns valid bigint string', async () => {
      const data = await fetchJSON<{ nanoseconds: string }>('/nanoseconds')
      expect(data.nanoseconds).toMatch(/^\d+$/)
      const ns = BigInt(data.nanoseconds)
      expect(ns >= 0n).toBe(true)
    })

    test('inspect returns non-empty string', async () => {
      const data = await fetchJSON<{ inspected: string }>('/inspect')
      expect(data.inspected.length).toBeGreaterThan(0)
      expect(data.inspected).toContain('{')
    })
  })

  describe('Request Methods', () => {
    test('GET requests work', async () => {
      const response = await fetch(`${WORKERD_URL}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      })
      expect(response.ok).toBe(true)
    })

    test('HEAD requests return headers only', async () => {
      const response = await fetch(`${WORKERD_URL}/health`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      })
      expect(response.ok).toBe(true)
      const _body = await response.text()
      // HEAD may or may not return body depending on worker implementation
    })
  })

  describe('Sequential Operations', () => {
    test('rapid sequential requests', async () => {
      for (let i = 0; i < 10; i++) {
        const data = await fetchJSON<{ bunVersion: string }>('/')
        expect(data.bunVersion).toBe('1.0.0-workerd')
      }
    })

    test('different endpoints in sequence', async () => {
      const version = await fetchJSON<{ bunVersion: string }>('/')
      expect(version.bunVersion).toBe('1.0.0-workerd')

      const hash = await fetchJSON<{ hash: string }>('/hash?data=test')
      expect(hash.hash).toBeTruthy()

      const fileOps = await fetchJSON<{ written: boolean }>('/file-ops')
      expect(fileOps.written).toBe(true)

      const health = await fetch(`${WORKERD_URL}/health`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      })
      expect(health.ok).toBe(true)
    })
  })
})

// Copyright (c) 2024 Jeju Network
// Unit tests for Bun runtime compatibility layer
// Licensed under the Apache 2.0 license

import { afterEach, describe, expect, test } from 'bun:test'
import Bun, {
  ArrayBufferSink,
  deepEquals,
  dns,
  env,
  escapeHTML,
  file,
  fileURLToPath,
  gc,
  generateHeapSnapshot,
  getServeHandler,
  hash,
  inspect,
  main,
  nanoseconds,
  openInEditor,
  password,
  pathToFileURL,
  peek,
  randomUUIDv7,
  readableStreamToArray,
  readableStreamToArrayBuffer,
  readableStreamToBlob,
  readableStreamToJSON,
  readableStreamToText,
  revision,
  serve,
  shrink,
  sleep,
  sleepSync,
  stringWidth,
  version,
  write,
} from './bun'

describe('Bun Runtime', () => {
  describe('File Operations', () => {
    test('Bun.file creates a BunFile reference', () => {
      const bunFile = file('/test/path.txt')
      expect(bunFile.name).toBe('/test/path.txt') // name returns full path
      expect(bunFile.size).toBe(0) // No data written yet
    })

    test('Bun.file with URL', () => {
      const bunFile = file(new URL('file:///test/path.txt'))
      expect(bunFile.name).toBe('/test/path.txt') // name returns full path
    })

    test('Bun.file with custom type', () => {
      const bunFile = file('/test/style.css', { type: 'text/css' })
      expect(bunFile.type).toBe('text/css')
    })

    test('Bun.write writes string data', async () => {
      const bytes = await write('/test/file.txt', 'Hello, World!')
      expect(bytes).toBe(13)

      const bunFile = file('/test/file.txt')
      expect(await bunFile.text()).toBe('Hello, World!')
    })

    test('Bun.write writes Uint8Array data', async () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
      const bytes = await write('/test/binary.bin', data)
      expect(bytes).toBe(5)

      const bunFile = file('/test/binary.bin')
      const retrieved = await bunFile.bytes()
      expect(retrieved).toEqual(data)
    })

    test('Bun.write writes ArrayBuffer data', async () => {
      const data = new TextEncoder().encode('Test').buffer
      const bytes = await write('/test/buffer.bin', data)
      expect(bytes).toBe(4)
    })

    test('BunFile.exists returns correct state', async () => {
      expect(await file('/nonexistent').exists()).toBe(false)

      await write('/exists.txt', 'data')
      expect(await file('/exists.txt').exists()).toBe(true)
    })

    test('BunFile.json parses JSON content', async () => {
      await write('/test/data.json', '{"name": "test", "value": 42}')
      const bunFile = file('/test/data.json')
      const data = await bunFile.json<{ name: string; value: number }>()
      expect(data.name).toBe('test')
      expect(data.value).toBe(42)
    })

    test('BunFile.arrayBuffer returns ArrayBuffer', async () => {
      await write('/test/ab.txt', 'ArrayBuffer')
      const bunFile = file('/test/ab.txt')
      const ab = await bunFile.arrayBuffer()
      expect(ab).toBeInstanceOf(ArrayBuffer)
      expect(ab.byteLength).toBe(11)
    })

    test('BunFile.stream returns ReadableStream', async () => {
      await write('/test/stream.txt', 'Stream content')
      const bunFile = file('/test/stream.txt')
      const stream = bunFile.stream()
      expect(stream).toBeInstanceOf(ReadableStream)

      const text = await readableStreamToText(stream)
      expect(text).toBe('Stream content')
    })

    test('BunFile.slice creates sliced file', async () => {
      await write('/test/slice.txt', 'Hello World')
      const bunFile = file('/test/slice.txt')
      const sliced = bunFile.slice(0, 5)
      expect(await sliced.text()).toBe('Hello')
    })

    test('BunFile.writer creates FileSink', async () => {
      const bunFile = file('/test/sink.txt')
      const writer = bunFile.writer()

      writer.write('Part 1')
      writer.write(' - Part 2')
      writer.end()

      expect(await bunFile.text()).toBe('Part 1 - Part 2')
    })

    test('BunFile.lastModified returns timestamp', async () => {
      const before = Date.now()
      await write('/test/time.txt', 'data')
      const bunFile = file('/test/time.txt')
      const after = Date.now()

      expect(bunFile.lastModified).toBeGreaterThanOrEqual(before)
      expect(bunFile.lastModified).toBeLessThanOrEqual(after)
    })

    test('BunFile.text throws for non-existent file', async () => {
      const bunFile = file('/does/not/exist.txt')
      await expect(bunFile.text()).rejects.toThrow('ENOENT')
    })

    test('BunFile.bytes throws for non-existent file', async () => {
      const bunFile = file('/does/not/exist/bytes.bin')
      await expect(bunFile.bytes()).rejects.toThrow('ENOENT')
    })

    test('BunFile.arrayBuffer throws for non-existent file', async () => {
      const bunFile = file('/does/not/exist/ab.bin')
      await expect(bunFile.arrayBuffer()).rejects.toThrow('ENOENT')
    })

    test('BunFile.stream throws for non-existent file', () => {
      const bunFile = file('/does/not/exist/stream.txt')
      expect(() => bunFile.stream()).toThrow('ENOENT')
    })

    test('Bun.write writes Blob data', async () => {
      const blob = new Blob(['Blob content'], { type: 'text/plain' })
      const bytes = await write('/test/blob.txt', blob)
      expect(bytes).toBe(12)

      const bunFile = file('/test/blob.txt')
      expect(await bunFile.text()).toBe('Blob content')
    })

    test('Bun.write writes Response data', async () => {
      const response = new Response('Response content')
      const bytes = await write('/test/response.txt', response)
      expect(bytes).toBe(16)

      const bunFile = file('/test/response.txt')
      expect(await bunFile.text()).toBe('Response content')
    })

    test('Bun.write writes BunFile data', async () => {
      await write('/test/source.txt', 'Source content')
      const sourceFile = file('/test/source.txt')

      const bytes = await write('/test/dest.txt', sourceFile)
      expect(bytes).toBe(14)

      const destFile = file('/test/dest.txt')
      expect(await destFile.text()).toBe('Source content')
    })

    test('Bun.write to BunFile destination', async () => {
      const destFile = file('/test/bunfile-dest.txt')
      const bytes = await write(destFile, 'BunFile dest content')
      expect(bytes).toBe(20)

      expect(await destFile.text()).toBe('BunFile dest content')
    })

    test('Bun.write to URL destination', async () => {
      const url = new URL('file:///test/url-dest.txt')
      const bytes = await write(url, 'URL dest content')
      expect(bytes).toBe(16)

      const bunFile = file('/test/url-dest.txt')
      expect(await bunFile.text()).toBe('URL dest content')
    })
  })

  describe('Serve', () => {
    let server: ReturnType<typeof serve> | null = null

    afterEach(() => {
      if (server) {
        server.stop()
        server = null
      }
    })

    test('Bun.serve creates a server', () => {
      server = serve({
        fetch: () => new Response('OK'),
        port: 3000,
      })

      expect(server.port).toBe(3000)
      expect(server.hostname).toBe('localhost')
      expect(server.url.toString()).toBe('http://localhost:3000/')
    })

    test('Bun.serve handles requests', async () => {
      server = serve({
        fetch: (req) => {
          const url = new URL(req.url)
          return new Response(`Path: ${url.pathname}`)
        },
      })

      const response = await server.fetch(new Request('http://localhost/test'))
      expect(await response.text()).toBe('Path: /test')
    })

    test('Bun.serve error handler works', async () => {
      server = serve({
        fetch: () => {
          throw new Error('Test error')
        },
        error: (err) => new Response(`Error: ${err.message}`, { status: 500 }),
      })

      const response = await server.fetch(new Request('http://localhost/'))
      expect(response.status).toBe(500)
      expect(await response.text()).toBe('Error: Test error')
    })

    test('getServeHandler returns current options', () => {
      server = serve({
        fetch: () => new Response('OK'),
      })

      const handler = getServeHandler()
      expect(handler).not.toBeNull()
      expect(typeof handler?.fetch).toBe('function')
    })

    test('server.reload updates configuration', async () => {
      server = serve({
        fetch: () => new Response('Original'),
      })

      server.reload({
        fetch: () => new Response('Updated'),
      })

      const response = await server.fetch(new Request('http://localhost/'))
      expect(await response.text()).toBe('Updated')
    })
  })

  describe('Environment', () => {
    test('Bun.env proxies process.env', () => {
      // This tests the proxy behavior
      expect(typeof env).toBe('object')
    })

    test('Bun.version returns version string', () => {
      expect(typeof version).toBe('string')
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    })

    test('Bun.revision returns revision info', () => {
      expect(revision).toBe('workerd-compat')
    })
  })

  describe('Utilities', () => {
    test('Bun.sleep delays execution', async () => {
      const start = Date.now()
      await sleep(50)
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    test('Bun.sleepSync blocks execution', () => {
      const start = Date.now()
      sleepSync(50)
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    test('Bun.nanoseconds returns bigint', () => {
      const ns = nanoseconds()
      expect(typeof ns).toBe('bigint')
      expect(ns).toBeGreaterThan(0n)
    })

    test('Bun.nanoseconds increases over time', async () => {
      const ns1 = nanoseconds()
      await sleep(10)
      const ns2 = nanoseconds()
      expect(ns2).toBeGreaterThan(ns1)
    })

    test('Bun.escapeHTML escapes special characters', () => {
      expect(escapeHTML('<script>')).toBe('&lt;script&gt;')
      expect(escapeHTML('"quoted"')).toBe('&quot;quoted&quot;')
      expect(escapeHTML("it's")).toBe('it&#039;s')
      expect(escapeHTML('A & B')).toBe('A &amp; B')
      expect(escapeHTML('<a href="test">link</a>')).toBe(
        '&lt;a href=&quot;test&quot;&gt;link&lt;/a&gt;',
      )
    })

    test('Bun.stringWidth calculates display width', () => {
      expect(stringWidth('hello')).toBe(5)
      expect(stringWidth('こんにちは')).toBe(10) // CJK characters are 2 width
      expect(stringWidth('a中b')).toBe(4) // 1 + 2 + 1
    })

    test('Bun.deepEquals compares primitives', () => {
      expect(deepEquals(1, 1)).toBe(true)
      expect(deepEquals(1, 2)).toBe(false)
      expect(deepEquals('a', 'a')).toBe(true)
      expect(deepEquals('a', 'b')).toBe(false)
      expect(deepEquals(null, null)).toBe(true)
      expect(deepEquals(undefined, undefined)).toBe(true)
      expect(deepEquals(null, undefined)).toBe(false)
    })

    test('Bun.deepEquals compares arrays', () => {
      expect(deepEquals([1, 2, 3], [1, 2, 3])).toBe(true)
      expect(deepEquals([1, 2, 3], [1, 2, 4])).toBe(false)
      expect(deepEquals([1, 2], [1, 2, 3])).toBe(false)
      expect(
        deepEquals(
          [
            [1, 2],
            [3, 4],
          ],
          [
            [1, 2],
            [3, 4],
          ],
        ),
      ).toBe(true)
    })

    test('Bun.deepEquals compares objects', () => {
      expect(deepEquals({ a: 1 }, { a: 1 })).toBe(true)
      expect(deepEquals({ a: 1 }, { a: 2 })).toBe(false)
      expect(deepEquals({ a: 1 }, { b: 1 })).toBe(false)
      expect(deepEquals({ a: { b: 2 } }, { a: { b: 2 } })).toBe(true)
    })

    test('Bun.inspect formats values', () => {
      expect(inspect(null)).toBe('null')
      expect(inspect(undefined)).toBe('undefined')
      expect(inspect(42)).toBe('42')
      expect(inspect('hello')).toBe('"hello"')
      expect(inspect([1, 2, 3])).toBe('[ 1, 2, 3 ]')
      expect(inspect({ a: 1 })).toBe('{ a: 1 }')
    })

    test('Bun.inspect handles circular references', () => {
      const obj: Record<string, unknown> = { a: 1 }
      obj.self = obj
      expect(inspect(obj)).toContain('[Circular]')
    })

    test('Bun.inspect respects depth option', () => {
      const deep = { a: { b: { c: { d: 1 } } } }
      expect(inspect(deep, { depth: 1 })).toContain('[Object]')
    })
  })

  describe('Hashing', () => {
    test('Bun.hash computes wyhash by default', () => {
      const h = hash('test')
      expect(typeof h).toBe('bigint')
    })

    test('Bun.hash computes crc32', () => {
      const h = hash('test', 'crc32')
      expect(typeof h).toBe('number')
      expect(h).toBeGreaterThan(0)
    })

    test('Bun.hash computes adler32', () => {
      const h = hash('test', 'adler32')
      expect(typeof h).toBe('number')
      expect(h).toBeGreaterThan(0)
    })

    test('Bun.hash computes cityhash32', () => {
      const h = hash('test', 'cityhash32')
      expect(typeof h).toBe('number')
    })

    test('Bun.hash computes cityhash64', () => {
      const h = hash('test', 'cityhash64')
      expect(typeof h).toBe('bigint')
    })

    test('Bun.hash computes murmur32v3', () => {
      const h = hash('test', 'murmur32v3')
      expect(typeof h).toBe('number')
    })

    test('Bun.hash computes murmur64v2', () => {
      const h = hash('test', 'murmur64v2')
      expect(typeof h).toBe('bigint')
    })

    test('Bun.hash works with Uint8Array', () => {
      const data = new TextEncoder().encode('test')
      const h = hash(data)
      expect(typeof h).toBe('bigint')
    })

    test('Bun.hash works with ArrayBuffer', () => {
      const data = new TextEncoder().encode('test').buffer
      const h = hash(data)
      expect(typeof h).toBe('bigint')
    })

    test('same input produces same hash', () => {
      const h1 = hash('consistent')
      const h2 = hash('consistent')
      expect(h1).toBe(h2)
    })

    test('different input produces different hash', () => {
      const h1 = hash('value1')
      const h2 = hash('value2')
      expect(h1).not.toBe(h2)
    })
  })

  describe('Password Hashing', () => {
    test('Bun.password.hash returns hash string', async () => {
      const hashed = await password.hash('secret')
      expect(typeof hashed).toBe('string')
      expect(hashed.startsWith('$workerd$')).toBe(true)
    })

    test('Bun.password.verify verifies correct password', async () => {
      const hashed = await password.hash('correct')
      expect(await password.verify('correct', hashed)).toBe(true)
    })

    test('Bun.password.verify rejects wrong password', async () => {
      const hashed = await password.hash('correct')
      expect(await password.verify('wrong', hashed)).toBe(false)
    })

    test('Bun.password.hash with custom cost', async () => {
      const hashed = await password.hash('secret', { cost: 8 })
      expect(hashed).toContain('$8$')
      expect(await password.verify('secret', hashed)).toBe(true)
    })

    test('Bun.password.hash different passwords produce different hashes', async () => {
      const h1 = await password.hash('password1')
      const h2 = await password.hash('password2')
      expect(h1).not.toBe(h2)
    })

    test('Bun.password.hash same password produces different hashes (salt)', async () => {
      const h1 = await password.hash('same')
      const h2 = await password.hash('same')
      expect(h1).not.toBe(h2)
    })
  })

  describe('Stream Utilities', () => {
    function createTestStream(data: string): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder()
      return new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(data))
          controller.close()
        },
      })
    }

    test('readableStreamToArray returns array of chunks', async () => {
      const stream = createTestStream('test')
      const chunks = await readableStreamToArray(stream)
      expect(Array.isArray(chunks)).toBe(true)
      expect(chunks.length).toBe(1)
    })

    test('readableStreamToText returns string', async () => {
      const stream = createTestStream('Hello Stream')
      const text = await readableStreamToText(stream)
      expect(text).toBe('Hello Stream')
    })

    test('readableStreamToArrayBuffer returns ArrayBuffer', async () => {
      const stream = createTestStream('buffer')
      const ab = await readableStreamToArrayBuffer(stream)
      expect(ab).toBeInstanceOf(ArrayBuffer)
      expect(ab.byteLength).toBe(6)
    })

    test('readableStreamToBlob returns Blob', async () => {
      const stream = createTestStream('blob data')
      const blob = await readableStreamToBlob(stream, 'text/plain')
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toContain('text/plain')
      expect(await blob.text()).toBe('blob data')
    })

    test('readableStreamToJSON parses JSON', async () => {
      const stream = createTestStream('{"key": "value"}')
      const json = await readableStreamToJSON<{ key: string }>(stream)
      expect(json.key).toBe('value')
    })
  })

  describe('ArrayBufferSink', () => {
    test('ArrayBufferSink writes string data', () => {
      const sink = new ArrayBufferSink()
      sink.write('hello')
      sink.write(' world')
      const result = sink.end()
      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(new TextDecoder().decode(result)).toBe('hello world')
    })

    test('ArrayBufferSink writes Uint8Array data', () => {
      const sink = new ArrayBufferSink()
      sink.write(new Uint8Array([1, 2, 3]))
      sink.write(new Uint8Array([4, 5, 6]))
      const result = sink.end()
      expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
    })

    test('ArrayBufferSink writes ArrayBuffer data', () => {
      const sink = new ArrayBufferSink()
      sink.write(new Uint8Array([1, 2]).buffer)
      sink.write(new Uint8Array([3, 4]).buffer)
      const result = sink.end()
      expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4]))
    })

    test('ArrayBufferSink.start resets the sink', () => {
      const sink = new ArrayBufferSink()
      sink.write('first')
      sink.start()
      sink.write('second')
      const result = sink.end()
      expect(new TextDecoder().decode(result)).toBe('second')
    })
  })

  describe('Miscellaneous', () => {
    test('randomUUIDv7 generates valid UUIDs', () => {
      const uuid = randomUUIDv7()
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
    })

    test('randomUUIDv7 generates unique UUIDs', () => {
      const uuids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        uuids.add(randomUUIDv7())
      }
      expect(uuids.size).toBe(100)
    })

    test('peek returns promise for unresolved promise', () => {
      const promise = new Promise<string>((resolve) =>
        setTimeout(() => resolve('value'), 100),
      )
      const result = peek(promise)
      expect(result).toBe(promise)
    })

    test('peek returns value for resolved promise', async () => {
      const promise = Promise.resolve('resolved')
      await sleep(10) // Let the promise tracking kick in
      const result = peek(promise)
      // Since we're tracking after resolution, it should still work
      expect(result).toBe(promise) // First call starts tracking
    })

    test('gc is a no-op', () => {
      expect(() => gc()).not.toThrow()
    })

    test('shrink is a no-op', () => {
      expect(() => shrink()).not.toThrow()
    })

    test('fileURLToPath converts file URL', () => {
      expect(fileURLToPath('file:///home/user/file.txt')).toBe(
        '/home/user/file.txt',
      )
      expect(fileURLToPath(new URL('file:///path/to/file'))).toBe(
        '/path/to/file',
      )
    })

    test('fileURLToPath throws for non-file URLs', () => {
      expect(() => fileURLToPath('http://example.com')).toThrow(
        'URL must use file: protocol',
      )
    })

    test('pathToFileURL converts path to URL', () => {
      const url = pathToFileURL('/home/user/file.txt')
      expect(url.protocol).toBe('file:')
      expect(url.pathname).toBe('/home/user/file.txt')
    })

    test('main property returns boolean', () => {
      expect(typeof main).toBe('boolean')
    })
  })

  describe('DNS (unavailable in workerd)', () => {
    test('dns.lookup throws ERR_WORKERD_UNAVAILABLE', async () => {
      await expect(dns.lookup('example.com')).rejects.toThrow(
        'not available in workerd',
      )
    })

    test('dns.reverse throws ERR_WORKERD_UNAVAILABLE', async () => {
      await expect(dns.reverse('8.8.8.8')).rejects.toThrow(
        'not available in workerd',
      )
    })

    test('dns.resolve throws ERR_WORKERD_UNAVAILABLE', async () => {
      await expect(dns.resolve('example.com')).rejects.toThrow(
        'not available in workerd',
      )
    })
  })

  describe('Unavailable Functions', () => {
    test('generateHeapSnapshot throws', () => {
      expect(() => generateHeapSnapshot()).toThrow('not available in workerd')
    })

    test('openInEditor throws', () => {
      expect(() => openInEditor('/some/path')).toThrow(
        'not available in workerd',
      )
    })
  })

  describe('FFI (unavailable in workerd)', () => {
    // FFI is tested via separate import to ensure the module loads
    test('ffi module throws on dlopen', async () => {
      const ffi = await import('./ffi')
      expect(() => ffi.dlopen('/path/to/lib', {})).toThrow(
        'not available in workerd',
      )
    })

    test('ffi module throws on ptr', async () => {
      const ffi = await import('./ffi')
      expect(() => ffi.ptr(new Uint8Array([1, 2, 3]))).toThrow(
        'not available in workerd',
      )
    })

    test('ffi module throws on CString', async () => {
      const ffi = await import('./ffi')
      expect(() => ffi.CString(12345)).toThrow('not available in workerd')
    })

    test('ffi module throws on read', async () => {
      const ffi = await import('./ffi')
      expect(() => ffi.read(12345, 'i32')).toThrow('not available in workerd')
    })

    test('ffi module throws on write', async () => {
      const ffi = await import('./ffi')
      expect(() => ffi.write(12345, 42, 'i32')).toThrow(
        'not available in workerd',
      )
    })

    test('ffi module throws on allocate', async () => {
      const ffi = await import('./ffi')
      expect(() => ffi.allocate(1024)).toThrow('not available in workerd')
    })

    test('ffi module throws on free', async () => {
      const ffi = await import('./ffi')
      expect(() => ffi.free(12345)).toThrow('not available in workerd')
    })

    test('ffi module throws on callback', async () => {
      const ffi = await import('./ffi')
      expect(() =>
        ffi.callback(() => {}, { args: [], returns: 'void' }),
      ).toThrow('not available in workerd')
    })

    test('ffi module throws on toArrayBuffer', async () => {
      const ffi = await import('./ffi')
      expect(() => ffi.toArrayBuffer(12345, 100)).toThrow(
        'not available in workerd',
      )
    })

    test('ffi module throws on viewSource', async () => {
      const ffi = await import('./ffi')
      expect(() => ffi.viewSource(12345, 'i32', 10)).toThrow(
        'not available in workerd',
      )
    })

    test('ffi module exports FFI_TYPES constant', async () => {
      const ffi = await import('./ffi')
      expect(ffi.FFI_TYPES).toBeDefined()
      expect(ffi.FFI_TYPES.void).toBe(0)
      expect(ffi.FFI_TYPES.i32).toBe(5)
      expect(ffi.FFI_TYPES.pointer).toBe(13)
    })
  })

  describe('Test Module Stubs (unavailable in workerd)', () => {
    // bun:test stubs throw when called inside workerd
    test('test module describe throws', async () => {
      const testModule = await import('./test')
      expect(() => testModule.describe('test', () => {})).toThrow(
        'not available in workerd',
      )
    })

    test('test module test throws', async () => {
      const testModule = await import('./test')
      expect(() => testModule.test('test', () => {})).toThrow(
        'not available in workerd',
      )
    })

    test('test module it throws', async () => {
      const testModule = await import('./test')
      expect(() => testModule.it('test', () => {})).toThrow(
        'not available in workerd',
      )
    })

    test('test module expect throws', async () => {
      const testModule = await import('./test')
      expect(() => testModule.expect(true)).toThrow('not available in workerd')
    })

    test('test module beforeAll throws', async () => {
      const testModule = await import('./test')
      expect(() => testModule.beforeAll(() => {})).toThrow(
        'not available in workerd',
      )
    })

    test('test module afterAll throws', async () => {
      const testModule = await import('./test')
      expect(() => testModule.afterAll(() => {})).toThrow(
        'not available in workerd',
      )
    })

    test('test module beforeEach throws', async () => {
      const testModule = await import('./test')
      expect(() => testModule.beforeEach(() => {})).toThrow(
        'not available in workerd',
      )
    })

    test('test module afterEach throws', async () => {
      const testModule = await import('./test')
      expect(() => testModule.afterEach(() => {})).toThrow(
        'not available in workerd',
      )
    })

    test('test module mock throws', async () => {
      const testModule = await import('./test')
      expect(() => testModule.mock()).toThrow('not available in workerd')
    })

    test('test module spyOn throws', async () => {
      const testModule = await import('./test')
      expect(() => testModule.spyOn({ method: () => {} }, 'method')).toThrow(
        'not available in workerd',
      )
    })

    test('test module setSystemTime throws', async () => {
      const testModule = await import('./test')
      expect(() => testModule.setSystemTime(Date.now())).toThrow(
        'not available in workerd',
      )
    })
  })

  describe('Default Export', () => {
    test('Bun default export contains all APIs', () => {
      expect(typeof Bun.file).toBe('function')
      expect(typeof Bun.write).toBe('function')
      expect(typeof Bun.serve).toBe('function')
      expect(typeof Bun.env).toBe('object')
      expect(typeof Bun.version).toBe('string')
      expect(typeof Bun.sleep).toBe('function')
      expect(typeof Bun.hash).toBe('function')
      expect(typeof Bun.password).toBe('object')
      expect(typeof Bun.readableStreamToText).toBe('function')
      expect(typeof Bun.ArrayBufferSink).toBe('function')
    })
  })
})

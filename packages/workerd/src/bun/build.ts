// Copyright (c) 2024 Jeju Network
// Build script for bundling Bun compatibility TypeScript into JavaScript
// This creates a standalone bundle that can be used in workerd workers

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { type BuildConfig, build } from 'esbuild'

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const outDir = path.join(__dirname, '../../dist/bun')

// Ensure output directory exists
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true })
}

// Common build options
const commonOptions: BuildConfig = {
  bundle: true,
  format: 'esm' as const,
  target: 'esnext',
  platform: 'browser',
  minify: false,
  sourcemap: false,
  treeShaking: true,
}

// Build each module separately
async function buildModules() {
  console.log('Building Bun compatibility modules...')

  // Build main bun module
  await build({
    ...commonOptions,
    entryPoints: [path.join(__dirname, 'bun.ts')],
    outfile: path.join(outDir, 'bun.js'),
    external: ['bun-internal:*'],
  })
  console.log('  - bun.js')

  // Build sqlite module
  await build({
    ...commonOptions,
    entryPoints: [path.join(__dirname, 'sqlite.ts')],
    outfile: path.join(outDir, 'sqlite.js'),
    external: ['bun-internal:*', 'bun:bun'],
  })
  console.log('  - sqlite.js')

  // Build test module (stubs)
  await build({
    ...commonOptions,
    entryPoints: [path.join(__dirname, 'test.ts')],
    outfile: path.join(outDir, 'test.js'),
    external: ['bun-internal:*'],
  })
  console.log('  - test.js')

  // Build ffi module (stubs)
  await build({
    ...commonOptions,
    entryPoints: [path.join(__dirname, 'ffi.ts')],
    outfile: path.join(outDir, 'ffi.js'),
    external: ['bun-internal:*'],
  })
  console.log('  - ffi.js')

  // Build internal modules
  const internalDir = path.join(outDir, 'internal')
  if (!existsSync(internalDir)) {
    mkdirSync(internalDir, { recursive: true })
  }

  // Build internal/errors
  await build({
    ...commonOptions,
    entryPoints: [path.join(__dirname, 'internal/errors.ts')],
    outfile: path.join(internalDir, 'errors.js'),
  })
  console.log('  - internal/errors.js')

  // Build internal/types
  await build({
    ...commonOptions,
    entryPoints: [path.join(__dirname, 'internal/types.ts')],
    outfile: path.join(internalDir, 'types.js'),
  })
  console.log('  - internal/types.js')

  // Build internal/validators
  await build({
    ...commonOptions,
    entryPoints: [path.join(__dirname, 'internal/validators.ts')],
    outfile: path.join(internalDir, 'validators.js'),
    external: ['bun-internal:*'],
  })
  console.log('  - internal/validators.js')

  console.log('\nBuild complete.')
  console.log(`Output directory: ${outDir}`)
}

// Create a combined bundle for worker injection
async function buildCombinedBundle() {
  console.log('\nBuilding combined bundle for worker injection...')

  // Build a self-contained bundle that defines the Bun global
  const bundleCode = `
// Auto-generated Bun compatibility bundle for workerd
// This provides Bun APIs in workerd environments

// Internal utilities
const ERR_WORKERD_UNAVAILABLE = (api) => new Error(\`\${api} is not available in workerd\`)
const ERR_FS_FILE_NOT_FOUND = (path) => new Error(\`ENOENT: no such file or directory, open '\${path}'\`)

const isString = (v) => typeof v === 'string'
const isUint8Array = (v) => v instanceof Uint8Array
const isArrayBuffer = (v) => v instanceof ArrayBuffer

// Virtual file system for workerd
const virtualFS = new Map()

// BunFile implementation
class BunFileImpl {
  #path
  #type
  
  constructor(path, options = {}) {
    this.#path = typeof path === 'string' ? path : path.pathname
    this.#type = options.type ?? 'application/octet-stream'
  }
  
  get size() {
    const data = virtualFS.get(this.#path)
    return data ? data.byteLength : 0
  }
  
  get type() { return this.#type }
  get name() { return this.#path }
  get lastModified() { return Date.now() }
  
  async text() {
    const data = virtualFS.get(this.#path)
    if (!data) throw ERR_FS_FILE_NOT_FOUND(this.#path)
    return new TextDecoder().decode(data)
  }
  
  async json() {
    return JSON.parse(await this.text())
  }
  
  async arrayBuffer() {
    const data = virtualFS.get(this.#path)
    if (!data) throw ERR_FS_FILE_NOT_FOUND(this.#path)
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }
  
  async bytes() {
    const data = virtualFS.get(this.#path)
    if (!data) throw ERR_FS_FILE_NOT_FOUND(this.#path)
    return new Uint8Array(data)
  }
  
  stream() {
    const data = virtualFS.get(this.#path)
    if (!data) {
      return new ReadableStream({
        start(controller) { controller.error(ERR_FS_FILE_NOT_FOUND(this.#path)) }
      })
    }
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      }
    })
  }
  
  slice(start = 0, end = this.size, type = this.#type) {
    return new BunFileImpl(this.#path, { type })
  }
  
  async exists() {
    return virtualFS.has(this.#path)
  }
  
  writer() {
    const path = this.#path
    const chunks = []
    return {
      write(data) {
        const bytes = isString(data) ? new TextEncoder().encode(data) : new Uint8Array(data)
        chunks.push(bytes)
        return bytes.length
      },
      flush() {},
      end() {
        const total = chunks.reduce((acc, c) => acc + c.length, 0)
        const result = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
          result.set(chunk, offset)
          offset += chunk.length
        }
        virtualFS.set(path, result)
      }
    }
  }
}

// ArrayBufferSink implementation
class ArrayBufferSinkImpl {
  #chunks = []
  #highWaterMark
  #stream
  
  constructor(options = {}) {
    this.#highWaterMark = options.highWaterMark ?? 16384
    if (options.stream) {
      this.#stream = new ReadableStream({
        pull: (controller) => {
          if (this.#chunks.length > 0) {
            controller.enqueue(this.#chunks.shift())
          }
        }
      })
    }
  }
  
  write(chunk) {
    const data = isString(chunk) ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
    this.#chunks.push(data)
    return data.length
  }
  
  flush() { return this.end() }
  
  end() {
    const totalLength = this.#chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of this.#chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    this.#chunks = []
    return result.buffer
  }
  
  get stream() { return this.#stream }
}

// Hash implementation using crypto.subtle
async function hashData(algorithm, data) {
  const bytes = isString(data) ? new TextEncoder().encode(data) : new Uint8Array(data)
  const hashBuffer = await crypto.subtle.digest(algorithm, bytes)
  return new Uint8Array(hashBuffer)
}

// Fast hash (non-crypto)
function fastHash(data) {
  const bytes = isString(data) ? new TextEncoder().encode(data) : new Uint8Array(data)
  let hash = 0
  for (let i = 0; i < bytes.length; i++) {
    hash = ((hash << 5) - hash) + bytes[i]
    hash = hash >>> 0
  }
  return hash
}

// Deep equals
function deepEquals(a, b, strict = false) {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEquals(v, b[i], strict))
  }
  
  if (typeof a === 'object') {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every(key => deepEquals(a[key], b[key], strict))
  }
  
  return false
}

// Escape HTML
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// String width
function stringWidth(str) {
  let width = 0
  for (const char of str) {
    const code = char.codePointAt(0)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue
    if (code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe1f) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x20000 && code <= 0x2fffd) ||
        (code >= 0x30000 && code <= 0x3fffd))) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

// Inspect
function inspect(value, options = {}) {
  const { depth = 2, colors = false } = options
  return JSON.stringify(value, (key, val) => {
    if (typeof val === 'function') return '[Function]'
    if (val instanceof Date) return val.toISOString()
    if (val instanceof RegExp) return val.toString()
    return val
  }, 2)
}

// Nanoseconds
let perfStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
function nanoseconds() {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return BigInt(Math.floor((now - perfStartTime) * 1_000_000))
}

// Sleep
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function sleepSync(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {}
}

// Stream utilities
async function readableStreamToArrayBuffer(stream) {
  const reader = stream.getReader()
  const chunks = []
  let done = false
  while (!done) {
    const result = await reader.read()
    done = result.done
    if (result.value) chunks.push(result.value)
  }
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result.buffer
}

async function readableStreamToText(stream) {
  const buffer = await readableStreamToArrayBuffer(stream)
  return new TextDecoder().decode(buffer)
}

async function readableStreamToJSON(stream) {
  const text = await readableStreamToText(stream)
  return JSON.parse(text)
}

async function readableStreamToBlob(stream) {
  const buffer = await readableStreamToArrayBuffer(stream)
  return new Blob([buffer])
}

async function readableStreamToArray(stream) {
  const reader = stream.getReader()
  const chunks = []
  let done = false
  while (!done) {
    const result = await reader.read()
    done = result.done
    if (result.value) chunks.push(result.value)
  }
  return chunks
}

// Write utility
async function write(dest, data) {
  const destPath = typeof dest === 'string' ? dest : dest.name
  let bytes
  
  if (isString(data)) {
    bytes = new TextEncoder().encode(data)
  } else if (isUint8Array(data)) {
    bytes = data
  } else if (isArrayBuffer(data)) {
    bytes = new Uint8Array(data)
  } else if (data instanceof Blob) {
    bytes = new Uint8Array(await data.arrayBuffer())
  } else if (data instanceof Response) {
    bytes = new Uint8Array(await data.arrayBuffer())
  } else if (data instanceof BunFileImpl) {
    bytes = await data.bytes()
  } else {
    throw new TypeError('Invalid data type for Bun.write')
  }
  
  virtualFS.set(destPath, bytes)
  return bytes.length
}

// Main Bun object
const Bun = {
  version: '1.0.0-workerd',
  revision: 'workerd',
  main: '',
  
  // Environment
  env: typeof process !== 'undefined' ? process.env : {},
  
  // File operations
  file: (path, options) => new BunFileImpl(path, options),
  write,
  
  // Hashing
  hash: fastHash,
  sha: async (data, encoding) => hashData('SHA-1', data),
  
  // Utilities
  sleep,
  sleepSync,
  escapeHTML,
  stringWidth,
  deepEquals,
  inspect,
  nanoseconds,
  
  // Stream utilities
  readableStreamToArrayBuffer,
  readableStreamToText,
  readableStreamToJSON,
  readableStreamToBlob,
  readableStreamToArray,
  
  // ArrayBufferSink
  ArrayBufferSink: ArrayBufferSinkImpl,
  
  // Serve (stub - workerd handles this)
  serve: () => { throw ERR_WORKERD_UNAVAILABLE('Bun.serve') },
  
  // Unavailable APIs
  openInEditor: () => { throw ERR_WORKERD_UNAVAILABLE('Bun.openInEditor') },
  generateHeapSnapshot: () => { throw ERR_WORKERD_UNAVAILABLE('Bun.generateHeapSnapshot') },
  shrink: () => { throw ERR_WORKERD_UNAVAILABLE('Bun.shrink') },
  gc: () => { throw ERR_WORKERD_UNAVAILABLE('Bun.gc') },
  
  // Password hashing
  password: {
    hash: async () => { throw ERR_WORKERD_UNAVAILABLE('Bun.password.hash') },
    verify: async () => { throw ERR_WORKERD_UNAVAILABLE('Bun.password.verify') },
    hashSync: () => { throw ERR_WORKERD_UNAVAILABLE('Bun.password.hashSync') },
    verifySync: () => { throw ERR_WORKERD_UNAVAILABLE('Bun.password.verifySync') },
  },
  
  // DNS (not available in workerd)
  dns: {
    lookup: async () => { throw ERR_WORKERD_UNAVAILABLE('Bun.dns.lookup') },
    resolve: async () => { throw ERR_WORKERD_UNAVAILABLE('Bun.dns.resolve') },
    prefetch: () => { throw ERR_WORKERD_UNAVAILABLE('Bun.dns.prefetch') },
  },
}

// Export for ES modules
export default Bun
export { Bun }
`

  writeFileSync(path.join(outDir, 'bun-bundle.js'), bundleCode.trim())
  console.log('  - bun-bundle.js (standalone bundle)')

  console.log('\nStandalone bundle ready for worker injection.')
}

// Run builds
async function main() {
  try {
    await buildModules()
    await buildCombinedBundle()

    console.log('\n=== Build Summary ===')
    console.log(`Output: ${outDir}`)
    console.log('\nTo use in a worker, import from the bundle:')
    console.log('  import Bun from "./bun-bundle.js"')
    console.log('\nOr wait for workerd to be built with native bun: support.')
  } catch (error) {
    console.error('Build failed:', error)
    process.exit(1)
  }
}

main()

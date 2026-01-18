// Bun Hello World - Demonstrates Bun APIs in workerd
// Run: workerd serve config.capnp
// Test: curl http://localhost:9124/

import Bun from './bun-bundle.js'

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

const startTime = Date.now()

const json = (data: JsonValue, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const isJsonRecord = (value: JsonValue): value is { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readJsonObject = async (request: Request): Promise<{ [key: string]: JsonValue }> => {
  const body: JsonValue = await request.json()
  if (!isJsonRecord(body)) {
    throw new Error('Expected JSON object')
  }
  return body
}

const getString = (value: JsonValue, fallback: string): string => {
  if (typeof value === 'string') return value
  return fallback
}

const getNumber = (value: JsonValue, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fallback
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    switch (url.pathname) {
      case '/':
        return json({
          message: 'Hello from Bun!',
          bunVersion: Bun.version,
          uptime: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        })

      case '/hash': {
        const raw = url.searchParams.get('data')
        const data = raw === null ? 'hello' : raw
        return json({ input: data, hash: Bun.hash(data).toString(16) })
      }

      case '/deep-equals': {
        const obj1 = { a: 1, b: { c: [1, 2, 3] } }
        const obj2 = { a: 1, b: { c: [1, 2, 3] } }
        const obj3 = { a: 1, b: { c: [1, 2, 4] } }
        return json({
          'obj1 === obj2': Bun.deepEquals(obj1, obj2),
          'obj1 === obj3': Bun.deepEquals(obj1, obj3),
        })
      }

      case '/escape-html': {
        const rawHtml = url.searchParams.get('html')
        const html = rawHtml === null ? '<script>alert(1)</script>' : rawHtml
        return json({ input: html, escaped: Bun.escapeHTML(html) })
      }

      case '/nanoseconds':
        return json({ nanoseconds: Bun.nanoseconds().toString() })

      case '/inspect': {
        const obj = { name: 'test', nested: { deep: { value: [1, 2, 3] } } }
        return json({ inspected: Bun.inspect(obj) })
      }

      case '/string-width':
        return json({
          results: ['hello', '你好', '🎉'].map((s) => ({
            string: s,
            width: Bun.stringWidth(s),
          })),
        })

      case '/array-buffer-sink': {
        const sink = new Bun.ArrayBufferSink()
        sink.write('Hello ')
        sink.write('World')
        const buffer = sink.end()
        return json({
          text: new TextDecoder().decode(buffer),
          byteLength: buffer.byteLength,
        })
      }

      case '/stream': {
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('Stream '))
            c.enqueue(new TextEncoder().encode('content'))
            c.close()
          },
        })
        return json({ text: await Bun.readableStreamToText(stream) })
      }

      case '/sleep': {
        const rawMs = url.searchParams.get('ms')
        const ms = rawMs === null ? 100 : parseInt(rawMs, 10)
        const before = Date.now()
        await Bun.sleep(ms)
        return json({ requestedMs: ms, actualMs: Date.now() - before })
      }

      case '/file-ops': {
        const path = '/tmp/bun-test.txt'
        const existedBefore = await Bun.file(path).exists()
        await Bun.write(path, 'Hello from Bun file API.')
        const file = Bun.file(path)
        return json({
          written: true,
          existedBefore,
          content: await file.text(),
          size: file.size,
        })
      }

      case '/password-hash': {
        const body = await readJsonObject(request)
        const passwordValue = 'password' in body ? body.password : null
        const costValue = 'cost' in body ? body.cost : null
        const password = getString(passwordValue, 'default')
        const cost = getNumber(costValue, 10)
        const hash = await Bun.password.hash(password, { cost })
        return json({ hash, algorithm: 'pbkdf2', cost })
      }

      case '/password-verify': {
        const body = await readJsonObject(request)
        const passwordValue = body.password
        const hashValue = body.hash

        if (typeof passwordValue !== 'string' || typeof hashValue !== 'string') {
          return json({ error: 'Missing password or hash' }, 400)
        }

        return json({
          valid: await Bun.password.verify(passwordValue, hashValue),
        })
      }

      case '/dns-lookup': {
        const rawHostname = url.searchParams.get('hostname')
        const hostname = rawHostname === null ? 'google.com' : rawHostname
        const address = await Bun.dns.lookup(hostname)
        return json({ hostname, address, provider: Bun.dns.getProvider() })
      }

      case '/dns-resolve': {
        const rawHostname = url.searchParams.get('hostname')
        const hostname = rawHostname === null ? 'google.com' : rawHostname
        const rawType = url.searchParams.get('type')
        const type = rawType === null ? 'A' : rawType
        let records: string[] | Array<{ exchange: string; priority: number }>
        switch (type) {
          case 'MX':
            records = await Bun.dns.resolveMx(hostname)
            break
          case 'TXT':
            records = await Bun.dns.resolveTxt(hostname)
            break
          case 'NS':
            records = await Bun.dns.resolveNs(hostname)
            break
          case 'AAAA':
            records = await Bun.dns.resolve6(hostname)
            break
          default:
            records = await Bun.dns.resolve4(hostname)
        }
        return json({ hostname, type, records })
      }

      case '/health':
        return new Response('OK')

      default:
        return json(
          {
            error: 'Not Found',
            path: url.pathname,
            routes: [
              '/',
              '/hash',
              '/deep-equals',
              '/escape-html',
              '/nanoseconds',
              '/inspect',
              '/string-width',
              '/array-buffer-sink',
              '/stream',
              '/sleep',
              '/file-ops',
              '/password-hash',
              '/password-verify',
              '/dns-lookup',
              '/dns-resolve',
              '/health',
            ],
          },
          404,
        )
    }
  },
}

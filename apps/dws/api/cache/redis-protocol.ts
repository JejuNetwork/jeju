/**
 * Redis Wire Protocol (RESP) Server
 *
 * Implements the Redis Serialization Protocol (RESP) to allow
 * standard Redis clients to connect to DWS Cache.
 *
 * Supported clients:
 * - ioredis
 * - node-redis
 * - redis-cli
 * - Any RESP-compatible client
 *
 * @example
 * ```typescript
 * import { createRedisProtocolServer } from './redis-protocol'
 * import { CacheEngine } from './engine'
 *
 * const engine = new CacheEngine()
 * const server = createRedisProtocolServer(engine, { port: 6379 })
 * await server.start()
 *
 * // Now connect with any Redis client:
 * // redis-cli -p 6379
 * // or ioredis: new Redis({ port: 6379 })
 * ```
 */

import type { Socket, TCPSocketListener } from 'bun'
import type { CacheEngine } from './engine'

// RESP Protocol Constants
const CRLF = '\r\n'
const SIMPLE_STRING = '+'
const ERROR = '-'
const INTEGER = ':'
const BULK_STRING = '$'
const ARRAY = '*'

/**
 * RESP value types
 */
type RESPValue = string | number | null | RESPValue[]

/**
 * Redis command handler
 */
type CommandHandler = (
  engine: CacheEngine,
  namespace: string,
  args: string[],
) => RESPValue | Promise<RESPValue>

/**
 * Encode a value to RESP format
 */
function encodeRESP(value: RESPValue): string {
  if (value === null) {
    return `${BULK_STRING}-1${CRLF}`
  }

  if (typeof value === 'number') {
    return `${INTEGER}${value}${CRLF}`
  }

  if (typeof value === 'string') {
    if (value.startsWith('ERR') || value.startsWith('WRONGTYPE')) {
      return `${ERROR}${value}${CRLF}`
    }
    // Use bulk string for safety (handles binary data)
    return `${BULK_STRING}${Buffer.byteLength(value)}${CRLF}${value}${CRLF}`
  }

  if (Array.isArray(value)) {
    const parts = value.map((v) => encodeRESP(v))
    return `${ARRAY}${value.length}${CRLF}${parts.join('')}`
  }

  return `${BULK_STRING}-1${CRLF}`
}

/**
 * Encode a simple OK response
 */
function encodeOK(): string {
  return `${SIMPLE_STRING}OK${CRLF}`
}

/**
 * Encode a simple PONG response
 */
function encodePONG(): string {
  return `${SIMPLE_STRING}PONG${CRLF}`
}

/**
 * RESP Parser for incoming commands
 */
class RESPParser {
  private buffer = ''

  /**
   * Add data to the buffer
   */
  feed(data: string): void {
    this.buffer += data
  }

  /**
   * Try to parse a complete command from the buffer
   */
  parse(): string[] | null {
    if (this.buffer.length === 0) return null

    // Inline commands (like PING)
    if (this.buffer[0] !== '*') {
      const lineEnd = this.buffer.indexOf(CRLF)
      if (lineEnd === -1) return null

      const line = this.buffer.slice(0, lineEnd)
      this.buffer = this.buffer.slice(lineEnd + 2)
      return line.split(' ').filter((s) => s.length > 0)
    }

    // RESP array format
    const result = this.parseArray()
    return result
  }

  private parseArray(): string[] | null {
    if (this.buffer[0] !== '*') return null

    const lineEnd = this.buffer.indexOf(CRLF)
    if (lineEnd === -1) return null

    const count = parseInt(this.buffer.slice(1, lineEnd), 10)
    if (count < 0) return null

    let pos = lineEnd + 2
    const args: string[] = []

    for (let i = 0; i < count; i++) {
      if (pos >= this.buffer.length) return null

      if (this.buffer[pos] !== '$') return null

      const lenEnd = this.buffer.indexOf(CRLF, pos)
      if (lenEnd === -1) return null

      const len = parseInt(this.buffer.slice(pos + 1, lenEnd), 10)
      if (len < 0) {
        args.push('')
        pos = lenEnd + 2
        continue
      }

      const strStart = lenEnd + 2
      const strEnd = strStart + len

      if (strEnd + 2 > this.buffer.length) return null

      args.push(this.buffer.slice(strStart, strEnd))
      pos = strEnd + 2
    }

    this.buffer = this.buffer.slice(pos)
    return args
  }

  /**
   * Check if there's more data to parse
   */
  hasMore(): boolean {
    return this.buffer.length > 0
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = ''
  }
}

/**
 * Command handlers
 */
const COMMANDS: Record<string, CommandHandler> = {
  // Connection
  PING: () => 'PONG',
  ECHO: (_, __, args) => args[0] ?? '',
  QUIT: () => 'OK',
  SELECT: () => 'OK', // We use namespaces instead of DB numbers
  AUTH: () => 'OK', // TODO: Implement auth

  // String commands
  GET: (engine, ns, args) => engine.get(ns, args[0]) ?? null,
  SET: (engine, ns, args) => {
    const key = args[0]
    const value = args[1]
    let ttl: number | undefined

    // Parse SET options (EX, PX, NX, XX, etc.)
    for (let i = 2; i < args.length; i++) {
      const opt = args[i].toUpperCase()
      if (opt === 'EX' && args[i + 1]) {
        ttl = parseInt(args[i + 1], 10)
        i++
      } else if (opt === 'PX' && args[i + 1]) {
        ttl = Math.ceil(parseInt(args[i + 1], 10) / 1000)
        i++
      }
    }

    const nx = args.some((a) => a.toUpperCase() === 'NX')
    const xx = args.some((a) => a.toUpperCase() === 'XX')

    const result = engine.set(ns, key, value, { ttl, nx, xx })
    return result ? 'OK' : null
  },
  SETNX: (engine, ns, args) => {
    const result = engine.setnx(ns, args[0], args[1])
    return result ? 1 : 0
  },
  SETEX: (engine, ns, args) => {
    engine.setex(ns, args[0], parseInt(args[1], 10), args[2])
    return 'OK'
  },
  PSETEX: (engine, ns, args) => {
    const ttl = Math.ceil(parseInt(args[1], 10) / 1000)
    engine.setex(ns, args[0], ttl, args[2])
    return 'OK'
  },
  GETSET: (engine, ns, args) => {
    const old = engine.get(ns, args[0])
    engine.set(ns, args[0], args[1])
    return old
  },
  MGET: (engine, ns, args) => {
    return args.map((key) => engine.get(ns, key) ?? null)
  },
  MSET: (engine, ns, args) => {
    for (let i = 0; i < args.length; i += 2) {
      engine.set(ns, args[i], args[i + 1])
    }
    return 'OK'
  },
  APPEND: (engine, ns, args) => engine.append(ns, args[0], args[1]),
  STRLEN: (engine, ns, args) => {
    const value = engine.get(ns, args[0])
    return value?.length ?? 0
  },
  GETRANGE: (engine, ns, args) => {
    const value = engine.get(ns, args[0]) ?? ''
    const start = parseInt(args[1], 10)
    const end = parseInt(args[2], 10)
    return value.slice(start, end + 1)
  },

  // Numeric commands
  INCR: (engine, ns, args) => engine.incr(ns, args[0]),
  INCRBY: (engine, ns, args) => engine.incr(ns, args[0], parseInt(args[1], 10)),
  INCRBYFLOAT: (engine, ns, args) => {
    const current = engine.get(ns, args[0])
    const num = current ? parseFloat(current) : 0
    const newVal = num + parseFloat(args[1])
    engine.set(ns, args[0], newVal.toString())
    return newVal.toString()
  },
  DECR: (engine, ns, args) => engine.decr(ns, args[0]),
  DECRBY: (engine, ns, args) => engine.decr(ns, args[0], parseInt(args[1], 10)),

  // Key commands
  DEL: (engine, ns, args) => engine.del(ns, ...args),
  EXISTS: (engine, ns, args) => engine.exists(ns, ...args),
  EXPIRE: (engine, ns, args) =>
    engine.expire(ns, args[0], parseInt(args[1], 10)) ? 1 : 0,
  EXPIREAT: (engine, ns, args) =>
    engine.expireat(ns, args[0], parseInt(args[1], 10)) ? 1 : 0,
  PEXPIRE: (engine, ns, args) =>
    engine.expire(ns, args[0], Math.ceil(parseInt(args[1], 10) / 1000)) ? 1 : 0,
  TTL: (engine, ns, args) => engine.ttl(ns, args[0]),
  PTTL: (engine, ns, args) => engine.pttl(ns, args[0]),
  PERSIST: (engine, ns, args) => (engine.persist(ns, args[0]) ? 1 : 0),
  TYPE: (engine, ns, args) => engine.type(ns, args[0]),
  RENAME: (engine, ns, args) => {
    const result = engine.rename(ns, args[0], args[1])
    if (!result) return 'ERR no such key'
    return 'OK'
  },
  KEYS: (engine, ns, args) => engine.keys(ns, args[0] ?? '*'),
  SCAN: (engine, ns, args) => {
    const cursor = args[0]
    let pattern = '*'
    let count = 10

    for (let i = 1; i < args.length; i += 2) {
      if (args[i].toUpperCase() === 'MATCH') pattern = args[i + 1]
      if (args[i].toUpperCase() === 'COUNT') count = parseInt(args[i + 1], 10)
    }

    const result = engine.scan(ns, { cursor, pattern, count })
    return [result.cursor, result.keys]
  },
  FLUSHDB: (engine, ns) => {
    engine.flushdb(ns)
    return 'OK'
  },
  FLUSHALL: (engine) => {
    engine.flushall()
    return 'OK'
  },
  DBSIZE: (engine, ns) => engine.keys(ns, '*').length,

  // Hash commands
  HGET: (engine, ns, args) => engine.hget(ns, args[0], args[1]) ?? null,
  HSET: (engine, ns, args) => {
    let count = 0
    for (let i = 1; i < args.length; i += 2) {
      count += engine.hset(ns, args[0], args[i], args[i + 1])
    }
    return count
  },
  HSETNX: (engine, ns, args) => {
    const exists = engine.hexists(ns, args[0], args[1])
    if (exists) return 0
    engine.hset(ns, args[0], args[1], args[2])
    return 1
  },
  HMSET: (engine, ns, args) => {
    const fields: Record<string, string> = {}
    for (let i = 1; i < args.length; i += 2) {
      fields[args[i]] = args[i + 1]
    }
    engine.hmset(ns, args[0], fields)
    return 'OK'
  },
  HMGET: (engine, ns, args) => engine.hmget(ns, args[0], ...args.slice(1)),
  HGETALL: (engine, ns, args) => {
    const hash = engine.hgetall(ns, args[0])
    const result: string[] = []
    for (const [k, v] of Object.entries(hash)) {
      result.push(k, v)
    }
    return result
  },
  HDEL: (engine, ns, args) => engine.hdel(ns, args[0], ...args.slice(1)),
  HEXISTS: (engine, ns, args) => (engine.hexists(ns, args[0], args[1]) ? 1 : 0),
  HLEN: (engine, ns, args) => engine.hlen(ns, args[0]),
  HKEYS: (engine, ns, args) => engine.hkeys(ns, args[0]),
  HVALS: (engine, ns, args) => engine.hvals(ns, args[0]),
  HINCRBY: (engine, ns, args) =>
    engine.hincrby(ns, args[0], args[1], parseInt(args[2], 10)),
  HINCRBYFLOAT: (engine, ns, args) => {
    const current = engine.hget(ns, args[0], args[1])
    const num = current ? parseFloat(current) : 0
    const newVal = num + parseFloat(args[2])
    engine.hset(ns, args[0], args[1], newVal.toString())
    return newVal.toString()
  },

  // List commands
  LPUSH: (engine, ns, args) => engine.lpush(ns, args[0], ...args.slice(1)),
  RPUSH: (engine, ns, args) => engine.rpush(ns, args[0], ...args.slice(1)),
  LPOP: (engine, ns, args) => engine.lpop(ns, args[0]) ?? null,
  RPOP: (engine, ns, args) => engine.rpop(ns, args[0]) ?? null,
  LLEN: (engine, ns, args) => engine.llen(ns, args[0]),
  LRANGE: (engine, ns, args) =>
    engine.lrange(ns, args[0], parseInt(args[1], 10), parseInt(args[2], 10)),
  LINDEX: (engine, ns, args) =>
    engine.lindex(ns, args[0], parseInt(args[1], 10)) ?? null,
  LSET: (engine, ns, args) => {
    const result = engine.lset(ns, args[0], parseInt(args[1], 10), args[2])
    return result ? 'OK' : 'ERR index out of range'
  },
  LTRIM: (engine, ns, args) => {
    engine.ltrim(ns, args[0], parseInt(args[1], 10), parseInt(args[2], 10))
    return 'OK'
  },

  // Set commands
  SADD: (engine, ns, args) => engine.sadd(ns, args[0], ...args.slice(1)),
  SREM: (engine, ns, args) => engine.srem(ns, args[0], ...args.slice(1)),
  SMEMBERS: (engine, ns, args) => engine.smembers(ns, args[0]),
  SISMEMBER: (engine, ns, args) =>
    engine.sismember(ns, args[0], args[1]) ? 1 : 0,
  SCARD: (engine, ns, args) => engine.scard(ns, args[0]),
  SPOP: (engine, ns, args) => engine.spop(ns, args[0]) ?? null,
  SRANDMEMBER: (engine, ns, args) => engine.srandmember(ns, args[0]) ?? null,

  // Sorted set commands
  ZADD: (engine, ns, args) => {
    const members: Array<{ member: string; score: number }> = []
    for (let i = 1; i < args.length; i += 2) {
      members.push({ score: parseFloat(args[i]), member: args[i + 1] })
    }
    return engine.zadd(ns, args[0], ...members)
  },
  ZRANGE: (engine, ns, args) => {
    const withScores = args.some((a) => a.toUpperCase() === 'WITHSCORES')
    const result = engine.zrange(
      ns,
      args[0],
      parseInt(args[1], 10),
      parseInt(args[2], 10),
      withScores,
    )
    if (withScores && Array.isArray(result) && result.length > 0) {
      const firstItem = result[0]
      if (typeof firstItem === 'object' && 'member' in firstItem) {
        const flat: string[] = []
        for (const item of result as Array<{ member: string; score: number }>) {
          flat.push(item.member, item.score.toString())
        }
        return flat
      }
    }
    return result as string[]
  },
  ZREVRANGE: (engine, ns, args) => {
    const withScores = args.some((a) => a.toUpperCase() === 'WITHSCORES')
    // Get full sorted set and reverse for proper high-to-low ordering
    const allResult = engine.zrange(ns, args[0], 0, -1, true) as Array<{
      member: string
      score: number
    }>
    const reversed = [...allResult].reverse()

    const start = parseInt(args[1], 10)
    const stop = parseInt(args[2], 10)
    const len = reversed.length
    const normalizedStart = start < 0 ? Math.max(len + start, 0) : start
    const normalizedStop = stop < 0 ? len + stop + 1 : stop + 1
    const slice = reversed.slice(normalizedStart, normalizedStop)

    if (withScores) {
      const flat: string[] = []
      for (const item of slice) {
        flat.push(item.member, item.score.toString())
      }
      return flat
    }
    return slice.map((m) => m.member)
  },
  ZRANGEBYSCORE: (engine, ns, args) => {
    const min = args[1] === '-inf' ? -Infinity : parseFloat(args[1])
    const max = args[2] === '+inf' ? Infinity : parseFloat(args[2])
    const withScores = args.some((a) => a.toUpperCase() === 'WITHSCORES')
    const result = engine.zrangebyscore(ns, args[0], min, max, withScores)
    if (withScores && Array.isArray(result) && result.length > 0) {
      const firstItem = result[0]
      if (typeof firstItem === 'object' && 'member' in firstItem) {
        const flat: string[] = []
        for (const item of result as Array<{ member: string; score: number }>) {
          flat.push(item.member, item.score.toString())
        }
        return flat
      }
    }
    return result as string[]
  },
  ZSCORE: (engine, ns, args) => {
    const score = engine.zscore(ns, args[0], args[1])
    return score !== null ? score.toString() : null
  },
  ZCARD: (engine, ns, args) => engine.zcard(ns, args[0]),
  ZREM: (engine, ns, args) => engine.zrem(ns, args[0], ...args.slice(1)),

  // Pub/Sub commands
  PUBLISH: (engine, _ns, args) => engine.publish(args[0], args[1]),
  PUBSUB: (engine, _ns, args) => {
    const subcommand = args[0].toUpperCase()
    if (subcommand === 'CHANNELS') {
      return engine.pubsubChannels(args[1])
    }
    if (subcommand === 'NUMSUB') {
      const result = engine.pubsubNumsub(...args.slice(1))
      const flat: (string | number)[] = []
      for (const [ch, count] of result) {
        flat.push(ch, count)
      }
      return flat
    }
    if (subcommand === 'NUMPAT') {
      return engine.pubsubNumpat()
    }
    return []
  },

  // Server commands
  INFO: () => {
    return [
      '# Server',
      'redis_version:7.0.0-dws',
      'redis_mode:standalone',
      '# Clients',
      'connected_clients:1',
      '# Memory',
      'used_memory:0',
      '# Stats',
      'total_connections_received:1',
    ].join('\r\n')
  },
  CONFIG: (_, __, args) => {
    if (args[0].toUpperCase() === 'GET') {
      // Return empty array for any config requests
      return []
    }
    return 'OK'
  },
  CLIENT: () => 'OK',
  COMMAND: () => [],
  DEBUG: () => 'OK',
  TIME: () => {
    const now = Date.now()
    return [Math.floor(now / 1000).toString(), ((now % 1000) * 1000).toString()]
  },
}

/**
 * Redis protocol server configuration
 */
export interface RedisProtocolConfig {
  port: number
  host?: string
  namespace?: string
  password?: string
}

/**
 * Client connection state
 */
interface ClientState {
  parser: RESPParser
  authenticated: boolean
}

/**
 * Redis protocol server
 */
export class RedisProtocolServer {
  private engine: CacheEngine
  private config: Required<RedisProtocolConfig>
  private server: TCPSocketListener<ClientState> | null = null
  private clientCount = 0

  constructor(engine: CacheEngine, config: RedisProtocolConfig) {
    this.engine = engine
    this.config = {
      host: '0.0.0.0',
      namespace: 'default',
      password: '',
      ...config,
    }
  }

  /**
   * Start the Redis protocol server
   */
  async start(): Promise<void> {
    const self = this

    this.server = Bun.listen<ClientState>({
      hostname: this.config.host,
      port: this.config.port,
      socket: {
        open(socket: Socket<ClientState>) {
          self.clientCount++
          socket.data = {
            parser: new RESPParser(),
            authenticated: !self.config.password, // Auto-auth if no password
          }
        },

        async data(socket: Socket<ClientState>, data: Buffer) {
          const state = socket.data
          if (!state) {
            console.error('[Redis Protocol] Socket data is undefined')
            return
          }
          state.parser.feed(data.toString())

          while (true) {
            const command = state.parser.parse()
            if (!command) break

            const response = await self.handleCommand(command, state)
            socket.write(response)
          }
        },

        close(_socket: Socket<ClientState>) {
          self.clientCount--
        },

        error(_socket: Socket<ClientState>, error: Error) {
          console.error('[Redis Protocol] Socket error:', error)
        },
      },
    })

    console.log(
      `[Redis Protocol] Server listening on ${this.config.host}:${this.config.port}`,
    )
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.server) {
      this.server.stop()
      this.server = null
    }
  }

  /**
   * Handle a Redis command
   */
  private async handleCommand(
    args: string[],
    state: ClientState,
  ): Promise<string> {
    if (args.length === 0) {
      return encodeRESP('ERR empty command')
    }

    const cmd = args[0].toUpperCase()
    const cmdArgs = args.slice(1)

    // Special handling for PING (inline command)
    if (cmd === 'PING') {
      return encodePONG()
    }

    // Check authentication
    if (!state.authenticated && cmd !== 'AUTH') {
      return encodeRESP('NOAUTH Authentication required')
    }

    // Handle AUTH
    if (cmd === 'AUTH') {
      if (this.config.password && cmdArgs[0] !== this.config.password) {
        return encodeRESP('ERR invalid password')
      }
      state.authenticated = true
      return encodeOK()
    }

    const handler = COMMANDS[cmd]
    if (!handler) {
      return encodeRESP(`ERR unknown command '${cmd}'`)
    }

    try {
      const result = await handler(this.engine, this.config.namespace, cmdArgs)

      if (result === 'OK') {
        return encodeOK()
      }

      return encodeRESP(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return encodeRESP(`ERR ${message}`)
    }
  }

  /**
   * Get the port the server is listening on
   */
  getPort(): number {
    return this.config.port
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clientCount
  }
}

/**
 * Create a Redis protocol server
 */
export function createRedisProtocolServer(
  engine: CacheEngine,
  config: RedisProtocolConfig,
): RedisProtocolServer {
  return new RedisProtocolServer(engine, config)
}

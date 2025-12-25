/**
 * Cache Engine
 *
 * Core in-memory cache with:
 * - LRU eviction
 * - TTL expiration
 * - Namespace isolation
 * - Memory limits
 * - Redis-compatible data structures (strings, hashes, lists, sets)
 */

import {
  type CacheConfig,
  CacheError,
  CacheErrorCode,
  type CacheEvent,
  type CacheEventListener,
  CacheEventType,
  type CacheNamespaceStats,
  type CacheScanOptions,
  type CacheScanResult,
  type CacheSetOptions,
  type CacheStats,
  type HashEntry,
  type SortedSetMember,
  type StreamEntry,
} from './types'

// Internal storage types

interface StorageEntry {
  data: Uint8Array
  type: 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream'
  createdAt: number
  expiresAt: number
  accessCount: number
  lastAccessedAt: number
}

interface NamespaceData {
  entries: Map<string, StorageEntry>
  usedBytes: number
  hits: number
  misses: number
}

// LRU Node for eviction tracking

interface LRUNode {
  key: string
  namespace: string
  prev: LRUNode | null
  next: LRUNode | null
}

/**
 * High-performance cache engine with namespace isolation
 */
export class CacheEngine {
  private namespaces: Map<string, NamespaceData> = new Map()
  private config: CacheConfig
  private listeners: Set<CacheEventListener> = new Set()

  // LRU tracking
  private lruHead: LRUNode | null = null
  private lruTail: LRUNode | null = null
  private lruNodes: Map<string, LRUNode> = new Map()

  // Global stats
  private totalHits = 0
  private totalMisses = 0
  private totalEvictions = 0
  private totalExpiredKeys = 0
  private startTime = Date.now()

  // TTL cleanup interval
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxMemoryMb: config.maxMemoryMb ?? 256,
      defaultTtlSeconds: config.defaultTtlSeconds ?? 3600,
      maxTtlSeconds: config.maxTtlSeconds ?? 86400 * 30, // 30 days
      evictionPolicy: 'lru', // Only LRU is implemented
      teeProvider: config.teeProvider,
      teeEndpoint: config.teeEndpoint,
    }

    // Start TTL cleanup every 10 seconds
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 10000)
  }

  /**
   * Stop the cache engine
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  get(namespace: string, key: string): string | null {
    const entry = this.getEntry(namespace, key)
    if (!entry || entry.type !== 'string') {
      this.recordMiss(namespace)
      return null
    }

    this.recordHit(namespace)
    this.updateLRU(namespace, key)
    return this.decodeString(entry.data)
  }

  set(
    namespace: string,
    key: string,
    value: string,
    options: CacheSetOptions = {},
  ): boolean {
    const ns = this.getOrCreateNamespace(namespace)
    const existing = ns.entries.get(key)

    // Handle NX (not exists) and XX (exists) flags
    if (options.nx && existing) return false
    if (options.xx && !existing) return false

    const data = this.encodeString(value)
    const ttl = options.ttl ?? this.config.defaultTtlSeconds

    if (ttl > this.config.maxTtlSeconds) {
      throw new CacheError(
        CacheErrorCode.TTL_EXCEEDED,
        `TTL ${ttl} exceeds maximum ${this.config.maxTtlSeconds}`,
      )
    }

    const now = Date.now()
    const entry: StorageEntry = {
      data,
      type: 'string',
      createdAt: now,
      expiresAt: now + ttl * 1000,
      accessCount: 0,
      lastAccessedAt: now,
    }

    // Update memory usage
    const oldSize = existing?.data.length ?? 0
    const newSize = data.length
    ns.usedBytes = ns.usedBytes - oldSize + newSize

    // Check memory limit and evict if needed
    this.ensureMemoryLimit()

    ns.entries.set(key, entry)
    this.updateLRU(namespace, key)
    this.emit({
      type: CacheEventType.KEY_SET,
      timestamp: now,
      namespace,
      key,
    })

    return true
  }

  setnx(namespace: string, key: string, value: string, ttl?: number): boolean {
    return this.set(namespace, key, value, { nx: true, ttl })
  }

  setex(namespace: string, key: string, seconds: number, value: string): void {
    this.set(namespace, key, value, { ttl: seconds })
  }

  getdel(namespace: string, key: string): string | null {
    const value = this.get(namespace, key)
    if (value !== null) {
      this.del(namespace, key)
    }
    return value
  }

  del(namespace: string, ...keys: string[]): number {
    const ns = this.namespaces.get(namespace)
    if (!ns) return 0

    let deleted = 0
    for (const key of keys) {
      const entry = ns.entries.get(key)
      if (entry) {
        ns.usedBytes -= entry.data.length
        ns.entries.delete(key)
        this.removeLRU(namespace, key)
        deleted++

        this.emit({
          type: CacheEventType.KEY_DELETE,
          timestamp: Date.now(),
          namespace,
          key,
        })
      }
    }

    return deleted
  }

  exists(namespace: string, ...keys: string[]): number {
    const ns = this.namespaces.get(namespace)
    if (!ns) return 0

    let count = 0
    for (const key of keys) {
      const entry = ns.entries.get(key)
      if (entry && !this.isExpired(entry)) {
        count++
      }
    }
    return count
  }

  incr(namespace: string, key: string, by = 1): number {
    const value = this.get(namespace, key)
    const num = value ? parseInt(value, 10) : 0
    if (Number.isNaN(num)) {
      throw new CacheError(
        CacheErrorCode.INVALID_OPERATION,
        'Value is not an integer',
      )
    }

    const newValue = num + by
    this.set(namespace, key, newValue.toString())
    return newValue
  }

  decr(namespace: string, key: string, by = 1): number {
    return this.incr(namespace, key, -by)
  }

  append(namespace: string, key: string, value: string): number {
    const existing = this.get(namespace, key) ?? ''
    const newValue = existing + value
    this.set(namespace, key, newValue)
    return newValue.length
  }

  expire(namespace: string, key: string, seconds: number): boolean {
    const entry = this.getEntry(namespace, key)
    if (!entry) return false

    entry.expiresAt = Date.now() + seconds * 1000
    return true
  }

  expireat(namespace: string, key: string, timestamp: number): boolean {
    const entry = this.getEntry(namespace, key)
    if (!entry) return false

    entry.expiresAt = timestamp * 1000
    return true
  }

  ttl(namespace: string, key: string): number {
    const entry = this.getEntry(namespace, key)
    if (!entry) return -2 // Key doesn't exist

    if (entry.expiresAt === Infinity) return -1 // No expiration

    const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000)
    return remaining > 0 ? remaining : -2
  }

  pttl(namespace: string, key: string): number {
    const entry = this.getEntry(namespace, key)
    if (!entry) return -2

    if (entry.expiresAt === Infinity) return -1

    const remaining = entry.expiresAt - Date.now()
    return remaining > 0 ? remaining : -2
  }

  persist(namespace: string, key: string): boolean {
    const entry = this.getEntry(namespace, key)
    if (!entry) return false

    entry.expiresAt = Infinity
    return true
  }

  hget(namespace: string, key: string, field: string): string | null {
    const hash = this.getHash(namespace, key)
    if (!hash) return null
    return hash[field] ?? null
  }

  hset(namespace: string, key: string, field: string, value: string): number {
    const ns = this.getOrCreateNamespace(namespace)
    let entry = ns.entries.get(key)
    let hash: HashEntry

    if (!entry) {
      hash = {}
      entry = this.createEntry('hash', this.encodeHash(hash))
      ns.entries.set(key, entry)
      this.updateLRU(namespace, key)
    } else if (entry.type !== 'hash') {
      throw new CacheError(
        CacheErrorCode.INVALID_OPERATION,
        'Key is not a hash',
      )
    } else {
      hash = this.decodeHash(entry.data)
    }

    const isNew = !(field in hash)
    hash[field] = value

    const oldSize = entry.data.length
    entry.data = this.encodeHash(hash)
    entry.lastAccessedAt = Date.now()
    ns.usedBytes = ns.usedBytes - oldSize + entry.data.length

    this.ensureMemoryLimit()

    return isNew ? 1 : 0
  }

  hmset(
    namespace: string,
    key: string,
    fields: Record<string, string>,
  ): boolean {
    for (const [field, value] of Object.entries(fields)) {
      this.hset(namespace, key, field, value)
    }
    return true
  }

  hmget(
    namespace: string,
    key: string,
    ...fields: string[]
  ): (string | null)[] {
    const hash = this.getHash(namespace, key)
    if (!hash) return fields.map(() => null)
    return fields.map((f) => hash[f] ?? null)
  }

  hgetall(namespace: string, key: string): HashEntry {
    return this.getHash(namespace, key) ?? {}
  }

  hdel(namespace: string, key: string, ...fields: string[]): number {
    const hash = this.getHash(namespace, key)
    if (!hash) return 0

    let deleted = 0
    for (const field of fields) {
      if (field in hash) {
        delete hash[field]
        deleted++
      }
    }

    if (deleted > 0) {
      const ns = this.namespaces.get(namespace)
      const entry = ns?.entries.get(key)
      if (entry) {
        const oldSize = entry.data.length
        entry.data = this.encodeHash(hash)
        if (ns) {
          ns.usedBytes = ns.usedBytes - oldSize + entry.data.length
        }
      }
    }

    return deleted
  }

  hexists(namespace: string, key: string, field: string): boolean {
    const hash = this.getHash(namespace, key)
    return hash ? field in hash : false
  }

  hlen(namespace: string, key: string): number {
    const hash = this.getHash(namespace, key)
    return hash ? Object.keys(hash).length : 0
  }

  hkeys(namespace: string, key: string): string[] {
    const hash = this.getHash(namespace, key)
    return hash ? Object.keys(hash) : []
  }

  hvals(namespace: string, key: string): string[] {
    const hash = this.getHash(namespace, key)
    return hash ? Object.values(hash) : []
  }

  hincrby(namespace: string, key: string, field: string, by: number): number {
    const current = this.hget(namespace, key, field)
    const num = current ? parseInt(current, 10) : 0
    if (Number.isNaN(num)) {
      throw new CacheError(
        CacheErrorCode.INVALID_OPERATION,
        'Hash field is not an integer',
      )
    }

    const newValue = num + by
    this.hset(namespace, key, field, newValue.toString())
    return newValue
  }

  lpush(namespace: string, key: string, ...values: string[]): number {
    const list = this.getOrCreateList(namespace, key)
    list.unshift(...values.reverse())
    this.updateList(namespace, key, list)
    return list.length
  }

  rpush(namespace: string, key: string, ...values: string[]): number {
    const list = this.getOrCreateList(namespace, key)
    list.push(...values)
    this.updateList(namespace, key, list)
    return list.length
  }

  lpop(namespace: string, key: string): string | null {
    const list = this.getList(namespace, key)
    if (!list || list.length === 0) return null

    const value = list.shift() as string
    this.updateList(namespace, key, list)
    return value
  }

  rpop(namespace: string, key: string): string | null {
    const list = this.getList(namespace, key)
    if (!list || list.length === 0) return null

    const value = list.pop() as string
    this.updateList(namespace, key, list)
    return value
  }

  lrange(
    namespace: string,
    key: string,
    start: number,
    stop: number,
  ): string[] {
    const list = this.getList(namespace, key)
    if (!list) return []

    const len = list.length
    const normalizedStart = start < 0 ? Math.max(len + start, 0) : start
    const normalizedStop = stop < 0 ? len + stop + 1 : stop + 1

    return list.slice(normalizedStart, normalizedStop)
  }

  llen(namespace: string, key: string): number {
    const list = this.getList(namespace, key)
    return list?.length ?? 0
  }

  lindex(namespace: string, key: string, index: number): string | null {
    const list = this.getList(namespace, key)
    if (!list) return null

    const idx = index < 0 ? list.length + index : index
    return list[idx] ?? null
  }

  lset(namespace: string, key: string, index: number, value: string): boolean {
    const list = this.getList(namespace, key)
    if (!list) return false

    const idx = index < 0 ? list.length + index : index
    if (idx < 0 || idx >= list.length) return false

    list[idx] = value
    this.updateList(namespace, key, list)
    return true
  }

  ltrim(namespace: string, key: string, start: number, stop: number): boolean {
    const list = this.getList(namespace, key)
    if (!list) return true

    const len = list.length
    const normalizedStart = start < 0 ? Math.max(len + start, 0) : start
    const normalizedStop = stop < 0 ? len + stop + 1 : stop + 1

    const trimmed = list.slice(normalizedStart, normalizedStop)
    this.updateList(namespace, key, trimmed)
    return true
  }

  sadd(namespace: string, key: string, ...members: string[]): number {
    const set = this.getOrCreateSet(namespace, key)
    let added = 0

    for (const member of members) {
      if (!set.has(member)) {
        set.add(member)
        added++
      }
    }

    this.updateSet(namespace, key, set)
    return added
  }

  srem(namespace: string, key: string, ...members: string[]): number {
    const set = this.getSet(namespace, key)
    if (!set) return 0

    let removed = 0
    for (const member of members) {
      if (set.delete(member)) {
        removed++
      }
    }

    this.updateSet(namespace, key, set)
    return removed
  }

  smembers(namespace: string, key: string): string[] {
    const set = this.getSet(namespace, key)
    return set ? Array.from(set) : []
  }

  sismember(namespace: string, key: string, member: string): boolean {
    const set = this.getSet(namespace, key)
    return set?.has(member) ?? false
  }

  scard(namespace: string, key: string): number {
    const set = this.getSet(namespace, key)
    return set?.size ?? 0
  }

  spop(namespace: string, key: string): string | null {
    const set = this.getSet(namespace, key)
    if (!set || set.size === 0) return null

    const members = Array.from(set)
    const idx = Math.floor(Math.random() * members.length)
    const member = members[idx]
    set.delete(member)

    this.updateSet(namespace, key, set)
    return member
  }

  srandmember(namespace: string, key: string): string | null {
    const set = this.getSet(namespace, key)
    if (!set || set.size === 0) return null

    const members = Array.from(set)
    const idx = Math.floor(Math.random() * members.length)
    return members[idx]
  }

  zadd(namespace: string, key: string, ...members: SortedSetMember[]): number {
    const zset = this.getOrCreateZSet(namespace, key)
    let added = 0

    for (const { member, score } of members) {
      const existing = zset.find((m) => m.member === member)
      if (existing) {
        existing.score = score
      } else {
        zset.push({ member, score })
        added++
      }
    }

    // Sort by score
    zset.sort((a, b) => a.score - b.score)
    this.updateZSet(namespace, key, zset)
    return added
  }

  zrange(
    namespace: string,
    key: string,
    start: number,
    stop: number,
    withScores = false,
  ): string[] | SortedSetMember[] {
    const zset = this.getZSet(namespace, key)
    if (!zset) return []

    const len = zset.length
    const normalizedStart = start < 0 ? Math.max(len + start, 0) : start
    const normalizedStop = stop < 0 ? len + stop + 1 : stop + 1

    const slice = zset.slice(normalizedStart, normalizedStop)
    return withScores ? slice : slice.map((m) => m.member)
  }

  zrangebyscore(
    namespace: string,
    key: string,
    min: number,
    max: number,
    withScores = false,
  ): string[] | SortedSetMember[] {
    const zset = this.getZSet(namespace, key)
    if (!zset) return []

    const filtered = zset.filter((m) => m.score >= min && m.score <= max)
    return withScores ? filtered : filtered.map((m) => m.member)
  }

  zscore(namespace: string, key: string, member: string): number | null {
    const zset = this.getZSet(namespace, key)
    if (!zset) return null

    const found = zset.find((m) => m.member === member)
    return found?.score ?? null
  }

  zcard(namespace: string, key: string): number {
    const zset = this.getZSet(namespace, key)
    return zset?.length ?? 0
  }

  zrem(namespace: string, key: string, ...members: string[]): number {
    const zset = this.getZSet(namespace, key)
    if (!zset) return 0

    const memberSet = new Set(members)
    const filtered = zset.filter((m) => !memberSet.has(m.member))
    const removed = zset.length - filtered.length

    if (removed > 0) {
      this.updateZSet(namespace, key, filtered)
    }

    return removed
  }

  xadd(namespace: string, key: string, fields: Record<string, string>): string {
    const stream = this.getOrCreateStream(namespace, key)
    const id = `${Date.now()}-${stream.length}`
    stream.push({ id, fields })

    // Keep only last 10000 entries
    if (stream.length > 10000) {
      stream.splice(0, stream.length - 10000)
    }

    this.updateStream(namespace, key, stream)
    return id
  }

  xlen(namespace: string, key: string): number {
    const stream = this.getStream(namespace, key)
    return stream?.length ?? 0
  }

  xrange(
    namespace: string,
    key: string,
    start: string,
    end: string,
    count?: number,
  ): StreamEntry[] {
    const stream = this.getStream(namespace, key)
    if (!stream) return []

    let filtered = stream.filter((e) => {
      if (start !== '-' && e.id < start) return false
      if (end !== '+' && e.id > end) return false
      return true
    })

    if (count) {
      filtered = filtered.slice(0, count)
    }

    return filtered
  }

  keys(namespace: string, pattern = '*'): string[] {
    const ns = this.namespaces.get(namespace)
    if (!ns) return []

    const regex = this.patternToRegex(pattern)
    const keys: string[] = []

    for (const [key, entry] of ns.entries) {
      if (!this.isExpired(entry) && regex.test(key)) {
        keys.push(key)
      }
    }

    return keys
  }

  scan(namespace: string, options: CacheScanOptions = {}): CacheScanResult {
    const ns = this.namespaces.get(namespace)
    if (!ns) return { cursor: '0', keys: [], done: true }

    const pattern = options.pattern ?? '*'
    const count = options.count ?? 10
    const cursor = parseInt(options.cursor ?? '0', 10)
    const regex = this.patternToRegex(pattern)

    const allKeys: string[] = []
    for (const [key, entry] of ns.entries) {
      if (!this.isExpired(entry) && regex.test(key)) {
        allKeys.push(key)
      }
    }

    const start = cursor
    const end = Math.min(start + count, allKeys.length)
    const keys = allKeys.slice(start, end)
    const done = end >= allKeys.length

    return {
      cursor: done ? '0' : end.toString(),
      keys,
      done,
    }
  }

  type(namespace: string, key: string): string {
    const entry = this.getEntry(namespace, key)
    return entry?.type ?? 'none'
  }

  rename(namespace: string, oldKey: string, newKey: string): boolean {
    const ns = this.namespaces.get(namespace)
    if (!ns) return false

    const entry = ns.entries.get(oldKey)
    if (!entry) return false

    ns.entries.delete(oldKey)
    ns.entries.set(newKey, entry)
    this.removeLRU(namespace, oldKey)
    this.updateLRU(namespace, newKey)

    return true
  }

  flushdb(namespace: string): void {
    const ns = this.namespaces.get(namespace)
    if (ns) {
      for (const key of ns.entries.keys()) {
        this.removeLRU(namespace, key)
      }
      ns.entries.clear()
      ns.usedBytes = 0
      ns.hits = 0
      ns.misses = 0
    }
  }

  flushall(): void {
    for (const namespace of this.namespaces.keys()) {
      this.flushdb(namespace)
    }
    this.namespaces.clear()
  }

  getStats(): CacheStats {
    let totalKeys = 0
    let usedMemory = 0
    let oldestKeyAge = 0
    const now = Date.now()

    for (const ns of this.namespaces.values()) {
      for (const entry of ns.entries.values()) {
        if (!this.isExpired(entry)) {
          totalKeys++
          usedMemory += entry.data.length
          const age = now - entry.createdAt
          if (age > oldestKeyAge) oldestKeyAge = age
        }
      }
    }

    const totalRequests = this.totalHits + this.totalMisses
    const avgKeySize = totalKeys > 0 ? usedMemory / totalKeys : 0

    return {
      totalKeys,
      usedMemoryBytes: usedMemory,
      maxMemoryBytes: this.config.maxMemoryMb * 1024 * 1024,
      hits: this.totalHits,
      misses: this.totalMisses,
      hitRate: totalRequests > 0 ? this.totalHits / totalRequests : 0,
      evictions: this.totalEvictions,
      expiredKeys: this.totalExpiredKeys,
      avgKeySize,
      avgValueSize: avgKeySize,
      oldestKeyAge,
      namespaces: this.namespaces.size,
      uptime: Date.now() - this.startTime,
    }
  }

  /**
   * Get namespace stats
   */
  getNamespaceStats(namespace: string): CacheNamespaceStats | null {
    const ns = this.namespaces.get(namespace)
    if (!ns) return null

    let keyCount = 0
    for (const entry of ns.entries.values()) {
      if (!this.isExpired(entry)) keyCount++
    }

    const totalRequests = ns.hits + ns.misses

    return {
      namespace,
      keyCount,
      usedMemoryBytes: ns.usedBytes,
      hits: ns.hits,
      misses: ns.misses,
      hitRate: totalRequests > 0 ? ns.hits / totalRequests : 0,
    }
  }

  /**
   * Get all namespace stats
   */
  getAllNamespaceStats(): CacheNamespaceStats[] {
    const stats: CacheNamespaceStats[] = []
    for (const namespace of this.namespaces.keys()) {
      const s = this.getNamespaceStats(namespace)
      if (s) stats.push(s)
    }
    return stats
  }

  on(listener: CacheEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: CacheEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private getOrCreateNamespace(namespace: string): NamespaceData {
    let ns = this.namespaces.get(namespace)
    if (!ns) {
      ns = {
        entries: new Map(),
        usedBytes: 0,
        hits: 0,
        misses: 0,
      }
      this.namespaces.set(namespace, ns)
    }
    return ns
  }

  private getEntry(namespace: string, key: string): StorageEntry | null {
    const ns = this.namespaces.get(namespace)
    if (!ns) return null

    const entry = ns.entries.get(key)
    if (!entry) return null

    if (this.isExpired(entry)) {
      ns.entries.delete(key)
      ns.usedBytes -= entry.data.length
      this.removeLRU(namespace, key)
      this.totalExpiredKeys++
      this.emit({
        type: CacheEventType.KEY_EXPIRE,
        timestamp: Date.now(),
        namespace,
        key,
      })
      return null
    }

    entry.accessCount++
    entry.lastAccessedAt = Date.now()
    return entry
  }

  private isExpired(entry: StorageEntry): boolean {
    return entry.expiresAt < Date.now()
  }

  private recordHit(namespace: string): void {
    this.totalHits++
    const ns = this.namespaces.get(namespace)
    if (ns) ns.hits++
  }

  private recordMiss(namespace: string): void {
    this.totalMisses++
    const ns = this.namespaces.get(namespace)
    if (ns) ns.misses++
  }

  // Encoding/Decoding helpers

  private encodeString(value: string): Uint8Array {
    return new TextEncoder().encode(value)
  }

  private decodeString(data: Uint8Array): string {
    return new TextDecoder().decode(data)
  }

  private encodeHash(hash: HashEntry): Uint8Array {
    return this.encodeString(JSON.stringify(hash))
  }

  private decodeHash(data: Uint8Array): HashEntry {
    return JSON.parse(this.decodeString(data)) as HashEntry
  }

  private encodeList(list: string[]): Uint8Array {
    return this.encodeString(JSON.stringify(list))
  }

  private decodeList(data: Uint8Array): string[] {
    return JSON.parse(this.decodeString(data)) as string[]
  }

  private encodeSet(set: Set<string>): Uint8Array {
    return this.encodeString(JSON.stringify(Array.from(set)))
  }

  private decodeSet(data: Uint8Array): Set<string> {
    return new Set(JSON.parse(this.decodeString(data)) as string[])
  }

  private encodeZSet(zset: SortedSetMember[]): Uint8Array {
    return this.encodeString(JSON.stringify(zset))
  }

  private decodeZSet(data: Uint8Array): SortedSetMember[] {
    return JSON.parse(this.decodeString(data)) as SortedSetMember[]
  }

  private encodeStream(stream: StreamEntry[]): Uint8Array {
    return this.encodeString(JSON.stringify(stream))
  }

  private decodeStream(data: Uint8Array): StreamEntry[] {
    return JSON.parse(this.decodeString(data)) as StreamEntry[]
  }

  private createEntry(
    type: StorageEntry['type'],
    data: Uint8Array,
  ): StorageEntry {
    const now = Date.now()
    return {
      data,
      type,
      createdAt: now,
      expiresAt: now + this.config.defaultTtlSeconds * 1000,
      accessCount: 0,
      lastAccessedAt: now,
    }
  }

  // Data structure helpers

  private getHash(namespace: string, key: string): HashEntry | null {
    const entry = this.getEntry(namespace, key)
    if (!entry || entry.type !== 'hash') return null
    this.recordHit(namespace)
    this.updateLRU(namespace, key)
    return this.decodeHash(entry.data)
  }

  private getList(namespace: string, key: string): string[] | null {
    const entry = this.getEntry(namespace, key)
    if (!entry || entry.type !== 'list') return null
    this.recordHit(namespace)
    this.updateLRU(namespace, key)
    return this.decodeList(entry.data)
  }

  private getOrCreateList(namespace: string, key: string): string[] {
    const entry = this.getEntry(namespace, key)
    if (entry) {
      if (entry.type !== 'list') {
        throw new CacheError(
          CacheErrorCode.INVALID_OPERATION,
          'Key is not a list',
        )
      }
      return this.decodeList(entry.data)
    }
    return []
  }

  private updateList(namespace: string, key: string, list: string[]): void {
    const ns = this.getOrCreateNamespace(namespace)
    const entry = ns.entries.get(key)
    const data = this.encodeList(list)

    if (entry) {
      const oldSize = entry.data.length
      entry.data = data
      entry.lastAccessedAt = Date.now()
      ns.usedBytes = ns.usedBytes - oldSize + data.length
    } else {
      const newEntry = this.createEntry('list', data)
      ns.entries.set(key, newEntry)
      ns.usedBytes += data.length
    }

    this.updateLRU(namespace, key)
    this.ensureMemoryLimit()
  }

  private getSet(namespace: string, key: string): Set<string> | null {
    const entry = this.getEntry(namespace, key)
    if (!entry || entry.type !== 'set') return null
    this.recordHit(namespace)
    this.updateLRU(namespace, key)
    return this.decodeSet(entry.data)
  }

  private getOrCreateSet(namespace: string, key: string): Set<string> {
    const entry = this.getEntry(namespace, key)
    if (entry) {
      if (entry.type !== 'set') {
        throw new CacheError(
          CacheErrorCode.INVALID_OPERATION,
          'Key is not a set',
        )
      }
      return this.decodeSet(entry.data)
    }
    return new Set()
  }

  private updateSet(namespace: string, key: string, set: Set<string>): void {
    const ns = this.getOrCreateNamespace(namespace)
    const entry = ns.entries.get(key)
    const data = this.encodeSet(set)

    if (entry) {
      const oldSize = entry.data.length
      entry.data = data
      entry.lastAccessedAt = Date.now()
      ns.usedBytes = ns.usedBytes - oldSize + data.length
    } else {
      const newEntry = this.createEntry('set', data)
      ns.entries.set(key, newEntry)
      ns.usedBytes += data.length
    }

    this.updateLRU(namespace, key)
    this.ensureMemoryLimit()
  }

  private getZSet(namespace: string, key: string): SortedSetMember[] | null {
    const entry = this.getEntry(namespace, key)
    if (!entry || entry.type !== 'zset') return null
    this.recordHit(namespace)
    this.updateLRU(namespace, key)
    return this.decodeZSet(entry.data)
  }

  private getOrCreateZSet(namespace: string, key: string): SortedSetMember[] {
    const entry = this.getEntry(namespace, key)
    if (entry) {
      if (entry.type !== 'zset') {
        throw new CacheError(
          CacheErrorCode.INVALID_OPERATION,
          'Key is not a sorted set',
        )
      }
      return this.decodeZSet(entry.data)
    }
    return []
  }

  private updateZSet(
    namespace: string,
    key: string,
    zset: SortedSetMember[],
  ): void {
    const ns = this.getOrCreateNamespace(namespace)
    const entry = ns.entries.get(key)
    const data = this.encodeZSet(zset)

    if (entry) {
      const oldSize = entry.data.length
      entry.data = data
      entry.lastAccessedAt = Date.now()
      ns.usedBytes = ns.usedBytes - oldSize + data.length
    } else {
      const newEntry = this.createEntry('zset', data)
      ns.entries.set(key, newEntry)
      ns.usedBytes += data.length
    }

    this.updateLRU(namespace, key)
    this.ensureMemoryLimit()
  }

  private getStream(namespace: string, key: string): StreamEntry[] | null {
    const entry = this.getEntry(namespace, key)
    if (!entry || entry.type !== 'stream') return null
    this.recordHit(namespace)
    this.updateLRU(namespace, key)
    return this.decodeStream(entry.data)
  }

  private getOrCreateStream(namespace: string, key: string): StreamEntry[] {
    const entry = this.getEntry(namespace, key)
    if (entry) {
      if (entry.type !== 'stream') {
        throw new CacheError(
          CacheErrorCode.INVALID_OPERATION,
          'Key is not a stream',
        )
      }
      return this.decodeStream(entry.data)
    }
    return []
  }

  private updateStream(
    namespace: string,
    key: string,
    stream: StreamEntry[],
  ): void {
    const ns = this.getOrCreateNamespace(namespace)
    const entry = ns.entries.get(key)
    const data = this.encodeStream(stream)

    if (entry) {
      const oldSize = entry.data.length
      entry.data = data
      entry.lastAccessedAt = Date.now()
      ns.usedBytes = ns.usedBytes - oldSize + data.length
    } else {
      const newEntry = this.createEntry('stream', data)
      ns.entries.set(key, newEntry)
      ns.usedBytes += data.length
    }

    this.updateLRU(namespace, key)
    this.ensureMemoryLimit()
  }

  // LRU Management

  private getLRUKey(namespace: string, key: string): string {
    return `${namespace}:${key}`
  }

  private updateLRU(namespace: string, key: string): void {
    const lruKey = this.getLRUKey(namespace, key)
    let node = this.lruNodes.get(lruKey)

    if (node) {
      // Move to tail (most recently used)
      this.removeNodeFromList(node)
    } else {
      node = { key, namespace, prev: null, next: null }
      this.lruNodes.set(lruKey, node)
    }

    this.addToTail(node)
  }

  private removeLRU(namespace: string, key: string): void {
    const lruKey = this.getLRUKey(namespace, key)
    const node = this.lruNodes.get(lruKey)
    if (node) {
      this.removeNodeFromList(node)
      this.lruNodes.delete(lruKey)
    }
  }

  private addToTail(node: LRUNode): void {
    node.prev = this.lruTail
    node.next = null

    if (this.lruTail) {
      this.lruTail.next = node
    }
    this.lruTail = node

    if (!this.lruHead) {
      this.lruHead = node
    }
  }

  private removeNodeFromList(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      this.lruHead = node.next
    }

    if (node.next) {
      node.next.prev = node.prev
    } else {
      this.lruTail = node.prev
    }
  }

  private evictLRU(): boolean {
    if (!this.lruHead) return false

    const node = this.lruHead
    const ns = this.namespaces.get(node.namespace)
    if (!ns) {
      this.removeNodeFromList(node)
      this.lruNodes.delete(this.getLRUKey(node.namespace, node.key))
      return true
    }

    const entry = ns.entries.get(node.key)
    if (entry) {
      ns.usedBytes -= entry.data.length
      ns.entries.delete(node.key)
      this.totalEvictions++

      this.emit({
        type: CacheEventType.KEY_EVICT,
        timestamp: Date.now(),
        namespace: node.namespace,
        key: node.key,
      })
    }

    this.removeNodeFromList(node)
    this.lruNodes.delete(this.getLRUKey(node.namespace, node.key))
    return true
  }

  private ensureMemoryLimit(): void {
    const maxBytes = this.config.maxMemoryMb * 1024 * 1024

    let totalBytes = 0
    for (const ns of this.namespaces.values()) {
      totalBytes += ns.usedBytes
    }

    while (totalBytes > maxBytes && this.evictLRU()) {
      totalBytes = 0
      for (const ns of this.namespaces.values()) {
        totalBytes += ns.usedBytes
      }
    }
  }

  // TTL cleanup

  private cleanupExpired(): void {
    const now = Date.now()

    for (const [namespace, ns] of this.namespaces) {
      const expiredKeys: string[] = []

      for (const [key, entry] of ns.entries) {
        if (entry.expiresAt < now) {
          expiredKeys.push(key)
        }
      }

      for (const key of expiredKeys) {
        const entry = ns.entries.get(key)
        if (entry) {
          ns.usedBytes -= entry.data.length
          ns.entries.delete(key)
          this.removeLRU(namespace, key)
          this.totalExpiredKeys++

          this.emit({
            type: CacheEventType.KEY_EXPIRE,
            timestamp: now,
            namespace,
            key,
          })
        }
      }
    }
  }

  // Pattern matching

  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    return new RegExp(`^${escaped}$`)
  }
}

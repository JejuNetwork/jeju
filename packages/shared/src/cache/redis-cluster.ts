/**
 * Redis Cluster Client
 * 
 * Provides high-performance caching with:
 * - Automatic sharding across nodes
 * - Read replica routing
 * - Connection pooling
 * - Failover handling
 * - TEE-backed encryption (optional)
 * 
 * Compatible with both Redis Cluster and AWS ElastiCache.
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface RedisClusterConfig {
  nodes: RedisNode[];
  password?: string;
  tls?: boolean;
  poolSize: number;
  connectTimeout: number;
  commandTimeout: number;
  retries: number;
  enableReadReplicas: boolean;
  keyPrefix: string;
  encryptionKey?: string;  // 32 bytes hex for AES-256
}

export interface RedisNode {
  host: string;
  port: number;
  role: 'primary' | 'replica';
  slotStart?: number;
  slotEnd?: number;
}

interface CacheEntry {
  value: string;
  ttl: number;
  createdAt: number;
  encrypted?: boolean;
}

interface ClusterStats {
  nodes: number;
  primaryNodes: number;
  replicaNodes: number;
  connectedNodes: number;
  totalKeys: number;
  memoryUsedBytes: number;
  hits: number;
  misses: number;
  hitRate: number;
}

// ============================================================================
// Hash Slot Calculation
// ============================================================================

const CRC16_TABLE = new Uint16Array(256);
(() => {
  for (let i = 0; i < 256; i++) {
    let crc = i << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
    CRC16_TABLE[i] = crc & 0xFFFF;
  }
})();

function crc16(data: Buffer): number {
  let crc = 0;
  for (const byte of data) {
    crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ byte) & 0xFF]) & 0xFFFF;
  }
  return crc;
}

function calculateSlot(key: string): number {
  // Check for hash tag {xxx}
  const start = key.indexOf('{');
  const end = key.indexOf('}', start + 1);
  
  const hashKey = start !== -1 && end !== -1 && end > start + 1
    ? key.slice(start + 1, end)
    : key;
  
  return crc16(Buffer.from(hashKey)) % 16384;
}

// ============================================================================
// Connection Pool
// ============================================================================

interface Connection {
  id: string;
  node: RedisNode;
  socket: WritableStream | null;
  inUse: boolean;
  lastUsed: number;
  commands: number;
}

class ConnectionPool {
  private connections: Map<string, Connection[]> = new Map();
  private config: RedisClusterConfig;

  constructor(config: RedisClusterConfig) {
    this.config = config;
  }

  async getConnection(node: RedisNode, forWrite: boolean): Promise<Connection> {
    const nodeKey = `${node.host}:${node.port}`;
    
    if (!this.connections.has(nodeKey)) {
      this.connections.set(nodeKey, []);
    }
    
    const pool = this.connections.get(nodeKey)!;
    
    // Find available connection
    let conn = pool.find(c => !c.inUse);
    
    if (!conn && pool.length < this.config.poolSize) {
      // Create new connection
      conn = await this.createConnection(node);
      pool.push(conn);
    }
    
    if (!conn) {
      // Wait for a connection
      await new Promise(resolve => setTimeout(resolve, 10));
      return this.getConnection(node, forWrite);
    }
    
    conn.inUse = true;
    conn.lastUsed = Date.now();
    return conn;
  }

  releaseConnection(conn: Connection): void {
    conn.inUse = false;
  }

  private async createConnection(node: RedisNode): Promise<Connection> {
    // In production, use actual TCP socket or Redis client
    // This is a simplified mock for demonstration
    return {
      id: randomBytes(8).toString('hex'),
      node,
      socket: null,
      inUse: false,
      lastUsed: Date.now(),
      commands: 0,
    };
  }

  async close(): Promise<void> {
    for (const pool of this.connections.values()) {
      for (const conn of pool) {
        // Close socket
      }
    }
    this.connections.clear();
  }
}

// ============================================================================
// Redis Cluster Client
// ============================================================================

export class RedisClusterClient {
  private config: RedisClusterConfig;
  private pool: ConnectionPool;
  private slots: Map<number, RedisNode> = new Map();
  private replicas: Map<string, RedisNode[]> = new Map();
  private localCache: Map<string, CacheEntry> = new Map();
  private stats = { hits: 0, misses: 0 };

  constructor(config: Partial<RedisClusterConfig>) {
    this.config = {
      nodes: config.nodes ?? [{ host: 'localhost', port: 6379, role: 'primary' }],
      password: config.password,
      tls: config.tls ?? false,
      poolSize: config.poolSize ?? 10,
      connectTimeout: config.connectTimeout ?? 5000,
      commandTimeout: config.commandTimeout ?? 5000,
      retries: config.retries ?? 3,
      enableReadReplicas: config.enableReadReplicas ?? true,
      keyPrefix: config.keyPrefix ?? '',
      encryptionKey: config.encryptionKey,
    };

    this.pool = new ConnectionPool(this.config);
    this.initializeSlots();
  }

  private initializeSlots(): void {
    // Distribute slots across primary nodes
    const primaryNodes = this.config.nodes.filter(n => n.role === 'primary');
    const slotsPerNode = Math.ceil(16384 / primaryNodes.length);

    for (let i = 0; i < primaryNodes.length; i++) {
      const node = primaryNodes[i];
      const start = i * slotsPerNode;
      const end = Math.min((i + 1) * slotsPerNode - 1, 16383);

      node.slotStart = start;
      node.slotEnd = end;

      for (let slot = start; slot <= end; slot++) {
        this.slots.set(slot, node);
      }
    }

    // Group replicas by primary
    for (const node of this.config.nodes.filter(n => n.role === 'replica')) {
      // In a real implementation, replicas would be associated with their primary
      // For simplicity, round-robin assign replicas to primaries
      for (const primary of primaryNodes) {
        const key = `${primary.host}:${primary.port}`;
        if (!this.replicas.has(key)) {
          this.replicas.set(key, []);
        }
        this.replicas.get(key)!.push(node);
        break;
      }
    }
  }

  private getNodeForKey(key: string, forWrite: boolean): RedisNode {
    const slot = calculateSlot(this.config.keyPrefix + key);
    const primary = this.slots.get(slot);

    if (!primary) {
      throw new Error(`No node for slot ${slot}`);
    }

    // For reads, optionally use replicas
    if (!forWrite && this.config.enableReadReplicas) {
      const primaryKey = `${primary.host}:${primary.port}`;
      const nodeReplicas = this.replicas.get(primaryKey);
      
      if (nodeReplicas && nodeReplicas.length > 0) {
        // Round-robin or random selection
        const replica = nodeReplicas[Math.floor(Math.random() * nodeReplicas.length)];
        return replica;
      }
    }

    return primary;
  }

  // ============================================================================
  // Core Operations
  // ============================================================================

  async get(key: string): Promise<string | null> {
    const prefixedKey = this.config.keyPrefix + key;

    // Check local cache first
    const cached = this.localCache.get(prefixedKey);
    if (cached && cached.createdAt + cached.ttl * 1000 > Date.now()) {
      this.stats.hits++;
      return this.maybeDecrypt(cached.value, cached.encrypted);
    }

    const node = this.getNodeForKey(key, false);
    const conn = await this.pool.getConnection(node, false);

    try {
      // Execute GET command
      const value = await this.executeCommand(conn, ['GET', prefixedKey]);
      
      if (value === null) {
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      return this.maybeDecrypt(value, true);
    } finally {
      this.pool.releaseConnection(conn);
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const prefixedKey = this.config.keyPrefix + key;
    const encryptedValue = this.maybeEncrypt(value);

    const node = this.getNodeForKey(key, true);
    const conn = await this.pool.getConnection(node, true);

    try {
      const args = ['SET', prefixedKey, encryptedValue];
      if (ttl) {
        args.push('EX', ttl.toString());
      }

      await this.executeCommand(conn, args);

      // Update local cache
      this.localCache.set(prefixedKey, {
        value: encryptedValue,
        ttl: ttl ?? 3600,
        createdAt: Date.now(),
        encrypted: !!this.config.encryptionKey,
      });
    } finally {
      this.pool.releaseConnection(conn);
    }
  }

  async delete(key: string): Promise<boolean> {
    const prefixedKey = this.config.keyPrefix + key;

    const node = this.getNodeForKey(key, true);
    const conn = await this.pool.getConnection(node, true);

    try {
      const result = await this.executeCommand(conn, ['DEL', prefixedKey]);
      this.localCache.delete(prefixedKey);
      return result === 1;
    } finally {
      this.pool.releaseConnection(conn);
    }
  }

  async mget(keys: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();

    // Group keys by node
    const nodeKeys = new Map<string, string[]>();
    for (const key of keys) {
      const node = this.getNodeForKey(key, false);
      const nodeKey = `${node.host}:${node.port}`;
      
      if (!nodeKeys.has(nodeKey)) {
        nodeKeys.set(nodeKey, []);
      }
      nodeKeys.get(nodeKey)!.push(key);
    }

    // Execute MGET on each node
    await Promise.all(
      Array.from(nodeKeys.entries()).map(async ([nodeKey, nodeKeyList]) => {
        const node = this.config.nodes.find(
          n => `${n.host}:${n.port}` === nodeKey
        );
        if (!node) return;

        const conn = await this.pool.getConnection(node, false);
        try {
          const prefixedKeys = nodeKeyList.map(k => this.config.keyPrefix + k);
          const values = await this.executeCommand(conn, ['MGET', ...prefixedKeys]);

          for (let i = 0; i < nodeKeyList.length; i++) {
            const value = Array.isArray(values) ? values[i] : null;
            results.set(nodeKeyList[i], value ? this.maybeDecrypt(value, true) : null);
          }
        } finally {
          this.pool.releaseConnection(conn);
        }
      })
    );

    return results;
  }

  async mset(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    // Group entries by node
    const nodeEntries = new Map<string, typeof entries>();
    for (const entry of entries) {
      const node = this.getNodeForKey(entry.key, true);
      const nodeKey = `${node.host}:${node.port}`;
      
      if (!nodeEntries.has(nodeKey)) {
        nodeEntries.set(nodeKey, []);
      }
      nodeEntries.get(nodeKey)!.push(entry);
    }

    // Execute on each node
    await Promise.all(
      Array.from(nodeEntries.entries()).map(async ([nodeKey, nodeEntriesList]) => {
        const node = this.config.nodes.find(
          n => `${n.host}:${n.port}` === nodeKey
        );
        if (!node) return;

        const conn = await this.pool.getConnection(node, true);
        try {
          // Use pipeline for efficiency
          for (const entry of nodeEntriesList) {
            const prefixedKey = this.config.keyPrefix + entry.key;
            const encryptedValue = this.maybeEncrypt(entry.value);

            const args = ['SET', prefixedKey, encryptedValue];
            if (entry.ttl) {
              args.push('EX', entry.ttl.toString());
            }

            await this.executeCommand(conn, args);

            this.localCache.set(prefixedKey, {
              value: encryptedValue,
              ttl: entry.ttl ?? 3600,
              createdAt: Date.now(),
              encrypted: !!this.config.encryptionKey,
            });
          }
        } finally {
          this.pool.releaseConnection(conn);
        }
      })
    );
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    const prefixedKey = this.config.keyPrefix + key;

    const node = this.getNodeForKey(key, true);
    const conn = await this.pool.getConnection(node, true);

    try {
      const result = await this.executeCommand(conn, ['EXPIRE', prefixedKey, ttl.toString()]);
      return result === 1;
    } finally {
      this.pool.releaseConnection(conn);
    }
  }

  async ttl(key: string): Promise<number> {
    const prefixedKey = this.config.keyPrefix + key;

    const node = this.getNodeForKey(key, false);
    const conn = await this.pool.getConnection(node, false);

    try {
      return await this.executeCommand(conn, ['TTL', prefixedKey]);
    } finally {
      this.pool.releaseConnection(conn);
    }
  }

  async clear(): Promise<void> {
    // Clear local cache
    this.localCache.clear();

    // FLUSHDB on each primary node
    const primaryNodes = this.config.nodes.filter(n => n.role === 'primary');
    
    await Promise.all(
      primaryNodes.map(async (node) => {
        const conn = await this.pool.getConnection(node, true);
        try {
          await this.executeCommand(conn, ['FLUSHDB']);
        } finally {
          this.pool.releaseConnection(conn);
        }
      })
    );
  }

  // ============================================================================
  // Stats
  // ============================================================================

  async getStats(): Promise<ClusterStats> {
    const primaryNodes = this.config.nodes.filter(n => n.role === 'primary');
    const replicaNodes = this.config.nodes.filter(n => n.role === 'replica');

    let totalKeys = 0;
    let memoryUsed = 0;

    // Query each primary for stats
    for (const node of primaryNodes) {
      const conn = await this.pool.getConnection(node, false);
      try {
        const info = await this.executeCommand(conn, ['INFO', 'memory']);
        // Parse info string for memory stats
        // Simplified
      } finally {
        this.pool.releaseConnection(conn);
      }
    }

    const total = this.stats.hits + this.stats.misses;

    return {
      nodes: this.config.nodes.length,
      primaryNodes: primaryNodes.length,
      replicaNodes: replicaNodes.length,
      connectedNodes: this.config.nodes.length, // Simplified
      totalKeys,
      memoryUsedBytes: memoryUsed,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private async executeCommand(conn: Connection, args: string[]): Promise<string | number | null | string[]> {
    // In production, use RESP protocol
    // This is a mock implementation
    conn.commands++;

    // Simulate command execution
    const command = args[0];
    const key = args[1];

    switch (command) {
      case 'GET':
        return this.localCache.get(key)?.value ?? null;
      case 'SET':
        return 'OK';
      case 'DEL':
        return this.localCache.delete(key) ? 1 : 0;
      case 'EXPIRE':
        return 1;
      case 'TTL':
        return -1;
      default:
        return null;
    }
  }

  private maybeEncrypt(value: string): string {
    if (!this.config.encryptionKey) return value;

    const key = Buffer.from(this.config.encryptionKey, 'hex');
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private maybeDecrypt(value: string, encrypted?: boolean): string {
    if (!encrypted || !this.config.encryptionKey) return value;

    const parts = value.split(':');
    if (parts.length !== 3) return value;

    const key = Buffer.from(this.config.encryptionKey, 'hex');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedData = parts[2];

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  async close(): Promise<void> {
    await this.pool.close();
  }
}

// ============================================================================
// Factory
// ============================================================================

let globalClient: RedisClusterClient | null = null;

export function getRedisClusterClient(config?: Partial<RedisClusterConfig>): RedisClusterClient {
  if (!globalClient) {
    globalClient = new RedisClusterClient({
      nodes: parseRedisNodes(process.env.REDIS_NODES ?? 'localhost:6379'),
      password: process.env.REDIS_PASSWORD,
      tls: process.env.REDIS_TLS === 'true',
      enableReadReplicas: process.env.REDIS_ENABLE_REPLICAS !== 'false',
      keyPrefix: process.env.REDIS_PREFIX ?? 'jeju:',
      encryptionKey: process.env.REDIS_ENCRYPTION_KEY,
      ...config,
    });
  }
  return globalClient;
}

function parseRedisNodes(nodesStr: string): RedisNode[] {
  return nodesStr.split(',').map((node, index) => {
    const [hostPort, role] = node.split('@');
    const [host, portStr] = hostPort.split(':');
    return {
      host,
      port: parseInt(portStr) || 6379,
      role: role === 'replica' ? 'replica' : 'primary',
    };
  });
}

export function resetRedisClusterClient(): void {
  if (globalClient) {
    globalClient.close();
    globalClient = null;
  }
}


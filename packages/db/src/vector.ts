/**
 * Vector utilities for sqlite-vec integration
 *
 * sqlite-vec stores vectors as compact binary BLOBs.
 * This module provides serialization/deserialization utilities.
 *
 * @see https://alexgarcia.xyz/sqlite-vec/
 */

import type {
  VectorIndexConfig,
  VectorSearchRequest,
  VectorSearchResult,
  VectorType,
} from './types.js'

// Vector Serialization

/**
 * Serialize a float32 vector to binary BLOB format for sqlite-vec
 *
 * @example
 * ```typescript
 * const blob = serializeFloat32Vector([0.1, 0.2, 0.3, 0.4])
 * await cql.exec('INSERT INTO vectors(embedding) VALUES (?)', [blob])
 * ```
 */
export function serializeFloat32Vector(vector: number[]): Uint8Array {
  const buffer = new ArrayBuffer(vector.length * 4)
  const view = new DataView(buffer)
  for (let i = 0; i < vector.length; i++) {
    view.setFloat32(i * 4, vector[i] ?? 0, true) // little-endian
  }
  return new Uint8Array(buffer)
}

/**
 * Deserialize a binary BLOB to float32 vector
 */
export function deserializeFloat32Vector(blob: Uint8Array): number[] {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  const vector: number[] = []
  for (let i = 0; i < blob.length / 4; i++) {
    vector.push(view.getFloat32(i * 4, true))
  }
  return vector
}

/**
 * Serialize an int8 quantized vector to binary BLOB format
 */
export function serializeInt8Vector(vector: number[]): Uint8Array {
  const buffer = new Int8Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    buffer[i] = Math.max(-128, Math.min(127, Math.round(vector[i] ?? 0)))
  }
  return new Uint8Array(buffer.buffer)
}

/**
 * Deserialize a binary BLOB to int8 vector
 */
export function deserializeInt8Vector(blob: Uint8Array): number[] {
  const view = new Int8Array(blob.buffer, blob.byteOffset, blob.byteLength)
  return Array.from(view)
}

/**
 * Serialize a bit vector (for binary embeddings)
 * Each element should be 0 or 1
 */
export function serializeBitVector(vector: number[]): Uint8Array {
  const byteLength = Math.ceil(vector.length / 8)
  const buffer = new Uint8Array(byteLength)
  for (let i = 0; i < vector.length; i++) {
    if (vector[i]) {
      const byteIndex = Math.floor(i / 8)
      buffer[byteIndex] = (buffer[byteIndex] ?? 0) | (1 << (i % 8))
    }
  }
  return buffer
}

/**
 * Deserialize a binary BLOB to bit vector
 */
export function deserializeBitVector(
  blob: Uint8Array,
  dimensions: number,
): number[] {
  const vector: number[] = []
  for (let i = 0; i < dimensions; i++) {
    const byte = blob[Math.floor(i / 8)] ?? 0
    vector.push((byte >> (i % 8)) & 1)
  }
  return vector
}

/**
 * Serialize a vector based on type
 */
export function serializeVector(
  vector: number[],
  type: VectorType = 'float32',
): Uint8Array {
  switch (type) {
    case 'float32':
      return serializeFloat32Vector(vector)
    case 'int8':
      return serializeInt8Vector(vector)
    case 'bit':
      return serializeBitVector(vector)
  }
}

// SQL Generation

/**
 * Generate CREATE VIRTUAL TABLE SQL for a vec0 vector index
 *
 * @example
 * ```typescript
 * const sql = generateCreateVectorTableSQL({
 *   tableName: 'embeddings',
 *   dimensions: 384,
 *   metadataColumns: [
 *     { name: 'title', type: 'TEXT' },
 *     { name: 'created_at', type: 'INTEGER' }
 *   ]
 * })
 * // CREATE VIRTUAL TABLE embeddings USING vec0(
 * //   embedding float[384],
 * //   +title TEXT,
 * //   +created_at INTEGER
 * // )
 * ```
 */
export function generateCreateVectorTableSQL(
  config: VectorIndexConfig,
): string {
  const vectorType = config.vectorType ?? 'float32'
  const typeStr = vectorType === 'float32' ? 'float' : vectorType

  const columns: string[] = [`embedding ${typeStr}[${config.dimensions}]`]

  // Add metadata columns (prefixed with + for vec0)
  if (config.metadataColumns) {
    for (const col of config.metadataColumns) {
      columns.push(`+${col.name} ${col.type}`)
    }
  }

  // Add partition key if specified
  if (config.partitionKey) {
    columns.push(`${config.partitionKey}`)
  }

  return `CREATE VIRTUAL TABLE IF NOT EXISTS ${config.tableName} USING vec0(\n  ${columns.join(',\n  ')}\n)`
}

/**
 * Generate INSERT SQL for a vector
 */
export function generateVectorInsertSQL(
  tableName: string,
  hasRowid: boolean,
  metadataColumns: string[] = [],
  partitionKey?: string,
): string {
  const columns: string[] = []
  const placeholders: string[] = []

  if (hasRowid) {
    columns.push('rowid')
    placeholders.push('?')
  }

  columns.push('embedding')
  placeholders.push('?')

  for (const col of metadataColumns) {
    columns.push(col)
    placeholders.push('?')
  }

  if (partitionKey) {
    columns.push(partitionKey)
    placeholders.push('?')
  }

  return `INSERT INTO ${tableName}(${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
}

/**
 * Generate KNN search SQL for vector similarity search
 *
 * @example
 * ```typescript
 * const sql = generateVectorSearchSQL({
 *   tableName: 'embeddings',
 *   vector: queryVec,
 *   k: 10,
 *   includeMetadata: true
 * })
 * // SELECT v.rowid, v.distance, e.title, e.created_at
 * // FROM embeddings AS e
 * // JOIN vec0_search(embeddings, 'embedding', ?, 10) AS v
 * //   ON e.rowid = v.rowid
 * // ORDER BY v.distance
 * ```
 */
export function generateVectorSearchSQL(
  request: Omit<VectorSearchRequest, 'vector'>,
  metadataColumns: string[] = [],
): string {
  const { tableName, k, partitionValue, metadataFilter, includeMetadata } =
    request

  // Build SELECT columns
  const selectCols = ['v.rowid', 'v.distance']
  if (includeMetadata && metadataColumns.length > 0) {
    for (const col of metadataColumns) {
      selectCols.push(`e.${col}`)
    }
  }

  // Build the query
  // sqlite-vec uses the MATCH syntax for KNN search
  let sql = `SELECT ${selectCols.join(', ')}
FROM ${tableName} AS e
WHERE e.embedding MATCH ?
  AND k = ${k}`

  // Add partition filter
  if (partitionValue !== undefined) {
    sql += `\n  AND e.${request.partitionValue} = ?`
  }

  // Add metadata filter
  if (metadataFilter) {
    sql += `\n  AND ${metadataFilter}`
  }

  sql += '\nORDER BY distance'

  return sql
}

// Vector Math Utilities

/**
 * Normalize a vector to unit length (for cosine similarity)
 */
export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  if (magnitude === 0) return vector
  return vector.map((v) => v / magnitude)
}

/**
 * Calculate L2 (Euclidean) distance between two vectors
 */
export function l2Distance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Calculate cosine distance between two vectors
 * Returns 1 - cosine_similarity (0 = identical, 2 = opposite)
 */
export function cosineDistance(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    dotProduct += ai * bi
    normA += ai * ai
    normB += bi * bi
  }

  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  return 1 - similarity
}

/**
 * Calculate L1 (Manhattan) distance between two vectors
 */
export function l1Distance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0))
  }
  return sum
}

// Result Parsing

/**
 * Parse vector search results from raw query output
 */
export function parseVectorSearchResults(
  rows: Array<Record<string, string | number | boolean | null>>,
  metadataColumns: string[] = [],
): VectorSearchResult[] {
  return rows.map((row) => {
    const rowid = row.rowid
    const distance = row.distance
    if (typeof rowid !== 'number') {
      throw new Error(`Expected rowid to be number, got ${typeof rowid}`)
    }
    if (typeof distance !== 'number') {
      throw new Error(`Expected distance to be number, got ${typeof distance}`)
    }

    const result: VectorSearchResult = {
      rowid,
      distance,
    }

    if (metadataColumns.length > 0) {
      result.metadata = {}
      for (const col of metadataColumns) {
        const value = row[col]
        result.metadata[col] = value ?? null
      }
    }

    return result
  })
}

// Validation

/**
 * Validate vector dimensions
 */
export function validateVectorDimensions(
  vector: number[],
  expected: number,
): void {
  if (vector.length !== expected) {
    throw new Error(
      `Vector dimension mismatch: expected ${expected}, got ${vector.length}`,
    )
  }
}

/**
 * Validate vector values are finite numbers
 */
export function validateVectorValues(vector: number[]): void {
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) {
      throw new Error(`Invalid vector value at index ${i}: ${vector[i]}`)
    }
  }
}

/**
 * Integration tests for sqlite-vec vector search
 * These tests verify the end-to-end vector functionality
 */

import { describe, expect, it } from 'bun:test'
import {
  cosineDistance,
  deserializeFloat32Vector,
  generateCreateVectorTableSQL,
  generateVectorInsertSQL,
  l2Distance,
  normalizeVector,
  serializeFloat32Vector,
  serializeVector,
} from './vector.js'

describe('Vector Integration', () => {
  describe('End-to-end vector serialization', () => {
    it('should handle realistic embedding dimensions (384)', () => {
      // Generate a realistic 384-dimension embedding
      const embedding = Array.from({ length: 384 }, () => Math.random() * 2 - 1)

      const blob = serializeFloat32Vector(embedding)
      const restored = deserializeFloat32Vector(blob)

      expect(blob.length).toBe(384 * 4) // 1536 bytes
      expect(restored.length).toBe(384)

      // Check precision is maintained
      for (let i = 0; i < 10; i++) {
        expect(Math.abs(restored[i] - embedding[i])).toBeLessThan(0.0001)
      }
    })

    it('should handle OpenAI text-embedding-3-small dimensions (1536)', () => {
      const embedding = Array.from(
        { length: 1536 },
        () => Math.random() * 2 - 1,
      )

      const blob = serializeFloat32Vector(embedding)
      const restored = deserializeFloat32Vector(blob)

      expect(blob.length).toBe(1536 * 4) // 6144 bytes
      expect(restored.length).toBe(1536)
    })

    it('should handle normalized embeddings correctly', () => {
      const embedding = [0.5, 0.3, -0.2, 0.7, -0.1]
      const normalized = normalizeVector(embedding)

      // Check magnitude is 1
      const magnitude = Math.sqrt(normalized.reduce((sum, v) => sum + v * v, 0))
      expect(magnitude).toBeCloseTo(1.0, 5)

      // Serialize and verify
      const blob = serializeFloat32Vector(normalized)
      const restored = deserializeFloat32Vector(blob)

      for (let i = 0; i < normalized.length; i++) {
        expect(Math.abs(restored[i] - normalized[i])).toBeLessThan(0.0001)
      }
    })
  })

  describe('Distance calculations match expected behavior', () => {
    it('should compute L2 distance correctly for unit vectors', () => {
      const a = normalizeVector([1, 0, 0])
      const b = normalizeVector([0, 1, 0])

      // Orthogonal unit vectors should have L2 distance of sqrt(2)
      expect(l2Distance(a, b)).toBeCloseTo(Math.sqrt(2), 5)
    })

    it('should compute cosine distance correctly', () => {
      const a = [1, 2, 3]
      const b = [1, 2, 3]

      // Identical vectors should have cosine distance of 0
      expect(cosineDistance(a, b)).toBeCloseTo(0, 5)

      // Opposite vectors should have cosine distance of 2
      const c = [-1, -2, -3]
      expect(cosineDistance(a, c)).toBeCloseTo(2, 5)
    })

    it('should handle high-dimensional distance calculations', () => {
      const dim = 384
      const a = Array.from({ length: dim }, () => Math.random())
      const b = Array.from({ length: dim }, () => Math.random())

      const dist = l2Distance(a, b)
      expect(dist).toBeGreaterThan(0)
      expect(Number.isFinite(dist)).toBe(true)
    })
  })

  describe('SQL generation for vec0 tables', () => {
    it('should generate correct CREATE TABLE for memory embeddings', () => {
      const sql = generateCreateVectorTableSQL({
        tableName: 'memory_embeddings',
        dimensions: 1536,
        metadataColumns: [
          { name: 'memory_id', type: 'TEXT' },
          { name: 'room_id', type: 'TEXT' },
          { name: 'entity_id', type: 'TEXT' },
        ],
      })

      expect(sql).toContain(
        'CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0',
      )
      expect(sql).toContain('embedding float[1536]')
      expect(sql).toContain('+memory_id TEXT')
      expect(sql).toContain('+room_id TEXT')
      expect(sql).toContain('+entity_id TEXT')
    })

    it('should generate correct INSERT SQL', () => {
      const sql = generateVectorInsertSQL('memory_embeddings', false, [
        'memory_id',
        'room_id',
        'entity_id',
      ])

      expect(sql).toBe(
        'INSERT INTO memory_embeddings(embedding, memory_id, room_id, entity_id) VALUES (?, ?, ?, ?)',
      )
    })
  })

  describe('Vector type serialization', () => {
    it('should correctly serialize float32 vectors', () => {
      const vec = [1.0, -1.0, 0.5, -0.5]
      const blob = serializeVector(vec, 'float32')

      expect(blob.length).toBe(16) // 4 floats * 4 bytes

      const restored = deserializeFloat32Vector(blob)
      expect(restored).toEqual(vec.map((v) => expect.closeTo(v, 5)))
    })

    it('should correctly serialize int8 vectors', () => {
      const vec = [100, -100, 50, -50, 127, -128]
      const blob = serializeVector(vec, 'int8')

      expect(blob.length).toBe(6) // 6 bytes
    })

    it('should correctly serialize bit vectors', () => {
      const vec = [1, 0, 1, 1, 0, 0, 0, 1] // 8 bits = 1 byte
      const blob = serializeVector(vec, 'bit')

      expect(blob.length).toBe(1)
    })
  })

  describe('Similarity search scenarios', () => {
    it('should find most similar vector in a set', () => {
      // Create a query vector
      const query = normalizeVector([1, 2, 3, 4, 5])

      // Create candidate vectors
      const candidates = [
        normalizeVector([1, 2, 3, 4, 5]), // Identical
        normalizeVector([5, 4, 3, 2, 1]), // Reversed
        normalizeVector([1, 1, 1, 1, 1]), // All ones
        normalizeVector([-1, -2, -3, -4, -5]), // Opposite
      ]

      // Calculate distances
      const distances = candidates.map((c) => cosineDistance(query, c))

      // The first one (identical) should have distance closest to 0
      expect(distances[0]).toBeCloseTo(0, 5)

      // The last one (opposite) should have distance closest to 2
      expect(distances[3]).toBeCloseTo(2, 5)

      // Find the index of minimum distance
      const minIndex = distances.indexOf(Math.min(...distances))
      expect(minIndex).toBe(0)
    })

    it('should handle batch of embeddings', () => {
      const batchSize = 100
      const dimensions = 384

      // Generate batch of embeddings
      const embeddings = Array.from({ length: batchSize }, () =>
        normalizeVector(
          Array.from({ length: dimensions }, () => Math.random() * 2 - 1),
        ),
      )

      // Serialize all
      const blobs = embeddings.map((e) => serializeFloat32Vector(e))

      // Verify all serialized correctly
      expect(blobs.length).toBe(batchSize)
      blobs.forEach((blob) => {
        expect(blob.length).toBe(dimensions * 4)
      })

      // Deserialize and verify
      const restored = blobs.map((b) => deserializeFloat32Vector(b))
      restored.forEach((r, i) => {
        expect(r.length).toBe(dimensions)
        // Spot check first element
        expect(Math.abs(r[0] - embeddings[i][0])).toBeLessThan(0.0001)
      })
    })
  })
})

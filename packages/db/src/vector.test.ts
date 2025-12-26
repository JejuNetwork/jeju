/**
 * Tests for vector utilities (sqlite-vec integration)
 */

import { describe, expect, it } from 'bun:test'
import {
  cosineDistance,
  deserializeBitVector,
  deserializeFloat32Vector,
  deserializeInt8Vector,
  generateCreateVectorTableSQL,
  generateVectorInsertSQL,
  generateVectorSearchSQL,
  l1Distance,
  l2Distance,
  normalizeVector,
  parseVectorSearchResults,
  serializeBitVector,
  serializeFloat32Vector,
  serializeInt8Vector,
  serializeVector,
  validateVectorDimensions,
  validateVectorValues,
} from './vector.js'

describe('Vector Serialization', () => {
  describe('float32', () => {
    it('should serialize and deserialize float32 vectors', () => {
      const vector = [1.0, 2.5, -Math.PI, 0.0, 100.001]
      const blob = serializeFloat32Vector(vector)
      const result = deserializeFloat32Vector(blob)

      expect(blob.length).toBe(vector.length * 4) // 4 bytes per float32
      expect(result.length).toBe(vector.length)

      // Check values are approximately equal (float32 has limited precision)
      for (let i = 0; i < vector.length; i++) {
        expect(Math.abs(result[i] - vector[i])).toBeLessThan(0.0001)
      }
    })

    it('should handle empty vector', () => {
      const vector: number[] = []
      const blob = serializeFloat32Vector(vector)
      const result = deserializeFloat32Vector(blob)

      expect(blob.length).toBe(0)
      expect(result.length).toBe(0)
    })

    it('should handle large vectors', () => {
      const vector = Array.from(
        { length: 1536 },
        (_, _i) => Math.random() * 2 - 1,
      )
      const blob = serializeFloat32Vector(vector)
      const result = deserializeFloat32Vector(blob)

      expect(blob.length).toBe(1536 * 4)
      expect(result.length).toBe(1536)
    })
  })

  describe('int8', () => {
    it('should serialize and deserialize int8 vectors', () => {
      const vector = [1, 50, -100, 0, 127, -128]
      const blob = serializeInt8Vector(vector)
      const result = deserializeInt8Vector(blob)

      expect(blob.length).toBe(vector.length)
      expect(result).toEqual(vector)
    })

    it('should clamp out-of-range values', () => {
      const vector = [200, -200, 127, -128]
      const blob = serializeInt8Vector(vector)
      const result = deserializeInt8Vector(blob)

      expect(result[0]).toBe(127) // clamped from 200
      expect(result[1]).toBe(-128) // clamped from -200
      expect(result[2]).toBe(127)
      expect(result[3]).toBe(-128)
    })

    it('should round float values', () => {
      const vector = [1.7, -2.3, 50.5]
      const blob = serializeInt8Vector(vector)
      const result = deserializeInt8Vector(blob)

      expect(result[0]).toBe(2)
      expect(result[1]).toBe(-2)
      expect(result[2]).toBe(51) // 50.5 rounds up
    })
  })

  describe('bit', () => {
    it('should serialize and deserialize bit vectors', () => {
      const vector = [1, 0, 1, 1, 0, 0, 0, 1, 1, 0]
      const blob = serializeBitVector(vector)
      const result = deserializeBitVector(blob, vector.length)

      expect(blob.length).toBe(2) // 10 bits = 2 bytes
      expect(result).toEqual(vector)
    })

    it('should handle 8-bit aligned vectors', () => {
      const vector = [1, 1, 1, 1, 0, 0, 0, 0]
      const blob = serializeBitVector(vector)
      const result = deserializeBitVector(blob, vector.length)

      expect(blob.length).toBe(1)
      expect(result).toEqual(vector)
    })

    it('should handle large bit vectors', () => {
      const vector = Array.from({ length: 128 }, () =>
        Math.round(Math.random()),
      )
      const blob = serializeBitVector(vector)
      const result = deserializeBitVector(blob, vector.length)

      expect(blob.length).toBe(16)
      expect(result).toEqual(vector)
    })
  })

  describe('serializeVector', () => {
    it('should default to float32', () => {
      const vector = [1.0, 2.0, 3.0]
      const blob = serializeVector(vector)

      expect(blob.length).toBe(12) // 3 * 4 bytes
    })

    it('should handle explicit type', () => {
      const vector = [1, 2, 3]
      const blobInt8 = serializeVector(vector, 'int8')
      const blobFloat32 = serializeVector(vector, 'float32')

      expect(blobInt8.length).toBe(3)
      expect(blobFloat32.length).toBe(12)
    })
  })
})

describe('SQL Generation', () => {
  describe('generateCreateVectorTableSQL', () => {
    it('should create basic vec0 table', () => {
      const sql = generateCreateVectorTableSQL({
        tableName: 'embeddings',
        dimensions: 384,
      })

      expect(sql).toContain(
        'CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0',
      )
      expect(sql).toContain('embedding float[384]')
    })

    it('should include metadata columns', () => {
      const sql = generateCreateVectorTableSQL({
        tableName: 'embeddings',
        dimensions: 384,
        metadataColumns: [
          { name: 'title', type: 'TEXT' },
          { name: 'created_at', type: 'INTEGER' },
        ],
      })

      expect(sql).toContain('+title TEXT')
      expect(sql).toContain('+created_at INTEGER')
    })

    it('should handle int8 vector type', () => {
      const sql = generateCreateVectorTableSQL({
        tableName: 'quantized_embeddings',
        dimensions: 512,
        vectorType: 'int8',
      })

      expect(sql).toContain('embedding int8[512]')
    })

    it('should handle partition key', () => {
      const sql = generateCreateVectorTableSQL({
        tableName: 'embeddings',
        dimensions: 384,
        partitionKey: 'user_id',
      })

      expect(sql).toContain('user_id')
    })
  })

  describe('generateVectorInsertSQL', () => {
    it('should generate basic insert', () => {
      const sql = generateVectorInsertSQL('embeddings', false)

      expect(sql).toBe('INSERT INTO embeddings(embedding) VALUES (?)')
    })

    it('should include rowid when specified', () => {
      const sql = generateVectorInsertSQL('embeddings', true)

      expect(sql).toBe('INSERT INTO embeddings(rowid, embedding) VALUES (?, ?)')
    })

    it('should include metadata columns', () => {
      const sql = generateVectorInsertSQL('embeddings', false, [
        'title',
        'source',
      ])

      expect(sql).toBe(
        'INSERT INTO embeddings(embedding, title, source) VALUES (?, ?, ?)',
      )
    })

    it('should include partition key', () => {
      const sql = generateVectorInsertSQL(
        'embeddings',
        false,
        ['title'],
        'user_id',
      )

      expect(sql).toBe(
        'INSERT INTO embeddings(embedding, title, user_id) VALUES (?, ?, ?)',
      )
    })
  })
})

describe('Vector Math', () => {
  describe('normalizeVector', () => {
    it('should normalize to unit length', () => {
      const vector = [3, 4] // length = 5
      const normalized = normalizeVector(vector)

      expect(normalized[0]).toBeCloseTo(0.6)
      expect(normalized[1]).toBeCloseTo(0.8)

      const magnitude = Math.sqrt(normalized[0] ** 2 + normalized[1] ** 2)
      expect(magnitude).toBeCloseTo(1.0)
    })

    it('should handle zero vector', () => {
      const vector = [0, 0, 0]
      const normalized = normalizeVector(vector)

      expect(normalized).toEqual([0, 0, 0])
    })

    it('should handle already normalized vector', () => {
      const vector = [1, 0, 0]
      const normalized = normalizeVector(vector)

      expect(normalized[0]).toBeCloseTo(1.0)
      expect(normalized[1]).toBeCloseTo(0.0)
      expect(normalized[2]).toBeCloseTo(0.0)
    })
  })

  describe('l2Distance', () => {
    it('should calculate Euclidean distance', () => {
      const a = [0, 0]
      const b = [3, 4]

      expect(l2Distance(a, b)).toBe(5)
    })

    it('should return 0 for identical vectors', () => {
      const a = [1, 2, 3]
      const b = [1, 2, 3]

      expect(l2Distance(a, b)).toBe(0)
    })
  })

  describe('cosineDistance', () => {
    it('should return 0 for identical vectors', () => {
      const a = [1, 2, 3]
      const b = [1, 2, 3]

      expect(cosineDistance(a, b)).toBeCloseTo(0)
    })

    it('should return ~2 for opposite vectors', () => {
      const a = [1, 0]
      const b = [-1, 0]

      expect(cosineDistance(a, b)).toBeCloseTo(2)
    })

    it('should return ~1 for orthogonal vectors', () => {
      const a = [1, 0]
      const b = [0, 1]

      expect(cosineDistance(a, b)).toBeCloseTo(1)
    })
  })

  describe('l1Distance', () => {
    it('should calculate Manhattan distance', () => {
      const a = [0, 0]
      const b = [3, 4]

      expect(l1Distance(a, b)).toBe(7)
    })

    it('should return 0 for identical vectors', () => {
      const a = [1, 2, 3]
      const b = [1, 2, 3]

      expect(l1Distance(a, b)).toBe(0)
    })
  })
})

describe('Result Parsing', () => {
  describe('parseVectorSearchResults', () => {
    it('should parse basic results', () => {
      const rows = [
        { rowid: 1, distance: 0.1 },
        { rowid: 2, distance: 0.5 },
      ]

      const results = parseVectorSearchResults(rows)

      expect(results.length).toBe(2)
      expect(results[0].rowid).toBe(1)
      expect(results[0].distance).toBe(0.1)
      expect(results[0].metadata).toBeUndefined()
    })

    it('should include metadata columns', () => {
      const rows = [
        { rowid: 1, distance: 0.1, title: 'Doc 1', source: 'wiki' },
        { rowid: 2, distance: 0.5, title: 'Doc 2', source: 'news' },
      ]

      const results = parseVectorSearchResults(rows, ['title', 'source'])

      expect(results[0].metadata).toEqual({ title: 'Doc 1', source: 'wiki' })
      expect(results[1].metadata).toEqual({ title: 'Doc 2', source: 'news' })
    })

    it('should handle empty results', () => {
      const results = parseVectorSearchResults([])

      expect(results).toEqual([])
    })
  })
})

describe('Validation', () => {
  describe('validateVectorDimensions', () => {
    it('should pass for correct dimensions', () => {
      expect(() => validateVectorDimensions([1, 2, 3], 3)).not.toThrow()
    })

    it('should throw for incorrect dimensions', () => {
      expect(() => validateVectorDimensions([1, 2, 3], 5)).toThrow(
        'Vector dimension mismatch: expected 5, got 3',
      )
    })
  })

  describe('validateVectorValues', () => {
    it('should pass for valid values', () => {
      expect(() => validateVectorValues([1, 2.5, -3, 0])).not.toThrow()
    })

    it('should throw for NaN', () => {
      expect(() => validateVectorValues([1, NaN, 3])).toThrow(
        'Invalid vector value at index 1: NaN',
      )
    })

    it('should throw for Infinity', () => {
      expect(() => validateVectorValues([1, Infinity, 3])).toThrow(
        'Invalid vector value at index 1: Infinity',
      )
    })

    it('should throw for negative Infinity', () => {
      expect(() => validateVectorValues([1, -Infinity, 3])).toThrow(
        'Invalid vector value at index 1: -Infinity',
      )
    })
  })
})

describe('Edge Cases and Error Handling', () => {
  describe('deserializeBitVector validation', () => {
    it('should throw for undersized blob', () => {
      const smallBlob = new Uint8Array([0x01]) // 1 byte = 8 bits max
      expect(() => deserializeBitVector(smallBlob, 16)).toThrow(
        'Bit vector blob too small: got 1 bytes, need 2 for 16 dimensions',
      )
    })

    it('should work with correctly sized blob', () => {
      const blob = new Uint8Array([0xff, 0x00]) // 2 bytes for 16 bits
      const result = deserializeBitVector(blob, 16)
      expect(result.length).toBe(16)
      expect(result.slice(0, 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
      expect(result.slice(8, 16)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    })
  })

  describe('distance function dimension validation', () => {
    it('l2Distance should throw for mismatched dimensions', () => {
      expect(() => l2Distance([1, 2, 3], [1, 2])).toThrow(
        'Vector dimension mismatch: 3 vs 2',
      )
    })

    it('cosineDistance should throw for mismatched dimensions', () => {
      expect(() => cosineDistance([1, 2], [1, 2, 3])).toThrow(
        'Vector dimension mismatch: 2 vs 3',
      )
    })

    it('l1Distance should throw for mismatched dimensions', () => {
      expect(() => l1Distance([1], [1, 2, 3, 4])).toThrow(
        'Vector dimension mismatch: 1 vs 4',
      )
    })
  })

  describe('SQL injection prevention', () => {
    it('generateCreateVectorTableSQL should reject invalid table name', () => {
      expect(() =>
        generateCreateVectorTableSQL({
          tableName: 'users; DROP TABLE users--',
          dimensions: 384,
        }),
      ).toThrow('Invalid SQL table name')
    })

    it('generateCreateVectorTableSQL should reject invalid metadata column', () => {
      expect(() =>
        generateCreateVectorTableSQL({
          tableName: 'embeddings',
          dimensions: 384,
          metadataColumns: [{ name: 'valid', type: 'TEXT' }, { name: 'bad;column', type: 'TEXT' }],
        }),
      ).toThrow('Invalid SQL column name')
    })

    it('generateVectorInsertSQL should reject invalid table name', () => {
      expect(() =>
        generateVectorInsertSQL('DROP TABLE users', false),
      ).toThrow('Invalid SQL table name')
    })

    it('generateVectorInsertSQL should reject invalid column name', () => {
      expect(() =>
        generateVectorInsertSQL('embeddings', false, ['valid', 'in valid']),
      ).toThrow('Invalid SQL column name')
    })
  })
})

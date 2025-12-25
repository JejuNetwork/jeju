/**
 * Tool Validation Tests
 *
 * Tests for Zod-based tool argument validation utilities
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  createToolFromSchema,
  createValidator,
  safeParse,
  validateArgs,
  zodSchemaToMCPSchema,
} from '../utils/tool-args-validation'

describe('zodSchemaToMCPSchema', () => {
  it('should convert simple Zod schema to MCP schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    const mcpSchema = zodSchemaToMCPSchema(schema)

    expect(mcpSchema.type).toBe('object')
    expect(mcpSchema.properties).toBeDefined()
    expect(mcpSchema.properties.name).toBeDefined()
    expect(mcpSchema.properties.age).toBeDefined()
  })

  it('should include required fields', () => {
    const schema = z.object({
      required_field: z.string(),
      optional_field: z.string().optional(),
    })

    const mcpSchema = zodSchemaToMCPSchema(schema)

    expect(mcpSchema.required).toContain('required_field')
  })

  it('should handle nested objects', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        email: z.string(),
      }),
    })

    const mcpSchema = zodSchemaToMCPSchema(schema)

    expect(mcpSchema.properties.user).toBeDefined()
  })

  it('should handle arrays', () => {
    const schema = z.object({
      items: z.array(z.string()),
    })

    const mcpSchema = zodSchemaToMCPSchema(schema)

    expect(mcpSchema.properties.items).toBeDefined()
  })

  it('should handle enums', () => {
    const schema = z.object({
      status: z.enum(['pending', 'active', 'completed']),
    })

    const mcpSchema = zodSchemaToMCPSchema(schema)

    expect(mcpSchema.properties.status).toBeDefined()
  })
})

describe('createToolFromSchema', () => {
  it('should create MCP tool definition from schema', () => {
    const schema = z.object({
      message: z.string(),
    })

    const tool = createToolFromSchema('echo', 'Echo the message', schema)

    expect(tool.name).toBe('echo')
    expect(tool.description).toBe('Echo the message')
    expect(tool.inputSchema.type).toBe('object')
    expect(tool.inputSchema.properties.message).toBeDefined()
  })
})

describe('createValidator', () => {
  it('should create validator function from schema', () => {
    const schema = z.object({
      count: z.number().positive(),
    })

    const validator = createValidator(schema)

    const valid = validator({ count: 5 })
    expect(valid.count).toBe(5)
  })

  it('should throw on invalid input', () => {
    const schema = z.object({
      count: z.number().positive(),
    })

    const validator = createValidator(schema)

    expect(() => validator({ count: -1 })).toThrow()
  })

  it('should throw on missing required fields', () => {
    const schema = z.object({
      required: z.string(),
    })

    const validator = createValidator(schema)

    expect(() => validator({})).toThrow()
  })
})

describe('safeParse', () => {
  it('should return parsed data on valid input', () => {
    const schema = z.object({
      name: z.string(),
    })

    const result = safeParse(schema, { name: 'test' })

    expect(result).toEqual({ name: 'test' })
  })

  it('should return null on invalid input', () => {
    const schema = z.object({
      name: z.string(),
    })

    const result = safeParse(schema, { name: 123 })

    expect(result).toBeNull()
  })

  it('should return null on missing fields', () => {
    const schema = z.object({
      required: z.string(),
    })

    const result = safeParse(schema, {})

    expect(result).toBeNull()
  })
})

describe('validateArgs', () => {
  it('should return validated args on valid input', () => {
    const schema = z.object({
      value: z.number(),
    })

    const result = validateArgs(schema, { value: 42 })

    expect(result.value).toBe(42)
  })

  it('should throw with tool name in error message', () => {
    const schema = z.object({
      value: z.number(),
    })

    expect(() =>
      validateArgs(schema, { value: 'not-a-number' }, 'myTool'),
    ).toThrow(/\[myTool\]/)
  })

  it('should throw without tool name prefix when not provided', () => {
    const schema = z.object({
      value: z.number(),
    })

    expect(() => validateArgs(schema, { value: 'not-a-number' })).toThrow(
      /Invalid arguments/,
    )
  })

  it('should transform values according to schema', () => {
    const schema = z.object({
      timestamp: z.string().transform((s) => new Date(s)),
    })

    const result = validateArgs(schema, { timestamp: '2024-01-01' })

    expect(result.timestamp).toBeInstanceOf(Date)
  })

  it('should apply default values', () => {
    const schema = z.object({
      name: z.string().default('default-name'),
    })

    const result = validateArgs(schema, {})

    expect(result.name).toBe('default-name')
  })
})

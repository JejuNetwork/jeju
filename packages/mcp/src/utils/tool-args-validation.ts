/**
 * Zod-based tool argument validation utilities for MCP.
 */

import { toJSONSchema, type ZodObject, type ZodRawShape, type z } from 'zod'
import type {
  MCPTool,
  MCPToolInputSchemaProperty,
  StringRecord,
} from '../types/mcp'

/**
 * Convert Zod schema to MCP-compatible inputSchema using Zod's toJSONSchema
 *
 * @param schema - Zod object schema to convert
 * @returns MCP tool input schema
 */
export function zodSchemaToMCPSchema(
  schema: ZodObject<ZodRawShape>,
): MCPTool['inputSchema'] {
  const jsonSchema = toJSONSchema(schema)

  // Validate the expected schema structure
  if (
    typeof jsonSchema !== 'object' ||
    jsonSchema === null ||
    !('type' in jsonSchema) ||
    jsonSchema.type !== 'object' ||
    !('properties' in jsonSchema) ||
    typeof jsonSchema.properties !== 'object'
  ) {
    throw new Error('Invalid JSON schema output from Zod')
  }

  const properties = jsonSchema.properties as StringRecord<MCPToolInputSchemaProperty>
  const required =
    'required' in jsonSchema && Array.isArray(jsonSchema.required)
      ? (jsonSchema.required as string[])
      : undefined

  return {
    type: 'object',
    properties,
    required,
  }
}

/**
 * Create a tool definition from a Zod schema
 *
 * @param name - Tool name
 * @param description - Tool description
 * @param schema - Zod schema for arguments
 * @returns MCP tool definition
 */
export function createToolFromSchema<T extends ZodObject<ZodRawShape>>(
  name: string,
  description: string,
  schema: T,
): MCPTool {
  return {
    name,
    description,
    inputSchema: zodSchemaToMCPSchema(schema),
  }
}

/**
 * Create a validation function from a Zod schema
 *
 * @param schema - Zod schema to use for validation
 * @returns Validation function that throws on invalid input
 */
export function createValidator<T extends ZodObject<ZodRawShape>>(
  schema: T,
): (args: unknown) => z.infer<T> {
  return (args: unknown) => schema.parse(args)
}

/**
 * Safe parse with typed result
 *
 * @param schema - Zod schema to use for validation
 * @param args - Arguments to validate
 * @returns Parsed result or null if invalid
 */
export function safeParse<T extends ZodObject<ZodRawShape>>(
  schema: T,
  args: unknown,
): z.infer<T> | null {
  const result = schema.safeParse(args)
  return result.success ? result.data : null
}

/**
 * Validate arguments and return typed result or throw
 *
 * @param schema - Zod schema to use for validation
 * @param args - Arguments to validate
 * @param toolName - Optional tool name for error messages
 * @returns Validated and typed arguments
 */
export function validateArgs<T extends ZodObject<ZodRawShape>>(
  schema: T,
  args: unknown,
  toolName?: string,
): z.infer<T> {
  const result = schema.safeParse(args)
  if (!result.success) {
    const prefix = toolName ? `[${toolName}] ` : ''
    throw new Error(`${prefix}Invalid arguments: ${result.error.message}`)
  }
  return result.data
}

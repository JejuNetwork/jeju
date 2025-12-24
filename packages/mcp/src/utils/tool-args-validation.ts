/**
 * Zod-based tool argument validation utilities for MCP.
 */

import { toJSONSchema, type ZodObject, type ZodRawShape, z } from 'zod'
import type {
  JsonValue,
  MCPTool,
  MCPToolInputSchemaProperty,
  StringRecord,
} from '../types/mcp'

/**
 * JSON Schema output from Zod's toJSONSchema
 */
interface ZodJSONSchemaOutput {
  type?: string
  properties?: StringRecord<MCPToolInputSchemaProperty>
  required?: string[]
}

/**
 * JSON Value Schema for Zod - validates any JSON value
 */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
) as z.ZodType<JsonValue>

/**
 * Convert Zod schema to MCP-compatible inputSchema using Zod's toJSONSchema
 *
 * @param schema - Zod object schema to convert
 * @returns MCP tool input schema
 */
export function zodSchemaToMCPSchema(
  schema: ZodObject<ZodRawShape>,
): MCPTool['inputSchema'] {
  const jsonSchema = toJSONSchema(schema) as ZodJSONSchemaOutput

  return {
    type: 'object',
    properties: jsonSchema.properties ?? {},
    required: jsonSchema.required,
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

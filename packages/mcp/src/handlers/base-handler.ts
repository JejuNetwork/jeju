/**
 * Abstract base class for type-safe MCP tool handlers with Zod validation.
 */

import type { infer as ZodInfer, ZodObject, ZodRawShape } from 'zod'
import type {
  AuthenticatedAgent,
  JsonValue,
  MCPTool,
  MCPToolDefinition,
  StringRecord,
  ToolHandler,
} from '../types/mcp'
import {
  createToolFromSchema,
  createValidator,
} from '../utils/tool-args-validation'

export abstract class BaseToolHandler<
  TSchema extends ZodObject<ZodRawShape>,
  TResult = JsonValue,
> {
  /** Tool name */
  abstract readonly name: string

  /** Tool description */
  abstract readonly description: string

  /** Zod schema for validating arguments */
  abstract readonly schema: TSchema

  /**
   * Execute the tool with validated arguments
   *
   * @param args - Validated arguments
   * @param agent - Authenticated agent context
   * @returns Tool result
   */
  abstract execute(
    args: ZodInfer<TSchema>,
    agent: AuthenticatedAgent,
  ): Promise<TResult>

  /**
   * Get the MCP tool definition
   */
  getTool(): MCPTool {
    return createToolFromSchema(this.name, this.description, this.schema)
  }

  /**
   * Get the validator function
   */
  getValidator(): (args: unknown) => ZodInfer<TSchema> {
    return createValidator(this.schema)
  }

  /**
   * Get the handler function
   */
  getHandler(): ToolHandler<ZodInfer<TSchema>, TResult> {
    return this.execute.bind(this)
  }

  /**
   * Get the complete tool definition with handler and validator
   */
  getToolDefinition(): MCPToolDefinition<ZodInfer<TSchema>, TResult> {
    return {
      tool: this.getTool(),
      handler: this.getHandler(),
      validator: this.getValidator(),
    }
  }

  /**
   * Handle a tool call with validation
   *
   * @param args - Raw arguments
   * @param agent - Authenticated agent context
   * @returns Tool result
   */
  async handle(
    args: StringRecord<JsonValue>,
    agent: AuthenticatedAgent,
  ): Promise<TResult> {
    const validated = this.getValidator()(args)
    return this.execute(validated, agent)
  }
}

/**
 * Create a tool handler from a function
 *
 * @param name - Tool name
 * @param description - Tool description
 * @param schema - Zod schema for validation
 * @param handler - Handler function
 * @returns Tool definition
 */
export function createToolHandler<
  TSchema extends ZodObject<ZodRawShape>,
  TResult = JsonValue,
>(
  name: string,
  description: string,
  schema: TSchema,
  handler: ToolHandler<ZodInfer<TSchema>, TResult>,
): MCPToolDefinition<ZodInfer<TSchema>, TResult> {
  return {
    tool: createToolFromSchema(name, description, schema),
    handler,
    validator: createValidator(schema),
  }
}

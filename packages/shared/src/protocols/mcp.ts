/**
 * MCP Server Factory - Model Context Protocol
 *
 * Creates MCP servers for dApps.
 * Note: For new implementations, prefer createServer from './server'
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'
import type { ProtocolData, ProtocolValue } from '../types'
import type { MCPPrompt, MCPResource, MCPTool } from './server'

export type { MCPResource, MCPTool, MCPPrompt }

// Zod schema for recursive ProtocolValue type
const ProtocolValueSchema: z.ZodType<ProtocolValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(ProtocolValueSchema),
    z.record(z.string(), ProtocolValueSchema),
  ]),
)

const MCPResourceReadSchema = z.object({
  uri: z.string(),
})

const MCPToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), ProtocolValueSchema),
})

const MCPPromptGetSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.string()),
})

export interface MCPConfig {
  name: string
  description: string
  version?: string
  resources: MCPResource[]
  tools: MCPTool[]
  prompts?: MCPPrompt[]
  readResource: (uri: string, address: Address) => Promise<ProtocolValue>
  callTool: (
    name: string,
    args: ProtocolData,
    address: Address,
  ) => Promise<{ result: ProtocolValue; isError: boolean }>
  getPrompt?: (
    name: string,
    args: Record<string, string>,
    address: Address,
  ) => Promise<MCPPromptResult>
}

export interface MCPPromptResult {
  messages: Array<{ role: string; content: { type: string; text: string } }>
}

export function createMCPServer(config: MCPConfig) {
  const serverInfo = {
    name: config.name,
    version: config.version ?? '1.0.0',
    description: config.description,
    capabilities: {
      resources: true,
      tools: true,
      prompts: !!config.prompts,
    },
  }

  return (
    new Elysia()
      .use(cors())

      // Initialize
      .post('/initialize', () => ({
        protocolVersion: '2024-11-05',
        serverInfo,
        capabilities: serverInfo.capabilities,
      }))

      // List resources
      .post('/resources/list', () => ({ resources: config.resources }))

      // Read resource
      .post('/resources/read', async ({ body, headers, set }) => {
        const parseResult = MCPResourceReadSchema.safeParse(body)
        if (!parseResult.success) {
          set.status = 400
          return { error: 'Invalid request: uri required' }
        }

        const { uri } = parseResult.data
        const address = headers['x-jeju-address'] as Address

        if (!address) {
          set.status = 401
          return { error: 'Authentication required' }
        }

        const contents = await config.readResource(uri, address)
        const resource = config.resources.find((r) => r.uri === uri)

        return {
          contents: [
            {
              uri,
              mimeType: resource?.mimeType ?? 'application/json',
              text: JSON.stringify(contents),
            },
          ],
        }
      })

      // List tools
      .post('/tools/list', () => ({ tools: config.tools }))

      // Call tool
      .post('/tools/call', async ({ body, headers, set }) => {
        const parseResult = MCPToolCallSchema.safeParse(body)
        if (!parseResult.success) {
          set.status = 400
          return {
            content: [
              {
                type: 'text',
                text: 'Invalid request: name and arguments required',
              },
            ],
            isError: true,
          }
        }

        const { name, arguments: args } = parseResult.data
        const address = headers['x-jeju-address'] as Address

        if (!address) {
          return {
            content: [{ type: 'text', text: 'Authentication required' }],
            isError: true,
          }
        }

        const { result, isError } = await config.callTool(
          name,
          args as ProtocolData,
          address,
        )

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError,
        }
      })

      // Root info
      .get('/', () => ({
        ...serverInfo,
        resources: config.resources,
        tools: config.tools,
        prompts: config.prompts,
      }))

      // Prompts endpoints (always included, return error if not configured)
      .post('/prompts/list', ({ set }) => {
        if (!config.prompts) {
          set.status = 404
          return { error: 'Prompts not configured' }
        }
        return { prompts: config.prompts }
      })

      .post('/prompts/get', async ({ body, headers, set }) => {
        const parseResult = MCPPromptGetSchema.safeParse(body)
        if (!parseResult.success) {
          set.status = 400
          return { error: 'Invalid request: name and arguments required' }
        }

        const { name, arguments: args } = parseResult.data
        const address = headers['x-jeju-address'] as Address

        if (!address) {
          set.status = 401
          return { error: 'Authentication required' }
        }

        if (!config.getPrompt) {
          set.status = 404
          return { error: 'Prompts not configured' }
        }

        const result = await config.getPrompt(name, args, address)
        return result
      })
  )
}

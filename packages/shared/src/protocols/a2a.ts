/**
 * A2A Server Factory - Agent-to-Agent Protocol
 *
 * Creates A2A servers for dApps.
 */

import { cors } from '@elysiajs/cors'
import { getNetworkName, getWebsiteUrl } from '@jejunetwork/config'
import { type AnyElysia, Elysia } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'
import type { ProtocolData, ProtocolValue } from '../types'
import type { A2ASkill } from './server'

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

const A2AMessagePartSchema = z.object({
  kind: z.string(),
  text: z.string().optional(),
  data: z.record(z.string(), ProtocolValueSchema).optional(),
})

const A2ARequestSchema = z.object({
  jsonrpc: z.string(),
  method: z.string(),
  params: z
    .object({
      message: z
        .object({
          messageId: z.string(),
          parts: z.array(A2AMessagePartSchema),
        })
        .optional(),
    })
    .optional(),
  id: z.union([z.number(), z.string(), z.null()]),
})

export interface A2AConfig {
  name: string
  description: string
  version?: string
  skills: A2ASkill[]
  executeSkill: (
    skillId: string,
    params: ProtocolData,
    address: Address,
  ) => Promise<A2AResult>
}

export type { A2ASkill }

export interface A2AResult {
  message: string
  data: ProtocolData
}

export interface AgentCard {
  protocolVersion: string
  name: string
  description: string
  url: string
  preferredTransport: string
  provider: { organization: string; url: string }
  version: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    stateTransitionHistory: boolean
  }
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: A2ASkill[]
}

export function createA2AServer(config: A2AConfig): AnyElysia {
  const agentCard: AgentCard = {
    protocolVersion: '0.3.0',
    name: config.name,
    description: config.description,
    url: '/a2a',
    preferredTransport: 'http',
    provider: { organization: getNetworkName(), url: getWebsiteUrl() },
    version: config.version ?? '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: config.skills,
  }

  return (
    new Elysia()
      .use(cors() as unknown as AnyElysia)
      // Agent card discovery
      .get('/.well-known/agent-card.json', () => agentCard)

      // Main A2A endpoint
      .post('/', async ({ body, headers, set }) => {
        const parseResult = A2ARequestSchema.safeParse(body)

        if (!parseResult.success) {
          set.status = 400
          return {
            jsonrpc: '2.0',
            id: 0,
            error: { code: -32600, message: 'Invalid request format' },
          }
        }

        const requestBody = parseResult.data
        const address = headers['x-jeju-address'] as Address

        if (requestBody.method !== 'message/send') {
          return {
            jsonrpc: '2.0',
            id: requestBody.id,
            error: { code: -32601, message: 'Method not found' },
          }
        }

        if (!address) {
          return {
            jsonrpc: '2.0',
            id: requestBody.id,
            error: { code: 401, message: 'Authentication required' },
          }
        }

        const dataPart = requestBody.params?.message?.parts?.find(
          (p) => p.kind === 'data',
        )
        if (!dataPart?.data) {
          return {
            jsonrpc: '2.0',
            id: requestBody.id,
            error: { code: -32602, message: 'No data part found in message' },
          }
        }
        const skillId =
          typeof dataPart.data.skillId === 'string'
            ? dataPart.data.skillId
            : null
        if (!skillId) {
          return {
            jsonrpc: '2.0',
            id: requestBody.id,
            error: { code: -32602, message: 'No skillId specified' },
          }
        }
        const params = dataPart.data as ProtocolData

        const result = await config.executeSkill(skillId, params, address)

        return {
          jsonrpc: '2.0',
          id: requestBody.id,
          result: {
            role: 'agent',
            parts: [
              { kind: 'text', text: result.message },
              { kind: 'data', data: result.data },
            ],
            messageId:
              requestBody.params?.message?.messageId ?? `msg-${Date.now()}`,
            kind: 'message',
          },
        }
      })
  ) as unknown as AnyElysia
}

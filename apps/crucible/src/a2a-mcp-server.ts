/**
 * Crucible A2A & MCP Server
 */

import { cors } from '@elysiajs/cors'
import { getCliBranding } from '@jejunetwork/config'
import { createAgentCard, getServiceName } from '@jejunetwork/shared'
import { Elysia } from 'elysia'
import {
  A2ARequestSchema,
  expect,
  MCPResourceReadRequestSchema,
  MCPToolCallRequestSchema,
  parseOrThrow,
} from './schemas'
import type { JsonObject } from './types'

const CRUCIBLE_SKILLS = [
  {
    id: 'list-providers',
    name: 'List Providers',
    description: 'List available compute providers',
    tags: ['query', 'providers'],
  },
  {
    id: 'get-provider',
    name: 'Get Provider',
    description: 'Get compute provider details',
    tags: ['query', 'provider'],
  },
  {
    id: 'request-compute',
    name: 'Request Compute',
    description: 'Request compute resources',
    tags: ['action', 'compute'],
  },
  {
    id: 'get-job-status',
    name: 'Get Job Status',
    description: 'Check compute job status',
    tags: ['query', 'job'],
  },
  {
    id: 'cancel-job',
    name: 'Cancel Job',
    description: 'Cancel a running job',
    tags: ['action', 'job'],
  },
  {
    id: 'list-tee-nodes',
    name: 'List TEE Nodes',
    description: 'List available TEE nodes',
    tags: ['query', 'tee'],
  },
  {
    id: 'verify-attestation',
    name: 'Verify Attestation',
    description: 'Verify TEE attestation',
    tags: ['action', 'attestation'],
  },
  {
    id: 'deploy-to-tee',
    name: 'Deploy to TEE',
    description: 'Deploy workload to TEE',
    tags: ['action', 'tee'],
  },
  {
    id: 'list-models',
    name: 'List Models',
    description: 'List available inference models',
    tags: ['query', 'inference'],
  },
  {
    id: 'run-inference',
    name: 'Run Inference',
    description: 'Run model inference',
    tags: ['action', 'inference'],
  },
  {
    id: 'get-inference-price',
    name: 'Get Inference Price',
    description: 'Get pricing for inference',
    tags: ['query', 'pricing'],
  },
  {
    id: 'upload-to-storage',
    name: 'Upload to Storage',
    description: 'Upload data to decentralized storage',
    tags: ['action', 'storage'],
  },
  {
    id: 'download-from-storage',
    name: 'Download from Storage',
    description: 'Download data from storage',
    tags: ['action', 'storage'],
  },
]

const AGENT_CARD = {
  ...createAgentCard({
    name: 'Crucible',
    description: 'Decentralized compute orchestration with TEE support',
    url: '/a2a',
    skills: CRUCIBLE_SKILLS,
  }),
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
}

const cliBranding = getCliBranding()

const MCP_SERVER_INFO = {
  name: `${cliBranding.name}-crucible`,
  version: '1.0.0',
  description: 'Decentralized compute orchestration with TEE support',
  capabilities: { resources: true, tools: true, prompts: false },
}

const MCP_RESOURCES = [
  {
    uri: 'crucible://providers',
    name: 'Compute Providers',
    description: 'Available compute providers',
    mimeType: 'application/json',
  },
  {
    uri: 'crucible://tee-nodes',
    name: 'TEE Nodes',
    description: 'Available TEE nodes',
    mimeType: 'application/json',
  },
  {
    uri: 'crucible://models',
    name: 'Inference Models',
    description: 'Available models',
    mimeType: 'application/json',
  },
  {
    uri: 'crucible://jobs/active',
    name: 'Active Jobs',
    description: 'Currently running jobs',
    mimeType: 'application/json',
  },
  {
    uri: 'crucible://pricing',
    name: 'Pricing',
    description: 'Compute pricing',
    mimeType: 'application/json',
  },
]

const MCP_TOOLS = [
  {
    name: 'request_compute',
    description: 'Request compute resources from the network',
    inputSchema: {
      type: 'object',
      properties: {
        cpu: { type: 'number', description: 'CPU cores needed' },
        memory: { type: 'number', description: 'Memory in GB' },
        gpu: { type: 'string', description: 'GPU type (optional)' },
        duration: { type: 'number', description: 'Duration in hours' },
        image: { type: 'string', description: 'Container image' },
        teeRequired: { type: 'boolean', description: 'Require TEE' },
      },
      required: ['cpu', 'memory', 'duration', 'image'],
    },
  },
  {
    name: 'run_inference',
    description: 'Run inference on a model',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Model identifier' },
        input: { type: 'string', description: 'Input data/prompt' },
        maxTokens: {
          type: 'number',
          description: 'Max tokens (for text models)',
        },
      },
      required: ['model', 'input'],
    },
  },
  {
    name: 'deploy_to_tee',
    description: 'Deploy workload to TEE environment',
    inputSchema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Container image' },
        attestationRequired: {
          type: 'boolean',
          description: 'Require attestation',
        },
        secrets: { type: 'object', description: 'Encrypted secrets' },
      },
      required: ['image'],
    },
  },
  {
    name: 'get_job_status',
    description: 'Get status of a compute job',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string', description: 'Job ID' } },
      required: ['jobId'],
    },
  },
]

async function executeA2ASkill(
  skillId: string,
  params: JsonObject,
): Promise<{ message: string; data: JsonObject }> {
  switch (skillId) {
    case 'list-providers':
      return { message: 'Available compute providers', data: { providers: [] } }
    case 'get-provider':
      return {
        message: `Provider ${params.providerId}`,
        data: { provider: null },
      }
    case 'request-compute':
      return {
        message: 'Compute request submitted',
        data: { jobId: crypto.randomUUID(), status: 'pending' },
      }
    case 'list-tee-nodes':
      return { message: 'TEE nodes', data: { nodes: [] } }
    case 'run-inference':
      return {
        message: 'Inference request submitted',
        data: { requestId: crypto.randomUUID() },
      }
    default:
      return { message: 'Unknown skill', data: { error: 'Skill not found' } }
  }
}

export function createCrucibleA2AServer() {
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
  const isProduction = process.env.NODE_ENV === 'production'

  return new Elysia({ prefix: '/a2a' })
    .use(
      cors({
        origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : true,
        credentials: true,
      }),
    )
    .get('/.well-known/agent-card.json', () => AGENT_CARD)
    .post('/', async ({ body }) => {
      const parsed = parseOrThrow(A2ARequestSchema, body, 'A2A request')

      if (parsed.method !== 'message/send') {
        return {
          jsonrpc: '2.0',
          id: parsed.id,
          error: { code: -32601, message: 'Method not found' },
        }
      }

      const message = parsed.params?.message
      const validMessage = expect(message, 'Message is required')
      const dataPart = validMessage.parts.find((p) => p.kind === 'data')
      const validDataPart = expect(dataPart, 'Data part is required')
      const validData = expect(validDataPart.data, 'Data part data is required')
      expect(typeof validData.skillId === 'string', 'Skill ID must be a string')

      const skillId = validData.skillId as string
      const result = await executeA2ASkill(skillId, validData)

      return {
        jsonrpc: '2.0',
        id: parsed.id,
        result: {
          role: 'agent',
          parts: [
            { kind: 'text', text: result.message },
            { kind: 'data', data: result.data },
          ],
          messageId: validMessage.messageId,
          kind: 'message',
        },
      }
    })
}

export function createCrucibleMCPServer() {
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
  const isProduction = process.env.NODE_ENV === 'production'

  return new Elysia({ prefix: '/mcp' })
    .use(
      cors({
        origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : true,
        credentials: true,
      }),
    )
    .post('/initialize', () => ({
      protocolVersion: '2024-11-05',
      serverInfo: MCP_SERVER_INFO,
      capabilities: MCP_SERVER_INFO.capabilities,
    }))
    .post('/resources/list', () => ({ resources: MCP_RESOURCES }))
    .post('/resources/read', async ({ body, set }) => {
      const parsed = parseOrThrow(
        MCPResourceReadRequestSchema,
        body,
        'MCP resource read request',
      )

      type ResourceContent =
        | { providers: string[] }
        | { nodes: string[] }
        | { models: string[] }
        | { jobs: string[] }
        | { cpu: number; gpu: number; memory: number }

      let contents: ResourceContent

      switch (parsed.uri) {
        case 'crucible://providers':
          contents = { providers: [] }
          break
        case 'crucible://tee-nodes':
          contents = { nodes: [] }
          break
        case 'crucible://models':
          contents = { models: [] }
          break
        case 'crucible://jobs/active':
          contents = { jobs: [] }
          break
        case 'crucible://pricing':
          contents = { cpu: 0.01, gpu: 0.1, memory: 0.005 }
          break
        default:
          set.status = 404
          return { error: 'Resource not found' }
      }

      return {
        contents: [
          {
            uri: parsed.uri,
            mimeType: 'application/json',
            text: JSON.stringify(contents),
          },
        ],
      }
    })
    .post('/tools/list', () => ({ tools: MCP_TOOLS }))
    .post('/tools/call', async ({ body }) => {
      const parsed = parseOrThrow(
        MCPToolCallRequestSchema,
        body,
        'MCP tool call request',
      )

      type ToolResult =
        | { jobId: string; status: string; estimatedCost: number }
        | { requestId: string; model: string; status: string }
        | { deploymentId: string; status: string }
        | { jobId: string; status: string; progress: number }

      let result: ToolResult

      switch (parsed.name) {
        case 'request_compute':
          result = {
            jobId: crypto.randomUUID(),
            status: 'pending',
            estimatedCost: 1.5,
          }
          break
        case 'run_inference': {
          const args = expect(
            parsed.arguments,
            'Arguments are required for run_inference',
          )
          expect(
            typeof args.model === 'string',
            'Model is required for run_inference',
          )
          result = {
            requestId: crypto.randomUUID(),
            model: args.model as string,
            status: 'queued',
          }
          break
        }
        case 'deploy_to_tee':
          result = { deploymentId: crypto.randomUUID(), status: 'deploying' }
          break
        case 'get_job_status': {
          const args = expect(
            parsed.arguments,
            'Arguments are required for get_job_status',
          )
          expect(args.jobId, 'Job ID is required for get_job_status')
          result = {
            jobId: args.jobId as string,
            status: 'running',
            progress: 50,
          }
          break
        }
        default:
          return {
            content: [{ type: 'text', text: 'Tool not found' }],
            isError: true,
          }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: false,
      }
    })
    .get('/', () => ({
      ...MCP_SERVER_INFO,
      resources: MCP_RESOURCES,
      tools: MCP_TOOLS,
    }))
}

export function createCrucibleServer() {
  return new Elysia()
    .use(createCrucibleA2AServer())
    .use(createCrucibleMCPServer())
    .get('/', () => ({
      name: getServiceName('Crucible'),
      version: '1.0.0',
      endpoints: {
        a2a: '/a2a',
        mcp: '/mcp',
        agentCard: '/a2a/.well-known/agent-card.json',
      },
    }))
}

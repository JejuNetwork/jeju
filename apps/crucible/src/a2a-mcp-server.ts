/**
 * Crucible A2A & MCP Server
 *
 * Agent-to-agent and Model Context Protocol interfaces for
 * the Crucible compute orchestration system.
 */

import { getCliBranding } from '@jejunetwork/config'
import { createAgentCard, getServiceName } from '@jejunetwork/shared'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  A2ARequestSchema,
  expect,
  MCPResourceReadRequestSchema,
  MCPToolCallRequestSchema,
  parseOrThrow,
} from './schemas'
import type { JsonObject } from './types'

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Configuration
// ============================================================================

const CRUCIBLE_SKILLS = [
  // Compute Skills
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

  // TEE Skills
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

  // Inference Skills
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

  // Storage Skills
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
      properties: {
        jobId: { type: 'string', description: 'Job ID' },
      },
      required: ['jobId'],
    },
  },
]

// ============================================================================
// A2A Server
// ============================================================================

export function createCrucibleA2AServer(): Hono {
  const app = new Hono()
  // SECURITY: Configure CORS based on environment
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
  const isProduction = process.env.NODE_ENV === 'production'
  app.use('/*', cors({
    origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : '*',
    credentials: true,
  }))

  app.get('/.well-known/agent-card.json', (c) => c.json(AGENT_CARD))

  app.post('/', async (c) => {
    const rawBody = await c.req.json()
    const body = parseOrThrow(A2ARequestSchema, rawBody, 'A2A request')

    if (body.method !== 'message/send') {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' },
      })
    }

    const message = body.params?.message
    const validMessage = expect(message, 'Message is required')
    const dataPart = validMessage.parts.find((p) => p.kind === 'data')
    const validDataPart = expect(dataPart, 'Data part is required')
    const validData = expect(validDataPart.data, 'Data part data is required')
    expect(typeof validData.skillId === 'string', 'Skill ID must be a string')

    const skillId = validData.skillId as string
    const result = await executeA2ASkill(skillId, validData)

    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [
          { kind: 'text', text: result.message },
          { kind: 'data', data: result.data },
        ],
        messageId: validMessage.messageId,
        kind: 'message',
      },
    })
  })

  return app
}

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

// ============================================================================
// MCP Server
// ============================================================================

export function createCrucibleMCPServer(): Hono {
  const app = new Hono()
  // SECURITY: Configure CORS based on environment
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
  const isProduction = process.env.NODE_ENV === 'production'
  app.use('/*', cors({
    origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : '*',
    credentials: true,
  }))

  app.post('/initialize', (c) =>
    c.json({
      protocolVersion: '2024-11-05',
      serverInfo: MCP_SERVER_INFO,
      capabilities: MCP_SERVER_INFO.capabilities,
    }),
  )

  app.post('/resources/list', (c) => c.json({ resources: MCP_RESOURCES }))

  app.post('/resources/read', async (c) => {
    const rawBody = await c.req.json()
    const body = parseOrThrow(
      MCPResourceReadRequestSchema,
      rawBody,
      'MCP resource read request',
    )

    type ResourceContent =
      | { providers: string[] }
      | { nodes: string[] }
      | { models: string[] }
      | { jobs: string[] }
      | { cpu: number; gpu: number; memory: number }

    let contents: ResourceContent

    switch (body.uri) {
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
        return c.json({ error: 'Resource not found' }, 404)
    }

    return c.json({
      contents: [
        {
          uri: body.uri,
          mimeType: 'application/json',
          text: JSON.stringify(contents),
        },
      ],
    })
  })

  app.post('/tools/list', (c) => c.json({ tools: MCP_TOOLS }))

  app.post('/tools/call', async (c) => {
    const rawBody = await c.req.json()
    const body = parseOrThrow(
      MCPToolCallRequestSchema,
      rawBody,
      'MCP tool call request',
    )

    type ToolResult =
      | { jobId: string; status: string; estimatedCost: number }
      | { requestId: string; model: string; status: string }
      | { deploymentId: string; status: string }
      | { jobId: string; status: string; progress: number }

    let result: ToolResult

    switch (body.name) {
      case 'request_compute':
        result = {
          jobId: crypto.randomUUID(),
          status: 'pending',
          estimatedCost: 1.5,
        }
        break
      case 'run_inference': {
        const args = expect(
          body.arguments,
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
          body.arguments,
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
        return c.json({
          content: [{ type: 'text', text: 'Tool not found' }],
          isError: true,
        })
    }

    return c.json({
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: false,
    })
  })

  app.get('/', (c) =>
    c.json({ ...MCP_SERVER_INFO, resources: MCP_RESOURCES, tools: MCP_TOOLS }),
  )

  return app
}

// ============================================================================
// Combined Server
// ============================================================================

export function createCrucibleServer(): Hono {
  const app = new Hono()

  app.route('/a2a', createCrucibleA2AServer())
  app.route('/mcp', createCrucibleMCPServer())

  app.get('/', (c) =>
    c.json({
      name: getServiceName('Crucible'),
      version: '1.0.0',
      endpoints: {
        a2a: '/a2a',
        mcp: '/mcp',
        agentCard: '/a2a/.well-known/agent-card.json',
      },
    }),
  )

  return app
}

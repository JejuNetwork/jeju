/** MCP Routes */

import type { JsonRecord } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  expectValid,
  MCPPromptGetBodySchema,
  MCPResourceReadBodySchema,
  MCPToolCallBodySchema,
} from '../schemas'

const SERVER_INFO = {
  name: 'jeju-factory',
  version: '1.0.0',
  description:
    'Developer coordination hub - bounties, jobs, git, packages, containers, models, project management',
  capabilities: { resources: true, tools: true, prompts: true },
}

const RESOURCES = [
  {
    uri: 'factory://git/repos',
    name: 'Git Repositories',
    description: 'All git repositories',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://git/issues',
    name: 'Issues',
    description: 'Open issues across repos',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://git/pulls',
    name: 'Pull Requests',
    description: 'Open pull requests',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://packages',
    name: 'Packages',
    description: 'All published packages',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://models',
    name: 'Models',
    description: 'AI models',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://bounties',
    name: 'Bounties',
    description: 'Open bounties',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://jobs',
    name: 'Jobs',
    description: 'Job listings',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://ci/runs',
    name: 'CI Runs',
    description: 'Recent CI/CD runs',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://agents',
    name: 'Agents',
    description: 'Deployed AI agents',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://feed',
    name: 'Feed',
    description: 'Developer feed',
    mimeType: 'application/json',
  },
]

const TOOLS = [
  {
    name: 'create_repository',
    description: 'Create a new git repository',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Repository name' },
        description: { type: 'string', description: 'Repository description' },
        isPrivate: { type: 'boolean', description: 'Make repository private' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_issue',
    description: 'Create a new issue in a repository',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository (owner/name)' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body (markdown)' },
      },
      required: ['repo', 'title'],
    },
  },
  {
    name: 'search_packages',
    description: 'Search for packages',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
    },
  },
  {
    name: 'search_models',
    description: 'Search for AI models',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: {
          type: 'string',
          description: 'Model type (llm, embedding, etc.)',
        },
      },
    },
  },
  {
    name: 'list_bounties',
    description: 'List available bounties',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status' },
        skill: { type: 'string', description: 'Filter by skill' },
      },
    },
  },
  {
    name: 'create_bounty',
    description: 'Create a new bounty',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Bounty title' },
        description: { type: 'string', description: 'Detailed description' },
        reward: { type: 'string', description: 'Reward amount' },
        currency: { type: 'string', description: 'Reward currency' },
      },
      required: ['title', 'description', 'reward'],
    },
  },
  {
    name: 'trigger_workflow',
    description: 'Trigger a CI/CD workflow',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository' },
        workflow: { type: 'string', description: 'Workflow name' },
        branch: { type: 'string', description: 'Branch to run on' },
      },
      required: ['repo', 'workflow'],
    },
  },
  {
    name: 'deploy_agent',
    description: 'Deploy a new AI agent',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent name' },
        type: { type: 'string', description: 'Agent type' },
        modelId: { type: 'string', description: 'Model to use' },
      },
      required: ['name', 'type', 'modelId'],
    },
  },
]

const PROMPTS = [
  {
    name: 'code_review',
    description: 'Review code changes in a pull request',
    arguments: [
      { name: 'repo', description: 'Repository (owner/name)', required: true },
      { name: 'prNumber', description: 'Pull request number', required: true },
    ],
  },
  {
    name: 'bounty_proposal',
    description: 'Generate a bounty proposal',
    arguments: [
      { name: 'title', description: 'Bounty title', required: true },
      { name: 'skills', description: 'Required skills', required: true },
    ],
  },
]

function handleResourceRead(
  uri: string,
): { contents: Array<{ uri: string; mimeType: string; text: string }> } | null {
  let contents: JsonRecord

  switch (uri) {
    case 'factory://git/repos':
      contents = {
        repositories: [
          {
            name: 'jeju/protocol',
            stars: 1250,
            forks: 340,
            language: 'Solidity',
          },
          { name: 'jeju/sdk', stars: 890, forks: 120, language: 'TypeScript' },
        ],
      }
      break
    case 'factory://packages':
      contents = {
        packages: [
          { name: '@jejunetwork/sdk', version: '1.5.2', downloads: 45000 },
          {
            name: '@jejunetwork/contracts',
            version: '2.0.0',
            downloads: 32000,
          },
        ],
      }
      break
    case 'factory://models':
      contents = {
        models: [
          { id: 'jeju/llama-3-jeju-ft', downloads: 15000, type: 'llm' },
          { id: 'jeju/code-embed-v1', downloads: 8500, type: 'embedding' },
        ],
      }
      break
    case 'factory://bounties':
      contents = {
        bounties: [
          {
            id: '1',
            title: 'Implement ERC-4337',
            reward: '5000 USDC',
            status: 'open',
          },
          {
            id: '2',
            title: 'Build Dashboard',
            reward: '2500 USDC',
            status: 'in_progress',
          },
        ],
      }
      break
    case 'factory://ci/runs':
      contents = {
        runs: [
          { id: 'run-1', workflow: 'Build & Test', status: 'success' },
          { id: 'run-2', workflow: 'Deploy', status: 'running' },
        ],
      }
      break
    default:
      return null
  }

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(contents, null, 2),
      },
    ],
  }
}

function handleToolCall(
  name: string,
  args: JsonRecord,
): { content: Array<{ type: string; text: string }>; isError: boolean } {
  let result: JsonRecord
  let isError = false

  switch (name) {
    case 'create_repository':
      result = {
        id: `repo-${Date.now()}`,
        name: args.name,
        url: `https://git.jejunetwork.org/${args.name}`,
        cloneUrl: `https://git.jejunetwork.org/${args.name}.git`,
      }
      break
    case 'search_packages':
      result = {
        packages: [
          {
            name: '@jejunetwork/sdk',
            version: '1.5.2',
            description: 'Jeju Network SDK',
          },
        ],
        total: 1,
      }
      break
    case 'search_models':
      result = {
        models: [{ id: 'jeju/llama-3-jeju-ft', downloads: 15000, type: 'llm' }],
      }
      break
    case 'list_bounties':
      result = {
        bounties: [
          {
            id: '1',
            title: 'Implement ERC-4337',
            reward: '5000',
            currency: 'USDC',
            status: 'open',
          },
        ],
      }
      break
    case 'trigger_workflow':
      result = {
        runId: `run-${Date.now()}`,
        workflow: args.workflow,
        status: 'queued',
      }
      break
    case 'deploy_agent':
      result = {
        agentId: `agent-${Date.now()}`,
        name: args.name,
        status: 'deploying',
      }
      break
    default:
      result = { error: 'Tool not found' }
      isError = true
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError,
  }
}

export const mcpRoutes = new Elysia({ prefix: '/api/mcp' })
  .get(
    '/',
    () => ({
      server: SERVER_INFO.name,
      version: SERVER_INFO.version,
      description: SERVER_INFO.description,
      resources: RESOURCES,
      tools: TOOLS,
      prompts: PROMPTS,
      capabilities: SERVER_INFO.capabilities,
    }),
    {
      detail: {
        tags: ['mcp'],
        summary: 'MCP info',
        description: 'Get MCP server information',
      },
    },
  )
  .get('/info', () => ({
    server: SERVER_INFO.name,
    version: SERVER_INFO.version,
    description: SERVER_INFO.description,
    resources: RESOURCES,
    tools: TOOLS,
    prompts: PROMPTS,
    capabilities: SERVER_INFO.capabilities,
  }))
  .post('/initialize', () => ({
    protocolVersion: '2024-11-05',
    serverInfo: SERVER_INFO,
    capabilities: SERVER_INFO.capabilities,
  }))
  .get('/resources/list', () => ({ resources: RESOURCES }))
  .post(
    '/resources/read',
    async ({ body, set }) => {
      const validated = expectValid(
        MCPResourceReadBodySchema,
        body,
        'request body',
      )
      const result = handleResourceRead(validated.uri)
      if (!result) {
        set.status = 404
        return { error: 'Resource not found' }
      }
      return result
    },
    {
      detail: {
        tags: ['mcp'],
        summary: 'Read resource',
        description: 'Read a specific MCP resource',
      },
    },
  )
  .get('/tools/list', () => ({ tools: TOOLS }))
  .post(
    '/tools/call',
    async ({ body }) => {
      const validated = expectValid(MCPToolCallBodySchema, body, 'request body')
      return handleToolCall(validated.name, validated.arguments)
    },
    {
      detail: {
        tags: ['mcp'],
        summary: 'Call tool',
        description: 'Call an MCP tool',
      },
    },
  )
  .get('/prompts/list', () => ({ prompts: PROMPTS }))
  .post(
    '/prompts/get',
    async ({ body, set }) => {
      const validated = expectValid(
        MCPPromptGetBodySchema,
        body,
        'request body',
      )
      const prompt = PROMPTS.find((p) => p.name === validated.name)
      if (!prompt) {
        set.status = 404
        return { error: 'Prompt not found' }
      }

      let messages: Array<{
        role: string
        content: { type: string; text: string }
      }>

      switch (validated.name) {
        case 'code_review':
          messages = [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please review the pull request #${validated.arguments.prNumber} in ${validated.arguments.repo}.`,
              },
            },
          ]
          break
        case 'bounty_proposal':
          messages = [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Create a detailed bounty proposal for: ${validated.arguments.title}\nRequired skills: ${validated.arguments.skills}`,
              },
            },
          ]
          break
        default:
          set.status = 404
          return { error: 'Prompt not found' }
      }

      return { messages }
    },
    {
      detail: {
        tags: ['mcp'],
        summary: 'Get prompt',
        description: 'Get a specific MCP prompt',
      },
    },
  )

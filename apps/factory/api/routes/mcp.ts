import type { JsonRecord } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  createBounty,
  createCIRun,
  createIssue,
  listAgents,
  listBounties,
  listCIRuns,
  listIssues,
  listJobs,
  listModels,
  listPullRequests,
} from '../db/client'
import {
  expectValid,
  MCPPromptGetBodySchema,
  MCPResourceReadBodySchema,
  MCPToolCallBodySchema,
} from '../schemas'
import { dwsClient } from '../services/dws'

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
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required skills',
        },
        deadline: { type: 'number', description: 'Deadline timestamp' },
        creator: { type: 'string', description: 'Creator address' },
      },
      required: [
        'title',
        'description',
        'reward',
        'currency',
        'skills',
        'deadline',
        'creator',
      ],
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

async function handleResourceRead(uri: string): Promise<{
  contents: Array<{ uri: string; mimeType: string; text: string }>
} | null> {
  let contents: JsonRecord

  switch (uri) {
    case 'factory://git/repos': {
      const repos = await dwsClient.listRepositories()
      contents = {
        repositories: repos.map((r) => ({
          name: r.name,
          owner: r.owner,
          stars: r.stars,
          forks: r.forks,
        })),
        total: repos.length,
      }
      break
    }
    case 'factory://git/issues': {
      const result = await listIssues({ status: 'open' })
      contents = {
        issues: result.issues.map((i) => ({
          id: i.id,
          number: i.number,
          repo: i.repo,
          title: i.title,
          status: i.status,
        })),
        total: result.total,
      }
      break
    }
    case 'factory://git/pulls': {
      const result = await listPullRequests({ status: 'open' })
      contents = {
        pulls: result.pulls.map((p) => ({
          id: p.id,
          number: p.number,
          repo: p.repo,
          title: p.title,
          status: p.status,
        })),
        total: result.total,
      }
      break
    }
    case 'factory://packages': {
      const packages = await dwsClient.searchPackages('')
      contents = {
        packages: packages.map((p) => ({
          name: p.name,
          version: p.version,
          downloads: p.downloads,
        })),
        total: packages.length,
      }
      break
    }
    case 'factory://models': {
      const models = await listModels({})
      contents = {
        models: models.map((m) => ({
          id: m.id,
          name: m.name,
          type: m.type,
          downloads: m.downloads,
          stars: m.stars,
        })),
        total: models.length,
      }
      break
    }
    case 'factory://bounties': {
      const result = await listBounties({ status: 'open' })
      contents = {
        bounties: result.bounties.map((b) => ({
          id: b.id,
          title: b.title,
          reward: b.reward,
          currency: b.currency,
          status: b.status,
        })),
        total: result.total,
      }
      break
    }
    case 'factory://jobs': {
      const result = await listJobs({ status: 'open' })
      contents = {
        jobs: result.jobs.map((j) => ({
          id: j.id,
          title: j.title,
          company: j.company,
          type: j.type,
          remote: j.remote === 1,
        })),
        total: result.total,
      }
      break
    }
    case 'factory://ci/runs': {
      const result = await listCIRuns({})
      contents = {
        runs: result.runs.map((r) => ({
          id: r.id,
          workflow: r.workflow,
          status: r.status,
          branch: r.branch,
        })),
        total: result.total,
      }
      break
    }
    case 'factory://agents': {
      const agents = await listAgents({ active: true })
      contents = {
        agents: agents.map((a) => ({
          agentId: a.agent_id,
          name: a.name,
          botType: a.bot_type,
          reputation: a.reputation,
        })),
        total: agents.length,
      }
      break
    }
    case 'factory://feed':
      // Feed would come from Farcaster integration
      contents = { posts: [], total: 0 }
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

async function handleToolCall(
  name: string,
  args: JsonRecord,
): Promise<{
  content: Array<{ type: string; text: string }>
  isError: boolean
}> {
  let result: JsonRecord
  let isError = false

  switch (name) {
    case 'create_repository': {
      const repo = await dwsClient.createRepository({
        name: args.name as string,
        description: args.description as string | undefined,
        isPrivate: args.isPrivate as boolean | undefined,
      })
      result = {
        id: repo.id,
        name: repo.name,
        url: repo.cloneUrl,
        cloneUrl: repo.cloneUrl,
      }
      break
    }
    case 'create_issue': {
      const issue = await createIssue({
        repo: args.repo as string,
        title: args.title as string,
        body: (args.body as string) ?? '',
        author: (args.author as string) ?? 'mcp-tool',
      })
      result = {
        id: issue.id,
        number: issue.number,
        repo: issue.repo,
        title: issue.title,
      }
      break
    }
    case 'search_packages': {
      const packages = await dwsClient.searchPackages(
        (args.query as string) ?? '',
      )
      result = {
        packages: packages.map((p) => ({
          name: p.name,
          version: p.version,
          description: p.description ?? '',
        })),
        total: packages.length,
      }
      break
    }
    case 'search_models': {
      const models = await listModels({
        type: args.type as string | undefined,
      })
      result = {
        models: models.map((m) => ({
          id: m.id,
          name: m.name,
          type: m.type,
          downloads: m.downloads,
        })),
        total: models.length,
      }
      break
    }
    case 'list_bounties': {
      const bountyResult = await listBounties({
        status: args.status as string | undefined,
        skill: args.skill as string | undefined,
      })
      result = {
        bounties: bountyResult.bounties.map((b) => ({
          id: b.id,
          title: b.title,
          reward: b.reward,
          currency: b.currency,
          status: b.status,
        })),
        total: bountyResult.total,
      }
      break
    }
    case 'create_bounty': {
      const bounty = await createBounty({
        title: args.title as string,
        description: args.description as string,
        reward: args.reward as string,
        currency: (args.currency as string) ?? 'USDC',
        skills: (args.skills as string[]) ?? [],
        deadline:
          (args.deadline as number) ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
        creator: (args.creator as string) ?? 'mcp-tool',
      })
      result = {
        id: bounty.id,
        title: bounty.title,
        reward: bounty.reward,
        currency: bounty.currency,
        status: bounty.status,
      }
      break
    }
    case 'trigger_workflow': {
      const run = await createCIRun({
        repo: args.repo as string,
        workflow: args.workflow as string,
        branch: (args.branch as string) ?? 'main',
      })
      result = {
        runId: run.id,
        workflow: run.workflow,
        status: run.status,
      }
      break
    }
    case 'deploy_agent': {
      // Agent deployment would go through Crucible
      result = {
        message:
          'Agent deployment requires authentication. Use the /api/agents endpoint.',
        name: args.name,
        type: args.type,
      }
      break
    }
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
      const result = await handleResourceRead(validated.uri)
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
      return await handleToolCall(validated.name, validated.arguments)
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

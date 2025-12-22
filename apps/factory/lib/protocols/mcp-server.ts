/**
 * Factory MCP Server - Model Context Protocol
 *
 * Exposes all Factory features to AI assistants via MCP.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { expect, validateBody } from '@/lib/validation'
import {
  mcpPromptGetSchema,
  mcpResourceReadSchema,
  mcpToolCallSchema,
} from '@/lib/validation/protocols'
import {
  createAgentSchema,
  createBountySchema,
  createCIRunSchema,
  createIssueSchema,
  createPullRequestSchema,
  createRepositorySchema,
} from '@/lib/validation/schemas'

const SERVER_INFO = {
  name: 'jeju-factory',
  version: '1.0.0',
  description:
    'Developer coordination hub - bounties, jobs, git, packages, containers, models, project management',
  capabilities: { resources: true, tools: true, prompts: true },
}

// ... (keep RESOURCES constant) ...
// ============ RESOURCES ============
const RESOURCES = [
  // Git Resources
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

  // Package Resources
  {
    uri: 'factory://packages',
    name: 'Packages',
    description: 'All published packages',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://packages/recent',
    name: 'Recent Packages',
    description: 'Recently published packages',
    mimeType: 'application/json',
  },

  // Container Resources
  {
    uri: 'factory://containers',
    name: 'Containers',
    description: 'Container images',
    mimeType: 'application/json',
  },

  // Model Resources
  {
    uri: 'factory://models',
    name: 'Models',
    description: 'AI models',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://models/trending',
    name: 'Trending Models',
    description: 'Most downloaded models',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://datasets',
    name: 'Datasets',
    description: 'Training datasets',
    mimeType: 'application/json',
  },

  // Work Resources
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
    uri: 'factory://projects',
    name: 'Projects',
    description: 'Project boards',
    mimeType: 'application/json',
  },

  // CI/CD Resources
  {
    uri: 'factory://ci/runs',
    name: 'CI Runs',
    description: 'Recent CI/CD runs',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://ci/workflows',
    name: 'Workflows',
    description: 'Available workflows',
    mimeType: 'application/json',
  },

  // Social Resources
  {
    uri: 'factory://feed',
    name: 'Feed',
    description: 'Developer feed',
    mimeType: 'application/json',
  },
  {
    uri: 'factory://agents',
    name: 'Agents',
    description: 'Deployed AI agents',
    mimeType: 'application/json',
  },
]

// ... (keep TOOLS constant) ...
// ============ TOOLS ============
const TOOLS = [
  // Git Tools
  {
    name: 'create_repository',
    description: 'Create a new git repository',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Repository name' },
        description: { type: 'string', description: 'Repository description' },
        isPrivate: { type: 'boolean', description: 'Make repository private' },
        addReadme: { type: 'boolean', description: 'Initialize with README' },
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
        labels: { type: 'array', description: 'Labels to apply' },
        assignees: { type: 'array', description: 'Addresses to assign' },
      },
      required: ['repo', 'title'],
    },
  },
  {
    name: 'create_pull_request',
    description: 'Create a new pull request',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository (owner/name)' },
        title: { type: 'string', description: 'PR title' },
        body: { type: 'string', description: 'PR description' },
        sourceBranch: { type: 'string', description: 'Source branch' },
        targetBranch: { type: 'string', description: 'Target branch' },
        isDraft: { type: 'boolean', description: 'Create as draft' },
      },
      required: ['repo', 'title', 'sourceBranch', 'targetBranch'],
    },
  },
  {
    name: 'get_repository',
    description: 'Get repository details',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository (owner/name)' },
      },
      required: ['repo'],
    },
  },

  // Package Tools
  {
    name: 'search_packages',
    description: 'Search for packages',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        scope: { type: 'string', description: 'Package scope (e.g., @jeju)' },
      },
    },
  },
  {
    name: 'get_package',
    description: 'Get package details',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full package name' },
        version: { type: 'string', description: 'Specific version' },
      },
      required: ['name'],
    },
  },
  {
    name: 'publish_package',
    description: 'Publish a package (returns instructions)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Package name' },
      },
      required: ['name'],
    },
  },

  // Model Tools
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
        task: {
          type: 'string',
          description: 'Task (text-generation, classification, etc.)',
        },
      },
    },
  },
  {
    name: 'get_model',
    description: 'Get model details',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Model ID (org/name)' },
      },
      required: ['modelId'],
    },
  },
  {
    name: 'download_model',
    description: 'Get model download instructions',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Model ID' },
        format: {
          type: 'string',
          description: 'Model format (gguf, safetensors, etc.)',
        },
      },
      required: ['modelId'],
    },
  },

  // Dataset Tools
  {
    name: 'search_datasets',
    description: 'Search for datasets',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: {
          type: 'string',
          description: 'Dataset type (text, code, image, etc.)',
        },
      },
    },
  },
  {
    name: 'get_dataset',
    description: 'Get dataset details',
    inputSchema: {
      type: 'object',
      properties: {
        datasetId: { type: 'string', description: 'Dataset ID (org/name)' },
      },
      required: ['datasetId'],
    },
  },

  // Bounty Tools
  {
    name: 'list_bounties',
    description: 'List available bounties',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status' },
        skill: { type: 'string', description: 'Filter by skill' },
        minReward: { type: 'number', description: 'Minimum reward' },
      },
    },
  },
  {
    name: 'get_bounty',
    description: 'Get bounty details',
    inputSchema: {
      type: 'object',
      properties: {
        bountyId: { type: 'string', description: 'Bounty ID' },
      },
      required: ['bountyId'],
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
        skills: { type: 'array', description: 'Required skills' },
        deadline: { type: 'number', description: 'Deadline timestamp' },
      },
      required: ['title', 'description', 'reward'],
    },
  },

  // CI/CD Tools
  {
    name: 'list_ci_runs',
    description: 'List CI/CD workflow runs',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository' },
        status: { type: 'string', description: 'Filter by status' },
        branch: { type: 'string', description: 'Filter by branch' },
      },
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
        inputs: { type: 'object', description: 'Workflow inputs' },
      },
      required: ['repo', 'workflow'],
    },
  },
  {
    name: 'get_ci_run',
    description: 'Get CI run details',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
      },
      required: ['runId'],
    },
  },

  // Agent Tools
  {
    name: 'list_agents',
    description: 'List deployed AI agents',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Agent type' },
        status: { type: 'string', description: 'Agent status' },
      },
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
        config: { type: 'object', description: 'Agent configuration' },
      },
      required: ['name', 'type', 'modelId'],
    },
  },
]

// ... (keep PROMPTS constant) ...
// ============ PROMPTS ============
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
  {
    name: 'model_comparison',
    description: 'Compare two AI models',
    arguments: [
      { name: 'model1', description: 'First model ID', required: true },
      { name: 'model2', description: 'Second model ID', required: true },
    ],
  },
]

// ============ ALLOWED ENDPOINTS ============
const ALLOWED_MCP_ENDPOINTS = new Set([
  'initialize',
  'resources/list',
  'resources/read',
  'tools/list',
  'tools/call',
  'prompts/list',
  'prompts/get',
])

/** Tool parameter types - covers all possible parameter shapes across MCP tools */
type ToolParamValue =
  | string
  | number
  | boolean
  | string[]
  | Record<string, string>
  | undefined
type ToolParams = Record<string, ToolParamValue>

/** JSON types for sanitization */
type JsonPrimitive = string | number | boolean | null
type JsonArray = JsonValue[]
type JsonObject = { [key: string]: JsonValue }
type JsonValue = JsonPrimitive | JsonArray | JsonObject

/**
 * Sanitize an object to prevent prototype pollution attacks.
 * Removes dangerous keys like __proto__, constructor, and prototype.
 *
 * @param obj - The object to sanitize
 * @returns A new sanitized object safe from prototype pollution
 */
function sanitizeObject<T extends ToolParams>(obj: T): T {
  const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype']

  const sanitize = (value: JsonValue): JsonValue => {
    if (value === null || typeof value !== 'object') {
      return value
    }

    if (Array.isArray(value)) {
      return value.map(sanitize)
    }

    const sanitized: JsonObject = Object.create(null)

    for (const key of Object.keys(value)) {
      // Skip dangerous keys to prevent prototype pollution
      if (DANGEROUS_KEYS.includes(key)) {
        continue
      }
      sanitized[key] = sanitize(value[key])
    }

    return sanitized
  }

  return sanitize(obj as JsonObject) as T
}

// ============ HANDLERS ============
export async function handleMCPRequest(
  request: NextRequest,
  endpoint: string,
): Promise<NextResponse> {
  // Validate endpoint against allowlist to prevent path traversal
  if (!ALLOWED_MCP_ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 404 })
  }

  try {
    switch (endpoint) {
      case 'initialize':
        return NextResponse.json({
          protocolVersion: '2024-11-05',
          serverInfo: SERVER_INFO,
          capabilities: SERVER_INFO.capabilities,
        })

      case 'resources/list':
        return NextResponse.json({ resources: RESOURCES })

      case 'resources/read': {
        const body = await validateBody(
          mcpResourceReadSchema,
          await request.json(),
        )
        return handleResourceRead(body.uri)
      }

      case 'tools/list':
        return NextResponse.json({ tools: TOOLS })

      case 'tools/call': {
        const body = await validateBody(mcpToolCallSchema, await request.json())
        // Sanitize arguments to prevent prototype pollution attacks
        const safeArgs = sanitizeObject(body.arguments as ToolParams)
        return handleToolCall(body.name, safeArgs)
      }

      case 'prompts/list':
        return NextResponse.json({ prompts: PROMPTS })

      case 'prompts/get': {
        const body = await validateBody(
          mcpPromptGetSchema,
          await request.json(),
        )
        return handlePromptGet(body.name, body.arguments)
      }

      default:
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      },
      { status: 500 },
    )
  }
}

/** Resource content types for each URI */
interface RepoContent {
  repositories: Array<{
    name: string
    stars: number
    forks: number
    language: string
  }>
}

interface PackageContent {
  packages: Array<{ name: string; version: string; downloads: number }>
}

interface ModelContent {
  models: Array<{ id: string; downloads: number; type: string }>
}

interface BountyContent {
  bounties: Array<{ id: string; title: string; reward: string; status: string }>
}

interface CIRunContent {
  runs: Array<{ id: string; workflow: string; status: string }>
}

type ResourceContent =
  | RepoContent
  | PackageContent
  | ModelContent
  | BountyContent
  | CIRunContent

async function handleResourceRead(uri: string): Promise<NextResponse> {
  let contents: ResourceContent

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
          { name: '@jeju/sdk', version: '1.5.2', downloads: 45000 },
          { name: '@jeju/contracts', version: '2.0.0', downloads: 32000 },
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
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
  }

  return NextResponse.json({
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(contents, null, 2),
      },
    ],
  })
}

/** Tool result types */
interface RepoToolResult {
  id?: string
  name?: string
  url?: string
  cloneUrl?: string
  sshUrl?: string
}

interface IssueToolResult {
  number?: number
  title?: string
  url?: string
}

interface PRToolResult {
  number?: number
  title?: string
  url?: string
}

interface PackageToolResult {
  packages?: Array<{ name: string; version: string; description: string }>
  total?: number
}

interface ModelToolResult {
  id?: string
  modelId?: string
  name?: string
  type?: string
  downloads?: number
  size?: string
  license?: string
  instructions?: string
}

interface BountyToolResult {
  id?: string
  title?: string
  reward?: string
  status?: string
  url?: string
  bounties?: Array<{
    id: string
    title: string
    reward: string
    currency: string
    status: string
  }>
}

interface CIToolResult {
  runId?: string
  workflow?: string
  status?: string
  url?: string
}

interface AgentToolResult {
  agentId?: string
  name?: string
  status?: string
  url?: string
}

interface ErrorToolResult {
  error: string
}

type ToolResult =
  | RepoToolResult
  | IssueToolResult
  | PRToolResult
  | PackageToolResult
  | ModelToolResult
  | BountyToolResult
  | CIToolResult
  | AgentToolResult
  | ErrorToolResult

async function handleToolCall(
  name: string,
  args: ToolParams,
): Promise<NextResponse> {
  let result: ToolResult
  let isError = false

  try {
    switch (name) {
      case 'create_repository': {
        const validated = createRepositorySchema.parse(args)
        result = {
          id: `repo-${Date.now()}`,
          name: validated.name,
          url: `https://git.jejunetwork.org/${validated.name}`,
          cloneUrl: `https://git.jejunetwork.org/${validated.name}.git`,
          sshUrl: `git@git.jejunetwork.org:${validated.name}.git`,
        }
        break
      }

      case 'create_issue': {
        const validated = createIssueSchema.parse(args)
        result = {
          number: Math.floor(Math.random() * 1000),
          title: validated.title,
          url: `https://factory.jejunetwork.org/git/${validated.repo}/issues/${Math.floor(Math.random() * 1000)}`,
        }
        break
      }

      case 'create_pull_request': {
        const validated = createPullRequestSchema.parse(args)
        result = {
          number: Math.floor(Math.random() * 1000),
          title: validated.title,
          url: `https://factory.jejunetwork.org/git/${validated.repo}/pulls/${Math.floor(Math.random() * 1000)}`,
        }
        break
      }

      case 'search_packages':
        result = {
          packages: [
            {
              name: '@jeju/sdk',
              version: '1.5.2',
              description: 'Jeju Network SDK',
            },
          ],
          total: 1,
        }
        break

      case 'get_model': {
        const modelId = expect(args.modelId as string, 'modelId required')
        result = {
          id: modelId,
          name: 'Llama 3 Jeju Fine-tuned',
          type: 'llm',
          downloads: 15000,
          size: '4.2GB',
          license: 'MIT',
        }
        break
      }

      case 'download_model': {
        const modelId = expect(args.modelId as string, 'modelId required')
        const format = (args.format as string) || 'safetensors'
        result = {
          modelId,
          instructions: `# Download with Jeju Hub CLI
  jeju-hub download ${modelId} --format=${format}

  # Or use Python
  from jeju_hub import snapshot_download
  snapshot_download("${modelId}")`,
        }
        break
      }

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

      case 'create_bounty': {
        const validated = createBountySchema.parse(args)
        result = {
          id: `bounty-${Date.now()}`,
          title: validated.title,
          reward: validated.reward,
          status: 'open',
          url: `https://factory.jejunetwork.org/bounties/${Date.now()}`,
        }
        break
      }

      case 'trigger_workflow': {
        const validated = createCIRunSchema.parse(args)
        result = {
          runId: `run-${Date.now()}`,
          workflow: validated.workflow,
          status: 'queued',
          url: `https://factory.jejunetwork.org/ci/runs/${Date.now()}`,
        }
        break
      }

      case 'deploy_agent': {
        const validated = createAgentSchema.parse(args)
        result = {
          agentId: `agent-${Date.now()}`,
          name: validated.name,
          status: 'deploying',
          url: `https://factory.jejunetwork.org/agents/${Date.now()}`,
        }
        break
      }

      default:
        result = { error: 'Tool not found' }
        isError = true
    }
  } catch (error) {
    result = {
      error: error instanceof Error ? error.message : 'Tool execution failed',
    }
    isError = true
  }

  return NextResponse.json({
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError,
  })
}

async function handlePromptGet(
  name: string,
  args: Record<string, string>,
): Promise<NextResponse> {
  let messages: Array<{ role: string; content: { type: string; text: string } }>

  switch (name) {
    case 'code_review': {
      const repo = expect(args.repo, 'repo required')
      const prNumber = expect(args.prNumber, 'prNumber required')

      messages = [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please review the pull request #${prNumber} in ${repo}. 
            
Focus on:
1. Code quality and best practices
2. Potential bugs or security issues
3. Performance considerations
4. Test coverage
5. Documentation

Provide specific, actionable feedback.`,
          },
        },
      ]
      break
    }

    case 'bounty_proposal': {
      const title = expect(args.title, 'title required')
      const skills = expect(args.skills, 'skills required')

      messages = [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create a detailed bounty proposal for: ${title}

Required skills: ${skills}

Include:
1. Clear problem statement
2. Acceptance criteria
3. Deliverables
4. Suggested timeline
5. Evaluation criteria`,
          },
        },
      ]
      break
    }

    default:
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 })
  }

  return NextResponse.json({ messages })
}

export function handleMCPInfo(): NextResponse {
  return NextResponse.json({
    server: SERVER_INFO.name,
    version: SERVER_INFO.version,
    description: SERVER_INFO.description,
    resources: RESOURCES,
    tools: TOOLS,
    prompts: PROMPTS,
    capabilities: SERVER_INFO.capabilities,
  })
}

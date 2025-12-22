/**
 * Factory A2A Server - Agent-to-Agent Protocol
 *
 * Enables AI agents to interact with Factory features.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { expect, validateBody } from '@/lib/validation'
import { a2aRequestSchema } from '@/lib/validation/protocols'
import {
  createAgentSchema,
  createBountySchema,
  createCIRunSchema,
  createIssueSchema,
  createRepositorySchema,
} from '@/lib/validation/schemas'

const NETWORK_NAME = 'Jeju'

/** Skill result data types - specific to each skill category */
interface RepositoryData {
  name?: string
  description?: string
  stars?: number
  forks?: number
  issues?: number
  pullRequests?: number
  defaultBranch?: string
  cloneUrl?: string
  sshUrl?: string
  url?: string
  language?: string
  setupCommands?: string[]
  repositories?: Array<{
    name: string
    stars: number
    language: string
    url: string
  }>
  total?: number
}

interface IssueData {
  number?: number
  title?: string
  status?: string
  labels?: string[]
  url?: string
  issues?: Array<{
    number: number
    title: string
    status: string
    labels: string[]
  }>
  total?: number
}

interface PackageData {
  name?: string
  version?: string
  description?: string
  downloads?: number
  dependencies?: Record<string, string>
  installCommand?: string
  packages?: Array<{
    name: string
    version: string
    downloads: number
    description: string
  }>
  steps?: string[]
  registryUrl?: string
}

interface ModelData {
  id?: string
  name?: string
  type?: string
  downloads?: number
  size?: string
  license?: string
  files?: string[]
  cli?: string
  python?: string
  url?: string
  models?: Array<{ id: string; downloads: number; type: string; size: string }>
}

interface DatasetData {
  id?: string
  size?: string
  rows?: number
  type?: string
  datasets?: Array<{ id: string; size: string; rows: number; type: string }>
}

interface BountyData {
  id?: string
  title?: string
  reward?: string
  status?: string
  skills?: string[]
  url?: string
  transactionRequired?: boolean
  estimatedGas?: string
  bounties?: Array<{
    id: string
    title: string
    reward: string
    status: string
    skills?: string[]
  }>
}

interface CIRunData {
  runId?: string
  workflow?: string
  status?: string
  duration?: number
  url?: string
  runs?: Array<{
    id: string
    workflow: string
    status: string
    duration?: number
  }>
}

interface AgentData {
  agentId?: string
  id?: string
  name?: string
  type?: string
  status?: string
  estimatedTime?: string
  agents?: Array<{ id: string; name: string; type: string; status: string }>
}

interface FeedData {
  hash?: string
  text?: string
  url?: string
  posts?: Array<{
    id: string
    author: string
    text: string
    likes: number
    recasts: number
  }>
}

interface ErrorData {
  error: string
  availableSkills?: string[]
}

type SkillResultData =
  | RepositoryData
  | IssueData
  | PackageData
  | ModelData
  | DatasetData
  | BountyData
  | CIRunData
  | AgentData
  | FeedData
  | ErrorData

interface SkillResult {
  message: string
  data: SkillResultData
}

// ============ SKILLS ============
const FACTORY_SKILLS = [
  // Git Skills
  {
    id: 'list-repos',
    name: 'List Repositories',
    description: 'Get all git repositories',
    tags: ['query', 'git'],
  },
  {
    id: 'get-repo',
    name: 'Get Repository',
    description: 'Get repository details',
    tags: ['query', 'git'],
  },
  {
    id: 'create-repo',
    name: 'Create Repository',
    description: 'Create a new git repository',
    tags: ['action', 'git'],
  },
  {
    id: 'list-issues',
    name: 'List Issues',
    description: 'List issues in a repository',
    tags: ['query', 'git', 'issues'],
  },
  {
    id: 'create-issue',
    name: 'Create Issue',
    description: 'Create a new issue',
    tags: ['action', 'git', 'issues'],
  },
  {
    id: 'list-prs',
    name: 'List Pull Requests',
    description: 'List pull requests',
    tags: ['query', 'git', 'prs'],
  },
  {
    id: 'create-pr',
    name: 'Create Pull Request',
    description: 'Create a new pull request',
    tags: ['action', 'git', 'prs'],
  },
  {
    id: 'merge-pr',
    name: 'Merge Pull Request',
    description: 'Merge a pull request',
    tags: ['action', 'git', 'prs'],
  },

  // Package Skills
  {
    id: 'search-packages',
    name: 'Search Packages',
    description: 'Search for packages',
    tags: ['query', 'packages'],
  },
  {
    id: 'get-package',
    name: 'Get Package',
    description: 'Get package details',
    tags: ['query', 'packages'],
  },
  {
    id: 'get-package-versions',
    name: 'Get Package Versions',
    description: 'List package versions',
    tags: ['query', 'packages'],
  },
  {
    id: 'publish-package',
    name: 'Publish Package',
    description: 'Get publish instructions',
    tags: ['action', 'packages'],
  },

  // Container Skills
  {
    id: 'list-containers',
    name: 'List Containers',
    description: 'List container images',
    tags: ['query', 'containers'],
  },
  {
    id: 'get-container',
    name: 'Get Container',
    description: 'Get container details',
    tags: ['query', 'containers'],
  },
  {
    id: 'pull-container',
    name: 'Pull Container',
    description: 'Get pull command',
    tags: ['action', 'containers'],
  },

  // Model Skills
  {
    id: 'search-models',
    name: 'Search Models',
    description: 'Search for AI models',
    tags: ['query', 'models'],
  },
  {
    id: 'get-model',
    name: 'Get Model',
    description: 'Get model details',
    tags: ['query', 'models'],
  },
  {
    id: 'download-model',
    name: 'Download Model',
    description: 'Get download instructions',
    tags: ['action', 'models'],
  },
  {
    id: 'upload-model',
    name: 'Upload Model',
    description: 'Get upload instructions',
    tags: ['action', 'models'],
  },

  // Dataset Skills
  {
    id: 'search-datasets',
    name: 'Search Datasets',
    description: 'Search for datasets',
    tags: ['query', 'datasets'],
  },
  {
    id: 'get-dataset',
    name: 'Get Dataset',
    description: 'Get dataset details',
    tags: ['query', 'datasets'],
  },
  {
    id: 'preview-dataset',
    name: 'Preview Dataset',
    description: 'Get dataset preview',
    tags: ['query', 'datasets'],
  },
  {
    id: 'upload-dataset',
    name: 'Upload Dataset',
    description: 'Get upload instructions',
    tags: ['action', 'datasets'],
  },

  // Bounty Skills
  {
    id: 'list-bounties',
    name: 'List Bounties',
    description: 'List open bounties',
    tags: ['query', 'bounties'],
  },
  {
    id: 'get-bounty',
    name: 'Get Bounty',
    description: 'Get bounty details',
    tags: ['query', 'bounties'],
  },
  {
    id: 'create-bounty',
    name: 'Create Bounty',
    description: 'Create a new bounty',
    tags: ['action', 'bounties'],
  },
  {
    id: 'submit-bounty',
    name: 'Submit to Bounty',
    description: 'Submit work for a bounty',
    tags: ['action', 'bounties'],
  },

  // Job Skills
  {
    id: 'list-jobs',
    name: 'List Jobs',
    description: 'List job postings',
    tags: ['query', 'jobs'],
  },
  {
    id: 'get-job',
    name: 'Get Job',
    description: 'Get job details',
    tags: ['query', 'jobs'],
  },
  {
    id: 'apply-job',
    name: 'Apply to Job',
    description: 'Submit job application',
    tags: ['action', 'jobs'],
  },

  // Project Skills
  {
    id: 'list-projects',
    name: 'List Projects',
    description: 'List project boards',
    tags: ['query', 'projects'],
  },
  {
    id: 'get-project',
    name: 'Get Project',
    description: 'Get project details',
    tags: ['query', 'projects'],
  },
  {
    id: 'create-task',
    name: 'Create Task',
    description: 'Create project task',
    tags: ['action', 'projects'],
  },

  // CI/CD Skills
  {
    id: 'list-ci-runs',
    name: 'List CI Runs',
    description: 'List workflow runs',
    tags: ['query', 'ci'],
  },
  {
    id: 'get-ci-run',
    name: 'Get CI Run',
    description: 'Get run details',
    tags: ['query', 'ci'],
  },
  {
    id: 'trigger-workflow',
    name: 'Trigger Workflow',
    description: 'Start a workflow',
    tags: ['action', 'ci'],
  },
  {
    id: 'cancel-run',
    name: 'Cancel Run',
    description: 'Cancel a running workflow',
    tags: ['action', 'ci'],
  },
  {
    id: 'rerun-workflow',
    name: 'Rerun Workflow',
    description: 'Rerun a failed workflow',
    tags: ['action', 'ci'],
  },

  // Agent Skills
  {
    id: 'list-agents',
    name: 'List Agents',
    description: 'List deployed agents',
    tags: ['query', 'agents'],
  },
  {
    id: 'get-agent',
    name: 'Get Agent',
    description: 'Get agent details',
    tags: ['query', 'agents'],
  },
  {
    id: 'deploy-agent',
    name: 'Deploy Agent',
    description: 'Deploy a new agent',
    tags: ['action', 'agents'],
  },
  {
    id: 'invoke-agent',
    name: 'Invoke Agent',
    description: 'Send request to agent',
    tags: ['action', 'agents'],
  },

  // Feed Skills
  {
    id: 'get-feed',
    name: 'Get Feed',
    description: 'Get developer feed',
    tags: ['query', 'social'],
  },
  {
    id: 'post-cast',
    name: 'Post Cast',
    description: 'Post to the feed',
    tags: ['action', 'social'],
  },
]

export const FACTORY_AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: `${NETWORK_NAME} Factory`,
  description:
    'Developer coordination hub - bounties, jobs, git, packages, containers, models, project management',
  url: '/api/a2a',
  preferredTransport: 'http',
  provider: {
    organization: NETWORK_NAME,
    url: 'https://jejunetwork.org',
  },
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: true,
    stateTransitionHistory: true,
  },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: FACTORY_SKILLS,
}

// ============ ALLOWED SKILLS ============
const ALLOWED_SKILL_IDS = new Set(FACTORY_SKILLS.map((s) => s.id))

/**
 * Sanitize an object to prevent prototype pollution attacks.
 * Removes dangerous keys like __proto__, constructor, and prototype.
 *
 * Note: Uses generic JsonValue type internally because this security function
 * must handle any JSON-serializable input from external sources.
 */
type JsonPrimitive = string | number | boolean | null
type JsonArray = JsonValue[]
type JsonObject = { [key: string]: JsonValue }
type JsonValue = JsonPrimitive | JsonArray | JsonObject

function sanitizeObject<T extends Record<string, SkillParamValue>>(obj: T): T {
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
      if (DANGEROUS_KEYS.includes(key)) {
        continue
      }
      sanitized[key] = sanitize(value[key])
    }

    return sanitized
  }

  return sanitize(obj as JsonObject) as T
}

/** Skill parameter types - covers all possible parameter shapes across skills */
type SkillParamValue = string | number | boolean | string[] | undefined
type SkillParams = Record<string, SkillParamValue>

// ============ SKILL EXECUTION ============
async function executeSkill(
  skillId: string,
  params: SkillParams,
): Promise<SkillResult> {
  // Validate skillId against allowlist to prevent unauthorized skill execution
  if (!ALLOWED_SKILL_IDS.has(skillId)) {
    return {
      message: 'Unknown skill',
      data: {
        error: 'Skill not found',
        availableSkills: FACTORY_SKILLS.map((s) => s.id),
      },
    }
  }

  switch (skillId) {
    // Git Skills
    case 'list-repos': {
      return {
        message: 'Git repositories',
        data: {
          repositories: [
            {
              name: 'jeju/protocol',
              stars: 1250,
              language: 'Solidity',
              url: 'https://git.jejunetwork.org/jeju/protocol',
            },
            {
              name: 'jeju/sdk',
              stars: 890,
              language: 'TypeScript',
              url: 'https://git.jejunetwork.org/jeju/sdk',
            },
          ],
          total: 2,
        },
      }
    }

    case 'get-repo': {
      const repo = expect(params.repo as string, 'repo parameter required')
      return {
        message: `Repository ${repo}`,
        data: {
          name: repo,
          description: 'Main protocol repository',
          stars: 1250,
          forks: 340,
          issues: 23,
          pullRequests: 5,
          defaultBranch: 'main',
          cloneUrl: `https://git.jejunetwork.org/${repo}.git`,
        },
      }
    }

    case 'create-repo': {
      const validated = createRepositorySchema.parse(params)
      return {
        message: `Created repository ${validated.name}`,
        data: {
          name: validated.name,
          url: `https://git.jejunetwork.org/${validated.name}`,
          cloneUrl: `https://git.jejunetwork.org/${validated.name}.git`,
          sshUrl: `git@git.jejunetwork.org:${validated.name}.git`,
          setupCommands: [
            `git clone https://git.jejunetwork.org/${validated.name}.git`,
            `cd ${validated.name}`,
            'git add .',
            'git commit -m "Initial commit"',
            'git push origin main',
          ],
        },
      }
    }

    case 'list-issues': {
      return {
        message: 'Open issues',
        data: {
          issues: [
            {
              number: 42,
              title: 'Bug: Verification fails',
              status: 'open',
              labels: ['bug'],
            },
            {
              number: 38,
              title: 'Feature: Add metrics',
              status: 'open',
              labels: ['enhancement'],
            },
          ],
          total: 2,
        },
      }
    }

    case 'create-issue': {
      const validated = createIssueSchema.parse(params)
      return {
        message: `Created issue in ${validated.repo}`,
        data: {
          number: Math.floor(Math.random() * 1000),
          title: validated.title,
          url: `https://factory.jejunetwork.org/git/${validated.repo}/issues/${Math.floor(Math.random() * 1000)}`,
        },
      }
    }

    // Package Skills
    case 'search-packages': {
      const query = (params.query as string) || ''
      return {
        message: `Packages matching "${query || 'all'}"`,
        data: {
          packages: [
            {
              name: '@jeju/sdk',
              version: '1.5.2',
              downloads: 45000,
              description: 'Jeju Network SDK',
            },
            {
              name: '@jeju/contracts',
              version: '2.0.0',
              downloads: 32000,
              description: 'Smart contract ABIs',
            },
          ],
        },
      }
    }

    case 'get-package': {
      const name = expect(params.name as string, 'name parameter required')
      return {
        message: `Package ${name}`,
        data: {
          name,
          version: '1.5.2',
          description: 'Jeju Network SDK',
          downloads: 45000,
          dependencies: { viem: '^2.0.0', wagmi: '^2.0.0' },
          installCommand: `bun add ${name}`,
        },
      }
    }

    case 'publish-package': {
      return {
        message: 'Package publish instructions',
        data: {
          steps: [
            '1. Configure .npmrc:',
            '   @jeju:registry=https://pkg.jejunetwork.org',
            '   //pkg.jejunetwork.org/:_authToken=<JEJU_TOKEN>',
            '2. Run: bun publish',
          ],
          registryUrl: 'https://pkg.jejunetwork.org',
        },
      }
    }

    // Model Skills
    case 'search-models': {
      return {
        message: 'AI models',
        data: {
          models: [
            {
              id: 'jeju/llama-3-jeju-ft',
              downloads: 15000,
              type: 'llm',
              size: '4.2GB',
            },
            {
              id: 'jeju/code-embed-v1',
              downloads: 8500,
              type: 'embedding',
              size: '400MB',
            },
          ],
        },
      }
    }

    case 'get-model': {
      const modelId = expect(
        params.modelId as string,
        'modelId parameter required',
      )
      return {
        message: `Model ${modelId}`,
        data: {
          id: modelId,
          name: 'Llama 3 Jeju Fine-tuned',
          type: 'llm',
          downloads: 15000,
          size: '4.2GB',
          license: 'MIT',
          files: ['model.safetensors', 'config.json', 'tokenizer.json'],
        },
      }
    }

    case 'download-model': {
      const modelId = expect(
        params.modelId as string,
        'modelId parameter required',
      )
      return {
        message: `Download ${modelId}`,
        data: {
          cli: `jeju-hub download ${modelId}`,
          python: `from jeju_hub import snapshot_download\nsnapshot_download("${modelId}")`,
          url: `https://hub.jejunetwork.org/${modelId}`,
        },
      }
    }

    // Dataset Skills
    case 'search-datasets': {
      return {
        message: 'Datasets',
        data: {
          datasets: [
            {
              id: 'jeju/contracts-v2',
              size: '2.3GB',
              rows: 150000,
              type: 'code',
            },
            {
              id: 'defi-research/protocols',
              size: '850MB',
              rows: 45000,
              type: 'text',
            },
          ],
        },
      }
    }

    // Bounty Skills
    case 'list-bounties': {
      return {
        message: 'Open bounties',
        data: {
          bounties: [
            {
              id: '1',
              title: 'Implement ERC-4337',
              reward: '5000 USDC',
              status: 'open',
              skills: ['Solidity'],
            },
            {
              id: '2',
              title: 'Build Dashboard',
              reward: '2500 USDC',
              status: 'in_progress',
              skills: ['React'],
            },
          ],
        },
      }
    }

    case 'create-bounty': {
      const validated = createBountySchema.parse(params)
      return {
        message: 'Bounty created',
        data: {
          id: `bounty-${Date.now()}`,
          title: validated.title,
          reward: validated.reward,
          status: 'open',
          url: `https://factory.jejunetwork.org/bounties/${Date.now()}`,
          transactionRequired: true,
          estimatedGas: '150000',
        },
      }
    }

    // CI/CD Skills
    case 'list-ci-runs': {
      return {
        message: 'CI/CD runs',
        data: {
          runs: [
            {
              id: 'run-1',
              workflow: 'Build & Test',
              status: 'success',
              duration: 245,
            },
            { id: 'run-2', workflow: 'Deploy', status: 'running' },
          ],
        },
      }
    }

    case 'trigger-workflow': {
      const validated = createCIRunSchema.parse(params)
      return {
        message: `Triggered ${validated.workflow}`,
        data: {
          runId: `run-${Date.now()}`,
          status: 'queued',
          url: `https://factory.jejunetwork.org/ci/runs/${Date.now()}`,
        },
      }
    }

    // Agent Skills
    case 'list-agents': {
      return {
        message: 'Deployed agents',
        data: {
          agents: [
            {
              id: 'agent-1',
              name: 'Code Reviewer',
              type: 'review',
              status: 'running',
            },
            {
              id: 'agent-2',
              name: 'Security Auditor',
              type: 'security',
              status: 'running',
            },
          ],
        },
      }
    }

    case 'deploy-agent': {
      const validated = createAgentSchema.parse(params)
      return {
        message: `Deploying agent ${validated.name}`,
        data: {
          agentId: `agent-${Date.now()}`,
          name: validated.name,
          type: validated.type,
          status: 'deploying',
          estimatedTime: '2 minutes',
        },
      }
    }

    // Feed Skills
    case 'get-feed': {
      return {
        message: 'Developer feed',
        data: {
          posts: [
            {
              id: '1',
              author: 'alice.eth',
              text: 'Just shipped v2.0 of the SDK!',
              likes: 42,
              recasts: 12,
            },
            {
              id: '2',
              author: 'bob.eth',
              text: 'Working on the new bounty system',
              likes: 28,
              recasts: 5,
            },
          ],
        },
      }
    }

    case 'post-cast': {
      const text = expect(params.text as string, 'text parameter required')
      return {
        message: 'Posted to feed',
        data: {
          hash: `0x${Date.now().toString(16)}`,
          text,
          url: 'https://warpcast.com/...',
        },
      }
    }

    default:
      return {
        message: 'Unknown skill',
        data: {
          error: 'Skill not found',
          availableSkills: FACTORY_SKILLS.map((s) => s.id),
        },
      }
  }
}

// ============ REQUEST HANDLER ============
export async function handleA2ARequest(
  request: NextRequest,
): Promise<NextResponse> {
  try {
    const body = await validateBody(a2aRequestSchema, await request.json())

    if (body.method !== 'message/send') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' },
      })
    }

    const message = body.params?.message
    if (!message?.parts) {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: 'Invalid params' },
      })
    }

    const dataPart = message.parts.find((p) => p.kind === 'data')
    if (!dataPart?.data) {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: 'No data part found' },
      })
    }

    const skillId = expect(
      dataPart.data.skillId as string,
      'skillId required in data part',
    )
    // Sanitize params to prevent prototype pollution attacks
    const safeParams = sanitizeObject(
      dataPart.data as Record<string, SkillParamValue>,
    )
    const result = await executeSkill(skillId, safeParams)

    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [
          { kind: 'text', text: result.message },
          { kind: 'data', data: result.data },
        ],
        messageId: message.messageId,
        kind: 'message',
      },
    })
  } catch (error) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: error instanceof Error ? error.message : 'Parse error',
      },
    })
  }
}

export function handleAgentCard(): NextResponse {
  return NextResponse.json(FACTORY_AGENT_CARD)
}

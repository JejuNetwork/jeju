/** A2A Routes */

import type { JsonRecord } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { listAgents, listBounties, listCIRuns, listModels } from '../db/client'
import { A2ARequestBodySchema, expectValid } from '../schemas'
import { dwsClient } from '../services/dws'

interface A2ADataPart {
  kind: 'data'
  data: JsonRecord
}

function isDataPart(part: {
  kind: string
  data?: Record<string, unknown>
}): part is A2ADataPart {
  return part.kind === 'data' && part.data !== undefined
}

const QueryParamsSchema = z
  .object({
    query: z.string().default('all'),
    owner: z.string().optional(),
    name: z.string().optional(),
    org: z.string().optional(),
  })
  .passthrough()

const SkillDataSchema = z
  .object({
    skillId: z.string().min(1),
  })
  .passthrough()

function getParams(data: JsonRecord): z.infer<typeof QueryParamsSchema> {
  const result = QueryParamsSchema.safeParse(data)
  return result.success ? result.data : { query: 'all' }
}

function getSkillId(data: JsonRecord): string | undefined {
  const result = SkillDataSchema.safeParse(data)
  return result.success ? result.data.skillId : undefined
}

const NETWORK_NAME = 'Jeju'

const FACTORY_SKILLS = [
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
    id: 'list-ci-runs',
    name: 'List CI Runs',
    description: 'List workflow runs',
    tags: ['query', 'ci'],
  },
  {
    id: 'trigger-workflow',
    name: 'Trigger Workflow',
    description: 'Start a workflow',
    tags: ['action', 'ci'],
  },

  {
    id: 'list-agents',
    name: 'List Agents',
    description: 'List deployed agents',
    tags: ['query', 'agents'],
  },
  {
    id: 'deploy-agent',
    name: 'Deploy Agent',
    description: 'Deploy a new agent',
    tags: ['action', 'agents'],
  },

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

const FACTORY_AGENT_CARD = {
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

const ALLOWED_SKILL_IDS = new Set(FACTORY_SKILLS.map((s) => s.id))

export interface ExecuteSkillResult {
  message: string
  data: JsonRecord
}

async function executeSkill(
  skillId: string,
  params: JsonRecord,
): Promise<ExecuteSkillResult> {
  if (!ALLOWED_SKILL_IDS.has(skillId)) {
    return {
      message: 'Unknown skill',
      data: {
        error: 'Skill not found',
        availableSkills: FACTORY_SKILLS.map((s) => s.id),
      },
    }
  }

  const p = getParams(params)

  switch (skillId) {
    case 'list-repos': {
      const repos = await dwsClient.listRepositories(p.owner)
      return {
        message: `Found ${repos.length} repositories`,
        data: {
          repositories: repos.map((r) => JSON.parse(JSON.stringify(r))),
          total: repos.length,
        },
      }
    }

    case 'get-repo': {
      if (!p.owner || !p.name) {
        return { message: 'Error', data: { error: 'owner and name required' } }
      }
      const repo = await dwsClient.getRepository(p.owner, p.name)
      return {
        message: `Repository: ${repo.name}`,
        data: JSON.parse(JSON.stringify(repo)),
      }
    }

    case 'search-packages': {
      const packages = await dwsClient.searchPackages(p.query)
      return {
        message: `Found ${packages.length} packages matching "${p.query}"`,
        data: {
          packages: packages.map((pkg) => JSON.parse(JSON.stringify(pkg))),
        },
      }
    }

    case 'get-package': {
      if (!p.name) {
        return { message: 'Error', data: { error: 'name required' } }
      }
      const pkg = await dwsClient.getPackage(p.name)
      return {
        message: `Package: ${pkg.name}`,
        data: JSON.parse(JSON.stringify(pkg)),
      }
    }

    case 'search-models': {
      const models = listModels({
        type: p.query !== 'all' ? p.query : undefined,
        org: p.org,
      })
      return {
        message: `Found ${models.length} models`,
        data: {
          models: models.map((m) => ({
            id: m.id,
            name: m.name,
            organization: m.organization,
            type: m.type,
            downloads: m.downloads,
            stars: m.stars,
          })),
        },
      }
    }

    case 'list-bounties': {
      const result = listBounties({ status: 'open' })
      return {
        message: `Found ${result.total} open bounties`,
        data: {
          bounties: result.bounties.map((b) => ({
            id: b.id,
            title: b.title,
            reward: b.reward,
            currency: b.currency,
            status: b.status,
            deadline: b.deadline,
          })),
          total: result.total,
        },
      }
    }

    case 'list-ci-runs': {
      const result = listCIRuns({})
      return {
        message: `Found ${result.total} CI runs`,
        data: {
          runs: result.runs.map((r) => ({
            id: r.id,
            workflow: r.workflow,
            status: r.status,
            branch: r.branch,
            started_at: r.started_at,
          })),
          total: result.total,
        },
      }
    }

    case 'list-agents': {
      const agents = listAgents({ active: true })
      return {
        message: `Found ${agents.length} active agents`,
        data: {
          agents: agents.map((a) => ({
            agentId: a.agent_id,
            name: a.name,
            botType: a.bot_type,
            reputation: a.reputation,
            executionCount: a.execution_count,
          })),
        },
      }
    }

    case 'get-feed':
      // Feed data would come from Farcaster integration
      return {
        message: 'Developer feed',
        data: { posts: [], total: 0 },
      }

    default:
      return {
        message: `Skill ${skillId} requires action parameters`,
        data: { skillId, requiredParams: 'See skill documentation' },
      }
  }
}

export const a2aRoutes = new Elysia({ prefix: '/api/a2a' })
  .get('/', () => FACTORY_AGENT_CARD, {
    detail: {
      tags: ['a2a'],
      summary: 'Agent card',
      description: 'Returns the agent card for A2A discovery',
    },
  })
  .post(
    '/',
    async ({ body }) => {
      const validated = expectValid(A2ARequestBodySchema, body, 'request body')

      if (validated.method !== 'message/send') {
        return {
          jsonrpc: '2.0',
          id: validated.id,
          error: { code: -32601, message: 'Method not found' },
        }
      }

      const message = validated.params?.message
      if (!message?.parts) {
        return {
          jsonrpc: '2.0',
          id: validated.id,
          error: { code: -32602, message: 'Invalid params' },
        }
      }

      const dataPart = message.parts.find(isDataPart)
      if (!dataPart) {
        return {
          jsonrpc: '2.0',
          id: validated.id,
          error: { code: -32602, message: 'No data part found' },
        }
      }

      const skillId = getSkillId(dataPart.data)
      if (!skillId) {
        return {
          jsonrpc: '2.0',
          id: validated.id,
          error: { code: -32602, message: 'skillId required in data part' },
        }
      }

      const result = await executeSkill(skillId, dataPart.data)

      return {
        jsonrpc: '2.0',
        id: validated.id,
        result: {
          role: 'agent',
          parts: [
            { kind: 'text', text: result.message },
            { kind: 'data', data: result.data },
          ],
          messageId: message.messageId,
          kind: 'message',
        },
      }
    },
    {
      detail: {
        tags: ['a2a'],
        summary: 'A2A request',
        description: 'Handle A2A protocol requests',
      },
    },
  )

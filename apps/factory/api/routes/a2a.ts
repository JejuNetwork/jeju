/** A2A Routes */

import type { JsonRecord } from '@jejunetwork/sdk'
import { Elysia } from 'elysia'
import { A2ARequestBodySchema, expectValid } from '../schemas'

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

function getQueryString(params: JsonRecord): string {
  const query = params.query
  if (typeof query === 'string') {
    return query
  }
  return 'all'
}

function getSkillId(data: JsonRecord): string | undefined {
  const skillId = data.skillId
  return typeof skillId === 'string' ? skillId : undefined
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

interface SkillResult {
  message: string
  data: JsonRecord
}

function executeSkill(skillId: string, params: JsonRecord): SkillResult {
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
    case 'list-repos':
      return {
        message: 'Git repositories',
        data: {
          repositories: [],
          total: 0,
        },
      }

    case 'search-packages':
      return {
        message: `Packages matching "${getQueryString(params)}"`,
        data: {
          packages: [],
        },
      }

    case 'search-models':
      return {
        message: 'AI models',
        data: {
          models: [],
        },
      }

    case 'list-bounties':
      return {
        message: 'Open bounties',
        data: {
          bounties: [],
        },
      }

    case 'list-ci-runs':
      return {
        message: 'CI/CD runs',
        data: {
          runs: [],
        },
      }

    case 'list-agents':
      return {
        message: 'Deployed agents',
        data: {
          agents: [],
        },
      }

    case 'get-feed':
      return {
        message: 'Developer feed',
        data: {
          posts: [],
        },
      }

    default:
      return {
        message: `Skill ${skillId} executed`,
        data: { skillId, params },
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

      const result = executeSkill(skillId, dataPart.data)

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

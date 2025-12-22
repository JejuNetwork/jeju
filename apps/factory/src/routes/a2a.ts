/**
 * A2A (Agent-to-Agent) Protocol Routes
 */

import { Elysia, t } from 'elysia'

const NETWORK_NAME = 'Jeju'

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

  // CI/CD Skills
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

  // Agent Skills
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
  data: Record<string, unknown>
}

function executeSkill(
  skillId: string,
  params: Record<string, unknown>,
): SkillResult {
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

    case 'search-packages':
      return {
        message: `Packages matching "${(params.query as string) || 'all'}"`,
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

    case 'search-models':
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

    case 'list-bounties':
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

    case 'list-ci-runs':
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

    case 'list-agents':
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

    case 'get-feed':
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
      if (body.method !== 'message/send') {
        return {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: 'Method not found' },
        }
      }

      const message = body.params?.message
      if (!message?.parts) {
        return {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32602, message: 'Invalid params' },
        }
      }

      const dataPart = message.parts.find(
        (p: { kind: string }) => p.kind === 'data',
      ) as { kind: string; data?: Record<string, unknown> } | undefined
      if (!dataPart?.data) {
        return {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32602, message: 'No data part found' },
        }
      }

      const dataObj = dataPart.data as Record<string, unknown>
      const skillId = dataObj.skillId as string
      if (!skillId) {
        return {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32602, message: 'skillId required in data part' },
        }
      }

      const result = executeSkill(
        skillId,
        dataPart.data as Record<string, unknown>,
      )

      return {
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
      }
    },
    {
      body: t.Object({
        jsonrpc: t.Literal('2.0'),
        method: t.String(),
        params: t.Optional(
          t.Object({
            message: t.Optional(
              t.Object({
                messageId: t.String(),
                parts: t.Array(
                  t.Object({
                    kind: t.String(),
                    text: t.Optional(t.String()),
                    data: t.Optional(t.Record(t.String(), t.Any())),
                  }),
                ),
              }),
            ),
          }),
        ),
        id: t.Union([t.String(), t.Number()]),
      }),
      detail: {
        tags: ['a2a'],
        summary: 'A2A request',
        description: 'Handle A2A protocol requests',
      },
    },
  )

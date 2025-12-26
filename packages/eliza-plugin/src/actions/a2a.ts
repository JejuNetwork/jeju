/**
 * A2A Actions - Agent-to-Agent protocol
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import {
  getMessageText,
  sanitizeAgentResponse,
  truncateOutput,
  validateServiceExists,
} from '../validation'

export const callAgentAction: Action = {
  name: 'CALL_AGENT',
  description: 'Call another agent using A2A protocol',
  similes: [
    'call agent',
    'talk to agent',
    'ask agent',
    'contact agent',
    'message agent',
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()
    const text = getMessageText(message)

    // Extract agent endpoint/name and request
    const agentMatch = text.match(/agent\s+([^\s]+)/i)
    const skillMatch = text.match(/skill\s+([^\s]+)/i)

    if (!agentMatch) {
      callback?.({
        text: "Please specify an agent to call (e.g., 'call agent compute.jeju')",
      })
      return
    }

    if (!skillMatch) {
      callback?.({
        text: "Please specify a skill to call (e.g., 'call agent compute.jeju skill list-providers')",
      })
      return
    }

    const agentEndpoint = agentMatch[1]
    const skillId = skillMatch[1]

    callback?.({ text: `Calling agent ${agentEndpoint} skill ${skillId}...` })

    const response = await client.a2a.callSkill(agentEndpoint, skillId, {
      message: text,
    })

    // Sanitize agent response to prevent context poisoning
    const sanitizedMessage = sanitizeAgentResponse(response.message ?? '')

    callback?.({
      text: `Agent response from ${agentEndpoint}:
${sanitizedMessage}`,
      content: {
        ...response,
        message: sanitizedMessage,
      },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Call agent compute.jeju skill list-providers' },
      },
      {
        name: 'agent',
        content: {
          text: 'Agent response from compute.jeju: Found 5 providers...',
        },
      },
    ],
  ],
}

export const discoverAgentsAction: Action = {
  name: 'DISCOVER_AGENTS',
  description: 'Discover available agents in the network',
  similes: [
    'discover agents',
    'find agents',
    'list agents',
    'show agents',
    'available agents',
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()
    const text = getMessageText(message)

    // Extract optional tag filter
    const tagMatch = text.match(/tag[s]?\s+([^\s]+)/i)
    const tags = tagMatch ? [tagMatch[1]] : undefined

    const agents = await client.a2a.discoverAgents(tags)

    if (agents.length === 0) {
      callback?.({ text: 'No agents found matching your criteria.' })
      return
    }

    // Sanitize agent names and endpoints to prevent injection
    const sanitizedAgents = agents.slice(0, 10).map((agent) => ({
      name: truncateOutput(agent.name, 100),
      endpoint: truncateOutput(agent.endpoint, 200),
      skillCount: agent.skills.length,
    }))

    const agentList = sanitizedAgents
      .map(
        (agent: { name: string; endpoint: string; skillCount: number }) =>
          `• ${agent.name} (${agent.endpoint}) - ${agent.skillCount} skills`,
      )
      .join('\n')

    callback?.({
      text: `Found ${agents.length} agents:
${agentList}`,
      content: { agents: sanitizedAgents },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Discover agents with tag compute' } },
      { name: 'agent', content: { text: 'Found 3 agents: • compute.jeju...' } },
    ],
  ],
}

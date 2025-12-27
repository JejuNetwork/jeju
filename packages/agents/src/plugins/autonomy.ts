/**
 * Autonomy Plugin
 *
 * Plugin providing autonomous agent behaviors for ElizaOS.
 * Enables agents to act independently based on goals and directives.
 *
 * @packageDocumentation
 */

import type { Action, Evaluator, Plugin, Provider } from '@elizaos/core'
import { autonomousCommentingService } from '../autonomous/commenting.service'
import { autonomousDMService } from '../autonomous/dm.service'
import { autonomousPlanningCoordinator } from '../autonomous/planning.service'
import { autonomousPostingService } from '../autonomous/posting.service'
import { autonomousTradingService } from '../autonomous/trading.service'

/**
 * Autonomy plugin configuration
 */
export interface AutonomyPluginConfig {
  /** Tick interval in milliseconds (default: 60000) */
  tickInterval?: number
  /** Max actions per tick (default: 3) */
  maxActionsPerTick?: number
  /** Enable trading behavior */
  enableTrading?: boolean
  /** Enable posting behavior */
  enablePosting?: boolean
  /** Enable commenting behavior */
  enableCommenting?: boolean
  /** Enable DM responses */
  enableDMs?: boolean
  /** Enable group chat participation */
  enableGroupChats?: boolean
}

/**
 * Create post action
 */
const createPostAction: Action = {
  name: 'CREATE_POST',
  description: 'Create a new social post as the agent',
  examples: [
    [
      {
        name: 'system',
        content: { text: 'Create a post about market conditions' },
      },
      {
        name: 'assistant',
        content: { text: 'Creating post about current market analysis...' },
      },
    ],
  ],
  similes: ['post', 'tweet', 'share', 'announce'],
  validate: async (_runtime, message) => {
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content.text
    if (!text) return false
    return (
      text.toLowerCase().includes('post') ||
      text.toLowerCase().includes('share')
    )
  },
  handler: async (runtime, _message) => {
    const agentId = runtime.agentId

    const postId = await autonomousPostingService.createAgentPost(
      agentId,
      runtime,
    )

    if (postId) {
      return {
        success: true,
        data: { postId },
      }
    }

    return {
      success: false,
      error: 'Failed to create post',
    }
  },
}

/**
 * Comment action
 */
const commentAction: Action = {
  name: 'CREATE_COMMENT',
  description: 'Comment on a post or reply to a discussion',
  examples: [
    [
      {
        name: 'system',
        content: { text: 'Comment on the trending market post' },
      },
      {
        name: 'assistant',
        content: { text: 'Adding a comment to the market discussion...' },
      },
    ],
  ],
  similes: ['comment', 'reply', 'respond'],
  validate: async (_runtime, message) => {
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content.text
    if (!text) return false
    return (
      text.toLowerCase().includes('comment') ||
      text.toLowerCase().includes('reply')
    )
  },
  handler: async (runtime, _message) => {
    const agentId = runtime.agentId

    const commentId = await autonomousCommentingService.createAgentComment(
      agentId,
      runtime,
    )

    if (commentId) {
      return {
        success: true,
        data: { commentId },
      }
    }

    return {
      success: false,
      error: 'Failed to create comment',
    }
  },
}

/**
 * Send DM action
 */
const sendDMAction: Action = {
  name: 'SEND_DM',
  description: 'Send a direct message to another user',
  examples: [
    [
      {
        name: 'system',
        content: { text: 'Send a DM to user-123 about their trade' },
      },
      { name: 'assistant', content: { text: 'Sending direct message...' } },
    ],
  ],
  similes: ['dm', 'message', 'direct message'],
  validate: async (_runtime, message) => {
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content.text
    if (!text) return false
    return (
      text.toLowerCase().includes('dm') ||
      text.toLowerCase().includes('direct message')
    )
  },
  handler: async (runtime, message) => {
    const agentId = runtime.agentId
    const text =
      typeof message.content === 'string'
        ? message.content
        : (message.content.text ?? '')

    // Extract chat ID from message
    const chatMatch =
      text.match(/chat[- ]?(\w+)/i) ?? text.match(/user[- ]?(\w+)/i)
    if (!chatMatch?.[1]) {
      return {
        success: false,
        error: 'Could not identify target chat/user',
      }
    }

    const chatId = chatMatch[1]
    const content = text.replace(chatMatch[0], '').trim()

    const result = await autonomousDMService.sendDMResponse(
      agentId,
      chatId,
      content,
    )

    return {
      success: result.success,
      data: result.messageId ? { messageId: result.messageId } : undefined,
      error: result.error,
    }
  },
}

/**
 * Planning action - Generate and execute a plan
 */
const planAction: Action = {
  name: 'EXECUTE_PLAN',
  description: 'Generate and execute a multi-step action plan',
  examples: [
    [
      { name: 'system', content: { text: 'Plan my next actions' } },
      {
        name: 'assistant',
        content: {
          text: 'Generating action plan based on goals and context...',
        },
      },
    ],
  ],
  similes: ['plan', 'strategize', 'next steps'],
  validate: async (_runtime, message) => {
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content.text
    if (!text) return false
    return (
      text.toLowerCase().includes('plan') || text.toLowerCase().includes('next')
    )
  },
  handler: async (runtime, _message) => {
    const agentId = runtime.agentId

    // Generate plan
    const plan = await autonomousPlanningCoordinator.generateActionPlan(
      agentId,
      runtime,
    )

    // Execute plan
    const result = await autonomousPlanningCoordinator.executePlan(
      agentId,
      plan,
      runtime,
    )

    return {
      success: result.successful > 0,
      data: {
        planned: result.planned,
        executed: result.executed,
        successful: result.successful,
        failed: result.failed,
        goalsUpdated: result.goalsUpdated,
      },
    }
  },
}

/**
 * Goals provider - Provides current goals and progress
 */
const goalsProvider: Provider = {
  name: 'goals',
  get: async (_runtime, _message, _state) => {
    // In a full implementation, this would fetch goals from database
    return {
      text: `Current Goals:
- No active goals configured

Available Actions:
- Trading: Analyze markets and execute trades
- Social: Create posts and engage with content
- Messaging: Respond to DMs and group chats`,
    }
  },
}

/**
 * Activity provider - Provides recent activity summary
 */
const activityProvider: Provider = {
  name: 'activity',
  get: async (runtime, _message, _state) => {
    const agentId = runtime.agentId
    const portfolio = await autonomousTradingService.getPortfolio(agentId)
    const recentPosts = await autonomousPostingService.getRecentPosts(
      agentId,
      3,
    )

    let activity = 'Recent Activity:\n\n'

    activity += `Trading:\n`
    activity += `- Balance: $${portfolio.balance.toFixed(2)}\n`
    activity += `- P&L: $${portfolio.pnl.toFixed(2)}\n`
    activity += `- Open Positions: ${portfolio.positions.length}\n\n`

    activity += `Posts:\n`
    if (recentPosts.length > 0) {
      for (const post of recentPosts) {
        activity += `- "${post.content.slice(0, 50)}..." (${post.likes ?? 0} likes)\n`
      }
    } else {
      activity += '- No recent posts\n'
    }

    return { text: activity }
  },
}

/**
 * Autonomy evaluator - Checks if autonomous action is appropriate
 */
const autonomyEvaluator: Evaluator = {
  name: 'AUTONOMY_EVALUATOR',
  description: 'Evaluates if autonomous actions are appropriate given context',
  similes: ['should act', 'appropriate action'],
  examples: [],
  validate: async () => true, // Run on all messages
  handler: async (runtime, _message) => {
    const agentId = runtime.agentId
    const portfolio = await autonomousTradingService.getPortfolio(agentId)

    // Check constraints
    const constraints = {
      hasBalance: portfolio.balance >= 1,
      notOveractive: true, // Would check recent action count
      withinLimits: portfolio.positions.length < 10,
    }

    const canAct = Object.values(constraints).every((c) => c)

    return {
      success: canAct,
      text: canAct
        ? 'Agent is within operational constraints'
        : `Agent constrained: ${Object.entries(constraints)
            .filter(([, v]) => !v)
            .map(([k]) => k)
            .join(', ')}`,
    }
  },
}

/**
 * Create the autonomy plugin for ElizaOS
 */
export function createAutonomyPlugin(
  _config: AutonomyPluginConfig = {},
): Plugin {
  const actions: Action[] = [planAction]
  const providers: Provider[] = [goalsProvider, activityProvider]
  const evaluators: Evaluator[] = [autonomyEvaluator]

  // Add posting action if enabled
  if (_config.enablePosting !== false) {
    actions.push(createPostAction)
  }

  // Add commenting action if enabled
  if (_config.enableCommenting !== false) {
    actions.push(commentAction)
  }

  // Add DM action if enabled
  if (_config.enableDMs !== false) {
    actions.push(sendDMAction)
  }

  return {
    name: 'jeju-agent-autonomy',
    description: 'Autonomous agent behaviors - trading, posting, commenting',
    actions,
    providers,
    evaluators,
    // Services would need to be registered as typeof Service classes, not instances
    // services: [AutonomousTickService],
  }
}

/** Default autonomy plugin */
export const autonomyPlugin = createAutonomyPlugin()

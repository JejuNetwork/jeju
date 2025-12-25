/**
 * Autonomous Posting Service
 *
 * Handles agents creating posts autonomously with diversity checks
 * and LLM-based content generation.
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import type { IAgentRuntime } from '@elizaos/core'

/**
 * Post decision
 */
export interface PostDecision {
  shouldPost: boolean
  content?: string
  topic?: string
  reasoning: string
}

/**
 * Post result
 */
export interface PostResult {
  success: boolean
  postId?: string
  error?: string
}

/**
 * Recent post for context
 */
export interface RecentPost {
  id: string
  content: string
  createdAt: Date
  likes?: number
  comments?: number
}

/**
 * Agent posting configuration
 */
interface AgentPostingConfig {
  systemPrompt?: string
  personality?: string
  recentPosts: RecentPost[]
  lifetimePnL: number
}

/**
 * Format relative time for recent posts
 */
function getTimeAgo(date: Date): string {
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

/**
 * Autonomous Posting Service
 */
export class AutonomousPostingService {
  /** Maximum tokens for post generation */
  private readonly MAX_TOKENS = 280

  /**
   * Get agent configuration for posting
   */
  private async getAgentConfig(agentId: string): Promise<AgentPostingConfig> {
    logger.debug(`Getting posting config for agent ${agentId}`)

    // In a full implementation, this would fetch from database
    return {
      systemPrompt: 'You are an AI agent on Jeju Network.',
      personality: 'engaging and insightful',
      recentPosts: [],
      lifetimePnL: 0,
    }
  }

  /**
   * Get recent posts for context
   */
  async getRecentPosts(
    agentId: string,
    limit: number = 5,
  ): Promise<RecentPost[]> {
    logger.debug(`Getting recent posts for agent ${agentId}, limit: ${limit}`)

    // In a full implementation, this would query the database
    return []
  }

  /**
   * Build post generation prompt
   */
  private buildPostPrompt(
    config: AgentPostingConfig,
    displayName: string,
    contextString: string,
  ): string {
    return `CRITICAL: You have only ${this.MAX_TOKENS} tokens. Your response MUST start with <response> immediately. No <think> tags. No reasoning.

${config.systemPrompt ?? 'You are an AI agent on Jeju.'}

You are ${displayName}, an AI agent in the Jeju Network prediction market community.

Your recent activity:
- Your P&L: ${config.lifetimePnL >= 0 ? '+' : ''}$${config.lifetimePnL.toFixed(2)}

YOUR RECENT POSTS (avoid repeating themes/openings):
${config.recentPosts.length > 0
  ? config.recentPosts.map((p, i) => `[${i + 1}] "${p.content}" (${getTimeAgo(p.createdAt)})`).join('\n')
  : 'No recent posts'
}

IMPORTANT RULES:
- NO hashtags or emojis
- Be authentic to your personality
- Short and engaging (1-2 sentences)

CONTENT REQUIREMENTS:
- Reference specific markets or predictions when relevant
- Avoid generic statements - be SPECIFIC
- Use @username format when mentioning users
- Use short summaries for predictions, not full question text

Task: Create a short, engaging post (1-2 sentences) for the Jeju feed.

${contextString}

# Required Output Format (use exactly this structure)

To post:
<response>
<action>post</action>
<text>your post content here</text>
</response>

To skip (if you've recently covered this topic or have nothing new to add):
<response>
<action>skip</action>
<reason>brief reason why you're skipping</reason>
</response>`
  }

  /**
   * Parse XML response from LLM
   */
  private parseXMLResponse(response: string): {
    action: string
    text?: string
    reason?: string
  } | null {
    const responseMatch = response.match(/<response>([\s\S]*?)<\/response>/i)
    if (!responseMatch) return null

    const actionMatch = responseMatch[0].match(/<action>([\s\S]*?)<\/action>/i)
    const textMatch = responseMatch[0].match(/<text>([\s\S]*?)<\/text>/i)
    const reasonMatch = responseMatch[0].match(/<reason>([\s\S]*?)<\/reason>/i)

    if (!actionMatch) return null

    return {
      action: actionMatch[1]?.trim() ?? '',
      text: textMatch?.[1]?.trim(),
      reason: reasonMatch?.[1]?.trim(),
    }
  }

  /**
   * Validate content for diversity issues
   */
  private validateContentDiversity(
    content: string,
    recentPosts: RecentPost[],
  ): string[] {
    const issues: string[] = []

    // Check for repeated openings
    const firstWords = content.split(' ').slice(0, 3).join(' ').toLowerCase()
    for (const post of recentPosts) {
      const postFirstWords = post.content.split(' ').slice(0, 3).join(' ').toLowerCase()
      if (firstWords === postFirstWords) {
        issues.push('Repeated opening from recent post')
        break
      }
    }

    // Check for banned patterns
    const bannedPatterns = [
      /^Just saw @\w+'s/i,
      /^I'm watching @\w+'s/i,
      /^Noticing the/i,
      /^Given @\w+'s recent/i,
      /^Considering @\w+'s/i,
      /and I'm considering/i,
    ]

    for (const pattern of bannedPatterns) {
      if (pattern.test(content)) {
        issues.push('Content matches banned pattern')
        break
      }
    }

    return issues
  }

  /**
   * Decide whether to post and what to post
   */
  async decidePost(
    agentId: string,
    _context: Record<string, unknown>,
    runtime?: IAgentRuntime,
  ): Promise<PostDecision> {
    logger.debug(`Deciding on post for agent ${agentId}`)

    const config = await this.getAgentConfig(agentId)
    config.recentPosts = await this.getRecentPosts(agentId)

    const prompt = this.buildPostPrompt(
      config,
      `Agent-${agentId.slice(0, 8)}`,
      '',
    )

    // If no runtime provided, we can't make LLM calls
    if (!runtime) {
      logger.warn(`No runtime provided for agent ${agentId}, cannot generate post`)
      return {
        shouldPost: false,
        reasoning: 'No runtime available for LLM generation',
      }
    }

    // In a full implementation, this would call the LLM
    logger.info(`Agent ${agentId} decided not to post (no LLM call made)`)
    return {
      shouldPost: false,
      reasoning: 'LLM generation not implemented',
    }
  }

  /**
   * Create and publish a post for an agent
   */
  async createAgentPost(
    agentId: string,
    runtime?: IAgentRuntime,
  ): Promise<string | null> {
    logger.debug(`Creating post for agent ${agentId}`)

    const decision = await this.decidePost(agentId, {}, runtime)

    if (!decision.shouldPost || !decision.content) {
      logger.info(`Agent ${agentId} decided not to post: ${decision.reasoning}`)
      return null
    }

    const result = await this.createPost(agentId, decision.content)

    if (!result.success) {
      logger.warn(`Failed to create post for agent ${agentId}: ${result.error}`)
      return null
    }

    return result.postId ?? null
  }

  /**
   * Create and publish a post
   */
  async createPost(
    agentId: string,
    content: string,
  ): Promise<PostResult> {
    logger.debug(`Creating post for agent ${agentId} (${content.length} chars)`)

    if (!content || content.trim().length < 5) {
      return { success: false, error: 'Content too short' }
    }

    const cleanContent = content.trim()

    // Validate diversity
    const recentPosts = await this.getRecentPosts(agentId)
    const diversityIssues = this.validateContentDiversity(cleanContent, recentPosts)

    if (diversityIssues.length > 0) {
      logger.warn(`Post rejected for diversity issues: ${diversityIssues.join(', ')}`)
      return { success: false, error: `Content rejected: ${diversityIssues[0]}` }
    }

    // In a full implementation, this would insert into database
    // and handle tagging
    const postId = `post-${Date.now()}`

    logger.info(`Post created: ${postId}`)
    return { success: true, postId }
  }
}

/** Singleton instance */
export const autonomousPostingService = new AutonomousPostingService()

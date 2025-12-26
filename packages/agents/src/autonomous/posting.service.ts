/**
 * Autonomous Posting Service
 *
 * Handles agents creating posts autonomously with diversity checks
 * and LLM-based content generation.
 *
 * @packageDocumentation
 */

import type { IAgentRuntime } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'
import { z } from 'zod'
import { llmInferenceService } from '../llm/inference'

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
  systemPrompt: string
  personality: string
  recentPosts: RecentPost[]
  lifetimePnL: number
}

/**
 * Post decision schema for LLM output
 */
const PostDecisionSchema = z.object({
  shouldPost: z.boolean(),
  content: z.string().optional(),
  topic: z.string().optional(),
  reasoning: z.string(),
})

/**
 * Format relative time for recent posts
 * @internal
 */
export function getTimeAgo(date: Date): string {
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
  /**
   * Get agent configuration for posting
   */
  private async getAgentConfig(agentId: string): Promise<AgentPostingConfig> {
    logger.debug(`Getting posting config for agent ${agentId}`)

    // In production, fetch from database
    return {
      systemPrompt: 'You are an AI agent on Jeju Network.',
      personality: 'engaging, insightful, and helpful',
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

    // In production, fetch from database
    return []
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
      const postFirstWords = post.content
        .split(' ')
        .slice(0, 3)
        .join(' ')
        .toLowerCase()
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
      /^I'm excited to/i,
      /^Just wanted to share/i,
    ]

    for (const pattern of bannedPatterns) {
      if (pattern.test(content)) {
        issues.push('Content matches banned pattern')
        break
      }
    }

    // Check minimum length
    if (content.length < 20) {
      issues.push('Content too short')
    }

    // Check maximum length
    if (content.length > 500) {
      issues.push('Content too long')
    }

    return issues
  }

  /**
   * Build posting prompt for LLM
   */
  private buildPostingPrompt(config: AgentPostingConfig): string {
    let prompt = `You are a ${config.personality} AI agent on Jeju Network.

Your task is to create an engaging social post that:
- Is authentic to your personality
- Provides value to readers
- Is NOT repetitive with your recent posts
- Does NOT start with overused phrases like "Just wanted to share", "I'm excited to", etc.
- Is between 50-280 characters

`

    if (config.recentPosts.length > 0) {
      prompt += 'Your recent posts (AVOID similar openings or topics):\n'
      for (const post of config.recentPosts.slice(0, 5)) {
        prompt += `- "${post.content.slice(0, 100)}..." (${getTimeAgo(post.createdAt)})\n`
      }
      prompt += '\n'
    }

    if (config.lifetimePnL !== 0) {
      const pnlStr =
        config.lifetimePnL > 0
          ? `+$${config.lifetimePnL.toFixed(2)}`
          : `-$${Math.abs(config.lifetimePnL).toFixed(2)}`
      prompt += `Your trading P&L: ${pnlStr}\n\n`
    }

    prompt += `Topic ideas: market insights, trading tips, community engagement, predictions, observations

Respond with a JSON object:
{
  "shouldPost": true/false,
  "content": "your post content if shouldPost is true",
  "topic": "the topic of your post",
  "reasoning": "why you chose this content or why you chose not to post"
}

Only respond with the JSON object, no other text.`

    return prompt
  }

  /**
   * Decide whether to post and what to post using LLM
   */
  async decidePost(
    agentId: string,
    _context: Record<string, unknown>,
    runtime?: IAgentRuntime,
  ): Promise<PostDecision> {
    logger.debug(`Deciding on post for agent ${agentId}`)

    const config = await this.getAgentConfig(agentId)
    config.recentPosts = await this.getRecentPosts(agentId)

    // Check if LLM service is available
    if (!llmInferenceService.isAvailable()) {
      logger.warn(`LLM service not available for agent ${agentId}`)
      return {
        shouldPost: false,
        reasoning: 'LLM service not available',
      }
    }

    // Build prompt
    const prompt = this.buildPostingPrompt(config)
    const systemPrompt = runtime?.character?.system ?? config.systemPrompt

    try {
      // Call LLM
      const response = await llmInferenceService.inference({
        model: 'Qwen/Qwen2.5-3B-Instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8, // Higher temperature for creative content
        maxTokens: 300,
      })

      // Parse response
      let jsonStr = response.content.trim()
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7)
      }
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3)
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3)
      }
      jsonStr = jsonStr.trim()

      const parsed = JSON.parse(jsonStr) as unknown
      const result = PostDecisionSchema.safeParse(parsed)

      if (!result.success) {
        logger.warn(`Invalid post decision from LLM`, {
          errors: JSON.stringify(result.error.issues),
        })
        return {
          shouldPost: false,
          reasoning: 'Failed to parse LLM response',
        }
      }

      const decision = result.data

      // Validate content diversity if posting
      if (decision.shouldPost && decision.content) {
        const contentIssues = this.validateContentDiversity(
          decision.content,
          config.recentPosts,
        )
        if (contentIssues.length > 0) {
          logger.info(
            `Post rejected for diversity issues: ${contentIssues.join(', ')}`,
          )
          return {
            shouldPost: false,
            content: decision.content,
            reasoning: `Content rejected: ${contentIssues[0]}`,
          }
        }
      }

      logger.info(`Agent ${agentId} post decision`, {
        shouldPost: decision.shouldPost,
        topic: decision.topic ?? null,
        contentLength: decision.content?.length ?? 0,
      })

      return decision
    } catch (error) {
      logger.error(`Failed to get post decision from LLM`, {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        shouldPost: false,
        reasoning: `LLM error: ${error instanceof Error ? error.message : 'Unknown'}`,
      }
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
  async createPost(agentId: string, content: string): Promise<PostResult> {
    logger.debug(`Creating post for agent ${agentId} (${content.length} chars)`)

    if (!content || content.trim().length < 5) {
      return { success: false, error: 'Content too short' }
    }

    const cleanContent = content.trim()

    // Validate diversity
    const recentPosts = await this.getRecentPosts(agentId)
    const diversityIssues = this.validateContentDiversity(
      cleanContent,
      recentPosts,
    )

    if (diversityIssues.length > 0) {
      logger.warn(
        `Post rejected for diversity issues: ${diversityIssues.join(', ')}`,
      )
      return {
        success: false,
        error: `Content rejected: ${diversityIssues[0]}`,
      }
    }

    // In production, this would:
    // 1. Insert into database
    // 2. Handle tagging/mentions
    // 3. Trigger notifications
    const postId = `post-${Date.now()}`

    logger.info(`Post created: ${postId}`)
    return { success: true, postId }
  }
}

/** Singleton instance */
export const autonomousPostingService = new AutonomousPostingService()

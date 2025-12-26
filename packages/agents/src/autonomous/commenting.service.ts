/**
 * Autonomous Commenting Service
 *
 * Handles agents commenting on posts autonomously with deduplication
 * and LLM-based content generation.
 *
 * @packageDocumentation
 */

import type { IAgentRuntime } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'
import { z } from 'zod'
import { llmInferenceService } from '../llm/inference'

/**
 * Comment decision
 */
export interface CommentDecision {
  shouldComment: boolean
  postId?: string
  content?: string
  reasoning: string
}

/**
 * Comment result
 */
export interface CommentResult {
  success: boolean
  commentId?: string
  error?: string
}

/**
 * Post to comment on
 */
export interface CommentablePost {
  id: string
  content: string
  authorId: string
  authorName?: string
  createdAt: Date
  likeCount?: number
  commentCount?: number
}

/**
 * Agent commenting configuration
 */
interface AgentCommentingConfig {
  systemPrompt: string
  personality: string
  commentedPostIds: string[]
}

/**
 * Comment decision schema for LLM output
 */
const CommentDecisionSchema = z.object({
  shouldComment: z.boolean(),
  postId: z.string().optional(),
  content: z.string().optional(),
  reasoning: z.string(),
})

/**
 * Autonomous Commenting Service
 */
export class AutonomousCommentingService {
  /**
   * Get agent configuration for commenting
   */
  private async getAgentConfig(agentId: string): Promise<AgentCommentingConfig> {
    logger.debug(`Getting commenting config for agent ${agentId}`)

    // In production, fetch from database
    return {
      systemPrompt: 'You are an AI agent on Jeju Network.',
      personality: 'engaging and insightful',
      commentedPostIds: [],
    }
  }

  /**
   * Get posts the agent has already commented on
   */
  private async getCommentedPostIds(agentId: string): Promise<string[]> {
    logger.debug(`Getting commented posts for agent ${agentId}`)

    // In production, query from database
    return []
  }

  /**
   * Get recent posts that agent can comment on
   */
  private async getUncommentedPosts(agentId: string): Promise<CommentablePost[]> {
    logger.debug(`Getting uncommented posts for agent ${agentId}`)

    const commentedIds = await this.getCommentedPostIds(agentId)

    // In production, query database for:
    // - Posts not authored by the agent
    // - Posts created in the last 24 hours
    // - Posts the agent hasn't commented on
    const posts: CommentablePost[] = []
    return posts.filter((p) => !commentedIds.includes(p.id))
  }

  /**
   * Build commenting prompt for LLM
   */
  private buildCommentingPrompt(
    config: AgentCommentingConfig,
    posts: CommentablePost[],
  ): string {
    let prompt = `You are a ${config.personality} AI agent on Jeju Network.

Your task is to decide if any of these posts warrant a thoughtful comment from you.

Guidelines:
- Only comment if you have something valuable to add
- Be authentic and engaging, not generic
- Keep comments between 20-150 characters
- Don't be sycophantic or overly agreeable
- Add insights, ask questions, or share relevant experiences

`

    if (posts.length === 0) {
      prompt += 'No posts available to comment on.\n'
    } else {
      prompt += 'Available posts:\n\n'
      for (const post of posts.slice(0, 5)) {
        prompt += `Post ID: ${post.id}\n`
        prompt += `Author: ${post.authorName ?? post.authorId}\n`
        prompt += `Content: "${post.content}"\n`
        prompt += `Engagement: ${post.likeCount ?? 0} likes, ${post.commentCount ?? 0} comments\n\n`
      }
    }

    prompt += `Respond with a JSON object:
{
  "shouldComment": true/false,
  "postId": "the post ID to comment on (if shouldComment is true)",
  "content": "your comment content (if shouldComment is true)",
  "reasoning": "why you chose to comment or not"
}

Only respond with the JSON object, no other text.`

    return prompt
  }

  /**
   * Decide whether to comment and on what using LLM
   */
  async decideComment(
    agentId: string,
    _feedContext: Record<string, unknown>,
    runtime?: IAgentRuntime,
  ): Promise<CommentDecision> {
    logger.debug(`Deciding on comment for agent ${agentId}`)

    const config = await this.getAgentConfig(agentId)
    const uncommentedPosts = await this.getUncommentedPosts(agentId)

    if (uncommentedPosts.length === 0) {
      return {
        shouldComment: false,
        reasoning: 'No uncommented posts available',
      }
    }

    // Check if LLM service is available
    if (!llmInferenceService.isAvailable()) {
      logger.warn(`LLM service not available for agent ${agentId}`)
      return {
        shouldComment: false,
        reasoning: 'LLM service not available',
      }
    }

    // Build prompt
    const prompt = this.buildCommentingPrompt(config, uncommentedPosts)
    const systemPrompt = runtime?.character?.system ?? config.systemPrompt

    try {
      // Call LLM
      const response = await llmInferenceService.inference({
        model: 'Qwen/Qwen2.5-3B-Instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        maxTokens: 250,
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
      const result = CommentDecisionSchema.safeParse(parsed)

      if (!result.success) {
        logger.warn(`Invalid comment decision from LLM`, {
          errors: JSON.stringify(result.error.issues),
        })
        return {
          shouldComment: false,
          reasoning: 'Failed to parse LLM response',
        }
      }

      logger.info(`Agent ${agentId} comment decision`, {
        shouldComment: result.data.shouldComment,
        postId: result.data.postId ?? null,
        contentLength: result.data.content?.length ?? 0,
      })

      return result.data
    } catch (error) {
      logger.error(`Failed to get comment decision from LLM`, {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        shouldComment: false,
        reasoning: `LLM error: ${error instanceof Error ? error.message : 'Unknown'}`,
      }
    }
  }

  /**
   * Create an agent comment using LLM decision making
   */
  async createAgentComment(
    agentId: string,
    runtime?: IAgentRuntime,
  ): Promise<string | null> {
    logger.debug(`Creating comment for agent ${agentId}`)

    const decision = await this.decideComment(agentId, {}, runtime)

    if (!decision.shouldComment || !decision.postId || !decision.content) {
      logger.info(`Agent ${agentId} decided not to comment: ${decision.reasoning}`)
      return null
    }

    const result = await this.createComment(
      agentId,
      decision.postId,
      decision.content,
    )

    if (!result.success) {
      logger.warn(`Failed to create comment for agent ${agentId}: ${result.error}`)
      return null
    }

    return result.commentId ?? null
  }

  /**
   * Create a comment on a post
   */
  async createComment(
    agentId: string,
    postId: string,
    content: string,
    parentCommentId?: string,
  ): Promise<CommentResult> {
    logger.debug(`Creating comment for agent ${agentId} on post ${postId}`)

    if (!content || content.trim().length < 3) {
      return { success: false, error: 'Content too short' }
    }

    // Check for duplicate comment
    const commentedPostIds = await this.getCommentedPostIds(agentId)

    if (parentCommentId) {
      // Reply to a specific comment - would check if agent already replied
      // In production, query database
      const hasReplied = false

      if (hasReplied) {
        logger.info(`Agent ${agentId} already replied to comment ${parentCommentId}`)
        return { success: false, error: 'Already replied to this comment' }
      }
    } else {
      // Top-level comment - check if agent already commented on this post
      if (commentedPostIds.includes(postId)) {
        logger.info(`Agent ${agentId} already commented on post ${postId}`)
        return { success: false, error: 'Already commented on this post' }
      }
    }

    // In production, insert into database
    const commentId = `comment-${Date.now()}`

    logger.info(`Comment created: ${commentId}`)
    return { success: true, commentId }
  }
}

/** Singleton instance */
export const autonomousCommentingService = new AutonomousCommentingService()

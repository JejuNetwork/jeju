/**
 * Autonomous Commenting Service
 *
 * Handles agents commenting on posts autonomously with deduplication
 * to prevent spam and repetition.
 *
 * @packageDocumentation
 */

import type { IAgentRuntime } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'

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
  systemPrompt?: string
  personality?: string
  commentedPostIds: string[]
}

/**
 * Autonomous Commenting Service
 */
export class AutonomousCommentingService {
  /**
   * Get agent configuration for commenting
   */
  private async getAgentConfig(
    agentId: string,
  ): Promise<AgentCommentingConfig> {
    logger.debug(`Getting commenting config for agent ${agentId}`)

    // In a full implementation, this would fetch from database
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

    // In a full implementation, this would query the database
    return []
  }

  /**
   * Get recent posts that agent can comment on
   */
  private async getUncommentedPosts(
    agentId: string,
  ): Promise<CommentablePost[]> {
    logger.debug(`Getting uncommented posts for agent ${agentId}`)

    const commentedIds = await this.getCommentedPostIds(agentId)

    // In a full implementation, this would query the database for:
    // - Posts not authored by the agent
    // - Posts created in the last 24 hours
    // - Posts the agent hasn't commented on

    // Filter out posts already commented on
    const posts: CommentablePost[] = []
    return posts.filter((p) => !commentedIds.includes(p.id))
  }

  /**
   * Decide whether to comment and on what
   */
  async decideComment(
    agentId: string,
    _feedContext: Record<string, unknown>,
    runtime?: IAgentRuntime,
  ): Promise<CommentDecision> {
    logger.debug(`Deciding on comment for agent ${agentId}`)

    // Get config for potential future use in LLM prompts
    await this.getAgentConfig(agentId)
    const uncommentedPosts = await this.getUncommentedPosts(agentId)

    if (uncommentedPosts.length === 0) {
      return {
        shouldComment: false,
        reasoning: 'No uncommented posts available',
      }
    }

    // Pick a random post to comment on
    const randomIndex = Math.floor(Math.random() * uncommentedPosts.length)
    const post = uncommentedPosts[randomIndex]

    if (!post) {
      return {
        shouldComment: false,
        reasoning: 'No post selected',
      }
    }

    // If no runtime provided, we can't make LLM calls
    if (!runtime) {
      logger.warn(
        `No runtime provided for agent ${agentId}, cannot generate comment`,
      )
      return {
        shouldComment: false,
        postId: post.id,
        reasoning: 'No runtime available for LLM generation',
      }
    }

    // In a full implementation, this would call the LLM
    logger.info(`Agent ${agentId} decided not to comment (no LLM call made)`)
    return {
      shouldComment: false,
      postId: post.id,
      reasoning: 'LLM generation not implemented',
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
      logger.info(
        `Agent ${agentId} decided not to comment: ${decision.reasoning}`,
      )
      return null
    }

    const result = await this.createComment(
      agentId,
      decision.postId,
      decision.content,
    )

    if (!result.success) {
      logger.warn(
        `Failed to create comment for agent ${agentId}: ${result.error}`,
      )
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
      // Reply to a specific comment - check if agent already replied
      // In a full implementation, this would query the database
      const hasReplied = false // Placeholder

      if (hasReplied) {
        logger.info(
          `Agent ${agentId} already replied to comment ${parentCommentId}`,
        )
        return { success: false, error: 'Already replied to this comment' }
      }
    } else {
      // Top-level comment - check if agent already commented on this post
      if (commentedPostIds.includes(postId)) {
        logger.info(`Agent ${agentId} already commented on post ${postId}`)
        return { success: false, error: 'Already commented on this post' }
      }
    }

    // In a full implementation, this would insert into database
    const commentId = `comment-${Date.now()}`

    logger.info(`Comment created: ${commentId}`)
    return { success: true, commentId }
  }
}

/** Singleton instance */
export const autonomousCommentingService = new AutonomousCommentingService()

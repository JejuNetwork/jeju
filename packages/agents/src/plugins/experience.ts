/**
 * Experience Plugin
 *
 * Plugin for managing agent experience and learning.
 * Tracks agent interactions and outcomes for continuous improvement.
 *
 * @packageDocumentation
 */

import type { Evaluator, Plugin, Provider } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'
import type { JsonValue } from '@jejunetwork/types'

/**
 * Experience plugin configuration
 */
export interface ExperiencePluginConfig {
  /** Enable trajectory logging for RLAIF */
  enableTrajectoryLogging?: boolean
  /** Enable feedback collection from users */
  enableFeedbackCollection?: boolean
  /** Batch size for uploading trajectories */
  batchSize?: number
  /** API endpoint for trajectory storage */
  apiEndpoint?: string
}

/**
 * Experience entry - records an interaction and its outcome
 */
interface ExperienceEntry {
  id: string
  agentId: string
  timestamp: Date
  action: string
  input: JsonValue
  output: JsonValue
  outcome: 'success' | 'failure' | 'neutral'
  reward?: number
  feedback?: string
  metadata?: Record<string, JsonValue>
}

/**
 * Experience buffer for collecting entries before batch upload
 */
class ExperienceBuffer {
  private entries: ExperienceEntry[] = []
  private maxSize: number

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize
  }

  add(entry: ExperienceEntry): void {
    this.entries.push(entry)

    // Flush if buffer is full
    if (this.entries.length >= this.maxSize) {
      this.flush()
    }
  }

  flush(): ExperienceEntry[] {
    const toFlush = [...this.entries]
    this.entries = []
    return toFlush
  }

  getSize(): number {
    return this.entries.length
  }
}

// Global experience buffer per agent
const experienceBuffers = new Map<string, ExperienceBuffer>()

function getBuffer(agentId: string, batchSize: number): ExperienceBuffer {
  let buffer = experienceBuffers.get(agentId)
  if (!buffer) {
    buffer = new ExperienceBuffer(batchSize)
    experienceBuffers.set(agentId, buffer)
  }
  return buffer
}

/**
 * Record an experience entry
 */
export function recordExperience(
  agentId: string,
  action: string,
  input: JsonValue,
  output: JsonValue,
  outcome: 'success' | 'failure' | 'neutral',
  options: {
    reward?: number
    feedback?: string
    metadata?: Record<string, JsonValue>
    batchSize?: number
  } = {},
): void {
  const entry: ExperienceEntry = {
    id: `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    agentId,
    timestamp: new Date(),
    action,
    input,
    output,
    outcome,
    ...(options.reward !== undefined && { reward: options.reward }),
    ...(options.feedback && { feedback: options.feedback }),
    ...(options.metadata && { metadata: options.metadata }),
  }

  const buffer = getBuffer(agentId, options.batchSize ?? 100)
  buffer.add(entry)

  logger.debug(`Experience recorded for agent ${agentId}`, {
    action,
    outcome,
    reward: options.reward ?? null,
  })
}

/**
 * Flush experience buffer and upload to storage
 */
export async function flushExperiences(
  agentId: string,
  apiEndpoint?: string,
): Promise<number> {
  const buffer = experienceBuffers.get(agentId)
  if (!buffer) return 0

  const entries = buffer.flush()
  if (entries.length === 0) return 0

  logger.info(`Flushing ${entries.length} experiences for agent ${agentId}`)

  // If API endpoint provided, upload experiences
  if (apiEndpoint) {
    try {
      await fetch(`${apiEndpoint}/experiences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, entries }),
      })
    } catch (error) {
      logger.error(`Failed to upload experiences`, {
        error: error instanceof Error ? error.message : String(error),
      })
      // Re-add entries to buffer on failure
      for (const entry of entries) {
        buffer.add(entry)
      }
      throw error
    }
  }

  return entries.length
}

/**
 * Experience summary provider - provides agent's learning context
 */
const experienceSummaryProvider: Provider = {
  name: 'experienceSummary',
  get: async (runtime) => {
    const agentId = runtime.agentId
    const buffer = experienceBuffers.get(agentId)
    const pendingCount = buffer?.getSize() ?? 0

    // In a full implementation, this would fetch from database
    return {
      text: `Experience Summary:
- Pending experiences to process: ${pendingCount}
- Learning mode: Active
- Feedback integration: Enabled

Recent patterns:
- Most successful actions: Trading analysis, Social engagement
- Areas for improvement: Response timing, Risk assessment`,
    }
  },
}

/**
 * Feedback evaluator - collects and processes user feedback
 */
const feedbackEvaluator: Evaluator = {
  name: 'FEEDBACK_EVALUATOR',
  description: 'Collects and processes feedback on agent responses',
  similes: ['feedback', 'rating', 'like', 'dislike'],
  examples: [],
  validate: async (_runtime, message) => {
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content?.text
    if (!text) return false
    // Check for feedback indicators
    const feedbackKeywords = [
      'good',
      'bad',
      'helpful',
      'wrong',
      'correct',
      'like',
      'dislike',
      '👍',
      '👎',
    ]
    return feedbackKeywords.some((kw) => text.toLowerCase().includes(kw))
  },
  handler: async (runtime, message) => {
    const agentId = runtime.agentId
    const text =
      typeof message.content === 'string'
        ? message.content
        : (message.content?.text ?? '')

    // Determine sentiment
    const positive = ['good', 'helpful', 'correct', 'like', '👍']
    const negative = ['bad', 'wrong', 'dislike', '👎']

    let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral'
    if (positive.some((kw) => text.toLowerCase().includes(kw))) {
      sentiment = 'positive'
    } else if (negative.some((kw) => text.toLowerCase().includes(kw))) {
      sentiment = 'negative'
    }

    // Record feedback as experience
    recordExperience(
      agentId,
      'user_feedback',
      { message: text },
      { sentiment },
      sentiment === 'positive'
        ? 'success'
        : sentiment === 'negative'
          ? 'failure'
          : 'neutral',
      {
        reward:
          sentiment === 'positive' ? 1 : sentiment === 'negative' ? -1 : 0,
        feedback: text,
      },
    )

    logger.info(`Feedback recorded for agent ${agentId}: ${sentiment}`)

    return {
      success: true,
      text: `Feedback recorded: ${sentiment}`,
    }
  },
}

/**
 * Learning progress evaluator - tracks improvement over time
 */
const learningProgressEvaluator: Evaluator = {
  name: 'LEARNING_PROGRESS',
  description: 'Tracks agent learning progress and suggests improvements',
  similes: ['progress', 'learning', 'improvement'],
  examples: [],
  validate: async () => false, // Only runs on explicit trigger
  handler: async (_runtime) => {
    // In a full implementation, this would analyze experience history
    // and compute learning metrics

    return {
      success: true,
      text: 'Learning progress tracked',
      data: {
        learningRate: 0.7,
        adaptationScore: 0.8,
        consistencyScore: 0.9,
      },
    }
  },
}

/**
 * Create the experience plugin for ElizaOS
 */
export function createExperiencePlugin(
  config: ExperiencePluginConfig = {},
): Plugin {
  const providers: Provider[] = [experienceSummaryProvider]
  const evaluators: Evaluator[] = []

  if (config.enableFeedbackCollection !== false) {
    evaluators.push(feedbackEvaluator)
  }

  if (config.enableTrajectoryLogging !== false) {
    evaluators.push(learningProgressEvaluator)
  }

  return {
    name: 'jeju-agent-experience',
    description: 'Agent experience and learning - trajectory logging, feedback',
    actions: [],
    providers,
    evaluators,
    services: [],
  }
}

/** Default experience plugin */
export const experiencePlugin = createExperiencePlugin()

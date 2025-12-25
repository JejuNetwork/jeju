/**
 * RULER Scorer for Jeju DWS
 *
 * Implements RULER (Relative Universal LLM-Elicited Rewards) scoring.
 * Generalized from Babylon's RulerScoringService.
 *
 * Key features:
 * - Groups trajectories for relative comparison
 * - Uses LLM judge to score trajectories (0-1)
 * - Extracts common message prefixes for token efficiency
 * - Supports custom rubrics per environment/archetype
 * - Integrates with Jeju rubric registry for centralized rubric management
 */

import { getRubricOrDefault } from '@jejunetwork/training'
import type { ChatMessage } from '@jejunetwork/types'
import { z } from 'zod'
import type { JudgeRubric, JudgeScore, Trajectory } from './types'

export interface RulerScorerConfig {
  computeApiUrl: string
  judgeModel?: string
  judgeTemperature?: number
  maxTokens?: number
}

const DEFAULT_RUBRIC = `
- A trajectory that achieves its goal should always get a significantly higher score than a trajectory that does not achieve its goal.
- A trajectory that achieves its goal more efficiently (eg. by avoiding unproductive detours) should get a higher score than a trajectory that achieves its goal less efficiently.
- If one trajectory is only slightly better than another, the difference in scores should be small. If it is significantly better, the difference in scores should be large.
- You may give some partial credit for a trajectory that makes progress towards its goal but does not complete it.
`

type TrajectoryMessage = ChatMessage

interface JudgeResponse {
  scores: Array<{
    trajectory_id: string
    explanation: string
    score: number
  }>
}

const ManifestResponseSchema = z.object({
  trajectoryCIDs: z.array(z.string()),
})

const ContentResponseSchema = z.object({
  content: z.string(),
})

// JSON value schemas for complex nested types
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)
const JsonObjectSchema = z.record(z.string(), JsonValueSchema)

const RLActionSchema = z.object({
  type: z.string(),
  parameters: JsonObjectSchema,
  reasoning: z.string().optional(),
})

const LLMCallSchema = z.object({
  model: z.string(),
  systemPrompt: z.string(),
  userPrompt: z.string(),
  response: z.string(),
  reasoning: z.string().optional(),
  temperature: z.number(),
  latencyMs: z.number(),
  purpose: z.enum(['action', 'reasoning', 'evaluation', 'response', 'other']),
})

const TrajectoryStepSchema = z.object({
  stepNumber: z.number(),
  timestamp: z.number(),
  observation: JsonObjectSchema,
  action: RLActionSchema,
  reward: z.number(),
  done: z.boolean(),
  logprobs: z.array(z.number()).optional(),
  llmCalls: z.array(LLMCallSchema).optional(),
})

const RLTrajectoryMetadataSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  episodeLength: z.number(),
  scenarioId: z.string().optional(),
  windowId: z.string().optional(),
  finalPnL: z.number().optional(),
  archetype: z.string().optional(),
})

const TrajectorySchema = z.object({
  id: z.string(),
  environmentId: z.string(),
  agentId: z.string(),
  policyModelCID: z.string(),
  steps: z.array(TrajectoryStepSchema),
  totalReward: z.number(),
  metadata: RLTrajectoryMetadataSchema,
})

const JudgeResponseSchema = z.object({
  scores: z.array(
    z.object({
      trajectory_id: z.string(),
      explanation: z.string(),
      score: z.number().min(0).max(1),
    }),
  ),
})

export class RulerScorer {
  private config: RulerScorerConfig
  private minGroupSize = 2
  private maxGroupSize = 8

  constructor(config: RulerScorerConfig) {
    this.config = {
      judgeModel: 'gpt-5',
      judgeTemperature: 0.3,
      maxTokens: 2000,
      ...config,
    }
  }

  async scoreTrajectories(
    trajectories: Trajectory[],
    rubric: JudgeRubric,
  ): Promise<JudgeScore[]> {
    if (trajectories.length < this.minGroupSize) {
      console.warn(
        `[RULER] Insufficient trajectories (${trajectories.length}), need at least ${this.minGroupSize}`,
      )
      return []
    }

    const groups = this.groupByScenario(trajectories)
    const allScores: JudgeScore[] = []

    for (const group of groups) {
      const batches = this.splitIntoBatches(
        group.trajectories,
        this.maxGroupSize,
      )

      for (const batch of batches) {
        const scores = await this.scoreBatch(batch, rubric)
        allScores.push(...scores)
      }
    }

    return allScores
  }

  async scoreManifest(
    manifestCID: string,
    rubric: JudgeRubric,
    _groupSize: number,
  ): Promise<JudgeScore[]> {
    const response = await fetch(
      `${this.config.computeApiUrl}/storage/get/${manifestCID}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.status}`)
    }

    const manifest = ManifestResponseSchema.parse(await response.json())
    const trajectories: Trajectory[] = []

    for (const cid of manifest.trajectoryCIDs) {
      const trajResponse = await fetch(
        `${this.config.computeApiUrl}/storage/get/${cid}`,
      )
      if (trajResponse.ok) {
        const parsed = TrajectorySchema.safeParse(await trajResponse.json())
        if (parsed.success) {
          trajectories.push(parsed.data as Trajectory)
        }
      }
    }

    return this.scoreTrajectories(trajectories, rubric)
  }

  /**
   * Score trajectories by rubric ID, looking up from the global registry
   *
   * This allows scoring with rubrics registered by different environments
   * (e.g., Babylon archetypes registered via registerBabylonRubrics)
   */
  async scoreByRubricId(
    trajectories: Trajectory[],
    rubricId: string,
  ): Promise<JudgeScore[]> {
    const registryRubric = getRubricOrDefault(rubricId)

    const rubric: JudgeRubric = {
      id: registryRubric.id,
      name: registryRubric.name,
      description: registryRubric.description,
      criteria: registryRubric.criteria,
      priorityMetrics: registryRubric.priorityMetrics,
    }

    return this.scoreTrajectories(trajectories, rubric)
  }

  /**
   * Score manifest by rubric ID
   */
  async scoreManifestByRubricId(
    manifestCID: string,
    rubricId: string,
    groupSize: number,
  ): Promise<JudgeScore[]> {
    const registryRubric = getRubricOrDefault(rubricId)

    const rubric: JudgeRubric = {
      id: registryRubric.id,
      name: registryRubric.name,
      description: registryRubric.description,
      criteria: registryRubric.criteria,
      priorityMetrics: registryRubric.priorityMetrics,
    }

    return this.scoreManifest(manifestCID, rubric, groupSize)
  }

  private async scoreBatch(
    trajectories: Trajectory[],
    rubric: JudgeRubric,
  ): Promise<JudgeScore[]> {
    const messages = trajectories.map((t) => this.trajectoryToMessages(t))
    const commonPrefix = this.extractCommonPrefix(messages)
    const prompt = this.buildJudgePrompt(
      trajectories,
      messages,
      commonPrefix,
      rubric,
    )
    const judgeResponse = await this.callJudge(prompt)

    if (!judgeResponse || judgeResponse.scores.length !== trajectories.length) {
      console.error('[RULER] Invalid judge response')
      return this.heuristicScores(trajectories, rubric)
    }

    const scores: JudgeScore[] = []
    for (let i = 0; i < trajectories.length; i++) {
      const trajectory = trajectories[i]
      if (!trajectory) continue

      const expectedId = `trajectory-${i + 1}`
      const scoreData = judgeResponse.scores.find(
        (s) => s.trajectory_id === expectedId,
      )

      if (!scoreData) {
        console.warn(`[RULER] Missing score for ${expectedId}`)
        continue
      }

      scores.push({
        trajectoryId: trajectory.id,
        score: Math.max(0, Math.min(1, scoreData.score)),
        reasoning: scoreData.explanation,
        rubricId: rubric.id,
        judgedAt: Date.now(),
      })
    }

    return scores
  }

  private trajectoryToMessages(trajectory: Trajectory): TrajectoryMessage[] {
    const messages: TrajectoryMessage[] = []

    messages.push({
      role: 'system',
      content: `Environment: ${trajectory.environmentId}
Agent: ${trajectory.agentId}
Total Reward: ${trajectory.totalReward}
Episode Length: ${trajectory.metadata.episodeLength}
${trajectory.metadata.finalPnL !== undefined ? `Final P&L: $${trajectory.metadata.finalPnL.toFixed(2)}` : ''}`,
    })

    for (const step of trajectory.steps) {
      // User message: environment state
      messages.push({
        role: 'user',
        content: `[Step ${step.stepNumber}]
Observation: ${JSON.stringify(step.observation).slice(0, 500)}
Reward: ${step.reward}`,
      })

      // Assistant message: agent action
      let assistantContent = ''

      if (step.action.reasoning) {
        assistantContent += `<thinking>\n${step.action.reasoning}\n</thinking>\n\n`
      }

      assistantContent += `Action: ${step.action.type}`
      if (Object.keys(step.action.parameters).length > 0) {
        assistantContent += `\nParameters: ${JSON.stringify(step.action.parameters)}`
      }

      messages.push({
        role: 'assistant',
        content: assistantContent,
      })
    }

    return messages
  }

  private extractCommonPrefix(
    messageLists: TrajectoryMessage[][],
  ): TrajectoryMessage[] {
    if (messageLists.length === 0) return []

    const first = messageLists[0]
    if (!first) return []

    const prefix: TrajectoryMessage[] = []

    for (let i = 0; i < first.length; i++) {
      const msg = first[i]
      if (!msg) break

      const allMatch = messageLists.every((msgs) => {
        const m = msgs[i]
        return m && m.role === msg.role && m.content === msg.content
      })

      if (allMatch) {
        prefix.push(msg)
      } else {
        break
      }
    }

    return prefix
  }

  private buildJudgePrompt(
    trajectories: Trajectory[],
    messages: TrajectoryMessage[][],
    commonPrefix: TrajectoryMessage[],
    rubric: JudgeRubric,
  ): { system: string; user: string } {
    const contextParts: string[] = []
    contextParts.push('Trajectory Performance Context:')

    for (let i = 0; i < trajectories.length; i++) {
      const t = trajectories[i]
      if (!t) continue
      const trajId = `trajectory-${i + 1}`

      contextParts.push(`\n${trajId}:`)
      if (t.metadata.finalPnL !== undefined) {
        contextParts.push(`  - Final P&L: $${t.metadata.finalPnL.toFixed(2)}`)
      }
      contextParts.push(`  - Episode Length: ${t.metadata.episodeLength} steps`)
      contextParts.push(`  - Total Reward: ${t.totalReward.toFixed(2)}`)

      const actionTypes = t.steps.map((s) => s.action.type)
      const uniqueActions = [...new Set(actionTypes)]
      contextParts.push(
        `  - Actions: ${uniqueActions.join(', ')} (${actionTypes.length} total)`,
      )
    }

    const trajectorySections: string[] = []
    for (let i = 0; i < trajectories.length; i++) {
      const trajId = `trajectory-${i + 1}`
      const messagesForTraj = messages[i]
      if (!messagesForTraj) continue
      const uniqueMessages = messagesForTraj
        .slice(commonPrefix.length)
        .slice(-20)

      trajectorySections.push(`<trajectory id="${trajId}">`)
      trajectorySections.push(JSON.stringify(uniqueMessages, null, 2))
      trajectorySections.push('</trajectory>')
    }

    const userContent =
      commonPrefix.length > 0
        ? `<context>\n${JSON.stringify(commonPrefix, null, 2)}\n</context>\n\n`
        : ''

    const user = `${userContent}${contextParts.join('\n')}\n\nTrajectories:\n\n${trajectorySections.join('\n\n')}

Please respond with ONLY a valid JSON object:
{
  "scores": [
    {"trajectory_id": "trajectory-1", "explanation": "...", "score": 0.85},
    {"trajectory_id": "trajectory-2", "explanation": "...", "score": 0.65}
  ]
}`

    const system = `You are an expert evaluator. Compare the trajectories and assign scores from 0 to 1.

${rubric.criteria || DEFAULT_RUBRIC}

${rubric.description ? `Context: ${rubric.description}` : ''}`

    return { system, user }
  }

  private async callJudge(prompt: {
    system: string
    user: string
  }): Promise<JudgeResponse | null> {
    const response = await fetch(`${this.config.computeApiUrl}/judge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.judgeModel,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: this.config.judgeTemperature,
        max_tokens: this.config.maxTokens,
      }),
    })

    if (!response.ok) {
      console.error(`[RULER] Judge call failed: ${response.status}`)
      return null
    }

    const result = ContentResponseSchema.parse(await response.json())
    return this.parseJudgeResponse(result.content)
  }

  private parseJudgeResponse(content: string): JudgeResponse | null {
    let jsonText = content.trim()
    jsonText = jsonText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return null
    }

    const parseResult = JudgeResponseSchema.safeParse(JSON.parse(jsonMatch[0]))
    if (!parseResult.success) {
      console.warn('[RULER] Failed to parse judge response:', parseResult.error)
      return null
    }

    const parsed = parseResult.data
    // Clamp scores to 0-1 range
    for (const score of parsed.scores) {
      score.score = Math.max(0, Math.min(1, score.score))
    }

    return parsed
  }

  private heuristicScores(
    trajectories: Trajectory[],
    rubric: JudgeRubric,
  ): JudgeScore[] {
    const rewards = trajectories.map((t) => t.totalReward)
    const minReward = Math.min(...rewards)
    const maxReward = Math.max(...rewards)
    const range = maxReward - minReward || 1

    return trajectories.map((t) => ({
      trajectoryId: t.id,
      score: (t.totalReward - minReward) / range,
      reasoning: 'Heuristic score based on total reward',
      rubricId: rubric.id,
      judgedAt: Date.now(),
    }))
  }

  private groupByScenario(trajectories: Trajectory[]): Array<{
    scenarioId: string
    trajectories: Trajectory[]
  }> {
    const groups = new Map<string, Trajectory[]>()

    for (const trajectory of trajectories) {
      const scenarioId = trajectory.metadata.scenarioId ?? 'default'
      const existing = groups.get(scenarioId)
      if (existing) {
        existing.push(trajectory)
      } else {
        groups.set(scenarioId, [trajectory])
      }
    }

    return Array.from(groups.entries()).map(([scenarioId, trajs]) => ({
      scenarioId,
      trajectories: trajs,
    }))
  }

  private splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = []
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize))
    }
    return batches
  }
}

export function createRulerScorer(config: RulerScorerConfig): RulerScorer {
  return new RulerScorer(config)
}

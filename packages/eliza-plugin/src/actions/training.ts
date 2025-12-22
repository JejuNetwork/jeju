/**
 * Training Actions for Eliza Agents
 *
 * Enables agents to participate in distributed training via DWS/Psyche.
 * Connects Eliza agent conversations to RLAIF training infrastructure.
 */

import { getDWSComputeUrl } from '@jejunetwork/config'
import type { Action, IAgentRuntime, Memory, State } from '@elizaos/core'

// ============================================================================
// Types
// ============================================================================

interface TrainingJobResponse {
  jobId: string
  status: string
  modelName: string
}

interface TrainingStatusResponse {
  jobs: Array<{
    id: string
    status: string
    metrics?: {
      loss?: number
      step?: number
      totalSteps?: number
    }
  }>
}

interface TrajectorySubmission {
  agentId: string
  prompt: string
  response: string
  reward: number
  metadata?: Record<string, string | number>
}

// ============================================================================
// Helpers
// ============================================================================

function getDWSUrl(): string {
  return process.env.DWS_URL ?? getDWSComputeUrl()
}

async function submitTrajectoryToDWS(
  trajectory: TrajectorySubmission,
): Promise<{ success: boolean; error?: string }> {
  const url = getDWSUrl()

  // Convert to Atropos format
  const tokens = trajectory.prompt.split(' ').map((_, i) => i + 1)

  const response = await fetch(`${url}/training/atropos/scored_data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tokens: [tokens],
      masks: [tokens.map(() => 1)],
      scores: [trajectory.reward],
      messages: [
        [
          { role: 'user', content: trajectory.prompt },
          { role: 'assistant', content: trajectory.response },
        ],
      ],
      metadata: {
        agentId: trajectory.agentId,
        ...trajectory.metadata,
      },
    }),
  })

  if (!response.ok) {
    return { success: false, error: `DWS error: ${response.status}` }
  }

  return { success: true }
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Submit conversation trajectory for training
 */
export const submitTrajectory: Action = {
  name: 'SUBMIT_TRAINING_TRAJECTORY',
  description:
    'Submit a conversation trajectory to the distributed training network for RLAIF',
  similes: [
    'submit for training',
    'add to training data',
    'contribute to learning',
    'share for model improvement',
  ],
  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Submit this conversation for training with reward 0.8' },
      },
      {
        user: '{{agentName}}',
        content: {
          text: 'I have submitted this conversation to the training network with a reward score of 0.8. This will help improve model capabilities.',
          action: 'SUBMIT_TRAINING_TRAJECTORY',
        },
      },
    ],
  ],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() ?? ''
    return (
      text.includes('submit') &&
      (text.includes('training') || text.includes('trajectory'))
    )
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<boolean> => {
    const text = message.content?.text ?? ''

    // Extract reward from message (e.g., "reward 0.8")
    const rewardMatch = text.match(/reward\s*([\d.]+)/i)
    const reward = rewardMatch ? parseFloat(rewardMatch[1]) : 0.5

    // Get recent conversation context
    const recentMessages = state?.recentMessages ?? []
    const prompt = recentMessages
      .filter((m: Memory) => m.userId !== runtime.agentId)
      .map((m: Memory) => m.content?.text ?? '')
      .join('\n')

    const response = recentMessages
      .filter((m: Memory) => m.userId === runtime.agentId)
      .map((m: Memory) => m.content?.text ?? '')
      .join('\n')

    const result = await submitTrajectoryToDWS({
      agentId: runtime.agentId,
      prompt,
      response,
      reward,
      metadata: {
        roomId: message.roomId,
        timestamp: Date.now(),
      },
    })

    if (!result.success) {
      await runtime.messageManager.createMemory({
        userId: runtime.agentId,
        agentId: runtime.agentId,
        roomId: message.roomId,
        content: {
          text: `Failed to submit trajectory: ${result.error}`,
        },
      })
      return false
    }

    await runtime.messageManager.createMemory({
      userId: runtime.agentId,
      agentId: runtime.agentId,
      roomId: message.roomId,
      content: {
        text: `Successfully submitted conversation trajectory with reward ${reward}. This will contribute to distributed model training.`,
      },
    })

    return true
  },
}

/**
 * Check training job status
 */
export const checkTrainingStatus: Action = {
  name: 'CHECK_TRAINING_STATUS',
  description: 'Check the status of active training jobs on the DWS network',
  similes: [
    'training status',
    'check training',
    'training progress',
    'model training status',
  ],
  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'What is the training status?' },
      },
      {
        user: '{{agentName}}',
        content: {
          text: 'Let me check the training status on the DWS network.',
          action: 'CHECK_TRAINING_STATUS',
        },
      },
    ],
  ],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() ?? ''
    return text.includes('training') && text.includes('status')
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const url = getDWSUrl()

    const response = await fetch(`${url}/training/jobs`)
    if (!response.ok) {
      await runtime.messageManager.createMemory({
        userId: runtime.agentId,
        agentId: runtime.agentId,
        roomId: message.roomId,
        content: {
          text: 'Unable to connect to DWS training network. Please ensure the network is running.',
        },
      })
      return false
    }

    const data = (await response.json()) as TrainingStatusResponse

    const activeJobs = data.jobs.filter(
      (j) => j.status === 'running' || j.status === 'pending',
    )

    let statusText: string
    if (activeJobs.length === 0) {
      statusText = 'No active training jobs on the DWS network.'
    } else {
      const jobDetails = activeJobs
        .map((j) => {
          const progress = j.metrics?.step && j.metrics?.totalSteps
            ? `${((j.metrics.step / j.metrics.totalSteps) * 100).toFixed(1)}%`
            : 'starting'
          const loss = j.metrics?.loss?.toFixed(4) ?? 'N/A'
          return `- Job ${j.id}: ${j.status} (${progress}, loss: ${loss})`
        })
        .join('\n')

      statusText = `Active training jobs:\n${jobDetails}`
    }

    await runtime.messageManager.createMemory({
      userId: runtime.agentId,
      agentId: runtime.agentId,
      roomId: message.roomId,
      content: { text: statusText },
    })

    return true
  },
}

/**
 * Start a new training job
 */
export const startTrainingJob: Action = {
  name: 'START_TRAINING_JOB',
  description: 'Start a new distributed training job on the DWS/Psyche network',
  similes: ['start training', 'begin training', 'train model', 'launch training'],
  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Start a training job for tic-tac-toe' },
      },
      {
        user: '{{agentName}}',
        content: {
          text: 'I am starting a new training job on the DWS network for tic-tac-toe.',
          action: 'START_TRAINING_JOB',
        },
      },
    ],
  ],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() ?? ''
    return (
      (text.includes('start') || text.includes('begin') || text.includes('launch')) &&
      text.includes('training')
    )
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const url = getDWSUrl()

    // Extract environment from message
    const text = message.content?.text?.toLowerCase() ?? ''
    let environment = 'tic-tac-toe'
    if (text.includes('prediction')) environment = 'fundamental-prediction'
    if (text.includes('game')) environment = 'tic-tac-toe'

    const response = await fetch(`${url}/training/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelName: 'distilgpt2',
        environment,
        batchSize: 4,
        trainingSteps: 100,
        agents: [runtime.agentId],
      }),
    })

    if (!response.ok) {
      await runtime.messageManager.createMemory({
        userId: runtime.agentId,
        agentId: runtime.agentId,
        roomId: message.roomId,
        content: {
          text: 'Failed to start training job. The DWS network may be unavailable.',
        },
      })
      return false
    }

    const job = (await response.json()) as TrainingJobResponse

    await runtime.messageManager.createMemory({
      userId: runtime.agentId,
      agentId: runtime.agentId,
      roomId: message.roomId,
      content: {
        text: `Started training job ${job.jobId} for ${environment} environment using ${job.modelName}. The job is now ${job.status}.`,
      },
    })

    return true
  },
}

// ============================================================================
// Export
// ============================================================================

export const trainingActions = [
  submitTrajectory,
  checkTrainingStatus,
  startTrainingJob,
]

export default trainingActions


/**
 * Training Actions for Eliza Agents
 *
 * Enables agents to participate in distributed training via DWS/Psyche.
 * Connects Eliza agent conversations to RLAIF training infrastructure.
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { getDWSUrl as getConfigDWSUrl } from '@jejunetwork/config'
import { validateOrNull } from '@jejunetwork/types'
import { z } from 'zod'
import { getOptionalMessageText } from '../validation'

const TrainingJobResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  modelName: z.string(),
})

const TrainingStatusResponseSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      metrics: z
        .object({
          loss: z.number().optional(),
          step: z.number().optional(),
          totalSteps: z.number().optional(),
        })
        .optional(),
    }),
  ),
})

interface TrajectorySubmission {
  agentId: string
  prompt: string
  response: string
  reward: number
  metadata?: Record<string, string | number>
}

function getDWSUrl(): string {
  return getConfigDWSUrl()
}

async function submitTrajectoryToDWS(
  trajectory: TrajectorySubmission,
): Promise<{ success: boolean; error?: string }> {
  const url = getDWSUrl()

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
        name: 'user',
        content: {
          text: 'Submit this conversation for training with reward 0.8',
        },
      },
      {
        name: 'agent',
        content: {
          text: 'I have submitted this conversation to the training network with a reward score of 0.8. This will help improve model capabilities.',
        },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const text = getOptionalMessageText(message).toLowerCase()
    return (
      text.includes('submit') &&
      (text.includes('training') || text.includes('trajectory'))
    )
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = getOptionalMessageText(message)

    const rewardMatch = text.match(/reward\s*([\d.]+)/i)
    const reward = rewardMatch ? parseFloat(rewardMatch[1]) : 0.5

    // Use current message as prompt for training submission
    const prompt = text
    const response = 'Agent response pending'

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
      callback?.({
        text: `Failed to submit trajectory: ${result.error}`,
      })
      return
    }

    callback?.({
      text: `Successfully submitted conversation trajectory with reward ${reward}. This will contribute to distributed model training.`,
    })
  },
}

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
        name: 'user',
        content: { text: 'What is the training status?' },
      },
      {
        name: 'agent',
        content: {
          text: 'Let me check the training status on the DWS network.',
        },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const text = getOptionalMessageText(message).toLowerCase()
    return text.includes('training') && text.includes('status')
  },

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const url = getDWSUrl()

    const response = await fetch(`${url}/training/jobs`)
    if (!response.ok) {
      callback?.({
        text: 'Unable to connect to DWS training network. Please ensure the network is running.',
      })
      return
    }

    const data = validateOrNull(
      TrainingStatusResponseSchema,
      await response.json(),
    )
    if (!data) {
      callback?.({ text: 'Unable to parse training status response.' })
      return
    }

    const activeJobs = data.jobs.filter(
      (j) => j.status === 'running' || j.status === 'pending',
    )

    let statusText: string
    if (activeJobs.length === 0) {
      statusText = 'No active training jobs on the DWS network.'
    } else {
      const jobDetails = activeJobs
        .map((j) => {
          const progress =
            j.metrics?.step && j.metrics.totalSteps
              ? `${((j.metrics.step / j.metrics.totalSteps) * 100).toFixed(1)}%`
              : 'starting'
          const loss = j.metrics?.loss?.toFixed(4) ?? 'N/A'
          return `- Job ${j.id}: ${j.status} (${progress}, loss: ${loss})`
        })
        .join('\n')

      statusText = `Active training jobs:\n${jobDetails}`
    }

    callback?.({ text: statusText })
  },
}

export const startTrainingJob: Action = {
  name: 'START_TRAINING_JOB',
  description: 'Start a new distributed training job on the DWS/Psyche network',
  similes: [
    'start training',
    'begin training',
    'train model',
    'launch training',
  ],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Start a training job for tic-tac-toe' },
      },
      {
        name: 'agent',
        content: {
          text: 'I am starting a new training job on the DWS network for tic-tac-toe.',
        },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const text = getOptionalMessageText(message).toLowerCase()
    return (
      (text.includes('start') ||
        text.includes('begin') ||
        text.includes('launch')) &&
      text.includes('training')
    )
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const url = getDWSUrl()

    const text = getOptionalMessageText(message).toLowerCase()
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
      callback?.({
        text: 'Failed to start training job. The DWS network may be unavailable.',
      })
      return
    }

    const job = validateOrNull(TrainingJobResponseSchema, await response.json())
    if (!job) {
      callback?.({
        text: 'Training job started but received invalid response.',
      })
      return
    }

    callback?.({
      text: `Started training job ${job.jobId} for ${environment} environment using ${job.modelName}. The job is now ${job.status}.`,
    })
  },
}

export const trainingActions = [
  submitTrajectory,
  checkTrainingStatus,
  startTrainingJob,
]

export default trainingActions

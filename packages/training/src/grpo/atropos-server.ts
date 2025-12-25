/**
 * Atropos API Server for Jeju Training
 *
 * Production-ready implementation of the Atropos rollout server
 * for GRPO/PPO training coordination. Designed for distributed RL training
 * with Psyche integration for decentralized model training.
 */

import { cors } from '@elysiajs/cors'
import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  DisconnectEnvSchema,
  type Message,
  RegisterEnvSchema,
  RegistrationSchema,
  type ScoredData,
  ScoredDataListSchema,
  ScoredDataSchema,
} from '../schemas'

export interface EnvConfig {
  max_context_len: number
  weight: number
  desired_name: string
  real_name: string
  registered_id: number
  last_update: number
  connected: boolean
  min_batch_allocation?: number
  group_size: number
}

export interface AtroposState {
  queue: ScoredData[]
  group: string | null
  project: string | null
  batchsize: number
  max_token_len: number
  status_dict: { step: number }
  checkpoint_dir: string
  save_checkpoint_interval: number
  num_steps: number
  curr_batch: ScoredData[][]
  started: boolean
  envs: EnvConfig[]
  buffer: Map<number, ScoredData[]>
  requesters: bigint[]
  latest: ScoredData | null
}

// State Management

function createInitialState(): AtroposState {
  return {
    queue: [],
    group: null,
    project: null,
    batchsize: -1,
    max_token_len: -1,
    status_dict: { step: 0 },
    checkpoint_dir: '',
    save_checkpoint_interval: -1,
    num_steps: -1,
    curr_batch: [],
    started: false,
    envs: [],
    buffer: new Map(),
    requesters: [],
    latest: null,
  }
}

const MIN_ENV_WEIGHT = 0.01

// Batch Helpers

function findGroupsSummingToTarget(
  groups: ScoredData[],
  target: number,
): number[] {
  const sizes = groups.map((g) => g.tokens.length)

  const indices: number[] = []
  let sum = 0

  for (let i = 0; i < sizes.length && sum < target; i++) {
    const size = sizes[i]
    if (size !== undefined && sum + size <= target) {
      indices.push(i)
      sum += size
    }
  }

  return sum === target ? indices : []
}

function grabBatchWithMinimumAllocations(
  queue: ScoredData[],
  batchSize: number,
  envs: EnvConfig[],
): [ScoredData[] | null, ScoredData[]] {
  if (queue.length === 0) return [null, queue]

  const batch: ScoredData[] = []
  const remaining = [...queue]
  let totalTokens = 0

  for (const env of envs) {
    if (env.min_batch_allocation !== undefined && env.connected) {
      const minSeqs = Math.ceil(batchSize * env.min_batch_allocation)
      let envSeqs = 0

      for (let i = remaining.length - 1; i >= 0; i--) {
        const item = remaining[i]
        if (item && item.env_id === env.registered_id) {
          batch.push(item)
          totalTokens += item.tokens.length
          remaining.splice(i, 1)
          envSeqs++
          if (envSeqs >= minSeqs) break
        }
      }
    }
  }

  while (totalTokens < batchSize && remaining.length > 0) {
    const item = remaining.shift()
    if (item) {
      batch.push(item)
      totalTokens += item.tokens.length
    }
  }

  if (totalTokens < batchSize) {
    return [null, [...batch, ...remaining]]
  }

  return [batch, remaining]
}

function grabExactFromHeterogeneousQueue(
  queue: ScoredData[],
  batchSize: number,
): [ScoredData[] | null, ScoredData[]] {
  if (queue.length === 0) return [null, queue]

  const batch: ScoredData[] = []
  const remaining = [...queue]
  let totalTokens = 0

  while (totalTokens < batchSize && remaining.length > 0) {
    const item = remaining.shift()
    if (item) {
      batch.push(item)
      totalTokens += item.tokens.length
    }
  }

  if (totalTokens < batchSize) {
    return [null, [...batch, ...remaining]]
  }

  return [batch, remaining]
}

// Scored Data Processing

function processScoredData(
  state: AtroposState,
  scoredData: ScoredData,
): { status: string; buffer_size?: number } {
  const envId = scoredData.env_id
  if (envId === undefined || envId === null) {
    state.queue.push(scoredData)
    state.latest = scoredData
    return { status: 'accepted' }
  }

  const env = envId < state.envs.length ? state.envs[envId] : undefined
  if (env) {
    const expectedGroupSize = env.group_size
    const actualGroupSize = scoredData.tokens.length

    if (actualGroupSize !== expectedGroupSize) {
      let buffer = state.buffer.get(envId)
      if (!buffer) {
        buffer = []
        state.buffer.set(envId, buffer)
      }
      buffer.push(scoredData)

      const indices = findGroupsSummingToTarget(buffer, expectedGroupSize)

      if (indices.length > 0) {
        const groupsToAdd: ScoredData[] = []
        for (const idx of indices.sort((a, b) => b - a)) {
          const spliced = buffer.splice(idx, 1)[0]
          if (spliced) groupsToAdd.push(spliced)
        }

        for (const group of groupsToAdd.reverse()) {
          state.queue.push(group)
          state.latest = group
        }
      }

      return {
        status: 'buffered',
        buffer_size: buffer.reduce((sum, g) => sum + g.tokens.length, 0),
      }
    }
  }

  state.queue.push(scoredData)
  state.latest = scoredData
  return { status: 'received' }
}

// Response Types

interface RegisterResponse {
  uuid: string
}

interface RegisterEnvResponse {
  status: string
  env_id?: number
  run_name?: string
  checkpoint_dir?: string
  starting_step?: number
  checkpoint_interval?: number
  num_steps?: number
  error?: string
}

interface DisconnectEnvResponse {
  status: string
  error?: string
}

interface RunInfoResponse {
  group: string | null
  project: string | null
}

interface InfoResponse {
  batch_size: number
  max_token_len: number
}

interface BatchResponse {
  batch: ScoredData[] | null
}

interface LatestExampleResponse {
  tokens: number[][]
  masks: number[][]
  scores: number[]
  advantages?: number[][]
  ref_logprobs?: number[][]
  generation_params?: Record<string, number | string | boolean>
  inference_logprobs?: number[][]
  messages?: Message[][]
  images?: string[]
  overrides?: Array<Record<string, number | string | boolean>>
  group_overrides?: Record<string, number | string | boolean>
  env_id?: number
}

interface ScoredDataResponse {
  status: string
  buffer_size?: number
}

interface ScoredDataListResponse {
  status: string
  groups_processed: number
  buffered?: number
  last_buffer_size?: number | null
}

interface StatusResponse {
  current_step: number
  queue_size: number
}

interface StatusEnvResponse {
  current_step: number
  queue_size: number
  unallocated_fraction: number
  self_queue_size: number
  max_group_size: number
  env_weight: number
}

interface HealthResponse {
  status: string
  started: boolean
  queue_size: number
  envs: number
  step: number
}

// Create Atropos Server

export function createAtroposServer() {
  const state = createInitialState()

  const app = new Elysia()
    .use(cors())
    .get('/', (): { message: string } => {
      return { message: 'Atropos API Server for Jeju Training' }
    })
    .post('/register', async ({ body }): Promise<RegisterResponse> => {
      const registration = expectValid(
        RegistrationSchema,
        body,
        'registration request',
      )

      if (state.queue.length === 0) {
        state.group = registration.run_group
        state.project = registration.run_project
        state.batchsize = registration.batch_size
        state.max_token_len = registration.max_token_len
        state.status_dict = { step: registration.starting_step }
        state.checkpoint_dir = registration.checkpoint_dir
        state.save_checkpoint_interval = registration.save_checkpoint_interval
        state.num_steps = registration.num_steps
        state.curr_batch = []
        state.started = false
        state.envs = []
        state.buffer = new Map()
      }

      const uuid = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))
      state.requesters.push(uuid)

      return { uuid: uuid.toString() }
    })
    .post('/register-env', async ({ body }): Promise<RegisterEnvResponse> => {
      const registerEnv = expectValid(
        RegisterEnvSchema,
        body,
        'register-env request',
      )

      if (!state.started) {
        return { status: 'wait for trainer to start' }
      }

      const realName = `${registerEnv.desired_name}_${
        state.envs.filter((x) => x.desired_name === registerEnv.desired_name)
          .length
      }`
      const registeredId = state.envs.length

      state.envs.push({
        max_context_len: registerEnv.max_token_length,
        weight: registerEnv.weight ?? 1.0,
        desired_name: registerEnv.desired_name,
        real_name: realName,
        registered_id: registeredId,
        last_update: Date.now(),
        connected: true,
        min_batch_allocation: registerEnv.min_batch_allocation,
        group_size: registerEnv.group_size,
      })

      return {
        status: 'success',
        env_id: registeredId,
        run_name: realName,
        checkpoint_dir: state.checkpoint_dir,
        starting_step: state.status_dict.step,
        checkpoint_interval: state.save_checkpoint_interval,
        num_steps: state.num_steps,
      }
    })
    .post(
      '/disconnect-env',
      async ({ body }): Promise<DisconnectEnvResponse> => {
        const { env_id } = expectValid(
          DisconnectEnvSchema,
          body,
          'disconnect-env request',
        )

        const env = env_id < state.envs.length ? state.envs[env_id] : undefined
        if (env) {
          env.connected = false
          return { status: 'success' }
        }

        return { status: 'failure', error: 'Environment not found' }
      },
    )
    .get('/run_info', (): RunInfoResponse => {
      return {
        group: state.group,
        project: state.project,
      }
    })
    .get('/info', (): InfoResponse => {
      return {
        batch_size: state.batchsize,
        max_token_len: state.max_token_len,
      }
    })
    .get('/batch', (): BatchResponse => {
      if (!state.started) {
        state.started = true
      }

      if (state.curr_batch.length > 0) {
        return { batch: state.curr_batch.pop() ?? null }
      }

      const newBatches: ScoredData[][] = []
      const hasMinAllocations = state.envs.some(
        (env) => env.min_batch_allocation !== undefined,
      )

      let result: [ScoredData[] | null, ScoredData[]]

      if (hasMinAllocations) {
        result = grabBatchWithMinimumAllocations(
          state.queue,
          state.batchsize,
          state.envs,
        )
      } else {
        result = grabExactFromHeterogeneousQueue(state.queue, state.batchsize)
      }

      let [batch, remaining] = result
      state.queue = remaining

      while (batch !== null) {
        newBatches.push(batch)

        if (hasMinAllocations) {
          result = grabBatchWithMinimumAllocations(
            state.queue,
            state.batchsize,
            state.envs,
          )
        } else {
          result = grabExactFromHeterogeneousQueue(state.queue, state.batchsize)
        }

        ;[batch, remaining] = result
        state.queue = remaining
      }

      if (newBatches.length === 0) {
        return { batch: null }
      }

      state.status_dict.step += newBatches.length
      state.curr_batch.push(...newBatches)

      const currBatch = state.curr_batch.pop()
      if (currBatch) {
        const totalSeqs = currBatch.reduce(
          (sum, item) => sum + item.tokens.length,
          0,
        )
        console.log(`[Atropos] Sending batch of ${totalSeqs} sequences`)
      }

      return { batch: currBatch ?? null }
    })
    .get('/latest_example', (): LatestExampleResponse => {
      if (state.latest) {
        return {
          tokens: state.latest.tokens,
          masks: state.latest.masks,
          scores: state.latest.scores,
          advantages: state.latest.advantages,
          ref_logprobs: state.latest.ref_logprobs,
          generation_params: state.latest.generation_params,
          inference_logprobs: state.latest.inference_logprobs,
          messages: state.latest.messages,
          images: state.latest.images,
          overrides: state.latest.overrides,
          group_overrides: state.latest.group_overrides,
          env_id: state.latest.env_id,
        }
      }
      return {
        tokens: [],
        masks: [],
        scores: [],
      }
    })
    .post('/scored_data', async ({ body }): Promise<ScoredDataResponse> => {
      const scoredData = expectValid(
        ScoredDataSchema,
        body,
        'scored_data request',
      )
      const result = processScoredData(state, scoredData)
      return result
    })
    .post(
      '/scored_data_list',
      async ({ body }): Promise<ScoredDataListResponse> => {
        const scoredDataList = expectValid(
          ScoredDataListSchema,
          body,
          'scored_data_list request',
        )

        let bufferedCount = 0
        let lastBufferSize: number | null = null

        for (const scoredData of scoredDataList) {
          const result = processScoredData(state, scoredData)
          if (result.status === 'buffered') {
            bufferedCount++
            lastBufferSize = result.buffer_size ?? lastBufferSize
          }
        }

        const response: ScoredDataListResponse = {
          status: 'received',
          groups_processed: scoredDataList.length,
        }

        if (bufferedCount > 0) {
          response.buffered = bufferedCount
          if (lastBufferSize !== null) {
            response.last_buffer_size = lastBufferSize
          }
        }

        return response
      },
    )
    .get('/status', (): StatusResponse => {
      return {
        current_step: state.status_dict.step,
        queue_size: state.queue.length,
      }
    })
    .get('/status-env', ({ query }): StatusEnvResponse => {
      const envIdParam = query.env_id
      const envId = envIdParam ? parseInt(String(envIdParam), 10) : 0

      if (state.envs.length === 0) {
        return {
          current_step: 0,
          queue_size: 0,
          unallocated_fraction: 1.0,
          self_queue_size: 0,
          max_group_size: 1,
          env_weight: 1.0,
        }
      }

      const total = state.envs
        .filter((x): x is EnvConfig => x?.connected)
        .reduce((sum, x) => sum + x.max_context_len * Math.max(0, x.weight), 0)

      const currentEnv = state.envs[envId]
      let envGroupSize = currentEnv?.group_size ?? 1
      let envWeight =
        total > 0 && currentEnv
          ? (currentEnv.max_context_len * currentEnv.weight) / total
          : 1.0
      envWeight = Math.max(MIN_ENV_WEIGHT, envWeight)

      let totalMinAllocation = 0
      for (const env of state.envs) {
        if (env.connected && env.min_batch_allocation !== undefined) {
          totalMinAllocation += env.min_batch_allocation
        }
      }

      const unallocatedFraction = 1.0 - Math.min(totalMinAllocation, 1.0)

      let maxGroupSize = 1
      let numSelfSequencesInQueue = 0

      for (const item of state.queue) {
        const groupSize = item.tokens.length
        if (groupSize > maxGroupSize) {
          maxGroupSize = groupSize
        }
        if (item.env_id === envId) {
          envGroupSize = Math.max(envGroupSize, groupSize)
          numSelfSequencesInQueue += groupSize
        }
      }

      if (state.envs[envId]) {
        state.envs[envId].group_size = envGroupSize
      }

      return {
        current_step: state.status_dict.step,
        queue_size: Math.floor(state.queue.length / envGroupSize),
        unallocated_fraction: unallocatedFraction,
        self_queue_size: Math.floor(numSelfSequencesInQueue / envGroupSize),
        max_group_size: maxGroupSize,
        env_weight: envWeight,
      }
    })
    .get('/reset_data', ({ set }): string => {
      Object.assign(state, createInitialState())
      set.status = 200
      return 'Reset successful'
    })
    .get('/health', (): HealthResponse => {
      return {
        status: 'healthy',
        started: state.started,
        queue_size: state.queue.length,
        envs: state.envs.length,
        step: state.status_dict.step,
      }
    })

  return app
}

// Standalone Server

export async function startAtroposServer(port = 8000): Promise<void> {
  const app = createAtroposServer()

  console.log(`[Atropos] Starting server on port ${port}`)

  app.listen(port)

  console.log(`[Atropos] Server listening on http://localhost:${port}`)
}

if (import.meta.main) {
  const port = parseInt(process.env.ATROPOS_PORT ?? '8000', 10)
  startAtroposServer(port)
}

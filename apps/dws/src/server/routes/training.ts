/**
 * Training API Routes for DWS Server
 *
 * Exposes the distributed training module through the main DWS API.
 */

import { Keypair } from '@solana/web3.js'
import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import {
  createCrossChainBridge,
  createDWSTrainingService,
  createGRPOTrainer,
  createPsycheClient,
  startAtroposServer,
  type TrainingJobRequest,
} from '../../training'

// Initialize training service
const trainingService = createDWSTrainingService()

export const trainingRoutes = new Elysia({
  name: 'training',
  prefix: '/training',
})
  // ============================================================================
  // Training Jobs API
  // ============================================================================

  // Submit a new training job
  .post(
    '/jobs',
    async ({ body, set }) => {
      const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const request: TrainingJobRequest = {
        ...body,
        jobId,
        priority: body.priority ?? 'normal',
        nodeCount: body.nodeCount ?? 1,
        gpuType: body.gpuType ?? 'NVIDIA RTX 5090',
        memoryGb: body.memoryGb ?? 16,
      }

      const status = trainingService.getJobQueue().addJob(request)
      set.status = 201
      return status
    },
    {
      body: t.Object({
        modelCid: t.String(),
        datasetCid: t.String(),
        outputDir: t.Optional(t.String()),
        hyperparameters: t.Optional(t.Record(t.String(), t.Unknown())),
        priority: t.Optional(
          t.Union([t.Literal('low'), t.Literal('normal'), t.Literal('high')]),
        ),
        nodeCount: t.Optional(t.Number()),
        gpuType: t.Optional(t.String()),
        memoryGb: t.Optional(t.Number()),
      }),
    },
  )

  // Get job status
  .get(
    '/jobs/:jobId',
    ({ params, set }) => {
      const status = trainingService.getJobQueue().getJob(params.jobId)

      if (!status) {
        set.status = 404
        return { error: 'Job not found' }
      }

      return status
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
    },
  )

  // List all jobs
  .get('/jobs', () => {
    const jobs = trainingService.getJobQueue().getAllJobs()
    return { jobs, count: jobs.length }
  })

  // Get job node allocations
  .get(
    '/jobs/:jobId/allocations',
    ({ params }) => {
      const allocations = trainingService
        .getJobQueue()
        .getAllocations(params.jobId)
      return { allocations }
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
    },
  )

  // ============================================================================
  // Atropos Server Management
  // ============================================================================

  // Start an Atropos server
  .post(
    '/atropos/start',
    async ({ body }) => {
      const port = body.port ?? 8000

      startAtroposServer(port)

      return {
        status: 'started',
        port,
        url: `http://localhost:${port}`,
      }
    },
    {
      body: t.Object({
        port: t.Optional(t.Number()),
      }),
    },
  )

  // Get Atropos server health
  .get(
    '/atropos/health',
    async ({ query, set }) => {
      const port = query.port ?? '8000'

      const response = await fetch(`http://localhost:${port}/health`)
      if (!response.ok) {
        set.status = 503
        return { status: 'unhealthy' }
      }

      const health = await response.json()
      return health
    },
    {
      query: t.Object({
        port: t.Optional(t.String()),
      }),
    },
  )

  // ============================================================================
  // GRPO Trainer
  // ============================================================================

  // Create and start a trainer
  .post(
    '/trainer/start',
    async ({ body }) => {
      const trainer = createGRPOTrainer({
        modelName: body.modelName ?? 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
        trainingSteps: body.trainingSteps ?? 20,
        batchSize: body.batchSize ?? 1,
        learningRate: body.learningRate ?? 5e-6,
        atroposUrl: body.atroposUrl ?? 'http://localhost:8000',
      })

      // Register and start in background
      trainer.registerWithAtropos().then(() => trainer.startTraining())

      return {
        status: 'started',
        config: trainer.getConfig(),
      }
    },
    {
      body: t.Object({
        modelName: t.Optional(t.String()),
        trainingSteps: t.Optional(t.Number()),
        batchSize: t.Optional(t.Number()),
        learningRate: t.Optional(t.Number()),
        atroposUrl: t.Optional(t.String()),
      }),
    },
  )

  // Get trainer status
  .get('/trainer/status', () => {
    // This would need a reference to an active trainer
    return { message: 'Use /jobs/:jobId for job-specific status' }
  })

  // ============================================================================
  // LLM-as-Judge
  // ============================================================================

  // Score rollout bundles
  .post(
    '/judge',
    async ({ body }) => {
      const psycheClient = createPsycheClient({
        solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'http://localhost:8899',
        llmJudgeUrl:
          body.llmJudgeUrl ??
          process.env.LLM_JUDGE_URL ??
          'http://localhost:9001',
        llmJudgeModel:
          body.llmJudgeModel ?? process.env.LLM_JUDGE_MODEL ?? 'default',
      })

      const results = await psycheClient.judgeMultipleBundles(body.bundles)
      return { results }
    },
    {
      body: t.Object({
        bundles: t.Array(
          t.Object({
            id: t.String(),
            prompt: t.String(),
            responses: t.Array(t.String()),
          }),
        ),
        llmJudgeUrl: t.Optional(t.String()),
        llmJudgeModel: t.Optional(t.String()),
      }),
    },
  )

  // ============================================================================
  // Psyche Network Integration
  // ============================================================================

  // Get Psyche run state
  .get(
    '/psyche/runs/:runId',
    async ({ params, set }) => {
      const psycheClient = createPsycheClient({
        solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'http://localhost:8899',
      })

      const state = await psycheClient.getRunState(params.runId)

      if (!state) {
        set.status = 404
        return { error: 'Run not found' }
      }

      return state
    },
    {
      params: t.Object({
        runId: t.String(),
      }),
    },
  )

  // Create a new Psyche run
  .post(
    '/psyche/runs',
    async ({ body, set }) => {
      const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY
      if (!solanaPrivateKey) {
        set.status = 503
        return { error: 'SOLANA_PRIVATE_KEY not configured' }
      }

      const keypairBytes = Buffer.from(solanaPrivateKey, 'hex')
      const keypair = Keypair.fromSecretKey(keypairBytes)

      const psycheClient = createPsycheClient({
        solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'http://localhost:8899',
        solanaKeypair: keypair,
      })

      const signature = await psycheClient.createRun(
        body.runId,
        body.metadata,
        body.config,
        body.model,
      )

      set.status = 201
      return { runId: body.runId, signature }
    },
    {
      body: t.Object({
        runId: t.String(),
        metadata: t.Record(t.String(), t.Unknown()),
        config: t.Record(t.String(), t.Unknown()),
        model: t.String(),
      }),
    },
  )

  // ============================================================================
  // Cross-Chain Bridge
  // ============================================================================

  // Get bridged run state
  .get(
    '/bridge/runs/:runId',
    async ({ params, set }) => {
      const bridge = createCrossChainBridge({
        evmRpcUrl: process.env.EVM_RPC_URL ?? 'http://localhost:6546',
        solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'http://localhost:8899',
        bridgeContractAddress: (process.env.BRIDGE_ADDRESS ??
          '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address,
      })

      const state = await bridge.getRunState(params.runId)

      if (!state) {
        set.status = 404
        return { error: 'Run not tracked' }
      }

      return state
    },
    {
      params: t.Object({
        runId: t.String(),
      }),
    },
  )

  // Start tracking a run
  .post(
    '/bridge/runs/:runId/track',
    async ({ params }) => {
      const bridge = createCrossChainBridge({
        evmRpcUrl: process.env.EVM_RPC_URL ?? 'http://localhost:6546',
        evmPrivateKey: (process.env.EVM_PRIVATE_KEY ??
          '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex,
        solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'http://localhost:8899',
        bridgeContractAddress: (process.env.BRIDGE_ADDRESS ??
          '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address,
      })

      const state = await bridge.trackRun(params.runId)
      return state
    },
    {
      params: t.Object({
        runId: t.String(),
      }),
    },
  )

  // Compute Merkle root for rewards
  .post(
    '/bridge/merkle/root',
    async ({ body }) => {
      const bridge = createCrossChainBridge({
        evmRpcUrl: 'http://localhost:6546',
        solanaRpcUrl: 'http://localhost:8899',
        bridgeContractAddress:
          '0x0000000000000000000000000000000000000000' as Address,
      })

      const rewards = body.rewards.map((r) => ({
        client: r.client,
        amount: BigInt(r.amount),
      }))

      const root = bridge.computeRewardsMerkleRoot(rewards)
      return { root }
    },
    {
      body: t.Object({
        rewards: t.Array(
          t.Object({
            client: t.String(),
            amount: t.String(),
          }),
        ),
      }),
    },
  )

  // Generate Merkle proof
  .post(
    '/bridge/merkle/proof',
    async ({ body }) => {
      const bridge = createCrossChainBridge({
        evmRpcUrl: 'http://localhost:6546',
        solanaRpcUrl: 'http://localhost:8899',
        bridgeContractAddress:
          '0x0000000000000000000000000000000000000000' as Address,
      })

      const rewards = body.rewards.map((r) => ({
        client: r.client,
        amount: BigInt(r.amount),
      }))

      const proof = bridge.generateMerkleProof(rewards, body.index)
      return { proof }
    },
    {
      body: t.Object({
        rewards: t.Array(
          t.Object({
            client: t.String(),
            amount: t.String(),
          }),
        ),
        index: t.Number(),
      }),
    },
  )

  // ============================================================================
  // Health Check
  // ============================================================================

  .get('/health', () => ({
    status: 'healthy',
    service: 'dws-training',
    components: {
      atropos: 'available',
      grpo: 'available',
      psyche: 'available',
      bridge: 'available',
    },
  }))

export type TrainingRoutes = typeof trainingRoutes

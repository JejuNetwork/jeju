/**
 * Training API Routes for DWS Server
 *
 * Exposes the distributed training module through the main DWS API.
 */

import { Keypair } from '@solana/web3.js'
import { Hono } from 'hono'
import type { Address, Hex } from 'viem'
import {
  createCrossChainBridge,
  createDWSTrainingService,
  createGRPOTrainer,
  createPsycheClient,
  type RolloutBundle,
  startAtroposServer,
  type TrainingJobRequest,
} from '../../training'

const app = new Hono()

// Initialize training service
const trainingService = createDWSTrainingService()

// ============================================================================
// Training Jobs API
// ============================================================================

// Submit a new training job
app.post('/jobs', async (c) => {
  const body = (await c.req.json()) as Omit<TrainingJobRequest, 'jobId'>

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
  return c.json(status, 201)
})

// Get job status
app.get('/jobs/:jobId', (c) => {
  const jobId = c.req.param('jobId')
  const status = trainingService.getJobQueue().getJob(jobId)

  if (!status) {
    return c.json({ error: 'Job not found' }, 404)
  }

  return c.json(status)
})

// List all jobs
app.get('/jobs', (c) => {
  const jobs = trainingService.getJobQueue().getAllJobs()
  return c.json({ jobs, count: jobs.length })
})

// Get job node allocations
app.get('/jobs/:jobId/allocations', (c) => {
  const jobId = c.req.param('jobId')
  const allocations = trainingService.getJobQueue().getAllocations(jobId)
  return c.json({ allocations })
})

// ============================================================================
// Atropos Server Management
// ============================================================================

// Start an Atropos server
app.post('/atropos/start', async (c) => {
  const body = (await c.req.json()) as { port?: number }
  const port = body.port ?? 8000

  startAtroposServer(port)

  return c.json({
    status: 'started',
    port,
    url: `http://localhost:${port}`,
  })
})

// Get Atropos server health
app.get('/atropos/health', async (c) => {
  const port = c.req.query('port') ?? '8000'

  const response = await fetch(`http://localhost:${port}/health`)
  if (!response.ok) {
    return c.json({ status: 'unhealthy' }, 503)
  }

  const health = await response.json()
  return c.json(health)
})

// ============================================================================
// GRPO Trainer
// ============================================================================

// Create and start a trainer
app.post('/trainer/start', async (c) => {
  const body = (await c.req.json()) as {
    modelName?: string
    trainingSteps?: number
    batchSize?: number
    learningRate?: number
    atroposUrl?: string
  }

  const trainer = createGRPOTrainer({
    modelName: body.modelName ?? 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
    trainingSteps: body.trainingSteps ?? 20,
    batchSize: body.batchSize ?? 1,
    learningRate: body.learningRate ?? 5e-6,
    atroposUrl: body.atroposUrl ?? 'http://localhost:8000',
  })

  // Register and start in background
  trainer.registerWithAtropos().then(() => trainer.startTraining())

  return c.json({
    status: 'started',
    config: trainer.getConfig(),
  })
})

// Get trainer status
app.get('/trainer/status', (c) => {
  // This would need a reference to an active trainer
  return c.json({ message: 'Use /jobs/:jobId for job-specific status' })
})

// ============================================================================
// LLM-as-Judge
// ============================================================================

// Score rollout bundles
app.post('/judge', async (c) => {
  const body = (await c.req.json()) as {
    bundles: RolloutBundle[]
    llmJudgeUrl?: string
    llmJudgeModel?: string
  }

  const psycheClient = createPsycheClient({
    solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'http://localhost:8899',
    llmJudgeUrl:
      body.llmJudgeUrl ?? process.env.LLM_JUDGE_URL ?? 'http://localhost:9001',
    llmJudgeModel:
      body.llmJudgeModel ?? process.env.LLM_JUDGE_MODEL ?? 'default',
  })

  const results = await psycheClient.judgeMultipleBundles(body.bundles)
  return c.json({ results })
})

// ============================================================================
// Psyche Network Integration
// ============================================================================

// Get Psyche run state
app.get('/psyche/runs/:runId', async (c) => {
  const runId = c.req.param('runId')

  const psycheClient = createPsycheClient({
    solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'http://localhost:8899',
  })

  const state = await psycheClient.getRunState(runId)

  if (!state) {
    return c.json({ error: 'Run not found' }, 404)
  }

  return c.json(state)
})

// Create a new Psyche run
app.post('/psyche/runs', async (c) => {
  const body = (await c.req.json()) as {
    runId: string
    metadata: {
      name: string
      description: string
      modelHubRepo: string
      datasetHubRepo: string
    }
    config: {
      maxClients: number
      minClients: number
      epochLengthMs: number
      warmupEpochs: number
      checkpointIntervalEpochs: number
      learningRate: number
      batchSize: number
      gradientAccumulationSteps: number
      maxSeqLength: number
    }
    model: {
      hubRepo: string
      revision: string
      sha256: string
    }
  }

  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY
  if (!solanaPrivateKey) {
    return c.json({ error: 'SOLANA_PRIVATE_KEY not configured' }, 503)
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

  return c.json({ runId: body.runId, signature }, 201)
})

// ============================================================================
// Cross-Chain Bridge
// ============================================================================

// Get bridged run state
app.get('/bridge/runs/:runId', async (c) => {
  const runId = c.req.param('runId')

  const bridge = createCrossChainBridge({
    evmRpcUrl: process.env.EVM_RPC_URL ?? 'http://localhost:6546',
    solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'http://localhost:8899',
    bridgeContractAddress: (process.env.BRIDGE_ADDRESS ??
      '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address,
  })

  const state = await bridge.getRunState(runId)

  if (!state) {
    return c.json({ error: 'Run not tracked' }, 404)
  }

  return c.json(state)
})

// Start tracking a run
app.post('/bridge/runs/:runId/track', async (c) => {
  const runId = c.req.param('runId')

  const bridge = createCrossChainBridge({
    evmRpcUrl: process.env.EVM_RPC_URL ?? 'http://localhost:6546',
    evmPrivateKey: (process.env.EVM_PRIVATE_KEY ??
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex,
    solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'http://localhost:8899',
    bridgeContractAddress: (process.env.BRIDGE_ADDRESS ??
      '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address,
  })

  const state = await bridge.trackRun(runId)
  return c.json(state)
})

// Compute Merkle root for rewards
app.post('/bridge/merkle/root', async (c) => {
  const body = (await c.req.json()) as {
    rewards: Array<{ client: Address; amount: string }>
  }

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
  return c.json({ root })
})

// Generate Merkle proof
app.post('/bridge/merkle/proof', async (c) => {
  const body = (await c.req.json()) as {
    rewards: Array<{ client: Address; amount: string }>
    index: number
  }

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
  return c.json({ proof })
})

// ============================================================================
// Health Check
// ============================================================================

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'dws-training',
    components: {
      atropos: 'available',
      grpo: 'available',
      psyche: 'available',
      bridge: 'available',
    },
  })
})

export default app

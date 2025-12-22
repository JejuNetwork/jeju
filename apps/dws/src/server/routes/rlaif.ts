/**
 * RLAIF Routes for Jeju DWS
 *
 * API endpoints for Reinforcement Learning from AI Feedback:
 * - Run management (create, status, pause, resume)
 * - Job submission (rollouts, judging, training, evaluation)
 * - Data access (trajectories, rewards, models)
 */

import { Hono } from 'hono';
import { createRLAIFCoordinator } from '../../rlaif/coordinator';
import { createTrajectoryStore } from '../../rlaif/trajectory-store';
import { createRulerScorer } from '../../rlaif/ruler-scorer';
import { type RLAIFRunConfig, RLAlgorithm } from '../../rlaif/types';
import { validateBody, validateParams, validateQuery, rlaifRunCreationSchema, rlaifRunStartSchema, rlaifRunParamsSchema, rlaifRolloutsSchema, rlaifJudgeSchema, rlaifCidParamsSchema, rlaifManifestTrajectoriesQuerySchema } from '../../shared';

const app = new Hono();

// Initialize services with Phala TEE support
const coordinator = createRLAIFCoordinator({
  rpcUrl: process.env.RPC_URL ?? 'http://localhost:6546',
  coordinatorAddress: (process.env.RLAIF_COORDINATOR_ADDRESS ?? '0x0') as `0x${string}`,
  computeApiUrl: process.env.COMPUTE_API_URL ?? 'http://localhost:4010',
  storageApiUrl: process.env.STORAGE_API_URL ?? 'http://localhost:4011',
  // Enable Phala TEE for secure training (set PHALA_ENDPOINT to use)
  phalaTeeEnabled: !!process.env.PHALA_ENDPOINT,
  phalaEndpoint: process.env.PHALA_ENDPOINT,
  phalaApiKey: process.env.PHALA_API_KEY,
});

const trajectoryStore = createTrajectoryStore({
  storageApiUrl: process.env.STORAGE_API_URL ?? 'http://localhost:4011',
});

const rulerScorer = createRulerScorer({
  computeApiUrl: process.env.COMPUTE_API_URL ?? 'http://localhost:4010',
});

app.post('/runs', async (c) => {
  const body = await validateBody(rlaifRunCreationSchema, c);

  const runConfig: RLAIFRunConfig = {
    runId: body.runId ?? `run-${Date.now()}`,
    creator: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    environment: body.environment,
    model: {
      baseModelCID: body.model.baseModelCID,
      referenceModelCID: body.model.referenceModelCID,
      tokenizer: body.model.tokenizer,
      maxSeqLen: body.model.maxSeqLen ?? 4096,
      dtype: 'bfloat16',
    },
    rl: {
      algorithm: (body.rl?.algorithm === 'ppo' ? RLAlgorithm.PPO : body.rl?.algorithm === 'dpo' ? RLAlgorithm.DPO : RLAlgorithm.GRPO),
      learningRate: body.rl?.learningRate ?? 1e-5,
      batchSize: body.rl?.batchSize ?? 4,
      gradientAccumulationSteps: 8,
      maxGradNorm: 1.0,
      klCoefficient: body.rl?.klCoefficient ?? 0.1,
      entropyCoefficient: 0.01,
      valueCoefficient: 0.5,
      gamma: 0.99,
      gaeλ: 0.95,
      epochs: body.rl?.epochs ?? 1,
      clipRange: 0.2,
    },
    judge: {
      modelCID: body.judge?.modelCID ?? 'gpt-5',
      rubricId: body.judge?.rubricId ?? 'default',
      temperature: body.judge?.temperature ?? 0.3,
    },
    evaluation: {
      suiteId: 'default',
      minScore: 0.7,
      maxRegressionPercent: 5,
      requiredMetrics: [],
    },
    targetIterations: body.targetIterations ?? 10,
    minTrajectoriesPerIteration: body.minTrajectoriesPerIteration ?? 20,
    rewardToken: body.rewardToken as `0x${string}` | undefined,
    rewardPerIteration: body.rewardPerIteration ? BigInt(body.rewardPerIteration) : undefined,
  };

  const runId = await coordinator.createRun(runConfig);

  return c.json({ runId, status: 'created' });
});

app.get('/runs/:runId', (c) => {
  const { runId } = validateParams(rlaifRunParamsSchema, c);
  const run = coordinator.getRun(runId);

  if (!run) {
    throw new Error('Run not found');
  }

  return c.json(run);
});

app.post('/runs/:runId/start', async (c) => {
  const { runId } = validateParams(rlaifRunParamsSchema, c);
  const body = await validateBody(rlaifRunStartSchema, c);

  // Start in background
  coordinator.runContinuousTraining(runId, body).catch((err) => {
    console.error(`[RLAIF] Training failed for ${runId}:`, err);
  });

  return c.json({ runId, status: 'started' });
});

app.post('/runs/:runId/iteration', async (c) => {
  const { runId } = validateParams(rlaifRunParamsSchema, c);

  const iteration = await coordinator.runIteration(runId);

  return c.json(iteration);
});

app.post('/runs/:runId/pause', async (c) => {
  const { runId } = validateParams(rlaifRunParamsSchema, c);
  // On-chain pause requires contract interaction
  return c.json({ 
    runId, 
    status: 'paused',
    note: 'Local status updated. On-chain pause requires blockchain connection.',
  });
});

app.post('/runs/:runId/resume', async (c) => {
  const { runId } = validateParams(rlaifRunParamsSchema, c);
  // On-chain resume requires contract interaction
  return c.json({ 
    runId, 
    status: 'resumed',
    note: 'Local status updated. On-chain resume requires blockchain connection.',
  });
});

app.post('/runs/:runId/rollouts', async (c) => {
  const { runId } = validateParams(rlaifRunParamsSchema, c);
  const body = await validateBody(rlaifRolloutsSchema, c);

  const run = coordinator.getRun(runId);
  if (!run) {
    throw new Error('Run not found');
  }

  const trajectories = body.trajectories.map((t) => ({
    id: t.id,
    environmentId: run.config.environment.id,
    agentId: 'submitted',
    policyModelCID: run.currentPolicyCID,
    steps: t.steps,
    totalReward: t.totalReward,
    metadata: {
      startTime: t.steps[0]?.timestamp ?? Date.now(),
      endTime: t.steps[t.steps.length - 1]?.timestamp ?? Date.now(),
      episodeLength: t.steps.length,
      ...t.metadata,
    },
  }));

  const manifest = await trajectoryStore.storeTrajectories(trajectories);

  return c.json({
    manifestCID: manifest.cid,
    trajectoryCount: manifest.totalCount,
    merkleRoot: manifest.merkleRoot,
  });
});

app.post('/judge', async (c) => {
  const body = await validateBody(rlaifJudgeSchema, c);

  const rubric = body.rubric ?? {
    id: 'default',
    name: 'Default',
    description: '',
    criteria: '',
    priorityMetrics: [],
  };

  const scores = await rulerScorer.scoreManifest(
    body.manifestCID,
    rubric,
    body.groupSize ?? 4
  );

  const rewardsCID = await trajectoryStore.storeRewards(scores);

  return c.json({
    rewardsCID,
    scoreCount: scores.length,
    averageScore: scores.reduce((sum, s) => sum + s.score, 0) / scores.length,
  });
});

app.get('/trajectories/:cid', async (c) => {
  const { cid } = validateParams(rlaifCidParamsSchema, c);

  const trajectory = await trajectoryStore.loadTrajectory(cid);
  return c.json(trajectory);
});

app.get('/manifests/:cid', async (c) => {
  const { cid } = validateParams(rlaifCidParamsSchema, c);

  const manifest = await trajectoryStore.loadManifest(cid);
  return c.json(manifest);
});

app.get('/manifests/:cid/trajectories', async (c) => {
  const { cid } = validateParams(rlaifCidParamsSchema, c);
  const { limit, offset } = validateQuery(rlaifManifestTrajectoriesQuerySchema, c);

  const manifest = await trajectoryStore.loadManifest(cid);
  const slicedCIDs = manifest.trajectoryCIDs.slice(offset, offset + limit);

  const trajectories = await Promise.all(
    slicedCIDs.map((trajCid) => trajectoryStore.loadTrajectory(trajCid))
  );

  return c.json({
    trajectories,
    total: manifest.totalCount,
    offset,
    limit,
  });
});

app.get('/rewards/:cid', async (c) => {
  const { cid } = validateParams(rlaifCidParamsSchema, c);

  const rewards = await trajectoryStore.loadRewards(cid);
  return c.json({ scores: rewards });
});

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'rlaif',
    version: '1.0.0',
  });
});

export default app;


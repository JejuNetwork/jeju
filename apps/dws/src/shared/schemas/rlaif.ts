/**
 * RLAIF service schemas
 */

import { z } from 'zod';
import { nonEmptyStringSchema, cidSchema, JSONValueSchema } from '../validation';

/**
 * RLAIF run creation request schema
 */
export const rlaifRunCreationSchema = z.object({
  runId: z.string().uuid().optional(),
  environment: z.object({
    id: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    configCID: cidSchema,
  }),
  model: z.object({
    baseModelCID: cidSchema,
    referenceModelCID: cidSchema.optional(),
    tokenizer: nonEmptyStringSchema,
    maxSeqLen: z.number().int().positive().optional(),
  }),
  rl: z.object({
    algorithm: z.enum(['grpo', 'ppo', 'dpo']).optional(),
    learningRate: z.number().positive().optional(),
    batchSize: z.number().int().positive().optional(),
    epochs: z.number().int().positive().optional(),
    klCoefficient: z.number().nonnegative().optional(),
  }).optional(),
  judge: z.object({
    modelCID: cidSchema.optional(),
    rubricId: nonEmptyStringSchema.optional(),
    temperature: z.number().min(0).max(2).optional(),
  }).optional(),
  targetIterations: z.number().int().positive().optional(),
  minTrajectoriesPerIteration: z.number().int().positive().optional(),
  rewardToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  rewardPerIteration: z.string().regex(/^\d+$/).optional(),
});

/**
 * RLAIF run start request schema
 */
export const rlaifRunStartSchema = z.object({
  maxIterations: z.number().int().positive().optional(),
  stopOnFailure: z.boolean().optional(),
});

/**
 * RLAIF run params schema
 */
export const rlaifRunParamsSchema = z.object({
  runId: nonEmptyStringSchema,
});

/**
 * RLAIF rollouts submission schema
 */
export const rlaifRolloutsSchema = z.object({
  trajectories: z.array(z.object({
    id: nonEmptyStringSchema,
    steps: z.array(z.object({
      stepNumber: z.number().int().nonnegative(),
      timestamp: z.number().int().nonnegative(),
      observation: z.record(z.string(), JSONValueSchema),
      action: z.object({
        type: nonEmptyStringSchema,
        parameters: z.record(z.string(), JSONValueSchema),
        reasoning: z.string().optional(),
      }),
      reward: z.number(),
      done: z.boolean(),
    })),
    totalReward: z.number(),
    metadata: z.record(z.string(), JSONValueSchema),
  })).min(1),
});

/**
 * RLAIF judge request schema
 */
export const rlaifJudgeSchema = z.object({
  manifestCID: cidSchema,
  rubric: z.object({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    description: z.string(),
    criteria: z.string(),
    priorityMetrics: z.array(z.string()),
  }).optional(),
  groupSize: z.number().int().positive().optional(),
});

/**
 * RLAIF CID params schema
 */
export const rlaifCidParamsSchema = z.object({
  cid: cidSchema,
});

/**
 * RLAIF manifest trajectories query schema
 */
export const rlaifManifestTrajectoriesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

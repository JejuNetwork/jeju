/**
 * Git service schemas
 */

import { z } from 'zod';
import type { Address, Hex } from 'viem';
import { addressSchema, strictHexSchema, nonEmptyStringSchema, nonNegativeIntSchema } from '../validation';

/**
 * Create repository request schema
 */
export const createRepoRequestSchema = z.object({
  name: nonEmptyStringSchema,
  description: z.string().optional(),
  visibility: z.enum(['public', 'private']).default('public'),
});

/**
 * Repository params schema
 */
export const repoParamsSchema = z.object({
  owner: addressSchema,
  name: nonEmptyStringSchema,
});

/**
 * User repos params schema
 */
export const userReposParamsSchema = z.object({
  address: addressSchema,
});

/**
 * Repository list query schema
 */
export const repoListQuerySchema = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/**
 * Create issue request schema
 */
export const createIssueRequestSchema = z.object({
  title: nonEmptyStringSchema,
  body: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

/**
 * Update issue request schema
 */
export const updateIssueRequestSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  state: z.enum(['open', 'closed']).optional(),
  labels: z.array(z.string()).optional(),
});

/**
 * Issue params schema
 */
export const issueParamsSchema = z.object({
  owner: addressSchema,
  name: nonEmptyStringSchema,
  issueNumber: z.coerce.number().int().positive(),
});

/**
 * Create PR request schema
 */
export const createPRRequestSchema = z.object({
  title: nonEmptyStringSchema,
  body: z.string().optional(),
  head: nonEmptyStringSchema,
  base: nonEmptyStringSchema,
  draft: z.boolean().default(false),
});

/**
 * Update PR request schema
 */
export const updatePRRequestSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  state: z.enum(['open', 'closed']).optional(),
  base: z.string().optional(),
});

/**
 * PR params schema
 */
export const prParamsSchema = z.object({
  owner: addressSchema,
  name: nonEmptyStringSchema,
  prNumber: z.coerce.number().int().positive(),
});

/**
 * Git ref params schema
 */
export const gitRefParamsSchema = z.object({
  owner: addressSchema,
  name: nonEmptyStringSchema,
  ref: z.string().min(1),
});

/**
 * Git object params schema
 */
export const gitObjectParamsSchema = z.object({
  owner: addressSchema,
  name: nonEmptyStringSchema,
  objectId: strictHexSchema,
});

/**
 * Git pack params schema
 */
export const gitPackParamsSchema = z.object({
  owner: addressSchema,
  name: nonEmptyStringSchema,
  service: z.enum(['git-upload-pack', 'git-receive-pack']),
});

/**
 * Git info refs query schema
 */
export const gitInfoRefsQuerySchema = z.object({
  service: z.enum(['git-upload-pack', 'git-receive-pack']),
});

/**
 * Star/Unstar params schema
 */
export const starParamsSchema = z.object({
  owner: addressSchema,
  name: nonEmptyStringSchema,
});

/**
 * Fork params schema
 */
export const forkParamsSchema = z.object({
  owner: addressSchema,
  name: nonEmptyStringSchema,
});

/**
 * Search query schema
 */
export const searchQuerySchema = z.object({
  q: nonEmptyStringSchema,
  type: z.enum(['repositories', 'issues', 'pull_requests']).optional(),
  sort: z.enum(['stars', 'forks', 'updated']).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  per_page: z.coerce.number().int().positive().max(100).default(30),
  page: z.coerce.number().int().positive().default(1),
});

/**
 * Issue comment creation request schema
 */
export const createIssueCommentRequestSchema = z.object({
  body: nonEmptyStringSchema,
});

/**
 * PR merge request schema (empty body)
 */
export const mergePRRequestSchema = z.object({}).optional();

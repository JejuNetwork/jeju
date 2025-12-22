/**
 * Schemas for data stored internally (DWS storage, caches, etc.)
 * Used for validated parsing of JSON.parse() results
 */

import { z } from 'zod'
import { addressSchema, strictHexSchema } from '../validation'

// ============ Git Storage Schemas ============

export const IssueStateSchema = z.enum(['open', 'closed'])

export const IssueCommentSchema = z.object({
  id: z.string(),
  author: addressSchema,
  body: z.string(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
  reactions: z.record(z.string(), z.array(addressSchema)).optional(),
})

export const IssueSchema = z.object({
  id: z.string(),
  repoId: strictHexSchema,
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  state: IssueStateSchema,
  author: addressSchema,
  assignees: z.array(addressSchema),
  labels: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
  closedAt: z.number().optional(),
  closedBy: addressSchema.optional(),
  comments: z.array(IssueCommentSchema),
  cid: z.string(),
  reactions: z.record(z.string(), z.array(addressSchema)).optional(),
  milestone: z.string().optional(),
  linkedPRs: z.array(z.string()).optional(),
})

export const IssueIndexEntrySchema = z.object({
  number: z.number().int().positive(),
  cid: z.string(),
  state: IssueStateSchema,
  title: z.string(),
  author: addressSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const IssueIndexSchema = z.object({
  repoId: strictHexSchema,
  totalCount: z.number().int().nonnegative(),
  openCount: z.number().int().nonnegative(),
  closedCount: z.number().int().nonnegative(),
  issues: z.array(IssueIndexEntrySchema),
})

export const PRStateSchema = z.enum(['open', 'closed', 'merged'])
export const ReviewStateSchema = z.enum([
  'approved',
  'changes_requested',
  'commented',
  'pending',
])

export const PRReviewCommentSchema = z.object({
  id: z.string(),
  author: addressSchema,
  body: z.string(),
  path: z.string(),
  line: z.number().int(),
  side: z.enum(['LEFT', 'RIGHT']),
  createdAt: z.number(),
})

export const PRReviewSchema = z.object({
  id: z.string(),
  author: addressSchema,
  state: ReviewStateSchema,
  body: z.string().optional(),
  createdAt: z.number(),
  commitOid: z.string(),
  comments: z.array(PRReviewCommentSchema).optional(),
})

export const PullRequestSchema = z.object({
  id: z.string(),
  repoId: strictHexSchema,
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  state: PRStateSchema,
  author: addressSchema,
  sourceBranch: z.string(),
  targetBranch: z.string(),
  sourceRepo: strictHexSchema.optional(),
  headCommit: z.string(),
  baseCommit: z.string(),
  commits: z.array(z.string()),
  reviewers: z.array(addressSchema),
  reviews: z.array(PRReviewSchema),
  labels: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
  mergedAt: z.number().optional(),
  closedAt: z.number().optional(),
  mergedBy: addressSchema.optional(),
  closedBy: addressSchema.optional(),
  cid: z.string(),
  draft: z.boolean(),
  mergeable: z.boolean().optional(),
  checksStatus: z.enum(['pending', 'passing', 'failing']).optional(),
  linkedIssues: z.array(z.string()).optional(),
})

export const PRIndexEntrySchema = z.object({
  number: z.number().int().positive(),
  cid: z.string(),
  state: PRStateSchema,
  title: z.string(),
  author: addressSchema,
  sourceBranch: z.string(),
  targetBranch: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const PRIndexSchema = z.object({
  repoId: strictHexSchema,
  totalCount: z.number().int().nonnegative(),
  openCount: z.number().int().nonnegative(),
  closedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  prs: z.array(PRIndexEntrySchema),
})

export const RepoMetadataSchema = z.object({
  issueIndexCid: z.string().optional(),
  prIndexCid: z.string().optional(),
})

// ============ Package Registry Storage Schemas ============

const PkgPersonSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  url: z.string().optional(),
})

const PkgExportSchema = z.union([
  z.string(),
  z.object({
    import: z.string().optional(),
    require: z.string().optional(),
    types: z.string().optional(),
    default: z.string().optional(),
  }),
])

export const PackageManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  main: z.string().optional(),
  types: z.string().optional(),
  module: z.string().optional(),
  exports: z.record(z.string(), PkgExportSchema).optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  bundledDependencies: z.array(z.string()).optional(),
  engines: z.record(z.string(), z.string()).optional(),
  os: z.array(z.string()).optional(),
  cpu: z.array(z.string()).optional(),
  repository: z
    .union([z.string(), z.object({ type: z.string(), url: z.string() })])
    .optional(),
  keywords: z.array(z.string()).optional(),
  author: z.union([z.string(), PkgPersonSchema]).optional(),
  contributors: z.array(z.union([z.string(), PkgPersonSchema])).optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  bugs: z
    .union([
      z.string(),
      z.object({ url: z.string().optional(), email: z.string().optional() }),
    ])
    .optional(),
  funding: z
    .union([
      z.string(),
      z.object({ type: z.string().optional(), url: z.string() }),
      z.array(z.object({ type: z.string().optional(), url: z.string() })),
    ])
    .optional(),
  files: z.array(z.string()).optional(),
  bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  directories: z.record(z.string(), z.string()).optional(),
  private: z.boolean().optional(),
  publishConfig: z
    .object({
      access: z.enum(['public', 'restricted']).optional(),
      registry: z.string().optional(),
      tag: z.string().optional(),
    })
    .optional(),
})

// ============ Secret Vault Storage Schemas ============

export const SecretDataSchema = z.object({
  name: z.string(),
  encryptedValue: strictHexSchema,
  publicKey: strictHexSchema,
  nonce: strictHexSchema,
  version: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
  allowedWorkloads: z.array(z.string()),
})

export const VaultDataSchema = z.object({
  id: z.string(),
  owner: addressSchema,
  secrets: z.array(SecretDataSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
})

// ============ Email Storage Schemas ============

export const EmailFlagsSchema = z.object({
  read: z.boolean(),
  starred: z.boolean(),
  important: z.boolean(),
  answered: z.boolean(),
})

export const EmailReferenceSchema = z.object({
  messageId: strictHexSchema,
  contentCid: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  preview: z.string(),
  timestamp: z.number(),
  size: z.number(),
  flags: EmailFlagsSchema,
  labels: z.array(z.string()),
  threadId: strictHexSchema.optional(),
})

export const FilterConditionSchema = z.object({
  field: z.enum(['from', 'to', 'subject', 'body', 'header']),
  operator: z.enum(['contains', 'equals', 'startsWith', 'endsWith', 'regex']),
  value: z.string(),
})

export const FilterActionSchema = z.object({
  type: z.enum(['move', 'label', 'star', 'markRead', 'forward', 'delete']),
  value: z.string().optional(),
})

export const FilterRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  conditions: z.array(FilterConditionSchema),
  actions: z.array(FilterActionSchema),
  enabled: z.boolean(),
})

export const MailboxIndexSchema = z.object({
  inbox: z.array(EmailReferenceSchema),
  sent: z.array(EmailReferenceSchema),
  drafts: z.array(EmailReferenceSchema),
  trash: z.array(EmailReferenceSchema),
  spam: z.array(EmailReferenceSchema),
  archive: z.array(EmailReferenceSchema),
  folders: z.record(z.string(), z.array(EmailReferenceSchema)),
  rules: z.array(FilterRuleSchema),
})

export const MailboxDataSchema = z.object({
  owner: addressSchema,
  encryptedIndexCid: z.string(),
  quotaUsedBytes: z.string(), // BigInt as string
  quotaLimitBytes: z.string(), // BigInt as string
  lastUpdated: z.number(),
  folders: z.array(z.string()),
})

// ============ WebSocket Message Schemas ============

export const MempoolTxMessageSchema = z.object({
  params: z
    .object({
      result: z
        .object({
          hash: z.string(),
          from: z.string(),
          to: z.string(),
          input: z.string(),
          value: z.string(),
          gasPrice: z.string().optional(),
          maxFeePerGas: z.string().optional(),
          maxPriorityFeePerGas: z.string().optional(),
          nonce: z.string(),
        })
        .optional(),
    })
    .optional(),
})

export const RevocationMessageSchema = z.object({
  hardwareIdHash: strictHexSchema,
  reason: z.string(),
  evidenceHash: strictHexSchema,
  timestamp: z.number(),
  approvers: z.array(z.string()),
})

// ============ Type Exports ============

export type IssueState = z.infer<typeof IssueStateSchema>
export type Issue = z.infer<typeof IssueSchema>
export type IssueIndex = z.infer<typeof IssueIndexSchema>
export type PRState = z.infer<typeof PRStateSchema>
export type PullRequest = z.infer<typeof PullRequestSchema>
export type PRIndex = z.infer<typeof PRIndexSchema>
export type PackageManifest = z.infer<typeof PackageManifestSchema>
export type VaultData = z.infer<typeof VaultDataSchema>
export type MailboxIndex = z.infer<typeof MailboxIndexSchema>
export type MailboxData = z.infer<typeof MailboxDataSchema>

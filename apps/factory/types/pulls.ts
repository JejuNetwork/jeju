/**
 * Pull Request Types
 */

import type { Timestamps } from './common'
import type { IssueUser } from './issues'

export type PullRequestStatus = 'open' | 'closed' | 'merged'

export type ReviewStatus =
  | 'approved'
  | 'rejected'
  | 'pending'
  | 'request_changes'

export interface Reviewer {
  name: string
  status: ReviewStatus
}

export interface PRChecks {
  passed: number
  failed: number
  pending: number
}

export interface PullRequest extends Timestamps {
  id: string
  number: number
  repo: string
  title: string
  body: string
  status: PullRequestStatus
  isDraft: boolean
  author: IssueUser
  sourceBranch: string
  targetBranch: string
  labels: string[]
  reviewers: Reviewer[]
  commits: number
  additions: number
  deletions: number
  changedFiles: number
  checks: PRChecks
}

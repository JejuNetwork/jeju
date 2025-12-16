/**
 * Git Types for DWS
 * Consolidated from apps/git and apps/dws
 */

import type { Address, Hex } from 'viem';

// ============ Git Object Types ============

export type GitObjectType = 'blob' | 'tree' | 'commit' | 'tag';

export interface GitObject {
  type: GitObjectType;
  oid: string; // SHA-1 hash (40 hex chars)
  size: number;
  content: Buffer;
}

export interface GitBlob {
  type: 'blob';
  oid: string;
  content: Buffer;
}

export interface GitTreeEntry {
  mode: string; // '100644' (file), '100755' (executable), '040000' (dir), '120000' (symlink), '160000' (submodule)
  name: string;
  oid: string;
  type: 'blob' | 'tree' | 'commit';
}

export interface GitTree {
  type: 'tree';
  oid: string;
  entries: GitTreeEntry[];
}

export interface GitCommitAuthor {
  name: string;
  email: string;
  timestamp: number;
  timezoneOffset: number;
}

export interface GitCommit {
  type: 'commit';
  oid: string;
  tree: string;
  parents: string[];
  author: GitCommitAuthor;
  committer: GitCommitAuthor;
  message: string;
  gpgSignature?: string;
}

export interface GitTag {
  type: 'tag';
  oid: string;
  object: string;
  objectType: GitObjectType;
  tag: string;
  tagger: GitCommitAuthor;
  message: string;
  gpgSignature?: string;
}

// ============ Git Reference Types ============

export interface GitRef {
  name: string; // e.g., 'refs/heads/main', 'HEAD'
  oid: string;
  symbolic?: string; // For symbolic refs like HEAD -> refs/heads/main
}

export interface GitRefUpdate {
  name: string;
  oldOid: string;
  newOid: string;
}

// ============ Repository Types ============

export type RepoVisibility = 'public' | 'private' | 'internal';
export type RepoVisibilityCode = 0 | 1; // 0 = public, 1 = private

export interface Repository {
  repoId: Hex;
  owner: Address;
  agentId: bigint;
  name: string;
  description: string;
  jnsNode: Hex;
  headCommitCid: Hex;
  metadataCid: Hex;
  createdAt: bigint;
  updatedAt: bigint;
  visibility: RepoVisibilityCode;
  archived: boolean;
  starCount: bigint;
  forkCount: bigint;
  forkedFrom: Hex;
  // Extended metadata stored at metadataCid
  defaultBranch?: string;
  topics?: string[];
  license?: string;
  website?: string;
  verified?: boolean;
  reputationScore?: number;
  councilProposalId?: string;
}

export interface Branch {
  repoId: Hex;
  name: string;
  tipCommitCid: Hex;
  lastPusher: Address;
  updatedAt: bigint;
  protected: boolean;
}

export interface Collaborator {
  user: Address;
  agentId: bigint;
  role: CollaboratorRole;
  addedAt: bigint;
}

export type CollaboratorRole = 0 | 1 | 2 | 3; // NONE, READ, WRITE, ADMIN

// ============ Issue Types ============

export type IssueState = 'open' | 'closed';

export interface Issue {
  id: string; // `${repoId}#${number}`
  repoId: Hex;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  author: Address;
  assignees: Address[];
  labels: string[];
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  closedBy?: Address;
  comments: IssueComment[];
  cid: string; // IPFS/storage CID for full content
  reactions?: Record<string, Address[]>;
  milestone?: string;
  linkedPRs?: string[];
}

export interface IssueComment {
  id: string;
  author: Address;
  body: string;
  createdAt: number;
  updatedAt?: number;
  reactions?: Record<string, Address[]>;
}

export interface CreateIssueRequest {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: Address[];
  milestone?: string;
}

export interface UpdateIssueRequest {
  title?: string;
  body?: string;
  state?: IssueState;
  labels?: string[];
  assignees?: Address[];
  milestone?: string;
}

// ============ Pull Request Types ============

export type PRState = 'open' | 'closed' | 'merged';
export type ReviewState = 'approved' | 'changes_requested' | 'commented' | 'pending';

export interface PullRequest {
  id: string; // `${repoId}!${number}`
  repoId: Hex;
  number: number;
  title: string;
  body: string;
  state: PRState;
  author: Address;
  sourceBranch: string;
  targetBranch: string;
  sourceRepo?: Hex; // For cross-repo PRs (forks)
  headCommit: string;
  baseCommit: string;
  commits: string[];
  reviewers: Address[];
  reviews: PRReview[];
  labels: string[];
  createdAt: number;
  updatedAt: number;
  mergedAt?: number;
  closedAt?: number;
  mergedBy?: Address;
  closedBy?: Address;
  cid: string; // IPFS/storage CID for full content
  draft: boolean;
  mergeable?: boolean;
  checksStatus?: 'pending' | 'passing' | 'failing';
  linkedIssues?: string[];
}

export interface PRReview {
  id: string;
  author: Address;
  state: ReviewState;
  body?: string;
  createdAt: number;
  commitOid: string;
  comments?: PRReviewComment[];
}

export interface PRReviewComment {
  id: string;
  author: Address;
  body: string;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  createdAt: number;
}

export interface CreatePRRequest {
  title: string;
  body?: string;
  sourceBranch: string;
  targetBranch?: string;
  sourceRepo?: Hex;
  draft?: boolean;
  reviewers?: Address[];
  labels?: string[];
}

export interface UpdatePRRequest {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  draft?: boolean;
  reviewers?: Address[];
  labels?: string[];
}

export interface MergePRRequest {
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  commitTitle?: string;
  commitMessage?: string;
  deleteSourceBranch?: boolean;
}

// ============ User Types ============

export type UserTier = 'free' | 'basic' | 'pro' | 'unlimited';

export interface GitUser {
  address: Address;
  username?: string;
  jnsName?: string;
  email?: string;
  publicKey?: string;
  avatarUrl?: string;
  bio?: string;
  company?: string;
  location?: string;
  website?: string;
  repositories: Hex[];
  starredRepos: Hex[];
  balance: bigint;
  stakedAmount: bigint;
  tier: UserTier;
  reputationScore: number;
  createdAt: number;
  lastActivity: number;
  // Social links
  twitter?: string;
  github?: string;
  // Stats
  totalCommits?: number;
  totalPRs?: number;
  totalIssues?: number;
}

// ============ Star/Fork Types ============

export interface Star {
  repoId: Hex;
  user: Address;
  starredAt: number;
}

export interface Fork {
  originalRepoId: Hex;
  forkedRepoId: Hex;
  forkedBy: Address;
  forkedAt: number;
}

// ============ Search Types ============

export interface RepoSearchResult {
  totalCount: number;
  items: Repository[];
}

export interface CodeSearchResult {
  totalCount: number;
  items: CodeSearchHit[];
}

export interface CodeSearchHit {
  repoId: Hex;
  path: string;
  oid: string;
  matches: Array<{
    line: number;
    content: string;
    highlight: [number, number][];
  }>;
}

export interface UserSearchResult {
  totalCount: number;
  items: GitUser[];
}

export interface IssueSearchResult {
  totalCount: number;
  items: Issue[];
}

// ============ Federation Types (ActivityPub) ============

export interface FederationConfig {
  enabled: boolean;
  instanceUrl: string;
  publicKeyPem?: string;
  privateKeyPem?: string;
}

export interface ActivityPubActor {
  '@context': string[];
  id: string;
  type: 'Person' | 'Organization' | 'Application';
  preferredUsername: string;
  name?: string;
  summary?: string;
  inbox: string;
  outbox: string;
  followers?: string;
  following?: string;
  publicKey: {
    id: string;
    owner: string;
    publicKeyPem: string;
  };
  icon?: {
    type: 'Image';
    url: string;
    mediaType: string;
  };
}

export interface ActivityPubActivity {
  '@context': string | string[];
  id: string;
  type: ActivityType;
  actor: string;
  object: string | ActivityPubObject;
  published?: string;
  to?: string[];
  cc?: string[];
}

export type ActivityType =
  | 'Create'
  | 'Update'
  | 'Delete'
  | 'Follow'
  | 'Accept'
  | 'Reject'
  | 'Undo'
  | 'Like'
  | 'Announce'
  | 'Push' // Git-specific: push event
  | 'Fork' // Git-specific: fork event
  | 'Star'; // Git-specific: star event

export interface ActivityPubObject {
  '@context'?: string | string[];
  id: string;
  type: string;
  attributedTo?: string;
  content?: string;
  published?: string;
  updated?: string;
  url?: string;
  name?: string;
  summary?: string;
}

export interface NodeInfo {
  version: string;
  software: {
    name: string;
    version: string;
    repository?: string;
  };
  protocols: string[];
  usage: {
    users: { total: number; activeMonth: number };
    localPosts: number;
  };
  openRegistrations: boolean;
  metadata: Record<string, string | number | boolean>;
}

export interface WebFingerResponse {
  subject: string;
  aliases?: string[];
  links: Array<{
    rel: string;
    type?: string;
    href?: string;
    template?: string;
  }>;
}

// ============ Payment Types (x402) ============

export interface PaymentTier {
  tier: UserTier;
  monthlyPrice: bigint; // In wei
  features: {
    privateRepos: number; // -1 for unlimited
    storageGB: number;
    collaboratorsPerRepo: number;
    ciMinutesPerMonth: number;
    largePushSizeMB: number;
  };
}

export interface PaymentRequirement {
  x402Version: number;
  error: string;
  accepts: Array<{
    scheme: 'exact' | 'streaming';
    network: string;
    maxAmountRequired: string;
    asset: Address;
    payTo: Address;
    resource: string;
    description: string;
  }>;
}

export interface GitPaymentConfig {
  paymentRecipient: Address;
  tiers: PaymentTier[];
  // Per-action costs (in wei, 0 = free)
  costs: {
    createPrivateRepo: bigint;
    pushPerMB: bigint;
    pullRequestCreate: bigint;
    issueCreate: bigint;
    collaboratorAdd: bigint;
  };
}

// ============ Git Pack Protocol Types ============

export interface PackfileHeader {
  version: number;
  numObjects: number;
}

export interface PackedObject {
  type: GitObjectType;
  size: number;
  data: Buffer;
  oid?: string;
  baseOid?: string; // For delta objects
  offset?: number;
}

export interface GitCapabilities {
  'side-band-64k'?: boolean;
  'report-status'?: boolean;
  'delete-refs'?: boolean;
  'quiet'?: boolean;
  'atomic'?: boolean;
  'ofs-delta'?: boolean;
  'agent'?: string;
  'push-options'?: boolean;
  'object-format'?: string;
}

// ============ Smart Protocol Types ============

export interface UploadPackRequest {
  wants: string[];
  haves: string[];
  shallows?: string[];
  deepen?: number;
  filter?: string;
  capabilities: GitCapabilities;
}

export interface ReceivePackRequest {
  updates: GitRefUpdate[];
  packfile: Buffer;
  capabilities: GitCapabilities;
  pushOptions?: string[];
}

export interface ReceivePackResult {
  success: boolean;
  refResults: Array<{
    ref: string;
    success: boolean;
    error?: string;
  }>;
}

// ============ Storage Types ============

export interface StoredGitObject {
  cid: string; // IPFS/storage CID
  oid: string; // Git SHA-1
  type: GitObjectType;
  size: number;
}

export interface RepoObjectIndex {
  repoId: Hex;
  objects: Map<string, StoredGitObject>; // oid -> StoredGitObject
  refs: Map<string, string>; // ref name -> oid
}

// ============ On-Chain Metadata Types ============

/**
 * Extended repository metadata stored at metadataCid.
 * Includes issues, PRs, and social data as CID references.
 */
export interface RepoMetadata {
  version: 1;
  defaultBranch: string;
  topics: string[];
  license?: string;
  website?: string;
  readme?: string; // CID of README content
  // Issue/PR indices (CIDs pointing to arrays)
  issueIndexCid?: string;
  prIndexCid?: string;
  // Contributors list
  contributors: Address[];
  // Federation
  federationEnabled: boolean;
  federationActorUrl?: string;
  // Verification
  verified: boolean;
  verifiedAt?: number;
  verifiedBy?: Address;
}

/**
 * Index of issues stored at issueIndexCid
 */
export interface IssueIndex {
  repoId: Hex;
  totalCount: number;
  openCount: number;
  closedCount: number;
  issues: Array<{
    number: number;
    cid: string;
    state: IssueState;
    title: string;
    author: Address;
    createdAt: number;
    updatedAt: number;
  }>;
}

/**
 * Index of PRs stored at prIndexCid
 */
export interface PRIndex {
  repoId: Hex;
  totalCount: number;
  openCount: number;
  closedCount: number;
  mergedCount: number;
  prs: Array<{
    number: number;
    cid: string;
    state: PRState;
    title: string;
    author: Address;
    sourceBranch: string;
    targetBranch: string;
    createdAt: number;
    updatedAt: number;
  }>;
}

// ============ API Types ============

export interface CreateRepoRequest {
  name: string;
  description?: string;
  visibility?: RepoVisibility;
  agentId?: string;
  defaultBranch?: string;
  topics?: string[];
  license?: string;
  federationEnabled?: boolean;
}

export interface CreateRepoResponse {
  repoId: Hex;
  name: string;
  owner: Address;
  cloneUrl: string;
}

export interface PushRequest {
  repoId: Hex;
  branch: string;
  objects: Array<{
    oid: string;
    type: GitObjectType;
    content: string; // base64 encoded
  }>;
  newTip: string;
  oldTip?: string;
  message?: string;
  signature: Hex;
}

export interface CloneRequest {
  repoId: Hex;
  branch?: string;
  depth?: number;
}

// ============ Event Types ============

export interface PushEvent {
  repoId: Hex;
  branch: string;
  oldCommitCid: Hex;
  newCommitCid: Hex;
  pusher: Address;
  timestamp: bigint;
  commitCount: bigint;
}

export interface ContributionEvent {
  source: 'jeju-git';
  type: ContributionType;
  repoId: Hex;
  author: Address;
  timestamp: number;
  metadata: {
    branch?: string;
    commitCount?: number;
    message?: string;
    prNumber?: number;
    issueNumber?: number;
  };
}

export type ContributionType =
  | 'commit'
  | 'branch'
  | 'merge'
  | 'pr_open'
  | 'pr_merge'
  | 'pr_review'
  | 'issue_open'
  | 'issue_close'
  | 'star'
  | 'fork';

// ============ Reputation Types ============

export interface GitReputationScore {
  totalScore: number;
  components: {
    commitScore: number;
    prScore: number;
    issueScore: number;
    reviewScore: number;
    adoptionScore: number; // stars + forks
  };
  normalizedScore: number; // 0-100 for ERC-8004
  lastUpdated: number;
}

export interface RepoMetrics {
  commitCount: number;
  contributorCount: number;
  prMergeRate: number;
  issueCloseRate: number;
  starCount: number;
  forkCount: number;
  codeQualityScore: number;
  documentationScore: number;
}

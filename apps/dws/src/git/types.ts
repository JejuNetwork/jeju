/**
 * Git Types for DWS
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

export interface RepoVisibility {
  PUBLIC: 0;
  PRIVATE: 1;
}

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
  visibility: 0 | 1;
  archived: boolean;
  starCount: bigint;
  forkCount: bigint;
  forkedFrom: Hex;
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
  role: 0 | 1 | 2 | 3; // NONE, READ, WRITE, ADMIN
  addedAt: bigint;
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

// ============ API Types ============

export interface CreateRepoRequest {
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
  agentId?: string;
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
  type: 'commit' | 'branch' | 'merge';
  repoId: Hex;
  author: Address;
  timestamp: number;
  metadata: {
    branch?: string;
    commitCount?: number;
    message?: string;
  };
}


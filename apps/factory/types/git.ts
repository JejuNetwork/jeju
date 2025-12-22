/**
 * Git Repository Types
 */

import type { Address } from 'viem';
import type { Timestamps } from './common';

export interface Repository extends Timestamps {
  id: string;
  name: string;
  owner: string;
  description?: string;
  isPrivate: boolean;
  defaultBranch: string;
  stars: number;
  forks: number;
}

export interface RepoFile {
  path: string;
  type: 'file' | 'dir';
  size?: number;
  sha: string;
}

export interface Branch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface Commit {
  sha: string;
  message: string;
  author: Address;
  timestamp: number;
}

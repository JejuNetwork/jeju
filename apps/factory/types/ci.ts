/**
 * CI/CD Types
 */

import type { Timestamps } from './common';

export type CIStatus = 'queued' | 'running' | 'success' | 'failure' | 'cancelled';

export type CIJobStatus = 'pending' | 'running' | 'success' | 'failure';

export interface CIJob {
  name: string;
  status: CIJobStatus;
  duration?: number;
}

export interface CIRun extends Timestamps {
  id: string;
  workflow: string;
  status: CIStatus;
  conclusion?: CIStatus;
  branch: string;
  commit: string;
  commitMessage: string;
  author: string;
  duration?: number;
  startedAt: number;
  completedAt?: number;
  jobs: CIJob[];
}

/**
 * Issue Types
 */

import type { Timestamps } from './common';

export type IssueStatus = 'open' | 'closed';

export interface IssueUser {
  name: string;
  avatar?: string;
}

export interface Issue extends Timestamps {
  id: string;
  number: number;
  repo: string;
  title: string;
  body: string;
  status: IssueStatus;
  author: IssueUser;
  labels: string[];
  assignees: IssueUser[];
  comments: number;
}

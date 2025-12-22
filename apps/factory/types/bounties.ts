/**
 * Bounty Types
 */

import type { Address } from 'viem';
import type { Timestamps } from './common';

export type BountyStatus = 'open' | 'in_progress' | 'review' | 'completed' | 'cancelled';

export interface BountyMilestone {
  name: string;
  description: string;
  reward: string;
  currency: string;
  deadline: number;
}

export interface Bounty extends Timestamps {
  id: string;
  title: string;
  description: string;
  reward: string;
  currency: string;
  status: BountyStatus;
  skills: string[];
  creator: Address;
  deadline: number;
  submissions: number;
  milestones?: BountyMilestone[];
}

export interface BountySubmission {
  id: string;
  bountyId: string;
  submitter: Address;
  deliverableUri: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

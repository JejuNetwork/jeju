/**
 * Dataset Types
 */

import type { Timestamps } from './common';

export type DatasetType = 'text' | 'code' | 'image' | 'audio' | 'multimodal' | 'tabular';

export interface Dataset extends Timestamps {
  id: string;
  name: string;
  organization: string;
  description: string;
  type: DatasetType;
  format: string;
  size: string;
  rows: number;
  downloads: number;
  stars: number;
  license: string;
  tags: string[];
  isVerified: boolean;
  status?: 'processing' | 'ready' | 'failed';
}

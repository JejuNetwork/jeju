/**
 * Package Types
 */

import type { Timestamps } from './common';

export interface Package extends Timestamps {
  name: string;
  version: string;
  description?: string;
  author: string;
  license: string;
  downloads: number;
  tarballUri: string;
  dependencies: Record<string, string>;
}

export interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
  author: string;
  license: string;
  dependencies?: Record<string, string>;
}

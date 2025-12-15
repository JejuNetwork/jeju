/**
 * NPM Registry Types
 */

import type { Address, Hex } from 'viem';

// ============ Package Types ============

export interface Package {
  packageId: Hex;
  name: string;
  scope: string;
  owner: Address;
  agentId: bigint;
  jnsNode: Hex;
  description: string;
  license: string;
  homepage: string;
  repository: string;
  latestVersion: Hex;
  createdAt: bigint;
  updatedAt: bigint;
  deprecated: boolean;
  downloadCount: bigint;
}

export interface PackageVersion {
  versionId: Hex;
  packageId: Hex;
  version: string;
  tarballCid: Hex;
  integrityHash: Hex;
  manifestCid: Hex;
  size: bigint;
  publisher: Address;
  publishedAt: bigint;
  deprecated: boolean;
  deprecationMessage: string;
}

export interface Maintainer {
  user: Address;
  agentId: bigint;
  canPublish: boolean;
  canManage: boolean;
  addedAt: bigint;
}

// ============ NPM Registry API Types (npm CLI compatible) ============

export interface NpmPackageMetadata {
  _id: string;
  _rev?: string;
  name: string;
  description: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, NpmVersionMetadata>;
  time: Record<string, string>;
  maintainers: Array<{ name: string; email?: string }>;
  keywords?: string[];
  repository?: { type: string; url: string };
  homepage?: string;
  license?: string;
  readme?: string;
  readmeFilename?: string;
}

export interface NpmVersionMetadata {
  name: string;
  version: string;
  description?: string;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  repository?: { type: string; url: string };
  keywords?: string[];
  author?: string | { name: string; email?: string; url?: string };
  license?: string;
  homepage?: string;
  bugs?: { url?: string; email?: string };
  dist: {
    shasum: string;
    tarball: string;
    integrity?: string;
    fileCount?: number;
    unpackedSize?: number;
  };
  deprecated?: string;
  _id: string;
  _npmVersion?: string;
  _nodeVersion?: string;
  _npmUser?: { name: string; email?: string };
}

export interface NpmPublishPayload {
  _id: string;
  name: string;
  description?: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, NpmVersionMetadata>;
  readme?: string;
  _attachments: Record<
    string,
    {
      content_type: string;
      data: string; // base64 encoded tarball
      length: number;
    }
  >;
}

export interface NpmSearchResult {
  objects: Array<{
    package: {
      name: string;
      scope?: string;
      version: string;
      description?: string;
      keywords?: string[];
      date: string;
      links?: { npm?: string; homepage?: string; repository?: string; bugs?: string };
      author?: { name?: string; email?: string; username?: string };
      publisher?: { username: string; email?: string };
      maintainers?: Array<{ username: string; email?: string }>;
    };
    score: {
      final: number;
      detail: { quality: number; popularity: number; maintenance: number };
    };
    searchScore: number;
  }>;
  total: number;
  time: string;
}

// ============ API Request/Response Types ============

export interface CreatePackageRequest {
  name: string;
  scope?: string;
  description?: string;
  license?: string;
  agentId?: string;
}

export interface PublishVersionRequest {
  version: string;
  tarball: string; // base64 encoded
  manifest: Record<string, unknown>;
}

export interface PackageInfoResponse {
  packageId: Hex;
  name: string;
  scope: string;
  fullName: string;
  owner: Address;
  description: string;
  license: string;
  homepage: string;
  repository: string;
  latestVersion: string;
  createdAt: number;
  updatedAt: number;
  deprecated: boolean;
  downloadCount: number;
  versions: string[];
  maintainers: Array<{ address: Address; canPublish: boolean; canManage: boolean }>;
}

// ============ Storage Types ============

export interface StoredTarball {
  cid: string;
  size: number;
  integrity: string;
}

export interface PackageManifest {
  name: string;
  version: string;
  description?: string;
  main?: string;
  types?: string;
  module?: string;
  exports?: Record<string, unknown>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  repository?: string | { type: string; url: string };
  keywords?: string[];
  author?: string | { name: string; email?: string; url?: string };
  license?: string;
  homepage?: string;
  bugs?: string | { url?: string; email?: string };
  files?: string[];
  bin?: string | Record<string, string>;
}


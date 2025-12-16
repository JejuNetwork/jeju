/**
 * DWS (Decentralized Workspace Services) client
 * Integrates with the existing dws backend for Git, Packages, CI/CD, and Compute
 */

const DWS_API_URL = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:3456';

// ============ Types ============

export interface Repository {
  id: string;
  name: string;
  owner: string;
  description?: string;
  isPrivate: boolean;
  defaultBranch: string;
  stars: number;
  forks: number;
  createdAt: number;
  updatedAt: number;
}

export interface Package {
  name: string;
  version: string;
  description?: string;
  author: string;
  license: string;
  downloads: number;
  publishedAt: number;
  tarballUri: string;
  dependencies: Record<string, string>;
}

export interface ContainerImage {
  name: string;
  tag: string;
  digest: string;
  size: number;
  architecture: string;
  os: string;
  pushedAt: number;
  manifestUri: string;
}

export interface ComputeJob {
  id: string;
  type: 'training' | 'inference' | 'build';
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: Record<string, string>;
  output?: Record<string, string>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  cost?: bigint;
}

export interface Model {
  id: string;
  name: string;
  organization: string;
  description: string;
  type: string;
  version: string;
  fileUri: string;
  configUri: string;
  downloads: number;
  stars: number;
  createdAt: number;
}

// ============ Git API ============

export async function listRepositories(owner?: string): Promise<Repository[]> {
  const params = owner ? `?owner=${owner}` : '';
  const response = await fetch(`${DWS_API_URL}/api/git/repos${params}`);
  if (!response.ok) throw new Error('Failed to fetch repositories');
  return response.json();
}

export async function getRepository(owner: string, name: string): Promise<Repository> {
  const response = await fetch(`${DWS_API_URL}/api/git/repos/${owner}/${name}`);
  if (!response.ok) throw new Error('Repository not found');
  return response.json();
}

export async function createRepository(params: {
  name: string;
  description?: string;
  isPrivate?: boolean;
}): Promise<Repository> {
  const response = await fetch(`${DWS_API_URL}/api/git/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('Failed to create repository');
  return response.json();
}

export async function getRepoFiles(owner: string, name: string, path = '', ref = 'main'): Promise<{
  path: string;
  type: 'file' | 'dir';
  size?: number;
  sha: string;
}[]> {
  const response = await fetch(
    `${DWS_API_URL}/api/git/repos/${owner}/${name}/contents/${path}?ref=${ref}`
  );
  if (!response.ok) throw new Error('Failed to fetch files');
  return response.json();
}

export async function getFileContent(owner: string, name: string, path: string, ref = 'main'): Promise<string> {
  const response = await fetch(
    `${DWS_API_URL}/api/git/repos/${owner}/${name}/raw/${path}?ref=${ref}`
  );
  if (!response.ok) throw new Error('Failed to fetch file content');
  return response.text();
}

// ============ Package API ============

export async function searchPackages(query: string): Promise<Package[]> {
  const response = await fetch(`${DWS_API_URL}/api/packages/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error('Search failed');
  return response.json();
}

export async function getPackage(name: string, version?: string): Promise<Package> {
  const versionPart = version ? `/${version}` : '';
  const response = await fetch(`${DWS_API_URL}/api/packages/${encodeURIComponent(name)}${versionPart}`);
  if (!response.ok) throw new Error('Package not found');
  return response.json();
}

export async function publishPackage(tarball: Blob, metadata: {
  name: string;
  version: string;
  description?: string;
}): Promise<Package> {
  const formData = new FormData();
  formData.append('tarball', tarball);
  formData.append('metadata', JSON.stringify(metadata));
  
  const response = await fetch(`${DWS_API_URL}/api/packages`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error('Failed to publish package');
  return response.json();
}

// ============ Container API ============

export async function listImages(repository?: string): Promise<ContainerImage[]> {
  const params = repository ? `?repository=${repository}` : '';
  const response = await fetch(`${DWS_API_URL}/api/containers/images${params}`);
  if (!response.ok) throw new Error('Failed to fetch images');
  return response.json();
}

export async function getImageManifest(name: string, tag: string): Promise<{
  schemaVersion: number;
  mediaType: string;
  config: { digest: string };
  layers: { digest: string; size: number }[];
}> {
  const response = await fetch(`${DWS_API_URL}/api/containers/${name}/manifests/${tag}`);
  if (!response.ok) throw new Error('Manifest not found');
  return response.json();
}

// ============ Compute API ============

export async function createTrainingJob(params: {
  modelName: string;
  baseModel?: string;
  datasetUri: string;
  config: Record<string, unknown>;
}): Promise<ComputeJob> {
  const response = await fetch(`${DWS_API_URL}/api/compute/training`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('Failed to create training job');
  return response.json();
}

export async function createInferenceJob(params: {
  modelId: string;
  input: Record<string, unknown>;
}): Promise<ComputeJob> {
  const response = await fetch(`${DWS_API_URL}/api/compute/inference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('Failed to create inference job');
  return response.json();
}

export async function getJob(jobId: string): Promise<ComputeJob> {
  const response = await fetch(`${DWS_API_URL}/api/compute/jobs/${jobId}`);
  if (!response.ok) throw new Error('Job not found');
  return response.json();
}

export async function listJobs(status?: string): Promise<ComputeJob[]> {
  const params = status ? `?status=${status}` : '';
  const response = await fetch(`${DWS_API_URL}/api/compute/jobs${params}`);
  if (!response.ok) throw new Error('Failed to fetch jobs');
  return response.json();
}

// ============ Model Hub API ============

export async function listModels(params?: {
  type?: string;
  organization?: string;
  search?: string;
}): Promise<Model[]> {
  const searchParams = new URLSearchParams();
  if (params?.type) searchParams.set('type', params.type);
  if (params?.organization) searchParams.set('org', params.organization);
  if (params?.search) searchParams.set('q', params.search);
  
  const query = searchParams.toString();
  const response = await fetch(`${DWS_API_URL}/api/models${query ? '?' + query : ''}`);
  if (!response.ok) throw new Error('Failed to fetch models');
  return response.json();
}

export async function getModel(organization: string, name: string): Promise<Model> {
  const response = await fetch(`${DWS_API_URL}/api/models/${organization}/${name}`);
  if (!response.ok) throw new Error('Model not found');
  return response.json();
}

export async function uploadModel(params: {
  name: string;
  organization: string;
  description: string;
  type: string;
  file: Blob;
  config?: Blob;
}): Promise<Model> {
  const formData = new FormData();
  formData.append('name', params.name);
  formData.append('organization', params.organization);
  formData.append('description', params.description);
  formData.append('type', params.type);
  formData.append('model', params.file);
  if (params.config) {
    formData.append('config', params.config);
  }
  
  const response = await fetch(`${DWS_API_URL}/api/models`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error('Failed to upload model');
  return response.json();
}

export async function runInference(modelId: string, input: Record<string, unknown>): Promise<{
  jobId: string;
  result?: unknown;
  status: string;
}> {
  const response = await fetch(`${DWS_API_URL}/api/models/${modelId}/inference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  if (!response.ok) throw new Error('Inference failed');
  return response.json();
}

// ============ IPFS Upload ============

export async function uploadToIpfs(file: Blob | string, filename?: string): Promise<string> {
  const formData = new FormData();
  if (typeof file === 'string') {
    formData.append('file', new Blob([file], { type: 'text/plain' }), filename || 'file.txt');
  } else {
    formData.append('file', file, filename);
  }
  
  const response = await fetch(`${DWS_API_URL}/api/ipfs/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error('Failed to upload to IPFS');
  const data = await response.json();
  return data.cid;
}

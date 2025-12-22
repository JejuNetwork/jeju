/**
 * Container Deployment for API Marketplace
 * Allows users to deploy their own API services as containers or workers
 */

import type { Address } from 'viem';

export type DeploymentType = 'container' | 'worker' | 'serverless';
// Re-export consolidated DeploymentStatus
import type { DeploymentStatus } from '@jejunetwork/types';
export type { DeploymentStatus };

export interface ContainerSpec {
  image: string;                    // Container image or code bundle CID
  entrypoint?: string[];            // Override entrypoint
  command?: string[];               // Override command
  ports: number[];                  // Exposed ports
  env: Record<string, string>;      // Environment variables
  resources: {
    cpu: number;                    // CPU cores (0.1 - 8)
    memory: number;                 // Memory in MB (128 - 32768)
    storage?: number;               // Storage in GB
  };
  healthCheck?: {
    path: string;
    port: number;
    interval: number;
    timeout: number;
  };
  scaling?: {
    minInstances: number;
    maxInstances: number;
    targetConcurrency: number;
  };
}

export interface WorkerSpec {
  codeCid: string;                  // IPFS CID of code bundle
  runtime: 'bun' | 'node' | 'deno';
  handler: string;                  // e.g., "index.handler"
  memory: number;                   // Memory in MB
  timeout: number;                  // Timeout in ms
  env: Record<string, string>;
}

export interface APIDeployment {
  id: string;
  name: string;
  description: string;
  owner: Address;
  type: DeploymentType;
  spec: ContainerSpec | WorkerSpec;
  status: DeploymentStatus;
  endpoint?: string;                // Public endpoint when running
  createdAt: number;
  updatedAt: number;
  lastDeployedAt?: number;
  version: number;
  
  // API settings
  authRequired: boolean;
  rateLimit: {
    requestsPerMinute: number;
    requestsPerHour: number;
  };
  
  // Marketplace settings
  listed: boolean;
  pricePerRequest?: bigint;
  
  // KMS integration
  kmsKeyIds?: string[];             // Associated KMS keys
  secretRefs?: string[];            // References to vault secrets
  
  // Metrics
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number;
}

export interface DeploymentLog {
  deploymentId: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, string>;
}

// Deployment storage
const deployments = new Map<string, APIDeployment>();
const deploymentLogs = new Map<string, DeploymentLog[]>();

// Pre-configured templates for popular services
export const DEPLOYMENT_TEMPLATES: Record<string, Partial<APIDeployment>> = {
  'openai-proxy': {
    name: 'OpenAI Proxy',
    description: 'Proxy for OpenAI API with caching and rate limiting',
    type: 'worker',
    authRequired: true,
    rateLimit: { requestsPerMinute: 60, requestsPerHour: 1000 },
  },
  'anthropic-proxy': {
    name: 'Anthropic Proxy',
    description: 'Proxy for Anthropic Claude API',
    type: 'worker',
    authRequired: true,
    rateLimit: { requestsPerMinute: 60, requestsPerHour: 1000 },
  },
  'image-gen': {
    name: 'Image Generation API',
    description: 'Image generation service with multiple backends',
    type: 'container',
    authRequired: true,
    rateLimit: { requestsPerMinute: 10, requestsPerHour: 100 },
  },
  'data-pipeline': {
    name: 'Data Pipeline',
    description: 'ETL and data processing service',
    type: 'container',
    authRequired: true,
    rateLimit: { requestsPerMinute: 100, requestsPerHour: 5000 },
  },
  'web-scraper': {
    name: 'Web Scraper',
    description: 'Browserless-compatible web scraping service',
    type: 'container',
    authRequired: true,
    rateLimit: { requestsPerMinute: 30, requestsPerHour: 500 },
  },
};

/**
 * Create a new deployment
 */
export function createDeployment(params: {
  name: string;
  description: string;
  owner: Address;
  type: DeploymentType;
  spec: ContainerSpec | WorkerSpec;
  authRequired?: boolean;
  rateLimit?: { requestsPerMinute: number; requestsPerHour: number };
  templateId?: string;
}): APIDeployment {
  const template = params.templateId ? DEPLOYMENT_TEMPLATES[params.templateId] : {};
  
  const deployment: APIDeployment = {
    id: crypto.randomUUID(),
    name: params.name,
    description: params.description,
    owner: params.owner,
    type: params.type,
    spec: params.spec,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    authRequired: params.authRequired ?? template.authRequired ?? true,
    rateLimit: params.rateLimit ?? template.rateLimit ?? {
      requestsPerMinute: 60,
      requestsPerHour: 1000,
    },
    listed: false,
    requestCount: 0,
    errorCount: 0,
    avgLatencyMs: 0,
  };

  deployments.set(deployment.id, deployment);
  deploymentLogs.set(deployment.id, []);
  
  addLog(deployment.id, 'info', 'Deployment created');

  return deployment;
}

/**
 * Get deployment by ID
 */
export function getDeployment(id: string): APIDeployment | null {
  return deployments.get(id) ?? null;
}

/**
 * List deployments
 */
export function listDeployments(filter?: {
  owner?: Address;
  type?: DeploymentType;
  status?: DeploymentStatus;
  listed?: boolean;
}): APIDeployment[] {
  let result = Array.from(deployments.values());
  
  if (filter?.owner) {
    result = result.filter(d => d.owner.toLowerCase() === filter.owner!.toLowerCase());
  }
  if (filter?.type) {
    result = result.filter(d => d.type === filter.type);
  }
  if (filter?.status) {
    result = result.filter(d => d.status === filter.status);
  }
  if (filter?.listed !== undefined) {
    result = result.filter(d => d.listed === filter.listed);
  }

  return result;
}

/**
 * Update deployment configuration
 */
export function updateDeployment(
  id: string,
  updates: Partial<Pick<APIDeployment, 'name' | 'description' | 'spec' | 'authRequired' | 'rateLimit' | 'pricePerRequest'>>
): APIDeployment | null {
  const deployment = deployments.get(id);
  if (!deployment) return null;

  Object.assign(deployment, updates, { updatedAt: Date.now() });
  
  addLog(id, 'info', 'Deployment configuration updated');

  return deployment;
}

/**
 * Deploy (start) the service
 */
export async function deploy(id: string): Promise<APIDeployment | null> {
  const deployment = deployments.get(id);
  if (!deployment) return null;

  deployment.status = 'deploying';
  deployment.updatedAt = Date.now();
  addLog(id, 'info', 'Starting deployment');

  // Simulate deployment process
  await new Promise(r => setTimeout(r, 1000));

  deployment.status = 'running';
  deployment.lastDeployedAt = Date.now();
  deployment.endpoint = `https://api.dws.dev/${deployment.id}`;
  deployment.version++;
  
  addLog(id, 'info', `Deployment successful. Endpoint: ${deployment.endpoint}`);

  return deployment;
}

/**
 * Stop the deployment
 */
export async function stopDeployment(id: string): Promise<APIDeployment | null> {
  const deployment = deployments.get(id);
  if (!deployment) return null;

  deployment.status = 'stopped';
  deployment.updatedAt = Date.now();
  deployment.endpoint = undefined;
  
  addLog(id, 'info', 'Deployment stopped');

  return deployment;
}

/**
 * Delete deployment
 */
export function deleteDeployment(id: string): boolean {
  const deleted = deployments.delete(id);
  deploymentLogs.delete(id);
  return deleted;
}

/**
 * List deployment to marketplace
 */
export function listToMarketplace(
  id: string,
  pricePerRequest: bigint
): APIDeployment | null {
  const deployment = deployments.get(id);
  if (!deployment) return null;
  
  if (deployment.status !== 'running') {
    throw new Error('Deployment must be running to list on marketplace');
  }

  deployment.listed = true;
  deployment.pricePerRequest = pricePerRequest;
  deployment.updatedAt = Date.now();
  
  addLog(id, 'info', `Listed on marketplace at ${pricePerRequest} wei/request`);

  return deployment;
}

/**
 * Unlist from marketplace
 */
export function unlistFromMarketplace(id: string): APIDeployment | null {
  const deployment = deployments.get(id);
  if (!deployment) return null;

  deployment.listed = false;
  deployment.updatedAt = Date.now();
  
  addLog(id, 'info', 'Unlisted from marketplace');

  return deployment;
}

/**
 * Associate KMS key with deployment
 */
export function addKMSKey(deploymentId: string, keyId: string): APIDeployment | null {
  const deployment = deployments.get(deploymentId);
  if (!deployment) return null;

  deployment.kmsKeyIds = deployment.kmsKeyIds ?? [];
  if (!deployment.kmsKeyIds.includes(keyId)) {
    deployment.kmsKeyIds.push(keyId);
  }
  deployment.updatedAt = Date.now();
  
  addLog(deploymentId, 'info', `Associated KMS key: ${keyId}`);

  return deployment;
}

/**
 * Add secret reference
 */
export function addSecretRef(deploymentId: string, secretRef: string): APIDeployment | null {
  const deployment = deployments.get(deploymentId);
  if (!deployment) return null;

  deployment.secretRefs = deployment.secretRefs ?? [];
  if (!deployment.secretRefs.includes(secretRef)) {
    deployment.secretRefs.push(secretRef);
  }
  deployment.updatedAt = Date.now();
  
  addLog(deploymentId, 'info', `Added secret reference: ${secretRef}`);

  return deployment;
}

/**
 * Record request for metrics
 */
export function recordRequest(id: string, latencyMs: number, success: boolean): void {
  const deployment = deployments.get(id);
  if (!deployment) return;

  deployment.requestCount++;
  if (!success) deployment.errorCount++;
  
  // Rolling average for latency
  deployment.avgLatencyMs = (deployment.avgLatencyMs * 0.9) + (latencyMs * 0.1);
}

/**
 * Get deployment logs
 */
export function getLogs(deploymentId: string, limit = 100): DeploymentLog[] {
  const logs = deploymentLogs.get(deploymentId) ?? [];
  return logs.slice(-limit);
}

/**
 * Add log entry
 */
function addLog(
  deploymentId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  metadata?: Record<string, string>
): void {
  const logs = deploymentLogs.get(deploymentId) ?? [];
  logs.push({
    deploymentId,
    timestamp: Date.now(),
    level,
    message,
    metadata,
  });

  // Keep last 1000 logs
  if (logs.length > 1000) {
    logs.splice(0, logs.length - 1000);
  }

  deploymentLogs.set(deploymentId, logs);
}

/**
 * Get marketplace stats
 */
export function getMarketplaceDeploymentStats() {
  const all = Array.from(deployments.values());
  const listed = all.filter(d => d.listed);
  const running = all.filter(d => d.status === 'running');

  return {
    totalDeployments: all.length,
    listedDeployments: listed.length,
    runningDeployments: running.length,
    totalRequests: all.reduce((sum, d) => sum + d.requestCount, 0),
    avgLatencyMs: all.length > 0
      ? all.reduce((sum, d) => sum + d.avgLatencyMs, 0) / all.length
      : 0,
  };
}

/**
 * Get templates
 */
export function getTemplates() {
  return Object.entries(DEPLOYMENT_TEMPLATES).map(([id, template]) => ({
    id,
    ...template,
  }));
}


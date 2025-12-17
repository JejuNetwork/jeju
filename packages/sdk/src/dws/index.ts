/**
 * DWS (Distributed Workflow System) Module
 *
 * Provides access to:
 * - Trigger management (cron, webhook, event-based)
 * - Workflow execution and scheduling
 * - Job monitoring and management
 * - Compute resource allocation
 */

import { type Address, type Hex, encodeFunctionData } from "viem";
import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import { getServicesConfig, getContract as getContractAddress } from "../config";

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum TriggerType {
  CRON = "cron",
  WEBHOOK = "webhook",
  EVENT = "event",
  MANUAL = "manual",
  CHAIN_EVENT = "chain_event",
}

export enum JobStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export enum WorkflowStatus {
  ACTIVE = "active",
  PAUSED = "paused",
  DISABLED = "disabled",
}

export interface Trigger {
  triggerId: string;
  type: TriggerType;
  name: string;
  config: TriggerConfig;
  workflowId: string;
  owner: Address;
  isActive: boolean;
  createdAt: number;
  lastTriggeredAt: number;
  triggerCount: number;
}

export interface TriggerConfig {
  // For CRON
  cronExpression?: string;
  timezone?: string;

  // For WEBHOOK
  webhookSecret?: string;
  allowedOrigins?: string[];

  // For EVENT / CHAIN_EVENT
  contractAddress?: Address;
  eventSignature?: string;
  chainId?: number;

  // Common
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface Workflow {
  workflowId: string;
  name: string;
  description: string;
  owner: Address;
  status: WorkflowStatus;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
  totalExecutions: number;
  successfulExecutions: number;
}

export interface WorkflowStep {
  stepId: string;
  name: string;
  type: "compute" | "storage" | "contract" | "http" | "transform";
  config: Record<string, unknown>;
  dependencies: string[];
  timeout: number;
  retries: number;
}

export interface Job {
  jobId: string;
  workflowId: string;
  triggerId: string;
  status: JobStatus;
  startedAt: number;
  completedAt: number;
  duration: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  logs: string[];
  stepResults: StepResult[];
}

export interface StepResult {
  stepId: string;
  status: JobStatus;
  startedAt: number;
  completedAt: number;
  output: Record<string, unknown>;
  error: string | null;
}

export interface DWSTriggerParams {
  name: string;
  type: TriggerType;
  config: TriggerConfig;
  workflowId: string;
}

export interface CreateWorkflowParams {
  name: string;
  description?: string;
  steps: Omit<WorkflowStep, "stepId">[];
}

export interface ExecuteWorkflowParams {
  workflowId: string;
  input?: Record<string, unknown>;
}

export interface DWSModule {
  // ═══════════════════════════════════════════════════════════════════════
  //                         TRIGGERS
  // ═══════════════════════════════════════════════════════════════════════

  /** Create a new trigger */
  createTrigger(params: DWSTriggerParams): Promise<{ triggerId: string }>;

  /** Get trigger by ID */
  getTrigger(triggerId: string): Promise<Trigger | null>;

  /** List my triggers */
  listMyTriggers(): Promise<Trigger[]>;

  /** Update trigger config */
  updateTrigger(triggerId: string, config: Partial<TriggerConfig>): Promise<void>;

  /** Enable/disable trigger */
  setTriggerActive(triggerId: string, active: boolean): Promise<void>;

  /** Delete trigger */
  deleteTrigger(triggerId: string): Promise<void>;

  /** Manually fire a trigger */
  fireTrigger(triggerId: string, payload?: Record<string, unknown>): Promise<{ jobId: string }>;

  // ═══════════════════════════════════════════════════════════════════════
  //                         WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════

  /** Create a new workflow */
  createWorkflow(params: CreateWorkflowParams): Promise<{ workflowId: string }>;

  /** Get workflow by ID */
  getWorkflow(workflowId: string): Promise<Workflow | null>;

  /** List my workflows */
  listMyWorkflows(): Promise<Workflow[]>;

  /** Update workflow */
  updateWorkflow(workflowId: string, updates: Partial<CreateWorkflowParams>): Promise<void>;

  /** Set workflow status */
  setWorkflowStatus(workflowId: string, status: WorkflowStatus): Promise<void>;

  /** Delete workflow */
  deleteWorkflow(workflowId: string): Promise<void>;

  /** Execute workflow manually */
  executeWorkflow(params: ExecuteWorkflowParams): Promise<{ jobId: string }>;

  // ═══════════════════════════════════════════════════════════════════════
  //                         JOBS
  // ═══════════════════════════════════════════════════════════════════════

  /** Get job by ID */
  getJob(jobId: string): Promise<Job | null>;

  /** List jobs for a workflow */
  listWorkflowJobs(workflowId: string, limit?: number): Promise<Job[]>;

  /** List my recent jobs */
  listMyJobs(limit?: number): Promise<Job[]>;

  /** Cancel a running job */
  cancelJob(jobId: string): Promise<void>;

  /** Retry a failed job */
  retryJob(jobId: string): Promise<{ jobId: string }>;

  /** Get job logs */
  getJobLogs(jobId: string): Promise<string[]>;

  // ═══════════════════════════════════════════════════════════════════════
  //                         STATS & MONITORING
  // ═══════════════════════════════════════════════════════════════════════

  /** Get DWS usage stats */
  getStats(): Promise<{
    totalWorkflows: number;
    totalTriggers: number;
    totalJobs: number;
    successRate: number;
    avgExecutionTime: number;
  }>;

  /** Get workflow metrics */
  getWorkflowMetrics(workflowId: string): Promise<{
    executions: number;
    successRate: number;
    avgDuration: number;
    lastExecuted: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createDWSModule(
  wallet: JejuWallet,
  network: NetworkType,
): DWSModule {
  const services = getServicesConfig(network);
  const dwsApiUrl = services.dws?.api ?? `${services.gateway.api}/dws`;

  async function authHeaders(): Promise<Record<string, string>> {
    const timestamp = Date.now().toString();
    const message = `jeju-dws:${timestamp}`;
    const signature = await wallet.signMessage(message);

    return {
      "Content-Type": "application/json",
      "x-jeju-address": wallet.address,
      "x-jeju-timestamp": timestamp,
      "x-jeju-signature": signature,
    };
  }

  return {
    // ═══════════════════════════════════════════════════════════════════════
    //                         TRIGGERS
    // ═══════════════════════════════════════════════════════════════════════

    async createTrigger(params) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/triggers`, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create trigger: ${error}`);
      }

      return response.json() as Promise<{ triggerId: string }>;
    },

    async getTrigger(triggerId) {
      const response = await fetch(`${dwsApiUrl}/triggers/${triggerId}`);
      if (!response.ok) return null;
      return response.json() as Promise<Trigger>;
    },

    async listMyTriggers() {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/triggers`, { headers });
      if (!response.ok) return [];
      const data = await response.json() as { triggers?: Trigger[] };
      return data.triggers ?? [];
    },

    async updateTrigger(triggerId, config) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/triggers/${triggerId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ config }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to update trigger: ${error}`);
      }
    },

    async setTriggerActive(triggerId, active) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/triggers/${triggerId}/active`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ active }),
      });

      if (!response.ok) {
        throw new Error("Failed to update trigger status");
      }
    },

    async deleteTrigger(triggerId) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/triggers/${triggerId}`, {
        method: "DELETE",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to delete trigger");
      }
    },

    async fireTrigger(triggerId, payload) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/triggers/${triggerId}/fire`, {
        method: "POST",
        headers,
        body: JSON.stringify({ payload }),
      });

      if (!response.ok) {
        throw new Error("Failed to fire trigger");
      }

      return response.json() as Promise<{ jobId: string }>;
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                         WORKFLOWS
    // ═══════════════════════════════════════════════════════════════════════

    async createWorkflow(params) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/workflows`, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create workflow: ${error}`);
      }

      return response.json() as Promise<{ workflowId: string }>;
    },

    async getWorkflow(workflowId) {
      const response = await fetch(`${dwsApiUrl}/workflows/${workflowId}`);
      if (!response.ok) return null;
      return response.json() as Promise<Workflow>;
    },

    async listMyWorkflows() {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/workflows`, { headers });
      if (!response.ok) return [];
      const data = await response.json() as { workflows?: Workflow[] };
      return data.workflows ?? [];
    },

    async updateWorkflow(workflowId, updates) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/workflows/${workflowId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error("Failed to update workflow");
      }
    },

    async setWorkflowStatus(workflowId, status) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/workflows/${workflowId}/status`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        throw new Error("Failed to update workflow status");
      }
    },

    async deleteWorkflow(workflowId) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/workflows/${workflowId}`, {
        method: "DELETE",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to delete workflow");
      }
    },

    async executeWorkflow(params) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/workflows/${params.workflowId}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: params.input }),
      });

      if (!response.ok) {
        throw new Error("Failed to execute workflow");
      }

      return response.json() as Promise<{ jobId: string }>;
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                         JOBS
    // ═══════════════════════════════════════════════════════════════════════

    async getJob(jobId) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/jobs/${jobId}`, { headers });
      if (!response.ok) return null;
      return response.json() as Promise<Job>;
    },

    async listWorkflowJobs(workflowId, limit = 50) {
      const headers = await authHeaders();
      const response = await fetch(
        `${dwsApiUrl}/workflows/${workflowId}/jobs?limit=${limit}`,
        { headers }
      );
      if (!response.ok) return [];
      const data = await response.json() as { jobs?: Job[] };
      return data.jobs ?? [];
    },

    async listMyJobs(limit = 50) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/jobs?limit=${limit}`, { headers });
      if (!response.ok) return [];
      const data = await response.json() as { jobs?: Job[] };
      return data.jobs ?? [];
    },

    async cancelJob(jobId) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/jobs/${jobId}/cancel`, {
        method: "POST",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to cancel job");
      }
    },

    async retryJob(jobId) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/jobs/${jobId}/retry`, {
        method: "POST",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to retry job");
      }

      return response.json() as Promise<{ jobId: string }>;
    },

    async getJobLogs(jobId) {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/jobs/${jobId}/logs`, { headers });
      if (!response.ok) return [];
      const data = await response.json() as { logs?: string[] };
      return data.logs ?? [];
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                         STATS & MONITORING
    // ═══════════════════════════════════════════════════════════════════════

    async getStats() {
      const headers = await authHeaders();
      const response = await fetch(`${dwsApiUrl}/stats`, { headers });
      if (!response.ok) {
        return {
          totalWorkflows: 0,
          totalTriggers: 0,
          totalJobs: 0,
          successRate: 0,
          avgExecutionTime: 0,
        };
      }
      return response.json() as Promise<{
        totalWorkflows: number;
        totalTriggers: number;
        totalJobs: number;
        successRate: number;
        avgExecutionTime: number;
      }>;
    },

    async getWorkflowMetrics(workflowId) {
      const headers = await authHeaders();
      const response = await fetch(
        `${dwsApiUrl}/workflows/${workflowId}/metrics`,
        { headers }
      );
      if (!response.ok) {
        return {
          executions: 0,
          successRate: 0,
          avgDuration: 0,
          lastExecuted: 0,
        };
      }
      return response.json() as Promise<{
        executions: number;
        successRate: number;
        avgDuration: number;
        lastExecuted: number;
      }>;
    },
  };
}


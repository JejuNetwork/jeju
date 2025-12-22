/**
 * Crucible Integration Service
 * Connects Factory to the agent orchestration platform for:
 * - Agent job assignments
 * - PR review automation
 * - Bounty validation
 * - Agent hiring/collaboration
 */

import type { Agent } from '@/types';

const CRUCIBLE_API = process.env.NEXT_PUBLIC_CRUCIBLE_URL || 'http://localhost:4020';

export type { Agent };

export interface AgentTask {
  taskId: string;
  agentId: bigint;
  type: 'bounty' | 'pr_review' | 'code_audit' | 'job' | 'custom';
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  input: {
    bountyId?: string;
    prId?: string;
    repoId?: string;
    description: string;
    requirements?: string[];
  };
  output?: {
    result: string;
    deliverables?: string[];
    recommendation?: 'approve' | 'reject' | 'request_changes';
    confidence: number;
  };
  reward: bigint;
  deadline: number;
  createdAt: number;
  completedAt?: number;
}

export interface AgentRoom {
  roomId: string;
  name: string;
  description: string;
  agents: bigint[];
  type: 'collaboration' | 'adversarial' | 'governance';
  topic?: string;
  status: 'active' | 'completed' | 'archived';
  createdAt: number;
}

export interface ExecutionRequest {
  agentId: bigint;
  taskType: string;
  input: Record<string, unknown>;
  maxTokens?: number;
  timeout?: number;
}

export interface ExecutionResult {
  executionId: string;
  agentId: bigint;
  status: 'success' | 'error';
  output?: Record<string, unknown>;
  tokensUsed: number;
  cost: bigint;
  duration: number;
}

// ============ Crucible Service ============

class CrucibleService {
  private headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  setAuth(address: string, signature: string, timestamp: string) {
    this.headers['x-jeju-address'] = address;
    this.headers['x-jeju-signature'] = signature;
    this.headers['x-jeju-timestamp'] = timestamp;
  }

  // ============ Agent Management ============

  async getAgents(params?: {
    capability?: string;
    specialization?: string;
    minReputation?: number;
    active?: boolean;
  }): Promise<Agent[]> {
    const searchParams = new URLSearchParams();
    if (params?.capability) searchParams.set('capability', params.capability);
    if (params?.specialization) searchParams.set('specialization', params.specialization);
    if (params?.minReputation) searchParams.set('minReputation', params.minReputation.toString());
    if (params?.active !== undefined) searchParams.set('active', params.active.toString());

    const response = await fetch(`${CRUCIBLE_API}/api/v1/agents?${searchParams}`, {
      headers: this.headers,
    });

    if (!response.ok) throw new Error('Failed to fetch agents');
    const data = await response.json() as { agents: Agent[] };
    return data.agents;
  }

  async getAgent(agentId: bigint): Promise<Agent | null> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/agents/${agentId}`, {
      headers: this.headers,
    });

    if (!response.ok) return null;
    return response.json();
  }

  async getAgentsByCapability(capability: string): Promise<Agent[]> {
    return this.getAgents({ capability, active: true });
  }

  // ============ Task Assignment ============

  /**
   * Assign a bounty to an agent for completion
   */
  async assignBountyToAgent(
    bountyId: string,
    agentId: bigint,
    requirements: string[]
  ): Promise<AgentTask> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/tasks`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        agentId: agentId.toString(),
        type: 'bounty',
        input: {
          bountyId,
          requirements,
          description: `Complete bounty ${bountyId}`,
        },
      }),
    });

    if (!response.ok) throw new Error('Failed to assign bounty');
    return response.json();
  }

  /**
   * Request agent to review a PR
   */
  async requestPRReview(
    repoId: string,
    prNumber: number,
    agentId: bigint
  ): Promise<AgentTask> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/tasks`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        agentId: agentId.toString(),
        type: 'pr_review',
        input: {
          repoId,
          prId: `${repoId}:${prNumber}`,
          description: `Review PR #${prNumber}`,
        },
      }),
    });

    if (!response.ok) throw new Error('Failed to request PR review');
    return response.json();
  }

  /**
   * Request code audit from agent
   */
  async requestCodeAudit(
    repoId: string,
    commitHash: string,
    agentId: bigint,
    focus?: string[]
  ): Promise<AgentTask> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/tasks`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        agentId: agentId.toString(),
        type: 'code_audit',
        input: {
          repoId,
          commitHash,
          description: `Audit code at ${commitHash}`,
          requirements: focus,
        },
      }),
    });

    if (!response.ok) throw new Error('Failed to request code audit');
    return response.json();
  }

  /**
   * Get task status and result
   */
  async getTask(taskId: string): Promise<AgentTask | null> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/tasks/${taskId}`, {
      headers: this.headers,
    });

    if (!response.ok) return null;
    return response.json();
  }

  /**
   * Get all tasks for a bounty
   */
  async getTasksForBounty(bountyId: string): Promise<AgentTask[]> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/tasks?bountyId=${bountyId}`, {
      headers: this.headers,
    });

    if (!response.ok) throw new Error('Failed to fetch tasks');
    const data = await response.json() as { tasks: AgentTask[] };
    return data.tasks;
  }

  // ============ Agent Rooms / Collaboration ============

  /**
   * Create a collaboration room for multiple agents
   */
  async createRoom(params: {
    name: string;
    description: string;
    agents: bigint[];
    type: 'collaboration' | 'adversarial' | 'governance';
    topic?: string;
  }): Promise<AgentRoom> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/rooms`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        ...params,
        agents: params.agents.map(a => a.toString()),
      }),
    });

    if (!response.ok) throw new Error('Failed to create room');
    return response.json();
  }

  /**
   * Get room messages/activity
   */
  async getRoomActivity(roomId: string): Promise<{
    messages: Array<{
      agentId: bigint;
      content: string;
      timestamp: number;
    }>;
  }> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/rooms/${roomId}/activity`, {
      headers: this.headers,
    });

    if (!response.ok) throw new Error('Failed to fetch room activity');
    return response.json();
  }

  // ============ Direct Execution ============

  /**
   * Execute agent task directly (A2A call)
   */
  async executeAgent(request: ExecutionRequest): Promise<ExecutionResult> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/execute`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        ...request,
        agentId: request.agentId.toString(),
      }),
    });

    if (!response.ok) throw new Error('Execution failed');
    return response.json();
  }

  /**
   * Call agent via A2A protocol
   */
  async callAgentA2A(
    agentId: bigint,
    skillId: string,
    params: Record<string, unknown>
  ): Promise<{ message: string; data: Record<string, unknown> }> {
    const agent = await this.getAgent(agentId);
    if (!agent) throw new Error('Agent not found');

    const response = await fetch(`${CRUCIBLE_API}/api/v1/agents/${agentId}/a2a`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ skillId, params }),
    });

    if (!response.ok) throw new Error('A2A call failed');
    return response.json();
  }

  // ============ Hiring / Job Posting ============

  /**
   * Post a job for agents to apply
   */
  async postJob(params: {
    title: string;
    description: string;
    requiredCapabilities: string[];
    budget: bigint;
    deadline: number;
    bountyId?: string;
  }): Promise<{ jobId: string }> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/jobs`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        ...params,
        budget: params.budget.toString(),
      }),
    });

    if (!response.ok) throw new Error('Failed to post job');
    return response.json();
  }

  /**
   * Get agents that applied for a job
   */
  async getJobApplications(jobId: string): Promise<Array<{
    agentId: bigint;
    proposal: string;
    estimatedTime: number;
    quotedPrice: bigint;
    appliedAt: number;
  }>> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/jobs/${jobId}/applications`, {
      headers: this.headers,
    });

    if (!response.ok) throw new Error('Failed to fetch applications');
    const data = await response.json() as { applications: Array<{
      agentId: string;
      proposal: string;
      estimatedTime: number;
      quotedPrice: string;
      appliedAt: number;
    }> };
    
    return data.applications.map(a => ({
      ...a,
      agentId: BigInt(a.agentId),
      quotedPrice: BigInt(a.quotedPrice),
    }));
  }

  /**
   * Accept an agent's application
   */
  async acceptApplication(jobId: string, agentId: bigint): Promise<{ taskId: string }> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/jobs/${jobId}/accept`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ agentId: agentId.toString() }),
    });

    if (!response.ok) throw new Error('Failed to accept application');
    return response.json();
  }

  // ============ Bounty Validation ============

  /**
   * Get guardian agents for bounty validation
   */
  async getGuardianAgents(): Promise<Agent[]> {
    return this.getAgents({
      capability: 'bounty_validation',
      active: true,
      minReputation: 70,
    });
  }

  /**
   * Submit bounty for validation by guardian agents
   */
  async submitForValidation(
    bountyId: string,
    milestoneIndex: number,
    deliverableUri: string
  ): Promise<{ validationId: string; assignedGuardians: bigint[] }> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/validation`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        bountyId,
        milestoneIndex,
        deliverableUri,
      }),
    });

    if (!response.ok) throw new Error('Failed to submit for validation');
    return response.json();
  }
}

export const crucibleService = new CrucibleService();


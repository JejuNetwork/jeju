/**
 * Council Compute Trigger Integration
 * 
 * Registers council orchestrator with compute service for autonomous operation.
 * Supports cron, webhook, and event-based triggers with local fallback.
 */

// Types
export type TriggerSource = 'cloud' | 'compute' | 'onchain';

export interface UnifiedTrigger {
  id: string;
  source: TriggerSource;
  type: 'cron' | 'webhook' | 'event';
  name: string;
  description?: string;
  cronExpression?: string;
  webhookPath?: string;
  eventTypes?: string[];
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  payload?: Record<string, unknown>;
  timeout: number;
  resources?: { cpuCores?: number; memoryMb?: number; maxExecutionTime?: number };
  payment?: { mode: 'x402' | 'prepaid' | 'postpaid' | 'free' };
  active: boolean;
  createdAt?: Date;
}

export interface TriggerExecutionResult {
  executionId: string;
  triggerId: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  startedAt: Date;
  finishedAt?: Date;
  output?: Record<string, unknown>;
  error?: string;
}

export interface OrchestratorTriggerResult {
  cycleCount: number;
  processedProposals: number;
  duration: number;
  error?: string;
}

// Config
const COUNCIL_URL = process.env.COUNCIL_URL ?? 'http://localhost:8010';
const COMPUTE_URL = process.env.COMPUTE_URL ?? 'http://localhost:8020';
const ORCHESTRATOR_CRON = process.env.ORCHESTRATOR_CRON ?? '*/30 * * * * *';

// Trigger definitions
export const councilTriggers: Array<Omit<UnifiedTrigger, 'id' | 'createdAt'>> = [
  {
    source: 'compute',
    type: 'cron',
    name: 'council-orchestrator-cycle',
    description: 'Run council orchestrator to process proposals',
    cronExpression: ORCHESTRATOR_CRON,
    endpoint: `${COUNCIL_URL}/trigger/orchestrator`,
    method: 'POST',
    timeout: 60,
    payload: { action: 'run-cycle' },
    resources: { cpuCores: 1, memoryMb: 512, maxExecutionTime: 60 },
    payment: { mode: 'free' },
    active: true,
  },
  {
    source: 'compute',
    type: 'webhook',
    name: 'council-manual-trigger',
    webhookPath: '/council/trigger',
    endpoint: `${COUNCIL_URL}/trigger/orchestrator`,
    method: 'POST',
    timeout: 60,
    payload: { action: 'run-cycle' },
    payment: { mode: 'free' },
    active: true,
  },
  {
    source: 'compute',
    type: 'event',
    name: 'council-proposal-submitted',
    eventTypes: ['ProposalSubmitted', 'CouncilVoteCast', 'CEODecisionNeeded'],
    endpoint: `${COUNCIL_URL}/trigger/orchestrator`,
    method: 'POST',
    timeout: 30,
    payload: { action: 'process-event' },
    payment: { mode: 'free' },
    active: true,
  },
];

/** Register council triggers with compute service */
export async function registerCouncilTriggers(): Promise<void> {
  console.log('[CouncilTrigger] Registering triggers...');

  for (const trigger of councilTriggers) {
    try {
      const response = await fetch(`${COMPUTE_URL}/api/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trigger),
      });

      if (response.ok) {
        const { id } = await response.json() as { id: string };
        console.log(`[CouncilTrigger] Registered: ${trigger.name} (${id})`);
      } else {
        console.warn(`[CouncilTrigger] Failed: ${trigger.name} (${response.status})`);
      }
    } catch {
      console.warn(`[CouncilTrigger] Unreachable: ${trigger.name}`);
    }
  }
}

/** Start local cron (fallback when compute unavailable) */
export function startLocalCron(callback: () => Promise<OrchestratorTriggerResult>): NodeJS.Timer {
  const intervalMs = parseCronInterval(ORCHESTRATOR_CRON);
  console.log(`[CouncilTrigger] Starting local cron (${intervalMs}ms interval)`);
  
  return setInterval(async () => {
    try {
      const result = await callback();
      console.log(`[CouncilTrigger] Cycle: ${result.processedProposals} proposals, ${result.duration}ms`);
    } catch (error) {
      console.error('[CouncilTrigger] Cycle error:', error);
    }
  }, intervalMs);
}

function parseCronInterval(cron: string): number {
  const match = cron.match(/^\*\/(\d+)/);
  return match ? parseInt(match[1], 10) * 1000 : 30_000;
}

/** Compute service client */
export class ComputeTriggerClient {
  constructor(private readonly computeUrl = COMPUTE_URL) {}

  async register(trigger: Omit<UnifiedTrigger, 'id' | 'createdAt'>): Promise<string> {
    const response = await fetch(`${this.computeUrl}/api/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trigger),
    });
    if (!response.ok) throw new Error(`Register failed: ${response.status}`);
    return ((await response.json()) as { id: string }).id;
  }

  async execute(triggerId: string, input?: Record<string, unknown>): Promise<TriggerExecutionResult> {
    const response = await fetch(`${this.computeUrl}/api/triggers/${triggerId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    if (!response.ok) throw new Error(`Execute failed: ${response.status}`);
    return response.json() as Promise<TriggerExecutionResult>;
  }

  async list(filter?: { type?: string; active?: boolean }): Promise<UnifiedTrigger[]> {
    const params = new URLSearchParams();
    if (filter?.type) params.set('type', filter.type);
    if (filter?.active !== undefined) params.set('active', String(filter.active));

    const response = await fetch(`${this.computeUrl}/api/triggers?${params}`);
    if (!response.ok) throw new Error(`List failed: ${response.status}`);
    return ((await response.json()) as { triggers: UnifiedTrigger[] }).triggers;
  }

  async getHistory(triggerId?: string, limit = 50): Promise<TriggerExecutionResult[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (triggerId) params.set('triggerId', triggerId);

    const response = await fetch(`${this.computeUrl}/api/triggers/history?${params}`);
    if (!response.ok) throw new Error(`History failed: ${response.status}`);
    return ((await response.json()) as { executions: TriggerExecutionResult[] }).executions;
  }

  async isAvailable(): Promise<boolean> {
    try {
      return (await fetch(`${this.computeUrl}/health`)).ok;
    } catch {
      return false;
    }
  }
}

// Singleton
let triggerClient: ComputeTriggerClient | null = null;
export function getComputeTriggerClient(): ComputeTriggerClient {
  return triggerClient ??= new ComputeTriggerClient();
}

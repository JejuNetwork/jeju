/**
 * Autocrat Compute Trigger Integration
 * 
 * FULLY DECENTRALIZED - Triggers registered on DWS compute network
 */

import { getDWSComputeUrl, getAutocratUrl } from '@jejunetwork/config';

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

// Network-aware endpoints
function getAutocratEndpoint(): string {
  return process.env.AUTOCRAT_URL ?? getAutocratUrl();
}

function getComputeEndpoint(): string {
  return process.env.COMPUTE_URL ?? process.env.DWS_COMPUTE_URL ?? getDWSComputeUrl();
}

const ORCHESTRATOR_CRON = process.env.ORCHESTRATOR_CRON ?? '*/30 * * * * *';

export function getAutocratTriggers(): Array<Omit<UnifiedTrigger, 'id' | 'createdAt'>> {
  const autocratUrl = getAutocratEndpoint();
  return [
    { source: 'compute', type: 'cron', name: 'autocrat-orchestrator-cycle', description: 'Run orchestrator', cronExpression: ORCHESTRATOR_CRON, endpoint: `${autocratUrl}/trigger/orchestrator`, method: 'POST', timeout: 60, payload: { action: 'run-cycle' }, resources: { cpuCores: 1, memoryMb: 512 }, payment: { mode: 'free' }, active: true },
    { source: 'compute', type: 'webhook', name: 'autocrat-manual-trigger', webhookPath: '/autocrat/trigger', endpoint: `${autocratUrl}/trigger/orchestrator`, method: 'POST', timeout: 60, payment: { mode: 'free' }, active: true },
    { source: 'compute', type: 'event', name: 'autocrat-proposal-submitted', eventTypes: ['ProposalSubmitted', 'AutocratVoteCast', 'CEODecisionNeeded'], endpoint: `${autocratUrl}/trigger/orchestrator`, method: 'POST', timeout: 30, payment: { mode: 'free' }, active: true },
  ];
}

// Legacy export for backwards compatibility
export const autocratTriggers = getAutocratTriggers();

export async function registerAutocratTriggers(): Promise<void> {
  console.log('[Trigger] Registering...');
  const computeEndpoint = getComputeEndpoint();
  const triggers = getAutocratTriggers();
  for (const trigger of triggers) {
    const r = await fetch(`${computeEndpoint}/api/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trigger),
    }).catch(() => null);
    if (r?.ok) {
      const { id } = await r.json() as { id: string };
      console.log(`[Trigger] Registered: ${trigger.name} (${id})`);
    } else {
      console.warn(`[Trigger] Failed: ${trigger.name} (${r?.status ?? 'unreachable'})`);
    }
  }
}

export function startLocalCron(callback: () => Promise<OrchestratorTriggerResult>): NodeJS.Timer {
  const match = ORCHESTRATOR_CRON.match(/^\*\/(\d+)/);
  const intervalMs = match ? parseInt(match[1], 10) * 1000 : 30_000;
  console.log(`[Trigger] Local cron (${intervalMs}ms)`);
  return setInterval(async () => {
    try {
      const result = await callback();
      console.log(`[Trigger] Cycle: ${result.processedProposals} proposals, ${result.duration}ms`);
    } catch (error) {
      console.error('[Trigger] Error:', error);
    }
  }, intervalMs);
}

export class ComputeTriggerClient {
  constructor(private readonly computeUrl = process.env.COMPUTE_URL ?? process.env.DWS_URL ?? getDWSComputeUrl()) {}

  async register(trigger: Omit<UnifiedTrigger, 'id' | 'createdAt'>): Promise<string> {
    const r = await fetch(`${this.computeUrl}/api/triggers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trigger) });
    if (!r.ok) throw new Error(`Register failed: ${r.status}`);
    return ((await r.json()) as { id: string }).id;
  }

  async execute(triggerId: string, input?: Record<string, unknown>): Promise<TriggerExecutionResult> {
    const r = await fetch(`${this.computeUrl}/api/triggers/${triggerId}/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }) });
    if (!r.ok) throw new Error(`Execute failed: ${r.status}`);
    return r.json() as Promise<TriggerExecutionResult>;
  }

  async list(filter?: { type?: string; active?: boolean }): Promise<UnifiedTrigger[]> {
    const params = new URLSearchParams();
    if (filter?.type) params.set('type', filter.type);
    if (filter?.active !== undefined) params.set('active', String(filter.active));
    const r = await fetch(`${this.computeUrl}/api/triggers?${params}`);
    if (!r.ok) throw new Error(`List failed: ${r.status}`);
    return ((await r.json()) as { triggers: UnifiedTrigger[] }).triggers;
  }

  async getHistory(triggerId?: string, limit = 50): Promise<TriggerExecutionResult[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (triggerId) params.set('triggerId', triggerId);
    const r = await fetch(`${this.computeUrl}/api/triggers/history?${params}`);
    if (!r.ok) throw new Error(`History failed: ${r.status}`);
    return ((await r.json()) as { executions: TriggerExecutionResult[] }).executions;
  }

  async isAvailable(): Promise<boolean> {
    try { return (await fetch(`${this.computeUrl}/health`)).ok; } catch { return false; }
  }
}

let triggerClient: ComputeTriggerClient | null = null;
export function getComputeTriggerClient(): ComputeTriggerClient {
  return triggerClient ??= new ComputeTriggerClient();
}

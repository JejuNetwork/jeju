/**
 * Decentralized Trigger Client
 * 
 * Registers and manages cron jobs, webhooks, and event triggers
 * via the Compute Trigger Service with on-chain registration.
 */

import type { Address, Hex } from 'viem';

export interface TriggerConfig {
  computeEndpoint: string;
  rpcUrl?: string;
  registryAddress?: Address;
  privateKey?: Hex;
  timeout?: number;
}

export interface Trigger {
  id: string;
  name: string;
  description: string;
  type: 'cron' | 'webhook' | 'event';
  cronExpression?: string;
  webhookPath?: string;
  eventTypes?: string[];
  endpoint: string;
  method: string;
  timeout: number;
  active: boolean;
  owner?: Address;
  agentId?: number;
  paymentMode: 'free' | 'x402' | 'prepaid';
  pricePerExecution: string;
  createdAt: number;
  lastExecutedAt?: number;
  executionCount: number;
  onChainId?: string;
  source: 'local' | 'onchain';
}

export interface CreateTriggerRequest {
  name: string;
  description?: string;
  type: 'cron' | 'webhook' | 'event';
  cronExpression?: string;
  webhookPath?: string;
  eventTypes?: string[];
  endpoint: string;
  method?: string;
  timeout?: number;
  paymentMode?: 'free' | 'x402' | 'prepaid';
  pricePerExecution?: string;
  agentId?: number;
  registerOnChain?: boolean;
}

export interface TriggerProof {
  triggerId: string;
  executionId: string;
  timestamp: number;
  inputHash: string;
  outputHash: string;
  executorAddress: Address;
  executorSignature: string;
  chainId: number;
  txHash?: string;
}

export interface TriggerStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  lastPollAt: number;
  triggerCount: number;
  activeExecutions: number;
}

export interface TriggerClient {
  create(request: CreateTriggerRequest): Promise<Trigger>;
  get(id: string): Promise<Trigger | null>;
  list(filter?: { type?: string; active?: boolean; agentId?: number }): Promise<Trigger[]>;
  setActive(id: string, active: boolean): Promise<void>;
  delete(id: string): Promise<void>;
  executeWebhook(path: string, body: unknown): Promise<TriggerProof | null>;
  getStats(): Promise<TriggerStats>;
  depositPrepaid(amount: string): Promise<string>;
  withdrawPrepaid(amount: string): Promise<string>;
  getPrepaidBalance(address: Address): Promise<string>;
}

class DecentralizedTriggerClient implements TriggerClient {
  private config: Required<Omit<TriggerConfig, 'rpcUrl' | 'registryAddress' | 'privateKey'>> & TriggerConfig;

  constructor(config: TriggerConfig) {
    this.config = {
      timeout: 10000,
      ...config,
    };
  }

  async create(request: CreateTriggerRequest): Promise<Trigger> {
    const response = await fetch(`${this.config.computeEndpoint}/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create trigger: ${error}`);
    }

    const data = await response.json() as { trigger: Trigger };
    return data.trigger;
  }

  async get(id: string): Promise<Trigger | null> {
    const response = await fetch(`${this.config.computeEndpoint}/triggers/${id}`, {
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to get trigger: ${response.statusText}`);
    }

    const data = await response.json() as { trigger: Trigger };
    return data.trigger;
  }

  async list(filter?: { type?: string; active?: boolean; agentId?: number }): Promise<Trigger[]> {
    const url = new URL('/triggers', this.config.computeEndpoint);
    
    if (filter?.type) {
      url.searchParams.set('type', filter.type);
    }
    if (filter?.active !== undefined) {
      url.searchParams.set('active', String(filter.active));
    }
    if (filter?.agentId !== undefined) {
      url.searchParams.set('agentId', String(filter.agentId));
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to list triggers: ${response.statusText}`);
    }

    const data = await response.json() as { triggers: Trigger[] };
    return data.triggers;
  }

  async setActive(id: string, active: boolean): Promise<void> {
    const response = await fetch(`${this.config.computeEndpoint}/triggers/${id}/active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to set trigger active: ${response.statusText}`);
    }
  }

  async delete(id: string): Promise<void> {
    const response = await fetch(`${this.config.computeEndpoint}/triggers/${id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete trigger: ${response.statusText}`);
    }
  }

  async executeWebhook(path: string, body: unknown): Promise<TriggerProof | null> {
    const response = await fetch(`${this.config.computeEndpoint}/webhook${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Webhook execution failed: ${response.statusText}`);
    }

    const data = await response.json() as { proof: TriggerProof };
    return data.proof;
  }

  async getStats(): Promise<TriggerStats> {
    const response = await fetch(`${this.config.computeEndpoint}/stats`, {
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to get stats: ${response.statusText}`);
    }

    return response.json() as Promise<TriggerStats>;
  }

  async depositPrepaid(amount: string): Promise<string> {
    const response = await fetch(`${this.config.computeEndpoint}/prepaid/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to deposit: ${response.statusText}`);
    }

    const data = await response.json() as { txHash: string };
    return data.txHash;
  }

  async withdrawPrepaid(amount: string): Promise<string> {
    const response = await fetch(`${this.config.computeEndpoint}/prepaid/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to withdraw: ${response.statusText}`);
    }

    const data = await response.json() as { txHash: string };
    return data.txHash;
  }

  async getPrepaidBalance(address: Address): Promise<string> {
    const response = await fetch(`${this.config.computeEndpoint}/prepaid/${address}`, {
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to get balance: ${response.statusText}`);
    }

    const data = await response.json() as { balance: string };
    return data.balance;
  }
}

// App trigger registration helper
export interface AppTriggerConfig {
  name: string;
  description?: string;
  type: 'cron' | 'webhook' | 'event';
  cronExpression?: string;
  webhookPath?: string;
  eventTypes?: string[];
  endpointPath: string;
  method?: string;
  timeout?: number;
  registerOnChain?: boolean;
}

export interface AppTriggersConfig {
  appName: string;
  appPort: number;
  appHost?: string;
  agentId?: number;
  triggers: AppTriggerConfig[];
}

/**
 * Register all triggers for an app
 */
export async function registerAppTriggers(config: AppTriggersConfig): Promise<Trigger[]> {
  if (!config.appHost && !config.appPort) {
    throw new Error('Either appHost or appPort must be provided');
  }
  
  const client = getTriggerClient();
  const registeredTriggers: Trigger[] = [];
  
  const baseUrl = config.appHost ? config.appHost : `http://localhost:${config.appPort}`;

  for (const triggerConfig of config.triggers) {
    // Check if trigger already exists
    const existingTriggers = await client.list({ type: triggerConfig.type });
    const existing = existingTriggers.find(
      (t) => t.name === `${config.appName}-${triggerConfig.name}`
    );

    if (existing) {
      console.log(`[Triggers] Trigger ${triggerConfig.name} already exists: ${existing.id}`);
      registeredTriggers.push(existing);
      continue;
    }

    const trigger = await client.create({
      name: `${config.appName}-${triggerConfig.name}`,
      description: triggerConfig.description ? triggerConfig.description : `${config.appName} ${triggerConfig.name} trigger`,
      type: triggerConfig.type,
      cronExpression: triggerConfig.cronExpression,
      webhookPath: triggerConfig.webhookPath,
      eventTypes: triggerConfig.eventTypes,
      endpoint: `${baseUrl}${triggerConfig.endpointPath}`,
      method: triggerConfig.method ? triggerConfig.method : 'POST',
      timeout: triggerConfig.timeout ? triggerConfig.timeout : 60,
      agentId: config.agentId,
      registerOnChain: triggerConfig.registerOnChain !== undefined ? triggerConfig.registerOnChain : true,
    });

    console.log(`[Triggers] Registered ${triggerConfig.name}: ${trigger.id}`);
    registeredTriggers.push(trigger);
  }

  return registeredTriggers;
}

/**
 * Unregister all triggers for an app
 */
export async function unregisterAppTriggers(appName: string): Promise<void> {
  const client = getTriggerClient();
  const triggers = await client.list();
  
  for (const trigger of triggers) {
    if (trigger.name.startsWith(`${appName}-`)) {
      await client.delete(trigger.id);
      console.log(`[Triggers] Unregistered ${trigger.name}`);
    }
  }
}

// Singleton client
let triggerClient: TriggerClient | null = null;

export function createTriggerClient(config: TriggerConfig): TriggerClient {
  return new DecentralizedTriggerClient(config);
}

export function getTriggerClient(): TriggerClient {
  if (triggerClient) return triggerClient;

  const computeEndpoint = process.env.COMPUTE_ENDPOINT ?? process.env.TRIGGER_SERVICE_URL;
  if (!computeEndpoint) {
    throw new Error('COMPUTE_ENDPOINT or TRIGGER_SERVICE_URL environment variable is required');
  }

  const rpcUrl = process.env.COMPUTE_RPC_URL ?? process.env.RPC_URL;
  const registryAddress = process.env.TRIGGER_REGISTRY_ADDRESS as Address | undefined;
  const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
  const timeoutStr = process.env.TRIGGER_TIMEOUT;

  triggerClient = new DecentralizedTriggerClient({
    computeEndpoint,
    rpcUrl,
    registryAddress,
    privateKey,
    timeout: timeoutStr ? parseInt(timeoutStr, 10) : undefined,
  });

  return triggerClient;
}

export function resetTriggerClient(): void {
  triggerClient = null;
}

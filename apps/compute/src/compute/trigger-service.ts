/**
 * Trigger Service - Cron, webhook, event triggers with on-chain integration
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes, solidityPackedKeccak256 } from 'ethers';
import type { Address } from 'viem';
import { createX402Middleware, type X402Config } from './sdk/x402';

const TRIGGER_REGISTRY_ABI = [
  // Registration
  'function registerTrigger(string name, string description, uint8 triggerType, string cronExpression, string webhookPath, string[] eventTypes, string endpoint, string method, uint256 timeout, uint8 paymentMode, uint256 pricePerExecution) returns (bytes32)',
  'function registerTriggerWithAgent(string name, string description, uint8 triggerType, string cronExpression, string endpoint, uint256 timeout, uint8 paymentMode, uint256 pricePerExecution, uint256 agentId) returns (bytes32)',
  'function setTriggerActive(bytes32 triggerId, bool active)',
  'function updateTriggerEndpoint(bytes32 triggerId, string endpoint)',
  'function updateTriggerPricing(bytes32 triggerId, uint8 paymentMode, uint256 pricePerExecution)',
  // Execution
  'function recordExecution(bytes32 triggerId, bool success, bytes32 outputHash) returns (bytes32)',
  // Prepaid
  'function depositPrepaid() payable',
  'function withdrawPrepaid(uint256 amount)',
  'function prepaidBalances(address) view returns (uint256)',
  // Views
  'function getTrigger(bytes32 triggerId) view returns (address owner, uint8 triggerType, string name, string endpoint, bool active, uint256 executionCount, uint256 lastExecutedAt, uint256 agentId)',
  'function getCronTriggers() view returns (bytes32[] triggerIds, string[] cronExpressions, string[] endpoints)',
  'function getActiveTriggers(uint8 triggerType) view returns (bytes32[])',
  'function getOwnerTriggers(address owner) view returns (bytes32[])',
  'function getAgentTriggers(uint256 agentId) view returns (bytes32[])',
  'function getTriggerCount() view returns (uint256)',
];

export interface TriggerServiceConfig {
  rpcUrl?: string;
  registryAddress?: Address;
  privateKey?: string;
  pollIntervalMs?: number;
  maxConcurrentExecutions?: number;
  x402Config?: X402Config;
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
  pricePerExecution: bigint;
  createdAt: number;
  lastExecutedAt?: number;
  executionCount: number;
  onChainId?: string;
  source: 'local' | 'onchain';
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

export interface ExecutionResult {
  triggerId: string;
  executionId: string;
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  timestamp: number;
  proof?: TriggerProof;
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
  pricePerExecution?: bigint;
  agentId?: number;
  registerOnChain?: boolean;
}

interface ParsedCron {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

function parseCronField(field: string, min: number, max: number): number[] {
  if (field === '*') return Array.from({ length: max - min + 1 }, (_, i) => min + i);

  const values: number[] = [];
  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [range, step] = part.split('/');
      const stepNum = parseInt(step, 10);
      const rangeValues = range === '*'
        ? Array.from({ length: max - min + 1 }, (_, i) => min + i)
        : parseCronField(range, min, max);
      values.push(...rangeValues.filter((_, i) => i % stepNum === 0));
    } else if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      for (let i = start; i <= end; i++) values.push(i);
    } else {
      values.push(parseInt(part, 10));
    }
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: ${expr}`);
  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    dayOfMonth: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    dayOfWeek: parseCronField(parts[4], 0, 6),
  };
}

function shouldRunNow(cron: ParsedCron, now: Date): boolean {
  return (
    cron.minute.includes(now.getMinutes()) &&
    cron.hour.includes(now.getHours()) &&
    cron.dayOfMonth.includes(now.getDate()) &&
    cron.month.includes(now.getMonth() + 1) &&
    cron.dayOfWeek.includes(now.getDay())
  );
}

export class TriggerService {
  private config: Required<Pick<TriggerServiceConfig, 'pollIntervalMs' | 'maxConcurrentExecutions'>> & TriggerServiceConfig;
  private provider: JsonRpcProvider | null = null;
  private signer: Wallet | null = null;
  private registry: Contract | null = null;

  // State
  private triggers: Map<string, Trigger> = new Map();
  private webhookPaths: Map<string, string> = new Map();
  private lastRunMinute: Map<string, number> = new Map();
  private executionQueue: Trigger[] = [];
  private activeExecutions = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // Stats
  private stats = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    lastPollAt: 0,
  };

  constructor(config: TriggerServiceConfig = {}) {
    this.config = {
      pollIntervalMs: 60000,
      maxConcurrentExecutions: 5,
      ...config,
    };

    if (config.rpcUrl) {
      this.provider = new JsonRpcProvider(config.rpcUrl);
      if (config.privateKey) {
        this.signer = new Wallet(config.privateKey, this.provider);
      }
      if (config.registryAddress) {
        this.registry = new Contract(
          config.registryAddress,
          TRIGGER_REGISTRY_ABI,
          this.signer ?? this.provider
        );
      }
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('[TriggerService] Starting...');

    // Initial poll
    await this.poll();

    // Start polling
    this.pollTimer = setInterval(() => this.poll(), this.config.pollIntervalMs);
    console.log('[TriggerService] Started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    while (this.activeExecutions > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log('[TriggerService] Stopped');
  }

  async createTrigger(request: CreateTriggerRequest): Promise<Trigger> {
    const id = `trigger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const trigger: Trigger = {
      id,
      name: request.name,
      description: request.description ?? '',
      type: request.type,
      cronExpression: request.cronExpression,
      webhookPath: request.webhookPath,
      eventTypes: request.eventTypes,
      endpoint: request.endpoint,
      method: request.method ?? 'POST',
      timeout: request.timeout ?? 60,
      active: true,
      agentId: request.agentId,
      paymentMode: request.paymentMode ?? 'free',
      pricePerExecution: request.pricePerExecution ?? 0n,
      createdAt: Date.now(),
      executionCount: 0,
      source: 'local',
    };

    // Register on-chain if requested
    if (request.registerOnChain && this.registry && this.signer) {
      trigger.onChainId = await this.registerOnChain(trigger);
      trigger.source = 'onchain';
    }

    this.triggers.set(id, trigger);

    if (trigger.webhookPath) {
      this.webhookPaths.set(trigger.webhookPath, id);
    }

    console.log('[TriggerService] Created trigger:', id);
    return trigger;
  }

  getTrigger(id: string): Trigger | undefined {
    return this.triggers.get(id);
  }

  listTriggers(filter?: { type?: string; active?: boolean; agentId?: number }): Trigger[] {
    let triggers = [...this.triggers.values()];
    if (filter?.type) triggers = triggers.filter((t) => t.type === filter.type);
    if (filter?.active !== undefined) triggers = triggers.filter((t) => t.active === filter.active);
    if (filter?.agentId !== undefined) triggers = triggers.filter((t) => t.agentId === filter.agentId);
    return triggers;
  }

  async setTriggerActive(id: string, active: boolean): Promise<void> {
    const trigger = this.triggers.get(id);
    if (!trigger) throw new Error('Trigger not found');

    trigger.active = active;

    if (trigger.onChainId && this.registry && this.signer) {
      const tx = await this.registry.setTriggerActive(trigger.onChainId, active);
      await tx.wait();
    }
  }

  async deleteTrigger(id: string): Promise<void> {
    const trigger = this.triggers.get(id);
    if (!trigger) return;

    if (trigger.onChainId && this.registry && this.signer) {
      const tx = await this.registry.setTriggerActive(trigger.onChainId, false);
      await tx.wait();
    }

    if (trigger.webhookPath) {
      this.webhookPaths.delete(trigger.webhookPath);
    }

    this.triggers.delete(id);
  }

  private async registerOnChain(trigger: Trigger): Promise<string> {
    if (!this.registry || !this.signer) throw new Error('No registry configured');

    const triggerTypeMap = { cron: 0, webhook: 1, event: 2 };
    const paymentModeMap: Record<string, number> = { free: 0, x402: 1, prepaid: 2 };

    let tx;
    if (trigger.agentId) {
      tx = await this.registry.registerTriggerWithAgent(
        trigger.name,
        trigger.description,
        triggerTypeMap[trigger.type],
        trigger.cronExpression ?? '',
        trigger.endpoint,
        trigger.timeout,
        paymentModeMap[trigger.paymentMode],
        trigger.pricePerExecution,
        trigger.agentId
      );
    } else {
      tx = await this.registry.registerTrigger(
        trigger.name,
        trigger.description,
        triggerTypeMap[trigger.type],
        trigger.cronExpression ?? '',
        trigger.webhookPath ?? '',
        trigger.eventTypes ?? [],
        trigger.endpoint,
        trigger.method,
        trigger.timeout,
        paymentModeMap[trigger.paymentMode],
        trigger.pricePerExecution
      );
    }

    const receipt = await tx.wait();
    const event = receipt.logs.find(
      (log: { topics: string[] }) => log.topics[0] === keccak256(toUtf8Bytes('TriggerRegistered(bytes32,address,string,uint8)'))
    );

    return event?.topics[1] ?? tx.hash;
  }

  private async syncFromChain(): Promise<void> {
    if (!this.registry) return;

    const [triggerIds, cronExpressions, endpoints] = await this.registry.getCronTriggers();

    for (let i = 0; i < triggerIds.length; i++) {
      const triggerId = triggerIds[i] as string;
      const [owner, , name, endpoint, active, executionCount, lastExecutedAt, agentId] =
        await this.registry.getTrigger(triggerId);

      if (!active) continue;

      const existing = [...this.triggers.values()].find((t) => t.onChainId === triggerId);
      if (existing) {
        existing.executionCount = Number(executionCount);
        existing.lastExecutedAt = Number(lastExecutedAt) * 1000;
        continue;
      }

      this.triggers.set(triggerId, {
        id: triggerId,
        name: name as string,
        description: '',
        type: 'cron',
        cronExpression: cronExpressions[i] as string,
        endpoint: (endpoint || endpoints[i]) as string,
        method: 'POST',
        timeout: 60,
        active: true,
        owner: owner as Address,
        agentId: Number(agentId),
        paymentMode: 'free',
        pricePerExecution: 0n,
        createdAt: Date.now(),
        executionCount: Number(executionCount),
        lastExecutedAt: Number(lastExecutedAt) * 1000,
        onChainId: triggerId,
        source: 'onchain',
      });
    }
  }

  async depositPrepaid(amount: bigint): Promise<string> {
    if (!this.registry || !this.signer) throw new Error('No registry configured');
    const tx = await this.registry.depositPrepaid({ value: amount });
    await tx.wait();
    return tx.hash as string;
  }

  async withdrawPrepaid(amount: bigint): Promise<string> {
    if (!this.registry || !this.signer) throw new Error('No registry configured');
    const tx = await this.registry.withdrawPrepaid(amount);
    await tx.wait();
    return tx.hash as string;
  }

  async getPrepaidBalance(address: Address): Promise<bigint> {
    if (!this.registry) return 0n;
    return (await this.registry.prepaidBalances(address)) as bigint;
  }

  private async poll(): Promise<void> {
    this.stats.lastPollAt = Date.now();
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();

    // Sync from chain
    await this.syncFromChain();

    // Check cron triggers
    for (const trigger of this.triggers.values()) {
      if (trigger.type !== 'cron' || !trigger.cronExpression || !trigger.active) continue;

      const lastRun = this.lastRunMinute.get(trigger.id);
      if (lastRun === currentMinute) continue;

      try {
        const cron = parseCron(trigger.cronExpression);
        if (shouldRunNow(cron, now)) {
          this.lastRunMinute.set(trigger.id, currentMinute);
          this.executionQueue.push(trigger);
        }
      } catch {
        // Invalid cron expression
      }
    }

    this.processQueue();
  }

  private processQueue(): void {
    while (
      this.executionQueue.length > 0 &&
      this.activeExecutions < this.config.maxConcurrentExecutions
    ) {
      const trigger = this.executionQueue.shift();
      if (trigger) this.execute(trigger);
    }
  }

  private async execute(trigger: Trigger): Promise<void> {
    this.activeExecutions++;
    const startTime = Date.now();
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let success = false;
    let output = '';
    let error: string | undefined;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), trigger.timeout * 1000);

      const response = await fetch(trigger.endpoint, {
        method: trigger.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Trigger-ID': trigger.id,
          'X-Execution-ID': executionId,
          'X-Trigger-Agent-ID': trigger.agentId?.toString() ?? '',
        },
        body: JSON.stringify({ triggerId: trigger.id, executionId, timestamp: Date.now() }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      output = await response.text();
      success = response.ok;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const duration = Date.now() - startTime;

    // Update stats
    this.stats.totalExecutions++;
    if (success) this.stats.successfulExecutions++;
    else this.stats.failedExecutions++;

    // Update trigger
    trigger.lastExecutedAt = Date.now();
    trigger.executionCount++;

    // Record on-chain
    let txHash: string | undefined;
    if (trigger.onChainId && this.registry && this.signer) {
      try {
        const outputHash = keccak256(toUtf8Bytes(output));
        const tx = await this.registry.recordExecution(trigger.onChainId, success, outputHash);
        await tx.wait();
        txHash = tx.hash as string;
      } catch {
        // Non-fatal
      }
    }

    // Generate proof
    const proof = await this.generateProof(trigger.id, executionId, output);

    console.log('[TriggerService] Execution complete:', {
      triggerId: trigger.id,
      executionId,
      success,
      duration,
      txHash,
      error,
      proof: { ...proof, txHash },
    });

    this.activeExecutions--;
    this.processQueue();
  }

  async executeWebhook(path: string, body: unknown): Promise<TriggerProof | null> {
    const triggerId = this.webhookPaths.get(path);
    if (!triggerId) return null;

    const trigger = this.triggers.get(triggerId);
    if (!trigger || !trigger.active) return null;

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const response = await fetch(trigger.endpoint, {
      method: trigger.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Trigger-ID': trigger.id,
        'X-Execution-ID': executionId,
      },
      body: JSON.stringify(body),
    });

    const output = await response.text();
    trigger.lastExecutedAt = Date.now();
    trigger.executionCount++;

    return this.generateProof(trigger.id, executionId, output);
  }

  private async generateProof(triggerId: string, executionId: string, output: string): Promise<TriggerProof> {
    const timestamp = Date.now();
    const outputHash = keccak256(toUtf8Bytes(output));
    const inputHash = keccak256(toUtf8Bytes(JSON.stringify({ triggerId, executionId, timestamp })));

    const message = solidityPackedKeccak256(
      ['string', 'string', 'uint256', 'bytes32', 'bytes32'],
      [triggerId, executionId, timestamp, inputHash, outputHash]
    );

    const executorSignature = this.signer ? await this.signer.signMessage(message) : '';

    return {
      triggerId,
      executionId,
      timestamp,
      inputHash,
      outputHash,
      executorAddress: (this.signer?.address ?? '0x0') as Address,
      executorSignature,
      chainId: 9545,
    };
  }

  getStats(): typeof this.stats & { triggerCount: number; activeExecutions: number } {
    return {
      ...this.stats,
      triggerCount: this.triggers.size,
      activeExecutions: this.activeExecutions,
    };
  }
}

export function createTriggerApi(service: TriggerService, x402Config?: X402Config): Hono {
  const app = new Hono();
  app.use('*', cors());

  // Optional x402 middleware for paid endpoints
  if (x402Config?.enabled) {
    app.use('/triggers/*', createX402Middleware(x402Config));
  }

  // List triggers
  app.get('/triggers', async (c) => {
    const type = c.req.query('type');
    const active = c.req.query('active');
    const agentId = c.req.query('agentId');
    const triggers = service.listTriggers({
      type: type as 'cron' | 'webhook' | 'event' | undefined,
      active: active !== undefined ? active === 'true' : undefined,
      agentId: agentId ? parseInt(agentId, 10) : undefined,
    });
    return c.json({ triggers });
  });

  // Get trigger
  app.get('/triggers/:id', async (c) => {
    const trigger = service.getTrigger(c.req.param('id'));
    if (!trigger) return c.json({ error: 'Trigger not found' }, 404);
    return c.json({ trigger });
  });

  // Create trigger
  app.post('/triggers', async (c) => {
    const body = await c.req.json<CreateTriggerRequest>();
    const trigger = await service.createTrigger(body);
    return c.json({ trigger }, 201);
  });

  // Update trigger status
  app.patch('/triggers/:id/active', async (c) => {
    const { active } = await c.req.json<{ active: boolean }>();
    await service.setTriggerActive(c.req.param('id'), active);
    return c.json({ success: true });
  });

  // Delete trigger
  app.delete('/triggers/:id', async (c) => {
    await service.deleteTrigger(c.req.param('id'));
    return c.json({ success: true });
  });

  // Webhook endpoint
  app.post('/webhook/*', async (c) => {
    const path = c.req.path.replace('/webhook', '');
    const body = await c.req.json();
    const proof = await service.executeWebhook(path, body);
    if (!proof) return c.json({ error: 'Webhook not found' }, 404);
    return c.json({ success: true, proof });
  });

  // Prepaid balance
  app.get('/prepaid/:address', async (c) => {
    const balance = await service.getPrepaidBalance(c.req.param('address') as Address);
    return c.json({ balance: balance.toString() });
  });

  app.post('/prepaid/deposit', async (c) => {
    const { amount } = await c.req.json<{ amount: string }>();
    const txHash = await service.depositPrepaid(BigInt(amount));
    return c.json({ txHash });
  });

  app.post('/prepaid/withdraw', async (c) => {
    const { amount } = await c.req.json<{ amount: string }>();
    const txHash = await service.withdrawPrepaid(BigInt(amount));
    return c.json({ txHash });
  });

  // Stats
  app.get('/stats', async (c) => c.json(service.getStats()));

  return app;
}

let triggerService: TriggerService | null = null;

export function getTriggerService(): TriggerService | null {
  return triggerService;
}

export async function startTriggerService(config?: TriggerServiceConfig): Promise<{ service: TriggerService; api: Hono }> {
  const fullConfig: TriggerServiceConfig = {
    rpcUrl: config?.rpcUrl ?? process.env.JEJU_RPC_URL ?? process.env.RPC_URL,
    registryAddress: (config?.registryAddress ?? process.env.TRIGGER_REGISTRY_ADDRESS) as Address | undefined,
    privateKey: config?.privateKey ?? process.env.PRIVATE_KEY,
    pollIntervalMs: config?.pollIntervalMs ?? 60000,
    maxConcurrentExecutions: config?.maxConcurrentExecutions ?? 5,
    x402Config: config?.x402Config,
  };

  triggerService = new TriggerService(fullConfig);
  await triggerService.start();

  const api = createTriggerApi(triggerService, fullConfig.x402Config);

  return { service: triggerService, api };
}

/**
 * Trigger System - execute HTTP/contract targets on cron/webhook/event
 */

import type { Address } from 'viem';
import { Wallet, verifyMessage, keccak256, toUtf8Bytes, solidityPackedKeccak256 } from 'ethers';

export type TriggerSource = 'local' | 'onchain';
export type TriggerType = 'cron' | 'webhook' | 'event';

export interface HttpTarget {
  type: 'http';
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  payload?: Record<string, unknown>;
  timeout: number;
}

export interface ContractTarget {
  type: 'contract';
  address: Address;
  functionName: string;
  abi: string;
  args?: unknown[];
  value?: bigint;
  gasLimit?: bigint;
}

export type TriggerTarget = HttpTarget | ContractTarget;

export interface Trigger {
  id: string;
  source: TriggerSource;
  type: TriggerType;
  name: string;
  description?: string;
  target: TriggerTarget;
  cronExpression?: string;
  webhookPath?: string;
  eventTypes?: string[];
  payment?: { mode: 'x402' | 'prepaid' | 'free'; pricePerExecution?: bigint; payerAddress?: Address };
  active: boolean;
  createdAt: Date;
  ownerAddress?: Address;
}

export interface TriggerProof {
  triggerId: string;
  executionId: string;
  timestamp: number;
  nonce: string;
  inputHash: string;
  outputHash: string;
  executorAddress: Address;
  subscriberAddress: Address;
  executorSignature: string;
  subscriberSignature?: string;
  chainId: number;
}

export interface TriggerProofMessage {
  triggerId: string;
  executionId: string;
  timestamp: number;
  nonce: string;
  inputHash: string;
  outputHash: string;
  subscriberAddress: Address;
  chainId: number;
}

export interface TriggerSubscription {
  id: string;
  triggerId: string;
  subscriberAddress: Address;
  callbackEndpoint: string;
  callbackMethod: 'GET' | 'POST' | 'PUT';
  callbackAuth?: { type: 'bearer' | 'basic' | 'signature'; value?: string };
  payment: { mode: 'x402' | 'prepaid' | 'free'; prepaidBalance?: bigint; pricePerExecution: bigint };
  active: boolean;
  maxExecutions: number;
  executionCount: number;
  createdAt: Date;
  lastExecutedAt?: Date;
}

export interface TriggerExecutionResult {
  executionId: string;
  triggerId: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  startedAt: Date;
  finishedAt?: Date;
  output?: Record<string, unknown>;
  error?: string;
  executorAddress?: Address;
  txHash?: string;
  proof?: TriggerProof;
}

export interface TriggerConfig {
  rpcUrl: string;
  registryAddress?: Address;
  enableOnChainRegistration: boolean;
  executorWallet?: Wallet;
  chainId: number;
}

const TRIGGER_REGISTRY_ABI = [
  'function registerTrigger(string,string,uint8,string,string,string[],string,string,uint256,uint8,uint256) returns (bytes32)',
  'function setTriggerActive(bytes32,bool)',
  'function recordExecution(bytes32,bool,bytes32) returns (bytes32)',
  'function depositPrepaid() payable',
  'function withdrawPrepaid(uint256)',
  'function prepaidBalances(address) view returns (uint256)',
  'function getTrigger(bytes32) view returns (address,uint8,string,string,bool,uint256,uint256)',
  'function getCronTriggers() view returns (bytes32[],string[],string[])',
  'function getActiveTriggers(uint8) view returns (bytes32[])',
  'function getOwnerTriggers(address) view returns (bytes32[])',
];

export function generateProofMessage(p: TriggerProofMessage): string {
  return solidityPackedKeccak256(
    ['string', 'string', 'uint256', 'string', 'bytes32', 'bytes32', 'address', 'uint256'],
    [p.triggerId, p.executionId, p.timestamp, p.nonce, p.inputHash, p.outputHash, p.subscriberAddress, p.chainId]
  );
}

export async function signTriggerProof(wallet: Wallet, proof: TriggerProofMessage): Promise<string> {
  return wallet.signMessage(generateProofMessage(proof));
}

export function verifyTriggerProof(proof: TriggerProof, expectedExecutor: Address): boolean {
  const message = generateProofMessage(proof);
  const recovered = verifyMessage(message, proof.executorSignature);
  return recovered.toLowerCase() === expectedExecutor.toLowerCase();
}

export function hashTriggerData(data: Record<string, unknown>): string {
  return keccak256(toUtf8Bytes(JSON.stringify(data)));
}

export class TriggerIntegration {
  private config: TriggerConfig;
  private triggers = new Map<string, Trigger>();
  private subscriptions = new Map<string, TriggerSubscription>();
  private history: TriggerExecutionResult[] = [];
  private syncTimer?: NodeJS.Timer;

  constructor(config: TriggerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.config.enableOnChainRegistration && this.config.registryAddress) {
      await this.syncFromOnChain();
      this.syncTimer = setInterval(() => this.syncFromOnChain(), 60000);
    }
    console.log('[Trigger] Initialized', { triggers: this.triggers.size });
  }

  private async syncFromOnChain(): Promise<void> {
    if (!this.config.registryAddress) return;
    const { Contract, JsonRpcProvider } = await import('ethers');
    const provider = new JsonRpcProvider(this.config.rpcUrl);
    const registry = new Contract(this.config.registryAddress, TRIGGER_REGISTRY_ABI, provider);

    const [ids, crons, endpoints] = await registry.getCronTriggers();
    for (let i = 0; i < ids.length; i++) {
      const [owner, , name, endpoint, active] = await registry.getTrigger(ids[i]);
      if (!active) continue;

      this.triggers.set(`onchain-${ids[i]}`, {
        id: `onchain-${ids[i]}`,
        source: 'onchain',
        type: 'cron',
        name: name as string,
        cronExpression: crons[i] as string,
        target: { type: 'http', endpoint: endpoint || endpoints[i], method: 'POST', timeout: 60 },
        active: true,
        createdAt: new Date(),
        ownerAddress: owner as Address,
      });
    }
  }

  async registerTrigger(t: Omit<Trigger, 'id' | 'createdAt'>): Promise<string> {
    const id = `${t.source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const trigger: Trigger = { ...t, id, createdAt: new Date() };
    this.triggers.set(id, trigger);

    if (this.config.enableOnChainRegistration && t.target.type === 'http') {
      await this.registerOnChain(trigger);
    }

    console.log('[Trigger] Registered', { id, name: t.name, type: t.type });
    return id;
  }

  private async registerOnChain(t: Trigger): Promise<void> {
    if (!this.config.registryAddress || !this.config.executorWallet || t.target.type !== 'http') return;
    const { Contract, JsonRpcProvider } = await import('ethers');
    const provider = new JsonRpcProvider(this.config.rpcUrl);
    const signer = this.config.executorWallet.connect(provider);
    const registry = new Contract(this.config.registryAddress, TRIGGER_REGISTRY_ABI, signer);

    const typeMap = { cron: 0, webhook: 1, event: 2 };
    const paymentMap: Record<string, number> = { free: 0, x402: 1, prepaid: 2 };

    const tx = await registry.registerTrigger(
      t.name, t.description ?? '', typeMap[t.type] ?? 0, t.cronExpression ?? '',
      t.webhookPath ?? '', t.eventTypes ?? [], t.target.endpoint, t.target.method,
      t.target.timeout, paymentMap[t.payment?.mode ?? 'free'], t.payment?.pricePerExecution ?? 0n
    );
    await tx.wait();
  }

  async subscribe(p: {
    triggerId: string;
    subscriberAddress: Address;
    callbackEndpoint: string;
    callbackMethod?: 'GET' | 'POST' | 'PUT';
    callbackAuth?: TriggerSubscription['callbackAuth'];
    payment: TriggerSubscription['payment'];
    maxExecutions?: number;
  }): Promise<TriggerSubscription> {
    if (!this.triggers.has(p.triggerId)) throw new Error(`Trigger ${p.triggerId} not found`);

    const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sub: TriggerSubscription = {
      id, triggerId: p.triggerId, subscriberAddress: p.subscriberAddress,
      callbackEndpoint: p.callbackEndpoint, callbackMethod: p.callbackMethod ?? 'POST',
      callbackAuth: p.callbackAuth, payment: p.payment, active: true,
      maxExecutions: p.maxExecutions ?? 0, executionCount: 0, createdAt: new Date(),
    };
    this.subscriptions.set(id, sub);
    return sub;
  }

  async unsubscribe(id: string): Promise<void> {
    const sub = this.subscriptions.get(id);
    if (!sub) throw new Error(`Subscription ${id} not found`);
    sub.active = false;
  }

  getSubscriptions(triggerId: string): TriggerSubscription[] {
    return [...this.subscriptions.values()].filter(s => s.triggerId === triggerId && s.active);
  }

  async executeTrigger(req: { triggerId: string; input?: Record<string, unknown>; executorAddress?: Address; paymentProof?: string }): Promise<TriggerExecutionResult> {
    const trigger = this.triggers.get(req.triggerId);
    if (!trigger) throw new Error(`Trigger ${req.triggerId} not found`);
    if (!trigger.active) throw new Error(`Trigger ${req.triggerId} is not active`);

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nonce = Math.random().toString(36).slice(2, 10);
    const result: TriggerExecutionResult = {
      executionId, triggerId: req.triggerId, status: 'running', startedAt: new Date(),
      executorAddress: req.executorAddress ?? this.config.executorWallet?.address as Address,
    };
    this.history.push(result);

    if (trigger.payment?.mode === 'x402') await this.verifyPayment(trigger, req.paymentProof);
    if (trigger.payment?.mode === 'prepaid' && req.executorAddress) {
      const balance = await this.getPrepaidBalance(req.executorAddress);
      if (balance < (trigger.payment.pricePerExecution ?? 0n)) throw new Error('Insufficient prepaid balance');
    }

    const output = await this.executeTarget(trigger.target, req.input);
    const subs = this.getSubscriptions(req.triggerId);
    const inputHash = hashTriggerData(req.input ?? {});
    const outputHash = hashTriggerData(output);

    for (const sub of subs) await this.notifySubscriber(sub, trigger, executionId, nonce, inputHash, outputHash, req.input, output);

    if (this.config.executorWallet && subs.length > 0) {
      result.proof = await this.generateProof(trigger, executionId, nonce, inputHash, outputHash, subs[0]!.subscriberAddress);
    }

    result.status = 'success';
    result.finishedAt = new Date();
    result.output = output;

    if (trigger.source === 'onchain' && this.config.enableOnChainRegistration) {
      result.txHash = await this.recordOnChain(trigger.id.replace('onchain-', ''), outputHash) ?? undefined;
    }

    console.log('[Trigger] Executed', { triggerId: req.triggerId, executionId, subscribers: subs.length });
    return result;
  }

  private async executeTarget(target: TriggerTarget, input?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (target.type === 'http') {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), target.timeout * 1000);
      const res = await fetch(target.endpoint, {
        method: target.method,
        headers: { 'Content-Type': 'application/json', 'X-Trigger-Source': 'jeju', ...target.headers },
        body: target.method !== 'GET' ? JSON.stringify({ ...target.payload, ...input }) : undefined,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(data as Record<string, string>).error ?? res.statusText}`);
      return data as Record<string, unknown>;
    }

    if (!this.config.executorWallet) throw new Error('Wallet required for contract calls');
    const { Contract, JsonRpcProvider } = await import('ethers');
    const provider = new JsonRpcProvider(this.config.rpcUrl);
    const signer = this.config.executorWallet.connect(provider);
    const contract = new Contract(target.address, [target.abi], signer);

    const args = target.args?.map(a => {
      if (typeof a === 'string' && a.startsWith('{{') && a.endsWith('}}') && input) return input[a.slice(2, -2).trim()];
      return a;
    }) ?? [];

    const tx = await contract[target.functionName](...args, { value: target.value ?? 0n, gasLimit: target.gasLimit });
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() };
  }

  private async verifyPayment(trigger: Trigger, proof?: string): Promise<void> {
    if (!proof) throw new Error('x402 payment proof required');
    const { parseX402PaymentHeader, verifyX402Payment } = await import('./x402');
    const payment = parseX402PaymentHeader(proof);
    if (!payment) throw new Error('Invalid x402 payment proof');
    if (BigInt(payment.amount) < (trigger.payment?.pricePerExecution ?? 0n)) throw new Error('Payment too low');
    if (trigger.ownerAddress && !verifyX402Payment(payment, trigger.ownerAddress, payment.payload as Address)) {
      throw new Error('x402 verification failed');
    }
  }

  private async notifySubscriber(
    sub: TriggerSubscription, trigger: Trigger, execId: string, nonce: string,
    inputHash: string, outputHash: string, input?: Record<string, unknown>, output?: Record<string, unknown>
  ): Promise<void> {
    if (sub.maxExecutions > 0 && sub.executionCount >= sub.maxExecutions) return;
    if (sub.payment.mode === 'prepaid') {
      const balance = sub.payment.prepaidBalance ?? 0n;
      if (balance < sub.payment.pricePerExecution) return;
      sub.payment.prepaidBalance = balance - sub.payment.pricePerExecution;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json', 'X-Trigger-Source': 'jeju',
      'X-Trigger-Id': trigger.id, 'X-Execution-Id': execId,
    };
    if (sub.callbackAuth?.type === 'bearer') headers['Authorization'] = `Bearer ${sub.callbackAuth.value}`;
    if (sub.callbackAuth?.type === 'basic') headers['Authorization'] = `Basic ${sub.callbackAuth.value}`;
    if (sub.callbackAuth?.type === 'signature' && this.config.executorWallet) {
      headers['X-Signature'] = await this.config.executorWallet.signMessage(execId);
    }

    const timeout = trigger.target.type === 'http' ? trigger.target.timeout : 60;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout * 1000);

    await fetch(sub.callbackEndpoint, {
      method: sub.callbackMethod,
      headers,
      body: sub.callbackMethod !== 'GET' ? JSON.stringify({
        triggerId: trigger.id, triggerName: trigger.name, executionId: execId,
        timestamp: Date.now(), nonce, inputHash, outputHash, input, output,
        proofMessage: generateProofMessage({
          triggerId: trigger.id, executionId: execId, timestamp: Date.now(),
          nonce, inputHash, outputHash, subscriberAddress: sub.subscriberAddress, chainId: this.config.chainId,
        }),
      }) : undefined,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    sub.executionCount++;
    sub.lastExecutedAt = new Date();
  }

  private async generateProof(trigger: Trigger, execId: string, nonce: string, inputHash: string, outputHash: string, subscriber: Address): Promise<TriggerProof> {
    const timestamp = Date.now();
    const msg: TriggerProofMessage = { triggerId: trigger.id, executionId: execId, timestamp, nonce, inputHash, outputHash, subscriberAddress: subscriber, chainId: this.config.chainId };
    return { ...msg, executorAddress: this.config.executorWallet!.address as Address, executorSignature: await signTriggerProof(this.config.executorWallet!, msg) };
  }

  private async recordOnChain(triggerId: string, outputHash: string): Promise<string | null> {
    if (!this.config.registryAddress || !this.config.executorWallet) return null;
    const { Contract, JsonRpcProvider } = await import('ethers');
    const provider = new JsonRpcProvider(this.config.rpcUrl);
    const signer = this.config.executorWallet.connect(provider);
    const registry = new Contract(this.config.registryAddress, TRIGGER_REGISTRY_ABI, signer);
    const tx = await registry.recordExecution(triggerId, true, outputHash);
    await tx.wait();
    return tx.hash;
  }

  async handleWebhook(path: string, payload: Record<string, unknown>, headers?: Record<string, string>): Promise<TriggerExecutionResult | null> {
    for (const trigger of this.triggers.values()) {
      if (trigger.type === 'webhook' && trigger.webhookPath === path && trigger.active) {
        if (trigger.payment?.mode === 'x402') {
          const header = headers?.['x-402-payment'] || headers?.['X-402-Payment'];
          if (!header) throw new Error('x402 payment required');
          await this.verifyPayment(trigger, header);
        }
        return this.executeTrigger({ triggerId: trigger.id, input: payload });
      }
    }
    return null;
  }

  async emitEvent(eventType: string, data: Record<string, unknown>): Promise<TriggerExecutionResult[]> {
    const results: TriggerExecutionResult[] = [];
    for (const trigger of this.triggers.values()) {
      if (trigger.type === 'event' && trigger.eventTypes?.includes(eventType) && trigger.active) {
        results.push(await this.executeTrigger({ triggerId: trigger.id, input: { eventType, ...data } }));
      }
    }
    return results;
  }

  getTriggers(filter?: { source?: TriggerSource; type?: string; active?: boolean }): Trigger[] {
    return [...this.triggers.values()].filter(t =>
      (!filter?.source || t.source === filter.source) &&
      (!filter?.type || t.type === filter.type) &&
      (filter?.active === undefined || t.active === filter.active)
    );
  }

  getTrigger(id: string): Trigger | undefined { return this.triggers.get(id); }
  getExecutionHistory(triggerId?: string, limit = 50): TriggerExecutionResult[] {
    return (triggerId ? this.history.filter(e => e.triggerId === triggerId) : this.history).slice(-limit);
  }

  async getPrepaidBalance(address: Address): Promise<bigint> {
    if (!this.config.registryAddress) return 0n;
    const { Contract, JsonRpcProvider } = await import('ethers');
    const provider = new JsonRpcProvider(this.config.rpcUrl);
    const registry = new Contract(this.config.registryAddress, TRIGGER_REGISTRY_ABI, provider);
    return (await registry.prepaidBalances(address)) as bigint;
  }

  async depositPrepaid(amount: bigint): Promise<string> {
    if (!this.config.registryAddress || !this.config.executorWallet) throw new Error('Registry and wallet required');
    const { Contract, JsonRpcProvider } = await import('ethers');
    const provider = new JsonRpcProvider(this.config.rpcUrl);
    const signer = this.config.executorWallet.connect(provider);
    const registry = new Contract(this.config.registryAddress, TRIGGER_REGISTRY_ABI, signer);
    const tx = await registry.depositPrepaid({ value: amount });
    await tx.wait();
    return tx.hash;
  }

  async withdrawPrepaid(amount: bigint): Promise<string> {
    if (!this.config.registryAddress || !this.config.executorWallet) throw new Error('Registry and wallet required');
    const { Contract, JsonRpcProvider } = await import('ethers');
    const provider = new JsonRpcProvider(this.config.rpcUrl);
    const signer = this.config.executorWallet.connect(provider);
    const registry = new Contract(this.config.registryAddress, TRIGGER_REGISTRY_ABI, signer);
    const tx = await registry.withdrawPrepaid(amount);
    await tx.wait();
    return tx.hash;
  }

  async shutdown(): Promise<void> {
    if (this.syncTimer) clearInterval(this.syncTimer);
  }
}

export function createTriggerIntegration(config: Partial<TriggerConfig>): TriggerIntegration {
  return new TriggerIntegration({
    rpcUrl: config.rpcUrl ?? 'http://localhost:9545',
    registryAddress: config.registryAddress,
    enableOnChainRegistration: config.enableOnChainRegistration ?? false,
    executorWallet: config.executorWallet,
    chainId: config.chainId ?? 1,
  });
}

let instance: TriggerIntegration | null = null;

export function getTriggerIntegration(): TriggerIntegration {
  if (!instance) {
    instance = new TriggerIntegration({
      rpcUrl: process.env.JEJU_RPC_URL ?? 'http://localhost:9545',
      registryAddress: process.env.TRIGGER_REGISTRY_ADDRESS as Address | undefined,
      enableOnChainRegistration: process.env.ENABLE_ONCHAIN_REGISTRATION === 'true',
      chainId: parseInt(process.env.CHAIN_ID ?? '1'),
    });
  }
  return instance;
}

export async function initializeTriggerIntegration(): Promise<void> {
  await getTriggerIntegration().initialize();
}

export async function processCronTriggers(): Promise<{ executed: number; skipped: number; errors: number }> {
  const integration = getTriggerIntegration();
  const triggers = integration.getTriggers({ type: 'cron', active: true });
  const results = { executed: 0, skipped: 0, errors: 0 };

  for (const t of triggers) {
    if (!t.cronExpression || !shouldExecuteCron(t.cronExpression)) { results.skipped++; continue; }
    try { await integration.executeTrigger({ triggerId: t.id }); results.executed++; }
    catch { results.errors++; }
  }
  return results;
}

export function shouldExecuteCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const now = new Date();
  const vals = [now.getMinutes(), now.getHours(), now.getDate(), now.getMonth() + 1, now.getDay()];

  const match = (p: string, v: number): boolean => {
    if (p === '*') return true;
    if (p.includes('/')) {
      const [, step] = p.split('/');
      const s = parseInt(step!, 10);
      return !isNaN(s) && s > 0 && v % s === 0;
    }
    if (p.includes(',')) return p.split(',').some(x => match(x.trim(), v));
    if (p.includes('-')) {
      const [a, b] = p.split('-').map(x => parseInt(x, 10));
      return v >= a! && v <= b!;
    }
    return parseInt(p, 10) === v;
  };

  return parts.every((p, i) => match(p, vals[i]!));
}

/**
 * Crucible Executor Daemon - Watches TriggerRegistry and executes agent triggers.
 */

import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { localhost, sepolia, mainnet } from 'viem/chains';
import { createStorage } from '../sdk/storage';
import { createCompute } from '../sdk/compute';
import { createAgentSDK } from '../sdk/agent';
import { createRoomSDK } from '../sdk/room';
import { createExecutorSDK } from '../sdk/executor';
import { createLogger } from '../sdk/logger';
import type { CrucibleConfig } from '../types';

const log = createLogger('Executor');

const config: CrucibleConfig = {
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  privateKey: process.env.PRIVATE_KEY,
  contracts: {
    agentVault: (process.env.AGENT_VAULT_ADDRESS ?? '0x0') as `0x${string}`,
    roomRegistry: (process.env.ROOM_REGISTRY_ADDRESS ?? '0x0') as `0x${string}`,
    triggerRegistry: (process.env.TRIGGER_REGISTRY_ADDRESS ?? '0x0') as `0x${string}`,
    identityRegistry: (process.env.IDENTITY_REGISTRY_ADDRESS ?? '0x0') as `0x${string}`,
    serviceRegistry: (process.env.SERVICE_REGISTRY_ADDRESS ?? '0x0') as `0x${string}`,
  },
  services: {
    computeMarketplace: process.env.COMPUTE_MARKETPLACE_URL ?? 'http://127.0.0.1:4007',
    storageApi: process.env.STORAGE_API_URL ?? 'http://127.0.0.1:3100',
    ipfsGateway: process.env.IPFS_GATEWAY ?? 'http://127.0.0.1:3100',
    indexerGraphql: process.env.INDEXER_GRAPHQL_URL ?? 'http://127.0.0.1:4350/graphql',
  },
  network: (process.env.NETWORK as 'localnet' | 'testnet' | 'mainnet') ?? 'localnet',
};

const TRIGGER_REGISTRY_ABI = parseAbi([
  'function getActiveTriggers() view returns (bytes32[])',
  'function getTrigger(bytes32 triggerId) view returns (address owner, uint8 triggerType, string name, string cronExpression, string endpoint, uint256 timeout, bool active, uint256 lastExecutedAt)',
  'function recordExecution(bytes32 triggerId, bool success, bytes32 outputHash) returns (bytes32 executionId)',
]);

interface TriggerInfo {
  triggerId: string;
  triggerType: number;
  name: string;
  cronExpression: string;
  active: boolean;
  lastExecutedAt: bigint;
}

interface ScheduledTrigger {
  triggerId: string;
  nextRunAt: Date;
  cronExpression: string;
}

function parseCron(cron: string): { minute: number; hour: number; dayOfMonth: number; month: number; dayOfWeek: number } | null {
  const parts = cron.split(' ');
  if (parts.length !== 5) return null;
  const parse = (f: string) => f === '*' ? -1 : parseInt(f, 10);
  return {
    minute: parse(parts[0]!), hour: parse(parts[1]!),
    dayOfMonth: parse(parts[2]!), month: parse(parts[3]!), dayOfWeek: parse(parts[4]!),
  };
}

function getNextRun(cronExpression: string, after: Date = new Date()): Date {
  const cron = parseCron(cronExpression);
  if (!cron) return new Date(after.getTime() + 60000);

  const next = new Date(after);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  for (let i = 0; i < 1440; i++) {
    const matches =
      (cron.minute === -1 || next.getMinutes() === cron.minute) &&
      (cron.hour === -1 || next.getHours() === cron.hour) &&
      (cron.dayOfMonth === -1 || next.getDate() === cron.dayOfMonth) &&
      (cron.month === -1 || next.getMonth() + 1 === cron.month) &&
      (cron.dayOfWeek === -1 || next.getDay() === cron.dayOfWeek);
    if (matches) return next;
    next.setMinutes(next.getMinutes() + 1);
  }
  return new Date(after.getTime() + 3600000);
}

class ExecutorDaemon {
  private chain = config.network === 'mainnet' ? mainnet : config.network === 'testnet' ? sepolia : localhost;
  private publicClient = createPublicClient({ chain: this.chain, transport: http(config.rpcUrl) });
  private account = privateKeyToAccount(config.privateKey as `0x${string}`);
  private walletClient = createWalletClient({ account: this.account, chain: this.chain, transport: http(config.rpcUrl) });
  private executorSdk;
  private scheduledTriggers = new Map<string, ScheduledTrigger>();
  private isRunning = false;

  constructor() {
    const storage = createStorage({ apiUrl: config.services.storageApi, ipfsGateway: config.services.ipfsGateway });
    const compute = createCompute({ marketplaceUrl: config.services.computeMarketplace, rpcUrl: config.rpcUrl });
    const agentSdk = createAgentSDK({ crucibleConfig: config, storage, compute, publicClient: this.publicClient, walletClient: this.walletClient });
    const roomSdk = createRoomSDK({ crucibleConfig: config, storage, publicClient: this.publicClient, walletClient: this.walletClient });
    this.executorSdk = createExecutorSDK({
      crucibleConfig: config, storage, compute, agentSdk, roomSdk,
      publicClient: this.publicClient, walletClient: this.walletClient, executorAddress: this.account.address,
    });
  }

  async start(): Promise<void> {
    log.info('Executor starting', { network: config.network, address: this.account.address });
    this.isRunning = true;
    await this.loadTriggers();
    this.pollLoop();
    this.schedulerLoop();
  }

  stop(): void {
    this.isRunning = false;
  }

  private async loadTriggers(): Promise<void> {
    const triggerIds = await this.publicClient.readContract({
      address: config.contracts.triggerRegistry, abi: TRIGGER_REGISTRY_ABI, functionName: 'getActiveTriggers',
    }) as `0x${string}`[];

    for (const triggerId of triggerIds) {
      const trigger = await this.getTrigger(triggerId);
      if (trigger?.active && trigger.triggerType === 0) {
        this.schedule(trigger);
      }
    }
    log.info('Triggers loaded', { count: this.scheduledTriggers.size });
  }

  private async getTrigger(triggerId: string): Promise<TriggerInfo | null> {
    const [, triggerType, name, cronExpression, , , active, lastExecutedAt] = await this.publicClient.readContract({
      address: config.contracts.triggerRegistry, abi: TRIGGER_REGISTRY_ABI,
      functionName: 'getTrigger', args: [triggerId as `0x${string}`],
    }) as [string, number, string, string, string, bigint, boolean, bigint];
    return { triggerId, triggerType, name, cronExpression, active, lastExecutedAt };
  }

  private schedule(trigger: TriggerInfo): void {
    const lastRun = trigger.lastExecutedAt > 0 ? new Date(Number(trigger.lastExecutedAt) * 1000) : new Date();
    const nextRunAt = getNextRun(trigger.cronExpression, lastRun);
    this.scheduledTriggers.set(trigger.triggerId, { triggerId: trigger.triggerId, nextRunAt, cronExpression: trigger.cronExpression });
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      await this.loadTriggers();
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  private async schedulerLoop(): Promise<void> {
    while (this.isRunning) {
      const now = new Date();
      for (const [triggerId, scheduled] of this.scheduledTriggers) {
        if (scheduled.nextRunAt <= now) {
          log.info('Executing trigger', { triggerId });
          this.executorSdk.executeTrigger(triggerId).then(r => {
            if (r.status === 'completed') log.info('Trigger completed', { triggerId });
            else log.error('Trigger failed', { triggerId, status: r.status });
          });
          scheduled.nextRunAt = getNextRun(scheduled.cronExpression, now);
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

const daemon = new ExecutorDaemon();
process.on('SIGINT', () => { daemon.stop(); process.exit(0); });
process.on('SIGTERM', () => { daemon.stop(); process.exit(0); });
daemon.start().catch(err => { log.error('Daemon failed', { error: String(err) }); process.exit(1); });

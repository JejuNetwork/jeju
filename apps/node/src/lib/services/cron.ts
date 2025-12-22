/**
 * Cron executor service - Real contract integration
 */

import { z } from 'zod';
import { type Address } from 'viem';
import { type NodeClient, getChain } from '../contracts';
import { TRIGGER_REGISTRY_ABI } from '../abis';

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((val) => val as Address);

const TriggerSchema = z.object({
  id: z.bigint(),
  owner: AddressSchema,
  triggerType: z.number().int().nonnegative(),
  endpoint: z.string().url(),
  schedule: z.string().min(1),
  pricePerExecution: z.bigint(),
});

export interface Trigger {
  id: bigint;
  owner: Address;
  triggerType: number;
  endpoint: string;
  schedule: string;
  pricePerExecution: bigint;
}

const CronServiceStateSchema = z.object({
  activeTriggers: z.array(TriggerSchema),
  executionsCompleted: z.number().int().nonnegative(),
  earningsWei: z.bigint(),
});

export interface CronServiceState {
  activeTriggers: Trigger[];
  executionsCompleted: number;
  earningsWei: bigint;
}

export function validateTrigger(data: unknown): Trigger {
  return TriggerSchema.parse(data);
}

export function validateCronServiceState(data: unknown): CronServiceState {
  return CronServiceStateSchema.parse(data);
}

export class CronService {
  private client: NodeClient;
  private executionsCompleted = 0;
  private earningsWei = 0n;

  constructor(client: NodeClient) {
    this.client = client;
  }

  async getActiveTriggers(): Promise<Trigger[]> {
    const triggers = await this.client.publicClient.readContract({
      address: this.client.addresses.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'getActiveTriggers',
    });

    return triggers.map((t: {
      id: bigint;
      owner: Address;
      triggerType: number;
      endpoint: string;
      schedule: string;
      pricePerExecution: bigint;
    }) => {
      const trigger = {
        id: t.id,
        owner: t.owner as `0x${string}`,
        triggerType: t.triggerType,
        endpoint: t.endpoint,
        schedule: t.schedule,
        pricePerExecution: t.pricePerExecution,
      };
      return validateTrigger(trigger);
    });
  }

  async executeTrigger(triggerId: bigint): Promise<{ success: boolean; txHash: string }> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    // Get trigger info
    const triggers = await this.getActiveTriggers();
    const trigger = triggers.find(t => t.id === triggerId);
    if (!trigger) {
      throw new Error(`Trigger ${triggerId} not found`);
    }

    // Execute the trigger endpoint
    const response = await fetch(trigger.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggerId: triggerId.toString() }),
    });
    const success = response.ok;

    // Record execution on-chain
    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'recordExecution',
      args: [triggerId, success],
    });

    if (success) {
      this.executionsCompleted++;
      // Executor gets 10% of price
      this.earningsWei += (trigger.pricePerExecution * 10n) / 100n;
    }

    return { success, txHash: hash };
  }

  async getState(): Promise<CronServiceState> {
    const triggers = await this.getActiveTriggers();
    const rawState = {
      activeTriggers: triggers,
      executionsCompleted: this.executionsCompleted,
      earningsWei: this.earningsWei,
    };
    return validateCronServiceState(rawState);
  }
}

export function createCronService(client: NodeClient): CronService {
  return new CronService(client);
}


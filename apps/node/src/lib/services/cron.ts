/**
 * Cron executor service - Real contract integration
 */

import { type Address } from 'viem';
import { type NodeClient, getChain } from '../contracts';
import { TRIGGER_REGISTRY_ABI } from '../abis';

export interface Trigger {
  id: bigint;
  owner: Address;
  triggerType: number;
  endpoint: string;
  schedule: string;
  pricePerExecution: bigint;
}

export interface CronServiceState {
  activeTriggers: Trigger[];
  executionsCompleted: number;
  earningsWei: bigint;
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
    }) => ({
      id: t.id,
      owner: t.owner,
      triggerType: t.triggerType,
      endpoint: t.endpoint,
      schedule: t.schedule,
      pricePerExecution: t.pricePerExecution,
    }));
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
    let success = false;
    try {
      const response = await fetch(trigger.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerId: triggerId.toString() }),
      });
      success = response.ok;
    } catch {
      success = false;
    }

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

  getState(): CronServiceState {
    return {
      activeTriggers: [],
      executionsCompleted: this.executionsCompleted,
      earningsWei: this.earningsWei,
    };
  }
}

export function createCronService(client: NodeClient): CronService {
  return new CronService(client);
}


/**
 * Executor SDK - Handles agent execution: triggers, inference, and state updates.
 */

import { type Address, type PublicClient, type WalletClient, parseAbi } from 'viem';
import type {
  ExecutionRequest, ExecutionResult, ExecutionCost, ExecutionMetadata,
  AgentAction, AgentTrigger, CrucibleConfig, RoomMessage,
} from '../types';
import { CrucibleStorage } from './storage';
import { CrucibleCompute } from './compute';
import { AgentSDK } from './agent';
import { RoomSDK } from './room';
import { createLogger, type Logger } from './logger';

const TRIGGER_REGISTRY_ABI = parseAbi([
  'function registerTrigger(string name, uint8 triggerType, string cronExpression, string endpoint, uint256 timeout, uint8 paymentMode, uint256 pricePerExecution) external returns (bytes32 triggerId)',
  'function registerTriggerWithAgent(string name, uint8 triggerType, string cronExpression, string endpoint, uint256 timeout, uint8 paymentMode, uint256 pricePerExecution, uint256 agentId) external returns (bytes32 triggerId)',
  'function getTrigger(bytes32 triggerId) external view returns (address owner, uint8 triggerType, string name, string endpoint, bool active, uint256 executionCount)',
  'function recordExecution(bytes32 triggerId, bool success, bytes32 outputHash) external returns (bytes32 executionId)',
  'function getAgentTriggers(uint256 agentId) external view returns (bytes32[])',
  'event TriggerRegistered(bytes32 indexed triggerId, address owner, string name)',
  'event TriggerExecuted(bytes32 indexed triggerId, bytes32 executionId, address executor, bool success)',
]);

const AGENT_VAULT_ABI = parseAbi([
  'function spend(uint256 agentId, address recipient, uint256 amount, string reason) external',
  'function getBalance(uint256 agentId) external view returns (uint256)',
]);

export interface ExecutorCostConfig {
  storageCostWei: bigint;
  executionFeeWei: bigint;
  baseCostWei: bigint;
  tokenCostWei: bigint;
}

export interface ExecutorConfig {
  crucibleConfig: CrucibleConfig;
  storage: CrucibleStorage;
  compute: CrucibleCompute;
  agentSdk: AgentSDK;
  roomSdk: RoomSDK;
  publicClient: PublicClient;
  walletClient: WalletClient;
  executorAddress: Address;
  costs?: ExecutorCostConfig;
  logger?: Logger;
}

const DEFAULT_COSTS: ExecutorCostConfig = {
  storageCostWei: 1000000000000n,      // 0.000001 ETH per IPFS pin
  executionFeeWei: 100000000000000n,   // 0.0001 ETH executor fee
  baseCostWei: 100000000000000n,       // 0.0001 ETH base
  tokenCostWei: 1000000000n,           // 1 gwei per token
};

export class ExecutorSDK {
  private config: CrucibleConfig;
  private storage: CrucibleStorage;
  private compute: CrucibleCompute;
  private agentSdk: AgentSDK;
  private roomSdk: RoomSDK;
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private executorAddress: Address;
  private costs: ExecutorCostConfig;
  private log: Logger;

  constructor(cfg: ExecutorConfig) {
    this.config = cfg.crucibleConfig;
    this.storage = cfg.storage;
    this.compute = cfg.compute;
    this.agentSdk = cfg.agentSdk;
    this.roomSdk = cfg.roomSdk;
    this.publicClient = cfg.publicClient;
    this.walletClient = cfg.walletClient;
    this.executorAddress = cfg.executorAddress;
    this.costs = cfg.costs ?? DEFAULT_COSTS;
    this.log = cfg.logger ?? createLogger('Executor');
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const executionId = crypto.randomUUID();

    this.log.info('Starting execution', { executionId, agentId: request.agentId.toString() });

    const cost: ExecutionCost = {
      total: 0n, inference: 0n, storage: 0n, executionFee: 0n, currency: 'ETH',
    };
    const metadata: ExecutionMetadata = {
      startedAt: startTime, completedAt: 0, latencyMs: 0, executor: this.executorAddress,
    };

    const agent = await this.agentSdk.getAgent(request.agentId);
    if (!agent) {
      this.log.error('Agent not found', { agentId: request.agentId.toString() });
      return this.failedResult(executionId, request.agentId, startTime);
    }

    const balance = await this.agentSdk.getVaultBalance(request.agentId);
    const estimatedCost = this.estimateCost(request.options?.maxTokens);
    if (balance < estimatedCost) {
      this.log.error('Insufficient balance', { balance: balance.toString(), required: estimatedCost.toString() });
      return this.failedResult(executionId, request.agentId, startTime);
    }

    const character = await this.agentSdk.loadCharacter(request.agentId);
    const state = await this.agentSdk.loadState(request.agentId);
    const context = await this.buildContext(request, state);

    this.log.debug('Running inference', { model: character.modelPreferences?.large });
    const inferenceResult = await this.compute.runInference(
      character, request.input.message ?? '', context, request.options
    );

    cost.inference = inferenceResult.cost;
    metadata.model = inferenceResult.model;
    metadata.tokensUsed = inferenceResult.tokensUsed;

    const actions = this.parseActions(inferenceResult.content);
    this.log.debug('Parsed actions', { count: actions.length });

    const actionResults = await this.executeActions(request.agentId, actions, request.input.roomId);

    const stateUpdates = {
      lastResponse: inferenceResult.content,
      lastActions: actionResults,
      actionSuccessRate: actionResults.filter(a => a.success).length / Math.max(actions.length, 1),
    };

    const { cid: newStateCid } = await this.agentSdk.updateState(request.agentId, {
      ...stateUpdates,
      context: {
        ...state.context,
        lastExecution: { executionId, timestamp: Date.now(), triggerId: request.triggerId },
      },
    });

    cost.storage = this.costs.storageCostWei;

    const roomMessages: RoomMessage[] = [];
    if (request.input.roomId) {
      const message = await this.roomSdk.postMessage(
        BigInt(request.input.roomId), request.agentId, inferenceResult.content, actions[0]?.type
      );
      roomMessages.push(message);
    }

    cost.executionFee = this.costs.executionFeeWei;
    cost.total = cost.inference + cost.storage + cost.executionFee;

    await this.payFromVault(request.agentId, cost.total, `Execution ${executionId}`);

    if (request.triggerId) {
      await this.recordTriggerExecution(request.triggerId, true, executionId);
    }

    metadata.completedAt = Date.now();
    metadata.latencyMs = metadata.completedAt - startTime;

    this.log.info('Execution complete', {
      executionId,
      agentId: request.agentId.toString(),
      latencyMs: metadata.latencyMs,
      totalCost: cost.total.toString(),
    });

    return {
      executionId,
      agentId: request.agentId,
      status: 'completed',
      output: { response: inferenceResult.content, actions: actionResults, stateUpdates, roomMessages },
      newStateCid,
      cost,
      metadata,
    };
  }

  async executeTrigger(triggerId: string): Promise<ExecutionResult> {
    this.log.info('Executing trigger', { triggerId });

    const [, , , endpoint, active] = await this.publicClient.readContract({
      address: this.config.contracts.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'getTrigger',
      args: [triggerId as `0x${string}`],
    }) as [Address, number, string, string, boolean, bigint];

    if (!active) {
      this.log.error('Trigger not active', { triggerId });
      throw new Error(`Trigger not active: ${triggerId}`);
    }

    const match = endpoint.match(/agent:\/\/(\d+)/);
    if (!match) {
      this.log.error('Invalid trigger endpoint', { triggerId, endpoint });
      throw new Error(`Invalid trigger endpoint: ${endpoint}`);
    }

    return this.execute({
      agentId: BigInt(match[1] ?? '0'),
      triggerId,
      input: { message: `Trigger fired` },
    });
  }

  async registerCronTrigger(
    agentId: bigint,
    name: string,
    cronExpression: string,
    options?: { pricePerExecution?: bigint }
  ): Promise<string> {
    this.log.info('Registering cron trigger', { agentId: agentId.toString(), name, cronExpression });

    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'registerTriggerWithAgent',
      args: [name, 0, cronExpression, `agent://${agentId}`, 300n, 2, options?.pricePerExecution ?? 0n, agentId],
      account: this.walletClient.account,
    });

    const txHash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    const triggerId = receipt.logs[0]?.topics[1] ?? '';

    this.log.info('Trigger registered', { triggerId, agentId: agentId.toString() });
    return triggerId;
  }

  async getAgentTriggers(agentId: bigint): Promise<AgentTrigger[]> {
    const triggerIds = await this.publicClient.readContract({
      address: this.config.contracts.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'getAgentTriggers',
      args: [agentId],
    }) as `0x${string}`[];

    const triggers: AgentTrigger[] = [];
    for (const triggerId of triggerIds) {
      const [, triggerType, , endpoint, active, executionCount] = await this.publicClient.readContract({
        address: this.config.contracts.triggerRegistry,
        abi: TRIGGER_REGISTRY_ABI,
        functionName: 'getTrigger',
        args: [triggerId],
      }) as [Address, number, string, string, boolean, bigint];

      triggers.push({
        triggerId, agentId,
        type: (['cron', 'webhook', 'event', 'room_message'] as const)[triggerType] ?? 'cron',
        config: { endpoint, paymentMode: 'vault' },
        active,
        fireCount: Number(executionCount),
      });
    }
    return triggers;
  }

  private async buildContext(
    request: ExecutionRequest,
    state: { memories: Array<{ content: string }>; context: Record<string, unknown> }
  ) {
    const context: {
      recentMessages?: Array<{ role: string; content: string }>;
      memories?: string[];
    } = {};

    if (state.memories.length > 0) {
      context.memories = state.memories.slice(-5).map(m => m.content);
    }

    if (request.input.roomId) {
      const messages = await this.roomSdk.getMessages(BigInt(request.input.roomId), 10);
      context.recentMessages = messages.map(m => ({ role: 'user', content: `[Agent ${m.agentId}]: ${m.content}` }));
    }

    return context;
  }

  private parseActions(response: string): AgentAction[] {
    const actions: AgentAction[] = [];
    const regex = /\[ACTION:\s*(\w+)(?:\s*\|\s*(.+?))?\]/g;
    let match;
    while ((match = regex.exec(response)) !== null) {
      const params: Record<string, unknown> = {};
      if (match[2]) {
        for (const pair of match[2].split(',')) {
          const [key, value] = pair.split('=').map(s => s?.trim());
          if (key && value) params[key] = value;
        }
      }
      actions.push({ type: match[1] ?? 'unknown', params: Object.keys(params).length ? params : undefined, success: false });
    }
    return actions;
  }

  private async executeActions(agentId: bigint, actions: AgentAction[], roomId?: string): Promise<AgentAction[]> {
    return Promise.all(actions.map(async action => {
      const result = { ...action };
      if (action.type === 'POST_TO_ROOM' && roomId && action.params?.['content']) {
        await this.roomSdk.postMessage(BigInt(roomId), agentId, String(action.params['content']));
        result.success = true;
      } else if (action.type === 'REMEMBER' && action.params?.['content']) {
        await this.agentSdk.addMemory(agentId, String(action.params['content']), { importance: 0.7 });
        result.success = true;
      } else if (action.type === 'UPDATE_SCORE' && roomId && action.params?.['delta']) {
        await this.roomSdk.updateScore(BigInt(roomId), agentId, Number(action.params['delta']));
        result.success = true;
      }
      return result;
    }));
  }

  private estimateCost(maxTokens: number = 2048): bigint {
    return this.costs.baseCostWei + BigInt(maxTokens) * this.costs.tokenCostWei;
  }

  private async payFromVault(agentId: bigint, amount: bigint, reason: string): Promise<void> {
    this.log.debug('Paying from vault', { agentId: agentId.toString(), amount: amount.toString() });
    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'spend',
      args: [agentId, this.executorAddress, amount, reason],
      account: this.walletClient.account,
    });
    await this.walletClient.writeContract(request);
  }

  private async recordTriggerExecution(triggerId: string, success: boolean, executionId: string): Promise<void> {
    const outputHash = `0x${Buffer.from(executionId).toString('hex').padStart(64, '0')}` as `0x${string}`;
    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'recordExecution',
      args: [triggerId as `0x${string}`, success, outputHash],
      account: this.walletClient.account,
    });
    await this.walletClient.writeContract(request);
  }

  private failedResult(executionId: string, agentId: bigint, startTime: number): ExecutionResult {
    return {
      executionId, agentId, status: 'failed',
      cost: { total: 0n, inference: 0n, storage: 0n, executionFee: 0n, currency: 'ETH' },
      metadata: { startedAt: startTime, completedAt: Date.now(), latencyMs: Date.now() - startTime, executor: this.executorAddress },
    };
  }
}

export function createExecutorSDK(config: ExecutorConfig): ExecutorSDK {
  return new ExecutorSDK(config);
}

/**
 * Executor SDK - Handles agent execution: triggers, inference, and state updates.
 */

import { asHex } from '@jejunetwork/types'
import {
  type Address,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem'
import type {
  ActionParams,
  AgentAction,
  AgentContext,
  AgentDefinition,
  AgentTrigger,
  CrucibleConfig,
  ExecutionCost,
  ExecutionMetadata,
  ExecutionRequest,
  ExecutionResult,
  RoomMessage,
} from '../../lib/types'
import { expect, expectTrue } from '../schemas'
import type { AgentSDK } from './agent'
import type { CrucibleCompute } from './compute'
import { createLogger, type Logger } from './logger'
import type { RoomSDK } from './room'
import type { CrucibleStorage } from './storage'

const TRIGGER_REGISTRY_ABI = parseAbi([
  'function registerTrigger(string name, uint8 triggerType, string cronExpression, string endpoint, uint256 timeout, uint8 paymentMode, uint256 pricePerExecution) external returns (bytes32 triggerId)',
  'function registerTriggerWithAgent(string name, uint8 triggerType, string cronExpression, string endpoint, uint256 timeout, uint8 paymentMode, uint256 pricePerExecution, uint256 agentId) external returns (bytes32 triggerId)',
  'function getTrigger(bytes32 triggerId) external view returns (address owner, uint8 triggerType, string name, string endpoint, bool active, uint256 executionCount)',
  'function recordExecution(bytes32 triggerId, bool success, bytes32 outputHash) external returns (bytes32 executionId)',
  'function getAgentTriggers(uint256 agentId) external view returns (bytes32[])',
  'event TriggerRegistered(bytes32 indexed triggerId, address owner, string name)',
  'event TriggerExecuted(bytes32 indexed triggerId, bytes32 executionId, address executor, bool success)',
])

const AGENT_VAULT_ABI = parseAbi([
  'function spend(uint256 agentId, address recipient, uint256 amount, string reason) external',
  'function getBalance(uint256 agentId) external view returns (uint256)',
])

export interface ExecutorCostConfig {
  storageCostWei: bigint
  executionFeeWei: bigint
  baseCostWei: bigint
  tokenCostWei: bigint
}

export interface ExecutorConfig {
  crucibleConfig: CrucibleConfig
  storage: CrucibleStorage
  compute: CrucibleCompute
  agentSdk: AgentSDK
  roomSdk: RoomSDK
  publicClient: PublicClient
  walletClient: WalletClient
  executorAddress: Address
  costs?: ExecutorCostConfig
  logger?: Logger
}

const DEFAULT_COSTS: ExecutorCostConfig = {
  storageCostWei: 1000000000000n, // 0.000001 ETH per IPFS pin
  executionFeeWei: 100000000000000n, // 0.0001 ETH executor fee
  baseCostWei: 100000000000000n, // 0.0001 ETH base
  tokenCostWei: 1000000000n, // 1 gwei per token
}

export class ExecutorSDK {
  private config: CrucibleConfig
  private compute: CrucibleCompute
  private agentSdk: AgentSDK
  private roomSdk: RoomSDK
  private publicClient: PublicClient
  private walletClient: WalletClient
  private executorAddress: Address
  private costs: ExecutorCostConfig
  private log: Logger

  constructor(cfg: ExecutorConfig) {
    this.config = cfg.crucibleConfig
    this.compute = cfg.compute
    this.agentSdk = cfg.agentSdk
    this.roomSdk = cfg.roomSdk
    this.publicClient = cfg.publicClient
    this.walletClient = cfg.walletClient
    this.executorAddress = cfg.executorAddress
    this.costs = cfg.costs ?? DEFAULT_COSTS
    this.log = cfg.logger ?? createLogger('Executor')
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    expect(request, 'Execution request is required')
    expectTrue(request.agentId > 0n, 'Agent ID must be greater than 0')
    expect(request.input, 'Execution input is required')
    if (request.options?.maxTokens != null) {
      expectTrue(
        request.options.maxTokens > 0 && request.options.maxTokens <= 100000,
        'Max tokens must be between 1 and 100000',
      )
    }
    if (request.options?.temperature != null) {
      expectTrue(
        request.options.temperature >= 0 && request.options.temperature <= 2,
        'Temperature must be between 0 and 2',
      )
    }
    if (request.options?.timeout != null) {
      expectTrue(
        request.options.timeout > 0 && request.options.timeout <= 300,
        'Timeout must be between 1 and 300 seconds',
      )
    }

    const startTime = Date.now()
    const executionId = crypto.randomUUID()

    this.log.info('Starting execution', {
      executionId,
      agentId: request.agentId.toString(),
    })

    const agent = await this.agentSdk.getAgent(request.agentId)
    const validAgent = expect(
      agent,
      `Agent not found: ${request.agentId.toString()}`,
    )

    // Route to appropriate execution handler based on bot type
    if (validAgent.botType === 'trading_bot') {
      return this.executeTradingBot(request, validAgent, executionId, startTime)
    }

    if (validAgent.botType === 'org_tool') {
      return this.executeOrgTool(request, validAgent, executionId, startTime)
    }

    // Default: AI agent execution
    return this.executeAIAgent(request, validAgent, executionId, startTime)
  }

  private async executeAIAgent(
    request: ExecutionRequest,
    _agent: AgentDefinition,
    executionId: string,
    startTime: number,
  ): Promise<ExecutionResult> {
    const cost: ExecutionCost = {
      total: 0n,
      inference: 0n,
      storage: 0n,
      executionFee: 0n,
      currency: 'ETH',
    }
    const metadata: ExecutionMetadata = {
      startedAt: startTime,
      completedAt: 0,
      latencyMs: 0,
      executor: this.executorAddress,
    }

    const balance = await this.agentSdk.getVaultBalance(request.agentId)
    const estimatedCost = this.estimateCost(
      request.options?.maxTokens ?? undefined,
    )
    if (balance < estimatedCost) {
      this.log.error('Insufficient balance', {
        balance: balance.toString(),
        required: estimatedCost.toString(),
      })
      return this.failedResult(executionId, request.agentId, startTime)
    }

    const character = await this.agentSdk.loadCharacter(request.agentId)
    const state = await this.agentSdk.loadState(request.agentId)
    const context = await this.buildContext(request, state)

    this.log.debug('Running inference', {
      model: character.modelPreferences?.large ?? null,
    })
    const inferenceResult = await this.compute.runInference(
      character,
      request.input.message ?? '',
      context,
      request.options,
    )

    cost.inference = inferenceResult.cost
    metadata.model = inferenceResult.model
    metadata.tokensUsed = inferenceResult.tokensUsed

    const actions = this.parseActions(inferenceResult.content)
    this.log.debug('Parsed actions', { count: actions.length })

    const actionResults = await this.executeActions(
      request.agentId,
      actions,
      request.input.roomId ?? undefined,
    )

    const stateUpdates = {
      lastResponse: inferenceResult.content,
      lastActions: actionResults,
      actionSuccessRate:
        actionResults.filter((a) => a.success).length /
        Math.max(actions.length, 1),
    }

    const { cid: newStateCid } = await this.agentSdk.updateState(
      request.agentId,
      {
        ...stateUpdates,
        context: {
          ...state.context,
          lastExecution: {
            executionId,
            timestamp: Date.now(),
            triggerId: request.triggerId,
          },
        },
      },
    )

    cost.storage = this.costs.storageCostWei

    const roomMessages: RoomMessage[] = []
    if (request.input.roomId) {
      const message = await this.roomSdk.postMessage(
        BigInt(request.input.roomId),
        request.agentId,
        inferenceResult.content,
        actions[0]?.type,
      )
      roomMessages.push(message)
    }

    cost.executionFee = this.costs.executionFeeWei
    cost.total = cost.inference + cost.storage + cost.executionFee

    await this.payFromVault(
      request.agentId,
      cost.total,
      `Execution ${executionId}`,
    )

    if (request.triggerId) {
      await this.recordTriggerExecution(request.triggerId, true, executionId)
    }

    metadata.completedAt = Date.now()
    metadata.latencyMs = metadata.completedAt - startTime

    this.log.info('Execution complete', {
      executionId,
      agentId: request.agentId.toString(),
      latencyMs: metadata.latencyMs,
      totalCost: cost.total.toString(),
    })

    return {
      executionId,
      agentId: request.agentId,
      status: 'completed',
      output: {
        response: inferenceResult.content,
        actions: actionResults,
        stateUpdates,
        roomMessages,
      },
      newStateCid,
      cost,
      metadata,
    }
  }

  private async executeTradingBot(
    request: ExecutionRequest,
    agent: AgentDefinition,
    executionId: string,
    startTime: number,
  ): Promise<ExecutionResult> {
    this.log.info('Trading bot execution requested', {
      agentId: request.agentId.toString(),
    })

    // Trading bots run continuously - this endpoint returns their current status
    // and can be used to trigger manual evaluation or configuration updates
    const message = request.input.message ?? ''
    let responseMessage = 'Trading bot status: '
    const actions: AgentAction[] = []

    // Parse command from message if provided
    if (message.toLowerCase().includes('status')) {
      responseMessage += `Bot ${agent.name} is ${agent.active ? 'active' : 'inactive'}. `
      responseMessage += `Registered at ${new Date(agent.registeredAt).toISOString()}.`
    } else if (message.toLowerCase().includes('balance')) {
      const balance = await this.agentSdk.getVaultBalance(request.agentId)
      responseMessage += `Vault balance: ${balance.toString()} wei`
    } else if (
      message.toLowerCase().includes('strategies') &&
      agent.strategies
    ) {
      responseMessage += `Active strategies: ${agent.strategies.map((s) => s.type).join(', ')}`
    } else {
      // Default status
      responseMessage = `Trading bot ${agent.name} is running continuously. `
      responseMessage +=
        'Use "status", "balance", or "strategies" commands for details.'
    }

    const completedAt = Date.now()
    return {
      executionId,
      agentId: request.agentId,
      status: 'completed',
      output: { response: responseMessage, actions },
      cost: {
        total: this.costs.executionFeeWei,
        inference: 0n,
        storage: 0n,
        executionFee: this.costs.executionFeeWei,
        currency: 'ETH',
      },
      metadata: {
        startedAt: startTime,
        completedAt,
        latencyMs: completedAt - startTime,
        executor: this.executorAddress,
      },
    }
  }

  private async executeOrgTool(
    request: ExecutionRequest,
    _agent: AgentDefinition,
    executionId: string,
    startTime: number,
  ): Promise<ExecutionResult> {
    this.log.info('Org tool execution requested', {
      agentId: request.agentId.toString(),
    })

    const [character, state] = await Promise.all([
      this.agentSdk.loadCharacter(request.agentId),
      this.agentSdk.loadState(request.agentId),
    ])
    const context = await this.buildContext(request, state)
    const inferenceResult = await this.compute.runInference(
      character,
      request.input.message ?? '',
      context,
      request.options,
    )

    const completedAt = Date.now()
    return {
      executionId,
      agentId: request.agentId,
      status: 'completed',
      output: { response: inferenceResult.content, actions: [] },
      cost: {
        total:
          inferenceResult.cost +
          this.costs.storageCostWei +
          this.costs.executionFeeWei,
        inference: inferenceResult.cost,
        storage: this.costs.storageCostWei,
        executionFee: this.costs.executionFeeWei,
        currency: 'ETH',
      },
      metadata: {
        startedAt: startTime,
        completedAt,
        latencyMs: completedAt - startTime,
        executor: this.executorAddress,
        model: inferenceResult.model,
        tokensUsed: inferenceResult.tokensUsed,
      },
    }
  }

  async executeTrigger(triggerId: string): Promise<ExecutionResult> {
    expect(triggerId, 'Trigger ID is required')
    expectTrue(triggerId.length > 0, 'Trigger ID cannot be empty')

    this.log.info('Executing trigger', { triggerId })

    const [, , , endpoint, active] = (await this.publicClient.readContract({
      address: this.config.contracts.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'getTrigger',
      args: [asHex(triggerId)],
    })) as [Address, number, string, string, boolean, bigint]

    expect(active, `Trigger not active: ${triggerId}`)

    const match = endpoint.match(/agent:\/\/(\d+)/)
    const validMatch = expect(match, `Invalid trigger endpoint: ${endpoint}`)
    const agentIdStr = expect(
      validMatch[1],
      'Agent ID not found in trigger endpoint',
    )

    return this.execute({
      agentId: BigInt(agentIdStr),
      triggerId,
      input: { message: `Trigger fired` },
    })
  }

  async registerCronTrigger(
    agentId: bigint,
    name: string,
    cronExpression: string,
    options?: { pricePerExecution?: bigint },
  ): Promise<string> {
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')
    expect(name, 'Trigger name is required')
    expectTrue(name.length > 0, 'Trigger name cannot be empty')
    expect(cronExpression, 'Cron expression is required')
    expectTrue(cronExpression.length > 0, 'Cron expression cannot be empty')
    if (options?.pricePerExecution !== undefined) {
      expectTrue(
        options.pricePerExecution >= 0n,
        'Price per execution must be non-negative',
      )
    }

    this.log.info('Registering cron trigger', {
      agentId: agentId.toString(),
      name,
      cronExpression,
    })

    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'registerTriggerWithAgent',
      args: [
        name,
        0,
        cronExpression,
        `agent://${agentId}`,
        300n,
        2,
        options?.pricePerExecution ?? 0n,
        agentId,
      ],
      account: this.walletClient.account,
    })

    const txHash = await this.walletClient.writeContract(request)
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })
    const triggerId = receipt.logs[0]?.topics[1]
    if (!triggerId) {
      throw new Error('Failed to extract trigger ID from transaction receipt')
    }

    this.log.info('Trigger registered', {
      triggerId,
      agentId: agentId.toString(),
    })
    return triggerId
  }

  async getAgentTriggers(agentId: bigint): Promise<AgentTrigger[]> {
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')
    const triggerIds = (await this.publicClient.readContract({
      address: this.config.contracts.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'getAgentTriggers',
      args: [agentId],
    })) as `0x${string}`[]

    const triggers: AgentTrigger[] = []
    for (const triggerId of triggerIds) {
      expect(triggerId, 'Trigger ID is required')
      const [, triggerType, , endpoint, active, executionCount] =
        (await this.publicClient.readContract({
          address: this.config.contracts.triggerRegistry,
          abi: TRIGGER_REGISTRY_ABI,
          functionName: 'getTrigger',
          args: [triggerId],
        })) as [Address, number, string, string, boolean, bigint]

      const triggerTypes = ['cron', 'webhook', 'event', 'room_message'] as const
      if (triggerType < 0 || triggerType >= triggerTypes.length) {
        throw new Error(
          `Invalid trigger type number: ${triggerType}. Must be 0-${triggerTypes.length - 1}`,
        )
      }
      triggers.push({
        triggerId,
        agentId,
        type: triggerTypes[triggerType],
        config: { endpoint, paymentMode: 'vault' },
        active,
        fireCount: Number(executionCount),
      })
    }
    return triggers
  }

  private async buildContext(
    request: ExecutionRequest,
    state: { memories: Array<{ content: string }>; context: AgentContext },
  ) {
    const context: {
      recentMessages?: Array<{ role: string; content: string }>
      memories?: string[]
    } = {}

    if (state.memories.length > 0) {
      context.memories = state.memories.slice(-5).map((m) => m.content)
    }

    if (request.input.roomId) {
      const messages = await this.roomSdk.getMessages(
        BigInt(request.input.roomId),
        10,
      )
      context.recentMessages = messages.map((m) => ({
        role: 'user',
        content: `[Agent ${m.agentId}]: ${m.content}`,
      }))
    }

    return context
  }

  private parseActions(response: string): AgentAction[] {
    expect(response, 'Response is required')
    const actions: AgentAction[] = []

    // Limit response length to prevent DoS
    const maxResponseLength = 100000
    const safeResponse =
      response.length > maxResponseLength
        ? response.slice(0, maxResponseLength)
        : response

    // Use safer regex pattern - limit parameter content to alphanumeric, spaces, and common punctuation
    // Avoid .+ which can cause catastrophic backtracking
    const regex =
      /\[ACTION:\s*([A-Z_][A-Z0-9_]*)(?:\s*\|\s*([^[\]]{0,500}))?\]/gi
    let match: RegExpExecArray | null
    let matchCount = 0
    const maxMatches = 100 // Limit number of actions to prevent DoS

    match = regex.exec(safeResponse)
    while (match !== null && matchCount < maxMatches) {
      matchCount++
      expect(match[1], 'Action type is required')
      const params: ActionParams = {}
      if (match[2]) {
        // Limit parameter parsing
        const paramPairs = match[2].split(',').slice(0, 20) // Max 20 parameters
        for (const pair of paramPairs) {
          const eqIndex = pair.indexOf('=')
          if (eqIndex > 0) {
            const key = pair.slice(0, eqIndex).trim()
            const value = pair.slice(eqIndex + 1).trim()
            if (key && value && key.length < 100 && value.length < 1000) {
              params[key] = value
            }
          }
        }
      }
      actions.push({
        type: match[1],
        params: Object.keys(params).length > 0 ? params : undefined,
        success: false,
      })
      match = regex.exec(safeResponse)
    }
    return actions
  }

  private async executeActions(
    agentId: bigint,
    actions: AgentAction[],
    roomId?: string,
  ): Promise<AgentAction[]> {
    return Promise.all(
      actions.map(async (action) => {
        const result = { ...action }
        if (
          action.type === 'POST_TO_ROOM' &&
          roomId &&
          action.params?.content
        ) {
          await this.roomSdk.postMessage(
            BigInt(roomId),
            agentId,
            String(action.params.content),
          )
          result.success = true
        } else if (action.type === 'REMEMBER' && action.params?.content) {
          await this.agentSdk.addMemory(
            agentId,
            String(action.params.content),
            { importance: 0.7 },
          )
          result.success = true
        } else if (
          action.type === 'UPDATE_SCORE' &&
          roomId &&
          action.params?.delta
        ) {
          await this.roomSdk.updateScore(
            BigInt(roomId),
            agentId,
            Number(action.params.delta),
          )
          result.success = true
        }
        return result
      }),
    )
  }

  private estimateCost(maxTokens: number = 2048): bigint {
    expectTrue(maxTokens > 0, 'Max tokens must be greater than 0')
    expectTrue(
      maxTokens <= 100000,
      'Max tokens must be less than or equal to 100000',
    )
    return this.costs.baseCostWei + BigInt(maxTokens) * this.costs.tokenCostWei
  }

  private async payFromVault(
    agentId: bigint,
    amount: bigint,
    reason: string,
  ): Promise<void> {
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')
    expectTrue(amount > 0n, 'Amount must be greater than 0')
    expect(reason, 'Reason is required')
    expectTrue(reason.length > 0, 'Reason cannot be empty')
    this.log.debug('Paying from vault', {
      agentId: agentId.toString(),
      amount: amount.toString(),
    })
    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'spend',
      args: [agentId, this.executorAddress, amount, reason],
      account: this.walletClient.account,
    })
    await this.walletClient.writeContract(request)
  }

  private async recordTriggerExecution(
    triggerId: string,
    success: boolean,
    executionId: string,
  ): Promise<void> {
    expect(triggerId, 'Trigger ID is required')
    expectTrue(triggerId.length > 0, 'Trigger ID cannot be empty')
    expect(executionId, 'Execution ID is required')
    expectTrue(executionId.length > 0, 'Execution ID cannot be empty')
    const outputHash = asHex(
      `0x${Buffer.from(executionId).toString('hex').padStart(64, '0')}`,
    )
    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.triggerRegistry,
      abi: TRIGGER_REGISTRY_ABI,
      functionName: 'recordExecution',
      args: [asHex(triggerId), success, outputHash],
      account: this.walletClient.account,
    })
    await this.walletClient.writeContract(request)
  }

  private failedResult(
    executionId: string,
    agentId: bigint,
    startTime: number,
  ): ExecutionResult {
    return {
      executionId,
      agentId,
      status: 'failed',
      cost: {
        total: 0n,
        inference: 0n,
        storage: 0n,
        executionFee: 0n,
        currency: 'ETH',
      },
      metadata: {
        startedAt: startTime,
        completedAt: Date.now(),
        latencyMs: Date.now() - startTime,
        executor: this.executorAddress,
      },
    }
  }
}

export function createExecutorSDK(config: ExecutorConfig): ExecutorSDK {
  return new ExecutorSDK(config)
}

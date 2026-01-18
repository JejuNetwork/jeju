/**
 * Agent Test Fixtures and Mocks
 *
 * Provides mock implementations for agent testing without
 * requiring full DWS infrastructure.
 */

import { type Address, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { localhost } from 'viem/chains'
import type {
  RuntimeMessage,
  RuntimeResponse,
} from '../../api/sdk/eliza-runtime'
import type { AgentCharacter } from '../../lib/types'

/**
 * Mock KMS Signer for testing
 *
 * Uses a simple private key instead of actual KMS threshold signing.
 * Provides the same interface as the real KMSSigner.
 */
export class MockKMSSigner {
  private account: ReturnType<typeof privateKeyToAccount>
  private walletClient: ReturnType<typeof createWalletClient>
  private initialized = false

  constructor(
    privateKey: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Anvil account 0
    rpcUrl: string = 'http://127.0.0.1:8545',
    chainId: number = 31337, // Anvil default chain ID
  ) {
    this.account = privateKeyToAccount(privateKey)
    // Use Anvil chain configuration with correct chain ID
    const anvil = {
      ...localhost,
      id: chainId,
    }
    this.walletClient = createWalletClient({
      account: this.account,
      chain: anvil,
      transport: http(rpcUrl),
    })
  }

  async initialize(): Promise<void> {
    this.initialized = true
  }

  isInitialized(): boolean {
    return this.initialized
  }

  getAddress(): Address {
    return this.account.address
  }

  getKeyId(): string {
    return 'mock-key-id'
  }

  async signMessage(message: string | Uint8Array): Promise<{
    signature: Hex
    r: Hex
    s: Hex
    v: number
    mode: string
    participants: string[]
  }> {
    const signature = await this.account.signMessage({
      message: typeof message === 'string' ? message : { raw: message },
    })
    return {
      signature,
      r: `0x${signature.slice(2, 66)}` as Hex,
      s: `0x${signature.slice(66, 130)}` as Hex,
      v: parseInt(signature.slice(130, 132), 16),
      mode: 'mock',
      participants: ['mock-signer'],
    }
  }

  async signContractWrite(params: {
    address: Address
    abi: readonly unknown[]
    functionName: string
    args?: readonly unknown[]
    value?: bigint
  }): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: params.address,
      abi: params.abi as Parameters<
        typeof this.walletClient.writeContract
      >[0]['abi'],
      functionName: params.functionName,
      args: params.args as readonly unknown[],
      value: params.value,
    })
    return hash
  }
}

/**
 * Mock DWS client for testing
 */
export class MockDWSClient {
  private healthy = true
  private inferenceAvailable = true
  private inferenceNodes = 3

  setHealthy(healthy: boolean): void {
    this.healthy = healthy
  }

  setInferenceAvailable(available: boolean, nodes = 3): void {
    this.inferenceAvailable = available
    this.inferenceNodes = nodes
  }

  async health(): Promise<{ status: string }> {
    return { status: this.healthy ? 'healthy' : 'unhealthy' }
  }

  async isHealthy(): Promise<boolean> {
    return this.healthy
  }

  async checkInferenceAvailable(): Promise<{
    available: boolean
    nodes: number
    error: string | null
  }> {
    return {
      available: this.inferenceAvailable,
      nodes: this.inferenceNodes,
      error: null,
    }
  }

  async chatCompletion(
    messages: Array<{ role: string; content: string }>,
    _options?: { model?: string; temperature?: number; maxTokens?: number },
  ): Promise<{ id: string; choices: Array<{ message: { content: string } }> }> {
    const lastMessage = messages[messages.length - 1]
    return {
      id: crypto.randomUUID(),
      choices: [
        {
          message: {
            content: `Mock response to: ${lastMessage?.content?.slice(0, 50) ?? 'unknown'}`,
          },
        },
      ],
    }
  }
}

/**
 * Mock agent runtime for testing
 */
export class MockAgentRuntime {
  private agentId: string
  private character: AgentCharacter
  private initialized = false
  private actions: string[] = [
    'SWAP_TOKENS',
    'CREATE_PROPOSAL',
    'VOTE',
    'UPLOAD_FILE',
    'RUN_INFERENCE',
    'REPORT_AGENT',
    'CALL_AGENT',
  ]

  constructor(config: { agentId: string; character: AgentCharacter }) {
    this.agentId = config.agentId
    this.character = config.character
  }

  async initialize(): Promise<void> {
    this.initialized = true
  }

  isInitialized(): boolean {
    return this.initialized
  }

  getAgentId(): string {
    return this.agentId
  }

  getCharacter(): AgentCharacter {
    return this.character
  }

  hasActions(): boolean {
    return this.actions.length > 0
  }

  getAvailableActions(): string[] {
    return this.actions
  }

  getExecutableActions(): string[] {
    return this.actions
  }

  actionHasHandler(actionName: string): boolean {
    return this.actions.includes(actionName.toUpperCase())
  }

  async processMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
    const response = `Hello! I'm ${this.character.name}. You said: "${message.content.text.slice(0, 50)}..."`
    return {
      text: response,
      action: undefined,
      actions: undefined,
    }
  }

  async executeAction(
    actionName: string,
    params: Record<string, string>,
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    if (!this.actionHasHandler(actionName)) {
      return { success: false, error: `Action not found: ${actionName}` }
    }

    return {
      success: true,
      result: {
        action: actionName,
        params,
        executed: true,
        mock: true,
      },
    }
  }
}

/**
 * Create a mock character for testing
 */
export function createMockCharacter(
  id: string,
  name: string,
  overrides: Partial<AgentCharacter> = {},
): AgentCharacter {
  return {
    id,
    name,
    system: `You are ${name}, a test agent for unit testing.`,
    bio: [`${name} is a test agent created for automated testing.`],
    topics: ['testing', 'automation', 'verification'],
    adjectives: ['helpful', 'precise', 'reliable'],
    style: {
      all: ['Be concise and accurate'],
      chat: ['Respond directly'],
      post: ['Keep it brief'],
    },
    messageExamples: [],
    ...overrides,
  }
}

/**
 * Create a set of mock characters for testing
 */
export function createMockCharacterSet(): Record<string, AgentCharacter> {
  return {
    'mock-pm': createMockCharacter('mock-pm', 'Mock Project Manager', {
      topics: ['project-management', 'planning', 'coordination'],
    }),
    'mock-security': createMockCharacter(
      'mock-security',
      'Mock Security Agent',
      {
        topics: ['security', 'vulnerabilities', 'auditing'],
      },
    ),
    'mock-community': createMockCharacter(
      'mock-community',
      'Mock Community Manager',
      {
        topics: ['community', 'engagement', 'support'],
      },
    ),
    'mock-trading': createMockCharacter('mock-trading', 'Mock Trading Bot', {
      topics: ['trading', 'defi', 'arbitrage'],
    }),
  }
}

/**
 * Mock deliberation result for autocrat testing
 */
export interface MockVote {
  role: string
  agentId: string
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN'
  reasoning: string
  confidence: number
  timestamp: number
}

export function createMockVote(
  role: string,
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN' = 'APPROVE',
  confidence = 75,
): MockVote {
  return {
    role,
    agentId: role.toLowerCase(),
    vote,
    reasoning: `Mock ${role} vote: ${vote} with ${confidence}% confidence`,
    confidence,
    timestamp: Date.now(),
  }
}

export function createMockBoardVotes(): MockVote[] {
  return [
    createMockVote('TREASURY', 'APPROVE', 85),
    createMockVote('CODE', 'APPROVE', 90),
    createMockVote('COMMUNITY', 'APPROVE', 80),
    createMockVote('SECURITY', 'APPROVE', 75),
    createMockVote('LEGAL', 'ABSTAIN', 60),
  ]
}

/**
 * Mock Director decision
 */
export interface MockDirectorDecision {
  approved: boolean
  reasoning: string
  personaResponse: string
  confidence: number
  alignment: number
  recommendations: string[]
}

export function createMockDirectorDecision(
  approved = true,
): MockDirectorDecision {
  return {
    approved,
    reasoning: approved
      ? 'The board has approved this proposal with strong consensus.'
      : 'The board has raised significant concerns that need to be addressed.',
    personaResponse: approved
      ? 'Excellent proposal! I hereby approve this for implementation.'
      : 'This proposal needs more work. Please address the concerns raised.',
    confidence: approved ? 85 : 70,
    alignment: approved ? 90 : 60,
    recommendations: approved
      ? ['Proceed with implementation', 'Monitor progress weekly']
      : [
          'Address security concerns',
          'Revise budget estimates',
          'Resubmit for review',
        ],
  }
}

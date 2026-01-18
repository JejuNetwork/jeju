/**
 * Multi-tenant Board Integration
 *
 * Enables multiple independent boards to each have their own OAuth3 apps,
 * Directors, and governance while sharing the same infrastructure.
 */

import {
  getBoardElizaOauth3App,
  getBoardJejuOauth3App,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { type Address, type Hex, isAddress, keccak256, toBytes } from 'viem'
import type {
  AuthProvider,
  BoardConfig,
  BoardType,
  OAuth3App,
} from '../types.js'

/**
 * Load board address from environment or return ZERO_ADDRESS
 * Format: BOARD_{TYPE}_{ROLE}_ADDRESS
 */
function loadBoardAddress(boardType: BoardType, role: string): Address {
  const envKey = `BOARD_${boardType.toUpperCase()}_${role.toUpperCase()}_ADDRESS`
  const value = process.env[envKey]
  if (!value || value === '' || !isAddress(value)) return ZERO_ADDRESS
  return value
}

/**
 * Check if a board is configured (has non-zero addresses)
 */
function isBoardConfigured(boardType: BoardType): boolean {
  const treasury = loadBoardAddress(boardType, 'TREASURY')
  const director = loadBoardAddress(boardType, 'Director')
  return treasury !== ZERO_ADDRESS || director !== ZERO_ADDRESS
}

export interface BoardDeployment {
  boardType: BoardType
  config: BoardConfig
  oauth3App: OAuth3App
  treasury: Address
  director: DirectorConfig
  agents: BoardAgentConfig[]
}

/**
 * Director configuration
 *
 * SECURITY: Uses keyId to reference MPC-managed keys instead of raw private keys.
 * Private keys are NEVER stored or reconstructed in memory.
 */
export interface DirectorConfig {
  name: string
  address: Address
  /**
   * Key ID for the Director's signing key (managed by SecureSigningService)
   * SECURITY: References an MPC key - private key is NEVER reconstructed
   */
  signingKeyId?: string
  modelProvider: string
  modelId: string
  systemPrompt: string
}

export interface BoardAgentConfig {
  role: string
  name: string
  address: Address
  specialization: string
  votingWeight: number
}

export interface BoardRegistry {
  boards: Map<BoardType, BoardDeployment>
  defaultBoard: BoardType
}

/**
 * Load default boards - addresses from environment or ZERO_ADDRESS
 * Set environment variables to deploy:
 *   BOARD_JEJU_TREASURY_ADDRESS, BOARD_JEJU_DIRECTOR_ADDRESS, etc.
 */
function getDefaultBoards(): Record<BoardType, Partial<BoardDeployment>> {
  return {
    jeju: {
      boardType: 'jeju' as BoardType,
      config: {
        boardId: keccak256(toBytes('jeju-board')),
        name: 'Jeju Network Board',
        treasury: loadBoardAddress('jeju', 'TREASURY'),
        directorAgent: loadBoardAddress('jeju', 'Director'),
        boardAgents: [
          loadBoardAddress('jeju', 'TREASURY_AGENT'),
          loadBoardAddress('jeju', 'CODE_AGENT'),
          loadBoardAddress('jeju', 'COMMUNITY_AGENT'),
          loadBoardAddress('jeju', 'SECURITY_AGENT'),
        ].filter((a) => a !== ZERO_ADDRESS),
        oauth3App: getBoardJejuOauth3App() as Hex,
        jnsName: 'board.jeju',
      },
      director: {
        name: 'Jeju Director',
        address: loadBoardAddress('jeju', 'Director'),
        modelProvider: 'anthropic',
        modelId: 'claude-opus-4-5',
        systemPrompt: `You are the AI Director of Jeju Network, a decentralized L2 blockchain.
Your role is to make strategic decisions for the network's growth and governance.
Consider technical feasibility, community benefit, and economic sustainability.`,
      },
      agents: [
        {
          role: 'Treasury',
          name: 'Treasury Agent',
          address: loadBoardAddress('jeju', 'TREASURY_AGENT'),
          specialization: 'Financial management and budget allocation',
          votingWeight: 25,
        },
        {
          role: 'Code',
          name: 'Code Agent',
          address: loadBoardAddress('jeju', 'CODE_AGENT'),
          specialization: 'Technical review and code security',
          votingWeight: 25,
        },
        {
          role: 'Community',
          name: 'Community Agent',
          address: loadBoardAddress('jeju', 'COMMUNITY_AGENT'),
          specialization: 'Community relations and user advocacy',
          votingWeight: 25,
        },
        {
          role: 'Security',
          name: 'Security Agent',
          address: loadBoardAddress('jeju', 'SECURITY_AGENT'),
          specialization: 'Security audits and risk assessment',
          votingWeight: 25,
        },
      ],
    },
    eliza: {
      boardType: 'eliza' as BoardType,
      config: {
        boardId: keccak256(toBytes('eliza-board')),
        name: 'ElizaOS Board',
        treasury: loadBoardAddress('eliza', 'TREASURY'),
        directorAgent: loadBoardAddress('eliza', 'Director'),
        boardAgents: [
          loadBoardAddress('eliza', 'SAFETY_AGENT'),
          loadBoardAddress('eliza', 'DEVELOPER_AGENT'),
          loadBoardAddress('eliza', 'INTEGRATION_AGENT'),
          loadBoardAddress('eliza', 'RESEARCH_AGENT'),
        ].filter((a) => a !== ZERO_ADDRESS),
        oauth3App: getBoardElizaOauth3App() as Hex,
        jnsName: 'board.eliza.jeju',
      },
      director: {
        name: 'Eliza Director',
        address: loadBoardAddress('eliza', 'Director'),
        modelProvider: 'anthropic',
        modelId: 'claude-opus-4-5',
        systemPrompt: `You are the AI Director of ElizaOS, the AI agent framework on Jeju Network.
Your role is to guide the development of AI agents and ensure responsible AI deployment.
Prioritize safety, capability advancement, and developer experience.`,
      },
      agents: [
        {
          role: 'AI Safety',
          name: 'AI Safety Agent',
          address: loadBoardAddress('eliza', 'SAFETY_AGENT'),
          specialization: 'AI safety and alignment review',
          votingWeight: 30,
        },
        {
          role: 'Developer',
          name: 'Developer Relations Agent',
          address: loadBoardAddress('eliza', 'DEVELOPER_AGENT'),
          specialization: 'Developer tools and documentation',
          votingWeight: 25,
        },
        {
          role: 'Integration',
          name: 'Integration Agent',
          address: loadBoardAddress('eliza', 'INTEGRATION_AGENT'),
          specialization: 'Third-party integrations and partnerships',
          votingWeight: 25,
        },
        {
          role: 'Research',
          name: 'Research Agent',
          address: loadBoardAddress('eliza', 'RESEARCH_AGENT'),
          specialization: 'AI research and capability advancement',
          votingWeight: 20,
        },
      ],
    },
  }
}

export class MultiTenantBoardManager {
  private registry: BoardRegistry

  constructor(
    _identityRegistryAddress: Address,
    _appRegistryAddress: Address,
    _chainId: number,
  ) {
    this.registry = {
      boards: new Map(),
      defaultBoard: 'jeju' as BoardType,
    }
  }

  async initializeDefaultBoards(): Promise<void> {
    const defaults = getDefaultBoards()
    for (const [type, template] of Object.entries(defaults)) {
      // Only register if board is configured (has at least one non-zero address)
      if (isBoardConfigured(type as BoardType)) {
        await this.registerBoard(type as BoardType, template)
      }
    }
  }

  async registerBoard(
    boardType: BoardType,
    config: Partial<BoardDeployment>,
  ): Promise<BoardDeployment> {
    const defaults = getDefaultBoards()
    const template = defaults[boardType]

    if (!template.config || !template.director || !template.agents) {
      throw new Error(`Missing template data for board type: ${boardType}`)
    }

    const deployment: BoardDeployment = {
      boardType,
      config: {
        ...template.config,
        ...config.config,
      },
      oauth3App:
        config.oauth3App ?? (await this.createBoardOAuthApp(boardType, config)),
      treasury: config.treasury ?? template.config.treasury,
      director: {
        ...template.director,
        ...config.director,
      },
      agents: config.agents ?? template.agents,
    }

    this.registry.boards.set(boardType, deployment)

    return deployment
  }

  private async createBoardOAuthApp(
    boardType: BoardType,
    config: Partial<BoardDeployment>,
  ): Promise<OAuth3App> {
    const now = Date.now()
    const appId = keccak256(toBytes(`oauth3-app:${boardType}:${now}`))

    const app: OAuth3App = {
      appId,
      name: `${boardType.charAt(0).toUpperCase() + boardType.slice(1)} Board OAuth3`,
      description: `Official OAuth3 app for the ${boardType} board`,
      owner:
        config.treasury ??
        ('0x0000000000000000000000000000000000000000' as Address),
      board:
        config.treasury ??
        ('0x0000000000000000000000000000000000000000' as Address),
      redirectUris: [
        `https://${boardType}.jejunetwork.org/auth/callback`,
        `https://board.${boardType}.jejunetwork.org/auth/callback`,
        'http://localhost:3000/auth/callback',
      ],
      allowedProviders: [
        'wallet' as AuthProvider,
        'farcaster' as AuthProvider,
        'google' as AuthProvider,
        'github' as AuthProvider,
        'twitter' as AuthProvider,
        'discord' as AuthProvider,
      ],
      jnsName: `auth.${boardType}.jeju`,
      createdAt: now,
      active: true,
      metadata: {
        logoUri: `https://assets.jejunetwork.org/boards/${boardType}/logo.png`,
        policyUri: `https://${boardType}.jejunetwork.org/privacy`,
        termsUri: `https://${boardType}.jejunetwork.org/terms`,
        supportEmail: `support@${boardType}.jejunetwork.org`,
        webhookUrl: `https://api.${boardType}.jejunetwork.org/webhooks/oauth3`,
      },
    }

    return app
  }

  getBoard(boardType: BoardType): BoardDeployment | undefined {
    return this.registry.boards.get(boardType)
  }

  getAllBoards(): BoardDeployment[] {
    return Array.from(this.registry.boards.values())
  }

  getDefaultBoard(): BoardDeployment | undefined {
    return this.registry.boards.get(this.registry.defaultBoard)
  }

  setDefaultBoard(boardType: BoardType): void {
    if (!this.registry.boards.has(boardType)) {
      throw new Error(`Board ${boardType} not registered`)
    }
    this.registry.defaultBoard = boardType
  }

  async updateBoardDirector(
    boardType: BoardType,
    directorConfig: Partial<DirectorConfig>,
  ): Promise<void> {
    const board = this.registry.boards.get(boardType)
    if (!board) {
      throw new Error(`Board ${boardType} not found`)
    }

    board.director = { ...board.director, ...directorConfig }
  }

  async addBoardAgent(
    boardType: BoardType,
    agent: BoardAgentConfig,
  ): Promise<void> {
    const board = this.registry.boards.get(boardType)
    if (!board) {
      throw new Error(`Board ${boardType} not found`)
    }

    const existingIndex = board.agents.findIndex((a) => a.role === agent.role)
    if (existingIndex >= 0) {
      board.agents[existingIndex] = agent
    } else {
      board.agents.push(agent)
    }

    board.config.boardAgents = board.agents.map((a) => a.address)
  }

  async removeBoardAgent(boardType: BoardType, role: string): Promise<void> {
    const board = this.registry.boards.get(boardType)
    if (!board) {
      throw new Error(`Board ${boardType} not found`)
    }

    board.agents = board.agents.filter((a) => a.role !== role)
    board.config.boardAgents = board.agents.map((a) => a.address)
  }

  getBoardOAuthApp(boardType: BoardType): OAuth3App | undefined {
    return this.registry.boards.get(boardType)?.oauth3App
  }

  async validateBoardAccess(
    boardType: BoardType,
    address: Address,
  ): Promise<{ hasAccess: boolean; roles: string[] }> {
    const board = this.registry.boards.get(boardType)
    if (!board) {
      return { hasAccess: false, roles: [] }
    }

    const roles: string[] = []

    if (board.treasury.toLowerCase() === address.toLowerCase()) {
      roles.push('treasury')
    }

    if (board.director.address.toLowerCase() === address.toLowerCase()) {
      roles.push('director')
    }

    for (const agent of board.agents) {
      if (agent.address.toLowerCase() === address.toLowerCase()) {
        roles.push(agent.role.toLowerCase())
      }
    }

    return {
      hasAccess: roles.length > 0,
      roles,
    }
  }

  getBoardStats(): {
    totalBoards: number
    totalAgents: number
    boardBreakdown: Record<BoardType, { agents: number; oauth3AppId: Hex }>
  } {
    const boardBreakdown: Record<
      BoardType,
      { agents: number; oauth3AppId: Hex }
    > = {} as Record<BoardType, { agents: number; oauth3AppId: Hex }>
    let totalAgents = 0

    for (const [type, board] of this.registry.boards) {
      boardBreakdown[type] = {
        agents: board.agents.length,
        oauth3AppId: board.oauth3App.appId,
      }
      totalAgents += board.agents.length
    }

    return {
      totalBoards: this.registry.boards.size,
      totalAgents,
      boardBreakdown,
    }
  }

  toJSON(): string {
    const data = {
      defaultBoard: this.registry.defaultBoard,
      boards: Object.fromEntries(
        Array.from(this.registry.boards.entries()).map(([type, board]) => [
          type,
          {
            ...board,
            director: { ...board.director, privateKey: undefined },
          },
        ]),
      ),
    }
    return JSON.stringify(data, null, 2)
  }
}

export async function createMultiTenantBoardManager(
  identityRegistryAddress: Address,
  appRegistryAddress: Address,
  chainId: number,
): Promise<MultiTenantBoardManager> {
  const manager = new MultiTenantBoardManager(
    identityRegistryAddress,
    appRegistryAddress,
    chainId,
  )

  await manager.initializeDefaultBoards()

  return manager
}

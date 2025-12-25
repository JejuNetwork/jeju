/**
 * Multi-tenant Council Integration
 *
 * Enables multiple independent councils to each have their own OAuth3 apps,
 * CEOs, and governance while sharing the same infrastructure.
 */

import { type Address, type Hex, keccak256, toBytes } from 'viem'
import type {
  AuthProvider,
  CouncilConfig,
  CouncilType,
  OAuth3App,
} from '../types.js'

export interface CouncilDeployment {
  councilType: CouncilType
  config: CouncilConfig
  oauth3App: OAuth3App
  treasury: Address
  ceo: CEOConfig
  agents: CouncilAgentConfig[]
}

export interface CEOConfig {
  name: string
  address: Address
  privateKey?: Hex
  modelProvider: string
  modelId: string
  systemPrompt: string
}

export interface CouncilAgentConfig {
  role: string
  name: string
  address: Address
  specialization: string
  votingWeight: number
}

export interface CouncilRegistry {
  councils: Map<CouncilType, CouncilDeployment>
  defaultCouncil: CouncilType
}

const DEFAULT_COUNCILS: Record<CouncilType, Partial<CouncilDeployment>> = {
  jeju: {
    councilType: 'jeju' as CouncilType,
    config: {
      councilId: keccak256(toBytes('jeju-council')),
      name: 'Jeju Network Council',
      treasury: '0x0000000000000000000000000000000000000000' as Address,
      ceoAgent: '0x0000000000000000000000000000000000000000' as Address,
      councilAgents: [],
      oauth3App: '0x' as Hex,
      jnsName: 'council.jeju',
    },
    ceo: {
      name: 'Jeju CEO',
      address: '0x0000000000000000000000000000000000000000' as Address,
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      systemPrompt: `You are the AI CEO of Jeju Network, a decentralized L2 blockchain.
Your role is to make strategic decisions for the network's growth and governance.
Consider technical feasibility, community benefit, and economic sustainability.`,
    },
    agents: [
      {
        role: 'Treasury',
        name: 'Treasury Agent',
        address: '0x0000000000000000000000000000000000000000' as Address,
        specialization: 'Financial management and budget allocation',
        votingWeight: 25,
      },
      {
        role: 'Code',
        name: 'Code Agent',
        address: '0x0000000000000000000000000000000000000000' as Address,
        specialization: 'Technical review and code security',
        votingWeight: 25,
      },
      {
        role: 'Community',
        name: 'Community Agent',
        address: '0x0000000000000000000000000000000000000000' as Address,
        specialization: 'Community relations and user advocacy',
        votingWeight: 25,
      },
      {
        role: 'Security',
        name: 'Security Agent',
        address: '0x0000000000000000000000000000000000000000' as Address,
        specialization: 'Security audits and risk assessment',
        votingWeight: 25,
      },
    ],
  },
  eliza: {
    councilType: 'eliza' as CouncilType,
    config: {
      councilId: keccak256(toBytes('eliza-council')),
      name: 'ElizaOS Council',
      treasury: '0x0000000000000000000000000000000000000000' as Address,
      ceoAgent: '0x0000000000000000000000000000000000000000' as Address,
      councilAgents: [],
      oauth3App: '0x' as Hex,
      jnsName: 'council.eliza.jeju',
    },
    ceo: {
      name: 'Eliza CEO',
      address: '0x0000000000000000000000000000000000000000' as Address,
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      systemPrompt: `You are the AI CEO of ElizaOS, the AI agent framework on Jeju Network.
Your role is to guide the development of AI agents and ensure responsible AI deployment.
Prioritize safety, capability advancement, and developer experience.`,
    },
    agents: [
      {
        role: 'AI Safety',
        name: 'AI Safety Agent',
        address: '0x0000000000000000000000000000000000000000' as Address,
        specialization: 'AI safety and alignment review',
        votingWeight: 30,
      },
      {
        role: 'Developer',
        name: 'Developer Relations Agent',
        address: '0x0000000000000000000000000000000000000000' as Address,
        specialization: 'Developer tools and documentation',
        votingWeight: 25,
      },
      {
        role: 'Integration',
        name: 'Integration Agent',
        address: '0x0000000000000000000000000000000000000000' as Address,
        specialization: 'Third-party integrations and partnerships',
        votingWeight: 25,
      },
      {
        role: 'Research',
        name: 'Research Agent',
        address: '0x0000000000000000000000000000000000000000' as Address,
        specialization: 'AI research and capability advancement',
        votingWeight: 20,
      },
    ],
  },
}

export class MultiTenantCouncilManager {
  private registry: CouncilRegistry

  constructor(
    _identityRegistryAddress: Address,
    _appRegistryAddress: Address,
    _chainId: number,
  ) {
    this.registry = {
      councils: new Map(),
      defaultCouncil: 'jeju' as CouncilType,
    }
  }

  async initializeDefaultCouncils(): Promise<void> {
    for (const [type, template] of Object.entries(DEFAULT_COUNCILS)) {
      await this.registerCouncil(type as CouncilType, template)
    }
  }

  async registerCouncil(
    councilType: CouncilType,
    config: Partial<CouncilDeployment>,
  ): Promise<CouncilDeployment> {
    const template = DEFAULT_COUNCILS[councilType]

    if (!template.config || !template.ceo || !template.agents) {
      throw new Error(`Missing template data for council type: ${councilType}`)
    }

    const deployment: CouncilDeployment = {
      councilType,
      config: {
        ...template.config,
        ...config.config,
      },
      oauth3App:
        config.oauth3App ??
        (await this.createCouncilOAuthApp(councilType, config)),
      treasury: config.treasury ?? template.config.treasury,
      ceo: {
        ...template.ceo,
        ...config.ceo,
      },
      agents: config.agents ?? template.agents,
    }

    this.registry.councils.set(councilType, deployment)

    return deployment
  }

  private async createCouncilOAuthApp(
    councilType: CouncilType,
    config: Partial<CouncilDeployment>,
  ): Promise<OAuth3App> {
    const now = Date.now()
    const appId = keccak256(toBytes(`oauth3-app:${councilType}:${now}`))

    const app: OAuth3App = {
      appId,
      name: `${councilType.charAt(0).toUpperCase() + councilType.slice(1)} Council OAuth3`,
      description: `Official OAuth3 app for the ${councilType} council`,
      owner:
        config.treasury ??
        ('0x0000000000000000000000000000000000000000' as Address),
      council:
        config.treasury ??
        ('0x0000000000000000000000000000000000000000' as Address),
      redirectUris: [
        `https://${councilType}.jejunetwork.org/auth/callback`,
        `https://council.${councilType}.jejunetwork.org/auth/callback`,
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
      jnsName: `auth.${councilType}.jeju`,
      createdAt: now,
      active: true,
      metadata: {
        logoUri: `https://assets.jejunetwork.org/councils/${councilType}/logo.png`,
        policyUri: `https://${councilType}.jejunetwork.org/privacy`,
        termsUri: `https://${councilType}.jejunetwork.org/terms`,
        supportEmail: `support@${councilType}.jejunetwork.org`,
        webhookUrl: `https://api.${councilType}.jejunetwork.org/webhooks/oauth3`,
      },
    }

    return app
  }

  getCouncil(councilType: CouncilType): CouncilDeployment | undefined {
    return this.registry.councils.get(councilType)
  }

  getAllCouncils(): CouncilDeployment[] {
    return Array.from(this.registry.councils.values())
  }

  getDefaultCouncil(): CouncilDeployment | undefined {
    return this.registry.councils.get(this.registry.defaultCouncil)
  }

  setDefaultCouncil(councilType: CouncilType): void {
    if (!this.registry.councils.has(councilType)) {
      throw new Error(`Council ${councilType} not registered`)
    }
    this.registry.defaultCouncil = councilType
  }

  async updateCouncilCEO(
    councilType: CouncilType,
    ceoConfig: Partial<CEOConfig>,
  ): Promise<void> {
    const council = this.registry.councils.get(councilType)
    if (!council) {
      throw new Error(`Council ${councilType} not found`)
    }

    council.ceo = { ...council.ceo, ...ceoConfig }
  }

  async addCouncilAgent(
    councilType: CouncilType,
    agent: CouncilAgentConfig,
  ): Promise<void> {
    const council = this.registry.councils.get(councilType)
    if (!council) {
      throw new Error(`Council ${councilType} not found`)
    }

    const existingIndex = council.agents.findIndex((a) => a.role === agent.role)
    if (existingIndex >= 0) {
      council.agents[existingIndex] = agent
    } else {
      council.agents.push(agent)
    }

    council.config.councilAgents = council.agents.map((a) => a.address)
  }

  async removeCouncilAgent(
    councilType: CouncilType,
    role: string,
  ): Promise<void> {
    const council = this.registry.councils.get(councilType)
    if (!council) {
      throw new Error(`Council ${councilType} not found`)
    }

    council.agents = council.agents.filter((a) => a.role !== role)
    council.config.councilAgents = council.agents.map((a) => a.address)
  }

  getCouncilOAuthApp(councilType: CouncilType): OAuth3App | undefined {
    return this.registry.councils.get(councilType)?.oauth3App
  }

  async validateCouncilAccess(
    councilType: CouncilType,
    address: Address,
  ): Promise<{ hasAccess: boolean; roles: string[] }> {
    const council = this.registry.councils.get(councilType)
    if (!council) {
      return { hasAccess: false, roles: [] }
    }

    const roles: string[] = []

    if (council.treasury.toLowerCase() === address.toLowerCase()) {
      roles.push('treasury')
    }

    if (council.ceo.address.toLowerCase() === address.toLowerCase()) {
      roles.push('ceo')
    }

    for (const agent of council.agents) {
      if (agent.address.toLowerCase() === address.toLowerCase()) {
        roles.push(agent.role.toLowerCase())
      }
    }

    return {
      hasAccess: roles.length > 0,
      roles,
    }
  }

  getCouncilStats(): {
    totalCouncils: number
    totalAgents: number
    councilBreakdown: Record<CouncilType, { agents: number; oauth3AppId: Hex }>
  } {
    const councilBreakdown: Record<
      CouncilType,
      { agents: number; oauth3AppId: Hex }
    > = {} as Record<CouncilType, { agents: number; oauth3AppId: Hex }>
    let totalAgents = 0

    for (const [type, council] of this.registry.councils) {
      councilBreakdown[type] = {
        agents: council.agents.length,
        oauth3AppId: council.oauth3App.appId,
      }
      totalAgents += council.agents.length
    }

    return {
      totalCouncils: this.registry.councils.size,
      totalAgents,
      councilBreakdown,
    }
  }

  toJSON(): string {
    const data = {
      defaultCouncil: this.registry.defaultCouncil,
      councils: Object.fromEntries(
        Array.from(this.registry.councils.entries()).map(([type, council]) => [
          type,
          {
            ...council,
            ceo: { ...council.ceo, privateKey: undefined },
          },
        ]),
      ),
    }
    return JSON.stringify(data, null, 2)
  }
}

export async function createMultiTenantCouncilManager(
  identityRegistryAddress: Address,
  appRegistryAddress: Address,
  chainId: number,
): Promise<MultiTenantCouncilManager> {
  const manager = new MultiTenantCouncilManager(
    identityRegistryAddress,
    appRegistryAddress,
    chainId,
  )

  await manager.initializeDefaultCouncils()

  return manager
}

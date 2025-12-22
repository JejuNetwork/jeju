/**
 * Autocrat MCP Server
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { AutocratBlockchain } from './blockchain'
import {
  expect,
  expectDefined,
  HexStringSchema,
  MCPResourceReadRequestSchema,
  MCPToolCallRequestSchema,
  ProposalIdSchema,
  validateOrThrow,
} from './schemas'
import {
  assessAlignment,
  assessClarity,
  assessCompleteness,
  assessCostBenefit,
  assessFeasibility,
  assessImpact,
  assessRisk,
  calculateQualityScore,
  PROPOSAL_STATUS,
  PROPOSAL_TYPES,
  ZERO_ADDRESS,
} from './shared'
import type { AutocratConfig } from './types'

interface MCPResource {
  uri: string
  name: string
  description: string
  mimeType: string
}
interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: string
    properties?: Record<
      string,
      { type: string; description?: string; enum?: readonly string[] }
    >
    required?: string[]
  }
}

export class AutocratMCPServer {
  private readonly app: Hono
  private readonly blockchain: AutocratBlockchain
  private readonly config: AutocratConfig

  constructor(config: AutocratConfig, blockchain: AutocratBlockchain) {
    this.config = config
    this.blockchain = blockchain
    this.app = new Hono()
    this.setupRoutes()
  }

  private getResources(): MCPResource[] {
    return [
      {
        uri: 'autocrat://proposals/active',
        name: 'Active Proposals',
        description: 'Current proposals',
        mimeType: 'application/json',
      },
      {
        uri: 'autocrat://proposals/all',
        name: 'All Proposals',
        description: 'Proposal history',
        mimeType: 'application/json',
      },
      {
        uri: 'autocrat://ceo/status',
        name: 'CEO Status',
        description: 'CEO model and stats',
        mimeType: 'application/json',
      },
      {
        uri: 'autocrat://governance/stats',
        name: 'Governance Stats',
        description: 'DAO statistics',
        mimeType: 'application/json',
      },
      {
        uri: 'autocrat://autocrat/agents',
        name: 'Autocrat Agents',
        description: 'Autocrat roles',
        mimeType: 'application/json',
      },
    ]
  }

  private getTools(): MCPTool[] {
    return [
      {
        name: 'assess_proposal_quality',
        description: 'Assess proposal quality',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            summary: { type: 'string' },
            description: { type: 'string' },
            proposalType: { type: 'string', enum: PROPOSAL_TYPES },
          },
          required: ['title', 'summary', 'description', 'proposalType'],
        },
      },
      {
        name: 'get_proposal',
        description: 'Get proposal details',
        inputSchema: {
          type: 'object',
          properties: { proposalId: { type: 'string' } },
          required: ['proposalId'],
        },
      },
      {
        name: 'list_proposals',
        description: 'List proposals',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: PROPOSAL_STATUS },
            type: { type: 'string', enum: PROPOSAL_TYPES },
            limit: { type: 'string' },
          },
        },
      },
      {
        name: 'get_council_votes',
        description: 'Get council votes',
        inputSchema: {
          type: 'object',
          properties: { proposalId: { type: 'string' } },
          required: ['proposalId'],
        },
      },
      {
        name: 'get_ceo_decision',
        description: 'Get CEO decision',
        inputSchema: {
          type: 'object',
          properties: { proposalId: { type: 'string' } },
          required: ['proposalId'],
        },
      },
      {
        name: 'prepare_proposal_submission',
        description: 'Prepare submission tx',
        inputSchema: {
          type: 'object',
          properties: {
            proposalType: { type: 'string', enum: PROPOSAL_TYPES },
            qualityScore: { type: 'string' },
            contentHash: { type: 'string' },
            targetContract: { type: 'string' },
            callData: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['proposalType', 'qualityScore', 'contentHash'],
        },
      },
      {
        name: 'request_deep_research',
        description: 'Request research (requires Ollama)',
        inputSchema: {
          type: 'object',
          properties: { proposalId: { type: 'string' } },
          required: ['proposalId'],
        },
      },
      {
        name: 'check_veto_status',
        description: 'Check veto status',
        inputSchema: {
          type: 'object',
          properties: { proposalId: { type: 'string' } },
          required: ['proposalId'],
        },
      },
    ]
  }

  private setupRoutes(): void {
    this.app.get('/', (c) =>
      c.json({
        server: 'jeju-council',
        version: '1.0.0',
        protocolVersion: '2024-11-05',
        resources: this.getResources(),
        tools: this.getTools(),
      }),
    )
    this.app.post('/initialize', (c) =>
      c.json({
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'jeju-council', version: '1.0.0' },
        capabilities: { resources: true, tools: true, prompts: false },
      }),
    )
    this.app.post('/resources/list', (c) =>
      c.json({ resources: this.getResources() }),
    )
    this.app.post('/resources/read', async (c) => {
      const body = validateOrThrow(
        MCPResourceReadRequestSchema,
        await c.req.json(),
        'MCP resource read request',
      )
      const uri = body.uri
      const contents = await this.readResource(uri)
      expect(contents !== null, `Resource not found: ${uri}`)
      return c.json({
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(contents, null, 2),
          },
        ],
      })
    })
    this.app.post('/tools/list', (c) => c.json({ tools: this.getTools() }))
    this.app.post('/tools/call', async (c) => {
      const body = validateOrThrow(
        MCPToolCallRequestSchema,
        await c.req.json(),
        'MCP tool call request',
      )
      const name = body.name
      const args = body.arguments ?? {}
      const { result, isError } = await this.callTool(name, args)
      return c.json({
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError,
      })
    })
    this.app.get('/health', (c) =>
      c.json({
        status: 'ok',
        server: 'council-mcp',
        version: '1.0.0',
        contracts: {
          council: this.blockchain.councilDeployed,
          ceoAgent: this.blockchain.ceoDeployed,
        },
      }),
    )
  }

  private async readResource(
    uri: string,
  ): Promise<Record<string, unknown> | null> {
    switch (uri) {
      case 'autocrat://proposals/active':
        return this.blockchain.listProposals(true, 50)
      case 'autocrat://proposals/all':
        return this.blockchain.listProposals(false, 100)
      case 'autocrat://ceo/status':
        return this.blockchain.getCEOStatus()
      case 'autocrat://governance/stats':
        return this.blockchain.getGovernanceStats()
      case 'autocrat://autocrat/agents':
        return this.blockchain.getAutocratStatus()
      default:
        return null
    }
  }

  private async callTool(
    name: string,
    args: Record<string, string>,
  ): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    switch (name) {
      case 'assess_proposal_quality':
        return { result: this.assessQuality(args), isError: false }
      case 'get_proposal':
        return this.getProposal(args.proposalId)
      case 'list_proposals':
        return this.listProposals(args)
      case 'get_council_votes':
        return this.getAutocratVotes(args.proposalId)
      case 'get_ceo_decision':
        return this.getCEODecision(args.proposalId)
      case 'prepare_proposal_submission':
        return { result: this.prepareSubmission(args), isError: false }
      case 'request_deep_research':
        return { result: this.requestResearch(args.proposalId), isError: false }
      case 'check_veto_status':
        return this.checkVetoStatus(args.proposalId)
      default:
        return { result: { error: 'Tool not found' }, isError: true }
    }
  }

  private assessQuality(args: Record<string, string>): Record<string, unknown> {
    expectDefined(args.title, 'Title is required')
    expectDefined(args.summary, 'Summary is required')
    expectDefined(args.description, 'Description is required')
    const { title, summary, description } = args
    const criteria = {
      clarity: assessClarity(title, summary, description),
      completeness: assessCompleteness(description),
      feasibility: assessFeasibility(description),
      alignment: assessAlignment(description),
      impact: assessImpact(description),
      riskAssessment: assessRisk(description),
      costBenefit: assessCostBenefit(description),
    }
    const score = calculateQualityScore(criteria)
    const feedback: string[] = []
    if (criteria.clarity < 70) feedback.push('Improve clarity')
    if (criteria.completeness < 70) feedback.push('Add details')
    if (criteria.alignment < 70) feedback.push('Align with values')
    if (criteria.riskAssessment < 60) feedback.push('Add risks')
    return {
      overallScore: score,
      criteria,
      feedback,
      readyToSubmit: score >= 90,
      assessedBy: 'heuristic',
      warning: 'Use AI assessment for accurate scoring',
    }
  }

  private async getProposal(
    proposalId: string,
  ): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    const validated = validateOrThrow(
      ProposalIdSchema,
      proposalId,
      'Proposal ID',
    )
    const result = await this.blockchain.getProposal(validated)
    expect(result !== null, 'Contract not deployed')
    expect(result.proposal.createdAt !== 0n, 'Proposal not found')
    return {
      result: this.blockchain.formatProposal(result.proposal),
      isError: false,
    }
  }

  private async listProposals(
    args: Record<string, string>,
  ): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    const limit = args.limit ? parseInt(args.limit, 10) : 20
    expect(!Number.isNaN(limit), `Invalid limit: ${args.limit}`)
    expect(
      limit > 0 && limit <= 1000,
      `Limit must be between 1 and 1000, got ${limit}`,
    )
    const result = await this.blockchain.listProposals(true, limit)
    let proposals = result.proposals
    if (args.status) {
      expect(
        PROPOSAL_STATUS.includes(
          args.status as (typeof PROPOSAL_STATUS)[number],
        ),
        `Invalid status: ${args.status}`,
      )
      proposals = proposals.filter((p) => p.status === args.status)
    }
    if (args.type) {
      expect(
        PROPOSAL_TYPES.includes(args.type as (typeof PROPOSAL_TYPES)[number]),
        `Invalid type: ${args.type}`,
      )
      proposals = proposals.filter((p) => p.type === args.type)
    }
    return { result: { proposals }, isError: false }
  }

  private async getAutocratVotes(
    proposalId: string,
  ): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    const validated = validateOrThrow(
      ProposalIdSchema,
      proposalId,
      'Proposal ID',
    )
    const result = await this.blockchain.getProposal(validated)
    if (!result)
      return {
        result: { error: 'Contract not deployed', votes: [] },
        isError: false,
      }
    return {
      result: {
        proposalId: validated,
        votes: this.blockchain.formatVotes(result.votes),
      },
      isError: false,
    }
  }

  private async getCEODecision(
    proposalId: string,
  ): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    const validated = validateOrThrow(
      ProposalIdSchema,
      proposalId,
      'Proposal ID',
    )
    const result = await this.blockchain.getDecision(validated)
    if (!result.decided)
      return {
        result: { decided: false, proposalId: validated },
        isError: false,
      }
    expect(
      result.decision !== null && result.decision !== undefined,
      'Decision data missing',
    )
    return { result: { decided: true, ...result.decision }, isError: false }
  }

  private prepareSubmission(
    args: Record<string, string>,
  ): Record<string, unknown> {
    expectDefined(args.proposalType, 'Proposal type is required')
    expectDefined(args.qualityScore, 'Quality score is required')
    expectDefined(args.contentHash, 'Content hash is required')

    const typeIndex = PROPOSAL_TYPES.indexOf(
      args.proposalType as (typeof PROPOSAL_TYPES)[number],
    )
    expect(typeIndex !== -1, `Invalid proposal type: ${args.proposalType}`)

    const qualityScore = parseInt(args.qualityScore, 10)
    expect(
      !Number.isNaN(qualityScore),
      `Invalid quality score: ${args.qualityScore}`,
    )
    expect(
      qualityScore >= 0 && qualityScore <= 100,
      `Quality score must be 0-100, got ${qualityScore}`,
    )

    const contentHash = validateOrThrow(
      HexStringSchema,
      args.contentHash,
      'Content hash',
    )
    const targetContract = args.targetContract
      ? validateOrThrow(
          z.string().regex(/^0x[a-fA-F0-9]{40}$/),
          args.targetContract,
          'Target contract',
        )
      : ZERO_ADDRESS
    const callData = args.callData
      ? validateOrThrow(HexStringSchema, args.callData, 'Call data')
      : '0x'

    return {
      transaction: {
        to: this.config.contracts?.council ?? ZERO_ADDRESS,
        method: 'submitProposal',
        params: {
          proposalType: typeIndex,
          qualityScore,
          contentHash,
          targetContract,
          callData,
          value: args.value || '0',
        },
        bond: '0.001 ETH',
      },
    }
  }

  private requestResearch(proposalId: string): Record<string, unknown> {
    const validated = validateOrThrow(
      ProposalIdSchema,
      proposalId,
      'Proposal ID',
    )
    return {
      proposalId: validated,
      service: 'deep-research',
      model: 'ollama',
      note: 'Research requires Ollama to be running',
    }
  }

  private async checkVetoStatus(
    proposalId: string,
  ): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    const validated = validateOrThrow(
      ProposalIdSchema,
      proposalId,
      'Proposal ID',
    )
    const result = await this.blockchain.getProposal(validated)
    expect(result !== null, 'Contract not deployed')
    expect(result.proposal.status === 5, 'Proposal not in APPROVED status')
    const gracePeriodEnd = Number(result.proposal.gracePeriodEnd)
    expect(!Number.isNaN(gracePeriodEnd), 'Invalid grace period end')
    const now = Math.floor(Date.now() / 1000)
    return {
      result: {
        proposalId: validated,
        inGracePeriod: now < gracePeriodEnd,
        gracePeriodEnds: new Date(gracePeriodEnd * 1000).toISOString(),
        timeRemaining: `${Math.max(0, gracePeriodEnd - now)} seconds`,
      },
      isError: false,
    }
  }

  getRouter(): Hono {
    return this.app
  }
}

export function createAutocratMCPServer(
  config: AutocratConfig,
  blockchain: AutocratBlockchain,
): AutocratMCPServer {
  return new AutocratMCPServer(config, blockchain)
}

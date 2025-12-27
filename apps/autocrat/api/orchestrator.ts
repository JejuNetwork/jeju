/**
 * Autocrat Orchestrator - Multi-tenant DAO proposal lifecycle management
 */

import { ZERO_ADDRESS } from '@jejunetwork/types'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
  stringToHex,
  type Transport,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import {
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from 'viem/actions'
import { base, baseSepolia, localhost } from 'viem/chains'
import { type CEOPersona, toHex } from '../lib'
import type { DAOFull, FundingProject } from '../lib/types'
import { config } from './config'
import type { AutocratBlockchain } from './blockchain'
import { createDAOService, type DAOService } from './dao-service'

// Config type for orchestrator - accepts CouncilConfig or minimal config
export interface AutocratConfig {
  rpcUrl: string
  chainId?: number
  daoRegistry?: Address
  daoFunding?: Address
  contracts?: {
    daoRegistry: Address
    daoFunding: Address
    [key: string]: Address
  }
}

function inferChain(rpcUrl: string) {
  if (rpcUrl.includes('mainnet') || rpcUrl.includes('base.org')) return base
  if (rpcUrl.includes('sepolia')) return baseSepolia
  return localhost
}

import type { AutocratVoteFromContract, ProposalFromContract } from '../lib'
import {
  autocratAgentRuntime,
  type DeliberationRequest,
} from './agents/runtime'
import { initLocalServices, store, storeVote } from './local-services'
import { getResearchAgent, type ResearchRequest } from './research-agent'
import { makeTEEDecision } from './tee'

// Use JSON ABI format to avoid abitype parsing issues with complex tuples
const COUNCIL_WRITE_ABI = [
  {
    name: 'getActiveProposals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32[]', name: '' }],
  },
  {
    name: 'getProposal',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32', name: 'proposalId' }],
    outputs: [
      {
        type: 'tuple',
        name: '',
        components: [
          { type: 'bytes32', name: 'proposalId' },
          { type: 'address', name: 'proposer' },
          { type: 'uint256', name: 'proposerAgentId' },
          { type: 'uint8', name: 'proposalType' },
          { type: 'uint8', name: 'status' },
          { type: 'uint8', name: 'qualityScore' },
          { type: 'uint256', name: 'createdAt' },
          { type: 'uint256', name: 'autocratVoteEnd' },
          { type: 'uint256', name: 'gracePeriodEnd' },
          { type: 'bytes32', name: 'contentHash' },
          { type: 'address', name: 'targetContract' },
          { type: 'bytes', name: 'callData' },
          { type: 'uint256', name: 'value' },
          { type: 'uint256', name: 'totalStaked' },
          { type: 'uint256', name: 'totalReputation' },
          { type: 'uint256', name: 'backerCount' },
          { type: 'bool', name: 'hasResearch' },
          { type: 'bytes32', name: 'researchHash' },
          { type: 'bool', name: 'ceoApproved' },
          { type: 'bytes32', name: 'ceoDecisionHash' },
        ],
      },
    ],
  },
  {
    name: 'getAutocratVotes',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32', name: 'proposalId' }],
    outputs: [
      {
        type: 'tuple[]',
        name: '',
        components: [
          { type: 'bytes32', name: 'proposalId' },
          { type: 'address', name: 'councilAgent' },
          { type: 'uint8', name: 'role' },
          { type: 'uint8', name: 'vote' },
          { type: 'bytes32', name: 'reasoningHash' },
          { type: 'uint256', name: 'votedAt' },
          { type: 'uint256', name: 'weight' },
        ],
      },
    ],
  },
  {
    name: 'castAutocratVote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'bytes32', name: 'proposalId' },
      { type: 'uint8', name: 'vote' },
      { type: 'bytes32', name: 'reasoningHash' },
    ],
    outputs: [],
  },
  {
    name: 'finalizeAutocratVote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32', name: 'proposalId' }],
    outputs: [],
  },
  {
    name: 'recordResearch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'bytes32', name: 'proposalId' },
      { type: 'bytes32', name: 'researchHash' },
    ],
    outputs: [],
  },
  {
    name: 'advanceToCEO',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32', name: 'proposalId' }],
    outputs: [],
  },
  {
    name: 'executeProposal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32', name: 'proposalId' }],
    outputs: [],
  },
] as const

const CEO_WRITE_ABI = parseAbi([
  'function recordDecision(bytes32 proposalId, bool approved, bytes32 decisionHash, bytes32 encryptedHash, uint256 confidenceScore, uint256 alignmentScore) external',
])
const STATUS = {
  SUBMITTED: 0,
  AUTOCRAT_REVIEW: 1,
  RESEARCH_PENDING: 2,
  AUTOCRAT_FINAL: 3,
  CEO_QUEUE: 4,
  APPROVED: 5,
  EXECUTING: 6,
  COMPLETED: 7,
  REJECTED: 8,
} as const
interface DAOState {
  daoId: string
  daoFull: DAOFull
  councilAddress: Address
  ceoAgentAddress: Address
  lastProcessed: number
  processedCount: number
  errors: string[]
  isActive: boolean
}

export interface OrchestratorStatus {
  running: boolean
  cycleCount: number
  lastCycle: number
  operator: string | null
  daoCount: number
  totalProcessed: number
  daoStates: Record<string, DAOStateStatus>
  errors: string[]
}

export interface DAOStateStatus {
  daoId: string
  name: string
  displayName: string
  isActive: boolean
  lastProcessed: number
  processedCount: number
  ceoName: string
  errors: string[]
}
export class AutocratOrchestrator {
  private readonly config: AutocratConfig
  private readonly client: PublicClient<Transport, Chain>
  private readonly walletClient: WalletClient<Transport, Chain>
  private daoService: DAOService | null = null
  private account: PrivateKeyAccount | null = null
  private daoStates: Map<string, DAOState> = new Map()
  private running = false
  private cycleCount = 0
  private lastCycle = 0
  private totalProcessed = 0
  private errors: string[] = []
  private pollInterval = 30_000
  private fundingCheckInterval = 3600_000 // 1 hour
  private lastFundingCheck = 0

  constructor(config: AutocratConfig, _blockchain: AutocratBlockchain) {
    this.config = config
    const chain = inferChain(config.rpcUrl)
    // Type assertion needed because createPublicClient returns a more specific type based on
    // the chain parameter. The standalone actions from viem/actions work with any compatible client.
    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient<Transport, Chain>
    this.walletClient = createWalletClient({
      chain,
      transport: http(config.rpcUrl),
    }) as WalletClient<Transport, Chain>
  }

  private inferChainId(rpcUrl: string): number {
    if (rpcUrl.includes('8453')) return 8453
    if (rpcUrl.includes('84532')) return 84532
    return 31337
  }
  async start(): Promise<void> {
    if (this.running) return

    await initLocalServices()
    await autocratAgentRuntime.initialize()

    const operatorKey = config.operatorKey ?? config.privateKey
    if (operatorKey) {
      this.account = privateKeyToAccount(toHex(operatorKey))
    }

    // Initialize DAO service - handle both config styles
    const daoRegistryAddr =
      this.config.daoRegistry ??
      this.config.contracts?.daoRegistry ??
      ZERO_ADDRESS
    const daoFundingAddr =
      this.config.daoFunding ??
      this.config.contracts?.daoFunding ??
      ZERO_ADDRESS
    const chainId = this.config.chainId ?? this.inferChainId(this.config.rpcUrl)

    this.daoService = createDAOService({
      rpcUrl: this.config.rpcUrl,
      chainId,
      daoRegistryAddress: daoRegistryAddr,
      daoFundingAddress: daoFundingAddr,
      privateKey: operatorKey,
    })

    // Load all active DAOs
    await this.loadDAOs()

    this.running = true
    this.runLoop()
  }

  async stop(): Promise<void> {
    this.running = false
  }
  private async runLoop(): Promise<void> {
    while (this.running) {
      this.cycleCount++
      this.lastCycle = Date.now()

      try {
        await this.processCycle()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[Orchestrator] Cycle ${this.cycleCount}:`, msg)
        this.errors.push(`${this.cycleCount}: ${msg}`)
        if (this.errors.length > 100) this.errors.shift()
      }

      await new Promise((r) => setTimeout(r, this.pollInterval))
    }
  }

  private async processCycle(): Promise<void> {
    // Refresh DAO list periodically
    if (this.cycleCount % 10 === 0) {
      await this.loadDAOs()
    }

    // Process each active DAO
    const daoPromises = Array.from(this.daoStates.values())
      .filter((state) => state.isActive)
      .map((state) => this.processDAO(state))

    await Promise.all(daoPromises)

    // Check funding epochs
    if (Date.now() - this.lastFundingCheck > this.fundingCheckInterval) {
      await this.processFundingEpochs()
      this.lastFundingCheck = Date.now()
    }
  }
  private async loadDAOs(): Promise<void> {
    if (!this.daoService) return

    const daoIds = await this.daoService.getActiveDAOs()

    for (const daoId of daoIds) {
      if (this.daoStates.has(daoId)) continue

      const daoFull = await this.daoService.getDAOFull(daoId)
      if (
        !daoFull.dao.council ||
        daoFull.dao.council === '0x0000000000000000000000000000000000000000'
      ) {
        continue
      }

      this.daoStates.set(daoId, {
        daoId,
        daoFull,
        councilAddress: daoFull.dao.council,
        ceoAgentAddress: daoFull.dao.ceoAgent,
        lastProcessed: 0,
        processedCount: 0,
        errors: [],
        isActive: true,
      })
    }

    // Deactivate removed DAOs
    for (const [daoId, state] of this.daoStates) {
      if (!daoIds.includes(daoId)) {
        state.isActive = false
      }
    }
  }

  private async processDAO(state: DAOState): Promise<void> {
    const { councilAddress } = state

    try {
      const activeIds = (await readContract(this.client, {
        address: councilAddress,
        abi: COUNCIL_WRITE_ABI,
        functionName: 'getActiveProposals',
      })) as readonly `0x${string}`[]

      if (activeIds.length === 0) return

      for (const proposalId of activeIds.slice(0, 5)) {
        const proposal = (await readContract(this.client, {
          address: councilAddress,
          abi: COUNCIL_WRITE_ABI,
          functionName: 'getProposal',
          args: [proposalId],
        })) as ProposalFromContract

        await this.processProposal(state, proposalId, proposal)
        state.processedCount++
        this.totalProcessed++
      }

      state.lastProcessed = Date.now()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      state.errors.push(`${this.cycleCount}: ${msg}`)
      if (state.errors.length > 20) state.errors.shift()
    }
  }
  private async processProposal(
    state: DAOState,
    proposalId: string,
    proposal: ProposalFromContract,
  ): Promise<void> {
    switch (proposal.status) {
      case STATUS.SUBMITTED:
        break

      case STATUS.AUTOCRAT_REVIEW:
        await this.processCouncilReview(state, proposalId, proposal)
        break

      case STATUS.RESEARCH_PENDING:
        await this.processResearch(state, proposalId, proposal)
        break

      case STATUS.AUTOCRAT_FINAL:
        await this.processFinalReview(state, proposalId, proposal)
        break

      case STATUS.CEO_QUEUE:
        await this.processCEODecision(state, proposalId, proposal)
        break

      case STATUS.APPROVED:
        await this.processApproved(state, proposalId, proposal)
        break
    }
  }

  private async processCouncilReview(
    state: DAOState,
    proposalId: string,
    proposal: ProposalFromContract,
  ): Promise<void> {
    const { councilAddress } = state

    const votes = (await readContract(this.client, {
      address: councilAddress,
      abi: COUNCIL_WRITE_ABI,
      functionName: 'getAutocratVotes',
      args: [toHex(proposalId)],
    })) as AutocratVoteFromContract[]

    const shortId = proposalId.slice(0, 10)

    if (votes.length < 5) {
      const request: DeliberationRequest = {
        proposalId,
        title: `Proposal ${shortId}`,
        summary: `Type: ${proposal.proposalType}, Quality: ${proposal.qualityScore}`,
        description: proposal.contentHash ?? 'No description',
        proposalType: String(proposal.proposalType),
        submitter: proposal.proposer,
        daoId: state.daoId,
        daoName: state.daoFull.dao.displayName,
        governanceParams: state.daoFull.params,
      }

      const agentVotes = await autocratAgentRuntime.deliberateAll(request)

      for (const vote of agentVotes) {
        await storeVote(proposalId, {
          role: vote.role,
          vote: vote.vote,
          reasoning: vote.reasoning,
          confidence: vote.confidence,
          daoId: state.daoId,
        })

        if (this.account) {
          const reasoningHash = await store({
            type: 'autocrat_vote_detail',
            proposalId,
            daoId: state.daoId,
            agent: vote.agentId,
            role: vote.role,
            vote: vote.vote,
            reasoning: vote.reasoning,
            confidence: vote.confidence,
          })

          const voteValue =
            { APPROVE: 0, REJECT: 1, ABSTAIN: 2 }[vote.vote] ?? 2

          const hash = await writeContract(this.walletClient, {
            address: councilAddress,
            abi: COUNCIL_WRITE_ABI,
            functionName: 'castAutocratVote',
            args: [
              toHex(proposalId),
              voteValue,
              keccak256(stringToHex(reasoningHash)),
            ],
            account: this.account,
            chain: inferChain(this.config.rpcUrl),
          })
          await waitForTransactionReceipt(this.client, { hash })
        }
      }
    }

    const now = Math.floor(Date.now() / 1000)
    if (now >= Number(proposal.autocratVoteEnd) && this.account) {
      const hash = await writeContract(this.walletClient, {
        address: councilAddress,
        abi: COUNCIL_WRITE_ABI,
        functionName: 'finalizeAutocratVote',
        args: [toHex(proposalId)],
        account: this.account,
        chain: inferChain(this.config.rpcUrl),
      })
      await waitForTransactionReceipt(this.client, { hash })
    }
  }

  private async processResearch(
    state: DAOState,
    proposalId: string,
    proposal: ProposalFromContract,
  ): Promise<void> {
    const { councilAddress, daoFull } = state

    if (proposal.hasResearch) return

    const researchAgent = getResearchAgent()
    const researchRequest: ResearchRequest = {
      proposalId,
      title: `Proposal ${proposalId.slice(0, 10)}`,
      description: `${proposal.contentHash ?? 'No description'}\n\nType: ${proposal.proposalType}, Quality: ${proposal.qualityScore}`,
      proposalType: String(proposal.proposalType),
      depth: 'standard',
      daoId: state.daoId,
      daoName: daoFull.dao.displayName,
    }

    const report = await researchAgent.conductResearch(researchRequest)

    if (this.account) {
      const hash = await writeContract(this.walletClient, {
        address: councilAddress,
        abi: COUNCIL_WRITE_ABI,
        functionName: 'recordResearch',
        args: [toHex(proposalId), keccak256(stringToHex(report.requestHash))],
        account: this.account,
        chain: inferChain(this.config.rpcUrl),
      })
      await waitForTransactionReceipt(this.client, { hash })
    }
  }

  private async processFinalReview(
    state: DAOState,
    proposalId: string,
    proposal: ProposalFromContract,
  ): Promise<void> {
    const { councilAddress } = state
    const now = Math.floor(Date.now() / 1000)

    if (now < Number(proposal.autocratVoteEnd)) return

    if (this.account) {
      const hash = await writeContract(this.walletClient, {
        address: councilAddress,
        abi: COUNCIL_WRITE_ABI,
        functionName: 'advanceToCEO',
        args: [toHex(proposalId)],
        account: this.account,
        chain: inferChain(this.config.rpcUrl),
      })
      await waitForTransactionReceipt(this.client, { hash })
    }
  }

  private async processCEODecision(
    state: DAOState,
    proposalId: string,
    proposal: ProposalFromContract,
  ): Promise<void> {
    const { councilAddress, daoFull } = state
    const persona = daoFull.ceoPersona

    const votes = (await readContract(this.client, {
      address: councilAddress,
      abi: COUNCIL_WRITE_ABI,
      functionName: 'getAutocratVotes',
      args: [toHex(proposalId)],
    })) as AutocratVoteFromContract[]

    const formattedVotes = votes.map((v) => ({
      role:
        ['Treasury', 'Code', 'Community', 'Security', 'Legal'][v.role] ??
        'Unknown',
      vote: (['APPROVE', 'REJECT', 'ABSTAIN', 'REQUEST_CHANGES'][v.vote] ??
        'ABSTAIN') as 'APPROVE' | 'REJECT' | 'ABSTAIN',
      reasoning: v.reasoningHash,
      agentId:
        ['Treasury', 'Code', 'Community', 'Security', 'Legal'][
          v.role
        ].toLowerCase() ?? 'unknown',
      confidence: 75,
      timestamp: Date.now(),
    }))

    // Get CEO analysis with persona context
    const ceoDecision = await autocratAgentRuntime.ceoDecision({
      proposalId,
      daoId: state.daoId,
      persona,
      autocratVotes: formattedVotes,
      researchReport: proposal.hasResearch ? proposal.researchHash : undefined,
    })

    // Make TEE-secured decision
    const teeDecision = await makeTEEDecision({
      proposalId,
      daoId: state.daoId,
      persona,
      autocratVotes: formattedVotes.map((v) => ({
        role: v.role,
        vote: v.vote,
        reasoning: v.reasoning,
      })),
      researchReport: proposal.hasResearch ? proposal.researchHash : undefined,
    })

    // Generate persona-styled response
    const personaResponse = this.generatePersonaResponse(
      persona,
      teeDecision.approved,
      teeDecision.publicReasoning,
      daoFull.dao.displayName,
    )

    const decisionHash = await store({
      type: 'ceo_decision_detail',
      proposalId,
      daoId: state.daoId,
      ceoAnalysis: ceoDecision,
      teeDecision: {
        approved: teeDecision.approved,
        publicReasoning: teeDecision.publicReasoning,
        confidenceScore: teeDecision.confidenceScore,
        alignmentScore: teeDecision.alignmentScore,
        recommendations: teeDecision.recommendations,
        encryptedHash: teeDecision.encryptedHash,
        attestation: teeDecision.attestation,
      },
      personaResponse,
      decidedAt: Date.now(),
    })

    if (
      this.account &&
      state.ceoAgentAddress &&
      state.ceoAgentAddress !== '0x0000000000000000000000000000000000000000'
    ) {
      const hash = await writeContract(this.walletClient, {
        address: state.ceoAgentAddress,
        abi: CEO_WRITE_ABI,
        functionName: 'recordDecision',
        args: [
          toHex(proposalId),
          teeDecision.approved,
          keccak256(stringToHex(decisionHash)),
          toHex(teeDecision.encryptedHash),
          BigInt(teeDecision.confidenceScore),
          BigInt(teeDecision.alignmentScore),
        ],
        account: this.account,
        chain: inferChain(this.config.rpcUrl),
      })
      await waitForTransactionReceipt(this.client, { hash })
    }
  }

  private async processApproved(
    state: DAOState,
    proposalId: string,
    proposal: ProposalFromContract,
  ): Promise<void> {
    const { councilAddress } = state
    const now = Math.floor(Date.now() / 1000)
    const gracePeriodEnd = Number(proposal.gracePeriodEnd)

    if (now < gracePeriodEnd) {
      return
    }

    if (this.account) {
      const hash = await writeContract(this.walletClient, {
        address: councilAddress,
        abi: COUNCIL_WRITE_ABI,
        functionName: 'executeProposal',
        args: [toHex(proposalId)],
        account: this.account,
        chain: inferChain(this.config.rpcUrl),
      })
      await waitForTransactionReceipt(this.client, { hash })
    }
  }
  private async processFundingEpochs(): Promise<void> {
    if (!this.daoService || !this.account) return

    for (const [daoId, state] of this.daoStates) {
      if (!state.isActive) continue

      const daoName = state.daoFull.dao.name

      try {
        const epoch = await this.daoService.getCurrentEpoch(daoId)

        // Check if epoch needs finalization
        if (
          epoch.epochId > 0 &&
          !epoch.finalized &&
          Date.now() / 1000 > epoch.endTime
        ) {
          await this.daoService.finalizeEpoch(daoId)
        }

        // Auto-set CEO weights for new projects
        const projects = await this.daoService.getActiveProjects(daoId)
        for (const project of projects) {
          if (
            project.ceoWeight === 0 &&
            project.createdAt < Date.now() / 1000 - 86400
          ) {
            // Calculate weight based on project quality and community stake
            const weight = this.calculateProjectWeight(project, state.daoFull)
            if (weight > 0) {
              await this.daoService.setCEOWeight(project.projectId, weight)
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[${daoName}] Funding error:`, msg)
      }
    }
  }

  private calculateProjectWeight(
    project: FundingProject,
    daoFull: DAOFull,
  ): number {
    // Base weight from community stake
    const stakeWeight =
      Math.min(Number(project.communityStake) / 1e18, 100) * 10

    // Bonus for linked packages/repos
    const isLinked =
      daoFull.linkedPackages.includes(project.registryId) ||
      daoFull.linkedRepos.includes(project.registryId)

    const linkedBonus = isLinked ? 1000 : 0

    // Total weight (capped at CEO weight cap from config)
    const totalWeight = Math.min(
      stakeWeight + linkedBonus,
      daoFull.params.quorumBps / 2,
    )

    return Math.floor(totalWeight)
  }
  private generatePersonaResponse(
    persona: CEOPersona,
    approved: boolean,
    reasoning: string,
    daoDisplayName?: string,
  ): string {
    const templates = this.getPersonaTemplates(persona, daoDisplayName)
    const decision = approved ? 'approval' : 'rejection'

    // Select template based on personality
    let response: string
    switch (persona.communicationTone) {
      case 'playful':
        response = templates.playful[decision]
        break
      case 'authoritative':
        response = templates.authoritative[decision]
        break
      case 'friendly':
        response = templates.friendly[decision]
        break
      case 'formal':
        response = templates.formal[decision]
        break
      default:
        response = templates.professional[decision]
    }

    // Add reasoning
    response = response.replace('{reasoning}', reasoning)
    response = response.replace('{name}', persona.name)

    return response
  }

  private getPersonaTemplates(
    persona: CEOPersona,
    daoName?: string,
  ): Record<string, Record<string, string>> {
    const ceoName = persona.name
    const dao = daoName ?? 'the DAO'

    // Check for specific personas with custom templates (based on persona traits/personality)
    if (
      ceoName.toLowerCase().includes('monkey king') ||
      persona.personality.toLowerCase().includes('mischievous')
    ) {
      return {
        playful: {
          approval: `The ${ceoName} approves. {reasoning}. Let this journey begin - together we shall reach our destination.`,
          rejection: `Even the ${ceoName} must decline this path. {reasoning}. Return with a stronger proposal, and we shall consider again.`,
        },
        authoritative: {
          approval: `By my authority, it is decided. {reasoning}. The ${ceoName} grants passage.`,
          rejection: `This path would not serve us well. {reasoning}. Refine your offering and return when worthy.`,
        },
        friendly: {
          approval: `My friends, we move forward together. {reasoning}. The ${ceoName} stands with you on this adventure.`,
          rejection: `Dear companions, not this time. {reasoning}. But do not despair - every setback is a lesson for the journey ahead.`,
        },
        formal: {
          approval: `After due consideration, approval is granted. {reasoning}. Proceed with the blessing of ${dao}.`,
          rejection: `After careful review, this proposal cannot proceed. {reasoning}. Please revise and resubmit.`,
        },
        professional: {
          approval: `Decision: Approved. {reasoning}. ${dao} moves forward with this initiative under the guidance of the ${ceoName}.`,
          rejection: `Decision: Declined. {reasoning}. The ${ceoName} invites refinement of this proposal for future consideration.`,
        },
      }
    }

    // Default templates (use persona name and DAO name dynamically)
    return {
      playful: {
        approval: `Great news everyone. {reasoning}. Let's make it happen.`,
        rejection: `Not quite there yet. {reasoning}. Keep iterating.`,
      },
      authoritative: {
        approval: `This proposal is approved by ${ceoName}. {reasoning}. Execute immediately.`,
        rejection: `This proposal is rejected. {reasoning}. Do better.`,
      },
      friendly: {
        approval: `I'm happy to approve this. {reasoning}. Looking forward to seeing the results.`,
        rejection: `I appreciate the effort, but I can't approve this. {reasoning}. Let's work together on improvements.`,
      },
      formal: {
        approval: `After thorough review, this proposal is approved. {reasoning}. Please proceed with implementation.`,
        rejection: `After careful consideration, this proposal is not approved. {reasoning}. Please address the concerns and resubmit.`,
      },
      professional: {
        approval: `Decision: Approved by ${ceoName}. {reasoning}. Implementation may proceed.`,
        rejection: `Decision: Not Approved. {reasoning}. Revision required before resubmission.`,
      },
    }
  }
  getStatus(): OrchestratorStatus {
    const daoStates: Record<string, DAOStateStatus> = {}

    for (const [daoId, state] of this.daoStates) {
      daoStates[daoId] = {
        daoId,
        name: state.daoFull.dao.name,
        displayName: state.daoFull.dao.displayName,
        isActive: state.isActive,
        lastProcessed: state.lastProcessed,
        processedCount: state.processedCount,
        ceoName: state.daoFull.ceoPersona.name,
        errors: state.errors.slice(-5),
      }
    }

    return {
      running: this.running,
      cycleCount: this.cycleCount,
      lastCycle: this.lastCycle,
      operator: this.account?.address ?? null,
      daoCount: this.daoStates.size,
      totalProcessed: this.totalProcessed,
      daoStates,
      errors: this.errors.slice(-10),
    }
  }

  getDAOStatus(daoId: string): DAOStateStatus | null {
    const state = this.daoStates.get(daoId)
    if (!state) return null

    return {
      daoId,
      name: state.daoFull.dao.name,
      displayName: state.daoFull.dao.displayName,
      isActive: state.isActive,
      lastProcessed: state.lastProcessed,
      processedCount: state.processedCount,
      ceoName: state.daoFull.ceoPersona.name,
      errors: state.errors.slice(-5),
    }
  }

  async refreshDAO(daoId: string): Promise<void> {
    if (!this.daoService) return

    const daoFull = await this.daoService.getDAOFull(daoId)
    const existing = this.daoStates.get(daoId)

    if (existing) {
      existing.daoFull = daoFull
      existing.councilAddress = daoFull.dao.council
      existing.ceoAgentAddress = daoFull.dao.ceoAgent
    } else {
      this.daoStates.set(daoId, {
        daoId,
        daoFull,
        councilAddress: daoFull.dao.council,
        ceoAgentAddress: daoFull.dao.ceoAgent,
        lastProcessed: 0,
        processedCount: 0,
        errors: [],
        isActive: true,
      })
    }
  }

  setDAOActive(daoId: string, active: boolean): void {
    const state = this.daoStates.get(daoId)
    if (state) {
      state.isActive = active
    }
  }

  setPollInterval(interval: number): void {
    this.pollInterval = Math.max(5000, interval)
  }
}
export function createOrchestrator(
  config: AutocratConfig,
  blockchain: AutocratBlockchain,
): AutocratOrchestrator {
  return new AutocratOrchestrator(config, blockchain)
}

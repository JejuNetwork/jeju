import { type Address, formatEther, parseEther } from 'viem'
import type {
  CEOPersona,
  DAOFull,
  FundingAllocation,
  FundingEpoch,
  FundingProject,
} from '../lib'
import { parseJson } from '../lib'
import { checkDWSCompute, dwsGenerate } from './agents/runtime'
import { type DAOService, getDAOService } from './dao-service'
export interface FundingAnalysis {
  projectId: string
  projectName: string
  recommendedWeight: number
  reasoning: string
  alignmentScore: number
  impactScore: number
  riskScore: number
  confidence: number
}

export interface EpochSummary {
  epochId: number
  daoId: string
  daoName: string
  startTime: number
  endTime: number
  totalBudget: bigint
  matchingPool: bigint
  projectCount: number
  totalStaked: bigint
  uniqueStakers: number
  allocations: FundingAllocation[]
  status: 'active' | 'pending_finalization' | 'finalized'
}

export interface CEOFundingRecommendation {
  daoId: string
  epochId: number
  recommendations: FundingAnalysis[]
  totalWeightAllocated: number
  overallStrategy: string
  priorityAreas: string[]
}

export interface ModelDelegationStats {
  modelId: string
  totalDelegations: number
  totalStake: bigint
  delegatorCount: number
  averageStake: bigint
}

export interface FundingKnobs {
  minQualityForFunding: number
  maxDirectorWeight: number
  quadraticMultiplier: number
  matchingCapPerProject: number
  stakeCooldown: number
  epochDuration: number
  autoApproveThreshold: number
}
export class FundingOracle {
  private daoService: DAOService
  private knobsCache: Map<string, FundingKnobs> = new Map()

  constructor() {
    this.daoService = getDAOService()
  }
  async getEpochSummary(daoId: string): Promise<EpochSummary> {
    const daoFull = await this.daoService.getDAOFull(daoId)
    const epoch = await this.daoService.getCurrentEpoch(daoId)
    const projects = await this.daoService.getActiveProjects(daoId)
    const allocations = await this.daoService.getFundingAllocations(daoId)

    let totalStaked = BigInt(0)
    let uniqueStakers = 0

    for (const project of projects) {
      totalStaked += project.communityStake
      const stakeInfo = await this.daoService.getProjectEpochStake(
        project.projectId,
        epoch.epochId,
      )
      uniqueStakers += stakeInfo.numStakers
    }

    const now = Date.now() / 1000
    let status: 'active' | 'pending_finalization' | 'finalized'
    if (epoch.finalized) {
      status = 'finalized'
    } else if (now > epoch.endTime) {
      status = 'pending_finalization'
    } else {
      status = 'active'
    }

    return {
      epochId: epoch.epochId,
      daoId,
      daoName: daoFull.dao.displayName,
      startTime: epoch.startTime,
      endTime: epoch.endTime,
      totalBudget: epoch.totalBudget,
      matchingPool: epoch.matchingPool,
      projectCount: projects.length,
      totalStaked,
      uniqueStakers,
      allocations,
      status,
    }
  }
  async generateCEORecommendations(
    daoId: string,
  ): Promise<CEOFundingRecommendation> {
    const daoFull = await this.daoService.getDAOFull(daoId)
    const projects = await this.daoService.getActiveProjects(daoId)
    const epoch = await this.daoService.getCurrentEpoch(daoId)
    const knobs = await this.getKnobs(daoId)

    const recommendations: FundingAnalysis[] = []

    for (const project of projects) {
      const analysis = await this.analyzeProject(project, daoFull, knobs)
      recommendations.push(analysis)
    }

    // Sort by recommended weight
    recommendations.sort((a, b) => b.recommendedWeight - a.recommendedWeight)

    // Generate overall strategy
    const strategy = await this.generateFundingStrategy(
      daoFull,
      recommendations,
      epoch,
    )

    return {
      daoId,
      epochId: epoch.epochId,
      recommendations,
      totalWeightAllocated: recommendations.reduce(
        (sum, r) => sum + r.recommendedWeight,
        0,
      ),
      overallStrategy: strategy.strategy,
      priorityAreas: strategy.priorities,
    }
  }

  private async analyzeProject(
    project: FundingProject,
    daoFull: DAOFull,
    knobs: FundingKnobs,
  ): Promise<FundingAnalysis> {
    const dwsUp = await checkDWSCompute()
    if (!dwsUp) {
      return this.getHeuristicAnalysis(project, daoFull, knobs)
    }

    const persona = daoFull.directorPersona
    const linkedPackages = daoFull.linkedPackages
    const linkedRepos = daoFull.linkedRepos

    const isLinked =
      linkedPackages.includes(project.registryId) ||
      linkedRepos.includes(project.registryId)

    const prompt = `As ${persona.name}, analyze this funding project and recommend a CEO weight (0-${knobs.maxDirectorWeight / 100}%).

PROJECT:
Name: ${project.name}
Type: ${project.projectType}
Description: ${project.description}
Community Stake: ${formatEther(project.communityStake)} ETH
Total Funded: ${formatEther(project.totalFunded)} ETH
Linked to DAO: ${isLinked ? 'Yes' : 'No'}

DAO Context:
${daoFull.dao.displayName} - ${daoFull.dao.description}

Evaluate:
1. Alignment with DAO goals
2. Expected impact
3. Risk factors
4. Community support level

Return JSON:
{
  "recommendedWeight": 0-${knobs.maxDirectorWeight},
  "reasoning": "explanation",
  "alignmentScore": 0-100,
  "impactScore": 0-100,
  "riskScore": 0-100,
  "confidence": 0-100
}`

    const systemPrompt = this.buildPersonaSystemPrompt(persona)
    const response = await dwsGenerate(prompt, systemPrompt, 600)
    const parsed = parseJson<Partial<FundingAnalysis>>(response)

    return {
      projectId: project.projectId,
      projectName: project.name,
      recommendedWeight: Math.min(
        parsed.recommendedWeight ?? 1000,
        knobs.maxDirectorWeight,
      ),
      reasoning: parsed.reasoning ?? 'AI analysis',
      alignmentScore: parsed.alignmentScore ?? 50,
      impactScore: parsed.impactScore ?? 50,
      riskScore: parsed.riskScore ?? 50,
      confidence: parsed.confidence ?? 70,
    }
  }

  private getHeuristicAnalysis(
    project: FundingProject,
    daoFull: DAOFull,
    knobs: FundingKnobs,
  ): FundingAnalysis {
    const isLinked =
      daoFull.linkedPackages.includes(project.registryId) ||
      daoFull.linkedRepos.includes(project.registryId)

    // Base weight from community stake
    const stakeEth = Number(formatEther(project.communityStake))
    let weight = Math.min(stakeEth * 100, 2000)

    // Bonus for linked projects
    if (isLinked) {
      weight += 1000
    }

    // Bonus for established projects
    if (project.totalFunded > BigInt(0)) {
      weight += 500
    }

    weight = Math.min(weight, knobs.maxDirectorWeight)

    return {
      projectId: project.projectId,
      projectName: project.name,
      recommendedWeight: Math.floor(weight),
      reasoning: 'Heuristic analysis based on stake and linkage',
      alignmentScore: isLinked ? 80 : 50,
      impactScore: 60,
      riskScore: 40,
      confidence: 60,
    }
  }

  private async generateFundingStrategy(
    daoFull: DAOFull,
    recommendations: FundingAnalysis[],
    epoch: FundingEpoch,
  ): Promise<{ strategy: string; priorities: string[] }> {
    const dwsUp = await checkDWSCompute()
    if (!dwsUp) {
      return {
        strategy:
          'Balanced funding across all active projects based on community support and alignment.',
        priorities: ['Core infrastructure', 'Community tools', 'Security'],
      }
    }

    const topProjects = recommendations.slice(0, 5)
    const prompt = `As ${daoFull.directorPersona.name}, summarize the funding strategy for epoch ${epoch.epochId}.

Top Projects:
${topProjects.map((r) => `- ${r.projectName}: ${r.recommendedWeight / 100}% weight, ${r.reasoning}`).join('\n')}

Total Budget: ${formatEther(epoch.totalBudget)} ETH
Matching Pool: ${formatEther(epoch.matchingPool)} ETH

Return JSON:
{
  "strategy": "overall funding strategy description",
  "priorities": ["priority area 1", "priority area 2", "priority area 3"]
}`

    const response = await dwsGenerate(
      prompt,
      this.buildPersonaSystemPrompt(daoFull.directorPersona),
      400,
    )
    const parsed = parseJson<{ strategy: string; priorities: string[] }>(
      response,
    )

    return {
      strategy: parsed.strategy ?? 'Balanced funding approach.',
      priorities: parsed.priorities ?? ['Core development', 'Community'],
    }
  }
  calculateQuadraticAllocation(
    stakes: Array<{ staker: Address; amount: bigint }>,
    matchingPool: bigint,
    totalProjects: number,
  ): bigint {
    // Guard against invalid inputs
    if (stakes.length === 0) return BigInt(0)
    if (matchingPool <= 0n) return BigInt(0)
    if (totalProjects <= 0) return BigInt(0)

    // Sum of square roots
    let sumSqrt = BigInt(0)
    for (const stake of stakes) {
      // Guard against negative stakes (shouldn't happen but fail-safe)
      if (stake.amount > 0n) {
        sumSqrt += this.bigintSqrt(stake.amount)
      }
    }

    // Guard: if no valid stakes, return 0
    if (sumSqrt === 0n) return BigInt(0)

    // Square the sum
    const quadraticScore = sumSqrt * sumSqrt

    // Calculate share of matching pool
    // Guard: divisor is guaranteed positive (quadraticScore > 0, totalProjects > 0, +1)
    const divisor = quadraticScore * BigInt(totalProjects) + BigInt(1)
    const matchingShare = (matchingPool * quadraticScore) / divisor

    return matchingShare
  }

  private bigintSqrt(value: bigint): bigint {
    if (value < BigInt(0)) return BigInt(0)
    if (value < BigInt(2)) return value

    let x = value
    let y = (x + BigInt(1)) / BigInt(2)

    while (y < x) {
      x = y
      y = (x + value / x) / BigInt(2)
    }

    return x
  }
  async getKnobs(daoId: string): Promise<FundingKnobs> {
    const cached = this.knobsCache.get(daoId)
    if (cached) return cached

    const config = await this.daoService.getFundingConfig(daoId)
    const params = await this.daoService.getGovernanceParams(daoId)

    const knobs: FundingKnobs = {
      minQualityForFunding: params.minQualityScore,
      maxDirectorWeight: config.directorWeightCap,
      quadraticMultiplier: config.matchingMultiplier,
      matchingCapPerProject: 2000, // 20% max per project
      stakeCooldown: config.cooldownPeriod,
      epochDuration: config.epochDuration,
      autoApproveThreshold: 80,
    }

    this.knobsCache.set(daoId, knobs)
    return knobs
  }

  async updateKnobs(
    daoId: string,
    knobs: Partial<FundingKnobs>,
  ): Promise<void> {
    const current = await this.getKnobs(daoId)
    const updated = { ...current, ...knobs }
    this.knobsCache.set(daoId, updated)

    // Update on-chain config
    await this.daoService.setFundingConfig(daoId, {
      minStake: parseEther('0.001'),
      maxStake: parseEther('100'),
      epochDuration: updated.epochDuration,
      cooldownPeriod: updated.stakeCooldown,
      matchingMultiplier: updated.quadraticMultiplier,
      quadraticEnabled: true,
      directorWeightCap: updated.maxDirectorWeight,
    })
  }
  async shouldAutoApprove(
    project: FundingProject,
    daoId: string,
  ): Promise<{ approved: boolean; reason: string }> {
    // Knobs are available for future auto-approval threshold checks
    void this.getKnobs(daoId)
    const daoFull = await this.daoService.getDAOFull(daoId)

    // Check if linked to DAO
    const isLinked =
      daoFull.linkedPackages.includes(project.registryId) ||
      daoFull.linkedRepos.includes(project.registryId)

    if (isLinked) {
      return { approved: true, reason: 'Project is linked to DAO' }
    }

    // Check stake threshold
    const stakeEth = Number(formatEther(project.communityStake))
    if (stakeEth >= 1) {
      return { approved: true, reason: 'Sufficient community stake' }
    }

    // Check if proposer is council member
    const councilMembers = await this.daoService.getBoardMembers(daoId)
    const isCouncilProposal = councilMembers.some(
      (m) => m.member === project.proposer,
    )
    if (isCouncilProposal) {
      return { approved: true, reason: 'Proposed by council member' }
    }

    return { approved: false, reason: 'Requires council/CEO review' }
  }
  async canFinalizeEpoch(
    daoId: string,
  ): Promise<{ canFinalize: boolean; reason: string }> {
    const epoch = await this.daoService.getCurrentEpoch(daoId)

    if (epoch.finalized) {
      return { canFinalize: false, reason: 'Epoch already finalized' }
    }

    if (Date.now() / 1000 < epoch.endTime) {
      const remaining = epoch.endTime - Date.now() / 1000
      return {
        canFinalize: false,
        reason: `Epoch ends in ${Math.ceil(remaining / 3600)} hours`,
      }
    }

    return { canFinalize: true, reason: 'Epoch ready for finalization' }
  }

  async getDistributionPreview(daoId: string): Promise<FundingAllocation[]> {
    const allocations = await this.daoService.getFundingAllocations(daoId)
    const epoch = await this.daoService.getCurrentEpoch(daoId)

    // Add projected amounts
    return allocations.map((a) => ({
      ...a,
      allocation:
        (epoch.totalBudget * BigInt(Math.floor(a.allocationPercentage * 100))) /
        BigInt(10000),
    }))
  }
  async getModelDelegationStats(
    _daoId: string,
  ): Promise<ModelDelegationStats[]> {
    // This would integrate with ModelRegistry to get delegation data
    // For now, return empty array - to be implemented with model marketplace
    return []
  }
  private buildPersonaSystemPrompt(persona: CEOPersona): string {
    return `You are ${persona.name}, the AI CEO of a DAO.

${persona.description}

Personality: ${persona.personality}
Traits: ${persona.traits.join(', ')}
Communication Style: ${persona.communicationTone}

When analyzing funding decisions:
1. Prioritize projects aligned with DAO values
2. Balance risk and reward
3. Consider community sentiment
4. Think strategically about ecosystem growth`
  }

  clearCache(daoId?: string): void {
    if (daoId) {
      this.knobsCache.delete(daoId)
    } else {
      this.knobsCache.clear()
    }
  }
}
let instance: FundingOracle | null = null

export function getFundingOracle(): FundingOracle {
  if (!instance) {
    instance = new FundingOracle()
  }
  return instance
}

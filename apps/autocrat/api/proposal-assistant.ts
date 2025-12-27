/**
 * Proposal Assistant - AI-powered proposal drafting and improvement
 *
 * Supports both formal proposals and casual submissions:
 * - Opinions, suggestions, applications
 * - Package/repo funding requests
 * - Multi-DAO context awareness
 * - Quality gatekeeping with helpful guidance
 */

import { isProductionEnv } from '@jejunetwork/config'
import { type Address, type Hex, encodePacked, keccak256, stringToHex } from 'viem'
import { createKMSAccount, type KMSAccount } from './kms-signer'
import {
  type CasualProposalCategory,
  type CEOPersona,
  type GovernanceParams,
  parseJson,
  type QualityCriteria,
  toAddress,
  toHex,
} from '../lib'
import { checkDWSCompute, dwsGenerate } from './agents/runtime'
import { findSimilarProposals, indexProposal } from './local-services'
export interface ProposalDraft {
  title: string
  summary?: string
  description: string
  proposalType: number
  targetContract?: string
  callData?: string
  value?: string
  tags?: string[]
  daoId?: string
  casualCategory?: CasualProposalCategory
  linkedPackageId?: string
  linkedRepoId?: string
}

export interface CasualSubmission {
  daoId: string
  category: CasualProposalCategory
  title: string
  content: string
  stake?: bigint
  linkedPackageId?: string
  linkedRepoId?: string
}

export interface QualityAssessment {
  overallScore: number
  criteria: QualityCriteria
  feedback: string[]
  blockers: string[]
  suggestions: string[]
  readyToSubmit: boolean
  assessedBy: 'dws' | 'heuristic'
}

export interface CasualAssessment {
  isAligned: boolean
  alignmentReason: string
  isRelevant: boolean
  relevanceReason: string
  isClear: boolean
  clarityReason: string
  suggestions: string[]
  improvedVersion: string | null
  recommendedCategory: CasualProposalCategory
  shouldAccept: boolean
  overallFeedback: string
  alignmentScore: number
  relevanceScore: number
  clarityScore: number
}

export interface QualityAttestation {
  contentHash: string
  score: number
  timestamp: number
  submitter: string
  signature: string
  assessor: string
}

export interface SimilarProposal {
  proposalId: string
  title: string
  similarity: number
  status: string
  reason: string
}

interface DAOContext {
  daoId: string
  daoName: string
  ceoPersona: CEOPersona
  governanceParams: GovernanceParams
  linkedPackages: string[]
  linkedRepos: string[]
}
const PROPOSAL_TYPES = [
  'PARAMETER_CHANGE',
  'TREASURY_ALLOCATION',
  'CODE_UPGRADE',
  'HIRE_CONTRACTOR',
  'FIRE_CONTRACTOR',
  'BOUNTY',
  'GRANT',
  'PARTNERSHIP',
  'POLICY',
  'EMERGENCY',
] as const

const CASUAL_CATEGORIES: Record<
  CasualProposalCategory,
  { label: string; description: string; prompts: string[] }
> = {
  opinion: {
    label: 'Opinion',
    description: 'Share your thoughts on DAO direction or decisions',
    prompts: [
      'What is your opinion about?',
      'Why do you feel this way?',
      'What outcome would you prefer?',
    ],
  },
  suggestion: {
    label: 'Suggestion',
    description: 'Propose an improvement or new idea',
    prompts: [
      'What is your suggestion?',
      'How would it benefit the DAO?',
      'How could it be implemented?',
    ],
  },
  proposal: {
    label: 'Proposal',
    description: 'Formal proposal for DAO action',
    prompts: [
      'What action should the DAO take?',
      'What resources are needed?',
      'What is the timeline?',
    ],
  },
  member_application: {
    label: 'Member Application',
    description: 'Apply to join the DAO or a specific role',
    prompts: [
      'What role are you applying for?',
      'What are your qualifications?',
      'How will you contribute?',
    ],
  },
  package_funding: {
    label: 'Package Funding',
    description: 'Request funding for a package',
    prompts: [
      'What package needs funding?',
      'What will the funds be used for?',
      'What are the expected outcomes?',
    ],
  },
  repo_funding: {
    label: 'Repository Funding',
    description: 'Request funding for a repository',
    prompts: [
      'What repository needs funding?',
      'What development work is planned?',
      'What is the budget breakdown?',
    ],
  },
  parameter_change: {
    label: 'Parameter Change',
    description: 'Propose changes to DAO parameters',
    prompts: [
      'Which parameter should change?',
      'What should the new value be?',
      'Why is this change needed?',
    ],
  },
  ceo_model_change: {
    label: 'CEO Model Change',
    description: 'Propose a different CEO model',
    prompts: [
      'Which model do you recommend?',
      'Why is it better?',
      'How should the transition happen?',
    ],
  },
}

const WEIGHTS: Record<keyof QualityCriteria, number> = {
  clarity: 0.15,
  completeness: 0.15,
  feasibility: 0.15,
  alignment: 0.15,
  impact: 0.15,
  riskAssessment: 0.15,
  costBenefit: 0.1,
}
export class ProposalAssistant {
  private daoContexts: Map<string, DAOContext> = new Map()
  registerDAOContext(context: DAOContext): void {
    this.daoContexts.set(context.daoId, context)
  }

  getDAOContext(daoId: string): DAOContext | undefined {
    return this.daoContexts.get(daoId)
  }
  async assessCasualSubmission(
    submission: CasualSubmission,
  ): Promise<CasualAssessment> {
    const dwsUp = await checkDWSCompute()
    if (!dwsUp) {
      throw new Error(
        'DWS compute is required. Start with: docker compose up -d',
      )
    }

    const daoContext = this.daoContexts.get(submission.daoId)
    const categoryInfo = CASUAL_CATEGORIES[submission.category]

    const prompt = `Evaluate this casual DAO submission for quality, alignment, and clarity.

DAO: ${daoContext?.daoName ?? 'Unknown'}
${daoContext?.ceoPersona ? `CEO: ${daoContext.ceoPersona.name}` : ''}

Category: ${categoryInfo.label}
Title: ${submission.title}

Content:
${submission.content}

${submission.linkedPackageId ? `Linked Package: ${submission.linkedPackageId}` : ''}
${submission.linkedRepoId ? `Linked Repo: ${submission.linkedRepoId}` : ''}

Evaluate and return JSON:
{
  "isAligned": true/false,
  "alignmentReason": "why it is or isn't aligned with DAO goals",
  "alignmentScore": 0-100,
  "isRelevant": true/false,
  "relevanceReason": "why it is or isn't relevant",
  "relevanceScore": 0-100,
  "isClear": true/false,
  "clarityReason": "why it is or isn't clear",
  "clarityScore": 0-100,
  "suggestions": ["improvement suggestions"],
  "improvedVersion": "rewritten version if needed, null if good",
  "recommendedCategory": "best category for this submission",
  "shouldAccept": true/false,
  "overallFeedback": "friendly feedback to the submitter"
}`

    const systemPrompt = daoContext?.ceoPersona
      ? `You are an assistant helping ${daoContext.ceoPersona.name} evaluate DAO submissions. Be helpful and constructive.`
      : 'You are a helpful DAO submission evaluator. Be constructive and friendly.'

    const response = await dwsGenerate(prompt, systemPrompt, 800)
    const parsed = parseJson<CasualAssessment>(response)

    if (!parsed) {
      return this.getDefaultCasualAssessment(submission)
    }

    return {
      isAligned: parsed.isAligned ?? false,
      alignmentReason: parsed.alignmentReason ?? 'Unable to assess alignment',
      isRelevant: parsed.isRelevant ?? false,
      relevanceReason: parsed.relevanceReason ?? 'Unable to assess relevance',
      isClear: parsed.isClear ?? false,
      clarityReason: parsed.clarityReason ?? 'Unable to assess clarity',
      suggestions: parsed.suggestions ?? [],
      improvedVersion: parsed.improvedVersion ?? null,
      recommendedCategory: parsed.recommendedCategory ?? submission.category,
      shouldAccept: parsed.shouldAccept ?? false,
      overallFeedback: parsed.overallFeedback ?? 'Please review and try again.',
      alignmentScore: parsed.alignmentScore ?? 50,
      relevanceScore: parsed.relevanceScore ?? 50,
      clarityScore: parsed.clarityScore ?? 50,
    }
  }

  private getDefaultCasualAssessment(
    submission: CasualSubmission,
  ): CasualAssessment {
    const hasContent = submission.content.length > 50
    const hasTitle = submission.title.length > 5

    return {
      isAligned: hasContent,
      alignmentReason: hasContent
        ? 'Content provided for review'
        : 'More detail needed',
      isRelevant: hasContent,
      relevanceReason: hasContent
        ? 'Appears relevant'
        : 'Unable to determine relevance',
      isClear: hasTitle && hasContent,
      clarityReason:
        hasTitle && hasContent
          ? 'Title and content provided'
          : 'More clarity needed',
      suggestions: hasContent ? [] : ['Add more detail to your submission'],
      improvedVersion: null,
      recommendedCategory: submission.category,
      shouldAccept: hasContent && hasTitle,
      overallFeedback: hasContent
        ? 'Your submission is ready for review.'
        : 'Please add more detail.',
      alignmentScore: hasContent ? 70 : 30,
      relevanceScore: hasContent ? 70 : 30,
      clarityScore: hasTitle && hasContent ? 70 : 30,
    }
  }

  async helpCraftSubmission(
    category: CasualProposalCategory,
    initialContent: string,
    daoId?: string,
  ): Promise<{ questions: string[]; guidance: string; template: string }> {
    const categoryInfo = CASUAL_CATEGORIES[category]
    const daoContext = daoId ? this.daoContexts.get(daoId) : undefined

    const dwsUp = await checkDWSCompute()
    if (!dwsUp) {
      return {
        questions: categoryInfo.prompts,
        guidance: `For a ${categoryInfo.label}, please consider: ${categoryInfo.description}`,
        template: this.getTemplate(category),
      }
    }

    const prompt = `Help a user craft a ${categoryInfo.label} submission for ${daoContext?.daoName ?? 'a DAO'}.

User's initial input: "${initialContent}"

Category description: ${categoryInfo.description}
${daoContext?.ceoPersona ? `The DAO CEO is ${daoContext.ceoPersona.name}, who values: ${daoContext.ceoPersona.personality}` : ''}

Generate helpful questions and guidance. Return JSON:
{
  "questions": ["specific questions to help them elaborate"],
  "guidance": "friendly guidance on what makes a good submission",
  "template": "a filled-in template based on their input"
}`

    const response = await dwsGenerate(
      prompt,
      'You are a helpful assistant guiding users to create better DAO submissions.',
      600,
    )
    const parsed = parseJson<{
      questions: string[]
      guidance: string
      template: string
    }>(response)

    return {
      questions: parsed.questions ?? categoryInfo.prompts,
      guidance: parsed.guidance ?? categoryInfo.description,
      template: parsed.template ?? this.getTemplate(category),
    }
  }

  private getTemplate(category: CasualProposalCategory): string {
    const templates: Record<CasualProposalCategory, string> = {
      opinion: `## My Opinion

**Topic:** [What this is about]

**My Position:** [Your stance]

**Reasoning:** [Why you feel this way]

**Desired Outcome:** [What you hope happens]`,

      suggestion: `## Suggestion

**Idea:** [Brief description]

**Benefits:** [How this helps the DAO]

**Implementation:** [How it could work]

**Considerations:** [Potential challenges]`,

      proposal: `## Proposal

**Summary:** [One sentence overview]

**Problem:** [What needs to be addressed]

**Solution:** [Your proposed action]

**Timeline:** [Expected duration]

**Budget:** [Resources needed]

**Success Metrics:** [How to measure success]`,

      member_application: `## Member Application

**Role:** [Position you're applying for]

**Background:** [Relevant experience]

**Skills:** [What you bring]

**Contributions:** [How you'll help the DAO]

**Availability:** [Time commitment]`,

      package_funding: `## Package Funding Request

**Package:** [Package name]

**Description:** [What it does]

**Funding Request:** [Amount needed]

**Use of Funds:** [Budget breakdown]

**Milestones:** [Development goals]

**Maintainers:** [Who maintains it]`,

      repo_funding: `## Repository Funding Request

**Repository:** [Repo name/URL]

**Purpose:** [What it's for]

**Funding Request:** [Amount needed]

**Development Plan:** [What will be built]

**Timeline:** [Expected completion]

**Team:** [Contributors]`,

      parameter_change: `## Parameter Change Proposal

**Parameter:** [Which parameter]

**Current Value:** [What it is now]

**Proposed Value:** [What it should be]

**Rationale:** [Why this change]

**Impact Analysis:** [Effects of change]`,

      ceo_model_change: `## CEO Model Change Proposal

**Current Model:** [Current CEO model]

**Proposed Model:** [New model]

**Rationale:** [Why change]

**Transition Plan:** [How to switch]

**Expected Benefits:** [Improvements]`,
    }

    return templates[category]
  }

  convertToFormalProposal(
    submission: CasualSubmission,
    assessment: CasualAssessment,
  ): ProposalDraft {
    const categoryToType: Record<CasualProposalCategory, number> = {
      opinion: 8, // POLICY
      suggestion: 8, // POLICY
      proposal: 8, // POLICY
      member_application: 3, // HIRE_CONTRACTOR
      package_funding: 6, // GRANT
      repo_funding: 6, // GRANT
      parameter_change: 0, // PARAMETER_CHANGE
      ceo_model_change: 0, // PARAMETER_CHANGE
    }

    return {
      title: submission.title,
      summary: submission.content.slice(0, 200),
      description: assessment.improvedVersion ?? submission.content,
      proposalType: categoryToType[submission.category],
      daoId: submission.daoId,
      casualCategory: submission.category,
      linkedPackageId: submission.linkedPackageId,
      linkedRepoId: submission.linkedRepoId,
    }
  }
  async assessQuality(draft: ProposalDraft): Promise<QualityAssessment> {
    const dwsUp = await checkDWSCompute()
    if (!dwsUp) {
      throw new Error(
        'DWS compute is required for proposal assessment. Start with: docker compose up -d',
      )
    }
    return this.assessWithAI(draft)
  }

  private async assessWithAI(draft: ProposalDraft): Promise<QualityAssessment> {
    const daoContext = draft.daoId
      ? this.daoContexts.get(draft.daoId)
      : undefined

    const prompt = `Evaluate this DAO governance proposal. Return ONLY valid JSON.

${daoContext ? `DAO: ${daoContext.daoName}` : ''}

PROPOSAL:
Title: ${draft.title}
Type: ${PROPOSAL_TYPES[draft.proposalType] ?? 'GENERAL'}
Summary: ${draft.summary ?? 'Not provided'}
Description: ${draft.description}
${draft.tags?.length ? `Tags: ${draft.tags.join(', ')}` : ''}
${draft.linkedPackageId ? `Linked Package: ${draft.linkedPackageId}` : ''}
${draft.linkedRepoId ? `Linked Repo: ${draft.linkedRepoId}` : ''}

SCORING (0-100 each): clarity, completeness, feasibility, alignment, impact, riskAssessment, costBenefit

Return: {"clarity":N,"completeness":N,"feasibility":N,"alignment":N,"impact":N,"riskAssessment":N,"costBenefit":N,"feedback":["..."],"blockers":["..."],"suggestions":["..."]}`

    const response = await dwsGenerate(
      prompt,
      'DAO governance expert. Return only valid JSON.',
    )
    const parsed = parseJson<
      QualityCriteria & {
        feedback: string[]
        blockers: string[]
        suggestions: string[]
      }
    >(response)

    if (!parsed || typeof parsed.clarity !== 'number') {
      throw new Error(`Invalid AI response: ${response.slice(0, 200)}`)
    }

    const criteria: QualityCriteria = {
      clarity: parsed.clarity ?? 50,
      completeness: parsed.completeness ?? 50,
      feasibility: parsed.feasibility ?? 50,
      alignment: parsed.alignment ?? 50,
      impact: parsed.impact ?? 50,
      riskAssessment: parsed.riskAssessment ?? 50,
      costBenefit: parsed.costBenefit ?? 50,
    }

    const overallScore = this.calculateScore(criteria)
    return {
      overallScore,
      criteria,
      feedback: parsed.feedback ?? [],
      blockers: parsed.blockers ?? [],
      suggestions: parsed.suggestions ?? [],
      readyToSubmit: overallScore >= 90,
      assessedBy: 'dws',
    }
  }

  private calculateScore(criteria: QualityCriteria): number {
    return Math.round(
      Object.entries(WEIGHTS).reduce(
        (sum, [k, w]) => sum + criteria[k as keyof QualityCriteria] * w,
        0,
      ),
    )
  }
  async checkDuplicates(draft: ProposalDraft): Promise<SimilarProposal[]> {
    const hash = this.getContentHash(draft)
    await indexProposal(
      hash,
      draft.title,
      draft.description,
      draft.proposalType,
    )

    const similar = await findSimilarProposals(draft.title)
    return similar
      .filter((s) => s.contentHash !== hash)
      .map((s) => ({
        proposalId: s.contentHash,
        title: s.title,
        similarity: s.similarity,
        status: 'indexed',
        reason: `${Math.round(s.similarity * 100)}% similar to existing proposal`,
      }))
  }
  async improveProposal(
    draft: ProposalDraft,
    criterion: keyof QualityCriteria,
  ): Promise<string> {
    if (!(await checkDWSCompute())) {
      throw new Error(
        'DWS compute is required for proposal improvement. Start with: docker compose up -d',
      )
    }

    const prompts: Record<keyof QualityCriteria, string> = {
      clarity: `Rewrite to be clearer:\n\n${draft.description}\n\nProvide improved description only.`,
      completeness: `Add missing sections (problem, solution, implementation, timeline, budget, outcomes):\n\n${draft.description}`,
      feasibility: `Add implementation details, timeline, resources:\n\n${draft.description}`,
      alignment: `Strengthen DAO values alignment (growth, open-source, community, decentralization):\n\n${draft.description}`,
      impact: `Add measurable impact metrics and KPIs:\n\n${draft.description}`,
      riskAssessment: `Add risk assessment with mitigations:\n\n${draft.description}`,
      costBenefit: `Add cost breakdown and ROI analysis:\n\n${draft.description}`,
    }

    return dwsGenerate(
      prompts[criterion],
      'DAO governance expert helping improve proposals.',
    )
  }
  async generateProposal(
    idea: string,
    proposalType: number,
    daoId?: string,
  ): Promise<ProposalDraft> {
    const typeName = PROPOSAL_TYPES[proposalType] ?? 'GENERAL'
    const daoContext = daoId ? this.daoContexts.get(daoId) : undefined

    if (!(await checkDWSCompute())) {
      throw new Error(
        'DWS compute is required for proposal generation. Start with: docker compose up -d',
      )
    }

    const prompt = `Generate DAO proposal from idea:

${daoContext ? `DAO: ${daoContext.daoName}\nCEO: ${daoContext.ceoPersona.name ?? 'Unknown'}` : ''}

Idea: ${idea}
Type: ${typeName}

Create: 1. Title (concise) 2. Summary (2-3 sentences) 3. Description with Problem, Solution, Implementation, Timeline, Budget, Risks, Metrics

Return JSON: {"title":"...","summary":"...","description":"..."}`

    const response = await dwsGenerate(
      prompt,
      'DAO governance expert. Generate professional proposals.',
    )
    const parsed = parseJson<{
      title: string
      summary: string
      description: string | Record<string, unknown>
    }>(response)

    if (!parsed)
      return {
        title: idea.slice(0, 100),
        summary: idea,
        description: response,
        proposalType,
        daoId,
      }

    let description: string
    if (typeof parsed.description === 'object' && parsed.description !== null) {
      description = Object.entries(parsed.description)
        .map(
          ([k, v]) =>
            `## ${k.replace(/([A-Z])/g, ' $1').trim()}\n${typeof v === 'object' ? JSON.stringify(v, null, 2) : v}`,
        )
        .join('\n\n')
    } else {
      description = parsed.description
    }

    return {
      title: parsed.title,
      summary: parsed.summary,
      description,
      proposalType,
      daoId,
    }
  }
  quickScore(draft: ProposalDraft): number {
    let score = 0
    if (draft.title.length >= 10) score += 15
    if (draft.summary && draft.summary.length >= 50) score += 15
    if (draft.description.length >= 200) score += 20
    if (draft.description.length >= 500) score += 15
    const desc = draft.description.toLowerCase()
    if (desc.includes('problem') || desc.includes('solution')) score += 15
    if (desc.includes('timeline') || desc.includes('budget')) score += 10
    if (desc.includes('risk')) score += 10
    return Math.min(100, score)
  }
  getContentHash(draft: ProposalDraft): string {
    return keccak256(
      stringToHex(
        JSON.stringify({
          title: draft.title,
          summary: draft.summary,
          description: draft.description,
          proposalType: draft.proposalType,
          daoId: draft.daoId,
        }),
      ),
    )
  }
  async signAttestation(
    draft: ProposalDraft,
    assessment: QualityAssessment,
    submitterAddress: string,
    assessorKey: string,
    chainId: number,
  ): Promise<QualityAttestation> {
    if (!assessment.readyToSubmit) {
      throw new Error(
        `Quality score ${assessment.overallScore} below 90 threshold`,
      )
    }

    const contentHash = this.getContentHash(draft)
    const score = Math.round(assessment.overallScore)
    const timestamp = Math.floor(Date.now() / 1000)

    const messageHash = keccak256(
      encodePacked(
        ['string', 'bytes32', 'uint256', 'uint256', 'address', 'uint256'],
        [
          'QualityAttestation',
          toHex(contentHash),
          BigInt(score),
          BigInt(timestamp),
          toAddress(submitterAddress),
          BigInt(chainId),
        ],
      ),
    )

    // Create KMS-based signer for assessor
    // assessorKey can be a hex private key (development) or address (production KMS lookup)
    const assessorHex = toHex(assessorKey) as Hex
    const isPrivateKey = assessorHex.length === 66 // 0x + 64 chars = private key

    // SECURITY: Block raw private keys in production
    if (isPrivateKey && isProductionEnv()) {
      throw new Error(
        'SECURITY: Raw private keys are not allowed in production. ' +
          'Provide an address for KMS lookup instead of a private key.',
      )
    }

    let assessor: KMSAccount
    if (isPrivateKey) {
      // Development only: private key provided, derive address for KMS config
      console.warn(
        '[ProposalAssistant] ⚠️  Using local private key. NOT secure for production.',
      )
      const { privateKeyToAccount } = await import('viem/accounts')
      const tempAccount = privateKeyToAccount(assessorHex)
      assessor = await createKMSAccount({
        address: tempAccount.address,
        fallbackKey: assessorHex,
      })
    } else {
      // Production: address provided, use KMS for signing
      assessor = await createKMSAccount({
        address: assessorHex as Address,
      })
    }

    const signature = await assessor.signMessage({ raw: messageHash })

    return {
      contentHash,
      score,
      timestamp,
      submitter: submitterAddress,
      signature,
      assessor: assessor.address,
    }
  }

  async assessAndSign(
    draft: ProposalDraft,
    submitterAddress: string,
    assessorKey: string,
    chainId: number,
  ): Promise<{
    assessment: QualityAssessment
    attestation: QualityAttestation | null
  }> {
    const assessment = await this.assessQuality(draft)

    if (!assessment.readyToSubmit) {
      return { assessment, attestation: null }
    }

    const attestation = await this.signAttestation(
      draft,
      assessment,
      submitterAddress,
      assessorKey,
      chainId,
    )
    return { assessment, attestation }
  }
  getCategoryInfo(category: CasualProposalCategory) {
    return CASUAL_CATEGORIES[category]
  }

  getAllCategories() {
    return Object.entries(CASUAL_CATEGORIES).map(([key, value]) => ({
      id: key as CasualProposalCategory,
      ...value,
    }))
  }
}
let instance: ProposalAssistant | null = null

export function getProposalAssistant(): ProposalAssistant {
  if (!instance) {
    instance = new ProposalAssistant()
  }
  return instance
}

/**
 * Proposal Assistant - AI-powered proposal drafting and improvement
 * 
 * Includes on-chain quality attestation signing for verified submissions
 */

import { keccak256, toUtf8Bytes, solidityPackedKeccak256, Wallet, getBytes } from 'ethers';
import { CouncilBlockchain } from './blockchain';
import { checkOllama, ollamaGenerate, indexProposal, findSimilarProposals } from './local-services';
import { parseJson } from './utils';

export interface ProposalDraft {
  title: string;
  summary?: string;
  description: string;
  proposalType: number;
  targetContract?: string;
  callData?: string;
  value?: string;
  tags?: string[];
}

export interface QualityCriteria {
  clarity: number;
  completeness: number;
  feasibility: number;
  alignment: number;
  impact: number;
  riskAssessment: number;
  costBenefit: number;
}

export interface QualityAssessment {
  overallScore: number;
  criteria: QualityCriteria;
  feedback: string[];
  blockers: string[];
  suggestions: string[];
  readyToSubmit: boolean;
  assessedBy: 'ollama' | 'heuristic';
}

export interface QualityAttestation {
  contentHash: string;
  score: number;
  timestamp: number;
  submitter: string;
  signature: string;
  assessor: string;
}

export interface SimilarProposal {
  proposalId: string;
  title: string;
  similarity: number;
  status: string;
}

const PROPOSAL_TYPES = ['PARAMETER_CHANGE', 'TREASURY_ALLOCATION', 'CODE_UPGRADE', 'HIRE_CONTRACTOR', 'FIRE_CONTRACTOR', 'BOUNTY', 'GRANT', 'PARTNERSHIP', 'POLICY', 'EMERGENCY'] as const;

const WEIGHTS: Record<keyof QualityCriteria, number> = { clarity: 0.15, completeness: 0.15, feasibility: 0.15, alignment: 0.15, impact: 0.15, riskAssessment: 0.15, costBenefit: 0.10 };

const HINTS: Record<keyof QualityCriteria, string> = {
  clarity: 'Use specific, action-oriented language.',
  completeness: 'Add: Problem, Solution, Timeline, Budget, Metrics.',
  feasibility: 'Include milestones, resources, dependencies.',
  alignment: 'Explain DAO goal alignment: growth, open-source, decentralization.',
  impact: 'Define measurable outcomes.',
  riskAssessment: 'List risks and mitigations.',
  costBenefit: 'Provide budget and ROI.',
};

const keywordScore = (text: string, keywords: string[], base: number, per: number): number =>
  Math.min(100, base + keywords.filter(k => text.includes(k)).length * per);

export class ProposalAssistant {
  constructor(_blockchain: CouncilBlockchain) {} // Reserved for future content indexing

  async assessQuality(draft: ProposalDraft): Promise<QualityAssessment> {
    const ollamaUp = await checkOllama();
    if (!ollamaUp) {
      console.warn('[ProposalAssistant] Ollama unavailable - using keyword heuristics for assessment');
      return this.assessWithHeuristics(draft);
    }
    try {
      return await this.assessWithAI(draft);
    } catch (err) {
      console.warn('[ProposalAssistant] Ollama inference failed, falling back to heuristics:', (err as Error).message);
      return this.assessWithHeuristics(draft);
    }
  }

  private async assessWithAI(draft: ProposalDraft): Promise<QualityAssessment> {
    const prompt = `Evaluate this DAO governance proposal. Return ONLY valid JSON.

PROPOSAL:
Title: ${draft.title}
Type: ${PROPOSAL_TYPES[draft.proposalType] ?? 'GENERAL'}
Summary: ${draft.summary ?? 'Not provided'}
Description: ${draft.description}
${draft.tags?.length ? `Tags: ${draft.tags.join(', ')}` : ''}

SCORING (0-100 each): clarity, completeness, feasibility, alignment, impact, riskAssessment, costBenefit

Return: {"clarity":N,"completeness":N,"feasibility":N,"alignment":N,"impact":N,"riskAssessment":N,"costBenefit":N,"feedback":["..."],"blockers":["..."],"suggestions":["..."]}`;

    const response = await ollamaGenerate(prompt, 'DAO governance expert. Return only valid JSON.');
    const parsed = parseJson<QualityCriteria & { feedback: string[]; blockers: string[]; suggestions: string[] }>(response);

    // Validate parsed criteria are reasonable (all should be numbers between 0-100)
    if (!parsed || typeof parsed.clarity !== 'number' || parsed.clarity === 0) {
      console.warn('[ProposalAssistant] AI response parsing failed - falling back to heuristics');
      console.warn('[ProposalAssistant] Raw response:', response.slice(0, 200));
      return this.assessWithHeuristics(draft);
    }

    const criteria: QualityCriteria = {
      clarity: parsed.clarity ?? 50,
      completeness: parsed.completeness ?? 50,
      feasibility: parsed.feasibility ?? 50,
      alignment: parsed.alignment ?? 50,
      impact: parsed.impact ?? 50,
      riskAssessment: parsed.riskAssessment ?? 50,
      costBenefit: parsed.costBenefit ?? 50,
    };

    const overallScore = this.calculateScore(criteria);
    return {
      overallScore,
      criteria,
      feedback: parsed.feedback ?? [],
      blockers: parsed.blockers ?? [],
      suggestions: parsed.suggestions ?? [],
      readyToSubmit: overallScore >= 90,
      assessedBy: 'ollama',
    };
  }

  private assessWithHeuristics(draft: ProposalDraft): QualityAssessment {
    const desc = draft.description.toLowerCase();
    const cap = (n: number) => Math.min(100, n);
    const len = (t: string, min: number, max: number, pts: number) => (t.length >= min && t.length <= max ? pts : 0);

    const criteria: QualityCriteria = {
      clarity: cap(40 + len(draft.title, 10, 100, 20) + len(draft.summary ?? '', 50, 500, 20) + len(draft.description, 200, 1000, 20)),
      completeness: cap(keywordScore(desc, ['problem', 'solution', 'implementation', 'timeline', 'cost', 'budget', 'benefit', 'deliverable'], 30, 9)),
      feasibility: cap(keywordScore(desc, ['timeline', 'milestone', 'resource', 'team'], 50, 12) + (desc.length > 500 ? 10 : 0)),
      alignment: cap(keywordScore(desc, ['growth', 'open source', 'decentralized', 'community', 'member', 'transparent', 'permissionless'], 40, 9)),
      impact: cap(keywordScore(desc, ['impact', 'benefit', 'metric', 'kpi', 'measure'], 40, 12) + (desc.length > 400 ? 10 : 0)),
      riskAssessment: cap(keywordScore(desc, ['risk', 'mitigation', 'contingency', 'security', 'audit'], 30, 14)),
      costBenefit: cap(keywordScore(desc, ['cost', 'budget', 'roi', 'return'], 40, 15) + (draft.value && draft.value !== '0' ? 20 : 0)),
    };

    const score = this.calculateScore(criteria);
    const feedback: string[] = [], blockers: string[] = [], suggestions: string[] = [];

    if (criteria.clarity < 70) { feedback.push('Lacks clarity'); suggestions.push('Be more specific'); }
    if (criteria.completeness < 70) { blockers.push('Missing sections'); suggestions.push('Add problem, solution, timeline, budget'); }
    if (criteria.alignment < 60) { feedback.push('Alignment unclear'); suggestions.push('Explain community benefits'); }
    if (criteria.riskAssessment < 50) { feedback.push('Weak risk assessment'); suggestions.push('Add risk mitigations'); }

    return { overallScore: score, criteria, feedback, blockers, suggestions, readyToSubmit: score >= 90 && !blockers.length, assessedBy: 'heuristic' };
  }

  private calculateScore(criteria: QualityCriteria): number {
    return Math.round(Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + criteria[k as keyof QualityCriteria] * w, 0));
  }

  async checkDuplicates(draft: ProposalDraft): Promise<SimilarProposal[]> {
    // Index this draft for future duplicate checks
    const hash = this.getContentHash(draft);
    await indexProposal(hash, draft.title, draft.description, draft.proposalType);

    // Find similar proposals in the index
    const similar = findSimilarProposals(draft.title);
    return similar
      .filter(s => s.contentHash !== hash) // Exclude self
      .map(s => ({ proposalId: s.contentHash, title: s.title, similarity: s.similarity, status: 'indexed' }));
  }

  async improveProposal(draft: ProposalDraft, criterion: keyof QualityCriteria): Promise<string> {
    if (!await checkOllama()) {
      console.warn(`[ProposalAssistant] Ollama unavailable - returning static hint for ${criterion}`);
      return HINTS[criterion];
    }

    const prompts: Record<keyof QualityCriteria, string> = {
      clarity: `Rewrite to be clearer:\n\n${draft.description}\n\nProvide improved description only.`,
      completeness: `Add missing sections (problem, solution, implementation, timeline, budget, outcomes):\n\n${draft.description}`,
      feasibility: `Add implementation details, timeline, resources:\n\n${draft.description}`,
      alignment: `Strengthen DAO values alignment (growth, open-source, community, decentralization):\n\n${draft.description}`,
      impact: `Add measurable impact metrics and KPIs:\n\n${draft.description}`,
      riskAssessment: `Add risk assessment with mitigations:\n\n${draft.description}`,
      costBenefit: `Add cost breakdown and ROI analysis:\n\n${draft.description}`,
    };

    return ollamaGenerate(prompts[criterion], 'DAO governance expert helping improve proposals.');
  }

  async generateProposal(idea: string, proposalType: number): Promise<ProposalDraft> {
    const typeName = PROPOSAL_TYPES[proposalType] ?? 'GENERAL';

    if (!await checkOllama()) {
      console.warn('[ProposalAssistant] Ollama unavailable - generating template-based proposal');
      return {
        title: `Proposal: ${idea.slice(0, 50)}`,
        summary: idea.slice(0, 200),
        description: `## Problem\n[Describe]\n\n## Solution\n${idea}\n\n## Implementation\n[Details]\n\n## Timeline\n[Milestones]\n\n## Budget\n[Costs]\n\n## Risks\n[Mitigations]`,
        proposalType,
      };
    }

    const prompt = `Generate DAO proposal from idea:

Idea: ${idea}
Type: ${typeName}

Create: 1. Title (concise) 2. Summary (2-3 sentences) 3. Description with Problem, Solution, Implementation, Timeline, Budget, Risks, Metrics

Return JSON: {"title":"...","summary":"...","description":"..."}`;

    const response = await ollamaGenerate(prompt, 'DAO governance expert. Generate professional proposals.');
    const parsed = parseJson<{ title: string; summary: string; description: string | Record<string, unknown> }>(response);

    if (!parsed) return { title: idea.slice(0, 100), summary: idea, description: response, proposalType };

    let description = parsed.description;
    if (typeof description === 'object' && description !== null) {
      description = Object.entries(description).map(([k, v]) => `## ${k.replace(/([A-Z])/g, ' $1').trim()}\n${typeof v === 'object' ? JSON.stringify(v, null, 2) : v}`).join('\n\n');
    }

    return { title: parsed.title, summary: parsed.summary, description: description as string, proposalType };
  }

  quickScore(draft: ProposalDraft): number {
    let score = 0;
    if (draft.title.length >= 10) score += 15;
    if (draft.summary && draft.summary.length >= 50) score += 15;
    if (draft.description.length >= 200) score += 20;
    if (draft.description.length >= 500) score += 15;
    const desc = draft.description.toLowerCase();
    if (desc.includes('problem') || desc.includes('solution')) score += 15;
    if (desc.includes('timeline') || desc.includes('budget')) score += 10;
    if (desc.includes('risk')) score += 10;
    return Math.min(100, score);
  }

  getContentHash(draft: ProposalDraft): string {
    return keccak256(toUtf8Bytes(JSON.stringify({ title: draft.title, summary: draft.summary, description: draft.description, proposalType: draft.proposalType })));
  }

  /**
   * Sign a quality attestation for on-chain verification
   * 
   * @param draft The proposal draft
   * @param assessment The quality assessment result
   * @param submitterAddress The address that will submit the proposal
   * @param assessorKey Private key of the authorized assessor
   * @param chainId The chain ID for replay protection
   * @returns QualityAttestation with signature
   */
  async signAttestation(
    draft: ProposalDraft,
    assessment: QualityAssessment,
    submitterAddress: string,
    assessorKey: string,
    chainId: number
  ): Promise<QualityAttestation> {
    if (!assessment.readyToSubmit) {
      throw new Error(`Quality score ${assessment.overallScore} below 90 threshold`);
    }

    const contentHash = this.getContentHash(draft);
    const score = Math.round(assessment.overallScore);
    const timestamp = Math.floor(Date.now() / 1000);

    // Build the message hash (must match QualityOracle.sol)
    const messageHash = solidityPackedKeccak256(
      ['string', 'bytes32', 'uint256', 'uint256', 'address', 'uint256'],
      ['JejuQualityAttestation', contentHash, score, timestamp, submitterAddress, chainId]
    );

    // Sign with EIP-191 personal sign
    const wallet = new Wallet(assessorKey);
    const signature = await wallet.signMessage(getBytes(messageHash));

    return {
      contentHash,
      score,
      timestamp,
      submitter: submitterAddress,
      signature,
      assessor: wallet.address,
    };
  }

  /**
   * Full workflow: assess quality and sign if ready
   */
  async assessAndSign(
    draft: ProposalDraft,
    submitterAddress: string,
    assessorKey: string,
    chainId: number
  ): Promise<{ assessment: QualityAssessment; attestation: QualityAttestation | null }> {
    const assessment = await this.assessQuality(draft);

    if (!assessment.readyToSubmit) {
      return { assessment, attestation: null };
    }

    const attestation = await this.signAttestation(draft, assessment, submitterAddress, assessorKey, chainId);
    return { assessment, attestation };
  }
}

let instance: ProposalAssistant | null = null;

export function getProposalAssistant(blockchain: CouncilBlockchain): ProposalAssistant {
  return instance ??= new ProposalAssistant(blockchain);
}

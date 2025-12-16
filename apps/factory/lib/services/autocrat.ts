/**
 * Autocrat Integration Service
 * Connects Factory to the AI CEO governance system for:
 * - Submitting work feedback to AI CEO
 * - Governance proposals from bounty completions
 * - Reputation updates
 * - Council deliberation on disputes
 */

const AUTOCRAT_API = process.env.NEXT_PUBLIC_AUTOCRAT_URL || 'http://localhost:4040';

// ============ Types ============

export interface Proposal {
  id: string;
  title: string;
  description: string;
  type: 'parameter' | 'spend' | 'upgrade' | 'membership' | 'bounty_completion' | 'dispute_resolution';
  status: 'draft' | 'intake' | 'deliberation' | 'ceo_review' | 'approved' | 'rejected' | 'executed';
  proposer: string;
  createdAt: number;
  votingEndsAt?: number;
  executionDelay?: number;
  metadata?: {
    bountyId?: string;
    disputeId?: string;
    agentId?: string;
    amount?: string;
  };
}

export interface CouncilVote {
  role: 'treasury' | 'code' | 'community' | 'security' | 'legal';
  vote: 'approve' | 'reject' | 'abstain' | 'request_changes';
  reasoning: string;
  confidence: number;
  timestamp: number;
}

export interface CEODecision {
  proposalId: string;
  approved: boolean;
  reasoning: string;
  confidence: number;
  alignment: number;
  recommendations: string[];
  timestamp: number;
}

export interface WorkFeedback {
  feedbackId: string;
  bountyId?: string;
  agentId?: string;
  workerAddress: string;
  reviewer: string;
  rating: number; // 1-5
  categories: {
    quality: number;
    timeliness: number;
    communication: number;
    expertise: number;
  };
  comments: string;
  createdAt: number;
}

export interface ReputationUpdate {
  address: string;
  agentId?: string;
  change: number;
  reason: string;
  source: 'bounty_completion' | 'dispute_resolution' | 'peer_review' | 'guardian_validation';
  timestamp: number;
}

// ============ Autocrat Service ============

class AutocratService {
  private headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  setAuth(address: string, signature: string, timestamp: string) {
    this.headers['x-jeju-address'] = address;
    this.headers['x-jeju-signature'] = signature;
    this.headers['x-jeju-timestamp'] = timestamp;
  }

  // ============ Proposals ============

  /**
   * Submit a proposal for governance consideration
   */
  async submitProposal(params: {
    title: string;
    description: string;
    type: Proposal['type'];
    metadata?: Proposal['metadata'];
  }): Promise<Proposal> {
    const response = await fetch(`${AUTOCRAT_API}/api/v1/proposals`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(params),
    });

    if (!response.ok) throw new Error('Failed to submit proposal');
    return response.json();
  }

  /**
   * Submit bounty completion for governance review
   * Creates a proposal that goes through AI council deliberation
   */
  async submitBountyCompletion(params: {
    bountyId: string;
    title: string;
    description: string;
    deliverableUri: string;
    totalPaid: string;
    workerAddress: string;
    workerAgentId?: string;
  }): Promise<Proposal> {
    return this.submitProposal({
      title: `Bounty Completion: ${params.title}`,
      description: `${params.description}\n\nDeliverables: ${params.deliverableUri}\nTotal Paid: ${params.totalPaid}`,
      type: 'bounty_completion',
      metadata: {
        bountyId: params.bountyId,
        agentId: params.workerAgentId,
        amount: params.totalPaid,
      },
    });
  }

  /**
   * Submit dispute for governance resolution
   */
  async submitDispute(params: {
    bountyId: string;
    disputeReason: string;
    evidenceUri: string;
    disputedAmount: string;
  }): Promise<Proposal> {
    return this.submitProposal({
      title: `Dispute: Bounty ${params.bountyId}`,
      description: `${params.disputeReason}\n\nEvidence: ${params.evidenceUri}`,
      type: 'dispute_resolution',
      metadata: {
        bountyId: params.bountyId,
        disputeId: `dispute-${params.bountyId}-${Date.now()}`,
        amount: params.disputedAmount,
      },
    });
  }

  /**
   * Get proposal by ID
   */
  async getProposal(proposalId: string): Promise<Proposal | null> {
    const response = await fetch(`${AUTOCRAT_API}/api/v1/proposals/${proposalId}`, {
      headers: this.headers,
    });

    if (!response.ok) return null;
    return response.json();
  }

  /**
   * Get council votes for a proposal
   */
  async getCouncilVotes(proposalId: string): Promise<CouncilVote[]> {
    const response = await fetch(`${AUTOCRAT_API}/api/v1/proposals/${proposalId}/votes`, {
      headers: this.headers,
    });

    if (!response.ok) throw new Error('Failed to fetch votes');
    const data = await response.json() as { votes: CouncilVote[] };
    return data.votes;
  }

  /**
   * Get CEO decision for a proposal
   */
  async getCEODecision(proposalId: string): Promise<CEODecision | null> {
    const response = await fetch(`${AUTOCRAT_API}/api/v1/proposals/${proposalId}/decision`, {
      headers: this.headers,
    });

    if (!response.ok) return null;
    return response.json();
  }

  // ============ Work Feedback ============

  /**
   * Submit work feedback (affects reputation)
   */
  async submitWorkFeedback(params: {
    bountyId?: string;
    agentId?: string;
    workerAddress: string;
    rating: number;
    categories: WorkFeedback['categories'];
    comments: string;
  }): Promise<WorkFeedback> {
    const response = await fetch(`${AUTOCRAT_API}/api/v1/feedback`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(params),
    });

    if (!response.ok) throw new Error('Failed to submit feedback');
    return response.json();
  }

  /**
   * Get feedback for a worker/agent
   */
  async getWorkerFeedback(address: string): Promise<WorkFeedback[]> {
    const response = await fetch(`${AUTOCRAT_API}/api/v1/feedback?worker=${address}`, {
      headers: this.headers,
    });

    if (!response.ok) throw new Error('Failed to fetch feedback');
    const data = await response.json() as { feedback: WorkFeedback[] };
    return data.feedback;
  }

  /**
   * Get aggregated worker rating
   */
  async getWorkerRating(address: string): Promise<{
    overall: number;
    totalReviews: number;
    categories: WorkFeedback['categories'];
  }> {
    const response = await fetch(`${AUTOCRAT_API}/api/v1/reputation/${address}/rating`, {
      headers: this.headers,
    });

    if (!response.ok) throw new Error('Failed to fetch rating');
    return response.json();
  }

  // ============ Reputation ============

  /**
   * Get reputation score for an address/agent
   */
  async getReputation(address: string): Promise<{
    score: number;
    level: string;
    history: ReputationUpdate[];
  }> {
    const response = await fetch(`${AUTOCRAT_API}/api/v1/reputation/${address}`, {
      headers: this.headers,
    });

    if (!response.ok) throw new Error('Failed to fetch reputation');
    return response.json();
  }

  /**
   * Report reputation event (guardian/admin only)
   */
  async reportReputationEvent(params: {
    address: string;
    agentId?: string;
    change: number;
    reason: string;
    source: ReputationUpdate['source'];
  }): Promise<ReputationUpdate> {
    const response = await fetch(`${AUTOCRAT_API}/api/v1/reputation/report`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(params),
    });

    if (!response.ok) throw new Error('Failed to report reputation event');
    return response.json();
  }

  // ============ AI CEO Direct Access ============

  /**
   * Ask AI CEO for decision/recommendation (A2A)
   */
  async askCEO(params: {
    question: string;
    context?: Record<string, unknown>;
  }): Promise<{
    response: string;
    confidence: number;
    recommendations: string[];
  }> {
    const response = await fetch(`${AUTOCRAT_API}/a2a`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        skillId: 'ask_ceo',
        params,
      }),
    });

    if (!response.ok) throw new Error('CEO consultation failed');
    const data = await response.json() as { data: {
      response: string;
      confidence: number;
      recommendations: string[];
    } };
    return data.data;
  }

  /**
   * Get CEO's view on bounty quality/value
   */
  async evaluateBounty(bountyId: string, deliverableUri: string): Promise<{
    qualityScore: number;
    valueScore: number;
    feedback: string;
    shouldApprove: boolean;
    concerns: string[];
  }> {
    const response = await fetch(`${AUTOCRAT_API}/a2a`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        skillId: 'evaluate_bounty',
        params: { bountyId, deliverableUri },
      }),
    });

    if (!response.ok) throw new Error('Bounty evaluation failed');
    const data = await response.json() as { data: {
      qualityScore: number;
      valueScore: number;
      feedback: string;
      shouldApprove: boolean;
      concerns: string[];
    } };
    return data.data;
  }

  /**
   * Request council deliberation on a matter
   */
  async requestDeliberation(params: {
    topic: string;
    context: string;
    urgency: 'low' | 'medium' | 'high';
  }): Promise<{
    deliberationId: string;
    estimatedCompletion: number;
  }> {
    const response = await fetch(`${AUTOCRAT_API}/a2a`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        skillId: 'request_deliberation',
        params,
      }),
    });

    if (!response.ok) throw new Error('Deliberation request failed');
    const data = await response.json() as { data: {
      deliberationId: string;
      estimatedCompletion: number;
    } };
    return data.data;
  }

  // ============ Governance Stats ============

  /**
   * Get governance statistics
   */
  async getGovernanceStats(): Promise<{
    totalProposals: number;
    approvedProposals: number;
    rejectedProposals: number;
    pendingProposals: number;
    averageDeliberationTime: number;
    ceoApprovalRate: number;
  }> {
    const response = await fetch(`${AUTOCRAT_API}/api/v1/stats`, {
      headers: this.headers,
    });

    if (!response.ok) throw new Error('Failed to fetch stats');
    return response.json();
  }
}

export const autocratService = new AutocratService();


/**
 * useGovernance - React hooks for AI DAO governance integration
 * 
 * Provides access to:
 * - Proposals and voting
 * - Delegation and security council
 * - Agent eligibility checks
 * - Registry integration data
 */

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';

const COUNCIL_API = process.env.NEXT_PUBLIC_COUNCIL_API || 'http://localhost:8010';

// ============================================================================
// Types
// ============================================================================

export interface AgentProfile {
  agentId: string;
  owner: string;
  stakeTier: number;
  stakedAmount: string;
  registeredAt: number;
  lastActivityAt: number;
  isBanned: boolean;
  feedbackCount: number;
  averageReputation: number;
  violationCount: number;
  compositeScore: number;
  tags: string[];
  a2aEndpoint: string;
  mcpEndpoint: string;
}

export interface VotingPower {
  baseVotes: string;
  reputationMultiplier: number;
  stakeMultiplier: number;
  effectiveVotes: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
}

export interface Eligibility {
  canSubmitProposal: EligibilityResult;
  canVote: EligibilityResult;
  canConductResearch: EligibilityResult;
}

export interface Delegate {
  delegate: string;
  agentId: string;
  name: string;
  totalDelegated: string;
  delegatorCount: number;
  isActive: boolean;
}

export interface SecurityCouncilMember {
  member: string;
  agentId: string;
  combinedScore: number;
  electedAt: number;
}

export interface Proposal {
  proposalId: string;
  proposer: string;
  proposerAgentId: string;
  proposalType: number;
  status: number;
  qualityScore: number;
  createdAt: number;
  councilVoteEnd: number;
  gracePeriodEnd: number;
  contentHash: string;
  targetContract: string;
  value: string;
  totalStaked: string;
  totalReputation: string;
  backerCount: number;
  hasResearch: boolean;
  ceoApproved: boolean;
}

export interface CouncilHealth {
  status: string;
  version: string;
  orchestrator: boolean;
  erc8004: {
    identity: boolean;
    reputation: boolean;
    validation: boolean;
  };
  futarchy: {
    council: boolean;
    predimarket: boolean;
  };
  registry: {
    integration: boolean;
    delegation: boolean;
  };
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchApi<T>(path: string): Promise<T> {
  const response = await fetch(`${COUNCIL_API}${path}`);
  if (!response.ok) throw new Error(`API error: ${response.statusText}`);
  return response.json();
}

async function postApi<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${COUNCIL_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`API error: ${response.statusText}`);
  return response.json();
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get council health status
 */
export function useCouncilHealth() {
  const [health, setHealth] = useState<CouncilHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetchApi<CouncilHealth>('/health')
      .then(setHealth)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, []);

  return { health, isLoading, error };
}

/**
 * Get agent profile with composite score
 */
export function useAgentProfile(agentId: string | undefined) {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!agentId) {
      setProfile(null);
      return;
    }
    
    setIsLoading(true);
    fetchApi<AgentProfile>(`/api/v1/registry/profile/${agentId}`)
      .then(setProfile)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [agentId]);

  return { profile, isLoading, error };
}

/**
 * Get voting power for current connected wallet
 */
export function useVotingPower(agentId?: string, baseVotes?: string) {
  const { address, isConnected } = useAccount();
  const [power, setPower] = useState<VotingPower | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setPower(null);
      return;
    }
    
    setIsLoading(true);
    const params = new URLSearchParams();
    if (agentId) params.set('agentId', agentId);
    if (baseVotes) params.set('baseVotes', baseVotes);
    
    fetchApi<VotingPower>(`/api/v1/registry/voting-power/${address}?${params}`)
      .then(setPower)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [address, isConnected, agentId, baseVotes]);

  return { power, isLoading, error };
}

/**
 * Check eligibility for various governance actions
 */
export function useEligibility(agentId: string | undefined) {
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!agentId) {
      setEligibility(null);
      return;
    }
    
    setIsLoading(true);
    fetchApi<Eligibility>(`/api/v1/registry/eligibility/${agentId}`)
      .then(setEligibility)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [agentId]);

  return { eligibility, isLoading, error };
}

/**
 * Get top agents by composite score
 */
export function useTopAgents(count = 10) {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchApi<{ agents: AgentProfile[] }>(`/api/v1/registry/top-agents?count=${count}`)
      .then(data => setAgents(data.agents))
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [count]);

  useEffect(() => refresh(), [refresh]);

  return { agents, isLoading, error, refresh };
}

/**
 * Search agents by tag
 */
export function useAgentsByTag(tag: string | undefined, offset = 0, limit = 50) {
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!tag) {
      setAgentIds([]);
      setTotal(0);
      return;
    }
    
    setIsLoading(true);
    fetchApi<{ agentIds: string[]; total: number }>(`/api/v1/registry/search/tag/${encodeURIComponent(tag)}?offset=${offset}&limit=${limit}`)
      .then(data => {
        setAgentIds(data.agentIds);
        setTotal(data.total);
      })
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [tag, offset, limit]);

  return { agentIds, total, isLoading, error };
}

/**
 * Get top delegates
 */
export function useTopDelegates(limit = 10) {
  const [delegates, setDelegates] = useState<Delegate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchApi<{ delegates: Delegate[] }>(`/api/v1/registry/top-delegates?limit=${limit}`)
      .then(data => setDelegates(data.delegates))
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [limit]);

  useEffect(() => refresh(), [refresh]);

  return { delegates, isLoading, error, refresh };
}

/**
 * Get security council members
 */
export function useSecurityCouncil() {
  const [members, setMembers] = useState<SecurityCouncilMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchApi<{ members: SecurityCouncilMember[] }>('/api/v1/registry/security-council')
      .then(data => setMembers(data.members))
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => refresh(), [refresh]);

  return { members, isLoading, error, refresh };
}

/**
 * Check if current wallet is security council member
 */
export function useIsSecurityCouncilMember() {
  const { address, isConnected } = useAccount();
  const [isMember, setIsMember] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setIsMember(false);
      return;
    }
    
    setIsLoading(true);
    fetchApi<{ isMember: boolean }>(`/api/v1/registry/is-council-member/${address}`)
      .then(data => setIsMember(data.isMember))
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [address, isConnected]);

  return { isMember, isLoading, error };
}

/**
 * Get proposals
 */
export function useProposals(activeOnly = false) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchApi<{ proposals: Proposal[] }>(`/api/v1/proposals?active=${activeOnly}`)
      .then(data => setProposals(data.proposals ?? []))
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [activeOnly]);

  useEffect(() => refresh(), [refresh]);

  return { proposals, isLoading, error, refresh };
}

/**
 * Get single proposal
 */
export function useProposal(proposalId: string | undefined) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!proposalId) {
      setProposal(null);
      return;
    }
    
    setIsLoading(true);
    fetchApi<Proposal>(`/api/v1/proposals/${proposalId}`)
      .then(setProposal)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [proposalId]);

  return { proposal, isLoading, error };
}

/**
 * Get CEO status
 */
export function useCEOStatus() {
  const [status, setStatus] = useState<{ active: boolean; agentId: string; pendingDecisions: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchApi<{ active: boolean; agentId: string; pendingDecisions: number }>('/api/v1/ceo')
      .then(setStatus)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => refresh(), [refresh]);

  return { status, isLoading, error, refresh };
}

/**
 * Get governance stats
 */
export function useGovernanceStats() {
  const [stats, setStats] = useState<{
    totalProposals: number;
    activeProposals: number;
    executedProposals: number;
    rejectedProposals: number;
    totalStaked: string;
    totalDelegated: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchApi<typeof stats>('/api/v1/governance/stats')
      .then(data => setStats(data))
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => refresh(), [refresh]);

  return { stats, isLoading, error, refresh };
}

/**
 * Submit a proposal assessment
 */
export function useProposalAssessment() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const assess = useCallback(async (draft: { title: string; description: string; proposalType?: number; targetContract?: string; value?: string }) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await postApi<{
        overallScore: number;
        criteria: Record<string, { score: number; feedback: string }>;
        suggestions: string[];
        contentHash: string;
      }>('/api/v1/proposals/assess', draft);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Assessment failed'));
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { assess, isLoading, error };
}

/**
 * Generate a proposal from an idea
 */
export function useProposalGenerator() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const generate = useCallback(async (idea: string, proposalType = 0) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await postApi<{
        title: string;
        description: string;
        proposalType: number;
        targetContract?: string;
        value?: string;
      }>('/api/v1/proposals/generate', { idea, proposalType });
      return result;
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Generation failed'));
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { generate, isLoading, error };
}

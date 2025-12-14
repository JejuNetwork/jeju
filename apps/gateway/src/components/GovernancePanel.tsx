'use client';

/**
 * GovernancePanel - AI DAO Governance Overview
 * 
 * Displays:
 * - Security council members
 * - Active proposals
 * - Delegation status
 * - Agent eligibility
 */

import { useState } from 'react';
import {
  useSecurityCouncil,
  useTopDelegates,
  useProposals,
  useCEOStatus,
  useCouncilHealth,
  useIsSecurityCouncilMember,
  useEligibility,
} from '../hooks/useGovernance';
import { useAccount } from 'wagmi';

interface ProposalStatusBadgeProps {
  status: string;
}

function ProposalStatusBadge({ status }: ProposalStatusBadgeProps) {
  const colors: Record<string, string> = {
    SUBMITTED: 'bg-blue-100 text-blue-800',
    COUNCIL_REVIEW: 'bg-yellow-100 text-yellow-800',
    APPROVED: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800',
    COMPLETED: 'bg-gray-100 text-gray-800',
    VETOED: 'bg-purple-100 text-purple-800',
    FUTARCHY_PENDING: 'bg-orange-100 text-orange-800',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

interface SecurityCouncilCardProps {
  members: Array<{
    member: string;
    agentId: string;
    combinedScore: number;
    electedAt: number;
  }>;
  isLoading: boolean;
}

function SecurityCouncilCard({ members, isLoading }: SecurityCouncilCardProps) {
  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow animate-pulse">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
      <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
        <span className="text-2xl">🛡️</span>
        Security Council
      </h3>
      {members.length === 0 ? (
        <p className="text-gray-500 text-sm">No council members elected</p>
      ) : (
        <ul className="space-y-2">
          {members.map((m, i) => (
            <li key={m.member} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className="font-mono text-gray-600 dark:text-gray-400">
                  {i + 1}.
                </span>
                <span className="font-mono truncate max-w-[120px]">
                  {m.member.slice(0, 6)}...{m.member.slice(-4)}
                </span>
              </span>
              <span className="text-xs bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                Score: {m.combinedScore}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface DelegatesCardProps {
  delegates: Array<{
    delegate: string;
    agentId: string;
    name: string;
    totalDelegated: string;
    delegatorCount: number;
    isActive: boolean;
  }>;
  isLoading: boolean;
}

function DelegatesCard({ delegates, isLoading }: DelegatesCardProps) {
  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow animate-pulse">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
      <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
        <span className="text-2xl">🗳️</span>
        Top Delegates
      </h3>
      {delegates.length === 0 ? (
        <p className="text-gray-500 text-sm">No delegates registered</p>
      ) : (
        <ul className="space-y-2">
          {delegates.map(d => (
            <li key={d.delegate} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${d.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="font-medium truncate max-w-[100px]">{d.name || 'Anonymous'}</span>
              </span>
              <span className="text-xs text-gray-500">
                {d.delegatorCount} delegators
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ProposalsCardProps {
  proposals: Array<{
    proposalId: string;
    status: number;
    proposalType: number;
    createdAt: number;
  }>;
  isLoading: boolean;
}

function ProposalsCard({ proposals, isLoading }: ProposalsCardProps) {
  const statusNames = [
    'SUBMITTED', 'COUNCIL_REVIEW', 'RESEARCH_PENDING', 'COUNCIL_FINAL',
    'CEO_QUEUE', 'APPROVED', 'EXECUTING', 'COMPLETED', 'REJECTED',
    'VETOED', 'FUTARCHY_PENDING', 'FUTARCHY_APPROVED', 'FUTARCHY_REJECTED'
  ];

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow animate-pulse">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
      <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
        <span className="text-2xl">📜</span>
        Active Proposals
      </h3>
      {proposals.length === 0 ? (
        <p className="text-gray-500 text-sm">No active proposals</p>
      ) : (
        <ul className="space-y-2">
          {proposals.slice(0, 5).map(p => (
            <li key={p.proposalId} className="flex items-center justify-between text-sm">
              <span className="font-mono text-gray-600 dark:text-gray-400 truncate max-w-[120px]">
                {p.proposalId.slice(0, 10)}...
              </span>
              <ProposalStatusBadge status={statusNames[p.status] || 'UNKNOWN'} />
            </li>
          ))}
        </ul>
      )}
      {proposals.length > 5 && (
        <p className="text-xs text-gray-500 mt-2">
          +{proposals.length - 5} more proposals
        </p>
      )}
    </div>
  );
}

interface CEOStatusCardProps {
  status: { active: boolean; agentId: string; pendingDecisions: number } | null;
  isLoading: boolean;
}

function CEOStatusCard({ status, isLoading }: CEOStatusCardProps) {
  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow animate-pulse">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-4" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
      <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
        <span className="text-2xl">🤖</span>
        AI CEO Status
      </h3>
      {status ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${status.active ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm">{status.active ? 'Active' : 'Inactive'}</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Agent ID: {status.agentId || 'Not set'}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Pending: {status.pendingDecisions} decisions
          </p>
        </div>
      ) : (
        <p className="text-gray-500 text-sm">CEO status unavailable</p>
      )}
    </div>
  );
}

export default function GovernancePanel({ agentId }: { agentId?: string }) {
  const { isConnected, address } = useAccount();
  const { health, isLoading: healthLoading } = useCouncilHealth();
  const { members, isLoading: councilLoading } = useSecurityCouncil();
  const { delegates, isLoading: delegatesLoading } = useTopDelegates(5);
  const { proposals, isLoading: proposalsLoading } = useProposals(true);
  const { status: ceoStatus, isLoading: ceoLoading } = useCEOStatus();
  const { isMember: isCouncilMember } = useIsSecurityCouncilMember();
  const { eligibility, isLoading: eligibilityLoading } = useEligibility(agentId);

  const [activeTab, setActiveTab] = useState<'overview' | 'eligibility'>('overview');

  if (healthLoading) {
    return (
      <div className="p-6 text-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
        <p className="mt-2 text-gray-500">Loading governance...</p>
      </div>
    );
  }

  if (!health || health.status !== 'ok') {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
        <p className="text-yellow-800 dark:text-yellow-200">
          Governance service unavailable. Some features may be limited.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">AI DAO Governance</h2>
        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
          v{health.version}
        </span>
      </div>

      {/* User Status */}
      {isConnected && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">
              Connected: <span className="font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
            </span>
            {isCouncilMember && (
              <span className="bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-2 py-0.5 rounded text-xs">
                🛡️ Security Council
              </span>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === 'overview'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Overview
        </button>
        {agentId && (
          <button
            onClick={() => setActiveTab('eligibility')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === 'eligibility'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Eligibility
          </button>
        )}
      </div>

      {/* Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CEOStatusCard status={ceoStatus} isLoading={ceoLoading} />
          <SecurityCouncilCard members={members} isLoading={councilLoading} />
          <DelegatesCard delegates={delegates} isLoading={delegatesLoading} />
          <ProposalsCard proposals={proposals} isLoading={proposalsLoading} />
        </div>
      )}

      {activeTab === 'eligibility' && agentId && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
          <h3 className="font-semibold text-lg mb-4">Agent Eligibility</h3>
          {eligibilityLoading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
              ))}
            </div>
          ) : eligibility ? (
            <div className="space-y-3">
              <EligibilityRow
                label="Submit Proposals"
                result={eligibility.canSubmitProposal}
              />
              <EligibilityRow
                label="Vote on Proposals"
                result={eligibility.canVote}
              />
              <EligibilityRow
                label="Conduct Research"
                result={eligibility.canConductResearch}
              />
            </div>
          ) : (
            <p className="text-gray-500">Unable to check eligibility</p>
          )}
        </div>
      )}
    </div>
  );
}

function EligibilityRow({ label, result }: { label: string; result: { eligible: boolean; reason: string } }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        {result.eligible ? (
          <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
            <span>✓</span> Eligible
          </span>
        ) : (
          <span className="text-red-600 dark:text-red-400 flex items-center gap-1" title={result.reason}>
            <span>✗</span> Not Eligible
          </span>
        )}
      </div>
    </div>
  );
}

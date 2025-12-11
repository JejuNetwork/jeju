'use client';

import { useState } from 'react';
import { useReadContract, useAccount } from 'wagmi';
import { Shield, Flag, Clock, CheckCircle, Scale, Users, TrendingUp, AlertTriangle, Gavel, Eye } from 'lucide-react';
import ReportSubmissionForm from '../../components/moderation/ReportSubmissionForm';
import BanVotingInterface from '../../components/moderation/BanVotingInterface';
import { MODERATION_CONTRACTS } from '../../config/moderation';
import { IPFS_GATEWAY_URL } from '../../config';
import { formatEther } from 'viem';
import { ZERO_BYTES32 } from '../../lib/contracts';

type TabType = 'overview' | 'active' | 'resolved' | 'submit' | 'labels' | 'bans';

const REPORTING_SYSTEM_ABI = [
  {
    name: 'getAllReports',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'getReport',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'reportId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'reportId', type: 'uint256' },
          { name: 'reportType', type: 'uint8' },
          { name: 'severity', type: 'uint8' },
          { name: 'targetAgentId', type: 'uint256' },
          { name: 'sourceAppId', type: 'bytes32' },
          { name: 'reporter', type: 'address' },
          { name: 'reporterAgentId', type: 'uint256' },
          { name: 'evidenceHash', type: 'bytes32' },
          { name: 'details', type: 'string' },
          { name: 'marketId', type: 'bytes32' },
          { name: 'reportBond', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'votingEnds', type: 'uint256' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
] as const;

const MODERATION_MARKETPLACE_ABI = [
  {
    name: 'getAllCaseIds',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    name: 'totalStaked',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getModeratorReputation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'moderator', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'successfulBans', type: 'uint256' },
          { name: 'unsuccessfulBans', type: 'uint256' },
          { name: 'totalSlashedFrom', type: 'uint256' },
          { name: 'totalSlashedOthers', type: 'uint256' },
          { name: 'reputationScore', type: 'uint256' },
          { name: 'lastReportTimestamp', type: 'uint256' },
          { name: 'reportCooldownUntil', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'canReport',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const REPORT_TYPES = ['Network Ban', 'App Ban', 'Hacker Label', 'Scammer Label'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const STATUS_NAMES = ['Pending', 'Resolved (YES)', 'Resolved (NO)', 'Executed'];

export default function ModerationDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const { address, isConnected } = useAccount();

  // Query all reports
  const { data: reportIds, isLoading } = useReadContract({
    address: MODERATION_CONTRACTS.ReportingSystem as `0x${string}`,
    abi: REPORTING_SYSTEM_ABI,
    functionName: 'getAllReports',
  });

  // Query marketplace data
  const { data: caseIds } = useReadContract({
    address: MODERATION_CONTRACTS.ModerationMarketplace as `0x${string}`,
    abi: MODERATION_MARKETPLACE_ABI,
    functionName: 'getAllCaseIds',
  });

  const { data: totalStaked } = useReadContract({
    address: MODERATION_CONTRACTS.ModerationMarketplace as `0x${string}`,
    abi: MODERATION_MARKETPLACE_ABI,
    functionName: 'totalStaked',
  });

  const { data: userRep } = useReadContract({
    address: MODERATION_CONTRACTS.ModerationMarketplace as `0x${string}`,
    abi: MODERATION_MARKETPLACE_ABI,
    functionName: 'getModeratorReputation',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: canReport } = useReadContract({
    address: MODERATION_CONTRACTS.ModerationMarketplace as `0x${string}`,
    abi: MODERATION_MARKETPLACE_ABI,
    functionName: 'canReport',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600">
        <div className="max-w-7xl mx-auto px-8 py-8">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="text-white" size={36} />
            <h1 className="text-3xl font-bold text-white">Moderation Governance</h1>
          </div>
          <p className="text-blue-100 max-w-2xl">
            Decentralized moderation powered by futarchy governance. Review reports, vote on cases, and help maintain network safety through transparent decision-making.
          </p>
          
          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
              <div className="text-blue-100 text-sm">Total Reports</div>
              <div className="text-2xl font-bold text-white">{reportIds?.length || 0}</div>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
              <div className="text-blue-100 text-sm">Active Cases</div>
              <div className="text-2xl font-bold text-white">{caseIds?.length || 0}</div>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
              <div className="text-blue-100 text-sm">Total Staked</div>
              <div className="text-2xl font-bold text-white">
                {totalStaked ? formatEther(totalStaked).slice(0, 6) : '0'} ETH
              </div>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
              <div className="text-blue-100 text-sm">Your Rep Score</div>
              <div className="text-2xl font-bold text-white">
                {userRep?.reputationScore?.toString() || '7000'} / 10000
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-8">
          <div className="flex gap-1 overflow-x-auto">
            {[
              { id: 'overview', label: 'Overview', icon: Eye },
              { id: 'active', label: 'Active Reports', icon: Clock },
              { id: 'resolved', label: 'Resolved', icon: CheckCircle },
              { id: 'labels', label: 'Labels', icon: Scale },
              { id: 'bans', label: 'Bans', icon: AlertTriangle },
              { id: 'submit', label: 'Submit Report', icon: Flag },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`py-4 px-4 border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <tab.icon size={18} />
                  {tab.label}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Your Moderation Status */}
            {isConnected && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Users size={24} className="text-blue-500" />
                  Your Moderation Status
                </h2>
                <div className="grid md:grid-cols-4 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm text-gray-500">Reputation Score</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {userRep?.reputationScore?.toString() || '7000'}
                    </div>
                    <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-500"
                        style={{ width: `${(Number(userRep?.reputationScore || 7000) / 10000) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm text-gray-500">Successful Reports</div>
                    <div className="text-2xl font-bold text-green-600">
                      {userRep?.successfulBans?.toString() || '0'}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm text-gray-500">Failed Reports</div>
                    <div className="text-2xl font-bold text-red-600">
                      {userRep?.unsuccessfulBans?.toString() || '0'}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm text-gray-500">Can Report</div>
                    <div className={`text-2xl font-bold ${canReport ? 'text-green-600' : 'text-red-600'}`}>
                      {canReport ? 'Yes ✓' : 'No ✗'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* How It Works */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Scale size={24} className="text-indigo-500" />
                How Governance Works
              </h2>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <div className="text-blue-600 font-semibold mb-2">1. Stake & Report</div>
                  <p className="text-sm text-blue-700">
                    Stake ETH to become a moderator. Higher reputation = lower stake requirements. Report bad actors with evidence.
                  </p>
                </div>
                <div className="p-4 bg-indigo-50 rounded-lg">
                  <div className="text-indigo-600 font-semibold mb-2">2. Community Votes</div>
                  <p className="text-sm text-indigo-700">
                    All stakers vote on reports. Quadratic voting ensures fair representation. Early votes get bonus weight.
                  </p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                  <div className="text-purple-600 font-semibold mb-2">3. Rewards & Penalties</div>
                  <p className="text-sm text-purple-700">
                    Correct voters earn 90% of loser stake. Failed reporters lose 2x stake. Build reputation over time.
                  </p>
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <TrendingUp size={24} className="text-green-500" />
                Recent Moderation Activity
              </h2>
              {reportIds && reportIds.length > 0 ? (
                <div className="space-y-3">
                  {reportIds.slice(0, 5).map((reportId) => (
                    <ReportCard key={reportId.toString()} reportId={reportId} />
                  ))}
                  <button
                    onClick={() => setActiveTab('active')}
                    className="w-full py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    View All Reports →
                  </button>
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">No recent activity</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'submit' && (
          <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-sm p-8">
            <h2 className="text-2xl font-bold mb-6">Submit New Report</h2>
            <ReportSubmissionForm
              onSuccess={() => {
                setActiveTab('active');
              }}
            />
          </div>
        )}

        {activeTab === 'active' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Active Reports</h2>
              <div className="text-sm text-gray-600">
                {isLoading ? 'Loading...' : `${reportIds?.length || 0} total reports`}
              </div>
            </div>

            {isLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading reports...</p>
              </div>
            ) : reportIds && reportIds.length > 0 ? (
              <div className="grid gap-4">
                {reportIds.slice(0, 20).map((reportId) => (
                  <ReportCard key={reportId.toString()} reportId={reportId} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-lg">
                <Flag className="mx-auto text-gray-300 mb-4" size={48} />
                <p className="text-gray-600">No active reports</p>
                <button
                  onClick={() => setActiveTab('submit')}
                  className="mt-4 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  Submit First Report
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'resolved' && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold mb-6">Resolved Reports</h2>
            {isLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading resolved reports...</p>
              </div>
            ) : reportIds && reportIds.length > 0 ? (
              <div className="grid gap-4">
                {reportIds.slice(0, 20).map((reportId) => (
                  <ResolvedReportCard key={reportId.toString()} reportId={reportId} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-lg">
                <CheckCircle className="mx-auto text-gray-300 mb-4" size={48} />
                <p className="text-gray-600">No resolved reports yet</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'labels' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Reputation Labels</h2>
            <p className="text-gray-600">
              Labels are applied through futarchy governance. Each label proposal requires staking and community voting.
            </p>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                  <AlertTriangle className="text-red-600" size={24} />
                </div>
                <h3 className="font-semibold text-red-600 mb-2">HACKER</h3>
                <p className="text-sm text-gray-600">
                  Applied to agents who exploit vulnerabilities or engage in malicious activities. Auto-triggers network ban.
                </p>
                <div className="mt-3 text-xs text-gray-500">Stake Required: 0.1 ETH</div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-4">
                  <Flag className="text-orange-600" size={24} />
                </div>
                <h3 className="font-semibold text-orange-600 mb-2">SCAMMER</h3>
                <p className="text-sm text-gray-600">
                  Warning label for agents involved in fraudulent activities. Does not auto-ban but serves as warning.
                </p>
                <div className="mt-3 text-xs text-gray-500">Stake Required: 0.05 ETH</div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
                  <Users className="text-yellow-600" size={24} />
                </div>
                <h3 className="font-semibold text-yellow-600 mb-2">SPAM_BOT</h3>
                <p className="text-sm text-gray-600">
                  Applied to automated accounts engaged in spamming. Rate limits and restrictions apply.
                </p>
                <div className="mt-3 text-xs text-gray-500">Stake Required: 0.02 ETH</div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <Shield className="text-green-600" size={24} />
                </div>
                <h3 className="font-semibold text-green-600 mb-2">TRUSTED</h3>
                <p className="text-sm text-gray-600">
                  Positive label for agents with excellent track record. Provides benefits like lower fees and priority access.
                </p>
                <div className="mt-3 text-xs text-gray-500">Stake Required: 0.05 ETH</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'bans' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Network & App Bans</h2>
            <p className="text-gray-600">
              Bans restrict access to the Jeju network and individual applications. All bans go through governance process.
            </p>
            
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  <Gavel size={20} className="text-red-500" />
                  Network Bans
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Complete removal from Jeju network. Applies to all apps and services. Requires high severity evidence.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2 text-gray-700">
                    <CheckCircle size={16} className="text-green-500" />
                    Requires futarchy vote
                  </li>
                  <li className="flex items-center gap-2 text-gray-700">
                    <CheckCircle size={16} className="text-green-500" />
                    3-day voting period minimum
                  </li>
                  <li className="flex items-center gap-2 text-gray-700">
                    <CheckCircle size={16} className="text-green-500" />
                    Can be appealed up to 3 times
                  </li>
                </ul>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  <Flag size={20} className="text-orange-500" />
                  App-Specific Bans
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Restricted from specific application only. User can still access other Jeju apps and services.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2 text-gray-700">
                    <CheckCircle size={16} className="text-green-500" />
                    Lower stake requirement
                  </li>
                  <li className="flex items-center gap-2 text-gray-700">
                    <CheckCircle size={16} className="text-green-500" />
                    App-specific evidence needed
                  </li>
                  <li className="flex items-center gap-2 text-gray-700">
                    <CheckCircle size={16} className="text-green-500" />
                    Faster resolution time
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportCard({ reportId }: { reportId: bigint }) {
  const [showVoting, setShowVoting] = useState(false);
  const { data: report } = useReadContract({
    address: MODERATION_CONTRACTS.ReportingSystem as `0x${string}`,
    abi: REPORTING_SYSTEM_ABI,
    functionName: 'getReport',
    args: [reportId],
  });

  if (!report) return null;

  const status = Number(report.status);
  const reportType = Number(report.reportType);
  const severity = Number(report.severity);
  const timeRemaining = Number(report.votingEnds) * 1000 - Date.now();
  const isPending = status === 0;

  const severityColors = [
    'bg-blue-100 text-blue-700',
    'bg-yellow-100 text-yellow-700',
    'bg-orange-100 text-orange-700',
    'bg-red-100 text-red-700',
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-sm font-mono text-gray-500">#{reportId.toString()}</span>
            <span className={`px-2 py-1 rounded text-xs font-semibold ${severityColors[severity]}`}>
              {SEVERITIES[severity]}
            </span>
            <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
              {REPORT_TYPES[reportType]}
            </span>
          </div>
          
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            Agent #{report.targetAgentId.toString()}
          </h3>
          
          <p className="text-sm text-gray-600 line-clamp-2">{report.details}</p>
        </div>

        <div className="text-right">
          {isPending && timeRemaining > 0 ? (
            <div className="text-sm">
              <div className="text-gray-500">Voting ends in</div>
              <div className="font-semibold text-gray-900">
                {Math.floor(timeRemaining / (1000 * 60 * 60))}h
              </div>
            </div>
          ) : (
            <div className="text-sm">
              <div className="text-gray-500">Status</div>
              <div className="font-semibold text-gray-900">{STATUS_NAMES[status]}</div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>Reporter: {report.reporter.substring(0, 10)}...</span>
          <span>Bond: {Number(report.reportBond) / 1e18} ETH</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              const hash = report.evidenceHash;
              if (hash && hash !== ZERO_BYTES32) {
                // Decode bytes32 hex back to CID string (reverse of cidToBytes32)
                const hexStr = hash.slice(2).replace(/^0+/, ''); // Remove 0x and leading zeros
                const cid = hexStr ? Buffer.from(hexStr, 'hex').toString('utf8').replace(/\0/g, '') : '';
                if (cid && cid.startsWith('Qm')) {
                  window.open(`https://ipfs.io/ipfs/${cid}`, '_blank');
                } else {
                  // Fallback: try using Jeju IPFS gateway with raw hash
                  window.open(`${IPFS_GATEWAY_URL}/ipfs/${cid || hash}`, '_blank');
                }
              }
            }}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded text-sm"
          >
            View Evidence
          </button>
          <button
            onClick={() => setShowVoting(!showVoting)}
            className={`px-3 py-1.5 rounded text-sm ${showVoting ? 'bg-gray-500 text-white' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
          >
            {showVoting ? 'Hide Voting' : 'Vote'}
          </button>
        </div>
      </div>

      {showVoting && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <BanVotingInterface reportId={reportId} marketId={report.marketId} />
        </div>
      )}
    </div>
  );
}

function ResolvedReportCard({ reportId }: { reportId: bigint }) {
  const { data: report } = useReadContract({
    address: MODERATION_CONTRACTS.ReportingSystem as `0x${string}`,
    abi: REPORTING_SYSTEM_ABI,
    functionName: 'getReport',
    args: [reportId],
  });

  if (!report) return null;

  const status = Number(report.status);
  
  // Only show resolved reports (status 1, 2, or 3)
  if (status === 0) return null;

  const reportType = Number(report.reportType);
  const severity = Number(report.severity);
  const isApproved = status === 1 || status === 3;

  const severityColors = [
    'bg-blue-100 text-blue-700',
    'bg-yellow-100 text-yellow-700',
    'bg-orange-100 text-orange-700',
    'bg-red-100 text-red-700',
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-sm font-mono text-gray-500">#{reportId.toString()}</span>
            <span className={`px-2 py-1 rounded text-xs font-semibold ${severityColors[severity]}`}>
              {SEVERITIES[severity]}
            </span>
            <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
              {REPORT_TYPES[reportType]}
            </span>
            <span className={`px-2 py-1 rounded text-xs font-semibold ${
              isApproved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {STATUS_NAMES[status]}
            </span>
          </div>
          
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            Agent #{report.targetAgentId.toString()}
          </h3>
          
          <p className="text-sm text-gray-600 line-clamp-2">{report.details}</p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>Reporter: {report.reporter.substring(0, 10)}...</span>
          <span>Bond: {Number(report.reportBond) / 1e18} ETH</span>
        </div>

        <button
          onClick={() => {
            const hash = report.evidenceHash;
            if (hash && hash !== ZERO_BYTES32) {
              const hexStr = hash.slice(2).replace(/^0+/, '');
              const cid = hexStr ? Buffer.from(hexStr, 'hex').toString('utf8').replace(/\0/g, '') : '';
              if (cid && cid.startsWith('Qm')) {
                window.open(`https://ipfs.io/ipfs/${cid}`, '_blank');
              } else {
                window.open(`${IPFS_GATEWAY_URL}/ipfs/${cid || hash}`, '_blank');
              }
            }
          }}
          className="px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded text-sm"
        >
          View Evidence
        </button>
      </div>
    </div>
  );
}


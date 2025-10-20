/**
 * Moderation Dashboard
 * Central hub for all moderation activities
 */

'use client';

import { useState } from 'react';
import { useReadContract } from 'wagmi';
import { Shield, Flag, Clock, CheckCircle } from 'lucide-react';
import ReportSubmissionForm from '../../components/moderation/ReportSubmissionForm';
import { MODERATION_CONTRACTS } from '../../config/moderation';

type TabType = 'active' | 'resolved' | 'submit';

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

const REPORT_TYPES = ['Network Ban', 'App Ban', 'Hacker Label', 'Scammer Label'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const STATUS_NAMES = ['Pending', 'Resolved (YES)', 'Resolved (NO)', 'Executed'];

export default function ModerationDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('active');

  // Query all reports
  const { data: reportIds, isLoading } = useReadContract({
    address: MODERATION_CONTRACTS.ReportingSystem as `0x${string}`,
    abi: REPORTING_SYSTEM_ABI,
    functionName: 'getAllReports',
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-8 py-6">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="text-blue-500" size={32} />
            <h1 className="text-3xl font-bold text-gray-900">Moderation Dashboard</h1>
          </div>
          <p className="text-gray-600">
            Decentralized moderation powered by futarchy governance
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-8">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab('active')}
              className={`py-4 px-2 border-b-2 transition-colors ${
                activeTab === 'active'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <Clock size={18} />
                Active Reports
              </div>
            </button>
            
            <button
              onClick={() => setActiveTab('resolved')}
              className={`py-4 px-2 border-b-2 transition-colors ${
                activeTab === 'resolved'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle size={18} />
                Resolved
              </div>
            </button>
            
            <button
              onClick={() => setActiveTab('submit')}
              className={`py-4 px-2 border-b-2 transition-colors ${
                activeTab === 'submit'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <Flag size={18} />
                Submit Report
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        {activeTab === 'submit' && (
          <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-sm p-8">
            <h2 className="text-2xl font-bold mb-6">Submit New Report</h2>
            <ReportSubmissionForm
              onSuccess={() => {
                setActiveTab('active');
                // Refresh reports list
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
          <div>
            <h2 className="text-2xl font-bold mb-6">Resolved Reports</h2>
            <p className="text-gray-600">Showing resolved reports from the past 30 days...</p>
            {/* TODO: Filter by resolved status */}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Individual Report Card
 */
function ReportCard({ reportId }: { reportId: bigint }) {
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
          <a
            href={`https://ipfs.io/ipfs/${report.evidenceHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded text-sm"
          >
            View Evidence
          </a>
          <a
            href={`/moderation/report/${reportId.toString()}`}
            className="px-3 py-1.5 bg-blue-500 text-white hover:bg-blue-600 rounded text-sm"
          >
            Vote
          </a>
        </div>
      </div>
    </div>
  );
}


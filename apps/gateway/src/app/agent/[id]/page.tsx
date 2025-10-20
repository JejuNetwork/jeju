/**
 * Agent Profile Page
 * Shows complete agent information, reputation, bans, labels, reports
 */

'use client';

import { use } from 'react';
import { useReadContract } from 'wagmi';
import { Shield, AlertTriangle, Flag, Clock, TrendingUp } from 'lucide-react';
import ReputationViewer from '../../../components/moderation/ReputationViewer';
import { MODERATION_CONTRACTS } from '../../../config/moderation';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'getAgent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'tier', type: 'uint8' },
          { name: 'stakedToken', type: 'address' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastActivityAt', type: 'uint256' },
          { name: 'isBanned', type: 'bool' },
          { name: 'isSlashed', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getTags',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string[]' }],
  },
] as const;

const REPORTING_SYSTEM_ABI = [
  {
    name: 'getReportsByTarget',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
] as const;

export default function AgentProfilePage({ params }: PageProps) {
  const { id } = use(params);
  const agentId = BigInt(id);

  // Query agent data
  const { data: agentData, isLoading: loadingAgent } = useReadContract({
    address: MODERATION_CONTRACTS.IdentityRegistry as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgent',
    args: [agentId],
  });

  // Query tags
  const { data: tags } = useReadContract({
    address: MODERATION_CONTRACTS.IdentityRegistry as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getTags',
    args: [agentId],
  });

  // Query reports
  const { data: reportIds } = useReadContract({
    address: MODERATION_CONTRACTS.ReportingSystem as `0x${string}`,
    abi: REPORTING_SYSTEM_ABI,
    functionName: 'getReportsByTarget',
    args: [agentId],
  });

  if (loadingAgent) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-48 mb-4"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!agentData) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto text-center">
          <AlertTriangle className="mx-auto text-red-500 mb-4" size={48} />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Agent Not Found</h1>
          <p className="text-gray-600">Agent ID {id} does not exist in the registry.</p>
        </div>
      </div>
    );
  }

  const registeredDate = new Date(Number(agentData.registeredAt) * 1000);
  const lastActive = new Date(Number(agentData.lastActivityAt) * 1000);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Agent #{id}</h1>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <Clock size={16} />
                  Registered {registeredDate.toLocaleDateString()}
                </span>
                <span className="flex items-center gap-1">
                  <TrendingUp size={16} />
                  Active {lastActive.toLocaleDateString()}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center gap-2">
                <Flag size={16} />
                Report
              </button>
            </div>
          </div>

          {/* Tags */}
          {tags && tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span key={tag} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Owner Info */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-bold mb-4">Owner Information</h2>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Address:</span>
              <code className="font-mono text-sm">{agentData.owner}</code>
            </div>
            {agentData.isSlashed && (
              <div className="flex justify-between">
                <span className="text-gray-600">Status:</span>
                <span className="text-orange-600 font-semibold">⚠️ Slashed</span>
              </div>
            )}
          </div>
        </div>

        {/* Reputation Section */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Shield size={24} />
            Reputation & Moderation Status
          </h2>
          <ReputationViewer agentId={agentId} />
        </div>

        {/* Reports History */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-bold mb-4">Reports Against This Agent</h2>
          {reportIds && reportIds.length > 0 ? (
            <div className="space-y-3">
              {reportIds.map((reportId) => (
                <div
                  key={reportId.toString()}
                  className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Report #{reportId.toString()}</div>
                      <div className="text-sm text-gray-600">Click to view details</div>
                    </div>
                    <button className="text-blue-500 hover:text-blue-600">View →</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Flag className="mx-auto mb-2 text-gray-300" size={32} />
              <p>No reports filed against this agent</p>
            </div>
          )}
        </div>

        {/* Activity Stats */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-bold mb-4">Activity</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-600">Account Age</div>
              <div className="text-2xl font-bold">
                {Math.floor((Date.now() - Number(agentData.registeredAt) * 1000) / (1000 * 60 * 60 * 24))} days
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Last Active</div>
              <div className="text-2xl font-bold">
                {Math.floor((Date.now() - Number(agentData.lastActivityAt) * 1000) / (1000 * 60 * 60))}h ago
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


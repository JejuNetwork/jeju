/**
 * Reputation Viewer Component
 * Shows agent reputation, stake, labels, bans
 */

import { useState, useEffect } from 'react';
import { Shield, AlertTriangle, Award } from 'lucide-react';

interface ReputationViewerProps {
  agentId: bigint;
}

interface ReputationData {
  stakeTier: number;
  stakeAmount: bigint;
  networkBanned: boolean;
  appBans: string[];
  labels: string[];
  banReason?: string;
}

export default function ReputationViewer({ agentId }: ReputationViewerProps) {
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    // TODO: Query IdentityRegistry, BanManager, LabelManager
    setLoading(false);
  }, [agentId]);
  
  if (loading) {
    return <div className="animate-pulse">Loading reputation...</div>;
  }
  
  if (!reputation) {
    return <div>No reputation data</div>;
  }
  
  return (
    <div className="space-y-4">
      {/* Stake Tier */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={20} />
          <h3 className="font-semibold">Reputation Stake</h3>
        </div>
        <div className="text-2xl font-bold">
          Tier {reputation.stakeTier}: {getTierName(reputation.stakeTier)}
        </div>
        <div className="text-sm text-gray-600">
          {Number(reputation.stakeAmount) / 1e18} ETH staked
        </div>
      </div>
      
      {/* Network Ban */}
      {reputation.networkBanned && (
        <div className="card bg-red-50 border-red-300">
          <div className="flex items-center gap-2 text-red-700">
            <AlertTriangle size={20} />
            <h3 className="font-semibold">NETWORK BAN</h3>
          </div>
          <p className="text-sm text-red-600 mt-2">
            {reputation.banReason || 'Banned from entire Jeju network'}
          </p>
        </div>
      )}
      
      {/* App Bans */}
      {reputation.appBans.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-2">App Bans ({reputation.appBans.length})</h3>
          <div className="flex flex-wrap gap-2">
            {reputation.appBans.map(app => (
              <span key={app} className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-sm">
                {app}
              </span>
            ))}
          </div>
        </div>
      )}
      
      {/* Labels */}
      {reputation.labels.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-2">Labels</h3>
          <div className="flex flex-wrap gap-2">
            {reputation.labels.map(label => (
              <span key={label} className={`px-2 py-1 rounded text-sm ${getLabelColor(label)}`}>
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getTierName(tier: number): string {
  return ['None', 'Small', 'Medium', 'High'][tier] || 'Unknown';
}

function getLabelColor(label: string): string {
  if (label === 'HACKER') return 'bg-red-600 text-white';
  if (label === 'SCAMMER') return 'bg-orange-600 text-white';
  if (label === 'TRUSTED') return 'bg-green-600 text-white';
  return 'bg-gray-600 text-white';
}


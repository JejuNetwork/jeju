/**
 * @fileoverview Network-wide node staking statistics and health metrics
 * @module gateway/components/NetworkStatsCard
 */

import { useNodeStaking } from '../hooks/useNodeStaking';
import { formatUSD } from '../lib/tokenUtils';
import { Globe, Server, TrendingUp, AlertTriangle } from 'lucide-react';

export default function NetworkStatsCard() {
  const { networkStats, operatorStats } = useNodeStaking();

  if (!networkStats) {
    return (
      <div className="card">
        <p style={{ color: '#94a3b8' }}>Loading network stats...</p>
      </div>
    );
  }

  const [totalNodes, totalStakedUSD, totalRewardsClaimedUSD] = networkStats;
  
  const operatorStakeUSD = Number(operatorStats?.totalStakedUSD || 0n) / 1e18;
  const totalStakeUSD = Number(totalStakedUSD) / 1e18;
  const operatorOwnershipPercent = totalStakeUSD > 0 ? (operatorStakeUSD / totalStakeUSD) * 100 : 0;
  
  const maxOwnership = 20;
  const isNearLimit = operatorOwnershipPercent > maxOwnership * 0.8; // 80% of limit

  return (
    <div>
      {/* Network Stats */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Network Overview</h2>
        
        <div className="grid grid-3" style={{ gap: '1rem' }}>
          <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Server size={20} style={{ color: '#667eea' }} />
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Total Nodes</span>
            </div>
            <p style={{ fontSize: '2rem', fontWeight: '700', color: '#667eea', margin: 0 }}>
              {Number(totalNodes)}
            </p>
          </div>

          <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <TrendingUp size={20} style={{ color: '#16a34a' }} />
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Total Staked</span>
            </div>
            <p style={{ fontSize: '2rem', fontWeight: '700', color: '#16a34a', margin: 0 }}>
              {formatUSD(Number(totalStakedUSD) / 1e18)}
            </p>
          </div>

          <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Globe size={20} style={{ color: '#8b5cf6' }} />
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Rewards Claimed</span>
            </div>
            <p style={{ fontSize: '2rem', fontWeight: '700', color: '#8b5cf6', margin: 0 }}>
              {formatUSD(Number(totalRewardsClaimedUSD) / 1e18)}
            </p>
          </div>
        </div>
      </div>

      {/* Your Stats */}
      {operatorStats && Number(operatorStats.totalNodesActive) > 0 && (
        <div className="card">
          <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Your Network Share</h3>
          
          <div className="grid grid-2" style={{ gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Your Nodes</p>
              <p style={{ fontSize: '1.5rem', fontWeight: '600', margin: '0.25rem 0' }}>
                {Number(operatorStats.totalNodesActive)} / 5 max
              </p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Your Stake</p>
              <p style={{ fontSize: '1.5rem', fontWeight: '600', margin: '0.25rem 0' }}>
                {formatUSD(operatorStakeUSD)}
              </p>
            </div>
          </div>

          {/* Ownership Meter */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.875rem', fontWeight: '600' }}>Network Ownership</span>
              <span style={{ fontSize: '0.875rem', fontWeight: '600', color: isNearLimit ? '#f59e0b' : '#16a34a' }}>
                {operatorOwnershipPercent.toFixed(2)}% / {maxOwnership}% max
              </span>
            </div>
            <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(operatorOwnershipPercent, 100)}%`,
                  height: '100%',
                  background: isNearLimit
                    ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                    : 'linear-gradient(90deg, #16a34a, #22c55e)',
                  transition: 'width 0.3s'
                }}
              />
            </div>
            
            {isNearLimit && (
              <div style={{ padding: '0.75rem', background: '#fef3c7', borderRadius: '8px', marginTop: '0.75rem', border: '1px solid #fbbf24' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'start' }}>
                  <AlertTriangle size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '0.125rem' }} />
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: '600', color: '#92400e', margin: 0 }}>
                      ⚠️ Approaching Ownership Limit
                    </p>
                    <p style={{ fontSize: '0.75rem', color: '#92400e', margin: '0.25rem 0 0 0' }}>
                      You're at {operatorOwnershipPercent.toFixed(1)}% of the network. 
                      Limit is {maxOwnership}%. Adding more nodes may be blocked.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Token Distribution Info */}
      <div className="card" style={{ background: '#f8fafc' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>💡 Tips for Maximizing Rewards</h3>
        <ul style={{ fontSize: '0.875rem', color: '#64748b', margin: 0, paddingLeft: '1.25rem' }}>
          <li>Maintain 99%+ uptime for 2x reward multiplier</li>
          <li>Choose underserved regions (Africa, South America) for +50% bonus</li>
          <li>Stake minority tokens (&lt;10% of network) for diversity bonus (v2)</li>
          <li>Earn rewards in your preferred token - can be different from staking token</li>
        </ul>
      </div>
    </div>
  );
}


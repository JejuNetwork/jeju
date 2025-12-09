/**
 * @fileoverview Display operator's staked nodes with performance and rewards
 * @module gateway/components/MyNodesCard
 */

import { useNodeStaking, useNodeInfo, useNodeRewards } from '../hooks/useNodeStaking';
import { useProtocolTokens } from '../hooks/useProtocolTokens';
import { formatTokenAmount, formatUSD } from '../lib/tokenUtils';
import { formatUptimeScore, REGION_NAMES } from '../lib/nodeStaking';
import { Server } from 'lucide-react';

interface NodeCardProps {
  nodeId: string;
}

function NodeCard({ nodeId }: NodeCardProps) {
  const { nodeInfo } = useNodeInfo(nodeId);
  const { pendingRewardsUSD, claimRewards, isClaiming, isClaimSuccess } = useNodeRewards(nodeId);
  const { deregisterNode, isDeregistering } = useNodeStaking();
  const { getToken } = useProtocolTokens();

  if (!nodeInfo) {
    return (
      <div className="card" style={{ padding: '1rem', background: 'var(--surface-hover)' }}>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>Loading node...</p>
      </div>
    );
  }

  const [node, perf] = nodeInfo;
  const stakingTokenInfo = getToken(node.stakedToken);
  const rewardTokenInfo = getToken(node.rewardToken);

  const pendingRewardAmount = rewardTokenInfo && pendingRewardsUSD
    ? (pendingRewardsUSD * BigInt(1e18)) / BigInt(Math.floor(rewardTokenInfo.priceUSD * 1e18))
    : 0n;

  const canClaim = pendingRewardAmount > 0n;
  const daysSinceRegistration = Math.floor((Date.now() / 1000 - Number(node.registrationTime)) / 86400);
  const canDeregister = daysSinceRegistration >= 7;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1.125rem', margin: 0 }}>{node.rpcUrl}</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0' }}>
            Node ID: {nodeId.slice(0, 10)}...
          </p>
        </div>
        {node.isActive ? (
          <span className="badge badge-success">Active</span>
        ) : node.isSlashed ? (
          <span className="badge badge-error">Slashed</span>
        ) : (
          <span className="badge">Inactive</span>
        )}
      </div>

      {/* Staking Info */}
      <div className="grid grid-2" style={{ marginBottom: '1rem' }}>
        <div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Staked</p>
          <p style={{ fontSize: '1rem', fontWeight: '600', margin: '0.25rem 0' }}>
            {stakingTokenInfo && formatTokenAmount(node.stakedAmount, stakingTokenInfo.decimals, 2)} {stakingTokenInfo?.symbol}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
            ≈ {formatUSD(Number(node.stakedValueUSD) / 1e18)}
          </p>
        </div>

        <div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Pending Rewards</p>
          <p style={{ fontSize: '1rem', fontWeight: '600', margin: '0.25rem 0', color: 'var(--success)' }}>
            {rewardTokenInfo && formatTokenAmount(pendingRewardAmount, rewardTokenInfo.decimals, 2)} {rewardTokenInfo?.symbol}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
            ≈ {formatUSD(Number(pendingRewardsUSD || 0n) / 1e18)}
          </p>
        </div>
      </div>

      {/* Performance */}
      <div className="grid grid-3" style={{ marginBottom: '1rem', gap: '0.75rem' }}>
        <div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Uptime</p>
          <p style={{ fontSize: '1rem', fontWeight: '600', margin: '0.25rem 0' }}>
            {formatUptimeScore(perf.uptimeScore)}
          </p>
        </div>
        <div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Requests</p>
          <p style={{ fontSize: '1rem', fontWeight: '600', margin: '0.25rem 0' }}>
            {Number(perf.requestsServed).toLocaleString()}
          </p>
        </div>
        <div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Response</p>
          <p style={{ fontSize: '1rem', fontWeight: '600', margin: '0.25rem 0' }}>
            {Number(perf.avgResponseTime)}ms
          </p>
        </div>
      </div>

      {/* Location */}
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
        📍 {REGION_NAMES[node.geographicRegion as keyof typeof REGION_NAMES]} • Registered {daysSinceRegistration} days ago
      </p>

      {isClaimSuccess && (
        <div style={{ padding: '1rem', background: 'var(--success-soft)', borderRadius: '8px', marginBottom: '1rem' }}>
          <p style={{ color: 'var(--success)', margin: 0 }}>
            ✅ Rewards claimed successfully!
          </p>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          className="button"
          onClick={() => claimRewards(nodeId)}
          disabled={!canClaim || isClaiming || !node.isActive}
          style={{ flex: 1 }}
        >
          {isClaiming ? 'Claiming...' : `Claim ${rewardTokenInfo?.symbol || 'Rewards'}`}
        </button>
        <button
          className="button button-secondary"
          onClick={() => deregisterNode(nodeId)}
          disabled={!canDeregister || isDeregistering}
          style={{ flex: 1 }}
        >
          {isDeregistering ? 'Deregistering...' : 'Deregister'}
        </button>
      </div>

      {!canDeregister && (
        <p style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.5rem' }}>
          ⏱️ Can deregister in {7 - daysSinceRegistration} days (minimum 7-day period)
        </p>
      )}
    </div>
  );
}

export default function MyNodesCard() {
  const { operatorNodeIds } = useNodeStaking();

  if (!operatorNodeIds || operatorNodeIds.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <Server size={48} style={{ margin: '0 auto 1rem', color: 'var(--text-muted)' }} />
        <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No Nodes Yet</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Stake tokens and register a node to start earning rewards
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>
        My Nodes ({operatorNodeIds.length})
      </h2>
      
      {operatorNodeIds.map((nodeId) => (
        <NodeCard key={nodeId} nodeId={nodeId} />
      ))}
    </div>
  );
}


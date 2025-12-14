/**
 * Approvals Management View
 * Shows all token approvals and allows revoking risky ones
 */

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Shield, RefreshCw, X, ExternalLink } from 'lucide-react';
import { approvalService, type TokenApproval, type NFTApproval, type ApprovalSummary } from '../../services/approval';
import { securityEngine, type RiskLevel } from '../../services/security';
import { SUPPORTED_CHAINS, type SupportedChainId } from '../../services/rpc';
import type { Address } from 'viem';

interface ApprovalsViewProps {
  address: Address;
  onRevoke?: (approval: TokenApproval | NFTApproval) => void;
}

export function ApprovalsView({ address, onRevoke }: ApprovalsViewProps) {
  const [summary, setSummary] = useState<ApprovalSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'high' | 'unlimited'>('all');
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    setIsLoading(true);
    const data = await approvalService.getApprovals(address);
    setSummary(data);
    setIsLoading(false);
  }, [address]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleRevoke = async (approval: TokenApproval | NFTApproval) => {
    const key = `${'tokenAddress' in approval ? approval.tokenAddress : approval.contractAddress}:${approval.spender}`;
    setRevoking(key);
    onRevoke?.(approval);
    // In production, would wait for transaction confirmation
    setTimeout(() => {
      setRevoking(null);
      fetchApprovals();
    }, 2000);
  };

  const filteredApprovals = summary?.tokenApprovals.filter(a => {
    if (filter === 'high') return a.riskLevel === 'high';
    if (filter === 'unlimited') return a.isUnlimited;
    return true;
  }) || [];

  const getRiskBadge = (level: RiskLevel) => {
    const colors: Record<RiskLevel, string> = {
      safe: 'bg-green-500/20 text-green-500',
      low: 'bg-emerald-500/20 text-emerald-500',
      medium: 'bg-yellow-500/20 text-yellow-500',
      high: 'bg-orange-500/20 text-orange-500',
      critical: 'bg-red-500/20 text-red-500',
    };
    return colors[level];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Token Approvals</h2>
          <p className="text-muted-foreground">Manage your token spending permissions</p>
        </div>
        <button
          onClick={fetchApprovals}
          className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-sm text-muted-foreground">Total Approvals</div>
          <div className="text-2xl font-bold">{summary?.totalTokenApprovals || 0}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-yellow-500">
            <AlertTriangle className="w-4 h-4" />
            Unlimited
          </div>
          <div className="text-2xl font-bold">{summary?.unlimitedApprovals || 0}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-red-500">
            <Shield className="w-4 h-4" />
            High Risk
          </div>
          <div className="text-2xl font-bold">{summary?.highRiskApprovals || 0}</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {(['all', 'unlimited', 'high'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80'
            }`}
          >
            {f === 'all' ? 'All' : f === 'unlimited' ? 'Unlimited' : 'High Risk'}
          </button>
        ))}
      </div>

      {/* Approvals List */}
      {filteredApprovals.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-xl">
          <Shield className="w-12 h-12 mx-auto text-green-500 mb-4" />
          <h3 className="text-lg font-medium">No Approvals Found</h3>
          <p className="text-muted-foreground">
            {filter === 'all' ? 'You have no active token approvals.' : `No ${filter} approvals found.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredApprovals.map((approval) => {
            const chain = SUPPORTED_CHAINS[approval.chainId];
            const key = `${approval.tokenAddress}:${approval.spender}`;
            const isRevoking = revoking === key;

            return (
              <div
                key={key}
                className="bg-card border border-border rounded-xl p-4 hover:border-border/80 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Token Icon */}
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <span className="text-sm font-medium text-primary">
                        {approval.tokenSymbol.slice(0, 2)}
                      </span>
                    </div>

                    {/* Token Info */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{approval.tokenSymbol}</span>
                        <span className={`px-2 py-0.5 rounded text-xs ${getRiskBadge(approval.riskLevel)}`}>
                          {approval.riskLevel}
                        </span>
                        {approval.isUnlimited && (
                          <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-500">
                            Unlimited
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {approval.spenderName || `${approval.spender.slice(0, 10)}...${approval.spender.slice(-8)}`}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* Chain Badge */}
                    <span className="text-xs text-muted-foreground">{chain.name}</span>

                    {/* Allowance */}
                    <div className="text-right">
                      <div className="text-sm font-medium">
                        {approvalService.formatAllowance(approval.allowance, 18)}
                      </div>
                      <div className="text-xs text-muted-foreground">Allowance</div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <a
                        href={`${chain.blockExplorers.default.url}/address/${approval.spender}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 hover:bg-secondary rounded-lg"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <button
                        onClick={() => handleRevoke(approval)}
                        disabled={isRevoking}
                        className="flex items-center gap-2 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg text-sm font-medium disabled:opacity-50"
                      >
                        {isRevoking ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <X className="w-4 h-4" />
                        )}
                        Revoke
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* NFT Approvals */}
      {summary && summary.nftApprovals.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-4">NFT Approvals</h3>
          <div className="space-y-3">
            {summary.nftApprovals.map((approval) => {
              const chain = SUPPORTED_CHAINS[approval.chainId];
              return (
                <div
                  key={`${approval.contractAddress}:${approval.spender}`}
                  className="bg-card border border-border rounded-xl p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{approval.contractName}</span>
                        {approval.isApprovedForAll && (
                          <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-500">
                            All NFTs
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {approval.spenderName || approval.spender.slice(0, 16)}...
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-muted-foreground">{chain.name}</span>
                      <button
                        onClick={() => handleRevoke(approval)}
                        className="flex items-center gap-2 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg text-sm font-medium"
                      >
                        <X className="w-4 h-4" />
                        Revoke
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ApprovalsView;


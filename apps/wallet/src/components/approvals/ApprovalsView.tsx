/**
 * Approvals View Component
 * Wrapper for ApprovalManager that fetches approvals
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Address, Hex } from 'viem';
import { ApprovalManager, buildRevokeTransaction } from './ApprovalManager';
import { approvalService } from '../../services/approval';

interface ApprovalsViewProps {
  address: Address;
  chainId?: number;
}

export const ApprovalsView: React.FC<ApprovalsViewProps> = ({ address, chainId = 1 }) => {
  const [approvals, setApprovals] = useState<Parameters<typeof ApprovalManager>[0]['approvals']>([]);
  const [loading, setLoading] = useState(true);
  
  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await approvalService.getApprovals(address);
      setApprovals(data.tokenApprovals.map(a => ({
        token: {
          address: a.tokenAddress,
          symbol: a.tokenSymbol,
          name: a.tokenSymbol,
          decimals: 18, // Default, could be fetched
        },
        spender: {
          address: a.spender,
          name: a.spenderName,
          isVerified: !!a.spenderName,
          riskLevel: a.riskLevel as 'safe' | 'low' | 'medium' | 'high',
        },
        allowance: a.allowance,
        allowanceFormatted: a.isUnlimited ? '∞' : a.allowance.toString(),
        isUnlimited: a.isUnlimited,
        chainId: a.chainId,
        lastUpdated: new Date(a.lastUpdated).toISOString(),
      })));
    } catch (error) {
      console.error('Failed to fetch approvals:', error);
    } finally {
      setLoading(false);
    }
  }, [address]);
  
  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);
  
  const handleRevoke = async (approval: typeof approvals[0]) => {
    const { to, data } = buildRevokeTransaction(
      approval.token.address,
      approval.spender.address
    );
    
    // In a real app, this would use the transaction service
    console.log('Revoking approval:', { to, data });
    
    // Refresh after revoke
    await fetchApprovals();
  };
  
  const handleBatchRevoke = async (toRevoke: typeof approvals) => {
    for (const approval of toRevoke) {
      await handleRevoke(approval);
    }
  };
  
  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Token Approvals</h2>
      <ApprovalManager
        address={address}
        approvals={approvals}
        loading={loading}
        onRevoke={handleRevoke}
        onBatchRevoke={handleBatchRevoke}
        onRefresh={fetchApprovals}
      />
    </div>
  );
};

export default ApprovalsView;

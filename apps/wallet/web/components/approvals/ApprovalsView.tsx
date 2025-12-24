/**
 * Approvals View Component
 * Wrapper for ApprovalManager that fetches approvals
 */

import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import { approvalService } from '../../../api/services/approval'
import { ApprovalManager, buildRevokeTransaction } from './ApprovalManager'

interface ApprovalsViewProps {
  address: Address
  chainId?: number
}

export const ApprovalsView: React.FC<ApprovalsViewProps> = ({
  address,
  chainId: _chainId = 1,
}) => {
  const [approvals, setApprovals] = useState<
    Parameters<typeof ApprovalManager>[0]['approvals']
  >([])
  const [loading, setLoading] = useState(true)

  const fetchApprovals = useCallback(async () => {
    setLoading(true)
    try {
      const data = await approvalService.getApprovals(address)
      setApprovals(
        data.tokenApprovals.map((a) => ({
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
        })),
      )
    } catch {
      // Failed to fetch approvals - UI will show empty state
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    fetchApprovals()
  }, [fetchApprovals])

  const handleRevoke = async (approval: (typeof approvals)[0]) => {
    buildRevokeTransaction(approval.token.address, approval.spender.address)

    // In a real app, this would use the transaction service
    // Revoking approval with { to, data }

    // Refresh after revoke
    await fetchApprovals()
  }

  const handleBatchRevoke = async (toRevoke: typeof approvals) => {
    for (const approval of toRevoke) {
      await handleRevoke(approval)
    }
  }

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
  )
}

export default ApprovalsView

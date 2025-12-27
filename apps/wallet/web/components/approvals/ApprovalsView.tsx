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
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
          <svg
            className="w-6 h-6 text-amber-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            role="img"
            aria-label="Security shield"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-bold">Token Approvals</h2>
          <p className="text-muted-foreground text-sm">
            Manage your token spending permissions
          </p>
        </div>
      </div>
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

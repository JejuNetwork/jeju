'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, FileText } from 'lucide-react'
import { ProposalCard } from '@/components/ProposalCard'
import { CEOStatus } from '@/components/CEOStatus'
import { CouncilStatus } from '@/components/CouncilStatus'
import { 
  fetchProposals, 
  fetchCEOStatus, 
  fetchCouncilStatus, 
  fetchGovernanceStats,
  type Proposal,
  type CEOStatus as CEOStatusType,
  type CouncilStatus as CouncilStatusType,
  type GovernanceStats
} from '@/config/api'

export default function DashboardPage() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [ceoStatus, setCEOStatus] = useState<CEOStatusType | null>(null)
  const [councilStatus, setCouncilStatus] = useState<CouncilStatusType | null>(null)
  const [stats, setStats] = useState<GovernanceStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const [proposalsData, ceo, council, statsData] = await Promise.all([
        fetchProposals(true).catch(() => ({ proposals: [], total: 0 })),
        fetchCEOStatus().catch(() => null),
        fetchCouncilStatus().catch(() => null),
        fetchGovernanceStats().catch(() => null),
      ])
      
      setProposals(proposalsData.proposals)
      setCEOStatus(ceo)
      setCouncilStatus(council)
      setStats(statsData)
      setLoading(false)
    }
    loadData()
  }, [])

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        <div className="stat-card">
          <span className="stat-label">Proposals</span>
          <div className="stat-value">{stats?.totalProposals ?? '0'}</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">Decisions</span>
          <div className="stat-value">{stats?.ceo.decisions ?? '0'}</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">Approval</span>
          <div className="stat-value">{stats?.ceo.approvalRate ?? '0%'}</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">Min Score</span>
          <div className="stat-value">{stats?.parameters.minQualityScore ?? '90'}%</div>
        </div>
      </div>

      {/* Main Grid - stacks on mobile */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        {/* Active Proposals - full width on mobile, 2/3 on desktop */}
        <div className="lg:col-span-2 order-2 lg:order-1">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h2 className="text-base sm:text-lg font-semibold">Active Proposals</h2>
            <Link 
              href="/proposals" 
              className="text-xs sm:text-sm hover:underline"
              style={{ color: 'var(--color-primary)' }}
            >
              View all →
            </Link>
          </div>
          
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="card-static p-3 sm:p-4 animate-pulse">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-2" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : proposals.length > 0 ? (
            <div className="space-y-2 sm:space-y-3">
              {proposals.slice(0, 5).map((proposal) => (
                <ProposalCard key={proposal.proposalId} proposal={proposal} />
              ))}
            </div>
          ) : (
            <div className="card-static p-6 sm:p-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
              <FileText size={28} className="mx-auto mb-3 opacity-50" />
              <p className="mb-3 text-sm">No active proposals</p>
              <Link href="/create" className="btn-primary inline-flex items-center gap-2 text-sm">
                <Plus size={16} />
                Create Proposal
              </Link>
            </div>
          )}
        </div>

        {/* Sidebar - shows first on mobile for quick status view */}
        <div className="space-y-3 sm:space-y-4 order-1 lg:order-2">
          <CEOStatus status={ceoStatus} loading={loading} />
          <CouncilStatus status={councilStatus} loading={loading} />
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, FileText } from 'lucide-react'
import { ProposalCard } from '@/components/ProposalCard'
import { fetchProposals, type Proposal } from '@/config/api'

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'active'>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const data = await fetchProposals(filter === 'active').catch(() => ({ proposals: [], total: 0 }))
      setProposals(data.proposals)
      setLoading(false)
    }
    loadData()
  }, [filter])

  const filteredProposals = proposals.filter((p) => {
    if (!search) return true
    return (
      p.proposalId.toLowerCase().includes(search.toLowerCase()) ||
      p.proposalType.toLowerCase().includes(search.toLowerCase()) ||
      p.status.toLowerCase().includes(search.toLowerCase())
    )
  })

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg sm:text-xl font-semibold">Proposals</h1>
        <Link href="/create" className="btn-primary flex items-center gap-1.5 text-xs sm:text-sm">
          <Plus size={16} />
          <span className="hidden xs:inline">Create</span>
        </Link>
      </div>

      {/* Filters - stack on small mobile */}
      <div className="flex flex-col xs:flex-row gap-2 sm:gap-3">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input flex-1 text-sm"
        />
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => setFilter('all')}
            className={`btn text-xs sm:text-sm flex-1 xs:flex-none ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`btn text-xs sm:text-sm flex-1 xs:flex-none ${filter === 'active' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Active
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2 sm:space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card-static p-3 sm:p-4 animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : filteredProposals.length > 0 ? (
        <div className="space-y-2 sm:space-y-3">
          {filteredProposals.map((proposal) => (
            <ProposalCard key={proposal.proposalId} proposal={proposal} />
          ))}
        </div>
      ) : (
        <div className="card-static p-6 sm:p-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
          <FileText size={28} className="mx-auto mb-3 opacity-50" />
          <p className="mb-3 text-sm">No proposals found</p>
          <Link href="/create" className="btn-primary inline-flex items-center gap-2 text-sm">
            <Plus size={16} />
            Create
          </Link>
        </div>
      )}
    </div>
  )
}

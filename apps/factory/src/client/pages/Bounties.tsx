import { clsx } from 'clsx'
import { Clock, DollarSign, Plus, Search, Tag, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

type BountyStatus = 'open' | 'in_progress' | 'review' | 'completed' | 'all'

const mockBounties = [
  {
    id: '0x1234',
    title: 'Implement ZK proof verification for cross-chain bridges',
    description:
      'Build a zero-knowledge proof verification system that can validate cross-chain transactions.',
    creator: '0xabc...def',
    rewards: [{ token: 'ETH', amount: '2.5' }],
    skills: ['Solidity', 'ZK-SNARKs', 'Cryptography'],
    deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
    applicants: 12,
    status: 'open',
    milestones: 3,
  },
  {
    id: '0x5678',
    title: 'Build CLI tool for automated model deployment',
    description:
      'Create a command-line interface that simplifies deploying ML models to the compute marketplace.',
    creator: '0xdef...123',
    rewards: [
      { token: 'ETH', amount: '1.0' },
      { token: 'JEJU', amount: '5000' },
    ],
    skills: ['TypeScript', 'CLI', 'Docker', 'ML'],
    deadline: Date.now() + 14 * 24 * 60 * 60 * 1000,
    applicants: 8,
    status: 'open',
    milestones: 2,
  },
  {
    id: '0x9abc',
    title: 'Create real-time validator metrics dashboard',
    description:
      'Design and implement a dashboard showing validator performance, uptime, and earnings in real-time.',
    creator: '0x789...abc',
    rewards: [{ token: 'ETH', amount: '0.8' }],
    skills: ['React', 'GraphQL', 'Data Visualization'],
    deadline: Date.now() + 10 * 24 * 60 * 60 * 1000,
    applicants: 15,
    status: 'in_progress',
    milestones: 4,
  },
]

const statusColors = {
  open: 'badge-success',
  in_progress: 'badge-warning',
  review: 'badge-info',
  completed: 'bg-factory-700/50 text-factory-300',
}

const statusLabels = {
  open: 'Open',
  in_progress: 'In Progress',
  review: 'In Review',
  completed: 'Completed',
}

export function BountiesPage() {
  const [filter, setFilter] = useState<BountyStatus>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'reward' | 'deadline' | 'applicants'>(
    'reward',
  )

  const filteredBounties = mockBounties
    .filter((bounty) => {
      if (filter !== 'all' && bounty.status !== filter) return false
      if (search && !bounty.title.toLowerCase().includes(search.toLowerCase()))
        return false
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'reward') {
        return parseFloat(b.rewards[0].amount) - parseFloat(a.rewards[0].amount)
      }
      if (sortBy === 'deadline') {
        return a.deadline - b.deadline
      }
      return b.applicants - a.applicants
    })

  const formatDeadline = (timestamp: number) => {
    const days = Math.ceil((timestamp - Date.now()) / (1000 * 60 * 60 * 24))
    if (days === 1) return '1 day left'
    if (days <= 0) return 'Expired'
    return `${days} days left`
  }

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <DollarSign className="w-7 h-7 text-green-400" />
            Bounties
          </h1>
          <p className="text-factory-400 mt-1">
            Find work, earn rewards, build the network
          </p>
        </div>
        <Link to="/bounties/create" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Create Bounty
        </Link>
      </div>

      {/* Filters & Search */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Search bounties..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          {/* Status Filter */}
          <div className="flex gap-2">
            {(
              ['all', 'open', 'in_progress', 'review', 'completed'] as const
            ).map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  filter === status
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100',
                )}
              >
                {status === 'all' ? 'All' : statusLabels[status]}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="input w-auto"
          >
            <option value="reward">Highest Reward</option>
            <option value="deadline">Ending Soon</option>
            <option value="applicants">Most Applicants</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Open Bounties', value: '47', color: 'text-green-400' },
          { label: 'Total Value', value: '127 ETH', color: 'text-amber-400' },
          { label: 'Completed', value: '892', color: 'text-blue-400' },
          { label: 'Avg. Payout', value: '1.2 ETH', color: 'text-purple-400' },
        ].map((stat) => (
          <div key={stat.label} className="card p-4 text-center">
            <p className={clsx('text-2xl font-bold', stat.color)}>
              {stat.value}
            </p>
            <p className="text-factory-500 text-sm">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Bounty List */}
      <div className="space-y-4">
        {filteredBounties.map((bounty) => (
          <Link
            key={bounty.id}
            to={`/bounties/${bounty.id}`}
            className="card p-6 card-hover block"
          >
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-semibold text-factory-100 truncate">
                    {bounty.title}
                  </h3>
                  <span
                    className={clsx(
                      'badge',
                      statusColors[bounty.status as keyof typeof statusColors],
                    )}
                  >
                    {statusLabels[bounty.status as keyof typeof statusLabels]}
                  </span>
                </div>
                <p className="text-factory-400 text-sm mb-4 line-clamp-2">
                  {bounty.description}
                </p>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex flex-wrap gap-2">
                    {bounty.skills.map((skill) => (
                      <span key={skill} className="badge badge-info">
                        {skill}
                      </span>
                    ))}
                  </div>
                  <span className="flex items-center gap-1 text-factory-500">
                    <Clock className="w-4 h-4" />
                    {formatDeadline(bounty.deadline)}
                  </span>
                  <span className="flex items-center gap-1 text-factory-500">
                    <Users className="w-4 h-4" />
                    {bounty.applicants} applicants
                  </span>
                  <span className="flex items-center gap-1 text-factory-500">
                    <Tag className="w-4 h-4" />
                    {bounty.milestones} milestones
                  </span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="space-y-1">
                  {bounty.rewards.map((reward, idx) => (
                    <p
                      key={`${reward.token}-${reward.amount}`}
                      className={clsx(
                        'font-bold',
                        idx === 0
                          ? 'text-xl text-green-400'
                          : 'text-sm text-factory-400',
                      )}
                    >
                      {reward.amount} {reward.token}
                    </p>
                  ))}
                </div>
                <p className="text-factory-500 text-sm mt-1">Reward</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Empty State */}
      {filteredBounties.length === 0 && (
        <div className="card p-12 text-center">
          <DollarSign className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            No bounties found
          </h3>
          <p className="text-factory-500 mb-4">
            Try adjusting your filters or search terms
          </p>
          <Link to="/bounties/create" className="btn btn-primary">
            Create a Bounty
          </Link>
        </div>
      )}
    </div>
  )
}

import {
  ArrowRight,
  Brain,
  Briefcase,
  DollarSign,
  GitBranch,
  Loader2,
  MessageSquare,
  Package,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { WalletButton } from '../components/WalletButton'
import { useBounties, useBountyStats } from '../hooks/useBounties'
import { useRepositoryStats } from '../hooks/useGit'
import { useJobStats } from '../hooks/useJobs'
import { usePackages } from '../hooks/usePackages'

export function HomePage() {
  const { bounties, isLoading: bountiesLoading } = useBounties({
    status: 'open',
  })
  const { stats: bountyStats, isLoading: bountyStatsLoading } = useBountyStats()
  const { stats: jobStats, isLoading: jobStatsLoading } = useJobStats()
  const { stats: repoStats, isLoading: repoStatsLoading } = useRepositoryStats()
  const { packages, isLoading: packagesLoading } = usePackages()

  const featuredBounties = bounties.slice(0, 3)

  const stats = [
    {
      label: 'Active Bounties',
      value: bountyStats.openBounties.toString(),
      loading: bountyStatsLoading,
      icon: DollarSign,
    },
    {
      label: 'Open Jobs',
      value: jobStats.openJobs.toString(),
      loading: jobStatsLoading,
      icon: Briefcase,
    },
    {
      label: 'Git Repos',
      value: repoStats.totalRepos.toLocaleString(),
      loading: repoStatsLoading,
      icon: GitBranch,
    },
    {
      label: 'Packages',
      value: packages.length.toLocaleString(),
      loading: packagesLoading,
      icon: Package,
    },
  ]

  const formatDeadline = (timestamp: number) => {
    const days = Math.ceil((timestamp - Date.now()) / (1000 * 60 * 60 * 24))
    if (days === 1) return '1 day'
    if (days <= 0) return 'Expired'
    return `${days} days`
  }

  return (
    <div className="min-h-screen p-8">
      <header className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-3xl font-bold font-display text-factory-100 flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-accent-500" />
            Factory
          </h1>
          <p className="text-factory-400 mt-1">
            Build, ship, earn — developer coordination on Jeju
          </p>
        </div>
        <WalletButton />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-6 card-hover">
            <div className="flex items-center justify-between mb-4">
              <stat.icon className="w-6 h-6 text-accent-500" />
            </div>
            {stat.loading ? (
              <Loader2 className="w-6 h-6 animate-spin text-factory-500" />
            ) : (
              <p className="text-3xl font-bold text-factory-100">
                {stat.value}
              </p>
            )}
            <p className="text-factory-400 text-sm mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-factory-100 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-accent-500" />
              Featured Bounties
            </h2>
            <Link
              to="/bounties"
              className="text-accent-400 hover:text-accent-300 text-sm flex items-center gap-1"
            >
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {bountiesLoading ? (
            <div className="card p-12 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-accent-500" />
            </div>
          ) : featuredBounties.length === 0 ? (
            <div className="card p-12 text-center">
              <DollarSign className="w-12 h-12 mx-auto mb-4 text-factory-600" />
              <p className="text-factory-400">No open bounties available</p>
              <Link to="/bounties/create" className="btn btn-primary mt-4">
                Create a Bounty
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {featuredBounties.map((bounty) => (
                <Link
                  key={bounty.id}
                  to={`/bounties/${bounty.id}`}
                  className="card p-6 card-hover block"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="font-medium text-factory-100 mb-2">
                        {bounty.title}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {bounty.skills.slice(0, 3).map((skill) => (
                          <span key={skill} className="badge badge-info">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-green-400">
                        {bounty.rewards[0].amount} {bounty.rewards[0].token}
                      </p>
                      <p className="text-factory-500 text-sm">Reward</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm text-factory-400">
                    <span>
                      {formatDeadline(bounty.deadline)} • {bounty.applicants}{' '}
                      applicants
                    </span>
                    <span className="btn btn-primary text-sm py-1">Apply</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-xl font-semibold text-factory-100 flex items-center gap-2 mb-6">
            <TrendingUp className="w-5 h-5 text-accent-500" />
            Quick Stats
          </h2>

          <div className="card divide-y divide-factory-800">
            <div className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-500/20 text-green-400">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-factory-100 font-medium">
                    Total Bounty Value
                  </p>
                  <p className="text-sm text-factory-500">
                    {bountyStats.totalValue}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/20 text-blue-400">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-factory-100 font-medium">
                    Completed Bounties
                  </p>
                  <p className="text-sm text-factory-500">
                    {bountyStats.completed}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-500/20 text-purple-400">
                  <GitBranch className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-factory-100 font-medium">Total Stars</p>
                  <p className="text-sm text-factory-500">
                    {repoStats.totalStars}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-500/20 text-amber-400">
                  <Briefcase className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-factory-100 font-medium">Remote Jobs</p>
                  <p className="text-sm text-factory-500">
                    {jobStats.remoteJobs}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            href: '/bounties',
            label: 'Create Bounty',
            icon: DollarSign,
            color: 'green',
          },
          {
            href: '/git',
            label: 'New Repository',
            icon: GitBranch,
            color: 'purple',
          },
          {
            href: '/packages',
            label: 'Publish Package',
            icon: Package,
            color: 'blue',
          },
          {
            href: '/models',
            label: 'Upload Model',
            icon: Brain,
            color: 'amber',
          },
        ].map((action) => (
          <Link
            key={action.href}
            to={action.href}
            className="card p-6 card-hover text-center group"
          >
            <action.icon
              className={`w-8 h-8 mx-auto mb-3 text-${action.color}-400 group-hover:scale-110 transition-transform`}
            />
            <p className="font-medium text-factory-100">{action.label}</p>
          </Link>
        ))}
      </div>

      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-factory-100 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-accent-500" />
            Factory Feed
          </h2>
          <Link
            to="/feed"
            className="text-accent-400 hover:text-accent-300 text-sm flex items-center gap-1"
          >
            Open feed <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="card p-8 text-center">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <p className="text-factory-400 mb-4">
            Connect with the Factory community on Farcaster
          </p>
          <button type="button" className="btn btn-primary">
            Connect Farcaster
          </button>
        </div>
      </div>
    </div>
  )
}

import {
  ArrowRight,
  Brain,
  Briefcase,
  DollarSign,
  GitBranch,
  Package,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState, LoadingState, StatsGrid } from '../components/shared'
import { WalletButton } from '../components/WalletButton'
import { useBounties, useBountyStats } from '../hooks/useBounties'
import { useRepositoryStats } from '../hooks/useGit'
import { useJobStats } from '../hooks/useJobs'
import { usePackages } from '../hooks/usePackages'
import { formatCompactNumber, formatDeadline } from '../lib/format'

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
      value: formatCompactNumber(bountyStats.openBounties),
      loading: bountyStatsLoading,
      color: 'text-success-400',
    },
    {
      label: 'Open Jobs',
      value: formatCompactNumber(jobStats.openJobs),
      loading: jobStatsLoading,
      color: 'text-info-400',
    },
    {
      label: 'Git Repos',
      value: formatCompactNumber(repoStats.totalRepos),
      loading: repoStatsLoading,
      color: 'text-accent-400',
    },
    {
      label: 'Packages',
      value: formatCompactNumber(packages.length),
      loading: packagesLoading,
      color: 'text-warning-400',
    },
  ]

  const quickActions = [
    {
      href: '/bounties',
      label: 'Create Bounty',
      icon: DollarSign,
      gradient: 'from-success-500/25 to-success-600/15',
      iconColor: 'text-success-400',
    },
    {
      href: '/git',
      label: 'New Repository',
      icon: GitBranch,
      gradient: 'from-accent-500/25 to-accent-600/15',
      iconColor: 'text-accent-400',
    },
    {
      href: '/packages',
      label: 'Publish Package',
      icon: Package,
      gradient: 'from-info-500/25 to-info-600/15',
      iconColor: 'text-info-400',
    },
    {
      href: '/models',
      label: 'Upload Model',
      icon: Brain,
      gradient: 'from-warning-500/25 to-warning-600/15',
      iconColor: 'text-warning-400',
    },
  ]

  const quickStats = [
    {
      label: 'Total Bounty Value',
      value: bountyStats.totalValue,
      icon: DollarSign,
      bgColor: 'bg-success-500/15',
      iconColor: 'text-success-400',
    },
    {
      label: 'Completed Bounties',
      value: formatCompactNumber(bountyStats.completed),
      icon: TrendingUp,
      bgColor: 'bg-info-500/15',
      iconColor: 'text-info-400',
    },
    {
      label: 'Total Stars',
      value: formatCompactNumber(repoStats.totalStars),
      icon: Sparkles,
      bgColor: 'bg-accent-500/15',
      iconColor: 'text-accent-400',
    },
    {
      label: 'Remote Jobs',
      value: formatCompactNumber(jobStats.remoteJobs),
      icon: Briefcase,
      bgColor: 'bg-warning-500/15',
      iconColor: 'text-warning-400',
    },
  ]

  return (
    <div className="page-container">
      {/* Hero Header */}
      <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between mb-10 animate-in">
        <div className="flex items-start gap-4">
          <div
            className="w-14 h-14 bg-gradient-to-br from-factory-500 to-accent-500 flex items-center justify-center shadow-glow animate-float"
            style={{
              clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
            }}
          >
            <Sparkles className="w-7 h-7 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-surface-50 uppercase tracking-widest">
            <span className="text-gradient">Factory</span>
          </h1>
        </div>
        <WalletButton />
      </header>

      {/* Stats Overview */}
      <StatsGrid stats={stats} columns={4} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        {/* Featured Bounties */}
        <section className="lg:col-span-2" aria-labelledby="bounties-heading">
          <div className="flex items-center justify-between mb-5">
            <h2
              id="bounties-heading"
              className="text-lg font-bold text-surface-50 flex items-center gap-2.5 font-display uppercase tracking-wider"
            >
              <div
                className="w-8 h-8 bg-success-500/15 flex items-center justify-center border border-success-500/30"
                style={{
                  clipPath:
                    'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                }}
              >
                <DollarSign
                  className="w-4 h-4 text-success-400"
                  aria-hidden="true"
                />
              </div>
              Featured Bounties
            </h2>
            <Link
              to="/bounties"
              className="text-factory-400 hover:text-factory-300 text-sm flex items-center gap-1.5 group transition-colors uppercase tracking-wider font-semibold"
            >
              View all{' '}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

          {bountiesLoading ? (
            <LoadingState text="Loading bounties..." />
          ) : featuredBounties.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title="No active bounties"
              description="Post a bounty to fund open-source work and attract contributors."
              actionLabel="Create Bounty"
              actionHref="/bounties/create"
            />
          ) : (
            <div className="space-y-4">
              {featuredBounties.map((bounty, index) => (
                <Link
                  key={bounty.id}
                  to={`/bounties/${bounty.id}`}
                  className="relative block bg-gradient-to-br from-surface-800/90 to-surface-900/95 border border-surface-700/60 p-5 sm:p-6 transition-all hover:border-factory-500/40 hover:shadow-[0_0_30px_rgba(6,182,212,0.15)] animate-slide-up group"
                  style={{
                    animationDelay: `${index * 100}ms`,
                    clipPath:
                      'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))',
                  }}
                >
                  {/* Corner accents */}
                  <div className="absolute top-0 right-0 w-3 h-3 bg-gradient-to-bl from-factory-500/40 to-transparent group-hover:from-factory-500/70 transition-all" />
                  <div className="absolute bottom-0 left-0 w-3 h-3 bg-gradient-to-tr from-factory-500/40 to-transparent group-hover:from-factory-500/70 transition-all" />

                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-surface-100 mb-2 line-clamp-1 uppercase tracking-wide">
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
                    <div className="text-right flex-shrink-0">
                      <p className="text-xl font-bold text-success-400 font-display tracking-wide">
                        {bounty.rewards[0].amount} {bounty.rewards[0].token}
                      </p>
                      <p className="text-surface-500 text-xs uppercase tracking-widest">
                        Reward
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-surface-400 uppercase tracking-wide text-xs">
                      {formatDeadline(bounty.deadline)} · {bounty.applicants}{' '}
                      applicants
                    </span>
                    <span className="btn btn-primary text-xs py-1.5 px-4">
                      <Zap className="w-3.5 h-3.5" />
                      Apply
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Quick Stats Sidebar */}
        <aside aria-labelledby="stats-heading">
          <h2
            id="stats-heading"
            className="text-lg font-bold text-surface-50 flex items-center gap-2.5 mb-5 font-display uppercase tracking-wider"
          >
            <div
              className="w-8 h-8 bg-info-500/15 flex items-center justify-center border border-info-500/30"
              style={{
                clipPath:
                  'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
              }}
            >
              <TrendingUp
                className="w-4 h-4 text-info-400"
                aria-hidden="true"
              />
            </div>
            Quick Stats
          </h2>

          <div
            className="relative bg-gradient-to-br from-surface-800/90 to-surface-900/95 border border-surface-700/60 divide-y divide-surface-700/50"
            style={{
              clipPath:
                'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))',
            }}
          >
            {/* Corner accents */}
            <div className="absolute top-0 right-0 w-[10px] h-[10px] bg-gradient-to-bl from-factory-500/50 to-transparent" />
            <div className="absolute bottom-0 left-0 w-[10px] h-[10px] bg-gradient-to-tr from-factory-500/50 to-transparent" />

            {quickStats.map((stat, index) => (
              <div
                key={stat.label}
                className="p-4 animate-slide-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 flex items-center justify-center ${stat.bgColor} border border-current/20`}
                    style={{
                      clipPath:
                        'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                    }}
                  >
                    <stat.icon
                      className={`w-4 h-4 ${stat.iconColor}`}
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <p className="text-surface-100 font-semibold uppercase tracking-wide text-sm">
                      {stat.label}
                    </p>
                    <p className="text-sm text-surface-500 font-display">
                      {stat.value}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Quick Actions */}
      <section className="mt-10" aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="sr-only">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {quickActions.map((action, index) => (
            <Link
              key={action.href}
              to={action.href}
              className="relative bg-gradient-to-br from-surface-800/90 to-surface-900/95 border border-surface-700/60 p-5 sm:p-6 text-center group animate-slide-up transition-all hover:border-factory-500/40 hover:shadow-[0_0_25px_rgba(6,182,212,0.12)]"
              style={{
                animationDelay: `${index * 75}ms`,
                clipPath:
                  'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))',
              }}
            >
              {/* Corner accents */}
              <div className="absolute top-0 right-0 w-[10px] h-[10px] bg-gradient-to-bl from-factory-500/40 to-transparent group-hover:from-factory-500/70 transition-all" />
              <div className="absolute bottom-0 left-0 w-[10px] h-[10px] bg-gradient-to-tr from-factory-500/40 to-transparent group-hover:from-factory-500/70 transition-all" />

              <div
                className={`w-12 h-12 sm:w-14 sm:h-14 mx-auto mb-3 bg-gradient-to-br ${action.gradient} flex items-center justify-center transition-transform group-hover:scale-110 border border-current/20`}
                style={{
                  clipPath:
                    'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                }}
              >
                <action.icon
                  className={`w-6 h-6 sm:w-7 sm:h-7 ${action.iconColor}`}
                  aria-hidden="true"
                />
              </div>
              <p className="font-bold text-surface-100 text-sm sm:text-base uppercase tracking-wider">
                {action.label}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

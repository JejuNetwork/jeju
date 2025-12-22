'use client'

import {
  ArrowRight,
  Brain,
  Briefcase,
  Clock,
  DollarSign,
  GitBranch,
  MessageSquare,
  Package,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { WalletButton } from '@/components/wallet-button'

const stats = [
  { label: 'Active Bounties', value: '47', change: '+12%', icon: DollarSign },
  { label: 'Open Jobs', value: '23', change: '+8%', icon: Briefcase },
  { label: 'Git Repos', value: '1,247', change: '+34%', icon: GitBranch },
  { label: 'Packages', value: '892', change: '+21%', icon: Package },
]

const recentActivity = [
  {
    type: 'bounty',
    title: 'Fix memory leak in indexer',
    reward: '0.5 ETH',
    status: 'open',
    time: '2h ago',
  },
  {
    type: 'pr',
    title: 'feat: add multi-token staking',
    repo: 'jeju/contracts',
    status: 'review',
    time: '4h ago',
  },
  {
    type: 'model',
    title: 'llama-3-8b-jeju-ft',
    downloads: '1.2k',
    status: 'published',
    time: '6h ago',
  },
  {
    type: 'package',
    title: '@jeju/sdk@2.1.0',
    downloads: '3.4k',
    status: 'published',
    time: '8h ago',
  },
]

const featuredBounties = [
  {
    title: 'Implement ZK proof verification for bridges',
    reward: '2.5 ETH',
    skills: ['Solidity', 'ZK', 'Cryptography'],
    deadline: '7 days',
    applicants: 12,
  },
  {
    title: 'Build CLI tool for model deployment',
    reward: '1.0 ETH',
    skills: ['TypeScript', 'CLI', 'Docker'],
    deadline: '14 days',
    applicants: 8,
  },
  {
    title: 'Create dashboard for validator metrics',
    reward: '0.8 ETH',
    skills: ['React', 'GraphQL', 'Data Viz'],
    deadline: '10 days',
    applicants: 15,
  },
]

export default function HomePage() {
  const { isConnected: _isConnected } = useAccount()

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-6 card-hover">
            <div className="flex items-center justify-between mb-4">
              <stat.icon className="w-6 h-6 text-accent-500" />
              <span className="text-green-400 text-sm font-medium">
                {stat.change}
              </span>
            </div>
            <p className="text-3xl font-bold text-factory-100">{stat.value}</p>
            <p className="text-factory-400 text-sm mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Featured Bounties */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-factory-100 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-accent-500" />
              Featured Bounties
            </h2>
            <Link
              href="/bounties"
              className="text-accent-400 hover:text-accent-300 text-sm flex items-center gap-1"
            >
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="space-y-4">
            {featuredBounties.map((bounty, i) => (
              <div key={i} className="card p-6 card-hover">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="font-medium text-factory-100 mb-2">
                      {bounty.title}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {bounty.skills.map((skill) => (
                        <span key={skill} className="badge badge-info">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-green-400">
                      {bounty.reward}
                    </p>
                    <p className="text-factory-500 text-sm">Reward</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm text-factory-400">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" /> {bounty.deadline}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-4 h-4" /> {bounty.applicants}{' '}
                      applicants
                    </span>
                  </div>
                  <button className="btn btn-primary text-sm py-1">
                    Apply
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-xl font-semibold text-factory-100 flex items-center gap-2 mb-6">
            <TrendingUp className="w-5 h-5 text-accent-500" />
            Recent Activity
          </h2>

          <div className="card divide-y divide-factory-800">
            {recentActivity.map((activity, i) => (
              <div
                key={i}
                className="p-4 hover:bg-factory-800/50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      activity.type === 'bounty'
                        ? 'bg-green-500/20 text-green-400'
                        : activity.type === 'pr'
                          ? 'bg-purple-500/20 text-purple-400'
                          : activity.type === 'model'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-blue-500/20 text-blue-400'
                    }`}
                  >
                    {activity.type === 'bounty' && (
                      <DollarSign className="w-4 h-4" />
                    )}
                    {activity.type === 'pr' && (
                      <GitBranch className="w-4 h-4" />
                    )}
                    {activity.type === 'model' && <Brain className="w-4 h-4" />}
                    {activity.type === 'package' && (
                      <Package className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-factory-100 font-medium truncate">
                      {activity.title}
                    </p>
                    <div className="flex items-center gap-2 text-sm text-factory-500">
                      {'reward' in activity && (
                        <span className="text-green-400">
                          {activity.reward}
                        </span>
                      )}
                      {'repo' in activity && <span>{activity.repo}</span>}
                      {'downloads' in activity && (
                        <span>{activity.downloads} downloads</span>
                      )}
                      <span>•</span>
                      <span>{activity.time}</span>
                    </div>
                  </div>
                  <span
                    className={`badge ${
                      activity.status === 'open'
                        ? 'badge-success'
                        : activity.status === 'review'
                          ? 'badge-warning'
                          : 'badge-info'
                    }`}
                  >
                    {activity.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            href: '/bounties/create',
            label: 'Create Bounty',
            icon: DollarSign,
            color: 'green',
          },
          {
            href: '/git/new',
            label: 'New Repository',
            icon: GitBranch,
            color: 'purple',
          },
          {
            href: '/packages/publish',
            label: 'Publish Package',
            icon: Package,
            color: 'blue',
          },
          {
            href: '/models/upload',
            label: 'Upload Model',
            icon: Brain,
            color: 'amber',
          },
        ].map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={`card p-6 card-hover text-center group`}
          >
            <action.icon
              className={`w-8 h-8 mx-auto mb-3 text-${action.color}-400 group-hover:scale-110 transition-transform`}
            />
            <p className="font-medium text-factory-100">{action.label}</p>
          </Link>
        ))}
      </div>

      {/* Feed Preview */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-factory-100 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-accent-500" />
            Factory Feed
          </h2>
          <Link
            href="/feed"
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
          <button className="btn btn-primary">Connect Farcaster</button>
        </div>
      </div>
    </div>
  )
}

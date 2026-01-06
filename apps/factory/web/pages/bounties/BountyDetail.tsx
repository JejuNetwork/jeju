import { clsx } from 'clsx'
import {
  ArrowLeft,
  Check,
  Clock,
  DollarSign,
  FileText,
  MessageSquare,
  Shield,
  Tag,
  User,
  Users,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button, EmptyState, LoadingState } from '../../components/shared'
import { useBounty } from '../../hooks/useBounties'
import { formatAddress, formatDeadline } from '../../lib/format'

const statusColors: Record<string, string> = {
  open: 'badge-success',
  in_progress: 'badge-warning',
  review: 'badge-info',
  completed: 'badge-neutral',
  cancelled: 'badge-error',
}

const statusLabels: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  review: 'In Review',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function BountyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { bounty, isLoading } = useBounty(id ?? '')
  const { address, isConnected } = useAccount()

  const handleApply = () => {
    if (!isConnected) {
      toast.error('Please connect your wallet to apply')
      return
    }
    toast.success(
      'Application submitted. The bounty creator will review your profile.',
    )
  }

  if (isLoading) {
    return (
      <div className="page-container">
        <LoadingState text="Loading bounty..." />
      </div>
    )
  }

  if (!bounty) {
    return (
      <div className="page-container">
        <Link
          to="/bounties"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Bounties
        </Link>
        <EmptyState
          icon={DollarSign}
          title="Bounty not found"
          description="The bounty you're looking for doesn't exist or has been removed."
          actionLabel="Browse Bounties"
          actionHref="/bounties"
        />
      </div>
    )
  }

  const isCreator = address?.toLowerCase() === bounty.creator.toLowerCase()

  return (
    <div className="page-container">
      <Link
        to="/bounties"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Bounties
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6 animate-in">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <h1 className="text-2xl font-bold text-surface-100">
                    {bounty.title}
                  </h1>
                  <span className={clsx('badge', statusColors[bounty.status])}>
                    {statusLabels[bounty.status]}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm text-surface-400">
                  <span className="flex items-center gap-1.5">
                    <User className="w-4 h-4" />
                    {formatAddress(bounty.creator)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    {formatDeadline(bounty.deadline)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Users className="w-4 h-4" />
                    {bounty.applicants} applicants
                  </span>
                </div>
              </div>
              <div className="text-right">
                {bounty.rewards.map((reward, idx) => (
                  <p
                    key={`${reward.token}-${reward.amount}`}
                    className={clsx(
                      'font-bold font-display',
                      idx === 0
                        ? 'text-2xl text-success-400'
                        : 'text-sm text-surface-400',
                    )}
                  >
                    {reward.amount} {reward.token}
                  </p>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              {bounty.skills.map((skill) => (
                <span key={skill} className="badge badge-info">
                  <Tag className="w-3 h-3 mr-1" />
                  {skill}
                </span>
              ))}
            </div>

            <div className="prose prose-invert max-w-none">
              <h3 className="text-lg font-semibold text-surface-100 mb-3">
                <FileText className="w-4 h-4 inline mr-2" />
                Description
              </h3>
              <p className="text-surface-300 whitespace-pre-wrap">
                {bounty.description}
              </p>
            </div>
          </div>

          {/* Milestones */}
          <div
            className="card p-6 animate-in"
            style={{ animationDelay: '50ms' }}
          >
            <h3 className="font-semibold text-surface-100 mb-4">
              <Check className="w-4 h-4 inline mr-2" />
              Milestones ({bounty.milestones})
            </h3>

            <div className="space-y-3">
              {Array.from({ length: bounty.milestones }).map((_, idx) => (
                <div
                  key={idx}
                  className="p-4 bg-surface-800/50 rounded-lg flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-surface-700 flex items-center justify-center text-sm font-medium text-surface-400">
                      {idx + 1}
                    </div>
                    <div>
                      <p className="font-medium text-surface-200">
                        Milestone {idx + 1}
                      </p>
                      <p className="text-sm text-surface-500">
                        {Math.round(100 / bounty.milestones)}% of reward
                      </p>
                    </div>
                  </div>
                  <span className="badge badge-neutral">Pending</span>
                </div>
              ))}
            </div>
          </div>

          {/* Discussion Section */}
          <div
            className="card p-6 animate-in"
            style={{ animationDelay: '100ms' }}
          >
            <h3 className="font-semibold text-surface-100 mb-4">
              <MessageSquare className="w-4 h-4 inline mr-2" />
              Discussion
            </h3>
            <div className="text-center py-6">
              <MessageSquare className="w-10 h-10 text-surface-600 mx-auto mb-3" />
              <p className="text-surface-400 text-sm mb-4">
                Questions or comments? Start a discussion.
              </p>
              <Button variant="secondary" size="sm" icon={MessageSquare}>
                Start Discussion
              </Button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Actions */}
          <div className="card p-6 animate-in">
            <h3 className="font-semibold text-surface-100 mb-4">Actions</h3>

            {bounty.status === 'open' && !isCreator && (
              <Button
                variant="primary"
                className="w-full mb-3"
                onClick={handleApply}
              >
                <FileText className="w-4 h-4" />
                Apply for Bounty
              </Button>
            )}

            {isCreator && bounty.status === 'open' && (
              <>
                <Link
                  to={`/bounties/${id}/edit`}
                  className="btn btn-secondary w-full mb-3"
                >
                  Edit Bounty
                </Link>
                <Button variant="danger" className="w-full">
                  Cancel Bounty
                </Button>
              </>
            )}

            {bounty.status !== 'open' && (
              <p className="text-surface-500 text-sm text-center py-4">
                This bounty is {statusLabels[bounty.status].toLowerCase()}
              </p>
            )}
          </div>

          {/* Bounty Info */}
          <div
            className="card p-6 animate-in"
            style={{ animationDelay: '50ms' }}
          >
            <h3 className="font-semibold text-surface-100 mb-4">Details</h3>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-surface-500">Created</dt>
                <dd className="text-surface-200">
                  {formatDeadline(Date.now() - (bounty.deadline - Date.now()))}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-surface-500">Deadline</dt>
                <dd className="text-surface-200">
                  {formatDeadline(bounty.deadline)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-surface-500">Applications</dt>
                <dd className="text-surface-200">{bounty.applicants}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-surface-500">Milestones</dt>
                <dd className="text-surface-200">{bounty.milestones}</dd>
              </div>
            </dl>
          </div>

          {/* Guardian Validators */}
          <div
            className="card p-6 animate-in"
            style={{ animationDelay: '100ms' }}
          >
            <h3 className="font-semibold text-surface-100 mb-4">
              <Shield className="w-4 h-4 inline mr-2" />
              Guardian Validators
            </h3>
            <p className="text-surface-500 text-sm mb-4">
              Bounty completion will be validated by the guardian network.
            </p>
            <div className="flex items-center gap-2 text-sm">
              <span className="badge badge-info">3 min required</span>
              <span className="badge badge-neutral">60% quorum</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

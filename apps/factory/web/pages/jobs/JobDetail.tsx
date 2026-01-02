import { clsx } from 'clsx'
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Clock,
  DollarSign,
  Globe,
  MapPin,
  Send,
  Share2,
  Tag,
  Users,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button, EmptyState, LoadingState } from '../../components/shared'
import { useJob } from '../../hooks/useJobs'
import { formatCurrency, formatRelativeTime } from '../../lib/format'

const typeColors: Record<string, string> = {
  'full-time': 'badge-success',
  'part-time': 'badge-info',
  contract: 'badge-warning',
  bounty: 'badge-accent',
}

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { job, isLoading } = useJob(id ?? '')
  const { isConnected } = useAccount()

  const handleApply = () => {
    if (!isConnected) {
      toast.error('Please connect your wallet to apply')
      return
    }
    toast.info('Application flow coming soon')
  }

  const handleShare = async () => {
    await navigator.clipboard.writeText(window.location.href)
    toast.success('Link copied to clipboard')
  }

  if (isLoading) {
    return (
      <div className="page-container">
        <LoadingState text="Loading job..." />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="page-container">
        <Link
          to="/jobs"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Jobs
        </Link>
        <EmptyState
          icon={Briefcase}
          title="Job not found"
          description="The job you're looking for doesn't exist or has been removed."
          actionLabel="Browse Jobs"
          actionHref="/jobs"
        />
      </div>
    )
  }

  return (
    <div className="page-container">
      <Link
        to="/jobs"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Jobs
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6 animate-in">
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="w-16 h-16 rounded-xl bg-surface-800 flex items-center justify-center flex-shrink-0">
                {job.companyLogo ? (
                  <img
                    src={job.companyLogo}
                    alt={job.company}
                    className="w-14 h-14 rounded-lg object-cover"
                  />
                ) : (
                  <Building2 className="w-8 h-8 text-surface-500" />
                )}
              </div>

              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <h1 className="text-2xl font-bold text-surface-100">
                    {job.title}
                  </h1>
                  <span className={clsx('badge', typeColors[job.type])}>
                    {job.type.replace('-', ' ')}
                  </span>
                  {job.remote && (
                    <span className="badge badge-info">
                      <Globe className="w-3 h-3 mr-1" />
                      Remote
                    </span>
                  )}
                </div>
                <p className="text-lg text-surface-300">{job.company}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-surface-400 mb-6">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                {job.location}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                Posted {formatRelativeTime(job.createdAt)}
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4" />
                {job.applications} applicants
              </span>
            </div>

            {job.salary && (
              <div className="p-4 bg-surface-800/50 rounded-lg mb-6">
                <div className="flex items-center gap-2 text-success-400">
                  <DollarSign className="w-5 h-5" />
                  <span className="text-xl font-bold">
                    {formatCurrency(job.salary.min)} -{' '}
                    {formatCurrency(job.salary.max)}
                  </span>
                  <span className="text-surface-400 text-sm">/ year</span>
                </div>
              </div>
            )}

            <div className="prose prose-invert max-w-none">
              <h3 className="text-lg font-semibold text-surface-100 mb-3">
                About the Role
              </h3>
              <div className="text-surface-300 whitespace-pre-wrap">
                {job.description}
              </div>
            </div>
          </div>

          {/* Skills */}
          <div
            className="card p-6 animate-in"
            style={{ animationDelay: '50ms' }}
          >
            <h3 className="font-semibold text-surface-100 mb-4">
              <Tag className="w-4 h-4 inline mr-2" />
              Required Skills
            </h3>
            <div className="flex flex-wrap gap-2">
              {job.skills.map((skill) => (
                <span key={skill} className="badge badge-info">
                  {skill}
                </span>
              ))}
              {job.skills.length === 0 && (
                <span className="text-surface-500">
                  No specific skills listed
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Actions */}
          <div className="card p-6 animate-in">
            <h3 className="font-semibold text-surface-100 mb-4">Apply Now</h3>

            <Button
              variant="primary"
              className="w-full mb-3"
              onClick={handleApply}
            >
              <Send className="w-4 h-4" />
              Apply for Position
            </Button>

            <Button
              variant="secondary"
              className="w-full"
              onClick={handleShare}
            >
              <Share2 className="w-4 h-4" />
              Share Job
            </Button>
          </div>

          {/* Company Info */}
          <div
            className="card p-6 animate-in"
            style={{ animationDelay: '50ms' }}
          >
            <h3 className="font-semibold text-surface-100 mb-4">
              About {job.company}
            </h3>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-surface-800 flex items-center justify-center">
                {job.companyLogo ? (
                  <img
                    src={job.companyLogo}
                    alt={job.company}
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                ) : (
                  <Building2 className="w-6 h-6 text-surface-500" />
                )}
              </div>
              <div>
                <p className="font-medium text-surface-200">{job.company}</p>
                <p className="text-sm text-surface-500">Web3 Company</p>
              </div>
            </div>
            <p className="text-surface-400 text-sm">
              Company description coming soon...
            </p>
          </div>

          {/* Job Details */}
          <div
            className="card p-6 animate-in"
            style={{ animationDelay: '100ms' }}
          >
            <h3 className="font-semibold text-surface-100 mb-4">Job Details</h3>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-surface-500">Type</dt>
                <dd className="text-surface-200 capitalize">
                  {job.type.replace('-', ' ')}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-surface-500">Location</dt>
                <dd className="text-surface-200">
                  {job.remote ? 'Remote' : job.location}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-surface-500">Posted</dt>
                <dd className="text-surface-200">
                  {formatRelativeTime(job.createdAt)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-surface-500">Applications</dt>
                <dd className="text-surface-200">{job.applications}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}

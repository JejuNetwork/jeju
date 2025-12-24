import { clsx } from 'clsx'
import {
  Briefcase,
  Building2,
  Loader2,
  MapPin,
  Plus,
  Search,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { type Job, useJobStats, useJobs } from '../hooks/useJobs'

const typeLabels: Record<Job['type'], string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  bounty: 'Bounty',
}

export function JobsPage() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<Job['type'] | 'all'>('all')
  const [remoteOnly, setRemoteOnly] = useState(false)

  const { jobs, isLoading, error } = useJobs({
    type: typeFilter !== 'all' ? typeFilter : undefined,
    remote: remoteOnly || undefined,
    search: search || undefined,
  })
  const { stats, isLoading: statsLoading } = useJobStats()

  const filteredJobs = jobs.filter((job) => {
    if (search && !job.title.toLowerCase().includes(search.toLowerCase())) {
      return false
    }
    return true
  })

  const formatSalary = (job: Job) => {
    if (!job.salary) return 'Competitive'
    const { min, max, currency, period } = job.salary
    const periodLabel = period ? `/${period}` : ''
    if (min === max) return `${currency}${min.toLocaleString()}${periodLabel}`
    return `${currency}${min.toLocaleString()} - ${currency}${max.toLocaleString()}${periodLabel}`
  }

  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-blue-400" />
            Jobs
          </h1>
          <p className="text-factory-400 mt-1">
            Find opportunities in the Jeju ecosystem
          </p>
        </div>
        <Link to="/jobs/create" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Post Job
        </Link>
      </div>

      <div className="card p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Search jobs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          <div className="flex gap-2">
            {(
              ['all', 'full-time', 'part-time', 'contract', 'bounty'] as const
            ).map((type) => (
              <button
                type="button"
                key={type}
                onClick={() => setTypeFilter(type)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  typeFilter === type
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100',
                )}
              >
                {type === 'all' ? 'All' : typeLabels[type]}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={remoteOnly}
              onChange={(e) => setRemoteOnly(e.target.checked)}
              className="rounded border-factory-600 bg-factory-800 text-accent-500"
            />
            <span className="text-factory-300 text-sm">Remote only</span>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Total Jobs',
            value: stats.totalJobs.toString(),
            color: 'text-blue-400',
          },
          {
            label: 'Open Positions',
            value: stats.openJobs.toString(),
            color: 'text-green-400',
          },
          {
            label: 'Remote Jobs',
            value: stats.remoteJobs.toString(),
            color: 'text-purple-400',
          },
          {
            label: 'Avg. Salary',
            value:
              stats.averageSalary > 0
                ? `$${stats.averageSalary.toLocaleString()}`
                : '-',
            color: 'text-amber-400',
          },
        ].map((stat) => (
          <div key={stat.label} className="card p-4 text-center">
            {statsLoading ? (
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-factory-500" />
            ) : (
              <p className={clsx('text-2xl font-bold', stat.color)}>
                {stat.value}
              </p>
            )}
            <p className="text-factory-500 text-sm">{stat.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="card p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent-500" />
        </div>
      ) : error ? (
        <div className="card p-12 text-center">
          <Briefcase className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            Failed to load jobs
          </h3>
          <p className="text-factory-500">Please try again later</p>
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="card p-12 text-center">
          <Briefcase className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            No jobs found
          </h3>
          <p className="text-factory-500 mb-4">
            {search
              ? 'Try adjusting your search terms'
              : 'Be the first to post a job'}
          </p>
          <Link to="/jobs/create" className="btn btn-primary">
            Post a Job
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredJobs.map((job) => (
            <Link
              key={job.id}
              to={`/jobs/${job.id}`}
              className="card p-6 card-hover block"
            >
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-factory-100 truncate">
                      {job.title}
                    </h3>
                    <span className="badge badge-info">
                      {typeLabels[job.type]}
                    </span>
                    {job.remote && (
                      <span className="badge badge-success">Remote</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-factory-400 mb-3">
                    <span className="flex items-center gap-1">
                      <Building2 className="w-4 h-4" />
                      {job.company}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      {job.location}
                    </span>
                  </div>
                  <p className="text-factory-400 text-sm line-clamp-2">
                    {job.description}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {job.skills.slice(0, 5).map((skill) => (
                      <span
                        key={skill}
                        className="badge bg-factory-800 text-factory-300"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xl font-bold text-green-400">
                    {formatSalary(job)}
                  </p>
                  <p className="text-factory-500 text-sm mt-1">
                    {job.applications} applications
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

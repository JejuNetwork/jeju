'use client';

import { useState } from 'react';
import { 
  Briefcase, 
  Search, 
  Plus,
  Clock,
  DollarSign,
  Building2,
  Cpu,
  CheckCircle,
  XCircle,
  Loader2,
  Play,
  Pause,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useJobs, useJobStats, useCancelJob, useRetryJob, type JobStatus, type JobType } from '../../hooks';

const typeConfig: Record<JobType, { label: string; color: string }> = {
  'training': { label: 'Training', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  'inference': { label: 'Inference', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  'validation': { label: 'Validation', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  'compute': { label: 'Compute', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
};

const statusConfig: Record<JobStatus, { label: string; icon: typeof Clock; color: string }> = {
  'queued': { label: 'Queued', icon: Clock, color: 'text-gray-400' },
  'running': { label: 'Running', icon: Play, color: 'text-blue-400' },
  'completed': { label: 'Completed', icon: CheckCircle, color: 'text-green-400' },
  'failed': { label: 'Failed', icon: XCircle, color: 'text-red-400' },
  'cancelled': { label: 'Cancelled', icon: Pause, color: 'text-gray-500' },
};

export default function JobsPage() {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<JobType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<JobStatus | 'all'>('all');

  const { jobs, isLoading } = useJobs({
    type: filterType === 'all' ? undefined : filterType,
    status: filterStatus === 'all' ? undefined : filterStatus,
  });
  const { stats } = useJobStats();
  const cancelJob = useCancelJob();
  const retryJob = useRetryJob();

  const filteredJobs = jobs.filter(job => {
    if (search && !job.name.toLowerCase().includes(search.toLowerCase()) &&
        !job.id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return '-';
    const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  };

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Cpu className="w-7 h-7 text-emerald-400" />
            Compute Jobs
          </h1>
          <p className="text-factory-400 mt-1">Training, inference, and compute tasks</p>
        </div>
        <Link href="/jobs/new" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          New Job
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Jobs', value: stats.totalJobs.toString(), icon: Briefcase, color: 'text-emerald-400' },
          { label: 'Running', value: stats.runningJobs.toString(), icon: Play, color: 'text-blue-400' },
          { label: 'Completed', value: stats.completedJobs.toString(), icon: CheckCircle, color: 'text-green-400' },
          { label: 'Total Cost', value: stats.totalCost, icon: DollarSign, color: 'text-purple-400' },
        ].map((stat) => (
          <div key={stat.label} className="card p-4">
            <div className="flex items-center gap-3">
              <stat.icon className={clsx('w-8 h-8', stat.color)} />
              <div>
                <p className="text-2xl font-bold text-factory-100">{stat.value}</p>
                <p className="text-factory-500 text-sm">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
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
            {(['all', 'training', 'inference', 'validation', 'compute'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                  filterType === type
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100'
                )}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {(['all', 'running', 'completed', 'failed'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                  filterStatus === status
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100'
                )}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Job List */}
      {isLoading ? (
        <div className="card p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-accent-400" />
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="card p-12 text-center">
          <Cpu className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">No jobs found</h3>
          <p className="text-factory-500 mb-4">Start your first compute job</p>
          <Link href="/jobs/new" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            New Job
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredJobs.map((job) => {
            const StatusIcon = statusConfig[job.status].icon;
            return (
              <div key={job.id} className="card p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-lg text-factory-100">{job.name}</h3>
                      <span className={clsx('badge border', typeConfig[job.type].color)}>
                        {typeConfig[job.type].label}
                      </span>
                      <span className={clsx('flex items-center gap-1', statusConfig[job.status].color)}>
                        <StatusIcon className="w-4 h-4" />
                        {statusConfig[job.status].label}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-factory-500 mb-3">
                      <span className="font-mono">{job.id}</span>
                      {job.provider && (
                        <span className="flex items-center gap-1">
                          <Building2 className="w-4 h-4" />
                          {job.provider.name}
                        </span>
                      )}
                    </div>

                    {job.status === 'running' && (
                      <div className="mb-3">
                        <div className="flex justify-between text-sm text-factory-400 mb-1">
                          <span>Progress</span>
                          <span>{job.progress}%</span>
                        </div>
                        <div className="h-2 bg-factory-800 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-accent-500 transition-all duration-300"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-6 text-sm text-factory-500">
                      <span className="flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        {job.cost}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {formatDuration(job.duration)}
                      </span>
                      <span>{formatDate(job.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {job.status === 'running' && (
                      <button 
                        onClick={() => cancelJob.mutate(job.id)}
                        disabled={cancelJob.isPending}
                        className="btn btn-secondary text-sm"
                      >
                        {cancelJob.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Pause className="w-4 h-4" />
                        )}
                        Cancel
                      </button>
                    )}
                    {job.status === 'failed' && (
                      <button 
                        onClick={() => retryJob.mutate(job.id)}
                        disabled={retryJob.isPending}
                        className="btn btn-primary text-sm"
                      >
                        {retryJob.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

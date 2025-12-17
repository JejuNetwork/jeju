/**
 * CI/CD Dashboard
 * Workflow runs, job queue, deployments
 */

'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import {
  Play,
  CheckCircle,
  XCircle,
  Clock,
  GitBranch,
  GitCommit,
  RefreshCw,
  Filter,
  Terminal,
  Box,
  Rocket,
  AlertTriangle,
  Pause,
  RotateCcw,
  ExternalLink,
  ChevronRight,
  Tag,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useDWSCI } from '@/lib/hooks';

type WorkflowStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
type FilterStatus = 'all' | WorkflowStatus;

interface WorkflowRun {
  id: string;
  workflowName: string;
  repoName: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  status: WorkflowStatus;
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped';
  triggeredBy: string;
  triggerType: 'push' | 'pull_request' | 'schedule' | 'manual' | 'release';
  startedAt: number;
  completedAt?: number;
  duration?: number;
  jobs: {
    name: string;
    status: WorkflowStatus;
    duration?: number;
  }[];
}

const mockRuns: WorkflowRun[] = [
  {
    id: 'run-1',
    workflowName: 'CI',
    repoName: 'jeju/factory',
    branch: 'main',
    commitSha: 'a1b2c3d',
    commitMessage: 'feat: add CI/CD dashboard',
    status: 'completed',
    conclusion: 'success',
    triggeredBy: 'alice.eth',
    triggerType: 'push',
    startedAt: Date.now() - 15 * 60 * 1000,
    completedAt: Date.now() - 10 * 60 * 1000,
    duration: 5 * 60 * 1000,
    jobs: [
      { name: 'Build', status: 'completed', duration: 120000 },
      { name: 'Test', status: 'completed', duration: 180000 },
      { name: 'Deploy', status: 'completed', duration: 60000 },
    ],
  },
  {
    id: 'run-2',
    workflowName: 'Release',
    repoName: 'jeju/contracts',
    branch: 'v1.2.0',
    commitSha: 'e4f5g6h',
    commitMessage: 'chore: release v1.2.0',
    status: 'in_progress',
    triggeredBy: 'bob.eth',
    triggerType: 'release',
    startedAt: Date.now() - 3 * 60 * 1000,
    jobs: [
      { name: 'Build', status: 'completed', duration: 90000 },
      { name: 'Test', status: 'in_progress' },
      { name: 'Publish', status: 'queued' },
    ],
  },
  {
    id: 'run-3',
    workflowName: 'Security Scan',
    repoName: 'jeju/dws',
    branch: 'feature/cdn',
    commitSha: 'i7j8k9l',
    commitMessage: 'fix: resolve CDN caching issue',
    status: 'failed',
    conclusion: 'failure',
    triggeredBy: 'carol.eth',
    triggerType: 'pull_request',
    startedAt: Date.now() - 45 * 60 * 1000,
    completedAt: Date.now() - 40 * 60 * 1000,
    duration: 5 * 60 * 1000,
    jobs: [
      { name: 'Lint', status: 'completed', duration: 30000 },
      { name: 'Security', status: 'completed', duration: 120000 },
      { name: 'SAST', status: 'completed', duration: 180000 },
    ],
  },
  {
    id: 'run-4',
    workflowName: 'Nightly Build',
    repoName: 'jeju/indexer',
    branch: 'main',
    commitSha: 'm0n1o2p',
    commitMessage: 'Scheduled nightly build',
    status: 'queued',
    triggeredBy: 'system',
    triggerType: 'schedule',
    startedAt: Date.now(),
    jobs: [
      { name: 'Build', status: 'queued' },
      { name: 'Integration Tests', status: 'queued' },
    ],
  },
];

const statusIcons = {
  queued: Clock,
  in_progress: RefreshCw,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: Pause,
};

const statusColors = {
  queued: 'text-factory-400 bg-factory-700/50',
  in_progress: 'text-blue-400 bg-blue-500/20',
  completed: 'text-green-400 bg-green-500/20',
  failed: 'text-red-400 bg-red-500/20',
  cancelled: 'text-amber-400 bg-amber-500/20',
};

const triggerIcons = {
  push: GitCommit,
  pull_request: GitBranch,
  schedule: Clock,
  manual: Play,
  release: Tag,
};

export default function CIPage() {
  const { isConnected } = useAccount();
  const { listWorkflows, isReady } = useDWSCI();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [runs, setRuns] = useState<WorkflowRun[]>(mockRuns);
  const [isLoading, setIsLoading] = useState(false);

  const filteredRuns = runs.filter(run => {
    if (filter === 'all') return true;
    return run.status === filter;
  });

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const stats = {
    total: runs.length,
    running: runs.filter(r => r.status === 'in_progress').length,
    queued: runs.filter(r => r.status === 'queued').length,
    success: runs.filter(r => r.conclusion === 'success').length,
    failed: runs.filter(r => r.conclusion === 'failure').length,
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 lg:mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Play className="w-6 sm:w-7 h-6 sm:h-7 text-green-400" />
            CI/CD Pipelines
          </h1>
          <p className="text-factory-400 mt-1 text-sm sm:text-base">Workflow runs, deployments, and job queue</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary text-sm">
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <Link href="/ci/new" className="btn btn-primary text-sm">
            <Play className="w-4 h-4" />
            <span className="hidden sm:inline">Trigger Workflow</span>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 lg:gap-4 mb-6 lg:mb-8">
        {[
          { label: 'Total Runs', value: stats.total, icon: Terminal, color: 'text-factory-400' },
          { label: 'Running', value: stats.running, icon: RefreshCw, color: 'text-blue-400', animate: true },
          { label: 'Queued', value: stats.queued, icon: Clock, color: 'text-amber-400' },
          { label: 'Successful', value: stats.success, icon: CheckCircle, color: 'text-green-400' },
          { label: 'Failed', value: stats.failed, icon: XCircle, color: 'text-red-400' },
        ].map((stat) => (
          <div key={stat.label} className="card p-3 lg:p-4">
            <div className="flex items-center gap-2 lg:gap-3">
              <stat.icon className={clsx('w-6 lg:w-8 h-6 lg:h-8', stat.color, stat.animate && 'animate-spin')} />
              <div>
                <p className="text-xl lg:text-2xl font-bold text-factory-100">{stat.value}</p>
                <p className="text-factory-500 text-xs lg:text-sm">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {(['all', 'in_progress', 'queued', 'completed', 'failed'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={clsx(
              'px-3 lg:px-4 py-2 rounded-lg text-xs lg:text-sm font-medium transition-colors capitalize',
              filter === status
                ? 'bg-accent-600 text-white'
                : 'bg-factory-800 text-factory-400 hover:text-factory-100'
            )}
          >
            {status === 'all' ? 'All Runs' : status.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Workflow Runs */}
      <div className="space-y-3 lg:space-y-4">
        {filteredRuns.map((run) => {
          const StatusIcon = statusIcons[run.status];
          const TriggerIcon = triggerIcons[run.triggerType];
          
          return (
            <Link
              key={run.id}
              href={`/ci/runs/${run.id}`}
              className="card p-4 lg:p-6 card-hover block"
            >
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                {/* Status & Info */}
                <div className="flex items-start gap-3 lg:gap-4 flex-1 min-w-0">
                  <div className={clsx(
                    'p-2 rounded-lg',
                    statusColors[run.status]
                  )}>
                    <StatusIcon className={clsx(
                      'w-5 h-5',
                      run.status === 'in_progress' && 'animate-spin'
                    )} />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-semibold text-factory-100">{run.workflowName}</span>
                      <span className="text-factory-500">•</span>
                      <span className="text-factory-400">{run.repoName}</span>
                    </div>
                    
                    <p className="text-factory-400 text-sm truncate mb-2">
                      {run.commitMessage}
                    </p>
                    
                    <div className="flex flex-wrap items-center gap-3 text-xs text-factory-500">
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-3 h-3" />
                        {run.branch}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitCommit className="w-3 h-3" />
                        {run.commitSha}
                      </span>
                      <span className="flex items-center gap-1">
                        <TriggerIcon className="w-3 h-3" />
                        {run.triggerType}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(run.startedAt)}
                      </span>
                      {run.duration && (
                        <span className="badge badge-info">
                          {formatDuration(run.duration)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Jobs Progress */}
                <div className="flex items-center gap-2 lg:gap-4">
                  <div className="flex items-center gap-1">
                    {run.jobs.map((job, i) => {
                      const JobIcon = statusIcons[job.status];
                      return (
                        <div
                          key={i}
                          title={`${job.name}: ${job.status}`}
                          className={clsx(
                            'w-6 h-6 rounded flex items-center justify-center',
                            statusColors[job.status]
                          )}
                        >
                          <JobIcon className={clsx(
                            'w-3 h-3',
                            job.status === 'in_progress' && 'animate-spin'
                          )} />
                        </div>
                      );
                    })}
                  </div>
                  <ChevronRight className="w-5 h-5 text-factory-500" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Empty State */}
      {filteredRuns.length === 0 && (
        <div className="card p-8 lg:p-12 text-center">
          <Terminal className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">No workflow runs found</h3>
          <p className="text-factory-500 mb-4">Trigger a workflow or adjust your filters</p>
          <Link href="/ci/new" className="btn btn-primary">
            Trigger Workflow
          </Link>
        </div>
      )}

      {/* Recent Deployments */}
      <div className="mt-8 lg:mt-12">
        <h2 className="text-lg font-semibold text-factory-100 mb-4 flex items-center gap-2">
          <Rocket className="w-5 h-5 text-purple-400" />
          Recent Deployments
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { env: 'Production', app: 'Factory', version: 'v1.2.0', status: 'success', time: '2h ago' },
            { env: 'Staging', app: 'Gateway', version: 'v1.1.5-rc.2', status: 'success', time: '4h ago' },
            { env: 'Preview', app: 'DWS', version: 'pr-234', status: 'in_progress', time: 'Just now' },
          ].map((deploy, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={clsx(
                  'badge',
                  deploy.env === 'Production' && 'bg-green-500/20 text-green-400 border border-green-500/30',
                  deploy.env === 'Staging' && 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
                  deploy.env === 'Preview' && 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                )}>
                  {deploy.env}
                </span>
                {deploy.status === 'success' ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
                )}
              </div>
              <p className="font-medium text-factory-100">{deploy.app}</p>
              <div className="flex items-center justify-between mt-2 text-sm text-factory-500">
                <span className="font-mono">{deploy.version}</span>
                <span>{deploy.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


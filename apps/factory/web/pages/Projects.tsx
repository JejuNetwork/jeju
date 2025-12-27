/**
 * Projects Page
 *
 * Browse and filter projects with responsive design.
 */

import { clsx } from 'clsx'
import { CheckCircle, Clock, LayoutDashboard, Plus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchBar,
  StatsGrid,
} from '../components/shared'
import { type Project, useProjects } from '../hooks/useProjects'

const statusColors: Record<Project['status'], string> = {
  active: 'badge-success',
  on_hold: 'badge-warning',
  completed: 'badge-info',
  archived: 'badge-neutral',
}

const statusLabels: Record<Project['status'], string> = {
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
  archived: 'Archived',
}

const statusFilters = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
]

export function ProjectsPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Project['status'] | 'all'>('all')

  const { projects, isLoading, error } = useProjects(
    statusFilter !== 'all' ? { status: statusFilter } : undefined,
  )

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      if (!search) return true
      return project.name.toLowerCase().includes(search.toLowerCase())
    })
  }, [projects, search])

  const stats = useMemo(() => ({
    total: projects.length,
    active: projects.filter((p) => p.status === 'active').length,
    completed: projects.filter((p) => p.status === 'completed').length,
    totalMembers: projects.reduce((sum, p) => sum + p.members, 0),
  }), [projects])

  const statsData = useMemo(() => [
    { label: 'Total Projects', value: stats.total.toString(), color: 'text-accent-400', loading: isLoading },
    { label: 'Active', value: stats.active.toString(), color: 'text-success-400', loading: isLoading },
    { label: 'Completed', value: stats.completed.toString(), color: 'text-info-400', loading: isLoading },
    { label: 'Total Members', value: stats.totalMembers.toString(), color: 'text-warning-400', loading: isLoading },
  ], [stats, isLoading])

  const getProgress = (project: Project) => {
    if (project.tasks.total === 0) return 0
    return Math.round((project.tasks.completed / project.tasks.total) * 100)
  }

  return (
    <div className="page-container">
      <PageHeader
        title="Projects"
        icon={LayoutDashboard}
        iconColor="text-accent-400"
        action={
          <Link to="/projects/new" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New</span> Project
          </Link>
        }
      />

      <div className="card p-3 sm:p-4 mb-6 animate-in">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search projects..."
            className="flex-1 mb-0 p-0 border-0 bg-transparent shadow-none"
          />

          <div className="flex flex-wrap gap-2" role="group" aria-label="Status filters">
            {statusFilters.map((status) => (
              <button
                key={status.value}
                type="button"
                onClick={() => setStatusFilter(status.value as Project['status'] | 'all')}
                className={clsx(
                  'px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  statusFilter === status.value
                    ? 'bg-factory-500 text-white shadow-glow'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-100 hover:bg-surface-700',
                )}
                aria-pressed={statusFilter === status.value}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <StatsGrid stats={statsData} columns={4} />

      {isLoading ? (
        <LoadingState text="Loading projects..." />
      ) : error ? (
        <ErrorState title="Failed to load projects" />
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="No projects found"
          description={search ? 'Try a different search term' : 'Create a project to track your work'}
          actionLabel="New Project"
          actionHref="/projects/new"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project, index) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="card p-5 sm:p-6 card-hover block animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-surface-100 truncate">{project.name}</h3>
                  <p className="text-surface-500 text-sm capitalize">{project.visibility}</p>
                </div>
                <span className={clsx('badge', statusColors[project.status])}>
                  {statusLabels[project.status]}
                </span>
              </div>

              <p className="text-surface-400 text-sm line-clamp-2 mb-4">
                {project.description ?? 'No description provided'}
              </p>

              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-surface-500">Progress</span>
                  <span className="text-surface-300 font-medium">{getProgress(project)}%</span>
                </div>
                <div className="w-full h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-factory-500 to-accent-500 rounded-full transition-all duration-500"
                    style={{ width: `${getProgress(project)}%` }}
                    role="progressbar"
                    aria-valuenow={getProgress(project)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-sm text-surface-500">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4" aria-hidden="true" />
                    {project.tasks.completed}/{project.tasks.total}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" aria-hidden="true" />
                    {project.tasks.inProgress}
                  </span>
                </div>
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" aria-hidden="true" />
                  {project.members}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

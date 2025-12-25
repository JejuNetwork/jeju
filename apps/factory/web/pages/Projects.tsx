import { clsx } from 'clsx'
import {
  CheckCircle,
  Clock,
  LayoutDashboard,
  Loader2,
  Plus,
  Search,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { type Project, useProjects } from '../hooks/useProjects'

const statusColors: Record<Project['status'], string> = {
  active: 'badge-success',
  on_hold: 'badge-warning',
  completed: 'badge-info',
  archived: 'bg-factory-700/50 text-factory-300',
}

const statusLabels: Record<Project['status'], string> = {
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
  archived: 'Archived',
}

export function ProjectsPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Project['status'] | 'all'>(
    'all',
  )

  const { projects, isLoading, error } = useProjects(
    statusFilter !== 'all' ? { status: statusFilter } : undefined,
  )

  const filteredProjects = projects.filter((project) => {
    if (search && !project.name.toLowerCase().includes(search.toLowerCase())) {
      return false
    }
    return true
  })

  const stats = {
    total: projects.length,
    active: projects.filter((p) => p.status === 'active').length,
    completed: projects.filter((p) => p.status === 'completed').length,
    totalMembers: projects.reduce((sum, p) => sum + p.members, 0),
  }

  const getProgress = (project: Project) => {
    if (project.tasks.total === 0) return 0
    return Math.round((project.tasks.completed / project.tasks.total) * 100)
  }

  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <LayoutDashboard className="w-7 h-7 text-indigo-400" />
            Projects
          </h1>
          <p className="text-factory-400 mt-1">
            Project management and coordination
          </p>
        </div>
        <Link to="/projects/new" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          New Project
        </Link>
      </div>

      <div className="card p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          <div className="flex gap-2">
            {(
              ['all', 'active', 'on_hold', 'completed', 'archived'] as const
            ).map((status) => (
              <button
                type="button"
                key={status}
                onClick={() => setStatusFilter(status)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  statusFilter === status
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100',
                )}
              >
                {status === 'all' ? 'All' : statusLabels[status]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Total Projects',
            value: stats.total.toString(),
            color: 'text-indigo-400',
          },
          {
            label: 'Active',
            value: stats.active.toString(),
            color: 'text-green-400',
          },
          {
            label: 'Completed',
            value: stats.completed.toString(),
            color: 'text-blue-400',
          },
          {
            label: 'Total Members',
            value: stats.totalMembers.toString(),
            color: 'text-purple-400',
          },
        ].map((stat) => (
          <div key={stat.label} className="card p-4 text-center">
            {isLoading ? (
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
          <LayoutDashboard className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            Failed to load projects
          </h3>
          <p className="text-factory-500">Please try again later</p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="card p-12 text-center">
          <LayoutDashboard className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            No projects found
          </h3>
          <p className="text-factory-500 mb-4">
            {search
              ? 'Try adjusting your search terms'
              : 'Create your first project'}
          </p>
          <Link to="/projects/new" className="btn btn-primary">
            New Project
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="card p-6 card-hover block"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-factory-100 truncate">
                    {project.name}
                  </h3>
                  <p className="text-factory-500 text-sm capitalize">
                    {project.visibility}
                  </p>
                </div>
                <span className={clsx('badge', statusColors[project.status])}>
                  {statusLabels[project.status]}
                </span>
              </div>

              <p className="text-factory-400 text-sm line-clamp-2 mb-4">
                {project.description ?? 'No description provided'}
              </p>

              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-factory-500">Progress</span>
                  <span className="text-factory-300">
                    {getProgress(project)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-factory-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-500 rounded-full transition-all"
                    style={{ width: `${getProgress(project)}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-sm text-factory-500">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" />
                    {project.tasks.completed}/{project.tasks.total}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {project.tasks.inProgress}
                  </span>
                </div>
                <span className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
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

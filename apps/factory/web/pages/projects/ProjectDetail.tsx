import { clsx } from 'clsx'
import {
  ArrowLeft,
  Calendar,
  CheckCircle,
  Circle,
  Clock,
  LayoutDashboard,
  Plus,
  Settings,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, EmptyState, LoadingState } from '../../components/shared'
import {
  type ProjectTask,
  useCreateTask,
  useProject,
  useProjectTasks,
  useUpdateTask,
} from '../../hooks/useProjects'
import { formatRelativeTime } from '../../lib/format'

type TabType = 'tasks' | 'members' | 'timeline' | 'settings'

const statusColors: Record<string, string> = {
  active: 'badge-success',
  on_hold: 'badge-warning',
  completed: 'badge-info',
  archived: 'badge-neutral',
}

const statusLabels: Record<string, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
  archived: 'Archived',
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState<TabType>('tasks')
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')

  const { project, isLoading, error } = useProject(id ?? '')
  const { tasks, isLoading: tasksLoading } = useProjectTasks(id ?? '')
  const updateTaskMutation = useUpdateTask(id ?? '')
  const createTaskMutation = useCreateTask(id ?? '')

  const handleToggleTask = async (task: ProjectTask) => {
    const newStatus = task.status === 'completed' ? 'pending' : 'completed'
    try {
      await updateTaskMutation.mutateAsync({
        taskId: task.id,
        updates: { status: newStatus },
      })
      toast.success(
        newStatus === 'completed' ? 'Task completed' : 'Task reopened',
      )
    } catch {
      toast.error('Failed to update task')
    }
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTaskTitle.trim()) return

    try {
      await createTaskMutation.mutateAsync({ title: newTaskTitle.trim() })
      toast.success('Task created')
      setNewTaskTitle('')
      setShowNewTask(false)
    } catch {
      toast.error('Failed to create task')
    }
  }

  if (isLoading) {
    return (
      <div className="page-container">
        <LoadingState text="Loading project..." />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="page-container">
        <Link
          to="/projects"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </Link>
        <EmptyState
          icon={LayoutDashboard}
          title="Project not found"
          description="The project you're looking for doesn't exist or has been removed."
          actionLabel="Browse Projects"
          actionHref="/projects"
        />
      </div>
    )
  }

  const progress =
    project.tasks.total === 0
      ? 0
      : Math.round((project.tasks.completed / project.tasks.total) * 100)

  const tabs = [
    {
      id: 'tasks' as const,
      label: 'Tasks',
      icon: CheckCircle,
      count: tasks.length,
    },
    {
      id: 'members' as const,
      label: 'Members',
      icon: Users,
      count: project.members,
    },
    { id: 'timeline' as const, label: 'Timeline', icon: Calendar },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
  ]

  return (
    <div className="page-container">
      {/* Back link */}
      <Link
        to="/projects"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Projects
      </Link>

      {/* Header */}
      <div className="card p-6 mb-6 animate-in">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-surface-100 font-display">
                {project.name}
              </h1>
              <span className={clsx('badge', statusColors[project.status])}>
                {statusLabels[project.status]}
              </span>
              <span className="badge badge-neutral capitalize">
                {project.visibility}
              </span>
            </div>
            <p className="text-surface-400 mb-4">
              {project.description || 'No description provided'}
            </p>

            {/* Progress bar */}
            <div className="max-w-md">
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-surface-500">Progress</span>
                <span className="text-surface-300 font-medium">
                  {progress}%
                </span>
              </div>
              <div className="w-full h-2 bg-surface-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-factory-500 to-accent-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-surface-100 font-display">
                {project.tasks.completed}/{project.tasks.total}
              </p>
              <p className="text-sm text-surface-500">Tasks Done</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-surface-100 font-display">
                {project.tasks.inProgress}
              </p>
              <p className="text-sm text-surface-500">In Progress</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-surface-100 font-display">
                {project.members}
              </p>
              <p className="text-sm text-surface-500">Members</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-surface-800/50 mb-6">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'text-factory-400 border-factory-400'
                : 'text-surface-400 border-transparent hover:text-surface-100 hover:border-surface-600',
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.count !== undefined && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-surface-800 text-surface-400">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'tasks' && (
        <TasksTab
          tasks={tasks}
          isLoading={tasksLoading}
          showNewTask={showNewTask}
          setShowNewTask={setShowNewTask}
          newTaskTitle={newTaskTitle}
          setNewTaskTitle={setNewTaskTitle}
          onToggleTask={handleToggleTask}
          onCreateTask={handleCreateTask}
          isCreating={createTaskMutation.isPending}
        />
      )}

      {activeTab === 'members' && <MembersTab memberCount={project.members} />}

      {activeTab === 'timeline' && <TimelineTab />}

      {activeTab === 'settings' && <SettingsTab project={project} />}
    </div>
  )
}

interface TasksTabProps {
  tasks: ProjectTask[]
  isLoading: boolean
  showNewTask: boolean
  setShowNewTask: (show: boolean) => void
  newTaskTitle: string
  setNewTaskTitle: (title: string) => void
  onToggleTask: (task: ProjectTask) => void
  onCreateTask: (e: React.FormEvent) => void
  isCreating: boolean
}

function TasksTab({
  tasks,
  isLoading,
  showNewTask,
  setShowNewTask,
  newTaskTitle,
  setNewTaskTitle,
  onToggleTask,
  onCreateTask,
  isCreating,
}: TasksTabProps) {
  if (isLoading) {
    return (
      <div className="card p-8 animate-in">
        <LoadingState text="Loading tasks..." />
      </div>
    )
  }

  // Group tasks by status
  const pendingTasks = tasks.filter((t) => t.status === 'pending')
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress')
  const completedTasks = tasks.filter((t) => t.status === 'completed')

  return (
    <div className="space-y-6">
      {/* Add task button */}
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          onClick={() => setShowNewTask(true)}
        >
          Add Task
        </Button>
      </div>

      {/* New task form */}
      {showNewTask && (
        <form onSubmit={onCreateTask} className="card p-4 animate-in">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Enter task title..."
              className="input flex-1"
            />
            <Button type="submit" variant="primary" loading={isCreating}>
              Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowNewTask(false)
                setNewTaskTitle('')
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {tasks.length === 0 ? (
        <div className="card p-8 animate-in text-center">
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-surface-600" />
          <h3 className="text-lg font-semibold text-surface-200 mb-2">
            No Tasks Yet
          </h3>
          <p className="text-surface-500">
            Add tasks to track your project progress.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Pending */}
          <TaskColumn
            title="Pending"
            tasks={pendingTasks}
            onToggleTask={onToggleTask}
            icon={Circle}
            iconColor="text-surface-500"
          />

          {/* In Progress */}
          <TaskColumn
            title="In Progress"
            tasks={inProgressTasks}
            onToggleTask={onToggleTask}
            icon={Clock}
            iconColor="text-warning-400"
          />

          {/* Completed */}
          <TaskColumn
            title="Completed"
            tasks={completedTasks}
            onToggleTask={onToggleTask}
            icon={CheckCircle}
            iconColor="text-success-400"
          />
        </div>
      )}
    </div>
  )
}

interface TaskColumnProps {
  title: string
  tasks: ProjectTask[]
  onToggleTask: (task: ProjectTask) => void
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
}

function TaskColumn({
  title,
  tasks,
  onToggleTask,
  icon: Icon,
  iconColor,
}: TaskColumnProps) {
  return (
    <div className="card p-4 animate-in">
      <div className="flex items-center gap-2 mb-4">
        <Icon className={clsx('w-4 h-4', iconColor)} />
        <h3 className="font-semibold text-surface-200">{title}</h3>
        <span className="px-2 py-0.5 text-xs rounded-full bg-surface-800 text-surface-400">
          {tasks.length}
        </span>
      </div>
      <div className="space-y-2">
        {tasks.map((task) => (
          <button
            type="button"
            key={task.id}
            onClick={() => onToggleTask(task)}
            className={clsx(
              'w-full text-left p-3 rounded-lg border border-surface-800/50 hover:border-surface-700 transition-colors',
              task.status === 'completed' && 'opacity-60',
            )}
          >
            <p
              className={clsx(
                'text-sm',
                task.status === 'completed'
                  ? 'text-surface-500 line-through'
                  : 'text-surface-200',
              )}
            >
              {task.title}
            </p>
            {task.dueDate && (
              <p className="text-xs text-surface-500 mt-1">
                Due {formatRelativeTime(task.dueDate)}
              </p>
            )}
          </button>
        ))}
        {tasks.length === 0 && (
          <p className="text-sm text-surface-500 text-center py-4">No tasks</p>
        )}
      </div>
    </div>
  )
}

interface MembersTabProps {
  memberCount: number
}

function MembersTab({ memberCount }: MembersTabProps) {
  return (
    <div className="card p-8 animate-in text-center">
      <Users className="w-12 h-12 mx-auto mb-3 text-surface-600" />
      <h3 className="text-lg font-semibold text-surface-200 mb-2">
        Team Members
      </h3>
      <p className="text-surface-500 mb-4">
        {memberCount} members are part of this project.
      </p>
      <p className="text-sm text-surface-600">Member management coming soon.</p>
    </div>
  )
}

function TimelineTab() {
  return (
    <div className="card p-8 animate-in text-center">
      <Calendar className="w-12 h-12 mx-auto mb-3 text-surface-600" />
      <h3 className="text-lg font-semibold text-surface-200 mb-2">
        Project Timeline
      </h3>
      <p className="text-surface-500">
        Timeline view with milestones and deadlines coming soon.
      </p>
    </div>
  )
}

interface SettingsTabProps {
  project: {
    name: string
    visibility: string
    status: string
  }
}

function SettingsTab({ project }: SettingsTabProps) {
  return (
    <div className="card p-6 animate-in max-w-2xl">
      <h3 className="text-lg font-semibold text-surface-100 mb-6">
        Project Settings
      </h3>
      <div className="space-y-4">
        <label className="block">
          <span className="block text-sm font-medium text-surface-200 mb-2">
            Project Name
          </span>
          <input
            type="text"
            value={project.name}
            readOnly
            className="input w-full"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-surface-200 mb-2">
            Visibility
          </span>
          <select value={project.visibility} className="input w-full" disabled>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-surface-200 mb-2">
            Status
          </span>
          <select value={project.status} className="input w-full" disabled>
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <p className="text-sm text-surface-500 pt-4">
          Project settings updates coming soon.
        </p>
      </div>
    </div>
  )
}

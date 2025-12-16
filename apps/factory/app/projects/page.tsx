'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { 
  Kanban, 
  Search, 
  Plus,
  Users,
  Clock,
  CheckCircle2,
  Circle,
  AlertCircle,
  Timer,
  MoreVertical,
  Filter,
  Calendar
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';

type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';

interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee?: string;
  labels: string[];
  dueDate?: number;
  bountyId?: string;
}

interface Project {
  id: string;
  name: string;
  description: string;
  owner: string;
  members: string[];
  tasks: Task[];
  createdAt: number;
}

const mockProject: Project = {
  id: '0x123',
  name: 'Jeju Factory v2',
  description: 'Building the next generation of developer coordination tools',
  owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  members: ['alice.eth', 'bob.eth', 'carol.eth'],
  tasks: [
    {
      id: '1',
      title: 'Implement Guardian staking UI',
      description: 'Add UI for guardians to stake and manage their stake tiers',
      status: 'in_progress',
      priority: 'high',
      assignee: 'alice.eth',
      labels: ['frontend', 'guardian'],
      dueDate: Date.now() + 3 * 24 * 60 * 60 * 1000,
      bountyId: '0xabc123',
    },
    {
      id: '2',
      title: 'Model Hub inference integration',
      description: 'Connect model hub to compute marketplace for try-it-now feature',
      status: 'todo',
      priority: 'urgent',
      assignee: 'bob.eth',
      labels: ['backend', 'models', 'compute'],
      dueDate: Date.now() + 2 * 24 * 60 * 60 * 1000,
    },
    {
      id: '3',
      title: 'Bounty milestone validation flow',
      description: 'Build the end-to-end flow for milestone submission and guardian validation',
      status: 'review',
      priority: 'high',
      assignee: 'carol.eth',
      labels: ['contracts', 'bounty'],
    },
    {
      id: '4',
      title: 'Farcaster feed integration',
      description: 'Integrate Farcaster channels for project discussion feed',
      status: 'backlog',
      priority: 'medium',
      labels: ['social', 'integration'],
    },
    {
      id: '5',
      title: 'GitHub sync for repositories',
      description: 'Two-way sync between Jeju Git and GitHub repos',
      status: 'backlog',
      priority: 'low',
      labels: ['git', 'integration'],
    },
    {
      id: '6',
      title: 'Container registry auth',
      description: 'Implement OIDC auth for private container registry',
      status: 'done',
      priority: 'high',
      assignee: 'alice.eth',
      labels: ['containers', 'auth'],
    },
    {
      id: '7',
      title: 'Package verification pipeline',
      description: 'Automated security scanning for published packages',
      status: 'done',
      priority: 'medium',
      assignee: 'bob.eth',
      labels: ['packages', 'security'],
    },
  ],
  createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
};

const statusConfig: Record<TaskStatus, { label: string; color: string; icon: typeof Circle }> = {
  backlog: { label: 'Backlog', color: 'text-factory-500', icon: Circle },
  todo: { label: 'To Do', color: 'text-blue-400', icon: Circle },
  in_progress: { label: 'In Progress', color: 'text-amber-400', icon: Timer },
  review: { label: 'Review', color: 'text-purple-400', icon: AlertCircle },
  done: { label: 'Done', color: 'text-green-400', icon: CheckCircle2 },
};

const priorityConfig: Record<TaskPriority, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  high: { label: 'High', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  medium: { label: 'Medium', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  low: { label: 'Low', color: 'bg-factory-700 text-factory-400 border-factory-600' },
};

export default function ProjectsPage() {
  const { isConnected } = useAccount();
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');

  const columns: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done'];

  const filteredTasks = mockProject.tasks.filter(task =>
    task.title.toLowerCase().includes(search.toLowerCase()) ||
    task.description.toLowerCase().includes(search.toLowerCase()) ||
    task.labels.some(l => l.toLowerCase().includes(search.toLowerCase()))
  );

  const getTasksByStatus = (status: TaskStatus) => 
    filteredTasks.filter(task => task.status === status);

  const formatDate = (timestamp: number) => {
    const days = Math.ceil((timestamp - Date.now()) / (1000 * 60 * 60 * 24));
    if (days < 0) return 'Overdue';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `${days}d`;
  };

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Kanban className="w-7 h-7 text-indigo-400" />
            {mockProject.name}
          </h1>
          <p className="text-factory-400 mt-1">{mockProject.description}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center -space-x-2">
            {mockProject.members.map((member, i) => (
              <div
                key={member}
                className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center text-xs font-bold border-2 border-factory-900"
                title={member}
              >
                {member[0].toUpperCase()}
              </div>
            ))}
          </div>
          <button className="btn btn-secondary">
            <Users className="w-4 h-4" />
            Invite
          </button>
          <Link href="/bounties/new" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            New Task
          </Link>
        </div>
      </div>

      {/* Toolbar */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          <div className="flex items-center gap-2">
            <button className="btn btn-secondary">
              <Filter className="w-4 h-4" />
              Filter
            </button>
            <div className="flex bg-factory-800 rounded-lg p-1">
              <button
                onClick={() => setViewMode('board')}
                className={clsx(
                  'px-3 py-1.5 rounded text-sm font-medium transition-colors',
                  viewMode === 'board' ? 'bg-factory-700 text-factory-100' : 'text-factory-400'
                )}
              >
                Board
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={clsx(
                  'px-3 py-1.5 rounded text-sm font-medium transition-colors',
                  viewMode === 'list' ? 'bg-factory-700 text-factory-100' : 'text-factory-400'
                )}
              >
                List
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      {viewMode === 'board' && (
        <div className="grid grid-cols-5 gap-4">
          {columns.map((status) => {
            const config = statusConfig[status];
            const tasks = getTasksByStatus(status);

            return (
              <div key={status} className="space-y-3">
                {/* Column Header */}
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <config.icon className={clsx('w-4 h-4', config.color)} />
                    <span className="font-medium text-factory-300">{config.label}</span>
                    <span className="text-factory-500 text-sm">({tasks.length})</span>
                  </div>
                  <button className="p-1 hover:bg-factory-800 rounded">
                    <Plus className="w-4 h-4 text-factory-500" />
                  </button>
                </div>

                {/* Tasks */}
                <div className="space-y-2 min-h-[200px]">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="card p-3 cursor-pointer hover:border-factory-600 transition-colors"
                    >
                      {/* Priority & Labels */}
                      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                        <span className={clsx('badge text-xs border', priorityConfig[task.priority].color)}>
                          {priorityConfig[task.priority].label}
                        </span>
                        {task.bountyId && (
                          <span className="badge badge-success text-xs">
                            Bounty
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h4 className="text-sm font-medium text-factory-200 mb-2">
                        {task.title}
                      </h4>

                      {/* Labels */}
                      <div className="flex flex-wrap gap-1 mb-3">
                        {task.labels.slice(0, 2).map((label) => (
                          <span key={label} className="badge badge-info text-xs">
                            {label}
                          </span>
                        ))}
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between text-xs text-factory-500">
                        {task.assignee ? (
                          <div className="flex items-center gap-1">
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center text-[10px] font-bold">
                              {task.assignee[0].toUpperCase()}
                            </div>
                            <span>{task.assignee}</span>
                          </div>
                        ) : (
                          <span>Unassigned</span>
                        )}
                        {task.dueDate && (
                          <span className={clsx(
                            'flex items-center gap-1',
                            task.dueDate < Date.now() && 'text-red-400'
                          )}>
                            <Calendar className="w-3 h-3" />
                            {formatDate(task.dueDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-factory-700">
                <th className="text-left p-4 text-factory-400 font-medium">Task</th>
                <th className="text-left p-4 text-factory-400 font-medium">Status</th>
                <th className="text-left p-4 text-factory-400 font-medium">Priority</th>
                <th className="text-left p-4 text-factory-400 font-medium">Assignee</th>
                <th className="text-left p-4 text-factory-400 font-medium">Due</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const statusCfg = statusConfig[task.status];
                return (
                  <tr key={task.id} className="border-b border-factory-800 hover:bg-factory-800/50">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <statusCfg.icon className={clsx('w-4 h-4', statusCfg.color)} />
                        <div>
                          <p className="font-medium text-factory-200">{task.title}</p>
                          <div className="flex gap-1 mt-1">
                            {task.labels.slice(0, 3).map((label) => (
                              <span key={label} className="badge badge-info text-xs">
                                {label}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={clsx('text-sm', statusCfg.color)}>
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={clsx('badge text-xs border', priorityConfig[task.priority].color)}>
                        {priorityConfig[task.priority].label}
                      </span>
                    </td>
                    <td className="p-4">
                      {task.assignee ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center text-xs font-bold">
                            {task.assignee[0].toUpperCase()}
                          </div>
                          <span className="text-sm text-factory-300">{task.assignee}</span>
                        </div>
                      ) : (
                        <span className="text-factory-500 text-sm">-</span>
                      )}
                    </td>
                    <td className="p-4">
                      {task.dueDate ? (
                        <span className={clsx(
                          'text-sm',
                          task.dueDate < Date.now() ? 'text-red-400' : 'text-factory-400'
                        )}>
                          {formatDate(task.dueDate)}
                        </span>
                      ) : (
                        <span className="text-factory-500 text-sm">-</span>
                      )}
                    </td>
                    <td className="p-4">
                      <button className="p-1 hover:bg-factory-700 rounded">
                        <MoreVertical className="w-4 h-4 text-factory-500" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


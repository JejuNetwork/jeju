import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDwsUrl } from '../config/contracts'

// ============ Types ============

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface ProjectMember {
  id: string
  name: string
  avatar: string
  role: 'owner' | 'admin' | 'member'
}

export interface ProjectTask {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignee?: ProjectMember
  labels: string[]
  dueDate?: number
  createdAt: number
  updatedAt: number
  bountyId?: string
  bountyReward?: string
}

export interface Project {
  id: string
  name: string
  description: string
  owner: string
  members: ProjectMember[]
  tasks: ProjectTask[]
  createdAt: number
  updatedAt: number
}

// ============ Fetchers ============

async function fetchProjects(): Promise<Project[]> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/projects`)
  if (!res.ok) return []
  const data = await res.json()
  return data.projects || []
}

async function fetchProject(projectId: string): Promise<Project | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/projects/${projectId}`)
  if (!res.ok) return null
  return res.json()
}

async function updateTask(
  projectId: string,
  taskId: string,
  updates: Partial<ProjectTask>,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(
    `${dwsUrl}/api/projects/${projectId}/tasks/${taskId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    },
  )
  return res.ok
}

async function createTask(
  projectId: string,
  task: Omit<ProjectTask, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<ProjectTask | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  })
  if (!res.ok) return null
  return res.json()
}

// ============ Hooks ============

export function useProjects() {
  const {
    data: projects,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 30000,
  })

  return {
    projects: projects || [],
    isLoading,
    error,
    refetch,
  }
}

export function useProject(projectId: string) {
  const {
    data: project,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => fetchProject(projectId),
    enabled: !!projectId,
    staleTime: 30000,
  })

  return {
    project,
    isLoading,
    error,
    refetch,
  }
}

export function useUpdateTask(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      taskId,
      updates,
    }: {
      taskId: string
      updates: Partial<ProjectTask>
    }) => updateTask(projectId, taskId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
}

export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (task: Omit<ProjectTask, 'id' | 'createdAt' | 'updatedAt'>) =>
      createTask(projectId, task),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
}

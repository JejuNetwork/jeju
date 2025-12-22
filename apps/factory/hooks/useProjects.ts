import { getCoreAppUrl } from '@jejunetwork/config/ports'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import { api, extractDataSafe } from '../lib/client'

export interface ProjectTask {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
  assignee?: string
  dueDate?: number
}

export interface Project {
  id: string
  name: string
  description: string
  status: 'active' | 'archived' | 'completed' | 'on_hold'
  visibility: 'public' | 'private' | 'internal'
  owner: Address
  members: number
  tasks: {
    total: number
    completed: number
    inProgress: number
    pending: number
  }
  milestones: Array<{ name: string; progress: number }>
  createdAt: number
  updatedAt: number
}

const API_BASE =
  typeof window !== 'undefined'
    ? ''
    : process.env.FACTORY_API_URL || getCoreAppUrl('FACTORY')

async function fetchApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) return null
  return response.json()
}

async function fetchProjects(query?: {
  status?: Project['status']
  owner?: Address
}): Promise<Project[]> {
  const response = await api.api.projects.get({
    query: { status: query?.status, owner: query?.owner },
  })
  const data = extractDataSafe(response) as { projects: Project[] } | null
  return data?.projects || []
}

async function fetchProject(projectId: string): Promise<Project | null> {
  return fetchApi<Project>(`/api/projects/${projectId}`)
}

async function fetchProjectTasks(projectId: string): Promise<ProjectTask[]> {
  const data = await fetchApi<{ tasks: ProjectTask[] }>(
    `/api/projects/${projectId}/tasks`,
  )
  return data?.tasks || []
}

async function updateTask(
  projectId: string,
  taskId: string,
  updates: Partial<ProjectTask>,
): Promise<ProjectTask | null> {
  return fetchApi<ProjectTask>(`/api/projects/${projectId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

async function createTask(
  projectId: string,
  data: { title: string; assignee?: string; dueDate?: number },
): Promise<ProjectTask | null> {
  return fetchApi<ProjectTask>(`/api/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function useProjects(query?: {
  status?: Project['status']
  owner?: Address
}) {
  const {
    data: projects,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['projects', query],
    queryFn: () => fetchProjects(query),
    staleTime: 30000,
  })
  return { projects: projects || [], isLoading, error, refetch }
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
  return { project, isLoading, error, refetch }
}

export function useProjectTasks(projectId: string) {
  const {
    data: tasks,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['projectTasks', projectId],
    queryFn: () => fetchProjectTasks(projectId),
    enabled: !!projectId,
    staleTime: 30000,
  })
  return { tasks: tasks || [], isLoading, error, refetch }
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
      queryClient.invalidateQueries({ queryKey: ['projectTasks', projectId] })
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
}

export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      title: string
      assignee?: string
      dueDate?: number
    }) => createTask(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectTasks', projectId] })
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
}

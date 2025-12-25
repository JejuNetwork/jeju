import { hasArrayProperty } from '@jejunetwork/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import type { Project, ProjectTask } from '../../lib/types'
import { api, extractDataSafe } from '../lib/client'

export type { Project, ProjectTask }

// Browser-only hook - API is same origin
const API_BASE = ''

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

interface ProjectsResponse {
  projects: Project[]
}

function isProjectsResponse(data: unknown): data is ProjectsResponse {
  return hasArrayProperty(data, 'projects')
}

async function fetchProjects(query?: {
  status?: Project['status']
  owner?: Address
}): Promise<Project[]> {
  const response = await api.api.projects.get({
    query: { status: query?.status, owner: query?.owner },
  })
  const data = extractDataSafe(response)
  if (!isProjectsResponse(data)) return []
  return data.projects
}

async function fetchProject(projectId: string): Promise<Project | null> {
  return fetchApi<Project>(`/api/projects/${projectId}`)
}

async function fetchProjectTasks(projectId: string): Promise<ProjectTask[]> {
  const data = await fetchApi<{ tasks: ProjectTask[] }>(
    `/api/projects/${projectId}/tasks`,
  )
  return data?.tasks ?? []
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
  return { projects: projects ?? [], isLoading, error, refetch }
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
  return { tasks: tasks ?? [], isLoading, error, refetch }
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

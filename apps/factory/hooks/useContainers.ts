import { getCoreAppUrl } from '@jejunetwork/config/ports'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, extractDataSafe } from '../lib/client'

function getFactoryApiUrl(): string {
  if (typeof window !== 'undefined') return ''
  return process.env.FACTORY_API_URL || getCoreAppUrl('FACTORY')
}

// ============ Types ============

export type ContainerStatus = 'running' | 'stopped' | 'building' | 'failed'

export interface ContainerImage {
  id: string
  name: string
  tag: string
  size: string
  digest: string
  createdAt: number
  pulls: number
  isPublic: boolean
  description?: string
}

export interface ContainerInstance {
  id: string
  name: string
  image: string
  status: ContainerStatus
  cpu: string
  memory: string
  gpu?: string
  port?: number
  endpoint?: string
  createdAt: number
  startedAt?: number
  cost: string
}

export interface ContainerStats {
  totalImages: number
  runningContainers: number
  totalPulls: number
  totalStorage: string
}

// ============ Fetchers using Eden Treaty ============

interface ApiContainerImage {
  id: string
  name: string
  tag: string
  digest: string
  size: number | string
  platform?: string
  downloads?: number
  createdAt: number
  updatedAt?: number
  description?: string
}

async function fetchImages(query?: {
  search?: string
}): Promise<ContainerImage[]> {
  const response = await api.api.containers.get({
    query: {
      q: query?.search,
    },
  })

  const data = extractDataSafe(response)
  if (!data) return []

  // API returns { containers, total }
  const result = data as { containers?: ApiContainerImage[]; total?: number }

  // Transform API response to expected format
  return (result.containers || []).map((c) => ({
    id: c.id,
    name: c.name,
    tag: c.tag,
    size:
      typeof c.size === 'number'
        ? formatBytes(c.size as number)
        : String(c.size),
    digest: c.digest,
    createdAt: c.createdAt,
    pulls: c.downloads || 0,
    isPublic: true,
    description: c.description,
  }))
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

async function fetchInstances(): Promise<ContainerInstance[]> {
  // Instances endpoint may not be in the typed API
  const baseUrl = getFactoryApiUrl()
  const res = await fetch(`${baseUrl}/api/containers/instances`)
  if (!res.ok) return []
  const data = await res.json()
  return data.instances || []
}

async function fetchContainerStats(): Promise<ContainerStats> {
  // Calculate stats from images list
  const images = await fetchImages()
  const totalBytes = images.reduce((sum, img) => sum + parseSize(img.size), 0)
  return {
    totalImages: images.length,
    runningContainers: 0,
    totalPulls: images.reduce((sum, img) => sum + img.pulls, 0),
    totalStorage: formatBytes(totalBytes),
  }
}

function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB)$/i)
  if (!match) return 0
  const num = Number.parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
  }
  return num * (multipliers[unit] || 1)
}

async function startContainer(
  imageId: string,
  config: { name: string; cpu: string; memory: string; gpu?: string },
): Promise<ContainerInstance | null> {
  const baseUrl = getFactoryApiUrl()
  const res = await fetch(`${baseUrl}/api/containers/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageId, ...config }),
  })
  if (!res.ok) return null
  return res.json()
}

async function stopContainer(instanceId: string): Promise<boolean> {
  const baseUrl = getFactoryApiUrl()
  const res = await fetch(
    `${baseUrl}/api/containers/instances/${instanceId}/stop`,
    {
      method: 'POST',
    },
  )
  return res.ok
}

async function deleteContainer(instanceId: string): Promise<boolean> {
  const baseUrl = getFactoryApiUrl()
  const res = await fetch(`${baseUrl}/api/containers/instances/${instanceId}`, {
    method: 'DELETE',
  })
  return res.ok
}

// ============ Hooks ============

export function useContainerImages(query?: { search?: string }) {
  const {
    data: images,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['containerImages', query],
    queryFn: () => fetchImages(query),
    staleTime: 60000,
  })

  return {
    images: images || [],
    isLoading,
    error,
    refetch,
  }
}

export function useContainerInstances() {
  const {
    data: instances,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['containerInstances'],
    queryFn: fetchInstances,
    staleTime: 10000,
    refetchInterval: 30000,
  })

  return {
    instances: instances || [],
    isLoading,
    error,
    refetch,
  }
}

export function useContainerStats() {
  const {
    data: stats,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['containerStats'],
    queryFn: fetchContainerStats,
    staleTime: 60000,
  })

  return {
    stats: stats || {
      totalImages: 0,
      runningContainers: 0,
      totalPulls: 0,
      totalStorage: '0 B',
    },
    isLoading,
    error,
  }
}

export function useStartContainer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      imageId,
      config,
    }: {
      imageId: string
      config: { name: string; cpu: string; memory: string; gpu?: string }
    }) => startContainer(imageId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containerInstances'] })
      queryClient.invalidateQueries({ queryKey: ['containerStats'] })
    },
  })
}

export function useStopContainer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (instanceId: string) => stopContainer(instanceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containerInstances'] })
    },
  })
}

export function useDeleteContainer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (instanceId: string) => deleteContainer(instanceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containerInstances'] })
      queryClient.invalidateQueries({ queryKey: ['containerStats'] })
    },
  })
}

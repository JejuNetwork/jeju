'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDwsUrl } from '../config/contracts'

// ============ Types ============

export type ModelType = 'llm' | 'vision' | 'audio' | 'embedding' | 'multimodal'

export interface ModelVersion {
  version: string
  date: number
  notes: string
  sha?: string
}

export interface ModelFile {
  name: string
  size: string
  type: 'model' | 'config' | 'tokenizer' | 'docs' | 'other'
}

export interface ComputeRequirements {
  minVram: string
  recommendedVram: string
  architecture: string[]
}

export interface ModelData {
  id: string
  name: string
  organization: string
  description: string
  type: ModelType
  task: string
  framework: string
  parameters: string
  precision: string
  license: string
  downloads: number
  stars: number
  forks: number
  lastUpdated: number
  createdAt: number
  isVerified: boolean
  tags: string[]
  hasInference: boolean
  inferenceEndpoint?: string
  files: ModelFile[]
  readme: string
  versions: ModelVersion[]
  computeRequirements: ComputeRequirements
}

export interface ModelListItem {
  id: string
  name: string
  organization: string
  description: string
  type: ModelType
  parameters: string
  downloads: number
  stars: number
  lastUpdated: number
  isVerified: boolean
  tags: string[]
  hasInference: boolean
}

export interface ModelStats {
  totalModels: number
  totalDownloads: number
  verifiedModels: number
  activeInference: number
}

// ============ Fetchers ============

async function fetchModels(query?: {
  type?: ModelType
  search?: string
  tag?: string
}): Promise<ModelListItem[]> {
  const dwsUrl = getDwsUrl()
  const params = new URLSearchParams()
  if (query?.type) params.set('type', query.type)
  if (query?.search) params.set('q', query.search)
  if (query?.tag) params.set('tag', query.tag)

  const res = await fetch(`${dwsUrl}/api/models?${params.toString()}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.models || []
}

async function fetchModel(
  org: string,
  name: string,
): Promise<ModelData | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/models/${org}/${name}`)
  if (!res.ok) return null
  return res.json()
}

async function fetchModelStats(): Promise<ModelStats> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/models/stats`)
  if (!res.ok) {
    return {
      totalModels: 0,
      totalDownloads: 0,
      verifiedModels: 0,
      activeInference: 0,
    }
  }
  return res.json()
}

async function fetchModelReadme(org: string, name: string): Promise<string> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/models/${org}/${name}/readme`)
  if (!res.ok) return ''
  const data = await res.json()
  return data.readme || ''
}

async function fetchModelVersions(
  org: string,
  name: string,
): Promise<ModelVersion[]> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/models/${org}/${name}/versions`)
  if (!res.ok) return []
  const data = await res.json()
  return data.versions || []
}

async function runInference(
  org: string,
  name: string,
  input: {
    prompt: string
    maxTokens?: number
    temperature?: number
    topP?: number
  },
): Promise<{
  output: string
  usage: { promptTokens: number; completionTokens: number }
}> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/models/${org}/${name}/inference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw new Error('Inference failed')
  }
  return res.json()
}

async function starModel(org: string, name: string): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/models/${org}/${name}/star`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  return res.ok
}

// ============ Hooks ============

export function useModels(query?: {
  type?: ModelType
  search?: string
  tag?: string
}) {
  const {
    data: models,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['models', query],
    queryFn: () => fetchModels(query),
    staleTime: 60000,
  })

  return {
    models: models || [],
    isLoading,
    error,
    refetch,
  }
}

export function useModel(org: string, name: string) {
  const {
    data: model,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['model', org, name],
    queryFn: () => fetchModel(org, name),
    enabled: !!org && !!name,
    staleTime: 60000,
  })

  return {
    model,
    isLoading,
    error,
    refetch,
  }
}

export function useModelStats() {
  const {
    data: stats,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['modelStats'],
    queryFn: fetchModelStats,
    staleTime: 120000,
  })

  return {
    stats: stats || {
      totalModels: 0,
      totalDownloads: 0,
      verifiedModels: 0,
      activeInference: 0,
    },
    isLoading,
    error,
  }
}

export function useModelReadme(org: string, name: string) {
  const {
    data: readme,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['modelReadme', org, name],
    queryFn: () => fetchModelReadme(org, name),
    enabled: !!org && !!name,
    staleTime: 300000,
  })

  return {
    readme: readme || '',
    isLoading,
    error,
  }
}

export function useModelVersions(org: string, name: string) {
  const {
    data: versions,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['modelVersions', org, name],
    queryFn: () => fetchModelVersions(org, name),
    enabled: !!org && !!name,
    staleTime: 120000,
  })

  return {
    versions: versions || [],
    isLoading,
    error,
  }
}

export function useInference(org: string, name: string) {
  const mutation = useMutation({
    mutationFn: (input: {
      prompt: string
      maxTokens?: number
      temperature?: number
      topP?: number
    }) => runInference(org, name, input),
  })

  return {
    runInference: mutation.mutate,
    runInferenceAsync: mutation.mutateAsync,
    isLoading: mutation.isPending,
    data: mutation.data,
    error: mutation.error,
    reset: mutation.reset,
  }
}

export function useStarModel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ org, name }: { org: string; name: string }) =>
      starModel(org, name),
    onSuccess: (_, { org, name }) => {
      queryClient.invalidateQueries({ queryKey: ['model', org, name] })
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
}

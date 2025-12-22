import { getCoreAppUrl } from '@jejunetwork/config/ports'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, extractDataSafe } from '../lib/client'

function getFactoryApiUrl(): string {
  if (typeof window !== 'undefined') return ''
  return process.env.FACTORY_API_URL || getCoreAppUrl('FACTORY')
}

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

// ============ API Response Types ============

interface ApiModel {
  id: string
  name: string
  organization: string
  type: string
  description: string
  version?: string
  fileUri?: string
  downloads: number
  stars: number
  size?: string
  license?: string
  status?: string
  createdAt: number
  updatedAt: number
}

// ============ Fetchers using Eden Treaty ============

async function fetchModels(query?: {
  type?: ModelType
  search?: string
  org?: string
}): Promise<ModelListItem[]> {
  const response = await api.api.models.get({
    query: {
      q: query?.search,
      type: query?.type,
      org: query?.org,
    },
  })

  const data = extractDataSafe(response)
  if (!data) return []

  // API returns { models, total }
  const result = data as { models?: ApiModel[]; total?: number }

  // Transform API response to expected format
  return (result.models || []).map((m) => ({
    id: m.id,
    name: m.name,
    organization: m.organization,
    description: m.description,
    type: m.type as ModelType,
    parameters: m.size || 'Unknown',
    downloads: m.downloads,
    stars: m.stars,
    lastUpdated: m.updatedAt,
    isVerified: m.status === 'ready',
    tags: [],
    hasInference: m.status === 'ready',
  }))
}

async function fetchModel(
  org: string,
  name: string,
): Promise<ModelData | null> {
  const response = await api.api.models({ org })({ name }).get()
  return extractDataSafe(response) as ModelData | null
}

async function fetchModelStats(): Promise<ModelStats> {
  // Stats endpoint may not exist, calculate from list
  const models = await fetchModels()
  return {
    totalModels: models.length,
    totalDownloads: models.reduce((sum, m) => sum + m.downloads, 0),
    verifiedModels: models.filter((m) => m.isVerified).length,
    activeInference: models.filter((m) => m.hasInference).length,
  }
}

async function fetchModelReadme(org: string, name: string): Promise<string> {
  const model = await fetchModel(org, name)
  return (model as ModelData & { readme?: string })?.readme || ''
}

async function fetchModelVersions(
  org: string,
  name: string,
): Promise<ModelVersion[]> {
  const model = await fetchModel(org, name)
  return (model as ModelData & { versions?: ModelVersion[] })?.versions || []
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
  // Inference endpoint - use direct fetch as Eden may not have this typed
  const baseUrl = getFactoryApiUrl()
  const res = await fetch(`${baseUrl}/api/models/${org}/${name}/inference`, {
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
  // Star endpoint - use direct fetch as Eden may not have this typed
  const baseUrl = getFactoryApiUrl()
  const res = await fetch(`${baseUrl}/api/models/${org}/${name}/star`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  return res.ok
}

// ============ Hooks ============

export function useModels(query?: {
  type?: ModelType
  search?: string
  org?: string
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

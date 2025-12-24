import { hasArrayProperty } from '@jejunetwork/types'
import { useQuery } from '@tanstack/react-query'
import { api, extractDataSafe } from '../lib/client'

export interface DatasetPreview {
  columns: string[]
  sample: string[][]
}

export interface Dataset {
  id: string
  name: string
  organization: string
  description: string
  type: 'text' | 'code' | 'image' | 'audio' | 'multimodal' | 'tabular'
  format: string
  size: string
  rows: number
  downloads: number
  stars: number
  lastUpdated: number
  license: string
  tags: string[]
  isVerified: boolean
  preview?: DatasetPreview
}

export interface DatasetStats {
  totalDatasets: number
  totalDownloads: number
  contributors: number
  totalSize: string
}

interface ApiDataset {
  id: string
  name: string
  organization: string
  description: string
  type: 'text' | 'code' | 'image' | 'audio' | 'multimodal' | 'tabular'
  format: string
  size: string
  rows: number
  downloads: number
  stars: number
  license: string
  tags: string[]
  isVerified: boolean
  status: string
  createdAt: number
  updatedAt: number
}

interface DatasetsResponse {
  datasets: ApiDataset[]
  total: number
}

function transformDataset(d: ApiDataset): Dataset {
  return {
    id: d.id,
    name: d.name,
    organization: d.organization,
    description: d.description,
    type: d.type,
    format: d.format,
    size: d.size,
    rows: d.rows,
    downloads: d.downloads,
    stars: d.stars,
    lastUpdated: d.updatedAt,
    license: d.license,
    tags: d.tags || [],
    isVerified: d.isVerified,
  }
}

function isDatasetsResponse(data: unknown): data is DatasetsResponse {
  return hasArrayProperty(data, 'datasets')
}

async function fetchDatasets(query?: {
  type?: string
  search?: string
}): Promise<Dataset[]> {
  const response = await api.api.datasets.get({
    query: {
      q: query?.search,
      type: query?.type,
    },
  })

  const data = extractDataSafe(response)
  if (!isDatasetsResponse(data)) return []

  return data.datasets.map(transformDataset)
}

async function fetchDatasetStats(): Promise<DatasetStats> {
  const response = await api.api.datasets.get({})
  const data = extractDataSafe(response)

  if (!isDatasetsResponse(data)) {
    return {
      totalDatasets: 0,
      totalDownloads: 0,
      contributors: 0,
      totalSize: '0 B',
    }
  }

  const datasets = data.datasets
  const uniqueOrgs = new Set(datasets.map((d) => d.organization))

  return {
    totalDatasets: datasets.length,
    totalDownloads: datasets.reduce((sum, d) => sum + d.downloads, 0),
    contributors: uniqueOrgs.size,
    totalSize:
      datasets.reduce((acc, d) => {
        const match = d.size.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i)
        if (!match) return acc
        const num = Number.parseFloat(match[1])
        const unit = match[2].toUpperCase()
        const multipliers: Record<string, number> = {
          B: 1,
          KB: 1024,
          MB: 1024 ** 2,
          GB: 1024 ** 3,
          TB: 1024 ** 4,
        }
        return acc + num * (multipliers[unit] || 1)
      }, 0) >
      1024 ** 3
        ? `${(
            datasets.reduce((acc, d) => {
              const match = d.size.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i)
              if (!match) return acc
              const num = Number.parseFloat(match[1])
              const unit = match[2].toUpperCase()
              const multipliers: Record<string, number> = {
                B: 1,
                KB: 1024,
                MB: 1024 ** 2,
                GB: 1024 ** 3,
                TB: 1024 ** 4,
              }
              return acc + num * (multipliers[unit] || 1)
            }, 0) /
              1024 ** 3
          ).toFixed(1)} GB`
        : '0 B',
  }
}

async function fetchDataset(
  org: string,
  name: string,
): Promise<Dataset | null> {
  const response = await api.api.datasets.get({
    query: { q: `${org}/${name}` },
  })

  const data = extractDataSafe(response)
  if (!isDatasetsResponse(data) || !data.datasets.length) return null

  const dataset = data.datasets.find(
    (d) =>
      d.organization === org || d.name === name || d.name === `${org}/${name}`,
  )

  return dataset ? transformDataset(dataset) : null
}

export function useDatasets(query?: { type?: string; search?: string }) {
  const {
    data: datasets,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['datasets', query],
    queryFn: () => fetchDatasets(query),
    staleTime: 60000,
  })

  return {
    datasets: datasets || [],
    isLoading,
    error,
    refetch,
  }
}

export function useDatasetStats() {
  const {
    data: stats,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['datasetStats'],
    queryFn: fetchDatasetStats,
    staleTime: 120000,
  })

  return {
    stats: stats || {
      totalDatasets: 0,
      totalDownloads: 0,
      contributors: 0,
      totalSize: '0 B',
    },
    isLoading,
    error,
  }
}

export function useDataset(org: string, name: string) {
  const {
    data: dataset,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['dataset', org, name],
    queryFn: () => fetchDataset(org, name),
    enabled: !!org && !!name,
    staleTime: 60000,
  })

  return {
    dataset,
    isLoading,
    error,
    refetch,
  }
}

/**
 * Datasets Module - Training Data Management (HuggingFace Datasets)
 *
 * Provides TypeScript interface for:
 * - Dataset registration and versioning
 * - Data upload and download
 * - Dataset discovery and search
 * - Access control and licensing
 */

import type { NetworkType } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { encodeFunctionData } from 'viem'
import { getContractAddresses, getServicesConfig } from '../config'
import {
  DatasetUploadResponseSchema,
  JsonRecordSchema,
} from '../shared/schemas'
import type { JejuWallet } from '../wallet'

// ============================================================================
// Types
// ============================================================================

export const DatasetFormat = {
  PARQUET: 0,
  JSON: 1,
  CSV: 2,
  ARROW: 3,
  TEXT: 4,
  IMAGE: 5,
  AUDIO: 6,
  VIDEO: 7,
  CUSTOM: 8,
} as const
export type DatasetFormat = (typeof DatasetFormat)[keyof typeof DatasetFormat]

export const DatasetLicense = {
  MIT: 0,
  APACHE_2: 1,
  CC_BY_4: 2,
  CC_BY_SA_4: 3,
  CC_BY_NC_4: 4,
  CC0: 5,
  ODC_BY: 6,
  CUSTOM: 7,
  PROPRIETARY: 8,
} as const
export type DatasetLicense =
  (typeof DatasetLicense)[keyof typeof DatasetLicense]

export const DatasetAccessLevel = {
  PUBLIC: 0,
  GATED: 1,
  PRIVATE: 2,
} as const
export type DatasetAccessLevel =
  (typeof DatasetAccessLevel)[keyof typeof DatasetAccessLevel]

export interface Dataset {
  datasetId: Hex
  name: string
  organization: string
  owner: Address
  description: string
  format: DatasetFormat
  license: DatasetLicense
  licenseUri?: string
  accessLevel: DatasetAccessLevel
  tags: string[]
  size: bigint
  rowCount: bigint
  columnCount: number
  columns?: DatasetColumn[]
  createdAt: number
  updatedAt: number
  downloadCount: bigint
  isVerified: boolean
}

export interface DatasetColumn {
  name: string
  type: string
  description?: string
  nullable: boolean
}

export interface DatasetVersion {
  versionId: Hex
  datasetId: Hex
  version: string
  dataCid: string
  dataHash: Hex
  size: bigint
  rowCount: bigint
  schemaCid?: string
  publishedAt: number
  isLatest: boolean
}

export interface DatasetSplit {
  name: string
  numRows: bigint
  numBytes: bigint
  dataCid: string
}

export interface CreateDatasetParams {
  name: string
  organization: string
  description: string
  format: DatasetFormat
  license: DatasetLicense
  licenseUri?: string
  accessLevel: DatasetAccessLevel
  tags: string[]
  columns?: DatasetColumn[]
}

export interface PublishDatasetVersionParams {
  datasetId: Hex
  version: string
  dataCid: string
  dataHash: Hex
  size: bigint
  rowCount: bigint
  schemaCid?: string
  splits?: DatasetSplit[]
}

export interface UploadDatasetParams {
  name: string
  organization: string
  description: string
  format: DatasetFormat
  license: DatasetLicense
  accessLevel: DatasetAccessLevel
  tags: string[]
  files: File[] | Blob[]
  splits?: {
    train?: File | Blob
    validation?: File | Blob
    test?: File | Blob
  }
}

// ============================================================================
// Module Interface
// ============================================================================

export interface DatasetsModule {
  // Dataset Queries
  getDataset(datasetId: Hex): Promise<Dataset | null>
  getDatasetByName(org: string, name: string): Promise<Dataset | null>
  listDatasets(options?: {
    format?: DatasetFormat
    organization?: string
    search?: string
    offset?: number
    limit?: number
  }): Promise<Dataset[]>
  searchDatasets(query: string): Promise<Dataset[]>
  getTotalDatasets(): Promise<number>

  // Version Management
  getVersions(datasetId: Hex): Promise<DatasetVersion[]>
  getLatestVersion(datasetId: Hex): Promise<DatasetVersion | null>
  getVersion(datasetId: Hex, version: string): Promise<DatasetVersion | null>
  getSplits(datasetId: Hex, version?: string): Promise<DatasetSplit[]>

  // Schema
  getSchema(datasetId: Hex): Promise<DatasetColumn[]>

  // Download
  getDownloadUrl(
    datasetId: Hex,
    version?: string,
    split?: string,
  ): Promise<string>
  downloadDataset(datasetId: Hex, version?: string): Promise<Blob>
  streamDataset(
    datasetId: Hex,
    version?: string,
    options?: { offset?: number; limit?: number; split?: string },
  ): AsyncIterable<Record<string, unknown>>

  // Access Control
  hasAccess(datasetId: Hex, user?: Address): Promise<boolean>
  grantAccess(datasetId: Hex, user: Address): Promise<{ txHash: Hex }>
  revokeAccess(datasetId: Hex, user: Address): Promise<{ txHash: Hex }>
  requestAccess(datasetId: Hex): Promise<{ txHash: Hex }>

  // Write Operations
  createDataset(
    params: CreateDatasetParams,
  ): Promise<{ txHash: Hex; datasetId: Hex }>
  publishVersion(
    params: PublishDatasetVersionParams,
  ): Promise<{ txHash: Hex; versionId: Hex }>
  uploadDataset(
    params: UploadDatasetParams,
  ): Promise<{ txHash: Hex; datasetId: Hex }>
  updateMetadata(
    datasetId: Hex,
    updates: Partial<CreateDatasetParams>,
  ): Promise<{ txHash: Hex }>

  // Metrics
  recordDownload(datasetId: Hex): Promise<{ txHash: Hex }>
  getMetrics(datasetId: Hex): Promise<{
    totalDownloads: bigint
    weeklyDownloads: bigint
    uniqueDownloaders: number
  }>

  // Preview
  preview(
    datasetId: Hex,
    version?: string,
    options?: {
      rows?: number
      split?: string
    },
  ): Promise<{
    columns: DatasetColumn[]
    rows: Record<string, unknown>[]
    totalRows: bigint
  }>
}

// ============================================================================
// Contract ABI
// ============================================================================

const DATASET_REGISTRY_ABI = [
  'function createDataset(string name, string organization, string description, uint8 format, uint8 license, string licenseUri, uint8 accessLevel, string[] tags) external payable returns (bytes32)',
  'function publishVersion(bytes32 datasetId, string version, string dataCid, bytes32 dataHash, uint256 size, uint256 rowCount, string schemaCid) external returns (bytes32)',
  'function grantAccess(bytes32 datasetId, address user) external',
  'function revokeAccess(bytes32 datasetId, address user) external',
  'function requestAccess(bytes32 datasetId) external',
  'function recordDownload(bytes32 datasetId) external',
  'function getDataset(bytes32 datasetId) external view returns (tuple(bytes32 datasetId, string name, string organization, address owner, string description, uint8 format, uint8 license, string licenseUri, uint8 accessLevel, string[] tags, uint256 size, uint256 rowCount, uint256 columnCount, uint256 createdAt, uint256 updatedAt, uint256 downloadCount, bool isVerified))',
  'function getVersions(bytes32 datasetId) external view returns (tuple(bytes32 versionId, bytes32 datasetId, string version, string dataCid, bytes32 dataHash, uint256 size, uint256 rowCount, string schemaCid, uint256 publishedAt, bool isLatest)[])',
  'function getLatestVersion(bytes32 datasetId) external view returns (tuple(bytes32 versionId, bytes32 datasetId, string version, string dataCid, bytes32 dataHash, uint256 size, uint256 rowCount, string schemaCid, uint256 publishedAt, bool isLatest))',
  'function hasAccess(bytes32 datasetId, address user) external view returns (bool)',
  'function getTotalDatasets() external view returns (uint256)',
  'function getAllDatasetIds(uint256 offset, uint256 limit) external view returns (bytes32[])',
  'function getOrganizationDatasets(string org) external view returns (bytes32[])',
] as const

// ============================================================================
// Implementation
// ============================================================================

export function createDatasetsModule(
  wallet: JejuWallet,
  network: NetworkType,
): DatasetsModule {
  const services = getServicesConfig(network)
  const contracts = getContractAddresses(network)
  if (!contracts.datasetRegistry) {
    throw new Error(`DatasetRegistry contract not deployed on ${network}`)
  }
  const datasetRegistryAddress = contracts.datasetRegistry
  const baseUrl = `${services.factory.api}/api/datasets`

  async function buildAuthHeaders(): Promise<Record<string, string>> {
    const timestamp = Date.now().toString()
    const message = `datasets:${timestamp}`
    const signature = await wallet.signMessage(message)

    return {
      'Content-Type': 'application/json',
      'x-jeju-address': wallet.address,
      'x-jeju-timestamp': timestamp,
      'x-jeju-signature': signature,
    }
  }

  async function apiRequest<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers = await buildAuthHeaders()
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Datasets API error: ${response.status} - ${error}`)
    }

    return response.json() as Promise<T>
  }

  return {
    async getDataset(datasetId) {
      const data = (await wallet.publicClient.readContract({
        address: datasetRegistryAddress,
        abi: DATASET_REGISTRY_ABI,
        functionName: 'getDataset',
        args: [datasetId],
      })) as {
        datasetId: Hex
        name: string
        organization: string
        owner: Address
        description: string
        format: number
        license: number
        licenseUri: string
        accessLevel: number
        tags: readonly string[]
        size: bigint
        rowCount: bigint
        columnCount: bigint
        createdAt: bigint
        updatedAt: bigint
        downloadCount: bigint
        isVerified: boolean
      }

      if (!data || data.createdAt === 0n) return null

      return {
        datasetId: data.datasetId,
        name: data.name,
        organization: data.organization,
        owner: data.owner,
        description: data.description,
        format: data.format as DatasetFormat,
        license: data.license as DatasetLicense,
        licenseUri: data.licenseUri || undefined,
        accessLevel: data.accessLevel as DatasetAccessLevel,
        tags: [...data.tags],
        size: data.size,
        rowCount: data.rowCount,
        columnCount: Number(data.columnCount),
        createdAt: Number(data.createdAt),
        updatedAt: Number(data.updatedAt),
        downloadCount: data.downloadCount,
        isVerified: data.isVerified,
      }
    },

    async getDatasetByName(org, name) {
      return apiRequest<Dataset | null>(`/${org}/${name}`)
    },

    async listDatasets(options = {}) {
      const params = new URLSearchParams()
      if (options.format !== undefined)
        params.set('format', options.format.toString())
      if (options.organization) params.set('org', options.organization)
      if (options.search) params.set('q', options.search)
      if (options.offset !== undefined)
        params.set('offset', options.offset.toString())
      if (options.limit !== undefined)
        params.set('limit', options.limit.toString())

      return apiRequest<Dataset[]>(`?${params}`)
    },

    async searchDatasets(query) {
      return apiRequest<Dataset[]>(`/search?q=${encodeURIComponent(query)}`)
    },

    async getTotalDatasets() {
      const total = (await wallet.publicClient.readContract({
        address: datasetRegistryAddress,
        abi: DATASET_REGISTRY_ABI,
        functionName: 'getTotalDatasets',
        args: [],
      })) as bigint
      return Number(total)
    },

    async getVersions(datasetId) {
      const versions = (await wallet.publicClient.readContract({
        address: datasetRegistryAddress,
        abi: DATASET_REGISTRY_ABI,
        functionName: 'getVersions',
        args: [datasetId],
      })) as readonly {
        versionId: Hex
        datasetId: Hex
        version: string
        dataCid: string
        dataHash: Hex
        size: bigint
        rowCount: bigint
        schemaCid: string
        publishedAt: bigint
        isLatest: boolean
      }[]

      return versions.map((v) => ({
        versionId: v.versionId,
        datasetId: v.datasetId,
        version: v.version,
        dataCid: v.dataCid,
        dataHash: v.dataHash,
        size: v.size,
        rowCount: v.rowCount,
        schemaCid: v.schemaCid || undefined,
        publishedAt: Number(v.publishedAt),
        isLatest: v.isLatest,
      }))
    },

    async getLatestVersion(datasetId) {
      const v = (await wallet.publicClient.readContract({
        address: datasetRegistryAddress,
        abi: DATASET_REGISTRY_ABI,
        functionName: 'getLatestVersion',
        args: [datasetId],
      })) as {
        versionId: Hex
        datasetId: Hex
        version: string
        dataCid: string
        dataHash: Hex
        size: bigint
        rowCount: bigint
        schemaCid: string
        publishedAt: bigint
        isLatest: boolean
      }

      if (!v || v.publishedAt === 0n) return null

      return {
        versionId: v.versionId,
        datasetId: v.datasetId,
        version: v.version,
        dataCid: v.dataCid,
        dataHash: v.dataHash,
        size: v.size,
        rowCount: v.rowCount,
        schemaCid: v.schemaCid || undefined,
        publishedAt: Number(v.publishedAt),
        isLatest: v.isLatest,
      }
    },

    async getVersion(datasetId, version) {
      const versions = await this.getVersions(datasetId)
      return versions.find((v) => v.version === version) ?? null
    },

    async getSplits(datasetId, version) {
      return apiRequest<DatasetSplit[]>(
        `/id/${datasetId}/splits${version ? `?version=${version}` : ''}`,
      )
    },

    async getSchema(datasetId) {
      return apiRequest<DatasetColumn[]>(`/id/${datasetId}/schema`)
    },

    async getDownloadUrl(datasetId, version, split) {
      const params = new URLSearchParams()
      if (version) params.set('version', version)
      if (split) params.set('split', split)
      const result = await apiRequest<{ url: string }>(
        `/id/${datasetId}/download-url?${params}`,
      )
      return result.url
    },

    async downloadDataset(datasetId, version) {
      const url = await this.getDownloadUrl(datasetId, version)
      const headers = await buildAuthHeaders()
      const response = await fetch(url, { headers })

      if (!response.ok) {
        throw new Error(`Failed to download dataset: ${response.statusText}`)
      }

      return response.blob()
    },

    async *streamDataset(datasetId, version, options = {}) {
      const params = new URLSearchParams()
      if (version) params.set('version', version)
      if (options.offset !== undefined)
        params.set('offset', options.offset.toString())
      if (options.limit !== undefined)
        params.set('limit', options.limit.toString())
      if (options.split) params.set('split', options.split)

      const headers = await buildAuthHeaders()
      const response = await fetch(
        `${baseUrl}/id/${datasetId}/stream?${params}`,
        {
          headers,
        },
      )

      if (!response.ok || !response.body) {
        throw new Error(`Failed to stream dataset: ${response.statusText}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.trim()) {
            // Use safeParse since individual JSONL rows may be malformed
            let parsed: unknown
            try {
              parsed = JSON.parse(line)
            } catch {
              // Skip malformed JSON lines
              continue
            }
            const result = JsonRecordSchema.safeParse(parsed)
            if (result.success) {
              yield result.data as Record<string, unknown>
            }
          }
        }
      }

      if (buffer.trim()) {
        // Use safeParse for final buffer
        let parsed: unknown
        try {
          parsed = JSON.parse(buffer)
        } catch {
          return
        }
        const result = JsonRecordSchema.safeParse(parsed)
        if (result.success) {
          yield result.data as Record<string, unknown>
        }
      }
    },

    async hasAccess(datasetId, user) {
      return wallet.publicClient.readContract({
        address: datasetRegistryAddress,
        abi: DATASET_REGISTRY_ABI,
        functionName: 'hasAccess',
        args: [datasetId, user ?? wallet.address],
      }) as Promise<boolean>
    },

    async grantAccess(datasetId, user) {
      const txHash = await wallet.sendTransaction({
        to: datasetRegistryAddress,
        data: encodeFunctionData({
          abi: DATASET_REGISTRY_ABI,
          functionName: 'grantAccess',
          args: [datasetId, user],
        }),
      })
      return { txHash }
    },

    async revokeAccess(datasetId, user) {
      const txHash = await wallet.sendTransaction({
        to: datasetRegistryAddress,
        data: encodeFunctionData({
          abi: DATASET_REGISTRY_ABI,
          functionName: 'revokeAccess',
          args: [datasetId, user],
        }),
      })
      return { txHash }
    },

    async requestAccess(datasetId) {
      const txHash = await wallet.sendTransaction({
        to: datasetRegistryAddress,
        data: encodeFunctionData({
          abi: DATASET_REGISTRY_ABI,
          functionName: 'requestAccess',
          args: [datasetId],
        }),
      })
      return { txHash }
    },

    async createDataset(params) {
      const txHash = await wallet.sendTransaction({
        to: datasetRegistryAddress,
        data: encodeFunctionData({
          abi: DATASET_REGISTRY_ABI,
          functionName: 'createDataset',
          args: [
            params.name,
            params.organization,
            params.description,
            params.format,
            params.license,
            params.licenseUri ?? '',
            params.accessLevel,
            params.tags,
          ],
        }),
      })

      const datasetId = `0x${'0'.repeat(64)}` as Hex
      return { txHash, datasetId }
    },

    async publishVersion(params) {
      const txHash = await wallet.sendTransaction({
        to: datasetRegistryAddress,
        data: encodeFunctionData({
          abi: DATASET_REGISTRY_ABI,
          functionName: 'publishVersion',
          args: [
            params.datasetId,
            params.version,
            params.dataCid,
            params.dataHash,
            params.size,
            params.rowCount,
            params.schemaCid ?? '',
          ],
        }),
      })

      const versionId = `0x${'0'.repeat(64)}` as Hex
      return { txHash, versionId }
    },

    async uploadDataset(params) {
      // Upload files to storage first
      const formData = new FormData()
      formData.append('name', params.name)
      formData.append('organization', params.organization)
      formData.append('description', params.description)
      formData.append('format', params.format.toString())
      formData.append('license', params.license.toString())
      formData.append('accessLevel', params.accessLevel.toString())
      formData.append('tags', JSON.stringify(params.tags))

      for (const file of params.files) {
        formData.append('files', file)
      }

      if (params.splits) {
        if (params.splits.train) formData.append('train', params.splits.train)
        if (params.splits.validation)
          formData.append('validation', params.splits.validation)
        if (params.splits.test) formData.append('test', params.splits.test)
      }

      const headers = await buildAuthHeaders()
      delete (headers as Record<string, string>)['Content-Type'] // Let fetch set multipart boundary

      const response = await fetch(`${baseUrl}/upload`, {
        method: 'POST',
        headers,
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`Failed to upload dataset: ${response.statusText}`)
      }

      const rawData: unknown = await response.json()
      return DatasetUploadResponseSchema.parse(rawData)
    },

    async updateMetadata(datasetId, updates) {
      const result = await apiRequest<{ txHash: Hex }>(`/id/${datasetId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      })
      return result
    },

    async recordDownload(datasetId) {
      const txHash = await wallet.sendTransaction({
        to: datasetRegistryAddress,
        data: encodeFunctionData({
          abi: DATASET_REGISTRY_ABI,
          functionName: 'recordDownload',
          args: [datasetId],
        }),
      })
      return { txHash }
    },

    async getMetrics(datasetId) {
      return apiRequest<{
        totalDownloads: bigint
        weeklyDownloads: bigint
        uniqueDownloaders: number
      }>(`/id/${datasetId}/metrics`)
    },

    async preview(datasetId, version, options = {}) {
      const params = new URLSearchParams()
      if (version) params.set('version', version)
      if (options.rows) params.set('rows', options.rows.toString())
      if (options.split) params.set('split', options.split)

      return apiRequest<{
        columns: DatasetColumn[]
        rows: Record<string, unknown>[]
        totalRows: bigint
      }>(`/id/${datasetId}/preview?${params}`)
    },
  }
}

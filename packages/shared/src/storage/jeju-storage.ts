/**
 * Jeju Decentralized Storage Client
 *
 * IPFS/Arweave storage client for decentralized file storage.
 * Used for models, datasets, images, and other artifacts.
 *
 * @module @jejunetwork/shared/storage
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import {
  getJejuStorageApiKey,
  getJejuStorageEndpoint,
  getJejuStorageProviderType,
  getJejuStorageReplication,
  isProduction,
  isTestnet,
} from '@jejunetwork/config'
import { logger } from '../logger'

export interface JejuStorageConfig {
  endpoint: string
  apiKey?: string
  defaultProvider: 'ipfs' | 'arweave'
  replicationFactor: number
}

export interface JejuUploadOptions {
  file: Buffer
  filename: string
  contentType: string
  folder?: string
  permanent?: boolean
  metadata?: Record<string, string>
}

export interface JejuUploadResult {
  cid: string
  url: string
  provider: 'ipfs' | 'arweave'
  size: number
  dealId?: string
}

export interface ModelStorageOptions {
  version: string
  modelPath: string
  metadata: {
    baseModel: string
    trainedAt: Date
    accuracy?: number
    avgReward?: number
    benchmarkScore?: number
    [key: string]: unknown
  }
  permanent?: boolean
}

export interface StoredModel {
  version: string
  cid: string
  url: string
  provider: 'ipfs' | 'arweave'
  metadata: Record<string, unknown>
  storedAt: Date
  size: number
}

/**
 * Client for interacting with Jeju's decentralized storage (IPFS/Arweave)
 */
export class JejuStorageClient {
  private config: JejuStorageConfig
  private initialized = false

  constructor(config: JejuStorageConfig) {
    this.config = config
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    logger.info('Initializing Jeju Storage', {
      endpoint: this.config.endpoint,
    })
    await this.healthCheck()
    this.initialized = true
  }

  async healthCheck(): Promise<boolean> {
    const response = await fetch(`${this.config.endpoint}/health`, {
      headers: this.getHeaders(),
    }).catch(() => null)
    return response?.ok ?? false
  }

  async uploadImage(options: JejuUploadOptions): Promise<JejuUploadResult> {
    const provider = options.permanent ? 'arweave' : this.config.defaultProvider
    const filePath = options.folder
      ? `${options.folder}/${options.filename}`
      : options.filename

    const formData = new FormData()
    formData.append(
      'file',
      new Blob([new Uint8Array(options.file)], { type: options.contentType }),
      filePath,
    )
    formData.append('provider', provider)
    formData.append('replication', this.config.replicationFactor.toString())
    if (options.metadata)
      formData.append('metadata', JSON.stringify(options.metadata))

    const response = await fetch(`${this.config.endpoint}/api/v1/upload`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: formData,
    })
    if (!response.ok)
      throw new Error(
        `Upload failed: ${response.status} - ${await response.text()}`,
      )
    return (await response.json()) as JejuUploadResult
  }

  async uploadModel(options: ModelStorageOptions): Promise<StoredModel> {
    const stat = await fs.stat(options.modelPath)
    let modelBuffer: Buffer
    let filename: string

    if (stat.isDirectory()) {
      const { execSync } = await import('node:child_process')
      const tempFile = `/tmp/model-${Date.now()}.tar.gz`
      execSync(`tar -czf ${tempFile} -C ${options.modelPath} .`)
      modelBuffer = await fs.readFile(tempFile)
      await fs.unlink(tempFile)
      filename = `model-${options.version}.tar.gz`
    } else {
      modelBuffer = await fs.readFile(options.modelPath)
      filename = path.basename(options.modelPath)
    }

    const uploadResult = await this.uploadImage({
      file: modelBuffer,
      filename,
      contentType: 'application/octet-stream',
      folder: `models/${options.version}`,
      permanent: options.permanent,
      metadata: {
        version: options.version,
        baseModel: options.metadata.baseModel,
        trainedAt: options.metadata.trainedAt.toISOString(),
        ...(options.metadata.accuracy && {
          accuracy: options.metadata.accuracy.toString(),
        }),
        ...(options.metadata.avgReward && {
          avgReward: options.metadata.avgReward.toString(),
        }),
      },
    })

    await this.uploadImage({
      file: Buffer.from(JSON.stringify(options.metadata, null, 2)),
      filename: 'metadata.json',
      contentType: 'application/json',
      folder: `models/${options.version}`,
      permanent: options.permanent,
    })

    logger.info('Model uploaded to Jeju Storage', {
      version: options.version,
      cid: uploadResult.cid,
    })

    return {
      version: options.version,
      cid: uploadResult.cid,
      url: uploadResult.url,
      provider: uploadResult.provider,
      metadata: options.metadata,
      storedAt: new Date(),
      size: uploadResult.size,
    }
  }

  async download(cid: string): Promise<Buffer> {
    const response = await fetch(`${this.config.endpoint}/api/v1/get/${cid}`, {
      headers: this.getHeaders(),
    })
    if (!response.ok) throw new Error(`Download failed: ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }

  async downloadText(cid: string): Promise<string> {
    return (await this.download(cid)).toString('utf-8')
  }

  async downloadJSON<T = Record<string, unknown>>(cid: string): Promise<T> {
    return JSON.parse(await this.downloadText(cid)) as T
  }

  async listFiles(folder: string) {
    const response = await fetch(
      `${this.config.endpoint}/api/v1/list?folder=${encodeURIComponent(folder)}`,
      { headers: this.getHeaders() },
    )
    if (!response.ok) throw new Error(`List failed: ${response.status}`)
    return (
      (await response.json()) as {
        files: Array<{
          cid: string
          filename: string
          folder?: string
          size: number
          permanent?: boolean
        }>
      }
    ).files
  }

  async uploadText(
    content: string,
    filename: string,
    options?: { folder?: string; permanent?: boolean },
  ): Promise<JejuUploadResult> {
    return this.uploadImage({
      file: Buffer.from(content, 'utf-8'),
      filename,
      contentType: 'text/plain',
      folder: options?.folder,
      permanent: options?.permanent,
    })
  }

  async uploadJSON(
    content: Record<string, unknown>,
    filename: string,
    options?: { folder?: string; permanent?: boolean },
  ): Promise<JejuUploadResult> {
    return this.uploadImage({
      file: Buffer.from(JSON.stringify(content, null, 2), 'utf-8'),
      filename,
      contentType: 'application/json',
      folder: options?.folder,
      permanent: options?.permanent,
    })
  }

  getUrl(cid: string): string {
    return `${this.config.endpoint}/ipfs/${cid}`
  }

  async pin(cid: string): Promise<void> {
    const response = await fetch(`${this.config.endpoint}/api/v1/pin`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ cid }),
    })
    if (!response.ok) throw new Error(`Pin failed: ${response.status}`)
  }

  async unpin(cid: string): Promise<void> {
    const response = await fetch(`${this.config.endpoint}/api/v1/pin/${cid}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    })
    if (!response.ok) throw new Error(`Unpin failed: ${response.status}`)
  }

  async exists(cid: string): Promise<boolean> {
    const response = await fetch(`${this.config.endpoint}/api/v1/stat/${cid}`, {
      method: 'HEAD',
      headers: this.getHeaders(),
    }).catch(() => null)
    return response?.ok ?? false
  }

  async deleteImage(cid: string): Promise<void> {
    await this.unpin(cid)
  }

  async initializeBucket(): Promise<void> {}

  async listPins(): Promise<string[]> {
    const response = await fetch(`${this.config.endpoint}/api/v1/pins`, {
      headers: this.getHeaders(),
    })
    if (!response.ok) throw new Error(`List pins failed: ${response.status}`)
    return ((await response.json()) as { pins: string[] }).pins
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.config.apiKey)
      headers.Authorization = `Bearer ${this.config.apiKey}`
    return headers
  }
}

let storageClient: JejuStorageClient | null = null

/**
 * Check if Jeju storage is available/configured
 */
export function isJejuStorageAvailable(): boolean {
  return !!(getJejuStorageEndpoint() || isProduction() || isTestnet())
}

/**
 * Get the Jeju storage client singleton
 */
export function getJejuStorageClient(): JejuStorageClient {
  if (!isJejuStorageAvailable()) {
    throw new Error(
      'Jeju Storage not configured. Set JEJU_STORAGE_ENDPOINT or JEJU_NETWORK.',
    )
  }
  if (!storageClient) {
    const endpoint =
      getJejuStorageEndpoint() ??
      (isProduction()
        ? 'https://storage.jeju.io'
        : 'https://storage.testnet.jeju.io')

    storageClient = new JejuStorageClient({
      endpoint,
      apiKey: getJejuStorageApiKey(),
      defaultProvider: getJejuStorageProviderType(),
      replicationFactor: parseInt(getJejuStorageReplication(), 10),
    })
  }
  return storageClient
}

/**
 * Reset the storage client singleton
 */
export function resetJejuStorageClient(): void {
  storageClient = null
}

/**
 * Initialize the Jeju storage client
 */
export async function initializeJejuStorage(): Promise<void> {
  await getJejuStorageClient().initialize()
}

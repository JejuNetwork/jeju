/**
 * Storage Utility
 *
 * Provides IPFS-based storage for models and datasets.
 *
 * Storage backends:
 * - Jeju Storage (IPFS/Arweave) for file storage
 * - On-chain registry for model metadata and verification
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { getCurrentNetwork, getServiceUrl } from '@jejunetwork/config'
import { logger } from '@jejunetwork/shared'
import { isIPFSUploadResult } from './type-guards'
import type { IPFSUploadResult, ModelMetadata, StorageOptions } from './types'

/**
 * Storage provider configuration
 * Use STORAGE_PROVIDER env to choose: 'ipfs' | 'huggingface' | 'auto'
 */
const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || 'auto'

/**
 * Jeju Storage endpoint based on network
 */
function getJejuStorageEndpoint(): string {
  return getServiceUrl('storage')
}

/**
 * Check if storage should be used
 */
export function shouldUseStorage(): boolean {
  if (STORAGE_PROVIDER === 'huggingface') {
    return false
  }
  if (STORAGE_PROVIDER === 'ipfs') {
    return true
  }
  // Auto mode: use IPFS if Jeju network is configured
  const network = getCurrentNetwork()
  return network !== 'localnet'
}

/**
 * Get current storage provider name
 */
export function getStorageProvider(): 'ipfs' | 'huggingface' {
  return shouldUseStorage() ? 'ipfs' : 'huggingface'
}

export class StorageUtil {
  private endpoint: string
  private apiKey?: string

  constructor() {
    this.endpoint = getJejuStorageEndpoint()
    this.apiKey = process.env.JEJU_STORAGE_API_KEY
  }

  /**
   * Upload a file to IPFS via Jeju Storage
   */
  async uploadFile(
    content: Buffer | string,
    filename: string,
    options?: StorageOptions,
  ): Promise<IPFSUploadResult> {
    const formData = new FormData()
    const buffer = typeof content === 'string' ? Buffer.from(content) : content

    formData.append('file', new Blob([new Uint8Array(buffer)]), filename)
    formData.append('provider', options?.permanent ? 'arweave' : 'ipfs')
    formData.append('replication', '3')

    if (options?.metadata) {
      formData.append('metadata', JSON.stringify(options.metadata))
    }

    const headers: Record<string, string> = {}
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const response = await fetch(`${this.endpoint}/storage/upload`, {
      method: 'POST',
      headers,
      body: formData,
    })

    if (!response.ok) {
      throw new Error(
        `IPFS upload failed: ${response.status} - ${await response.text()}`,
      )
    }

    const data: unknown = await response.json()
    if (!isIPFSUploadResult(data)) {
      throw new Error('Invalid IPFS upload response')
    }

    logger.info('Uploaded to IPFS', {
      cid: data.cid,
      filename,
      size: data.size,
    })

    return data
  }

  /**
   * Upload a directory to IPFS
   */
  async uploadDirectory(
    localDir: string,
    options?: StorageOptions,
  ): Promise<{ cids: Map<string, string>; totalSize: number; count: number }> {
    const files = await fs.readdir(localDir)
    const cids = new Map<string, string>()
    let totalSize = 0
    let count = 0

    for (const file of files) {
      const filePath = path.join(localDir, file)
      const stats = await fs.stat(filePath)

      if (stats.isFile()) {
        const content = await fs.readFile(filePath)
        const result = await this.uploadFile(content, file, options)
        cids.set(file, result.cid)
        totalSize += result.size
        count++
      }
    }

    logger.info('Uploaded directory to IPFS', {
      dir: localDir,
      count,
      totalSize,
    })

    return { cids, totalSize, count }
  }

  /**
   * Upload model to IPFS with metadata
   */
  async uploadModel(
    modelPath: string,
    metadata: Omit<ModelMetadata, 'cid' | 'registryTx'>,
    options?: StorageOptions,
  ): Promise<ModelMetadata> {
    const stats = await fs.stat(modelPath)

    if (stats.isDirectory()) {
      // For directories, upload all files individually and use the main model file
      const uploadResult = await this.uploadDirectory(modelPath, options)

      // Create a combined metadata file referencing all CIDs
      const dirMetadata = {
        ...metadata,
        files: Object.fromEntries(uploadResult.cids),
        totalSize: uploadResult.totalSize,
        fileCount: uploadResult.count,
      }

      // Upload the combined metadata
      const metadataResult = await this.uploadFile(
        JSON.stringify(dirMetadata, null, 2),
        'metadata.json',
        options,
      )

      logger.info('Model directory uploaded to IPFS', {
        version: metadata.version,
        cid: metadataResult.cid,
        fileCount: uploadResult.count,
      })

      return {
        ...metadata,
        cid: metadataResult.cid,
      }
    }

    // Single file upload
    const modelBuffer = await fs.readFile(modelPath)
    const filename = path.basename(modelPath)

    // Upload model file
    const modelResult = await this.uploadFile(modelBuffer, filename, {
      ...options,
      metadata: {
        version: metadata.version,
        baseModel: metadata.baseModel,
        trainedAt: metadata.trainedAt,
      },
    })

    // Upload metadata JSON
    await this.uploadFile(
      JSON.stringify({ ...metadata, cid: modelResult.cid }, null, 2),
      'metadata.json',
      options,
    )

    logger.info('Model uploaded to IPFS', {
      version: metadata.version,
      cid: modelResult.cid,
    })

    return {
      ...metadata,
      cid: modelResult.cid,
    }
  }

  /**
   * Download file from IPFS
   */
  async download(cid: string): Promise<Buffer> {
    const headers: Record<string, string> = {}
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const response = await fetch(`${this.endpoint}/storage/download/${cid}`, {
      headers,
    })

    if (!response.ok) {
      throw new Error(`IPFS download failed: ${response.status}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }

  /**
   * Get gateway URL for a CID
   */
  getGatewayUrl(cid: string): string {
    const network = getCurrentNetwork()
    if (network === 'mainnet') {
      return `https://ipfs.jeju.network/ipfs/${cid}`
    }
    if (network === 'testnet') {
      return `https://ipfs.testnet.jeju.network/ipfs/${cid}`
    }
    return `${this.endpoint}/ipfs/${cid}`
  }

  /**
   * Pin content to ensure persistence
   */
  async pin(cid: string): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const response = await fetch(`${this.endpoint}/api/v1/pin`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cid }),
    })

    if (!response.ok) {
      throw new Error(`IPFS pin failed: ${response.status}`)
    }
  }
}

/**
 * Singleton instance
 */
let storageUtil: StorageUtil | null = null

export function getStorage(): StorageUtil {
  if (!storageUtil) {
    storageUtil = new StorageUtil()
  }
  return storageUtil
}

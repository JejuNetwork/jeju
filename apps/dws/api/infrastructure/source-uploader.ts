/**
 * Source Code Uploader
 *
 * Handles uploading source code to IPFS for deployment via Terraform and Helm.
 * Uses the real DWS storage backend (IPFS) instead of fake endpoints.
 *
 * Supports:
 * - Single file upload
 * - Directory upload (bundled as manifest)
 * - GitHub/GitLab repository references (TODO)
 * - Pre-built container images
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { getCurrentNetwork } from '@jejunetwork/config'
import { getBackendManager } from '../storage/backends'

// Types

export interface UploadResult {
  cid: string
  hash: string
  size: number
  url: string
}

export interface DirectoryUploadResult {
  rootCid: string
  files: Map<string, string> // path -> CID
  totalSize: number
  fileCount: number
}

export interface SourceReference {
  type: 'ipfs' | 'local' | 'git' | 'registry'
  ref: string // CID, path, git URL, or image reference
}

// Source Uploader

export class SourceUploader {
  private network: string
  private gatewayEndpoint: string

  constructor() {
    this.network = getCurrentNetwork()
    // Use network-specific gateway for URL generation
    if (this.network === 'mainnet') {
      this.gatewayEndpoint = 'https://ipfs.jejunetwork.org'
    } else if (this.network === 'testnet') {
      this.gatewayEndpoint = 'https://ipfs.testnet.jejunetwork.org'
    } else {
      this.gatewayEndpoint = 'http://localhost:8080'
    }
  }

  /**
   * Upload a single file to IPFS via the real storage backend
   */
  async uploadFile(
    content: Buffer | string,
    filename: string,
  ): Promise<UploadResult> {
    const buffer = typeof content === 'string' ? Buffer.from(content) : content
    const hash = createHash('sha256').update(buffer).digest('hex')

    const backendManager = getBackendManager()
    const result = await backendManager.upload(buffer, { filename })

    return {
      cid: result.cid,
      hash: `0x${hash}`,
      size: buffer.length,
      url: result.url || `${this.gatewayEndpoint}/ipfs/${result.cid}`,
    }
  }

  /**
   * Upload a directory to IPFS
   * Files are uploaded individually and wrapped in a manifest
   */
  async uploadDirectory(localPath: string): Promise<DirectoryUploadResult> {
    const files = await this.collectFiles(localPath)
    const fileResults = new Map<string, string>()
    let totalSize = 0

    console.log(
      `[SourceUploader] Uploading ${files.length} files from ${localPath}`,
    )

    const backendManager = getBackendManager()

    // Upload each file
    for (const file of files) {
      const content = await readFile(file.absolutePath)
      const result = await backendManager.upload(content, {
        filename: file.relativePath,
      })
      fileResults.set(file.relativePath, result.cid)
      totalSize += content.length

      console.log(
        `[SourceUploader] Uploaded ${file.relativePath} -> ${result.cid}`,
      )
    }

    // Create a manifest for the directory
    const manifest = {
      type: 'dws-source-bundle',
      version: 1,
      files: Object.fromEntries(fileResults),
      timestamp: Date.now(),
    }

    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2))
    const manifestResult = await backendManager.upload(manifestBuffer, {
      filename: 'manifest.json',
    })

    console.log(`[SourceUploader] Directory uploaded: ${manifestResult.cid}`)

    return {
      rootCid: manifestResult.cid,
      files: fileResults,
      totalSize,
      fileCount: files.length,
    }
  }

  /**
   * Upload from a source reference
   */
  async upload(source: SourceReference): Promise<UploadResult> {
    switch (source.type) {
      case 'ipfs':
        // Already on IPFS, just return the CID
        return {
          cid: source.ref,
          hash: '',
          size: 0,
          url: `${this.gatewayEndpoint}/ipfs/${source.ref}`,
        }

      case 'local': {
        // Check if it's a file or directory
        const stats = await stat(source.ref)
        if (stats.isDirectory()) {
          const result = await this.uploadDirectory(source.ref)
          return {
            cid: result.rootCid,
            hash: '',
            size: result.totalSize,
            url: `${this.gatewayEndpoint}/ipfs/${result.rootCid}`,
          }
        } else {
          const content = await readFile(source.ref)
          const filename = source.ref.split('/').pop() ?? 'file'
          return this.uploadFile(content, filename)
        }
      }

      case 'git':
        // Clone and upload git repository
        return this.uploadFromGit(source.ref)

      case 'registry':
        // Container image - no IPFS upload needed
        return {
          cid: '',
          hash: source.ref,
          size: 0,
          url: source.ref,
        }

      default:
        throw new Error(`Unsupported source type: ${source.type}`)
    }
  }

  /**
   * Upload worker code bundle
   * Accepts JavaScript/TypeScript code and creates a worker-ready bundle
   */
  async uploadWorkerCode(
    code: string,
    options?: {
      entrypoint?: string
      format?: 'esm' | 'cjs'
      minify?: boolean
    },
  ): Promise<UploadResult> {
    const entrypoint = options?.entrypoint ?? 'index.js'
    const format = options?.format ?? 'esm'

    // Create a bundle manifest
    const bundle = {
      type: 'dws-worker-bundle',
      version: 1,
      entrypoint,
      format,
      code,
      timestamp: Date.now(),
    }

    return this.uploadFile(JSON.stringify(bundle), 'worker-bundle.json')
  }

  /**
   * Upload a container image manifest
   * References an existing image in a registry
   */
  async uploadContainerManifest(
    image: string,
    options?: {
      platform?: string
      pullPolicy?: 'always' | 'if-not-present' | 'never'
    },
  ): Promise<UploadResult> {
    const manifest = {
      type: 'dws-container-manifest',
      version: 1,
      image,
      platform: options?.platform ?? 'linux/amd64',
      pullPolicy: options?.pullPolicy ?? 'if-not-present',
      timestamp: Date.now(),
    }

    return this.uploadFile(JSON.stringify(manifest), 'container-manifest.json')
  }

  /**
   * Clone a git repo and upload to IPFS
   */
  private async uploadFromGit(gitUrl: string): Promise<UploadResult> {
    // Git upload requires cloning, which is complex and needs temp directories
    // For now, we throw an informative error
    throw new Error(
      `Git upload not yet implemented. Clone the repo locally and use local path instead: ${gitUrl}`,
    )
  }

  /**
   * Collect all files in a directory recursively
   */
  private async collectFiles(
    dir: string,
    baseDir?: string,
  ): Promise<Array<{ absolutePath: string; relativePath: string }>> {
    const base = baseDir ?? dir
    const entries = await readdir(dir, { withFileTypes: true })
    const files: Array<{ absolutePath: string; relativePath: string }> = []

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      // Skip common non-source files
      if (this.shouldSkip(entry.name)) {
        continue
      }

      if (entry.isDirectory()) {
        const subFiles = await this.collectFiles(fullPath, base)
        files.push(...subFiles)
      } else {
        files.push({
          absolutePath: fullPath,
          relativePath: relative(base, fullPath),
        })
      }
    }

    return files
  }

  /**
   * Check if a file/directory should be skipped
   */
  private shouldSkip(name: string): boolean {
    const skipPatterns = [
      'node_modules',
      '.git',
      '.svn',
      '.hg',
      '__pycache__',
      '.pytest_cache',
      '.mypy_cache',
      'dist',
      'build',
      '.next',
      '.nuxt',
      'target', // Rust
      '.cargo',
      'vendor', // Go/PHP
      '.idea',
      '.vscode',
      '.DS_Store',
      'Thumbs.db',
    ]

    return skipPatterns.includes(name) || name.startsWith('.')
  }

  /**
   * Get the gateway URL for a CID
   */
  getGatewayUrl(cid: string): string {
    return `${this.gatewayEndpoint}/ipfs/${cid}`
  }
}

// Singleton instance

let sourceUploader: SourceUploader | null = null

export function getSourceUploader(): SourceUploader {
  if (!sourceUploader) {
    sourceUploader = new SourceUploader()
  }
  return sourceUploader
}

// Helper functions for Terraform and Helm integration

/**
 * Resolve a source reference to an IPFS CID
 * Used by Terraform and Helm providers
 */
export async function resolveSourceToIPFS(
  source: string | SourceReference,
): Promise<{ cid: string; hash: string; size: number }> {
  const uploader = getSourceUploader()

  // Parse source string into SourceReference
  let ref: SourceReference
  if (typeof source === 'string') {
    if (
      source.startsWith('ipfs://') ||
      source.startsWith('Qm') ||
      source.startsWith('bafy')
    ) {
      ref = { type: 'ipfs', ref: source.replace('ipfs://', '') }
    } else if (
      source.startsWith('git://') ||
      source.startsWith('https://github.com') ||
      source.startsWith('https://gitlab.com')
    ) {
      ref = { type: 'git', ref: source }
    } else if (
      source.includes('/') &&
      (source.includes(':') || !source.startsWith('.'))
    ) {
      // Looks like a container image reference
      ref = { type: 'registry', ref: source }
    } else {
      // Assume local path
      ref = { type: 'local', ref: source }
    }
  } else {
    ref = source
  }

  const result = await uploader.upload(ref)
  return {
    cid: result.cid,
    hash: result.hash,
    size: result.size,
  }
}

/**
 * Upload worker code and return CID
 */
export async function uploadWorkerCode(
  code: string,
  entrypoint = 'index.js',
): Promise<string> {
  const uploader = getSourceUploader()
  const result = await uploader.uploadWorkerCode(code, { entrypoint })
  return result.cid
}

/**
 * Upload a local directory and return CID
 */
export async function uploadDirectory(localPath: string): Promise<string> {
  const uploader = getSourceUploader()
  const result = await uploader.uploadDirectory(localPath)
  return result.rootCid
}

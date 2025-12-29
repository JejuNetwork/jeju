/**
 * IPNS Service for Mutable Content Pointers
 *
 * IPNS (InterPlanetary Name System) provides mutable pointers to IPFS content.
 * This enables preview/staging deployments without on-chain transactions.
 *
 * Content Resolution Strategy:
 * - Production: Immutable IPFS CID stored in JNS contenthash (on-chain)
 * - Preview/Staging: IPNS key pointing to latest CID (off-chain, mutable)
 * - Development: Direct proxy to local dev server (instant HMR)
 *
 * Key Naming Convention:
 * - {appName}-preview: Preview deployments (e.g., "bazaar-preview")
 * - {appName}-{branch}: Branch deployments (e.g., "bazaar-feature-xyz")
 * - {appName}-staging: Staging environment
 */

import { getIpfsApiUrlEnv, getLocalhostHost } from '@jejunetwork/config'
import { z } from 'zod'
import { bytesToHex, hash256 } from '../crypto/universal'

// IPFS API response schemas
const IPFSKeySchema = z.object({
  name: z.string(),
  id: z.string(),
  Name: z.string().optional(),
  Id: z.string().optional(),
})

const IPFSKeyListResponseSchema = z.object({
  Keys: z.array(IPFSKeySchema),
})

const IPFSKeyGenResponseSchema = z.object({
  Name: z.string(),
  Id: z.string(),
})

const IPFSPublishResponseSchema = z.object({
  Name: z.string(),
  Value: z.string(),
})

const IPFSResolveResponseSchema = z.object({
  Path: z.string(),
})

/** IPNS key info */
export interface IPNSKey {
  name: string
  id: string // IPNS name (peer ID / key hash)
}

/** IPNS publish result */
export interface IPNSPublishResult {
  name: string // IPNS name
  value: string // IPFS CID
}

/** IPNS resolution result */
export interface IPNSResolution {
  path: string // /ipfs/CID
  cid: string
  ipnsName: string
}

/**
 * IPNS Client for interacting with IPFS node
 */
export class IPNSClient {
  private apiUrl: string

  constructor(
    ipfsApiUrl: string = getIpfsApiUrlEnv() ??
      `http://${getLocalhostHost()}:5001`,
  ) {
    this.apiUrl = ipfsApiUrl
  }

  /**
   * Create or get an IPNS key
   * @param keyName - Name for the key (e.g., "bazaar-preview")
   */
  async getOrCreateKey(keyName: string): Promise<IPNSKey> {
    // List existing keys
    const listResponse = await fetch(`${this.apiUrl}/api/v0/key/list`, {
      method: 'POST',
    })

    if (!listResponse.ok) {
      throw new Error(`Failed to list IPNS keys: ${await listResponse.text()}`)
    }

    const rawData: unknown = await listResponse.json()
    const { Keys } = IPFSKeyListResponseSchema.parse(rawData)
    const existing = Keys.find((k) => k.name === keyName)

    if (existing) {
      return { name: existing.name, id: existing.id }
    }

    // Create new key
    const genResponse = await fetch(
      `${this.apiUrl}/api/v0/key/gen?arg=${encodeURIComponent(keyName)}&type=ed25519`,
      { method: 'POST' },
    )

    if (!genResponse.ok) {
      throw new Error(`Failed to create IPNS key: ${await genResponse.text()}`)
    }

    const rawKeyData: unknown = await genResponse.json()
    const newKey = IPFSKeyGenResponseSchema.parse(rawKeyData)
    return { name: newKey.Name, id: newKey.Id }
  }

  /**
   * Publish content to IPNS
   * @param cid - IPFS CID to point to
   * @param keyName - IPNS key name
   */
  async publish(cid: string, keyName: string): Promise<IPNSPublishResult> {
    // Ensure key exists
    await this.getOrCreateKey(keyName)

    // Publish to IPNS
    const response = await fetch(
      `${this.apiUrl}/api/v0/name/publish?arg=${cid}&key=${keyName}&lifetime=24h&ttl=1m`,
      { method: 'POST' },
    )

    if (!response.ok) {
      throw new Error(`Failed to publish to IPNS: ${await response.text()}`)
    }

    const rawPublishData: unknown = await response.json()
    const result = IPFSPublishResponseSchema.parse(rawPublishData)
    return { name: result.Name, value: result.Value }
  }

  /**
   * Resolve IPNS name to IPFS path
   * @param ipnsName - IPNS name (peer ID or key hash)
   */
  async resolve(ipnsName: string): Promise<IPNSResolution> {
    const response = await fetch(
      `${this.apiUrl}/api/v0/name/resolve?arg=${ipnsName}&nocache=true`,
      { method: 'POST' },
    )

    if (!response.ok) {
      throw new Error(`Failed to resolve IPNS: ${await response.text()}`)
    }

    const rawResolveData: unknown = await response.json()
    const { Path } = IPFSResolveResponseSchema.parse(rawResolveData)
    const cid = Path.replace('/ipfs/', '')

    return {
      path: Path,
      cid,
      ipnsName,
    }
  }

  /**
   * List all IPNS keys
   */
  async listKeys(): Promise<IPNSKey[]> {
    const response = await fetch(`${this.apiUrl}/api/v0/key/list`, {
      method: 'POST',
    })

    if (!response.ok) {
      throw new Error(`Failed to list IPNS keys: ${await response.text()}`)
    }

    const rawListData: unknown = await response.json()
    const { Keys } = IPFSKeyListResponseSchema.parse(rawListData)
    return Keys.map((k) => ({ name: k.name, id: k.id }))
  }

  /**
   * Remove an IPNS key
   */
  async removeKey(keyName: string): Promise<void> {
    const response = await fetch(
      `${this.apiUrl}/api/v0/key/rm?arg=${encodeURIComponent(keyName)}`,
      { method: 'POST' },
    )

    if (!response.ok) {
      const text = await response.text()
      if (!text.includes('key not found')) {
        throw new Error(`Failed to remove IPNS key: ${text}`)
      }
    }
  }
}

/**
 * Get IPNS key name for an app
 * @param appName - App name (e.g., "bazaar")
 * @param environment - Environment type
 */
export function getIPNSKeyName(
  appName: string,
  environment: 'preview' | 'staging' | 'branch',
  branchName?: string,
): string {
  switch (environment) {
    case 'preview':
      return `${appName}-preview`
    case 'staging':
      return `${appName}-staging`
    case 'branch': {
      if (!branchName)
        throw new Error('Branch name required for branch environment')
      // Sanitize branch name for IPNS key
      const sanitized = branchName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 32)
      return `${appName}-${sanitized}`
    }
    default:
      throw new Error(`Unknown environment: ${environment}`)
  }
}

/**
 * Generate contenthash for IPNS (for JNS resolver)
 * IPNS uses namespace 0xe5 in EIP-1577
 */
export function encodeIPNSContenthash(ipnsId: string): `0x${string}` {
  // IPNS contenthash format: 0xe5 + <peer-id>
  // For simplicity, we'll use a hash of the IPNS ID
  const hash = hash256(ipnsId)
  return `0xe5${bytesToHex(hash).slice(0, 64)}` as `0x${string}`
}

/**
 * Decode IPNS from contenthash
 */
export function decodeIPNSContenthash(contenthash: string): string | null {
  if (!contenthash.startsWith('0xe5')) {
    return null
  }
  // The actual IPNS ID would need to be stored/looked up
  // This is a simplified version
  return contenthash.slice(4)
}

/**
 * Preview Deployment Manager
 * Handles publishing preview builds to IPNS
 */
export class PreviewDeploymentManager {
  private ipns: IPNSClient

  constructor(ipfsApiUrl?: string) {
    this.ipns = new IPNSClient(ipfsApiUrl)
  }

  /**
   * Deploy a preview build
   * @param appName - App name
   * @param cid - IPFS CID of the build
   * @param options - Deployment options
   */
  async deployPreview(
    appName: string,
    cid: string,
    options: {
      environment?: 'preview' | 'staging' | 'branch'
      branchName?: string
    } = {},
  ): Promise<{
    ipnsName: string
    ipnsId: string
    cid: string
    url: string
  }> {
    const environment = options.environment ?? 'preview'
    const keyName = getIPNSKeyName(appName, environment, options.branchName)

    console.log(`[Preview] Deploying ${appName} to IPNS key: ${keyName}`)

    // Get or create the key
    const key = await this.ipns.getOrCreateKey(keyName)

    // Publish to IPNS
    await this.ipns.publish(cid, keyName)

    console.log(`[Preview] Published: /ipns/${key.id} → /ipfs/${cid}`)

    return {
      ipnsName: keyName,
      ipnsId: key.id,
      cid,
      url: `/ipns/${key.id}`,
    }
  }

  /**
   * Get the current preview deployment
   */
  async getPreviewDeployment(
    appName: string,
    environment: 'preview' | 'staging' | 'branch' = 'preview',
    branchName?: string,
  ): Promise<IPNSResolution | null> {
    const keyName = getIPNSKeyName(appName, environment, branchName)

    // Find the key
    const keys = await this.ipns.listKeys()
    const key = keys.find((k) => k.name === keyName)

    if (!key) {
      return null
    }

    // Resolve to current CID
    const resolution = await this.ipns.resolve(key.id)
    return resolution
  }

  /**
   * List all preview deployments for an app
   */
  async listPreviews(appName: string): Promise<
    Array<{
      keyName: string
      ipnsId: string
      environment: string
    }>
  > {
    const keys = await this.ipns.listKeys()

    return keys
      .filter((k) => k.name.startsWith(`${appName}-`))
      .map((k) => {
        const suffix = k.name.slice(appName.length + 1)
        let environment = 'branch'
        if (suffix === 'preview') environment = 'preview'
        if (suffix === 'staging') environment = 'staging'

        return {
          keyName: k.name,
          ipnsId: k.id,
          environment,
        }
      })
  }

  /**
   * Clean up old preview deployments
   */
  async cleanupPreviews(
    appName: string,
    keepEnvironments: string[] = ['preview', 'staging'],
  ): Promise<number> {
    const keys = await this.ipns.listKeys()
    let removed = 0

    for (const key of keys) {
      if (!key.name.startsWith(`${appName}-`)) continue

      const suffix = key.name.slice(appName.length + 1)
      if (keepEnvironments.includes(suffix)) continue

      console.log(`[Preview] Removing old key: ${key.name}`)
      await this.ipns.removeKey(key.name)
      removed++
    }

    return removed
  }
}

/**
 * Create IPNS client with default configuration
 */
export function createIPNSClient(): IPNSClient {
  const apiUrl = getIpfsApiUrlEnv()
  return new IPNSClient(apiUrl)
}

/**
 * Create preview deployment manager with default configuration
 */
export function createPreviewManager(): PreviewDeploymentManager {
  const apiUrl = getIpfsApiUrlEnv()
  return new PreviewDeploymentManager(apiUrl)
}

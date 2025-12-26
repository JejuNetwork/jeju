/**
 * Content Versioning Service
 *
 * Unified content resolution for Jeju apps across different deployment modes:
 *
 * ┌─────────────┬──────────────────┬─────────────────┬────────────────────┐
 * │ Mode        │ Content Source   │ Update Speed    │ On-chain TX?       │
 * ├─────────────┼──────────────────┼─────────────────┼────────────────────┤
 * │ Development │ Local dev server │ Instant (HMR)   │ No                 │
 * │ Preview     │ IPNS pointer     │ ~1 minute       │ No                 │
 * │ Staging     │ IPNS pointer     │ ~1 minute       │ No                 │
 * │ Production  │ IPFS CID (JNS)   │ TX confirmation │ Yes (contenthash)  │
 * └─────────────┴──────────────────┴─────────────────┴────────────────────┘
 *
 * This service provides:
 * - Automatic mode detection
 * - Content resolution across modes
 * - Hot-reload support for development
 * - IPNS management for preview/staging
 * - JNS contenthash updates for production
 */

import {
  getIpfsApiUrlEnv,
  getIpfsGatewayUrlEnv,
  getJnsResolverAddressEnv,
  isDeployPreview,
  isDeployStaging,
  isDevMode,
} from '@jejunetwork/config'
import {
  readContract,
  writeContract as typedWriteContract,
} from '@jejunetwork/contracts'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { namehash } from 'viem'
import { z } from 'zod'

// IPFS API response schemas for content versioning
const IPFSResolveResponseSchema = z.object({
  Path: z.string(),
})

const IPFSPublishResponseSchema = z.object({
  Name: z.string(),
})

/** Deployment mode */
export type DeploymentMode =
  | 'development'
  | 'preview'
  | 'staging'
  | 'production'

/** Content resolution result */
export interface ContentResolution {
  mode: DeploymentMode
  source: 'dev-proxy' | 'ipns' | 'ipfs' | 'jns'
  url: string
  cid?: string
  ipnsName?: string
  jnsName?: string
  devServer?: string
  isHotReload: boolean
  timestamp: number
}

/** Content versioning configuration */
export interface ContentVersioningConfig {
  /** App name */
  appName: string
  /** JNS name (e.g., "bazaar.jeju") */
  jnsName: string
  /** JNS resolver address */
  jnsResolver: Address
  /** IPFS API URL */
  ipfsApiUrl: string
  /** IPFS Gateway URL */
  ipfsGatewayUrl: string
  /** Local dev server URL (for development mode) */
  devServerUrl?: string
  /** Force specific mode */
  forceMode?: DeploymentMode
}

/** JNS Resolver ABI for contenthash and text records */
const JNS_RESOLVER_ABI = [
  {
    name: 'contenthash',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bytes' }],
  },
  {
    name: 'setContenthash',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'contenthash', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'text',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'setText',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
] as const

/**
 * Content Versioning Service
 */
export class ContentVersioningService {
  private config: ContentVersioningConfig
  private publicClient?: PublicClient
  private walletClient?: WalletClient
  private cachedResolution?: ContentResolution
  private cacheExpiry = 0

  constructor(
    config: ContentVersioningConfig,
    publicClient?: PublicClient,
    walletClient?: WalletClient,
  ) {
    this.config = config
    this.publicClient = publicClient
    this.walletClient = walletClient
  }

  /**
   * Detect the current deployment mode
   */
  detectMode(): DeploymentMode {
    if (this.config.forceMode) return this.config.forceMode

    // Check environment variables via config
    if (isDevMode()) {
      return 'development'
    }

    if (isDeployPreview()) {
      return 'preview'
    }

    if (isDeployStaging()) {
      return 'staging'
    }

    return 'production'
  }

  /**
   * Resolve content for the current mode
   */
  async resolve(): Promise<ContentResolution> {
    // Check cache
    if (this.cachedResolution && Date.now() < this.cacheExpiry) {
      return this.cachedResolution
    }

    const mode = this.detectMode()
    let resolution: ContentResolution

    switch (mode) {
      case 'development':
        resolution = await this.resolveDevMode()
        break
      case 'preview':
      case 'staging':
        resolution = await this.resolveIPNSMode(mode)
        break
      case 'production':
        resolution = await this.resolveProductionMode()
        break
    }

    // Cache for different durations based on mode
    const cacheDuration =
      mode === 'development' ? 1000 : mode === 'production' ? 60000 : 5000
    this.cachedResolution = resolution
    this.cacheExpiry = Date.now() + cacheDuration

    return resolution
  }

  /**
   * Resolve development mode (local dev server)
   */
  private async resolveDevMode(): Promise<ContentResolution> {
    const devServer = this.config.devServerUrl ?? this.getDefaultDevServerUrl()

    // Try to get dev endpoint from JNS text record
    if (this.publicClient) {
      const node = namehash(this.config.jnsName) as Hex
      const jnsDevEndpoint = await readContract(this.publicClient, {
        address: this.config.jnsResolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'text',
        args: [node, 'dws.dev'],
      }).catch((): null => null)

      if (jnsDevEndpoint && jnsDevEndpoint.length > 0) {
        return {
          mode: 'development',
          source: 'dev-proxy',
          url: jnsDevEndpoint,
          jnsName: this.config.jnsName,
          devServer: jnsDevEndpoint,
          isHotReload: true,
          timestamp: Date.now(),
        }
      }
    }

    return {
      mode: 'development',
      source: 'dev-proxy',
      url: devServer,
      jnsName: this.config.jnsName,
      devServer,
      isHotReload: true,
      timestamp: Date.now(),
    }
  }

  /**
   * Resolve IPNS mode (preview/staging)
   */
  private async resolveIPNSMode(
    mode: 'preview' | 'staging',
  ): Promise<ContentResolution> {
    const ipnsKeyName = `${this.config.appName}-${mode}`

    // Try to resolve IPNS
    const ipnsResponse = await fetch(
      `${this.config.ipfsApiUrl}/api/v0/name/resolve?arg=${ipnsKeyName}&nocache=true`,
      { method: 'POST' },
    ).catch((): null => null)

    if (ipnsResponse?.ok) {
      const rawData: unknown = await ipnsResponse.json()
      const { Path } = IPFSResolveResponseSchema.parse(rawData)
      const cid = Path.replace('/ipfs/', '')

      return {
        mode,
        source: 'ipns',
        url: `${this.config.ipfsGatewayUrl}/ipfs/${cid}`,
        cid,
        ipnsName: ipnsKeyName,
        jnsName: this.config.jnsName,
        isHotReload: false,
        timestamp: Date.now(),
      }
    }

    // Fall back to production if IPNS not available
    console.warn(
      `[ContentVersioning] IPNS key ${ipnsKeyName} not found, falling back to production`,
    )
    return this.resolveProductionMode()
  }

  /**
   * Resolve production mode (JNS contenthash → IPFS)
   */
  private async resolveProductionMode(): Promise<ContentResolution> {
    if (!this.publicClient) {
      throw new Error('Public client required for production mode')
    }

    const node = namehash(this.config.jnsName) as Hex
    const contenthash = await readContract(this.publicClient, {
      address: this.config.jnsResolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'contenthash',
      args: [node],
    })

    if (!contenthash || contenthash === '0x') {
      throw new Error(`No contenthash set for ${this.config.jnsName}`)
    }

    const cid = this.decodeContenthash(contenthash)

    return {
      mode: 'production',
      source: 'jns',
      url: `${this.config.ipfsGatewayUrl}/ipfs/${cid}`,
      cid,
      jnsName: this.config.jnsName,
      isHotReload: false,
      timestamp: Date.now(),
    }
  }

  /**
   * Publish content to the appropriate destination based on mode
   */
  async publish(
    cid: string,
    mode?: DeploymentMode,
  ): Promise<{
    mode: DeploymentMode
    destination: string
    txHash?: string
  }> {
    const targetMode = mode ?? this.detectMode()

    switch (targetMode) {
      case 'development':
        // No-op for development mode
        return { mode: 'development', destination: 'local-dev-server' }

      case 'preview':
      case 'staging':
        return this.publishToIPNS(cid, targetMode)

      case 'production':
        return this.publishToJNS(cid)
    }
  }

  /**
   * Publish to IPNS (preview/staging)
   */
  private async publishToIPNS(
    cid: string,
    mode: 'preview' | 'staging',
  ): Promise<{ mode: DeploymentMode; destination: string }> {
    const keyName = `${this.config.appName}-${mode}`

    // Ensure key exists
    await fetch(
      `${this.config.ipfsApiUrl}/api/v0/key/gen?arg=${keyName}&type=ed25519`,
      { method: 'POST' },
    ).catch(() => {})

    // Publish to IPNS
    const response = await fetch(
      `${this.config.ipfsApiUrl}/api/v0/name/publish?arg=${cid}&key=${keyName}&lifetime=24h&ttl=1m`,
      { method: 'POST' },
    )

    if (!response.ok) {
      throw new Error(`Failed to publish to IPNS: ${await response.text()}`)
    }

    const rawPublishData: unknown = await response.json()
    const { Name } = IPFSPublishResponseSchema.parse(rawPublishData)

    return {
      mode,
      destination: `/ipns/${Name}`,
    }
  }

  /**
   * Publish to JNS (production)
   */
  private async publishToJNS(
    cid: string,
  ): Promise<{ mode: DeploymentMode; destination: string; txHash?: string }> {
    if (!this.walletClient) {
      throw new Error('Wallet client required to publish to JNS')
    }

    const node = namehash(this.config.jnsName) as Hex
    const contenthash = this.encodeContenthash(cid)

    const hash = await typedWriteContract(this.walletClient, {
      address: this.config.jnsResolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setContenthash',
      args: [node, contenthash],
    })

    return {
      mode: 'production',
      destination: this.config.jnsName,
      txHash: hash,
    }
  }

  /**
   * Get default dev server URL based on app name
   */
  private getDefaultDevServerUrl(): string {
    const defaultPorts: Record<string, number> = {
      gateway: 4013,
      bazaar: 4006,
      docs: 4004,
      documentation: 4004,
      factory: 4009,
      autocrat: 4040,
      crucible: 4020,
      dws: 4030,
      monitoring: 3002,
      node: 4080,
    }

    const port = defaultPorts[this.config.appName] ?? 4000
    return `http://localhost:${port}`
  }

  /**
   * Encode IPFS CID as EIP-1577 contenthash
   */
  private encodeContenthash(cid: string): Hex {
    // For simplicity, encode as text-based contenthash
    // In production, use proper CID encoding
    const bytes = Buffer.from(cid, 'utf-8')
    return `0xe3${bytes.toString('hex')}` as Hex
  }

  /**
   * Decode EIP-1577 contenthash to CID
   */
  private decodeContenthash(contenthash: Hex): string {
    if (!contenthash.startsWith('0xe3')) {
      throw new Error('Only IPFS contenthash supported')
    }
    const bytes = Buffer.from(contenthash.slice(4), 'hex')
    return bytes.toString('utf-8')
  }
}

/**
 * Create content versioning service with default configuration
 */
export function createContentVersioningService(
  appName: string,
  options: {
    jnsResolver?: Address
    ipfsApiUrl?: string
    ipfsGatewayUrl?: string
    publicClient?: PublicClient
    walletClient?: WalletClient
  } = {},
): ContentVersioningService {
  return new ContentVersioningService(
    {
      appName,
      jnsName: `${appName}.jeju`,
      jnsResolver:
        options.jnsResolver ?? (getJnsResolverAddressEnv() as Address) ?? '0x0',
      ipfsApiUrl: options.ipfsApiUrl ?? getIpfsApiUrlEnv(),
      ipfsGatewayUrl:
        options.ipfsGatewayUrl ??
        getIpfsGatewayUrlEnv() ??
        'http://localhost:4180',
    },
    options.publicClient,
    options.walletClient,
  )
}

/**
 * Quick check if dev mode is enabled
 */
export function isDevModeActive(): boolean {
  return isDevMode()
}

/**
 * Get the current deployment mode from environment
 */
export function getCurrentDeploymentMode(): DeploymentMode {
  if (isDevMode()) {
    return 'development'
  }
  if (isDeployPreview()) {
    return 'preview'
  }
  if (isDeployStaging()) {
    return 'staging'
  }
  return 'production'
}

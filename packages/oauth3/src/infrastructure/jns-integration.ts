/**
 * JNS Integration - Direct on-chain name resolution for OAuth3
 */

import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  type PublicClient,
} from 'viem'
import { JNS_REGISTRY_ABI, JNS_RESOLVER_ABI, namehash } from './abis.js'
import { CHAIN_IDS, DEFAULT_RPC, getContracts, ZERO_ADDRESS } from './config.js'

export interface OAuth3JNSConfig {
  rpcUrl?: string
  registryAddress?: Address
  resolverAddress?: Address
  chainId?: number
}

export interface OAuth3AppJNS {
  name: string
  fullName: string
  owner: Address
  council?: Address
  redirectUris: string[]
  authEndpoint: string
  callbackEndpoint: string
  metadata: { logoUri: string; policyUri: string; termsUri: string }
}

export interface IdentityJNS {
  name: string
  fullName: string
  owner: Address
  smartAccount: Address
  avatar: string
  linkedProviders: string[]
  publicKey: Hex
}

export interface TEENodeJNS {
  name: string
  fullName: string
  operator: Address
  endpoint: string
  publicKey: Hex
  attestationType: string
  supportedProviders: string[]
  stake: bigint
  active: boolean
}

export interface JNSRecords {
  address?: Address
  avatar?: string
  url?: string
  description?: string
  oauth3Endpoint?: string
  a2aEndpoint?: string
}

/**
 * JNS Service - All reads go directly to on-chain contracts
 */
export class OAuth3JNSService {
  private client: PublicClient
  private registryAddress: Address
  private defaultResolverAddress: Address

  constructor(config: OAuth3JNSConfig = {}) {
    const chainId = config.chainId || CHAIN_IDS.localnet
    const contracts = getContracts(chainId)

    this.client = createPublicClient({
      transport: http(config.rpcUrl || process.env.JEJU_RPC_URL || DEFAULT_RPC),
    })
    this.registryAddress = config.registryAddress || contracts.jnsRegistry
    this.defaultResolverAddress =
      config.resolverAddress || contracts.jnsResolver
  }

  async resolveApp(appName: string): Promise<OAuth3AppJNS | null> {
    const fullName = this.normalizeAppName(appName)
    const node = namehash(fullName)

    const resolverAddress = await this.getResolver(node)
    if (!resolverAddress) return null

    const owner = await this.client.readContract({
      address: resolverAddress,
      abi: JNS_RESOLVER_ABI,
      functionName: 'addr',
      args: [node],
    })

    if (!owner || owner === ZERO_ADDRESS) return null

    const [
      council,
      redirectUris,
      authEndpoint,
      callbackEndpoint,
      policyUri,
      termsUri,
      avatar,
    ] = await Promise.all([
      this.getText(resolverAddress, node, 'oauth3.council'),
      this.getText(resolverAddress, node, 'oauth3.redirectUris'),
      this.getText(resolverAddress, node, 'oauth3.authEndpoint'),
      this.getText(resolverAddress, node, 'oauth3.callbackEndpoint'),
      this.getText(resolverAddress, node, 'oauth3.policyUri'),
      this.getText(resolverAddress, node, 'oauth3.termsUri'),
      this.getText(resolverAddress, node, 'avatar'),
    ])

    const endpoint = await this.getText(resolverAddress, node, 'app.endpoint')

    return {
      name: appName.replace('.oauth3.jeju', '').replace('.oauth3', ''),
      fullName,
      owner,
      council: council as Address | undefined,
      redirectUris: redirectUris?.split(',').filter(Boolean) || [],
      authEndpoint: authEndpoint || (endpoint ? `${endpoint}/auth` : ''),
      callbackEndpoint:
        callbackEndpoint || (endpoint ? `${endpoint}/callback` : ''),
      metadata: {
        logoUri: avatar || '',
        policyUri: policyUri || '',
        termsUri: termsUri || '',
      },
    }
  }

  async resolveIdentity(identityName: string): Promise<IdentityJNS | null> {
    const fullName = this.normalizeIdentityName(identityName)
    const node = namehash(fullName)

    const resolverAddress = await this.getResolver(node)
    if (!resolverAddress) return null

    const owner = await this.client.readContract({
      address: resolverAddress,
      abi: JNS_RESOLVER_ABI,
      functionName: 'addr',
      args: [node],
    })

    if (!owner || owner === ZERO_ADDRESS) return null

    const [smartAccount, publicKey, linkedProviders, avatar] =
      await Promise.all([
        this.getText(resolverAddress, node, 'identity.smartAccount'),
        this.getText(resolverAddress, node, 'identity.publicKey'),
        this.getText(resolverAddress, node, 'identity.linkedProviders'),
        this.getText(resolverAddress, node, 'avatar'),
      ])

    return {
      name: identityName.replace('.id.jeju', '').replace('.id', ''),
      fullName,
      owner,
      smartAccount: (smartAccount as Address) || owner,
      avatar: avatar || '',
      linkedProviders: linkedProviders?.split(',').filter(Boolean) || [],
      publicKey: (publicKey as Hex) || '0x',
    }
  }

  async resolveTEENode(nodeName: string): Promise<TEENodeJNS | null> {
    const fullName = this.normalizeTEENodeName(nodeName)
    const node = namehash(fullName)

    const resolverAddress = await this.getResolver(node)
    if (!resolverAddress) return null

    const operator = await this.client.readContract({
      address: resolverAddress,
      abi: JNS_RESOLVER_ABI,
      functionName: 'addr',
      args: [node],
    })

    if (!operator || operator === ZERO_ADDRESS) return null

    const [
      endpoint,
      publicKey,
      attestationType,
      supportedProviders,
      stake,
      active,
    ] = await Promise.all([
      this.getText(resolverAddress, node, 'tee.endpoint'),
      this.getText(resolverAddress, node, 'tee.publicKey'),
      this.getText(resolverAddress, node, 'tee.attestationType'),
      this.getText(resolverAddress, node, 'tee.supportedProviders'),
      this.getText(resolverAddress, node, 'tee.stake'),
      this.getText(resolverAddress, node, 'tee.active'),
    ])

    return {
      name: nodeName.replace('.tee.jeju', '').replace('.tee', ''),
      fullName,
      operator,
      endpoint: endpoint || '',
      publicKey: (publicKey as Hex) || '0x',
      attestationType: attestationType || 'dstack',
      supportedProviders: supportedProviders?.split(',').filter(Boolean) || [],
      stake: BigInt(stake || '0'),
      active: active !== 'false',
    }
  }

  async isAvailable(name: string): Promise<boolean> {
    const exists = await this.client.readContract({
      address: this.registryAddress,
      abi: JNS_REGISTRY_ABI,
      functionName: 'recordExists',
      args: [namehash(name)],
    })
    return !exists
  }

  async getResolver(node: Hex): Promise<Address | null> {
    const resolver = await this.client.readContract({
      address: this.registryAddress,
      abi: JNS_REGISTRY_ABI,
      functionName: 'resolver',
      args: [node],
    })
    return resolver === ZERO_ADDRESS ? null : resolver
  }

  async getRecords(name: string): Promise<JNSRecords> {
    const node = namehash(name)
    const resolverAddress = await this.getResolver(node)
    if (!resolverAddress) return {}

    const [address, avatar, url, description, oauth3Endpoint, a2aEndpoint] =
      await Promise.all([
        this.client
          .readContract({
            address: resolverAddress,
            abi: JNS_RESOLVER_ABI,
            functionName: 'addr',
            args: [node],
          })
          .catch(() => null),
        this.getText(resolverAddress, node, 'avatar'),
        this.getText(resolverAddress, node, 'url'),
        this.getText(resolverAddress, node, 'description'),
        this.getText(resolverAddress, node, 'app.endpoint'),
        this.getText(resolverAddress, node, 'app.a2a'),
      ])

    return {
      address: address || undefined,
      avatar: avatar || undefined,
      url: url || undefined,
      description: description || undefined,
      oauth3Endpoint: oauth3Endpoint || undefined,
      a2aEndpoint: a2aEndpoint || undefined,
    }
  }

  async reverseResolve(address: Address): Promise<string | null> {
    const reverseNode = namehash(
      `${address.toLowerCase().slice(2)}.addr.reverse`,
    )
    const resolverAddress = await this.getResolver(reverseNode)
    if (!resolverAddress) return null

    return this.client
      .readContract({
        address: resolverAddress,
        abi: JNS_RESOLVER_ABI,
        functionName: 'name',
        args: [reverseNode],
      })
      .catch(() => null)
  }

  private normalizeAppName(name: string): string {
    if (name.endsWith('.oauth3.jeju')) return name
    if (name.endsWith('.oauth3')) return `${name}.jeju`
    return `${name}.oauth3.jeju`
  }

  private normalizeIdentityName(name: string): string {
    if (name.endsWith('.id.jeju')) return name
    if (name.endsWith('.id')) return `${name}.jeju`
    return `${name}.id.jeju`
  }

  private normalizeTEENodeName(name: string): string {
    if (name.endsWith('.tee.jeju')) return name
    if (name.endsWith('.tee')) return `${name}.jeju`
    return `${name}.tee.jeju`
  }

  private async getText(
    resolverAddress: Address,
    node: Hex,
    key: string,
  ): Promise<string | null> {
    return this.client
      .readContract({
        address: resolverAddress,
        abi: JNS_RESOLVER_ABI,
        functionName: 'text',
        args: [node, key],
      })
      .catch((error: Error) => {
        // Only swallow "no text record" errors, rethrow connection/other errors
        if (
          error.message.includes('reverted') ||
          error.message.includes('empty')
        ) {
          return null
        }
        throw error
      })
  }

  getClient(): PublicClient {
    return this.client
  }
  getRegistryAddress(): Address {
    return this.registryAddress
  }
  getDefaultResolverAddress(): Address {
    return this.defaultResolverAddress
  }
}

let instance: OAuth3JNSService | null = null

export function createOAuth3JNSService(
  config: OAuth3JNSConfig = {},
): OAuth3JNSService {
  if (!instance) instance = new OAuth3JNSService(config)
  return instance
}

export function resetOAuth3JNSService(): void {
  instance = null
}

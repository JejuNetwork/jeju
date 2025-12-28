import { getRpcUrl } from '@jejunetwork/config'
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  type Hex,
  http,
  labelhash,
  namehash,
  type PublicClient,
} from 'viem'
import { getChainContracts, getNetworkRpcUrl } from '../../sdk/chains'
import { isSupportedChainId, rpcService } from '../rpc'

const JNS_REGISTRAR_ABI = [
  {
    inputs: [{ name: 'name', type: 'string' }],
    name: 'available',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    name: 'rentPrice',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'duration', type: 'uint256' },
    ],
    name: 'register',
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    name: 'renew',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ name: 'labelhash', type: 'bytes32' }],
    name: 'nameExpires',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const JNS_RESOLVER_ABI = [
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'addr',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    name: 'text',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'a', type: 'address' },
    ],
    name: 'setAddr',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    name: 'setText',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

const JNS_REVERSE_ABI = [
  {
    inputs: [{ name: 'name', type: 'string' }],
    name: 'setName',
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'addr', type: 'address' }],
    name: 'node',
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'pure',
    type: 'function',
  },
] as const

export interface JNSName {
  name: string
  node: Hex
  owner: Address
  resolver: Address
  expiresAt: number
  address?: Address
  description?: string
  avatar?: string
}

export interface JNSRegistrationParams {
  name: string
  owner: Address
  duration: number // seconds
  resolverData?: Hex[]
}

export interface JNSPricing {
  name: string
  duration: number
  price: bigint
  pricePerYear: bigint
  available: boolean
}

// Default to the network L2 for JNS
const DEFAULT_JNS_CHAIN = 420691
const ONE_YEAR = 365 * 24 * 60 * 60

export class JNSService {
  private chainId: number
  private clientCache = new Map<number, PublicClient>()

  constructor(chainId: number = DEFAULT_JNS_CHAIN) {
    this.chainId = chainId
  }

  private getContracts() {
    const contracts = getChainContracts(this.chainId)
    return {
      registrar: contracts.jnsRegistrar,
      resolver: contracts.jnsResolver,
      reverse: contracts.jnsReverseRegistrar,
    }
  }

  private getClient(): PublicClient {
    if (isSupportedChainId(this.chainId)) {
      return rpcService.getClient(this.chainId)
    }
    const cached = this.clientCache.get(this.chainId)
    if (cached) {
      return cached
    }
    const rpcUrl = getNetworkRpcUrl(this.chainId) ?? getRpcUrl()
    const client = createPublicClient({ transport: http(rpcUrl) })
    this.clientCache.set(this.chainId, client)
    return client
  }

  /**
   * Check if a name is available for registration
   */
  async isAvailable(name: string): Promise<boolean> {
    const { registrar } = this.getContracts()
    if (!registrar) return false

    const client = this.getClient()
    return client.readContract({
      address: registrar,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'available',
      args: [name],
    })
  }

  /**
   * Get registration pricing for a name
   */
  async getPrice(name: string, durationYears: number = 1): Promise<JNSPricing> {
    const { registrar } = this.getContracts()
    const duration = durationYears * ONE_YEAR

    if (!registrar) {
      throw new Error(
        `JNS registrar not configured for chain ${this.chainId}. ` +
          `Cannot get pricing. Deploy JNS contracts and update chainContracts.`,
      )
    }

    const client = this.getClient()
    const [available, price] = await Promise.all([
      this.isAvailable(name),
      client.readContract({
        address: registrar,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'rentPrice',
        args: [name, BigInt(duration)],
      }),
    ])

    return {
      name,
      duration,
      price,
      pricePerYear: price / BigInt(durationYears),
      available,
    }
  }

  /**
   * Build registration transaction
   */
  buildRegisterTx(
    params: JNSRegistrationParams,
  ): { to: Address; data: Hex; value: bigint } | null {
    const { registrar } = this.getContracts()
    if (!registrar) return null

    const data = encodeFunctionData({
      abi: JNS_REGISTRAR_ABI,
      functionName: 'register',
      args: [params.name, params.owner, BigInt(params.duration)],
    })

    return { to: registrar, data, value: 0n } // Value set by caller after getPrice
  }

  /**
   * Resolve a .jeju name to an address
   */
  async resolve(name: string): Promise<Address | null> {
    const { resolver } = this.getContracts()
    if (!resolver) return null

    const fullName = name.endsWith('.jeju') ? name : `${name}.jeju`
    const node = namehash(fullName)

    const client = this.getClient()
    const address = await client.readContract({
      address: resolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'addr',
      args: [node],
    })

    return address === '0x0000000000000000000000000000000000000000'
      ? null
      : address
  }

  /**
   * Reverse resolve an address to a .jeju name
   */
  async reverseLookup(address: Address): Promise<string | null> {
    const { resolver, reverse } = this.getContracts()
    if (!resolver || !reverse) return null

    const client = this.getClient()

    // Get the reverse node for this address
    const reverseNode = await client.readContract({
      address: reverse,
      abi: JNS_REVERSE_ABI,
      functionName: 'node',
      args: [address],
    })

    // Get the name from the resolver
    const name = await client.readContract({
      address: resolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'text',
      args: [reverseNode, 'name'],
    })

    return name || null
  }

  /**
   * Get text record for a name
   */
  async getText(name: string, key: string): Promise<string | null> {
    const { resolver } = this.getContracts()
    if (!resolver) return null

    const fullName = name.endsWith('.jeju') ? name : `${name}.jeju`
    const node = namehash(fullName)

    const client = this.getClient()
    return client.readContract({
      address: resolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'text',
      args: [node, key],
    })
  }

  /**
   * Get full name info including records
   */
  async getNameInfo(name: string): Promise<JNSName | null> {
    const { registrar, resolver } = this.getContracts()
    if (!registrar || !resolver) return null

    const fullName = name.endsWith('.jeju') ? name : `${name}.jeju`
    const label = name.replace('.jeju', '')
    const node = namehash(fullName)
    const labelHash = labelhash(label)

    const client = this.getClient()

    const [address, description, avatar, expiresAt] = await Promise.all([
      this.resolve(name),
      this.getText(name, 'description'),
      this.getText(name, 'avatar'),
      client.readContract({
        address: registrar,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'nameExpires',
        args: [labelHash as Hex],
      }),
    ])

    if (!address) return null

    return {
      name: fullName,
      node,
      owner: address,
      resolver,
      expiresAt: Number(expiresAt) * 1000,
      address: address ?? undefined,
      description: description ?? undefined,
      avatar: avatar ?? undefined,
    }
  }

  /**
   * Build set primary name transaction
   */
  buildSetPrimaryNameTx(name: string): { to: Address; data: Hex } | null {
    const { reverse } = this.getContracts()
    if (!reverse) return null

    const fullName = name.endsWith('.jeju') ? name : `${name}.jeju`
    const data = encodeFunctionData({
      abi: JNS_REVERSE_ABI,
      functionName: 'setName',
      args: [fullName],
    })

    return { to: reverse, data }
  }

  /**
   * Format an address with JNS name if available
   */
  async formatAddress(address: Address): Promise<string> {
    const name = await this.reverseLookup(address)
    return name || `${address.slice(0, 6)}...${address.slice(-4)}`
  }
}

export const jnsService = new JNSService()

// Re-export gateway resolver
export {
  type JNSResolution,
  JNSResolver,
  type JNSResolverSettings,
  jnsResolver,
} from './resolver'

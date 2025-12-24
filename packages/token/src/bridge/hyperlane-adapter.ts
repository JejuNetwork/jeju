/**
 * Hyperlane cross-chain messaging and token bridging adapter for EVM chains.
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  http,
  keccak256,
  type PublicClient,
} from 'viem'
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  base,
  baseSepolia,
  bsc,
  mainnet,
  optimism,
  polygon,
  sepolia,
} from 'viem/chains'
import { getDomainId } from '../config/domains'
import type { ChainConfig, ChainId, MultisigISMConfig } from '../types'
import {
  bytes32ToAddress as toAddress,
  addressToBytes32 as toBytes32,
} from '../utils/address'

// Map EVM chain IDs to viem chains
const VIEM_CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
  137: polygon,
  56: bsc,
  43114: avalanche,
  11155111: sepolia,
  84532: baseSepolia,
  421614: arbitrumSepolia,
}

export interface WarpRouteDeployment {
  chainId: ChainId
  address: Address
  tokenType: 'native' | 'synthetic' | 'collateral'
  tokenAddress?: Address
  deployedAt: number
}

export interface CrossChainTransferParams {
  sourceChain: ChainId
  destinationChain: ChainId
  token: Address
  amount: bigint
  recipient: Address
  sender: Address
}

export interface TransferQuote {
  amount: bigint
  fee: bigint
  estimatedTime: number // seconds
  route: {
    sourceChain: ChainId
    destinationChain: ChainId
    warpRoute: Address
  }
}

// Hyperlane Adapter (EVM-only)

export class HyperlaneAdapter {
  private readonly warpRoutes: Record<ChainId, Address>
  private readonly clients: Map<number, PublicClient>

  constructor(chains: ChainConfig[], warpRoutes: Record<ChainId, Address>) {
    this.warpRoutes = warpRoutes
    this.clients = new Map()

    // Initialize EVM clients
    for (const chain of chains) {
      if (chain.chainType === 'evm' && typeof chain.chainId === 'number') {
        const viemChain = VIEM_CHAINS[chain.chainId]
        if (viemChain) {
          const client = createPublicClient({
            chain: viemChain,
            transport: http(chain.rpcUrl),
          })
          this.clients.set(chain.chainId, client)
        }
      }
    }
  }

  // Domain & Address Utilities

  /**
   * Get the Hyperlane domain ID for a chain
   */
  getDomainId(chainId: ChainId): number {
    return getDomainId(chainId)
  }

  /**
   * Convert an EVM address to bytes32 format
   */
  addressToBytes32(address: Address): Hex {
    return toBytes32(address)
  }

  /**
   * Convert bytes32 back to an EVM address
   */
  bytes32ToAddress(bytes32: Hex): Address {
    return toAddress(bytes32)
  }

  /**
   * Get the warp route address for a chain
   */
  getWarpRoute(chainId: ChainId): Address {
    const route = this.warpRoutes[chainId]
    if (!route) {
      throw new Error(`No warp route configured for chain ${chainId}`)
    }
    return route
  }

  /**
   * Get a public client for an EVM chain
   */
  getClient(chainId: ChainId): PublicClient {
    if (typeof chainId !== 'number') {
      throw new Error(`Invalid EVM chain ID: ${chainId}`)
    }
    const client = this.clients.get(chainId)
    if (!client) {
      throw new Error(`No client for chain ${chainId}`)
    }
    return client
  }

  // Warp Route Configuration

  /**
   * Generate warp route configuration for EVM deployment
   */
  generateWarpRouteConfig(
    tokenAddress: Address,
    ismConfig: MultisigISMConfig,
    isNative: boolean = false,
  ): {
    tokenType: 'native' | 'collateral'
    token: Address
    mailbox: Address
    ism: MultisigISMConfig
  } {
    return {
      tokenType: isNative ? 'native' : 'collateral',
      token: tokenAddress,
      mailbox: '0x0000000000000000000000000000000000000000' as Address, // Set per-chain
      ism: ismConfig,
    }
  }

  // Cross-Chain Transfers

  /**
   * Validate cross-chain transfer parameters
   */
  private validateTransferParams(params: CrossChainTransferParams): void {
    // Validate amount
    if (params.amount <= 0n) {
      throw new Error('Transfer amount must be positive')
    }

    // Validate addresses are valid EVM format
    const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/
    if (!evmAddressRegex.test(params.token)) {
      throw new Error(`Invalid token address: ${params.token}`)
    }
    if (!evmAddressRegex.test(params.recipient)) {
      throw new Error(`Invalid recipient address: ${params.recipient}`)
    }
    if (!evmAddressRegex.test(params.sender)) {
      throw new Error(`Invalid sender address: ${params.sender}`)
    }

    // Validate chains are supported
    if (!this.isChainSupported(params.sourceChain)) {
      throw new Error(`Source chain not supported: ${params.sourceChain}`)
    }
    if (!this.isChainSupported(params.destinationChain)) {
      throw new Error(
        `Destination chain not supported: ${params.destinationChain}`,
      )
    }

    // Validate source and destination are different
    if (params.sourceChain === params.destinationChain) {
      throw new Error('Source and destination chains must be different')
    }
  }

  /**
   * Get quote for cross-chain transfer
   */
  async getTransferQuote(
    params: CrossChainTransferParams,
  ): Promise<TransferQuote> {
    // Validate parameters before processing
    this.validateTransferParams(params)

    // Estimate interchain gas
    // In production, query Hyperlane IGP contracts
    const baseFee = 50000n // Base fee in wei
    const gasPrice = 20n * 10n ** 9n // 20 gwei
    const estimatedGas = 200000n
    const fee = baseFee + gasPrice * estimatedGas

    return {
      amount: params.amount,
      fee,
      estimatedTime: 300, // 5 minutes typical for Hyperlane
      route: {
        sourceChain: params.sourceChain,
        destinationChain: params.destinationChain,
        warpRoute: this.getWarpRoute(params.sourceChain),
      },
    }
  }

  // Utility Methods

  /**
   * Generate a deterministic deployment salt
   */
  getDeploymentSalt(symbol: string, version: number): Hex {
    const data = `${symbol}:${version}`
    return keccak256(`0x${Buffer.from(data).toString('hex')}` as Hex)
  }

  /**
   * Compute the CREATE2 address for a warp route
   */
  computeWarpRouteAddress(
    factory: Address,
    salt: Hex,
    initCodeHash: Hex,
  ): Address {
    // CREATE2 address = keccak256(0xff ++ factory ++ salt ++ keccak256(initCode))[12:]
    const data = `0xff${factory.slice(2)}${salt.slice(2)}${initCodeHash.slice(2)}`
    const hash = keccak256(data as Hex)
    return `0x${hash.slice(-40)}` as Address
  }

  /**
   * Get all configured warp routes
   */
  getAllWarpRoutes(): Map<ChainId, Address> {
    const routes = new Map<ChainId, Address>()
    for (const [chainId, address] of Object.entries(this.warpRoutes)) {
      routes.set(chainId as ChainId, address)
    }
    return routes
  }

  /**
   * Check if a chain is supported
   */
  isChainSupported(chainId: ChainId): boolean {
    return chainId in this.warpRoutes
  }
}

// Factory Function

/**
 * Create a Hyperlane adapter with default configuration
 */
export function createHyperlaneAdapter(
  chains: ChainConfig[],
  warpRoutes: Record<ChainId, Address>,
): HyperlaneAdapter {
  return new HyperlaneAdapter(chains, warpRoutes)
}

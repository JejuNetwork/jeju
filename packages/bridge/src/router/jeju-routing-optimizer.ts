/**
 * Jeju Routing Optimizer
 * Route planning for cross-chain transfers, optimizing for Jeju hub fees.
 */

import type { Address } from 'viem'

export const JEJU_CHAIN_ID = 420691
export const JEJU_TESTNET_CHAIN_ID = 420690

export const ChainId = {
  ETHEREUM: 1,
  BASE: 8453,
  BSC: 56,
  ARBITRUM: 42161,
  OPTIMISM: 10,
  JEJU: 420691,
  SEPOLIA: 11155111,
  BASE_SEPOLIA: 84532,
  BSC_TESTNET: 97,
  ARBITRUM_SEPOLIA: 421614,
  OPTIMISM_SEPOLIA: 11155420,
  JEJU_TESTNET: 420690,
  SOLANA_MAINNET: 101,
  SOLANA_DEVNET: 103,
} as const
export type ChainId = (typeof ChainId)[keyof typeof ChainId]

export interface ChainConfig {
  chainId: ChainId | number
  name: string
  network: 'mainnet' | 'testnet'
  type: 'evm' | 'solana'
  rpcUrl: string
  isJeju: boolean
  x402Supported: boolean
  stablecoins: { usdc?: Address | string; usdt?: Address | string }
}

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [ChainId.JEJU]: {
    chainId: ChainId.JEJU,
    name: 'Jeju',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://rpc.jejunetwork.org',
    isJeju: true,
    x402Supported: true,
    stablecoins: {},
  },
  [ChainId.ETHEREUM]: {
    chainId: ChainId.ETHEREUM,
    name: 'Ethereum',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://eth.llamarpc.com',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    },
  },
  [ChainId.BASE]: {
    chainId: ChainId.BASE,
    name: 'Base',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://mainnet.base.org',
    isJeju: false,
    x402Supported: true,
    stablecoins: { usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  },
  [ChainId.BSC]: {
    chainId: ChainId.BSC,
    name: 'BNB Chain',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://bsc-dataseed.bnbchain.org',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      usdt: '0x55d398326f99059fF775485246999027B3197955',
    },
  },
  [ChainId.ARBITRUM]: {
    chainId: ChainId.ARBITRUM,
    name: 'Arbitrum One',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    },
  },
  [ChainId.OPTIMISM]: {
    chainId: ChainId.OPTIMISM,
    name: 'Optimism',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://mainnet.optimism.io',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    },
  },
  [ChainId.SOLANA_MAINNET]: {
    chainId: ChainId.SOLANA_MAINNET,
    name: 'Solana',
    network: 'mainnet',
    type: 'solana',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      usdt: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    },
  },
  [ChainId.JEJU_TESTNET]: {
    chainId: ChainId.JEJU_TESTNET,
    name: 'Jeju Testnet',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://testnet-rpc.jejunetwork.org',
    isJeju: true,
    x402Supported: true,
    stablecoins: { usdc: '0x953F6516E5d2864cE7f13186B45dE418EA665EB2' },
  },
  [ChainId.SEPOLIA]: {
    chainId: ChainId.SEPOLIA,
    name: 'Sepolia',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    isJeju: false,
    x402Supported: true,
    stablecoins: { usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  },
  [ChainId.BASE_SEPOLIA]: {
    chainId: ChainId.BASE_SEPOLIA,
    name: 'Base Sepolia',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://sepolia.base.org',
    isJeju: false,
    x402Supported: true,
    stablecoins: { usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  },
  [ChainId.BSC_TESTNET]: {
    chainId: ChainId.BSC_TESTNET,
    name: 'BSC Testnet',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    isJeju: false,
    x402Supported: true,
    stablecoins: { usdt: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd' },
  },
  [ChainId.ARBITRUM_SEPOLIA]: {
    chainId: ChainId.ARBITRUM_SEPOLIA,
    name: 'Arbitrum Sepolia',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    isJeju: false,
    x402Supported: true,
    stablecoins: { usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' },
  },
  [ChainId.OPTIMISM_SEPOLIA]: {
    chainId: ChainId.OPTIMISM_SEPOLIA,
    name: 'Optimism Sepolia',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://sepolia.optimism.io',
    isJeju: false,
    x402Supported: true,
    stablecoins: { usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7' },
  },
  [ChainId.SOLANA_DEVNET]: {
    chainId: ChainId.SOLANA_DEVNET,
    name: 'Solana Devnet',
    network: 'testnet',
    type: 'solana',
    rpcUrl: 'https://api.devnet.solana.com',
    isJeju: false,
    x402Supported: true,
    stablecoins: { usdc: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' },
  },
}

export type RouteStrategy = 'direct' | 'hub' | 'multi_hop'

export interface RouteHop {
  fromChain: ChainId | number
  toChain: ChainId | number
  mechanism: 'eil' | 'zkbridge' | 'oif' | 'ccip' | 'wormhole' | 'hyperlane'
  estimatedTimeSec: number
  feeBps: number
}

export interface OptimizedRoute {
  id: string
  strategy: RouteStrategy
  hops: RouteHop[]
  totalTimeSec: number
  totalFeeBps: number
  throughJeju: boolean
  jejuRevenue: bigint
  userCost: bigint
  confidence: number
}

export interface RouteRequest {
  sourceChain: ChainId | number
  destChain: ChainId | number
  token: Address | string
  amount: bigint
  sender: Address | string
  recipient: Address | string
  preferThroughJeju?: boolean
  maxTimeSec?: number
  maxFeeBps?: number
}

export interface FeeConfig {
  protocolFeeBps: number
  solverMarginBps: number
  xlpFeeBps: number
  x402FeeBps: number
}

const DEFAULT_FEES: FeeConfig = {
  protocolFeeBps: 10,
  solverMarginBps: 5,
  xlpFeeBps: 5,
  x402FeeBps: 50,
}

interface RouteCost {
  feeBps: number
  timeSec: number
  mechanism: RouteHop['mechanism']
}

const ROUTE_COSTS: Record<string, RouteCost> = {
  evm_l2_to_l2: { feeBps: 10, timeSec: 12, mechanism: 'eil' },
  evm_to_solana: { feeBps: 20, timeSec: 60, mechanism: 'zkbridge' },
  solana_to_evm: { feeBps: 20, timeSec: 60, mechanism: 'zkbridge' },
  bsc_route: { feeBps: 30, timeSec: 600, mechanism: 'ccip' },
  oif_solver: { feeBps: 25, timeSec: 30, mechanism: 'oif' },
}

export class JejuRoutingOptimizer {
  constructor(
    private fees: FeeConfig = DEFAULT_FEES,
    private network: 'mainnet' | 'testnet' = 'testnet',
  ) {}

  async findOptimalRoutes(request: RouteRequest): Promise<OptimizedRoute[]> {
    const src = CHAIN_CONFIGS[request.sourceChain]
    const dst = CHAIN_CONFIGS[request.destChain]
    if (!src || !dst)
      throw new Error(
        `Unsupported chain: ${request.sourceChain} or ${request.destChain}`,
      )
    if (src.network !== dst.network)
      throw new Error('Cannot route between mainnet and testnet')

    const routes: OptimizedRoute[] = []
    const jejuId =
      src.network === 'mainnet' ? ChainId.JEJU : ChainId.JEJU_TESTNET

    const direct = this.buildDirectRoute(request, src, dst)
    if (direct) routes.push(direct)

    if (!src.isJeju && !dst.isJeju) {
      const hub = this.buildHubRoute(request, src, dst, jejuId)
      if (hub) routes.push(hub)
    }

    const oif = this.buildOIFRoute(request)
    if (oif) routes.push(oif)

    return this.rankRoutes(routes, request)
  }

  calculateJejuRevenue(route: OptimizedRoute, amount: bigint): bigint {
    if (!route.throughJeju)
      return (amount * BigInt(this.fees.x402FeeBps)) / 10000n
    return (
      (amount *
        BigInt(
          this.fees.protocolFeeBps +
            this.fees.xlpFeeBps +
            this.fees.solverMarginBps,
        )) /
      10000n
    )
  }

  getSupportedChains(): ChainConfig[] {
    return Object.values(CHAIN_CONFIGS).filter(
      (c) => c.network === this.network,
    )
  }

  hasDirectRoute(src: ChainId | number, dst: ChainId | number): boolean {
    const s = CHAIN_CONFIGS[src],
      d = CHAIN_CONFIGS[dst]
    if (!s || !d) return false
    return (s.type === 'evm' && d.type === 'evm') || s.type !== d.type
  }

  private buildDirectRoute(
    req: RouteRequest,
    src: ChainConfig,
    dst: ChainConfig,
  ): OptimizedRoute | null {
    const cost = this.getCost(src, dst)
    if (!cost) return null
    const throughJeju = src.isJeju || dst.isJeju
    return {
      id: `direct-${Date.now()}`,
      strategy: 'direct',
      hops: [
        {
          fromChain: req.sourceChain,
          toChain: req.destChain,
          mechanism: cost.mechanism,
          estimatedTimeSec: cost.timeSec,
          feeBps: cost.feeBps,
        },
      ],
      totalTimeSec: cost.timeSec,
      totalFeeBps: cost.feeBps,
      throughJeju,
      jejuRevenue: throughJeju
        ? (req.amount * BigInt(this.fees.protocolFeeBps)) / 10000n
        : 0n,
      userCost: (req.amount * BigInt(cost.feeBps)) / 10000n,
      confidence: 95,
    }
  }

  private buildHubRoute(
    req: RouteRequest,
    src: ChainConfig,
    dst: ChainConfig,
    jejuId: ChainId,
  ): OptimizedRoute | null {
    const c1 = this.getCost(src, CHAIN_CONFIGS[jejuId])
    const c2 = this.getCost(CHAIN_CONFIGS[jejuId], dst)
    if (!c1 || !c2) return null
    const totalFeeBps = c1.feeBps + c2.feeBps + this.fees.protocolFeeBps
    return {
      id: `hub-${Date.now()}`,
      strategy: 'hub',
      hops: [
        {
          fromChain: req.sourceChain,
          toChain: jejuId,
          mechanism: c1.mechanism,
          estimatedTimeSec: c1.timeSec,
          feeBps: c1.feeBps,
        },
        {
          fromChain: jejuId,
          toChain: req.destChain,
          mechanism: c2.mechanism,
          estimatedTimeSec: c2.timeSec,
          feeBps: c2.feeBps,
        },
      ],
      totalTimeSec: c1.timeSec + c2.timeSec,
      totalFeeBps,
      throughJeju: true,
      jejuRevenue:
        (req.amount * BigInt(this.fees.protocolFeeBps + this.fees.xlpFeeBps)) /
        10000n,
      userCost: (req.amount * BigInt(totalFeeBps)) / 10000n,
      confidence: 90,
    }
  }

  private buildOIFRoute(req: RouteRequest): OptimizedRoute {
    const cost = ROUTE_COSTS.oif_solver
    const feeBps = cost.feeBps + this.fees.solverMarginBps
    return {
      id: `oif-${Date.now()}`,
      strategy: 'direct',
      hops: [
        {
          fromChain: req.sourceChain,
          toChain: req.destChain,
          mechanism: 'oif',
          estimatedTimeSec: cost.timeSec,
          feeBps,
        },
      ],
      totalTimeSec: cost.timeSec,
      totalFeeBps: feeBps,
      throughJeju: true,
      jejuRevenue: (req.amount * BigInt(this.fees.solverMarginBps)) / 10000n,
      userCost: (req.amount * BigInt(feeBps)) / 10000n,
      confidence: 85,
    }
  }

  private getCost(src: ChainConfig, dst: ChainConfig): RouteCost | null {
    if (src.type === 'evm' && dst.type === 'evm') {
      const bscChains: ChainId[] = [ChainId.BSC, ChainId.BSC_TESTNET]
      const isBsc =
        bscChains.includes(src.chainId as ChainId) ||
        bscChains.includes(dst.chainId as ChainId)
      return isBsc ? ROUTE_COSTS.bsc_route : ROUTE_COSTS.evm_l2_to_l2
    }
    if (src.type === 'solana') return ROUTE_COSTS.solana_to_evm
    if (dst.type === 'solana') return ROUTE_COSTS.evm_to_solana
    return null
  }

  private rankRoutes(
    routes: OptimizedRoute[],
    req: RouteRequest,
  ): OptimizedRoute[] {
    return routes.sort((a, b) => {
      if (req.preferThroughJeju) {
        if (a.throughJeju !== b.throughJeju) return a.throughJeju ? -1 : 1
      }
      if (req.maxTimeSec && a.totalTimeSec !== b.totalTimeSec) {
        const aOk = a.totalTimeSec <= req.maxTimeSec
        const bOk = b.totalTimeSec <= req.maxTimeSec
        if (aOk !== bOk) return aOk ? -1 : 1
      }
      if (req.maxFeeBps && a.totalFeeBps !== b.totalFeeBps) {
        const aOk = a.totalFeeBps <= req.maxFeeBps
        const bOk = b.totalFeeBps <= req.maxFeeBps
        if (aOk !== bOk) return aOk ? -1 : 1
      }
      const scoreA =
        a.userCost > 0n
          ? (Number((a.jejuRevenue * 100n) / a.userCost) * a.confidence) / 100
          : a.confidence
      const scoreB =
        b.userCost > 0n
          ? (Number((b.jejuRevenue * 100n) / b.userCost) * b.confidence) / 100
          : b.confidence
      return scoreB - scoreA
    })
  }
}

export function createJejuRoutingOptimizer(
  fees?: Partial<FeeConfig>,
  network: 'mainnet' | 'testnet' = 'testnet',
): JejuRoutingOptimizer {
  return new JejuRoutingOptimizer({ ...DEFAULT_FEES, ...fees }, network)
}

export function isJejuChain(id: ChainId | number): boolean {
  return id === ChainId.JEJU || id === ChainId.JEJU_TESTNET
}

export function isSolanaChain(id: ChainId | number): boolean {
  return id === ChainId.SOLANA_MAINNET || id === ChainId.SOLANA_DEVNET
}

export function isBscChain(id: ChainId | number): boolean {
  return id === ChainId.BSC || id === ChainId.BSC_TESTNET
}

export function getChainConfig(id: ChainId | number): ChainConfig | undefined {
  return CHAIN_CONFIGS[id]
}

export function getStablecoinAddress(
  id: ChainId | number,
  token: 'usdc' | 'usdt',
): Address | string | undefined {
  return CHAIN_CONFIGS[id].stablecoins[token]
}

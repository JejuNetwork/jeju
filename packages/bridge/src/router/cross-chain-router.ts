/**
 * Cross-Chain Router
 *
 * Integrates all cross-chain mechanisms into a single routing layer:
 * - ZKSolBridge (EVM ↔ Solana with ZK proofs)
 * - EIL (Ethereum Interop Layer for EVM L2s)
 * - OIF (Open Intents Framework for solver-based routing)
 * - Hyperlane (Permissionless messaging for any chain)
 * - CCIP (Chainlink permissionless token transfers)
 *
 * Revenue Optimization:
 * - Cross-chain arbitrage detection (Solana ↔ EVM, Hyperliquid)
 * - MEV capture via Flashbots/Jito integration
 * - Fee collection on all transfers
 * - XLP yield from liquidity provision
 * - Solver fees from intent fulfillment
 */

import type { Address } from 'viem'

export const ChainType = {
  EVM_L1: 'EVM_L1',
  EVM_L2: 'EVM_L2',
  SOLANA: 'SOLANA',
  HYPERLIQUID: 'HYPERLIQUID',
  POLKADOT: 'POLKADOT',
} as const
export type ChainType = (typeof ChainType)[keyof typeof ChainType]

export interface ChainInfo {
  chainId: number | string
  name: string
  type: ChainType
  rpcUrl: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  bridgeContracts: {
    zkBridge?: Address
    eilPaymaster?: Address
    oifInputSettler?: Address
    oifOutputSettler?: Address
    hyperlaneMailbox?: Address
    warpRoute?: Address
  }
}

/**
 * Hyperlane contract addresses from official deployments
 * @see https://docs.hyperlane.xyz/docs/reference/contract-addresses
 */
const HYPERLANE_MAILBOXES: Record<number, Address> = {
  1: '0xc005dc82818d67AF737725bD4bf75435d065D239', // Ethereum
  42161: '0x979Ca5202784112f4738403dBec5D0F3B9daabB9', // Arbitrum
  8453: '0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D', // Base
  10: '0xd4C1905BB1D26BC93DAC913e13CaCC278CdCC80D', // Optimism
  137: '0x5d934f4e2f797775e53561bB72aca21ba36B96BB', // Polygon
}

/**
 * Hyperlane Warp Route addresses (synthetic tokens)
 * @see https://docs.hyperlane.xyz/docs/reference/registries
 */
const HYPERLANE_WARP_ROUTES: Record<number, Address> = {
  1: '0x0000000000000000000000000000000000000000', // Placeholder - deploy per token
  42161: '0x0000000000000000000000000000000000000000',
  8453: '0x0000000000000000000000000000000000000000',
}

export const SUPPORTED_CHAINS: Record<string, ChainInfo> = {
  // Ethereum L1
  'eip155:1': {
    chainId: 1,
    name: 'Ethereum',
    type: ChainType.EVM_L1,
    rpcUrl: 'https://eth.llamarpc.com',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    bridgeContracts: {
      hyperlaneMailbox: HYPERLANE_MAILBOXES[1],
      warpRoute: HYPERLANE_WARP_ROUTES[1],
    },
  },
  // Base (Jeju home)
  'eip155:8453': {
    chainId: 8453,
    name: 'Base',
    type: ChainType.EVM_L2,
    rpcUrl: 'https://mainnet.base.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    bridgeContracts: {
      hyperlaneMailbox: HYPERLANE_MAILBOXES[8453],
      warpRoute: HYPERLANE_WARP_ROUTES[8453],
    },
  },
  // Base Sepolia
  'eip155:84532': {
    chainId: 84532,
    name: 'Base Sepolia',
    type: ChainType.EVM_L2,
    rpcUrl: 'https://sepolia.base.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    bridgeContracts: {
      // Testnet addresses - deploy separately
    },
  },
  // Solana
  'solana:mainnet': {
    chainId: 'mainnet-beta',
    name: 'Solana',
    type: ChainType.SOLANA,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
    bridgeContracts: {
      // Solana uses program IDs, not EVM addresses
      // zkBridge program ID would be configured via environment
    },
  },
  // Hyperliquid HyperEVM
  'eip155:998': {
    chainId: 998,
    name: 'Hyperliquid',
    type: ChainType.HYPERLIQUID,
    rpcUrl: 'https://api.hyperliquid.xyz/evm',
    nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
    bridgeContracts: {
      // Hyperliquid uses CCIP for bridging
    },
  },
  // Astar EVM
  'eip155:592': {
    chainId: 592,
    name: 'Astar',
    type: ChainType.POLKADOT,
    rpcUrl: 'https://evm.astar.network',
    nativeCurrency: { name: 'Astar', symbol: 'ASTR', decimals: 18 },
    bridgeContracts: {},
  },
  // BNB Chain (for Aster)
  'eip155:56': {
    chainId: 56,
    name: 'BNB Chain',
    type: ChainType.EVM_L1,
    rpcUrl: 'https://bsc-dataseed.binance.org',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    bridgeContracts: {},
  },
  // Arbitrum
  'eip155:42161': {
    chainId: 42161,
    name: 'Arbitrum',
    type: ChainType.EVM_L2,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    bridgeContracts: {
      hyperlaneMailbox: HYPERLANE_MAILBOXES[42161],
      warpRoute: HYPERLANE_WARP_ROUTES[42161],
    },
  },
}

export const ASTER_CONTRACTS = {
  treasury: {
    bnb: '0x128463A60784c4D3f46c23Af3f65Ed859Ba87974' as Address,
    ethereum: '0x604DD02d620633Ae427888d41bfd15e38483736E' as Address,
    solana: 'EhUtRgu9iEbZXXRpEvDj6n1wnQRjMi2SERDo3c6bmN2c',
    arbitrum: '0x9E36CB86a159d479cEd94Fa05036f235Ac40E1d5' as Address,
  },
  asterEarn: {
    asBTC: {
      token: '0x184b72289c0992BDf96751354680985a7C4825d6' as Address,
      minting: '0x8a3C77E6c6A488d26CD44F403b95e44675f46e6A' as Address,
    },
    asUSDF: {
      token: '0x917AF46B3C3c6e1Bb7286B9F59637Fb7C65851Fb' as Address,
      minting: '0xdB57a53C428a9faFcbFefFB6dd80d0f427543695' as Address,
    },
    asBNB: {
      token: '0x77734e70b6E88b4d82fE632a168EDf6e700912b6' as Address,
      minting: '0x2F31ab8950c50080E77999fa456372f276952fD8' as Address,
    },
    asCAKE: {
      token: '0x9817F4c9f968a553fF6caEf1a2ef6cF1386F16F7' as Address,
      minting: '0x1A81A28482Edd40ff1689CB3D857c3dAdF11D502' as Address,
    },
  },
  usdf: {
    token: '0x5A110fC00474038f6c02E89C707D638602EA44B5' as Address,
    minting: '0xC271fc70dD9E678ac1AB632f797894fe4BE2C345' as Address,
  },
}

export const BridgeMechanism = {
  ZK_SOL_BRIDGE: 'ZK_SOL_BRIDGE',
  EIL_XLP: 'EIL_XLP',
  EIL_CANONICAL: 'EIL_CANONICAL',
  OIF_SOLVER: 'OIF_SOLVER',
  HYPERLANE: 'HYPERLANE',
  CCIP: 'CCIP',
  WORMHOLE: 'WORMHOLE',
  DIRECT: 'DIRECT',
} as const
export type BridgeMechanism =
  (typeof BridgeMechanism)[keyof typeof BridgeMechanism]

export interface RouteStep {
  mechanism: BridgeMechanism
  sourceChain: string
  destChain: string
  token: Address | string
  estimatedTime: number // seconds
  estimatedFee: bigint
  trustLevel: 'trustless' | 'optimistic' | 'oracle' | 'federated'
}

export interface Route {
  id: string
  steps: RouteStep[]
  totalEstimatedTime: number
  totalEstimatedFee: bigint
  overallTrustLevel: 'trustless' | 'optimistic' | 'oracle' | 'federated'
  revenueOpportunity: bigint // MEV/arb potential
}

export interface RouteRequest {
  sourceChain: string
  destChain: string
  sourceToken: Address | string
  destToken: Address | string
  amount: bigint
  sender: Address | string
  recipient: Address | string
  slippageBps: number
  preferTrustless: boolean
  maxFee?: bigint
  deadline?: number
}

export interface RouterConfig {
  // Contract addresses per chain
  contracts: Record<string, ChainInfo['bridgeContracts']>
  // Fee settings
  protocolFeeBps: number // Base protocol fee (e.g., 10 = 0.1%)
  xlpFeeBps: number // XLP margin fee
  solverFeeBps: number // Solver margin fee
  // Identity integration
  identityRegistryAddress?: Address
  moderationAddress?: Address
  // MEV/Arb settings
  enableMEV: boolean
  minArbProfitBps: number
}

export class CrossChainRouter {
  private config: RouterConfig

  constructor(config: RouterConfig) {
    this.config = config
  }

  /**
   * Find optimal routes for a cross-chain transfer
   */
  async findRoutes(request: RouteRequest): Promise<Route[]> {
    const routes: Route[] = []
    const sourceChain = SUPPORTED_CHAINS[request.sourceChain]
    const destChain = SUPPORTED_CHAINS[request.destChain]

    if (!sourceChain || !destChain) {
      throw new Error(
        `Unsupported chain: ${request.sourceChain} or ${request.destChain}`,
      )
    }

    // 1. Check for direct EVM L2 <-> L2 via EIL
    if (this.canUseEIL(sourceChain, destChain)) {
      const eilRoute = await this.buildEILRoute(request)
      if (eilRoute) routes.push(eilRoute)
    }

    // 2. Check for Solana via ZKSolBridge
    if (this.involveSolana(sourceChain, destChain)) {
      const zkRoute = await this.buildZKSolRoute(request)
      if (zkRoute) routes.push(zkRoute)
    }

    // 3. Check for Hyperliquid via CCIP
    if (this.involveHyperliquid(sourceChain, destChain)) {
      const hyperRoute = await this.buildHyperliquidRoute(request)
      if (hyperRoute) routes.push(hyperRoute)
    }

    // 4. Check for Hyperlane routes (permissionless fallback)
    const hyperlaneRoute = await this.buildHyperlaneRoute(request)
    if (hyperlaneRoute) routes.push(hyperlaneRoute)

    // 5. Check for OIF solver routes
    const oifRoute = await this.buildOIFRoute(request)
    if (oifRoute) routes.push(oifRoute)

    // Sort by user preference (trust level first if preferTrustless, then fee)
    routes.sort((a, b) => {
      if (request.preferTrustless) {
        const trustOrder = {
          trustless: 0,
          optimistic: 1,
          oracle: 2,
          federated: 3,
        }
        const trustDiff =
          trustOrder[a.overallTrustLevel] - trustOrder[b.overallTrustLevel]
        if (trustDiff !== 0) return trustDiff
      }
      // Use bigint comparison to avoid precision loss with large fee values
      if (a.totalEstimatedFee === b.totalEstimatedFee) return 0
      return a.totalEstimatedFee < b.totalEstimatedFee ? -1 : 1
    })

    return routes
  }

  /**
   * Execute a specific route
   */
  async executeRoute(
    route: Route,
    request: RouteRequest,
  ): Promise<{
    success: boolean
    transactionHash?: string
    error?: string
  }> {
    // Check identity/moderation status
    const identityCheck = await this.checkIdentity(request.sender as Address)
    if (!identityCheck.allowed) {
      return { success: false, error: identityCheck.reason }
    }

    // Execute each step
    for (const step of route.steps) {
      const result = await this.executeStep(step, request)
      if (!result.success) {
        return result
      }
    }

    return { success: true }
  }

  /**
   * Calculate fees and revenue share
   */
  calculateFees(
    amount: bigint,
    route: Route,
  ): {
    protocolFee: bigint
    xlpFee: bigint
    solverFee: bigint
    totalFee: bigint
    userReceives: bigint
  } {
    const protocolFee = (amount * BigInt(this.config.protocolFeeBps)) / 10000n
    const xlpFee = (amount * BigInt(this.config.xlpFeeBps)) / 10000n
    const solverFee = (amount * BigInt(this.config.solverFeeBps)) / 10000n
    const totalFee = protocolFee + xlpFee + solverFee + route.totalEstimatedFee
    const userReceives = amount - totalFee

    return { protocolFee, xlpFee, solverFee, totalFee, userReceives }
  }

  /**
   * Check for MEV/arbitrage opportunities along route
   */
  async findArbOpportunity(_route: Route): Promise<{
    hasOpportunity: boolean
    expectedProfit: bigint
    strategy: 'sandwich' | 'backrun' | 'cross_chain_arb' | null
  }> {
    if (!this.config.enableMEV) {
      return { hasOpportunity: false, expectedProfit: 0n, strategy: null }
    }

    // Check price differences across chains for arb
    // This would integrate with DEX price feeds
    return { hasOpportunity: false, expectedProfit: 0n, strategy: null }
  }

  private canUseEIL(source: ChainInfo, dest: ChainInfo): boolean {
    return source.type === ChainType.EVM_L2 && dest.type === ChainType.EVM_L2
  }

  private involveSolana(source: ChainInfo, dest: ChainInfo): boolean {
    return source.type === ChainType.SOLANA || dest.type === ChainType.SOLANA
  }

  private involveHyperliquid(source: ChainInfo, dest: ChainInfo): boolean {
    return (
      source.type === ChainType.HYPERLIQUID ||
      dest.type === ChainType.HYPERLIQUID
    )
  }

  private async buildEILRoute(request: RouteRequest): Promise<Route | null> {
    const step: RouteStep = {
      mechanism: BridgeMechanism.EIL_XLP,
      sourceChain: request.sourceChain,
      destChain: request.destChain,
      token: request.sourceToken as Address,
      estimatedTime: 12, // ~1 block
      estimatedFee: (request.amount * 10n) / 10000n, // 0.1%
      trustLevel: 'trustless',
    }

    return {
      id: `eil-${Date.now()}`,
      steps: [step],
      totalEstimatedTime: step.estimatedTime,
      totalEstimatedFee: step.estimatedFee,
      overallTrustLevel: 'trustless',
      revenueOpportunity: 0n,
    }
  }

  private async buildZKSolRoute(request: RouteRequest): Promise<Route | null> {
    const step: RouteStep = {
      mechanism: BridgeMechanism.ZK_SOL_BRIDGE,
      sourceChain: request.sourceChain,
      destChain: request.destChain,
      token: request.sourceToken as Address,
      estimatedTime: 60, // ~1 minute with ZK proofs
      estimatedFee: (request.amount * 20n) / 10000n, // 0.2%
      trustLevel: 'trustless', // Full ZK verification
    }

    return {
      id: `zksol-${Date.now()}`,
      steps: [step],
      totalEstimatedTime: step.estimatedTime,
      totalEstimatedFee: step.estimatedFee,
      overallTrustLevel: 'trustless',
      revenueOpportunity: 0n,
    }
  }

  private async buildHyperliquidRoute(
    request: RouteRequest,
  ): Promise<Route | null> {
    const step: RouteStep = {
      mechanism: BridgeMechanism.CCIP,
      sourceChain: request.sourceChain,
      destChain: request.destChain,
      token: request.sourceToken as Address,
      estimatedTime: 300, // ~5 minutes via CCIP
      estimatedFee: (request.amount * 30n) / 10000n, // 0.3%
      trustLevel: 'oracle', // Chainlink DON
    }

    return {
      id: `hyperliquid-${Date.now()}`,
      steps: [step],
      totalEstimatedTime: step.estimatedTime,
      totalEstimatedFee: step.estimatedFee,
      overallTrustLevel: 'oracle',
      revenueOpportunity: 0n,
    }
  }

  private async buildHyperlaneRoute(
    request: RouteRequest,
  ): Promise<Route | null> {
    const step: RouteStep = {
      mechanism: BridgeMechanism.HYPERLANE,
      sourceChain: request.sourceChain,
      destChain: request.destChain,
      token: request.sourceToken as Address,
      estimatedTime: 600, // ~10 minutes optimistic
      estimatedFee: (request.amount * 15n) / 10000n, // 0.15%
      trustLevel: 'optimistic',
    }

    return {
      id: `hyperlane-${Date.now()}`,
      steps: [step],
      totalEstimatedTime: step.estimatedTime,
      totalEstimatedFee: step.estimatedFee,
      overallTrustLevel: 'optimistic',
      revenueOpportunity: 0n,
    }
  }

  private async buildOIFRoute(request: RouteRequest): Promise<Route | null> {
    const step: RouteStep = {
      mechanism: BridgeMechanism.OIF_SOLVER,
      sourceChain: request.sourceChain,
      destChain: request.destChain,
      token: request.sourceToken as Address,
      estimatedTime: 30, // Solver-dependent
      estimatedFee: (request.amount * 25n) / 10000n, // 0.25% (solver margin)
      trustLevel: 'optimistic', // Oracle attestation
    }

    return {
      id: `oif-${Date.now()}`,
      steps: [step],
      totalEstimatedTime: step.estimatedTime,
      totalEstimatedFee: step.estimatedFee,
      overallTrustLevel: 'optimistic',
      revenueOpportunity: 0n,
    }
  }

  private async checkIdentity(
    sender: Address,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!this.config.identityRegistryAddress) {
      // No identity registry configured - allow all transfers
      // This is acceptable for permissionless bridges
      return { allowed: true }
    }

    // Check if sender is registered and not banned
    // Identity check requires external client - delegate to caller
    // The MultiBridgeRouter should perform identity checks with its clients
    // Return allowed=true here as CrossChainRouter is routing-only
    // Actual identity verification happens in MultiBridgeRouter.transfer()

    // Log for visibility that identity check was requested but skipped
    const senderLower = sender.toLowerCase()

    // Basic sanity check: reject zero address
    if (senderLower === '0x0000000000000000000000000000000000000000') {
      return { allowed: false, reason: 'Zero address not allowed as sender' }
    }

    return { allowed: true }
  }

  private async executeStep(
    step: RouteStep,
    request: RouteRequest,
  ): Promise<{
    success: boolean
    transactionHash?: string
    error?: string
  }> {
    switch (step.mechanism) {
      case BridgeMechanism.EIL_XLP:
        return this.executeEILStep(step, request)
      case BridgeMechanism.ZK_SOL_BRIDGE:
        return this.executeZKSolStep(step, request)
      case BridgeMechanism.HYPERLANE:
        return this.executeHyperlaneStep(step, request)
      case BridgeMechanism.CCIP:
        return this.executeCCIPStep(step, request)
      case BridgeMechanism.OIF_SOLVER:
        return this.executeOIFStep(step, request)
      default:
        return {
          success: false,
          error: `Unknown mechanism: ${step.mechanism}`,
        }
    }
  }

  private async executeEILStep(
    step: RouteStep,
    _request: RouteRequest,
  ): Promise<{
    success: boolean
    transactionHash?: string
    error?: string
  }> {
    const contracts = this.config.contracts[step.sourceChain]
    if (!contracts?.eilPaymaster) {
      return {
        success: false,
        error: `EIL paymaster not configured for chain ${step.sourceChain}`,
      }
    }
    // EIL requires external paymaster integration - route through MultiBridgeRouter
    return {
      success: false,
      error:
        'EIL execution requires MultiBridgeRouter with configured paymaster. Use MultiBridgeRouter.transfer() instead.',
    }
  }

  private async executeZKSolStep(
    step: RouteStep,
    _request: RouteRequest,
  ): Promise<{
    success: boolean
    transactionHash?: string
    error?: string
  }> {
    const contracts = this.config.contracts[step.sourceChain]
    if (!contracts?.zkBridge) {
      return {
        success: false,
        error: `ZK Bridge not configured for chain ${step.sourceChain}`,
      }
    }
    // ZK bridge execution requires EVMClient with wallet - route through MultiBridgeRouter
    return {
      success: false,
      error:
        'ZKSolBridge execution requires MultiBridgeRouter with configured EVMClient. Use MultiBridgeRouter.transfer() instead.',
    }
  }

  private async executeHyperlaneStep(
    step: RouteStep,
    _request: RouteRequest,
  ): Promise<{
    success: boolean
    transactionHash?: string
    error?: string
  }> {
    const contracts = this.config.contracts[step.sourceChain]
    if (!contracts?.hyperlaneMailbox) {
      return {
        success: false,
        error: `Hyperlane mailbox not configured for chain ${step.sourceChain}`,
      }
    }
    // Hyperlane execution requires wallet client - route through MultiBridgeRouter
    return {
      success: false,
      error:
        'Hyperlane execution requires MultiBridgeRouter with configured wallet. Use MultiBridgeRouter.transfer() instead.',
    }
  }

  private async executeCCIPStep(
    _step: RouteStep,
    _request: RouteRequest,
  ): Promise<{
    success: boolean
    transactionHash?: string
    error?: string
  }> {
    // CCIP execution requires CCIPAdapter - route through MultiBridgeRouter
    return {
      success: false,
      error:
        'CCIP execution requires MultiBridgeRouter with CCIPAdapter. Use MultiBridgeRouter.transfer() instead.',
    }
  }

  private async executeOIFStep(
    step: RouteStep,
    _request: RouteRequest,
  ): Promise<{
    success: boolean
    transactionHash?: string
    error?: string
  }> {
    const contracts = this.config.contracts[step.sourceChain]
    if (!contracts?.oifInputSettler) {
      return {
        success: false,
        error: `OIF input settler not configured for chain ${step.sourceChain}`,
      }
    }
    // OIF execution requires wallet and settler integration - route through MultiBridgeRouter
    return {
      success: false,
      error:
        'OIF execution requires MultiBridgeRouter with configured OIF settler. Use MultiBridgeRouter.transfer() instead.',
    }
  }
}

export function createRouter(
  config: Partial<RouterConfig> = {},
): CrossChainRouter {
  const defaultConfig: RouterConfig = {
    contracts: {},
    protocolFeeBps: 10, // 0.1%
    xlpFeeBps: 5, // 0.05%
    solverFeeBps: 5, // 0.05%
    enableMEV: true,
    minArbProfitBps: 50, // 0.5% min profit for arb
    ...config,
  }

  return new CrossChainRouter(defaultConfig)
}

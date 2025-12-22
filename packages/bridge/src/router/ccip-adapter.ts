/**
 * Chainlink CCIP Adapter for Permissionless Token Transfers
 *
 * CCIP (Cross-Chain Interoperability Protocol) is Chainlink's permissionless
 * cross-chain messaging protocol. Key features:
 *
 * 1. Token Transfers: Native support for ERC-20 tokens across chains
 * 2. Arbitrary Messaging: Send any data cross-chain
 * 3. Programmable Token Transfers: Tokens + data in one tx
 * 4. Permissionless: No need to register tokens (use BurnMint or LockRelease pools)
 *
 * Supported Chains (CCIP v1.5):
 * - Ethereum, Arbitrum, Optimism, Base, Polygon, Avalanche, BNB Chain
 * - Hyperliquid (via custom integration)
 *
 * Revenue Opportunities:
 * - CCIP doesn't charge % fees, only gas + LINK for DON
 * - We can add protocol fee on top
 * - Arbitrage between CCIP and other bridges
 */

import type { PublicClient, WalletClient } from 'viem'
import { type Address, type Hex, parseAbi } from 'viem'
import { createLogger } from '../utils/logger.js'

const log = createLogger('ccip')

export const CCIP_CHAIN_SELECTORS: Record<number, bigint> = {
  1: 5009297550715157269n, // Ethereum
  42161: 4949039107694359620n, // Arbitrum One
  10: 3734403246176062136n, // Optimism
  8453: 15971525489660198786n, // Base
  137: 4051577828743386545n, // Polygon
  43114: 6433500567565415381n, // Avalanche
  56: 11344663589394136015n, // BNB Chain
  998: 0n, // Hyperliquid (custom - needs deployment)
  592: 0n, // Astar (custom - needs deployment)
}

export const CCIP_ROUTERS: Record<number, Address> = {
  1: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D', // Ethereum
  42161: '0x141fa059441E0ca23ce184B6A78bafD2A517DdE8', // Arbitrum One
  10: '0x3206695CaE29952f4b0c22a169725a865bc8Ce0f', // Optimism
  8453: '0x881e3A65B4d4a04dD529061dd0071cf975F58bCD', // Base
  137: '0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe', // Polygon
  43114: '0xF4c7E640EdA248ef95972845a62bdC74237805dB', // Avalanche
  56: '0x34B03Cb9086d7D758AC55af71584F81A598759FE', // BNB Chain
}

export const CCIP_LINK_TOKEN: Record<number, Address> = {
  1: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  42161: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4',
  10: '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6',
  8453: '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196',
  137: '0xb0897686c545045aFc77CF20eC7A532E3120E0F1',
  43114: '0x5947BB275c521040051D82396192181b413227A3',
  56: '0x404460C6A5EdE2D891e8297795264fDe62ADBB75',
}

const CCIP_ROUTER_ABI = parseAbi([
  // Token transfer with data
  'function ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) external payable returns (bytes32 messageId)',
  // Get fee estimate
  'function getFee(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) external view returns (uint256)',
  // Check if chain is supported
  'function isChainSupported(uint64 chainSelector) external view returns (bool)',
  // Get supported tokens
  'function getSupportedTokens(uint64 chainSelector) external view returns (address[])',
])

export interface CCIPMessage {
  receiver: Hex
  data: Hex
  tokenAmounts: Array<{ token: Address; amount: bigint }>
  feeToken: Address
  extraArgs: Hex
}

export interface CCIPTransferRequest {
  sourceChainId: number
  destChainId: number
  token: Address
  amount: bigint
  recipient: Address
  data?: Hex
  payInLink?: boolean
  gasLimit?: bigint
}

export interface CCIPTransferResult {
  messageId: Hex
  fee: bigint
  feeToken: Address
  estimatedTime: number
}

export interface CCIPTokenPool {
  address: Address
  token: Address
  type: 'lock_release' | 'burn_mint'
  supportedChains: number[]
}

export class CCIPAdapter {
  private publicClients: Map<number, PublicClient> = new Map()
  private walletClients: Map<number, WalletClient> = new Map()
  private tokenPools: Map<string, CCIPTokenPool> = new Map() // "chainId-token" -> pool

  /**
   * Register a chain with its clients
   */
  registerChain(
    chainId: number,
    publicClient: PublicClient,
    walletClient?: WalletClient,
  ): void {
    this.publicClients.set(chainId, publicClient)
    if (walletClient) {
      this.walletClients.set(chainId, walletClient)
    }
  }

  /**
   * Check if a route is supported
   */
  async isRouteSupported(
    sourceChainId: number,
    destChainId: number,
  ): Promise<boolean> {
    const sourceSelector = CCIP_CHAIN_SELECTORS[sourceChainId]
    const destSelector = CCIP_CHAIN_SELECTORS[destChainId]

    if (!sourceSelector || !destSelector) return false

    const router = CCIP_ROUTERS[sourceChainId]
    if (!router) return false

    const client = this.publicClients.get(sourceChainId)
    if (!client) return false

    return client.readContract({
      address: router,
      abi: CCIP_ROUTER_ABI,
      functionName: 'isChainSupported',
      args: [destSelector],
    })
  }

  /**
   * Get supported tokens for a route
   */
  async getSupportedTokens(
    sourceChainId: number,
    destChainId: number,
  ): Promise<Address[]> {
    const destSelector = CCIP_CHAIN_SELECTORS[destChainId]
    if (!destSelector) return []

    const router = CCIP_ROUTERS[sourceChainId]
    if (!router) return []

    const client = this.publicClients.get(sourceChainId)
    if (!client) return []

    const tokens = (await client.readContract({
      address: router,
      abi: CCIP_ROUTER_ABI,
      functionName: 'getSupportedTokens',
      args: [destSelector],
    })) as readonly Address[]

    return [...tokens]
  }

  /**
   * Estimate fee for a transfer
   */
  async estimateFee(
    request: CCIPTransferRequest,
  ): Promise<{ nativeFee: bigint; linkFee: bigint }> {
    const destSelector = CCIP_CHAIN_SELECTORS[request.destChainId]
    if (!destSelector)
      throw new Error(`Unsupported destination chain: ${request.destChainId}`)

    const router = CCIP_ROUTERS[request.sourceChainId]
    if (!router)
      throw new Error(`No CCIP router on chain: ${request.sourceChainId}`)

    const client = this.publicClients.get(request.sourceChainId)
    if (!client)
      throw new Error(`No client for chain: ${request.sourceChainId}`)

    const linkToken = CCIP_LINK_TOKEN[request.sourceChainId]

    // Build message
    const data = request.data ?? '0x' // data is optional for simple transfers
    const gasLimit = request.gasLimit ?? 200000n // default gas limit
    const message: CCIPMessage = {
      receiver: request.recipient as Hex,
      data,
      tokenAmounts: [{ token: request.token, amount: request.amount }],
      feeToken: '0x0000000000000000000000000000000000000000', // Native for first estimate
      extraArgs: this.encodeExtraArgs(gasLimit),
    }

    const nativeFee = (await client.readContract({
      address: router,
      abi: CCIP_ROUTER_ABI,
      functionName: 'getFee',
      args: [
        destSelector,
        {
          receiver: message.receiver,
          data: message.data,
          tokenAmounts: message.tokenAmounts as readonly {
            token: Address
            amount: bigint
          }[],
          feeToken: message.feeToken,
          extraArgs: message.extraArgs,
        },
      ],
    })) as bigint

    const linkFee = (await client.readContract({
      address: router,
      abi: CCIP_ROUTER_ABI,
      functionName: 'getFee',
      args: [
        destSelector,
        {
          receiver: message.receiver,
          data: message.data,
          tokenAmounts: message.tokenAmounts as readonly {
            token: Address
            amount: bigint
          }[],
          feeToken: linkToken,
          extraArgs: message.extraArgs,
        },
      ],
    })) as bigint

    return { nativeFee, linkFee }
  }

  /**
   * Execute a CCIP transfer
   */
  async transfer(request: CCIPTransferRequest): Promise<CCIPTransferResult> {
    const destSelector = CCIP_CHAIN_SELECTORS[request.destChainId]
    if (!destSelector)
      throw new Error(`Unsupported destination chain: ${request.destChainId}`)

    const router = CCIP_ROUTERS[request.sourceChainId]
    if (!router)
      throw new Error(`No CCIP router on chain: ${request.sourceChainId}`)

    const walletClient = this.walletClients.get(request.sourceChainId)
    if (!walletClient)
      throw new Error(`No wallet client for chain: ${request.sourceChainId}`)

    const linkToken = CCIP_LINK_TOKEN[request.sourceChainId]
    const feeToken = request.payInLink
      ? linkToken
      : ('0x0000000000000000000000000000000000000000' as Address)

    // Build message
    const transferData = request.data ?? '0x' // data is optional
    const transferGasLimit = request.gasLimit ?? 200000n // default gas limit
    const message: CCIPMessage = {
      receiver: request.recipient as Hex,
      data: transferData,
      tokenAmounts: [{ token: request.token, amount: request.amount }],
      feeToken,
      extraArgs: this.encodeExtraArgs(transferGasLimit),
    }

    const publicClient = this.publicClients.get(request.sourceChainId)
    if (!publicClient) throw new Error('No public client')

    const messageForContract = {
      receiver: message.receiver,
      data: message.data,
      tokenAmounts: message.tokenAmounts as readonly {
        token: Address
        amount: bigint
      }[],
      feeToken: message.feeToken,
      extraArgs: message.extraArgs,
    }

    const fee = (await publicClient.readContract({
      address: router,
      abi: CCIP_ROUTER_ABI,
      functionName: 'getFee',
      args: [destSelector, messageForContract],
    })) as bigint

    const account = walletClient.account
    if (!account) throw new Error('Wallet client has no account')

    const hash = await walletClient.writeContract({
      chain: null,
      account,
      address: router,
      abi: CCIP_ROUTER_ABI,
      functionName: 'ccipSend',
      args: [destSelector, messageForContract],
      value: request.payInLink ? 0n : fee,
    })

    // Estimate time based on destination
    const estimatedTime = this.getEstimatedTime(request.destChainId)

    return {
      messageId: hash,
      fee,
      feeToken,
      estimatedTime,
    }
  }

  /**
   * Deploy a permissionless token pool
   *
   * This is how you add support for new tokens without Chainlink approval:
   * 1. Deploy a BurnMint or LockRelease pool on each chain
   * 2. Configure remote chains in each pool
   * 3. Token is now CCIP-enabled
   */
  async deployTokenPool(params: {
    chainId: number
    token: Address
    poolType: 'burn_mint' | 'lock_release'
    remoteChains: number[]
    remotePools: Record<number, Address>
  }): Promise<Address> {
    const walletClient = this.walletClients.get(params.chainId)
    if (!walletClient)
      throw new Error(`No wallet client for chain ${params.chainId}`)

    const publicClient = this.publicClients.get(params.chainId)
    if (!publicClient)
      throw new Error(`No public client for chain ${params.chainId}`)

    const router = CCIP_ROUTERS[params.chainId]
    if (!router) throw new Error(`No CCIP router on chain ${params.chainId}`)

    log.info('Deploying pool', {
      poolType: params.poolType,
      token: params.token,
      chainId: params.chainId,
    })

    // Pool deployment ABI - simplified version of Chainlink's TokenPool
    const POOL_DEPLOY_ABI = parseAbi([
      'constructor(address token, address[] allowList, address rmnProxy, address router)',
      'function applyChainUpdates(uint64[] memory remoteChainSelectorsToRemove, (uint64 remoteChainSelector, bool allowed, bytes remotePoolAddress, bytes remoteTokenAddress, (bool isEnabled, uint128 capacity, uint128 rate) outboundRateLimiterConfig, (bool isEnabled, uint128 capacity, uint128 rate) inboundRateLimiterConfig)[] memory chainsToAdd) external',
    ])

    // Convert remote chains to CCIP selectors and pool configs
    const chainUpdates = params.remoteChains.map((chainId) => {
      const selector = CCIP_CHAIN_SELECTORS[chainId]
      if (!selector) throw new Error(`No CCIP selector for chain ${chainId}`)

      const remotePool = params.remotePools[chainId]
      if (!remotePool)
        throw new Error(`No remote pool address for chain ${chainId}`)

      return {
        remoteChainSelector: selector,
        allowed: true,
        remotePoolAddress: remotePool as Hex,
        remoteTokenAddress: params.token as Hex,
        outboundRateLimiterConfig: { isEnabled: false, capacity: 0n, rate: 0n },
        inboundRateLimiterConfig: { isEnabled: false, capacity: 0n, rate: 0n },
      }
    })

    // Deploy pool contract using CREATE2 for deterministic addresses
    // The actual bytecode would come from compiled Chainlink pool contracts
    // For production, use @chainlink/contracts-ccip package
    const poolBytecodeEnvKey =
      params.poolType === 'burn_mint'
        ? 'CCIP_BURN_MINT_POOL_BYTECODE'
        : 'CCIP_LOCK_RELEASE_POOL_BYTECODE'

    const poolBytecode = process.env[poolBytecodeEnvKey]
    if (!poolBytecode) {
      throw new Error(
        `${poolBytecodeEnvKey} not configured. Deploy using @chainlink/contracts-ccip or ` +
          `set bytecode from: https://github.com/smartcontractkit/ccip/tree/main/contracts/src/v0.8/ccip/pools`,
      )
    }

    // RMN proxy address (required by CCIP v1.5+)
    const rmnProxyEnvKey = `CCIP_RMN_PROXY_${params.chainId}`
    const rmnProxy = process.env[rmnProxyEnvKey]
    if (!rmnProxy) {
      throw new Error(
        `${rmnProxyEnvKey} not configured. Required for CCIP v1.5+. ` +
          `Find the RMN proxy for chain ${params.chainId} at: https://docs.chain.link/ccip/supported-networks`,
      )
    }

    const account = walletClient.account
    if (!account) throw new Error('Wallet client has no account')

    const constructorArgs: readonly [
      Address,
      readonly Address[],
      Address,
      Address,
    ] = [params.token, [], rmnProxy as Address, router]

    const hash = await walletClient.deployContract({
      chain: null,
      account,
      abi: POOL_DEPLOY_ABI,
      bytecode: poolBytecode as Hex,
      args: constructorArgs,
    })

    // Wait for deployment
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    const poolAddress = receipt.contractAddress

    if (!poolAddress) {
      throw new Error('Pool deployment failed - no contract address in receipt')
    }

    log.info('Pool deployed', { poolAddress })

    if (chainUpdates.length > 0) {
      const configHash = await walletClient.writeContract({
        chain: null,
        account,
        address: poolAddress,
        abi: POOL_DEPLOY_ABI,
        functionName: 'applyChainUpdates',
        args: [[] as readonly bigint[], chainUpdates],
      })
      await publicClient.waitForTransactionReceipt({ hash: configHash })
      log.info('Configured remote chains', { count: chainUpdates.length })
    }

    // Cache the pool
    this.tokenPools.set(`${params.chainId}-${params.token}`, {
      address: poolAddress,
      token: params.token,
      type: params.poolType,
      supportedChains: params.remoteChains,
    })

    return poolAddress
  }

  private encodeExtraArgs(gasLimit: bigint): Hex {
    // CCIP extraArgs format: version (2 bytes) + encoded args
    // EVMExtraArgsV1: gasLimit only
    const EVM_EXTRA_ARGS_V1 = '0x97a657c9'
    return `${EVM_EXTRA_ARGS_V1}${gasLimit.toString(16).padStart(64, '0')}` as Hex
  }

  private getEstimatedTime(destChainId: number): number {
    // CCIP finality times vary by chain
    const times: Record<number, number> = {
      1: 1200, // Ethereum: ~20 min
      42161: 600, // Arbitrum: ~10 min
      10: 600, // Optimism: ~10 min
      8453: 600, // Base: ~10 min
      137: 300, // Polygon: ~5 min
      43114: 120, // Avalanche: ~2 min
      56: 180, // BNB: ~3 min
      998: 600, // Hyperliquid: ~10 min (estimated)
    }
    // Default to 10 minutes for unknown chains (conservative estimate)
    return times[destChainId] ?? 600
  }
}

export function createCCIPAdapter(): CCIPAdapter {
  return new CCIPAdapter()
}

/**
 * Revenue strategies using CCIP:
 *
 * 1. Protocol Fee Layer
 *    - Add 0.1-0.3% fee on top of CCIP transfers
 *    - Use our CrossChainRouter to intercept and add fees
 *
 * 2. CCIP vs Other Bridge Arbitrage
 *    - Monitor price differences between CCIP and Hyperlane/Wormhole
 *    - If token is cheaper on one bridge, arbitrage the difference
 *
 * 3. Custom Token Pools
 *    - Deploy our own BurnMint pools for tokens we control
 *    - Earn yield on locked tokens (LockRelease pools)
 *
 * 4. Solver Competition
 *    - Act as CCIP filler for OIF intents that use CCIP backend
 *    - Compete on speed and gas efficiency
 *
 * 5. Gas Optimization
 *    - Batch multiple CCIP messages
 *    - Use LINK payments when cheaper than native
 */

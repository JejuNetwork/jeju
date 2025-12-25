/**
 * Simulation A2A Interface
 *
 * Provides A2A-compatible interface for agents to interact with simulation.
 * Wraps SimulationEngine to make it behave like a real game server.
 *
 * Agents can use standard A2A methods like:
 * - a2a.getPredictions
 * - a2a.buyShares
 * - a2a.openPosition
 * - a2a.getFeed
 * etc.
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import type { SimulationEngine } from './simulation-engine'
import type { SimulationEngineState } from './types'

/**
 * A2A method parameter types
 */
export type A2AMethodParams =
  | BuySharesParams
  | SellSharesParams
  | OpenPositionParams
  | ClosePositionParams
  | CreatePostParams
  | JoinGroupParams
  | { status?: string; limit?: number; offset?: number }
  | Record<string, string | number | boolean | undefined>

/**
 * Buy shares result
 */
export interface BuySharesResult {
  shares: number
  avgPrice: number
  positionId: string
}

/**
 * Sell shares result
 */
export interface SellSharesResult {
  proceeds: number
}

/**
 * Open position result
 */
export interface OpenPositionResult {
  positionId: string
  entryPrice: number
}

/**
 * Close position result
 */
export interface ClosePositionResult {
  pnl: number
  exitPrice: number
}

/**
 * Create post result
 */
export interface CreatePostResult {
  postId: string
}

/**
 * Create comment result
 */
export interface CreateCommentResult {
  commentId: string
}

/**
 * Join group result
 */
export interface JoinGroupResult {
  success: boolean
}

/**
 * Portfolio position for simulation
 */
export interface PortfolioPosition {
  id: string
  marketId?: string
  ticker?: string
  side: string
  size: number
  entryPrice: number
  currentPrice?: number
  pnl?: number
}

/**
 * Portfolio result
 */
export interface PortfolioResult {
  balance: number
  positions: PortfolioPosition[]
  pnl: number
}

/**
 * Dashboard result
 */
export interface DashboardResult {
  balance: number
  reputation: number
  totalPnl: number
  activePositions: number
}

/**
 * Trending tag entry
 */
export interface TrendingTagEntry {
  tag: string
  count: number
  trend: string
}

/**
 * Chat entry with member count
 */
export interface ChatEntry {
  id: string
  name: string
  memberCount: number
  messageCount: number
  lastActivity: number
  invited: boolean
  messages: Array<{
    id: string
    authorId: string
    authorName: string
    content: string
    timestamp: number
  }>
}

/**
 * Prediction market without resolved field
 */
interface PredictionMarketResponse {
  id: string
  question: string
  yesShares: number
  noShares: number
  yesPrice: number
  noPrice: number
  liquidity: number
  totalVolume: number
  createdAt: number
  resolveAt: number
}

/**
 * Perpetual market response
 */
interface PerpetualMarketResponse {
  ticker: string
  price: number
  priceChange24h?: number
  volume24h: number
  openInterest: number
  fundingRate: number
  nextFundingTime?: number
}

/**
 * Feed post response
 */
interface FeedPostResponse {
  id: string
  authorId: string
  authorName: string
  content: string
  createdAt: number
  likes: number
  comments: number
  marketId?: string
}

/** Response from a2a.getPredictions */
interface PredictionsResponse {
  predictions: PredictionMarketResponse[]
}

/** Response from a2a.getPerpetuals */
interface PerpetualsResponse {
  perpetuals: PerpetualMarketResponse[]
}

/** Response from a2a.getFeed */
interface FeedResponse {
  posts: FeedPostResponse[]
}

/**
 * Union type for all A2A response types
 */
export type A2AResponse =
  | PredictionsResponse
  | BuySharesResult
  | SellSharesResult
  | PerpetualsResponse
  | OpenPositionResult
  | ClosePositionResult
  | FeedResponse
  | CreatePostResult
  | CreateCommentResult
  | { chats: ChatEntry[] }
  | JoinGroupResult
  | { balance: number }
  | PortfolioResult
  | {
      predictionPositions: PortfolioPosition[]
      perpPositions: PortfolioPosition[]
    }
  | DashboardResult
  | { tags: TrendingTagEntry[] }

/**
 * Parameters for buying prediction market shares
 */
export interface BuySharesParams {
  /** Market ID to buy shares in */
  marketId: string
  /** Outcome to buy (YES or NO) */
  outcome: 'YES' | 'NO'
  /** Amount to invest */
  amount: number
}

/**
 * Parameters for selling prediction market shares
 */
interface SellSharesParams {
  /** Market ID to sell shares from */
  marketId: string
  /** Number of shares to sell */
  shares: number
}

/**
 * Parameters for opening a perpetual position
 */
interface OpenPositionParams {
  /** Ticker symbol */
  ticker: string
  /** Position side (LONG or SHORT) */
  side: 'LONG' | 'SHORT'
  /** Position size */
  size: number
  /** Leverage multiplier */
  leverage: number
}

/**
 * Parameters for closing a perpetual position
 */
interface ClosePositionParams {
  /** Position ID to close */
  positionId: string
}

/**
 * Parameters for creating a post
 */
interface CreatePostParams {
  /** Post content */
  content: string
  /** Optional market ID to associate with post */
  marketId?: string
}

/**
 * Parameters for joining a group chat
 */
interface JoinGroupParams {
  /** Group chat ID */
  groupId: string
}

/**
 * Convert a side string to uppercase LONG/SHORT
 */
function toPositionSide(value: string): 'LONG' | 'SHORT' {
  const upper = value.toUpperCase()
  if (upper === 'LONG' || upper === 'SHORT') {
    return upper
  }
  throw new Error(`Invalid position side: ${value}`)
}

export class SimulationA2AInterface {
  private engine: SimulationEngine
  private agentId: string

  /**
   * Create a new SimulationA2AInterface instance
   *
   * @param engine - Simulation engine to wrap
   * @param agentId - Agent identifier for this interface instance
   */
  constructor(engine: SimulationEngine, agentId: string) {
    this.engine = engine
    this.agentId = agentId
  }

  /**
   * Send A2A request (JSON-RPC style)
   *
   * Routes requests to appropriate handler methods based on method name.
   * All methods are logged and timed.
   */
  async sendRequest(
    method: string,
    params?: A2AMethodParams,
  ): Promise<A2AResponse> {
    logger.debug(`Simulation A2A request: ${method}`)

    const actionStart = Date.now()

    let result: A2AResponse

    // Route to appropriate handler
    switch (method) {
      case 'a2a.getPredictions':
        result = this.handleGetPredictions()
        break

      case 'a2a.buyShares':
        result = await this.handleBuyShares(params)
        break

      case 'a2a.sellShares':
        result = await this.handleSellShares(params)
        break

      case 'a2a.getPerpetuals':
        result = this.handleGetPerpetuals()
        break

      case 'a2a.openPosition':
        result = await this.handleOpenPosition(params)
        break

      case 'a2a.closePosition':
        result = await this.handleClosePosition(params)
        break

      case 'a2a.getFeed':
        result = this.handleGetFeed()
        break

      case 'a2a.createPost':
        result = await this.handleCreatePost(params)
        break

      case 'a2a.getChats':
        result = this.handleGetChats()
        break

      case 'a2a.joinGroup':
        result = await this.handleJoinGroup(params)
        break

      case 'a2a.getBalance':
        result = this.handleGetBalance()
        break

      case 'a2a.getPortfolio':
        result = this.handleGetPortfolio()
        break

      case 'a2a.getPositions':
        result = this.handleGetPositions()
        break

      case 'a2a.getDashboard':
        result = this.handleGetDashboard()
        break

      case 'a2a.getTrendingTags':
        result = this.handleGetTrendingTags()
        break

      default:
        throw new Error(`Unknown A2A method: ${method}`)
    }

    const duration = Date.now() - actionStart
    logger.debug('Simulation A2A response', { method, duration })

    return result
  }

  /**
   * Get prediction markets
   */
  private handleGetPredictions(): { predictions: PredictionMarketResponse[] } {
    const state: SimulationEngineState = this.engine.getState()

    const predictions = state.predictionMarkets
      .filter((m) => !m.resolved)
      .map((m) => ({
        id: m.id,
        question: m.question,
        yesShares: m.yesShares,
        noShares: m.noShares,
        yesPrice: m.yesPrice,
        noPrice: m.noPrice,
        liquidity: m.liquidity,
        totalVolume: m.totalVolume,
        createdAt: m.createdAt,
        resolveAt: m.resolveAt,
      }))

    return { predictions }
  }

  /**
   * Type guard for BuySharesParams
   */
  private isBuySharesParams(
    params: A2AMethodParams,
  ): params is BuySharesParams {
    return (
      typeof params === 'object' &&
      params !== null &&
      'marketId' in params &&
      'outcome' in params &&
      'amount' in params &&
      typeof params.marketId === 'string' &&
      (params.outcome === 'YES' || params.outcome === 'NO') &&
      typeof params.amount === 'number' &&
      params.amount > 0
    )
  }

  /**
   * Buy prediction market shares
   */
  private async handleBuyShares(
    params: A2AMethodParams | undefined,
  ): Promise<BuySharesResult> {
    if (!params || !this.isBuySharesParams(params)) {
      throw new Error(
        'Invalid params: must be an object with marketId (string), outcome ("YES" | "NO"), and amount (positive number)',
      )
    }

    // @deprecated SimulationEngine.performAction() was removed when the engine was deprecated.
    throw new Error(
      'performAction not available - SimulationEngine is deprecated',
    )
  }

  /**
   * Type guard for SellSharesParams
   */
  private isSellSharesParams(
    params: A2AMethodParams,
  ): params is SellSharesParams {
    return (
      typeof params === 'object' &&
      params !== null &&
      'marketId' in params &&
      'shares' in params &&
      typeof params.marketId === 'string' &&
      typeof params.shares === 'number' &&
      params.shares > 0
    )
  }

  /**
   * Sell prediction market shares
   */
  private async handleSellShares(
    params: A2AMethodParams | undefined,
  ): Promise<SellSharesResult> {
    if (!params || !this.isSellSharesParams(params)) {
      throw new Error(
        'Invalid params: must be an object with marketId (string) and shares (positive number)',
      )
    }

    const { marketId, shares } = params

    // Simplified: calculate proceeds based on current market price
    const state: SimulationEngineState = this.engine.getState()
    const market = state.predictionMarkets.find((m) => m.id === marketId)

    if (!market) {
      throw new Error(`Market ${marketId} not found`)
    }

    // Use average of yes and no prices as sell price
    const avgPrice = (market.yesPrice + market.noPrice) / 2
    const proceeds = shares * avgPrice

    return { proceeds }
  }

  /**
   * Get perpetual markets
   */
  private handleGetPerpetuals(): { perpetuals: PerpetualMarketResponse[] } {
    const state: SimulationEngineState = this.engine.getState()

    const perpetuals = state.perpetualMarkets.map((m) => ({
      ticker: m.ticker,
      price: m.price,
      priceChange24h: m.priceChange24h,
      volume24h: m.volume24h,
      openInterest: m.openInterest,
      fundingRate: m.fundingRate,
      nextFundingTime: m.nextFundingTime,
    }))

    return { perpetuals }
  }

  /**
   * Type guard for OpenPositionParams
   */
  private isOpenPositionParams(
    params: A2AMethodParams,
  ): params is OpenPositionParams {
    return (
      typeof params === 'object' &&
      params !== null &&
      'ticker' in params &&
      'side' in params &&
      'size' in params &&
      'leverage' in params &&
      typeof params.ticker === 'string' &&
      (params.side === 'LONG' || params.side === 'SHORT') &&
      typeof params.size === 'number' &&
      params.size > 0 &&
      typeof params.leverage === 'number' &&
      params.leverage >= 1
    )
  }

  /**
   * Open perpetual position
   */
  private async handleOpenPosition(
    params: A2AMethodParams | undefined,
  ): Promise<OpenPositionResult> {
    if (!params || !this.isOpenPositionParams(params)) {
      throw new Error(
        'Invalid params: must be an object with ticker (string), side ("LONG" | "SHORT"), size (positive number), and leverage (>= 1)',
      )
    }

    // @deprecated SimulationEngine.performAction() was removed when the engine was deprecated.
    throw new Error(
      'performAction not available - SimulationEngine is deprecated',
    )
  }

  /**
   * Type guard for ClosePositionParams
   */
  private isClosePositionParams(
    params: A2AMethodParams,
  ): params is ClosePositionParams {
    return (
      typeof params === 'object' &&
      params !== null &&
      'positionId' in params &&
      typeof params.positionId === 'string' &&
      params.positionId.length > 0
    )
  }

  /**
   * Close perpetual position
   */
  private async handleClosePosition(
    params: A2AMethodParams | undefined,
  ): Promise<ClosePositionResult> {
    if (!params || !this.isClosePositionParams(params)) {
      throw new Error(
        'Invalid params: must be an object with positionId (non-empty string)',
      )
    }

    // @deprecated SimulationEngine.performAction() was removed when the engine was deprecated.
    throw new Error(
      'performAction not available - SimulationEngine is deprecated',
    )
  }

  /**
   * Get social feed
   */
  private handleGetFeed(): { posts: FeedPostResponse[] } {
    const state: SimulationEngineState = this.engine.getState()

    const posts = (state.posts ?? [])
      .slice(-20) // Last 20 posts
      .map((p) => ({
        id: p.id,
        authorId: p.authorId,
        authorName: p.authorName,
        content: p.content,
        createdAt: p.createdAt,
        likes: p.likes,
        comments: p.comments,
        marketId: p.marketId,
      }))

    return { posts }
  }

  /**
   * Type guard for CreatePostParams
   */
  private isCreatePostParams(
    params: A2AMethodParams,
  ): params is CreatePostParams {
    return (
      typeof params === 'object' &&
      params !== null &&
      'content' in params &&
      typeof params.content === 'string' &&
      params.content.trim().length > 0 &&
      ('marketId' in params
        ? typeof params.marketId === 'string' &&
          params.marketId.trim().length > 0
        : true)
    )
  }

  /**
   * Create post
   */
  private async handleCreatePost(
    params: A2AMethodParams | undefined,
  ): Promise<CreatePostResult> {
    if (!params || !this.isCreatePostParams(params)) {
      throw new Error(
        'Invalid params: must be an object with content (non-empty string) and optional marketId (non-empty string)',
      )
    }

    // @deprecated SimulationEngine.performAction() was removed when the engine was deprecated.
    throw new Error(
      'performAction not available - SimulationEngine is deprecated',
    )
  }

  /**
   * Get group chats
   */
  private handleGetChats(): { chats: ChatEntry[] } {
    const state: SimulationEngineState = this.engine.getState()

    const chats: ChatEntry[] = (state.groupChats ?? []).map(
      (g): ChatEntry => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberIds.length,
        messageCount: g.messageCount,
        lastActivity: g.lastActivity,
        invited: g.invitedAgent ?? false,
        messages: g.messages ?? [],
      }),
    )

    return { chats }
  }

  /**
   * Type guard for JoinGroupParams
   */
  private isJoinGroupParams(
    params: A2AMethodParams,
  ): params is JoinGroupParams {
    return (
      typeof params === 'object' &&
      params !== null &&
      'groupId' in params &&
      typeof params.groupId === 'string' &&
      params.groupId.length > 0
    )
  }

  /**
   * Join group chat
   */
  private async handleJoinGroup(
    params: A2AMethodParams | undefined,
  ): Promise<JoinGroupResult> {
    if (!params || !this.isJoinGroupParams(params)) {
      throw new Error(
        'Invalid params: must be an object with groupId (non-empty string)',
      )
    }

    // @deprecated SimulationEngine.performAction() was removed when the engine was deprecated.
    throw new Error(
      'performAction not available - SimulationEngine is deprecated',
    )
  }

  /**
   * Get agent balance
   */
  private handleGetBalance(): { balance: number } {
    // Simplified: return fixed balance
    return { balance: 10000 }
  }

  /**
   * Get portfolio (balance, positions, P&L)
   */
  private handleGetPortfolio(): PortfolioResult {
    const state: SimulationEngineState = this.engine.getState()
    const agent = state.agents.find((a) => a.id === this.agentId)

    // Calculate positions from agent's state
    const positions: PortfolioPosition[] = []

    // Calculate P&L from agent's totalPnl
    const pnl = agent?.totalPnl ?? 0
    const balance = 10000 + pnl // Starting balance + P&L

    return {
      balance,
      positions,
      pnl,
    }
  }

  /**
   * Get positions (prediction market + perp positions)
   */
  private handleGetPositions(): {
    predictionPositions: PortfolioPosition[]
    perpPositions: PortfolioPosition[]
  } {
    // Return empty arrays for simulation
    // In a real benchmark, we'd track actual positions made by the agent
    return {
      predictionPositions: [],
      perpPositions: [],
    }
  }

  /**
   * Get dashboard data (balance, recent activity, etc)
   */
  private handleGetDashboard(): DashboardResult {
    const state: SimulationEngineState = this.engine.getState()
    const agent = state.agents.find((a) => a.id === this.agentId)

    const pnl = agent?.totalPnl ?? 0
    const balance = 10000 + pnl

    return {
      balance,
      reputation: 1000,
      totalPnl: pnl,
      activePositions: 0,
    }
  }

  /**
   * Get trending tags
   */
  private handleGetTrendingTags(): { tags: TrendingTagEntry[] } {
    // Return some dummy trending tags for simulation
    return {
      tags: [
        { tag: 'crypto', count: 150, trend: 'up' },
        { tag: 'ai', count: 120, trend: 'up' },
        { tag: 'markets', count: 90, trend: 'stable' },
      ],
    }
  }

  /**
   * Check if connected (always true for simulation)
   */
  isConnected(): boolean {
    return true
  }

  // ===== Wrapper methods to match A2A client interface =====

  /**
   * Buy shares in prediction market
   */
  async buyShares(
    marketId: string,
    outcome: 'YES' | 'NO',
    amount: number,
  ): Promise<BuySharesResult> {
    const result = await this.sendRequest('a2a.buyShares', {
      marketId,
      outcome,
      amount,
    })
    return result as BuySharesResult
  }

  /**
   * Sell shares from prediction market
   */
  async sellShares(
    marketId: string,
    shares: number,
  ): Promise<SellSharesResult> {
    const result = await this.sendRequest('a2a.sellShares', {
      marketId,
      shares,
    })
    return result as SellSharesResult
  }

  /**
   * Open perp position
   */
  async openPosition(
    ticker: string,
    side: 'long' | 'short',
    size: number,
    leverage: number,
  ): Promise<OpenPositionResult> {
    const result = await this.sendRequest('a2a.openPosition', {
      ticker,
      side: toPositionSide(side),
      size,
      leverage,
    })
    return result as OpenPositionResult
  }

  /**
   * Close perp position
   */
  async closePosition(positionId: string): Promise<ClosePositionResult> {
    const result = await this.sendRequest('a2a.closePosition', {
      positionId,
    })
    return result as ClosePositionResult
  }

  /**
   * Create post
   */
  async createPost(
    content: string,
    _type: string = 'post',
  ): Promise<CreatePostResult> {
    const result = await this.sendRequest('a2a.createPost', {
      content,
      marketId: undefined,
    })
    return result as CreatePostResult
  }

  /**
   * Create comment
   */
  async createComment(
    postId: string,
    content: string,
  ): Promise<CreateCommentResult> {
    const result = await this.sendRequest('a2a.createComment', {
      content,
      marketId: postId,
    })
    return result as CreateCommentResult
  }

  /**
   * Get portfolio (balance, positions, P&L)
   */
  async getPortfolio(): Promise<PortfolioResult> {
    const result = await this.sendRequest('a2a.getPortfolio')
    return result as PortfolioResult
  }

  /**
   * Get markets
   */
  async getMarkets(): Promise<{
    predictions: PredictionMarketResponse[]
    perps: PerpetualMarketResponse[]
  }> {
    const predictionsResult = await this.sendRequest('a2a.getPredictions', {
      status: 'active',
    })
    const perpetualsResult = await this.sendRequest('a2a.getPerpetuals', {})

    const predictions = predictionsResult as PredictionsResponse
    const perpetuals = perpetualsResult as PerpetualsResponse

    return {
      predictions: predictions.predictions ?? [],
      perps: perpetuals.perpetuals ?? [],
    }
  }

  /**
   * Get feed
   */
  async getFeed(limit = 20): Promise<{ posts: FeedPostResponse[] }> {
    const result = await this.sendRequest('a2a.getFeed', { limit, offset: 0 })
    return result as FeedResponse
  }
}

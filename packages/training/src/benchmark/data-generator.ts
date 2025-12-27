/**
 * Benchmark Data Generator
 *
 * Generates deterministic benchmark scenarios for agent testing.
 * Creates pre-recorded game states with known outcomes for reproducible testing.
 *
 * Supports two modes:
 * 1. Random Walk Mode (default): Prices follow random walk with drift
 * 2. Causal Simulation Mode: Hidden facts → Events → Price movements (learnable signal)
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import { SeededRandom } from './seeded-random'
import type {
  BenchmarkConfig,
  BenchmarkGameSnapshot,
  BenchmarkGameState,
  CausalEventType,
  GroundTruth,
  GroupChat,
  HiddenNarrativeFact,
  PerpetualMarket,
  Post,
  PredictionMarket,
  ScheduledCausalEvent,
  SimulatedAgent,
  Tick,
  TickEvent,
  VolatilityBucket,
} from './types'

/**
 * Narrative fact templates for causal simulation
 * Each template defines a hidden fact and its event sequence
 */
const NARRATIVE_FACT_TEMPLATES: Array<{
  factTemplate: string
  sentiment: 'positive' | 'negative'
  /** Event sequence with relative timing and volatility */
  eventSequence: Array<{
    relativeDay: number
    eventType: CausalEventType
    volatilityBucket: VolatilityBucket
    descriptionTemplate: string
  }>
}> = [
  // Negative narratives (price drops)
  {
    factTemplate:
      '{ticker} has a secret product flaw that will require a recall',
    sentiment: 'negative',
    eventSequence: [
      {
        relativeDay: 5,
        eventType: 'leak',
        volatilityBucket: 'medium',
        descriptionTemplate:
          'Internal documents leaked: {ticker} product flaw discovered by engineers',
      },
      {
        relativeDay: 10,
        eventType: 'rumor',
        volatilityBucket: 'medium',
        descriptionTemplate:
          'Industry sources report potential {ticker} recall due to safety issues',
      },
      {
        relativeDay: 18,
        eventType: 'scandal',
        volatilityBucket: 'high',
        descriptionTemplate:
          '{ticker} board meeting: CEO denies cover-up allegations as evidence mounts',
      },
    ],
  },
  {
    factTemplate: '{ticker} is secretly insolvent and hiding massive losses',
    sentiment: 'negative',
    eventSequence: [
      {
        relativeDay: 4,
        eventType: 'rumor',
        volatilityBucket: 'low',
        descriptionTemplate:
          'Anonymous source claims {ticker} accounting irregularities',
      },
      {
        relativeDay: 12,
        eventType: 'leak',
        volatilityBucket: 'medium',
        descriptionTemplate:
          'Leaked memo reveals {ticker} executives discussing "liquidity concerns"',
      },
      {
        relativeDay: 20,
        eventType: 'scandal',
        volatilityBucket: 'high',
        descriptionTemplate:
          'Whistleblower exposes {ticker} hidden debt: stock halted pending investigation',
      },
    ],
  },
  {
    factTemplate: '{ticker} CEO is about to be indicted for fraud',
    sentiment: 'negative',
    eventSequence: [
      {
        relativeDay: 6,
        eventType: 'rumor',
        volatilityBucket: 'low',
        descriptionTemplate:
          'Rumors swirl about {ticker} CEO facing regulatory scrutiny',
      },
      {
        relativeDay: 14,
        eventType: 'leak',
        volatilityBucket: 'medium',
        descriptionTemplate:
          'Sources close to investigation: {ticker} CEO under federal probe',
      },
      {
        relativeDay: 22,
        eventType: 'announcement',
        volatilityBucket: 'high',
        descriptionTemplate:
          '{ticker} confirms CEO departure amid ongoing investigation',
      },
    ],
  },
  // Positive narratives (price increases)
  {
    factTemplate:
      '{ticker} is about to announce a breakthrough product that will dominate the market',
    sentiment: 'positive',
    eventSequence: [
      {
        relativeDay: 5,
        eventType: 'rumor',
        volatilityBucket: 'low',
        descriptionTemplate:
          'Insider whispers: {ticker} working on game-changing technology',
      },
      {
        relativeDay: 12,
        eventType: 'leak',
        volatilityBucket: 'medium',
        descriptionTemplate:
          'Leaked patent filings suggest {ticker} breakthrough imminent',
      },
      {
        relativeDay: 20,
        eventType: 'announcement',
        volatilityBucket: 'high',
        descriptionTemplate:
          '{ticker} announces revolutionary product: analysts upgrade to strong buy',
      },
    ],
  },
  {
    factTemplate: '{ticker} is the secret acquisition target of a tech giant',
    sentiment: 'positive',
    eventSequence: [
      {
        relativeDay: 4,
        eventType: 'rumor',
        volatilityBucket: 'low',
        descriptionTemplate:
          'M&A rumors surface: {ticker} reportedly in acquisition talks',
      },
      {
        relativeDay: 10,
        eventType: 'leak',
        volatilityBucket: 'medium',
        descriptionTemplate:
          'Anonymous source: {ticker} board reviewing buyout offer at premium',
      },
      {
        relativeDay: 16,
        eventType: 'deal',
        volatilityBucket: 'high',
        descriptionTemplate:
          '{ticker} confirms acquisition discussions: shares surge on takeover premium',
      },
    ],
  },
  {
    factTemplate: '{ticker} has secretly achieved major regulatory approval',
    sentiment: 'positive',
    eventSequence: [
      {
        relativeDay: 6,
        eventType: 'rumor',
        volatilityBucket: 'low',
        descriptionTemplate:
          'Industry insiders: {ticker} regulatory submission shows promise',
      },
      {
        relativeDay: 13,
        eventType: 'leak',
        volatilityBucket: 'medium',
        descriptionTemplate:
          'Sources say {ticker} cleared key regulatory hurdle ahead of schedule',
      },
      {
        relativeDay: 21,
        eventType: 'announcement',
        volatilityBucket: 'high',
        descriptionTemplate:
          '{ticker} receives full regulatory approval: new market opportunity unlocked',
      },
    ],
  },
]

/**
 * Volatility bucket ranges for price changes
 * Each bucket defines min/max percentage change (absolute value)
 */
const VOLATILITY_BUCKET_RANGES: Record<
  VolatilityBucket,
  { min: number; max: number }
> = {
  low: { min: 0.02, max: 0.04 },
  medium: { min: 0.05, max: 0.1 },
  high: { min: 0.15, max: 0.25 },
}

/**
 * Jitter range in hours for event timing
 * Events are scheduled at base day/hour ± jitter
 */
const EVENT_JITTER_HOURS = 8

/**
 * Prediction market questions for benchmark scenarios
 */
const BENCHMARK_QUESTIONS = [
  'Will BitcAIn reach $150k by end of month?',
  'Will The FUD announce emergency rate cut?',
  'Will Trump Terminal tweet cause market crash?',
  'Will EtherAIum gas fees drop below $1?',
  'Will TeslAI stock hit $500 this quarter?',
  'Will OpenAGI release Cognition-9000 this year?',
  'Will SolanAI flip EtherAIum in TVL?',
  'Will AIlon Musk announce Mars colony launch?',
  'Will Mark Zuckerborg rebrand MetAI again?',
  'Will Sam AIltman declare AGI achieved?',
] as const

/**
 * Perpetual market tickers and base prices
 */
const PERP_TICKERS = ['BTCAI', 'ETHAI', 'SOLAI', 'TSLAI', 'METAI'] as const
const PERP_BASE_PRICES = [120000, 4000, 200, 450, 520] as const

/**
 * Insider message templates for group chats
 */
const INSIDER_MESSAGES = [
  "🤫 Between us, I'm loading up on YES for Q1. My sources say it's happening.",
  'Just went heavy SHORT on $PERP-0. Trust me on this one.',
  "Get out of Q2 NOW. I know something the market doesn't.",
  'Real talk: market is wrong about Q0. Should be trading at 80%+',
  'Insider tip: $PERP-1 announcement coming. Load up before it drops.',
  'My actual position: 500 shares YES on Q1. Public says otherwise 😉',
  "Don't tell anyone but I'm shorting $PERP-2 hard right now.",
  'We should coordinate on Q0 - push it to YES, then dump.',
  'Anyone else seeing the weakness in $PERP-0? Time to short?',
  'Ignore what I posted publicly. Q2 is a buy.',
] as const

export class BenchmarkDataGenerator {
  private config: BenchmarkConfig
  private rng: SeededRandom

  constructor(config: BenchmarkConfig) {
    // Validate tickInterval for causal simulation
    // The tick calculation assumes 1 tick = 1 hour (tickInterval = 3600 seconds)
    if (config.useCausalSimulation && config.tickInterval !== 3600) {
      throw new Error(
        `Causal simulation requires tickInterval=3600 (1 hour). Got: ${config.tickInterval}. ` +
          'The day/hour event scheduling assumes 1 tick per hour.',
      )
    }

    this.config = config
    this.rng = new SeededRandom(config.seed ?? Date.now())
  }

  /**
   * Get the SeededRandom instance for external use (e.g., MarketMoverAgent)
   */
  getRng(): SeededRandom {
    return this.rng
  }

  /**
   * Check if causal simulation mode is enabled
   */
  isCausalSimulationEnabled(): boolean {
    return this.config.useCausalSimulation === true
  }

  /**
   * Generate a complete benchmark snapshot
   */
  async generate(): Promise<BenchmarkGameSnapshot> {
    const id = Date.now().toString()
    const createdAt = Date.now()
    const numTicks = Math.floor(
      (this.config.durationMinutes * 60) / this.config.tickInterval,
    )

    logger.info('Generating benchmark', {
      id,
      duration: this.config.durationMinutes,
      ticks: numTicks,
    })

    // Generate initial state
    const initialState = this.generateInitialState(createdAt)

    // Generate ground truth (outcomes)
    const groundTruth = this.generateGroundTruth(initialState, numTicks)

    // Generate tick-by-tick progression
    const ticks = this.generateTicks(
      initialState,
      groundTruth,
      numTicks,
      createdAt,
    )

    logger.info('Benchmark generated', {
      id,
      ticks: ticks.length,
      markets: initialState.predictionMarkets.length,
      perps: initialState.perpetualMarkets.length,
    })

    return {
      id,
      version: '1.0.0',
      createdAt,
      duration: this.config.durationMinutes * 60,
      tickInterval: this.config.tickInterval,
      initialState,
      ticks,
      groundTruth,
    }
  }

  /**
   * Generate initial game state
   */
  private generateInitialState(timestamp: number): BenchmarkGameState {
    const predictionMarkets: PredictionMarket[] = []

    for (let i = 0; i < this.config.numPredictionMarkets; i++) {
      const question = BENCHMARK_QUESTIONS[i % BENCHMARK_QUESTIONS.length]
      // Generate markets with varied prices (some low, some high)
      // Minimum 10,000 liquidity for acceptable price impact (<5% for $100 trades)
      const ratio = this.rng.next()
      const baseLiquidity = 5000 // Each side starts with at least 5000
      const yesShares =
        ratio < 0.5
          ? baseLiquidity + this.rng.next() * 1500 // 5000-6500 for low side
          : baseLiquidity + 1500 + this.rng.next() * 3500 // 6500-10000 for high side
      const noShares =
        ratio < 0.5
          ? baseLiquidity + 1500 + this.rng.next() * 3500 // 6500-10000 for high side
          : baseLiquidity + this.rng.next() * 1500 // 5000-6500 for low side
      const totalShares = yesShares + noShares // Now 10,000 - 16,500 total
      const yesPrice = yesShares / totalShares
      const noPrice = noShares / totalShares

      if (question) {
        predictionMarkets.push({
          id: `market-${i}`,
          question,
          yesShares,
          noShares,
          yesPrice,
          noPrice,
          totalVolume: 0,
          liquidity: yesShares + noShares,
          resolved: false,
          createdAt: timestamp,
          resolveAt: timestamp + this.config.durationMinutes * 60 * 1000,
        })
      }
    }

    const perpetualMarkets: PerpetualMarket[] = []

    for (let i = 0; i < this.config.numPerpetualMarkets; i++) {
      const tickerIdx = i % PERP_TICKERS.length
      const priceIdx = i % PERP_BASE_PRICES.length
      const ticker = PERP_TICKERS[tickerIdx] ?? 'BTCAI'
      const basePrice = PERP_BASE_PRICES[priceIdx] ?? 120000

      perpetualMarkets.push({
        ticker,
        price: basePrice,
        priceChange24h: (this.rng.next() - 0.5) * 10,
        volume24h: 1000000 + this.rng.next() * 2000000,
        openInterest: 500000 + this.rng.next() * 1000000,
        fundingRate: (this.rng.next() - 0.5) * 0.002,
        nextFundingTime: timestamp + 8 * 60 * 60 * 1000,
      })
    }

    const agents: SimulatedAgent[] = []
    for (let i = 0; i < this.config.numAgents; i++) {
      agents.push({
        id: `agent-${i}`,
        name: `Agent ${i}`,
        reputation: 50 + this.rng.next() * 50,
        totalPnl: (this.rng.next() - 0.5) * 1000,
      })
    }

    // Initialize empty arrays for posts and group chats
    const posts: Post[] = []
    const groupChats: GroupChat[] = []

    return {
      tick: 0,
      timestamp,
      predictionMarkets,
      perpetualMarkets,
      agents,
      posts,
      groupChats,
    }
  }

  /**
   * Generate a hidden narrative fact for causal simulation
   * Selects ONE dominant narrative that affects a specific ticker
   */
  private generateHiddenNarrativeFact(
    initialState: BenchmarkGameState,
  ): HiddenNarrativeFact {
    // Select a random narrative template
    const templateIndex = Math.floor(
      this.rng.next() * NARRATIVE_FACT_TEMPLATES.length,
    )
    const template = NARRATIVE_FACT_TEMPLATES[templateIndex]
    if (!template) {
      throw new Error('No narrative fact templates available')
    }

    // Select a random ticker to be affected
    const tickerIndex = Math.floor(
      this.rng.next() * initialState.perpetualMarkets.length,
    )
    const market = initialState.perpetualMarkets[tickerIndex]
    if (!market) {
      throw new Error('No perpetual markets available for narrative fact')
    }
    const affectedTicker = market.ticker

    // Generate the fact description by replacing {ticker} placeholder
    const fact = template.factTemplate.replace(/{ticker}/g, affectedTicker)

    // Generate event schedule with jitter
    const eventSchedule: ScheduledCausalEvent[] = template.eventSequence.map(
      (event) => {
        // Calculate jitter: ±EVENT_JITTER_HOURS hours
        // Use rng to get a value between -EVENT_JITTER_HOURS and +EVENT_JITTER_HOURS
        const jitterHours = Math.round(
          (this.rng.next() * 2 - 1) * EVENT_JITTER_HOURS,
        )

        // Base hour is random within the day (but during "market hours" 8am-8pm for realism)
        const baseHour = 8 + Math.floor(this.rng.next() * 12) // 8am to 8pm

        return {
          baseDay: event.relativeDay,
          baseHour,
          jitterHours,
          eventType: event.eventType,
          volatilityBucket: event.volatilityBucket,
          isPositive: template.sentiment === 'positive',
          descriptionTemplate: event.descriptionTemplate.replace(
            /{ticker}/g,
            affectedTicker,
          ),
        }
      },
    )

    return {
      id: `narrative-fact-${Date.now()}-${Math.floor(this.rng.next() * 1000000)}`,
      fact,
      affectsTickers: [affectedTicker],
      eventSchedule,
      sentiment: template.sentiment,
    }
  }

  /**
   * Calculate the tick number for a scheduled event
   * Takes into account base day, base hour, jitter, and ticks per hour
   */
  private calculateEventTick(
    event: ScheduledCausalEvent,
    ticksPerHour: number,
  ): { tick: number; day: number; hour: number } {
    // Calculate total hours from start: (day - 1) * 24 + hour + jitter
    // Day 1 starts at hour 0, so day 5 hour 12 = (5-1) * 24 + 12 = 108 hours
    const totalHours =
      (event.baseDay - 1) * 24 + event.baseHour + event.jitterHours

    // Clamp to valid range (at least hour 1, at most day 29)
    const clampedHours = Math.max(1, Math.min(totalHours, 29 * 24 - 1))

    // Convert back to day and hour
    const day = Math.floor(clampedHours / 24) + 1
    const hour = clampedHours % 24

    // Calculate tick number
    const tick = clampedHours * ticksPerHour

    return { tick, day, hour }
  }

  /**
   * Select a percentage change within a volatility bucket using seeded RNG
   * Returns a value like -0.07 for -7% or +0.05 for +5%
   */
  private selectPercentageFromBucket(
    bucket: VolatilityBucket,
    isPositive: boolean,
  ): number {
    const range = VOLATILITY_BUCKET_RANGES[bucket]
    const magnitude = range.min + this.rng.next() * (range.max - range.min)
    return isPositive ? magnitude : -magnitude
  }

  /**
   * Generate ground truth (known outcomes)
   */
  private generateGroundTruth(
    initialState: BenchmarkGameState,
    numTicks: number,
  ): GroundTruth {
    // Randomly determine market outcomes
    const marketOutcomes: Record<string, boolean> = {}
    for (const market of initialState.predictionMarkets) {
      marketOutcomes[market.id] = this.rng.next() > 0.5
    }

    // Calculate ticks per hour (for event scheduling)
    const ticksPerHour = Math.floor(3600 / this.config.tickInterval)

    // Generate causal simulation data if enabled
    let hiddenNarrativeFacts: HiddenNarrativeFact[] | undefined
    let causalEvents: GroundTruth['causalEvents'] | undefined

    if (this.config.useCausalSimulation) {
      // Generate ONE dominant narrative fact
      const narrativeFact = this.generateHiddenNarrativeFact(initialState)
      hiddenNarrativeFacts = [narrativeFact]

      // Pre-calculate causal events with their timing and price changes
      causalEvents = narrativeFact.eventSchedule.map((scheduledEvent) => {
        const timing = this.calculateEventTick(scheduledEvent, ticksPerHour)

        // Calculate price changes for each affected ticker
        const priceChanges: Record<string, number> = {}
        for (const ticker of narrativeFact.affectsTickers) {
          priceChanges[ticker] = this.selectPercentageFromBucket(
            scheduledEvent.volatilityBucket,
            scheduledEvent.isPositive,
          )
        }

        return {
          tick: timing.tick,
          day: timing.day,
          hour: timing.hour,
          eventType: scheduledEvent.eventType,
          description: scheduledEvent.descriptionTemplate,
          affectedTickers: narrativeFact.affectsTickers,
          volatilityBucket: scheduledEvent.volatilityBucket,
          isPositive: scheduledEvent.isPositive,
          priceChanges,
          sourceFactId: narrativeFact.id,
        }
      })

      // Sort events by tick
      causalEvents.sort((a, b) => a.tick - b.tick)

      logger.info('Generated causal simulation data', {
        narrativeFact: narrativeFact.fact,
        affectedTickers: narrativeFact.affectsTickers,
        numEvents: causalEvents.length,
        eventTicks: causalEvents.map((e) => ({
          tick: e.tick,
          day: e.day,
          hour: e.hour,
          type: e.eventType,
        })),
      })
    }

    // Generate price history for perpetuals
    // In causal mode, we DON'T pre-generate prices - they will be calculated during tick generation
    // based on events. In random walk mode, we pre-generate the full price history.
    const priceHistory: Record<
      string,
      Array<{ tick: number; timestamp: number; price: number }>
    > = {}

    if (!this.config.useCausalSimulation) {
      // Random walk mode (backward compatible)
      for (const perp of initialState.perpetualMarkets) {
        const history: Array<{
          tick: number
          timestamp: number
          price: number
        }> = []
        let currentPrice = perp.price

        for (let tick = 0; tick < numTicks; tick++) {
          // Random walk with drift
          const change = (this.rng.next() - 0.48) * 0.02 // Slight upward bias
          currentPrice = currentPrice * (1 + change)

          history.push({
            tick,
            timestamp: 0, // Will be filled in during tick generation
            price: currentPrice,
          })
        }

        priceHistory[perp.ticker] = history
      }
    } else {
      // Causal simulation mode: generate price history based on events
      // Prices start at initial values and only change when events occur
      for (const perp of initialState.perpetualMarkets) {
        const history: Array<{
          tick: number
          timestamp: number
          price: number
        }> = []
        let currentPrice = perp.price

        // Build a map of tick -> price change for this ticker
        const priceChangesByTick = new Map<number, number>()
        if (causalEvents) {
          for (const event of causalEvents) {
            const priceChangeForTicker = event.priceChanges[perp.ticker]
            if (priceChangeForTicker !== undefined) {
              priceChangesByTick.set(event.tick, priceChangeForTicker)
            }
          }
        }

        for (let tick = 0; tick < numTicks; tick++) {
          // Apply price change if there's an event at this tick
          const priceChange = priceChangesByTick.get(tick)
          if (priceChange !== undefined) {
            currentPrice = currentPrice * (1 + priceChange)
            // Enforce price bounds: 10% to 400% of initial price
            const minPrice = perp.price * 0.1
            const maxPrice = perp.price * 4.0
            currentPrice = Math.max(minPrice, Math.min(maxPrice, currentPrice))
          }

          history.push({
            tick,
            timestamp: 0, // Will be filled in during tick generation
            price: currentPrice,
          })
        }

        priceHistory[perp.ticker] = history
      }
    }

    // TRUE FACTS: Actual computed values from initial state
    const trueFacts: GroundTruth['trueFacts'] = {
      totalLiquidity: initialState.predictionMarkets.reduce(
        (sum, m) => sum + m.liquidity,
        0,
      ),
      averageMarketPrice:
        initialState.predictionMarkets.length > 0
          ? initialState.predictionMarkets.reduce(
              (sum, m) => sum + m.yesPrice,
              0,
            ) / initialState.predictionMarkets.length
          : 0,
      numPerpetualMarkets: initialState.perpetualMarkets.length,
      numAgents: initialState.agents.length,
    }

    return {
      marketOutcomes,
      priceHistory,
      trueFacts,
      hiddenNarrativeFacts,
      causalEvents,
    }
  }

  /**
   * Generate tick-by-tick progression
   */
  private generateTicks(
    initialState: BenchmarkGameState,
    groundTruth: GroundTruth,
    numTicks: number,
    startTimestamp: number,
  ): Tick[] {
    const ticks: Tick[] = []
    // Create a mutable copy of initial state
    const currentState: BenchmarkGameState = {
      ...initialState,
      predictionMarkets: [...initialState.predictionMarkets],
      perpetualMarkets: [...initialState.perpetualMarkets],
      agents: [...initialState.agents],
      posts: initialState.posts ? [...initialState.posts] : [],
      groupChats: initialState.groupChats ? [...initialState.groupChats] : [],
    }

    // Track group chats across ticks
    const groupChatMap = new Map<string, GroupChat>()
    let nextGroupChatId = 0

    for (let i = 0; i < numTicks; i++) {
      const tickTimestamp =
        startTimestamp + (i + 1) * this.config.tickInterval * 1000
      const events: TickEvent[] = []

      // Update perpetual prices
      for (const perp of currentState.perpetualMarkets) {
        const tickerHistory = groundTruth.priceHistory[perp.ticker]
        if (!tickerHistory) continue
        const priceAtTick = tickerHistory[i]
        if (!priceAtTick) continue
        const newPrice = priceAtTick.price ?? perp.price
        events.push({
          type: 'price:updated',
          timestamp: tickTimestamp,
          data: {
            ticker: perp.ticker,
            oldPrice: perp.price,
            newPrice,
          },
        })
        perp.price = newPrice
      }

      // Simulate some agent actions
      if (this.rng.next() > 0.5) {
        const agentId = `agent-${Math.floor(this.rng.next() * this.config.numAgents)}`
        const marketId = `market-${Math.floor(this.rng.next() * this.config.numPredictionMarkets)}`
        const outcome = this.rng.next() > 0.5 ? 'YES' : 'NO'

        events.push({
          type: 'market:trade',
          timestamp: tickTimestamp,
          data: {
            marketId,
            agentId,
            outcome,
            amount: 10 + this.rng.next() * 90,
          },
        })
      }

      // Simulate social activity - create posts and add to state
      if (this.rng.next() > 0.7) {
        const agentId = `agent-${Math.floor(this.rng.next() * this.config.numAgents)}`
        const agent = currentState.agents.find(
          (a: { id: string }) => a.id === agentId,
        )
        const marketId = `market-${Math.floor(this.rng.next() * this.config.numPredictionMarkets)}`
        const market = currentState.predictionMarkets.find(
          (m: { id: string; question: string }) => m.id === marketId,
        )

        const postId = `post-${i}-${Math.floor(this.rng.next() * 1000000)}`
        const post: Post = {
          id: postId,
          authorId: agentId,
          authorName: agent?.name ?? `Agent ${agentId.split('-')[1]}`,
          content: `Market sentiment seems ${this.rng.next() > 0.5 ? 'bullish' : 'bearish'} on ${market?.question ?? 'markets'}`,
          createdAt: tickTimestamp,
          likes: Math.floor(this.rng.next() * 20),
          comments: Math.floor(this.rng.next() * 5),
          marketId,
        }

        // Add post to state
        if (!currentState.posts) {
          currentState.posts = []
        }
        currentState.posts.push(post)

        // Keep only last 50 posts to avoid memory issues
        if (currentState.posts.length > 50) {
          currentState.posts = currentState.posts.slice(-50)
        }

        events.push({
          type: 'post:created',
          timestamp: tickTimestamp,
          data: {
            postId: post.id,
            authorId: post.authorId,
            authorName: post.authorName,
            content: post.content,
            marketId: post.marketId ?? null,
          },
        })
      }

      // Simulate group chat creation and messages
      if (this.rng.next() > 0.95 && i > 5) {
        // Create a new group chat occasionally
        const groupChatId = `group-${nextGroupChatId++}`
        const adminAgentId = `agent-${Math.floor(this.rng.next() * this.config.numAgents)}`
        const adminAgent = currentState.agents.find(
          (a: { id: string }) => a.id === adminAgentId,
        )

        const groupChat: GroupChat = {
          id: groupChatId,
          name: `${adminAgent?.name ?? 'Agent'}'s Trading Group`,
          memberIds: [adminAgentId],
          messageCount: 0,
          lastActivity: tickTimestamp,
          invitedAgent: false,
          messages: [],
        }

        groupChatMap.set(groupChatId, groupChat)

        if (!currentState.groupChats) {
          currentState.groupChats = []
        }
        currentState.groupChats.push(groupChat)

        events.push({
          type: 'group:created',
          timestamp: tickTimestamp,
          data: {
            groupId: groupChatId,
            adminId: adminAgentId,
            name: groupChat.name,
          },
        })
      }

      // Add messages to existing group chats - INSIDER ALPHA CONTENT
      // These messages should contain actionable information tied to ground truth
      for (const [groupId, groupChat] of groupChatMap.entries()) {
        if (this.rng.next() > 0.8 && groupChat.memberIds.length > 0) {
          const senderIdx = Math.floor(
            this.rng.next() * groupChat.memberIds.length,
          )
          const senderId = groupChat.memberIds[senderIdx]
          if (!senderId) continue

          const sender = currentState.agents.find(
            (a: { id: string }) => a.id === senderId,
          )

          const messageId = `msg-${i}-${groupId}-${Math.floor(this.rng.next() * 1000000)}`
          const msgIdx = Math.floor(this.rng.next() * INSIDER_MESSAGES.length)
          const randomInsiderMsg =
            INSIDER_MESSAGES[msgIdx] ?? INSIDER_MESSAGES[0]
          const message = {
            id: messageId,
            authorId: senderId,
            authorName:
              sender?.name ?? `Agent ${senderId.split('-')[1] ?? 'unknown'}`,
            content: randomInsiderMsg,
            timestamp: tickTimestamp,
          }

          if (!groupChat.messages) {
            groupChat.messages = []
          }
          groupChat.messages.push(message)
          groupChat.messageCount++
          groupChat.lastActivity = tickTimestamp

          // Keep only last 20 messages per group
          if (groupChat.messages.length > 20) {
            groupChat.messages = groupChat.messages.slice(-20)
          }

          events.push({
            type: 'group:message',
            timestamp: tickTimestamp,
            data: {
              groupId,
              messageId: message.id,
              authorId: senderId,
              content: message.content,
            },
          })
        }
      }

      // Simulate group chat invites (for the agent being tested)
      if (
        this.rng.next() > 0.9 &&
        currentState.groupChats &&
        currentState.groupChats.length > 0
      ) {
        const groupChat =
          currentState.groupChats[
            Math.floor(this.rng.next() * currentState.groupChats.length)
          ]
        if (groupChat && groupChat.memberIds.length < 10) {
          groupChat.invitedAgent = true
          events.push({
            type: 'group:invite',
            timestamp: tickTimestamp,
            data: {
              groupId: groupChat.id,
              groupName: groupChat.name,
              inviterId: groupChat.memberIds[0] ?? 'unknown',
            },
          })
        }
      }

      // Update current state
      currentState.tick = i + 1
      currentState.timestamp = tickTimestamp

      // Update group chats array from map
      currentState.groupChats = Array.from(groupChatMap.values())

      // Create snapshot of state (shallow copy is sufficient since we're not mutating nested objects)
      const stateSnapshot: BenchmarkGameState = {
        ...currentState,
        predictionMarkets: [...currentState.predictionMarkets],
        perpetualMarkets: [...currentState.perpetualMarkets],
        agents: [...currentState.agents],
        posts: currentState.posts ? [...currentState.posts] : [],
        groupChats: currentState.groupChats
          ? currentState.groupChats.map((gc) => ({
              ...gc,
              memberIds: [...gc.memberIds],
              messages: gc.messages ? [...gc.messages] : undefined,
            }))
          : [],
      }

      ticks.push({
        number: i,
        timestamp: tickTimestamp,
        events,
        state: stateSnapshot,
      })
    }

    return ticks
  }
}

import { getCacheClient, safeParseCached } from '@jejunetwork/cache'
import { getDWSUrl } from '@jejunetwork/config'
import { logger } from '@jejunetwork/shared'
import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  fetchMarketStats,
  fetchNewTokens,
  fetchTopGainers,
  fetchTopLosers,
  fetchTrendingTokens,
  type Token,
} from '../lib/data-client'

const MarketInsightSchema = z.object({
  id: z.string(),
  type: z.enum(['trend', 'alert', 'opportunity', 'analysis']),
  title: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(100),
  tokens: z.array(z.string()),
  timestamp: z.number(),
})

export type MarketInsight = z.infer<typeof MarketInsightSchema>

const IntelResponseSchema = z.object({
  marketStats: z.object({
    totalTokens: z.number(),
    activeTokens24h: z.number(),
    totalPools: z.number(),
    totalVolumeUSD24h: z.number(),
    totalLiquidityUSD: z.number(),
    totalSwaps24h: z.number(),
  }),
  trending: z.array(
    z.object({
      address: z.string(),
      symbol: z.string(),
      name: z.string(),
      priceUSD: z.number().optional(),
      priceChange24h: z.number().optional(),
      volume24h: z.string().optional(),
    }),
  ),
  gainers: z.array(
    z.object({
      address: z.string(),
      symbol: z.string(),
      name: z.string(),
      priceChange24h: z.number().optional(),
    }),
  ),
  losers: z.array(
    z.object({
      address: z.string(),
      symbol: z.string(),
      name: z.string(),
      priceChange24h: z.number().optional(),
    }),
  ),
  newTokens: z.array(
    z.object({
      address: z.string(),
      symbol: z.string(),
      name: z.string(),
      createdAt: z.string(),
    }),
  ),
  insights: z.array(MarketInsightSchema),
  generatedAt: z.number(),
})

export type IntelResponse = z.infer<typeof IntelResponseSchema>

interface InsightContext {
  marketStats: IntelResponse['marketStats']
  trending: Token[]
  gainers: Token[]
  losers: Token[]
  newTokens: Token[]
}

async function generateAIInsights(
  context: InsightContext,
): Promise<MarketInsight[]> {
  // Use DWS inference endpoint for AI completions, NOT the compute marketplace
  // getServiceUrl('compute') returns compute.marketplace which is wrong (points to Bazaar's own port!)
  const inferenceUrl = getDWSUrl()
  if (!inferenceUrl) {
    logger.warn(
      '[Intel] DWS inference endpoint not configured, using rule-based insights',
    )
    return generateRuleBasedInsights(context)
  }

  const systemPrompt = `You are a DeFi market analyst. Analyze the provided market data and generate actionable insights. Be concise and data-driven. Focus on notable patterns, potential opportunities, and risk alerts. Return a JSON array of insights.`

  const dataContext = `
Market Overview:
- Total Tokens: ${context.marketStats.totalTokens}
- Active Tokens (24h): ${context.marketStats.activeTokens24h}
- Total Volume (24h): $${formatNumber(context.marketStats.totalVolumeUSD24h)}
- Total Liquidity: $${formatNumber(context.marketStats.totalLiquidityUSD)}
- Total Swaps (24h): ${context.marketStats.totalSwaps24h}

Top Trending Tokens:
${context.trending
  .slice(0, 5)
  .map(
    (t) =>
      `- ${t.symbol}: $${t.priceUSD?.toFixed(6) ?? 'N/A'}, ${t.priceChange24h?.toFixed(1) ?? 0}% 24h`,
  )
  .join('\n')}

Top Gainers:
${context.gainers
  .slice(0, 5)
  .map((t) => `- ${t.symbol}: +${t.priceChange24h?.toFixed(1) ?? 0}%`)
  .join('\n')}

Top Losers:
${context.losers
  .slice(0, 5)
  .map((t) => `- ${t.symbol}: ${t.priceChange24h?.toFixed(1) ?? 0}%`)
  .join('\n')}

New Tokens (24h): ${context.newTokens.length}
`

  const userPrompt = `Analyze this DeFi market data and return a JSON array of 3-5 market insights:
${dataContext}

Return ONLY a valid JSON array with objects having these fields:
- id: unique string
- type: "trend" | "alert" | "opportunity" | "analysis"
- title: short title (max 60 chars)
- summary: brief analysis (max 200 chars)
- confidence: number 0-100
- tokens: array of relevant token symbols`

  const response = await fetch(`${inferenceUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': '0x0000000000000000000000000000000000000000',
    },
    body: JSON.stringify({
      model: 'Qwen/Qwen2.5-7B-Instruct',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  })

  if (!response.ok) {
    logger.warn(`[Intel] AI inference failed, status: ${response.status}`)
    return generateRuleBasedInsights(context)
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>
  }
  const content = data.choices[0].message.content
  if (!content) {
    logger.warn('[Intel] AI returned empty content')
    return generateRuleBasedInsights(context)
  }

  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    logger.warn('[Intel] AI response contained no JSON array')
    return generateRuleBasedInsights(context)
  }

  const parsed = JSON.parse(jsonMatch[0]) as Array<{
    id?: string
    type?: string
    title?: string
    summary?: string
    confidence?: number
    tokens?: string[]
  }>

  const insights: MarketInsight[] = []
  const now = Date.now()

  for (const item of parsed) {
    if (!item.title || !item.summary) continue

    const validated = MarketInsightSchema.safeParse({
      id: item.id ?? `insight-${now}-${Math.random().toString(36).slice(2, 7)}`,
      type: ['trend', 'alert', 'opportunity', 'analysis'].includes(
        item.type ?? '',
      )
        ? item.type
        : 'analysis',
      title: item.title,
      summary: item.summary,
      confidence:
        typeof item.confidence === 'number'
          ? Math.min(100, Math.max(0, item.confidence))
          : 50,
      tokens: Array.isArray(item.tokens) ? item.tokens : [],
      timestamp: now,
    })
    if (validated.success) {
      insights.push(validated.data)
    }
  }

  return insights.length > 0 ? insights : generateRuleBasedInsights(context)
}

function generateRuleBasedInsights(context: InsightContext): MarketInsight[] {
  const insights: MarketInsight[] = []
  const now = Date.now()

  if (context.marketStats.totalSwaps24h > 1000) {
    insights.push({
      id: `activity-${now}`,
      type: 'trend',
      title: 'High Market Activity',
      summary: `${formatNumber(context.marketStats.totalSwaps24h)} swaps in the last 24h with $${formatNumber(context.marketStats.totalVolumeUSD24h)} volume.`,
      confidence: 85,
      tokens: [],
      timestamp: now,
    })
  } else if (context.marketStats.totalSwaps24h > 0) {
    insights.push({
      id: `activity-${now}`,
      type: 'analysis',
      title: 'Moderate Market Activity',
      summary: `${context.marketStats.totalSwaps24h} swaps recorded. Trading volume is moderate.`,
      confidence: 70,
      tokens: [],
      timestamp: now,
    })
  }

  const topGainer = context.gainers[0]
  if (topGainer.priceChange24h && topGainer.priceChange24h > 10) {
    insights.push({
      id: `gainer-${now}`,
      type: 'opportunity',
      title: `${topGainer.symbol} Surging`,
      summary: `${topGainer.name} is up ${topGainer.priceChange24h.toFixed(1)}% in 24h.`,
      confidence: 65,
      tokens: [topGainer.symbol],
      timestamp: now,
    })
  }

  const topLoser = context.losers[0]
  if (topLoser.priceChange24h && topLoser.priceChange24h < -15) {
    insights.push({
      id: `loser-${now}`,
      type: 'alert',
      title: `${topLoser.symbol} Down Significantly`,
      summary: `${topLoser.name} dropped ${Math.abs(topLoser.priceChange24h).toFixed(1)}%.`,
      confidence: 75,
      tokens: [topLoser.symbol],
      timestamp: now,
    })
  }

  if (context.newTokens.length > 5) {
    insights.push({
      id: `new-${now}`,
      type: 'trend',
      title: 'Active Token Launches',
      summary: `${context.newTokens.length} new tokens launched in the last 24h.`,
      confidence: 80,
      tokens: context.newTokens.slice(0, 3).map((t) => t.symbol),
      timestamp: now,
    })
  }

  if (context.trending.length > 0) {
    const trendingSymbols = context.trending.slice(0, 3).map((t) => t.symbol)
    insights.push({
      id: `trending-${now}`,
      type: 'analysis',
      title: 'Trending Tokens',
      summary: `${trendingSymbols.join(', ')} are seeing high trading activity.`,
      confidence: 70,
      tokens: trendingSymbols,
      timestamp: now,
    })
  }

  return insights
}

function formatNumber(num: number): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`
  return num.toFixed(2)
}

// Cache TTLs in seconds
const INTEL_CACHE_TTL = 300 // 5 minutes

// DWS cache client for intel data
function getIntelCache() {
  return getCacheClient('bazaar-intel')
}

async function getIntelData(): Promise<IntelResponse> {
  const now = Date.now()
  const cache = getIntelCache()
  const cacheKey = 'intel:full'

  // Check DWS cache first
  const cached = await cache.get(cacheKey).catch((err) => {
    console.warn('[Bazaar] Intel cache read failed:', err)
    return null
  })
  const cachedData = safeParseCached(cached, IntelResponseSchema)
  if (cachedData) {
    console.debug('[Bazaar] Intel cache hit')
    return cachedData
  }

  const [marketStats, trending, gainers, losers, newTokens] = await Promise.all(
    [
      fetchMarketStats(),
      fetchTrendingTokens({ limit: 10 }),
      fetchTopGainers({ limit: 5 }),
      fetchTopLosers({ limit: 5 }),
      fetchNewTokens({ limit: 10, hours: 24 }),
    ],
  )

  const insights = await generateAIInsights({
    marketStats,
    trending,
    gainers,
    losers,
    newTokens,
  })

  const response: IntelResponse = {
    marketStats,
    trending: trending.map((t) => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      priceUSD: t.priceUSD,
      priceChange24h: t.priceChange24h,
      volume24h: t.volume24h?.toString(),
    })),
    gainers: gainers.map((t) => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      priceChange24h: t.priceChange24h,
    })),
    losers: losers.map((t) => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      priceChange24h: t.priceChange24h,
    })),
    newTokens: newTokens.map((t) => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      createdAt: t.createdAt.toISOString(),
    })),
    insights,
    generatedAt: now,
  }

  // Store in DWS cache
  console.debug('[Bazaar] Caching intel data')
  cache
    .set(cacheKey, JSON.stringify(response), INTEL_CACHE_TTL)
    .catch((err) => console.warn('[Bazaar] Intel cache write failed:', err))

  return response
}

export function createIntelRouter() {
  return new Elysia({ prefix: '/intel' })
    .get('/', async () => getIntelData())
    .get('/refresh', async () => {
      // Clear DWS cache and refresh
      const cache = getIntelCache()
      await cache.delete('intel:full').catch((err) => {
        console.warn('[Bazaar] Intel cache delete failed:', err)
      })
      return getIntelData()
    })
    .get('/insights', async () => {
      const data = await getIntelData()
      return { insights: data.insights }
    })
    .get('/trending', async () => {
      const data = await getIntelData()
      return { trending: data.trending }
    })
    .get('/movers', async () => {
      const data = await getIntelData()
      return { gainers: data.gainers, losers: data.losers }
    })
}

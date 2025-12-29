/**
 * API Marketplace HTTP Routes
 *
 * REST API for the decentralized API marketplace
 */

import { CORE_PORTS, getLocalhostHost } from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { z } from 'zod'

/** Error response from compute */
const ComputeErrorResponseSchema = z.object({
  error: z.string().optional(),
})

/** Full inference response from compute */
const ComputeInferenceResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })),
  model: z.string(),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }),
  provider: z.string().optional(),
})

/** Embedding response schema */
const EmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
    }),
  ),
})

import {
  // Types
  type APIProvider,
  calculateAffordableRequests,
  checkProviderHealth,
  createListing,
  deleteKey,
  findCheapestListing,
  getAccountInfo,
  getAllListings,
  getAllProviderHealth,
  // Registry
  getAllProviders,
  getBalance,
  getConfiguredProviders,
  getKeysByOwner,
  getListing,
  getListingsByProvider,
  getListingsBySeller,
  getMarketplaceStats,
  getMinimumDeposit,
  getProviderById,
  // Access control
  getRateLimitUsage,
  getVaultStats,
  type ProxyRequest,
  parsePaymentProof,
  // Payments
  processDeposit,
  processWithdraw,
  // Proxy
  proxyRequest,
  // Key vault
  storeKey,
  updateListing,
} from '../../api-marketplace'
import {
  apiKeyParamsSchema,
  createListingRequestSchema,
  depositRequestSchema,
  type JSONObject,
  jejuAddressHeaderSchema,
  listingListQuerySchema,
  listingParamsSchema,
  providerListQuerySchema,
  providerParamsSchema,
  proxyRequestSchema,
  updateListingRequestSchema,
  withdrawRequestSchema,
} from '../../shared'
import { extractOriginDomain } from '../../shared/utils/api-marketplace'

function extractHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return headers
}

export function createAPIMarketplaceRouter() {
  return (
    new Elysia({ prefix: '/api-marketplace' })
      // Health & Stats

      .get('/health', async () => {
        const stats = await getMarketplaceStats()
        const vaultStats = getVaultStats()
        return {
          status: 'healthy',
          service: 'api-marketplace',
          marketplace: {
            totalProviders: stats.totalProviders,
            totalListings: stats.totalListings,
            activeListings: stats.activeListings,
            totalUsers: stats.totalUsers,
            totalRequests: stats.totalRequests.toString(),
            totalVolume: stats.totalVolume.toString(),
            last24hRequests: stats.last24hRequests.toString(),
            last24hVolume: stats.last24hVolume.toString(),
            pocStats: {
              pocRequiredListings: stats.pocStats.pocRequiredListings,
              verifiedVaultKeys: stats.pocStats.verifiedVaultKeys,
              pocVerifiedRequests:
                stats.pocStats.pocVerifiedRequests.toString(),
            },
          },
          vault: vaultStats,
        }
      })

      .get('/stats', async () => {
        const stats = await getMarketplaceStats()
        return {
          totalProviders: stats.totalProviders,
          totalListings: stats.totalListings,
          activeListings: stats.activeListings,
          totalUsers: stats.totalUsers,
          totalRequests: stats.totalRequests.toString(),
          totalVolume: stats.totalVolume.toString(),
          last24hRequests: stats.last24hRequests.toString(),
          last24hVolume: stats.last24hVolume.toString(),
          pocStats: {
            pocRequiredListings: stats.pocStats.pocRequiredListings,
            verifiedVaultKeys: stats.pocStats.verifiedVaultKeys,
            pocVerifiedRequests: stats.pocStats.pocVerifiedRequests.toString(),
          },
        }
      })

      // Providers

      .get('/providers', ({ query }) => {
        const { category, configured } = expectValid(
          providerListQuerySchema,
          query,
        )
        const configuredOnly = configured === true

        let providers = getAllProviders()

        if (category) {
          providers = providers.filter((p: APIProvider) =>
            p.categories.includes(category as never),
          )
        }

        if (configuredOnly) {
          providers = getConfiguredProviders()
        }

        return {
          providers: providers.map((p: APIProvider) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            categories: p.categories,
            defaultPricePerRequest: p.defaultPricePerRequest.toString(),
            supportsStreaming: p.supportsStreaming,
            configured: !!process.env[p.envVar],
          })),
          total: providers.length,
        }
      })

      .get('/providers/:id', ({ params }) => {
        const { id } = expectValid(providerParamsSchema, params)
        const provider = getProviderById(id)
        if (!provider) {
          throw new Error('Provider not found')
        }

        return {
          ...provider,
          defaultPricePerRequest: provider.defaultPricePerRequest.toString(),
          configured: !!process.env[provider.envVar],
        }
      })

      .get('/providers/:id/health', async ({ params }) => {
        const { id } = expectValid(providerParamsSchema, params)
        const health = await checkProviderHealth(id)
        return health
      })

      .get('/providers/health/all', () => {
        return { providers: getAllProviderHealth() }
      })

      // Listings

      .get('/listings', async ({ query }) => {
        const {
          provider: providerId,
          seller,
          active: activeOnly,
        } = expectValid(listingListQuerySchema, query)

        let listings = await getAllListings()

        if (providerId) {
          listings = await getListingsByProvider(providerId)
        } else if (seller) {
          listings = await getListingsBySeller(seller)
        }

        if (activeOnly) {
          listings = listings.filter((l) => l.active)
        }

        return {
          listings: listings.map((l) => ({
            ...l,
            pricePerRequest: l.pricePerRequest.toString(),
            totalRequests: l.totalRequests.toString(),
            totalRevenue: l.totalRevenue.toString(),
          })),
          total: listings.length,
        }
      })

      .get('/listings/:id', async ({ params }) => {
        const { id } = expectValid(listingParamsSchema, params)
        const listing = await getListing(id)
        if (!listing) {
          throw new Error('Listing not found')
        }

        const provider = getProviderById(listing.providerId)

        return {
          ...listing,
          pricePerRequest: listing.pricePerRequest.toString(),
          totalRequests: listing.totalRequests.toString(),
          totalRevenue: listing.totalRevenue.toString(),
          provider: provider
            ? {
                id: provider.id,
                name: provider.name,
                categories: provider.categories,
              }
            : null,
        }
      })

      .post('/listings', async ({ body, request, set }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(createListingRequestSchema, body)

        // Validate provider exists
        const provider = getProviderById(validBody.providerId)
        if (!provider) {
          throw new Error(`Unknown provider: ${validBody.providerId}`)
        }

        // Store key in vault
        const vaultKey = await storeKey(
          validBody.providerId,
          userAddress,
          validBody.apiKey,
        )

        // Create listing
        const listing = await createListing({
          providerId: validBody.providerId,
          seller: userAddress,
          keyVaultId: vaultKey.id,
          pricePerRequest: validBody.pricePerRequest
            ? BigInt(validBody.pricePerRequest)
            : undefined,
          limits: validBody.limits,
          accessControl: validBody.accessControl,
        })

        set.status = 201
        return {
          listing: {
            ...listing,
            pricePerRequest: listing.pricePerRequest.toString(),
            totalRequests: listing.totalRequests.toString(),
            totalRevenue: listing.totalRevenue.toString(),
          },
          keyVaultId: vaultKey.id,
        }
      })

      .patch('/listings/:id', async ({ params, body, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const { id } = expectValid(listingParamsSchema, params)
        const listing = await getListing(id)
        if (!listing) {
          throw new Error('Listing not found')
        }

        // Only seller can update
        if (listing.seller.toLowerCase() !== userAddress.toLowerCase()) {
          throw new Error('Unauthorized')
        }

        const validBody = expectValid(updateListingRequestSchema, body)

        const updated = await updateListing(listing.id, {
          pricePerRequest: validBody.pricePerRequest
            ? BigInt(validBody.pricePerRequest)
            : undefined,
          limits: validBody.limits,
          accessControl: validBody.accessControl,
          active: validBody.active,
        })

        return {
          ...updated,
          pricePerRequest: updated.pricePerRequest.toString(),
          totalRequests: updated.totalRequests.toString(),
          totalRevenue: updated.totalRevenue.toString(),
        }
      })

      .get('/listings/cheapest/:providerId', async ({ params }) => {
        const { providerId } = expectValid(
          z.object({ providerId: z.string().min(1) }),
          params,
        )
        const listing = await findCheapestListing(providerId)
        if (!listing) {
          throw new Error('No active listings for this provider')
        }

        return {
          ...listing,
          pricePerRequest: listing.pricePerRequest.toString(),
          totalRequests: listing.totalRequests.toString(),
          totalRevenue: listing.totalRevenue.toString(),
        }
      })

      // Proxy

      .post('/proxy', async ({ body, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(proxyRequestSchema, body)
        const origin = request.headers.get('origin') ?? undefined
        const referer = request.headers.get('referer') ?? undefined
        const originDomain = extractOriginDomain(origin, referer)

        // Find listing - prefer explicit listingId, otherwise find cheapest for provider
        let listingId = validBody.listingId
        if (!listingId) {
          const listing = await findCheapestListing(validBody.providerId)
          if (!listing) {
            throw new Error(
              `No active listings for provider: ${validBody.providerId}`,
            )
          }
          listingId = listing.id
        }

        // Transform schema body to ProxyRequest type
        const proxyReq: ProxyRequest = {
          listingId,
          endpoint: validBody.path,
          method: validBody.method,
          headers: validBody.headers,
          body: validBody.body as string | JSONObject | undefined,
          queryParams: validBody.query,
        }

        const response = await proxyRequest(proxyReq, {
          userAddress,
          originDomain,
          timeout: 30000,
        })

        return new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            ...response.headers,
            'X-Request-Id': response.requestId,
            'X-Request-Cost': response.cost.toString(),
            'X-Latency-Ms': response.latencyMs.toString(),
          },
        })
      })

      // Convenience endpoint for direct provider access
      .all('/proxy/:providerId/*', async ({ params, body, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const { providerId } = expectValid(
          z.object({ providerId: z.string().min(1) }),
          params,
        )
        const listing = await findCheapestListing(providerId)
        if (!listing) {
          throw new Error(`No active listings for provider: ${providerId}`)
        }

        // Extract path after /proxy/:providerId/
        const url = new URL(request.url)
        const fullPath = url.pathname
        const pathParts = fullPath.split(`/proxy/${providerId}`)
        const endpoint = pathParts[1] || '/'

        // Get body if present
        let reqBody: JSONObject | undefined
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
          const parsed = expectValid(
            z.record(z.string(), z.unknown()).optional(),
            body,
          )
          reqBody = parsed as JSONObject | undefined
        }

        // Get query params
        const queryParams: Record<string, string> = {}
        url.searchParams.forEach((value, key) => {
          queryParams[key] = value
        })

        const originDomain =
          request.headers.get('origin') || request.headers.get('referer')

        const response = await proxyRequest(
          {
            listingId: listing.id,
            endpoint,
            method: request.method as ProxyRequest['method'],
            body: reqBody,
            queryParams:
              Object.keys(queryParams).length > 0 ? queryParams : undefined,
          },
          {
            userAddress,
            originDomain: originDomain
              ? new URL(originDomain).hostname
              : undefined,
            timeout: 30000,
          },
        )

        return new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            ...response.headers,
            'X-Request-Id': response.requestId,
            'X-Request-Cost': response.cost.toString(),
            'X-Latency-Ms': response.latencyMs.toString(),
          },
        })
      })

      // Accounts & Payments

      .get('/account', async ({ request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )

        const account = await getAccountInfo(userAddress)
        return {
          address: userAddress,
          balance: account.balance.toString(),
          totalSpent: account.totalSpent.toString(),
          totalRequests: account.totalRequests.toString(),
        }
      })

      .get('/account/balance', async ({ request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )

        const balance = await getBalance(userAddress)
        return {
          balance: balance.toString(),
          minimumDeposit: getMinimumDeposit().toString(),
        }
      })

      .post('/account/deposit', async ({ body, request, set }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(depositRequestSchema, body)
        const amount = BigInt(validBody.amount)

        // Check for payment proof
        const proof = parsePaymentProof(headers)

        const result = await processDeposit(
          { amount, payer: userAddress },
          proof || undefined,
        )

        if (!result.success) {
          set.status = 400
          return { error: result.error }
        }

        return {
          success: true,
          newBalance: result.newBalance.toString(),
        }
      })

      .post('/account/withdraw', async ({ body, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(withdrawRequestSchema, body)
        const amount = BigInt(validBody.amount)

        const result = await processWithdraw(
          { amount, recipient: validBody.recipient },
          userAddress,
        )

        if (!result.success) {
          throw new Error(result.error ?? 'Withdrawal failed')
        }

        return {
          success: true,
          remainingBalance: result.remainingBalance.toString(),
        }
      })

      .get('/account/affordable/:listingId', async ({ params, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const { id: listingId } = expectValid(
          listingParamsSchema.extend({ listingId: z.string().uuid() }),
          params,
        )
        const listing = await getListing(listingId)
        if (!listing) {
          throw new Error('Listing not found')
        }

        const balance = await getBalance(userAddress)
        const affordable = calculateAffordableRequests(
          balance,
          listing.pricePerRequest,
        )

        return {
          balance: balance.toString(),
          pricePerRequest: listing.pricePerRequest.toString(),
          affordableRequests: affordable.toString(),
        }
      })

      // Rate Limits

      .get('/ratelimit/:listingId', async ({ params, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const { listingId } = expectValid(
          z.object({ listingId: z.string().uuid() }),
          params,
        )
        const listing = await getListing(listingId)
        if (!listing) {
          throw new Error('Listing not found')
        }

        const usage = getRateLimitUsage(userAddress, listing.id, listing.limits)
        return usage
      })

      // Keys (for sellers)

      .get('/keys', async ({ request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )

        const keys = await getKeysByOwner(userAddress)
        return { keys, total: keys.length }
      })

      .delete('/keys/:keyId', async ({ params, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const { keyId } = expectValid(apiKeyParamsSchema, params)
        const deleted = await deleteKey(keyId, userAddress)
        if (!deleted) {
          throw new Error('Key not found or unauthorized')
        }

        return { success: true }
      })

      // V1 API (for app compatibility)

      // List available models (for agents/apps)
      .get('/v1/models', () => {
        const providers = getConfiguredProviders()

        // Generate model list based on configured providers
        const models: Array<{
          id: string
          name: string
          provider: string
          pricePerInputToken: string
          pricePerOutputToken: string
          maxContextLength: number
          capabilities: string[]
        }> = []

        for (const p of providers) {
          if (p.id === 'openai') {
            models.push({
              id: 'gpt-5.2',
              name: 'GPT-5.2',
              provider: 'openai',
              pricePerInputToken: '2500000000000',
              pricePerOutputToken: '10000000000000',
              maxContextLength: 128000,
              capabilities: ['chat', 'vision', 'function-calling'],
            })
          } else if (p.id === 'anthropic') {
            models.push(
              {
                id: 'claude-opus-4-5',
                name: 'Claude 4.5 Opus',
                provider: 'anthropic',
                pricePerInputToken: '15000000000000',
                pricePerOutputToken: '75000000000000',
                maxContextLength: 200000,
                capabilities: ['chat', 'vision'],
              },
              {
                id: 'claude-sonnet-4-5',
                name: 'Claude 4.5 Sonnet',
                provider: 'anthropic',
                pricePerInputToken: '3000000000000',
                pricePerOutputToken: '15000000000000',
                maxContextLength: 200000,
                capabilities: ['chat', 'vision'],
              },
            )
          } else if (p.id === 'groq') {
            models.push(
              {
                id: 'llama-3.3-70b-versatile',
                name: 'Llama 3.3 70B Versatile',
                provider: 'groq',
                pricePerInputToken: '590000000',
                pricePerOutputToken: '790000000',
                maxContextLength: 128000,
                capabilities: ['chat'],
              },
              {
                id: 'llama-3.1-8b-instant',
                name: 'Llama 3.1 8B Instant',
                provider: 'groq',
                pricePerInputToken: '50000000',
                pricePerOutputToken: '80000000',
                maxContextLength: 128000,
                capabilities: ['chat'],
              },
              {
                id: 'mixtral-8x7b-32768',
                name: 'Mixtral 8x7B',
                provider: 'groq',
                pricePerInputToken: '240000000',
                pricePerOutputToken: '240000000',
                maxContextLength: 32768,
                capabilities: ['chat'],
              },
            )
          }
        }

        return { models }
      })

      // Inference endpoint (for agents/apps) - forwards to /compute/chat/completions
      .post('/v1/inference', async ({ body, set }) => {
        const validBody = expectValid(
          z.object({
            messages: z
              .array(
                z.object({
                  role: z.string(),
                  content: z.string(),
                }),
              )
              .min(1),
            model: z.string().optional(),
            maxTokens: z.number().int().positive().optional(),
            temperature: z.number().min(0).max(2).optional(),
          }),
          body,
        )

        // Forward to compute endpoint which handles provider selection
        const host = getLocalhostHost()
        const dwsPort = CORE_PORTS.DWS_API.get()
        const computeResponse = await fetch(
          `http://${host}:${dwsPort}/compute/chat/completions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: validBody.model ?? 'llama-3.3-70b-versatile',
              messages: validBody.messages,
              max_tokens: validBody.maxTokens ?? 2048,
              temperature: validBody.temperature ?? 0.7,
            }),
          },
        )

        if (!computeResponse.ok) {
          const errorParsed = ComputeErrorResponseSchema.safeParse(
            await computeResponse.json(),
          )
          set.status = computeResponse.status as 400 | 401 | 500 | 503
          return errorParsed.success
            ? errorParsed.data
            : { error: 'Unknown compute error' }
        }

        const responseData = expectValid(
          ComputeInferenceResponseSchema,
          await computeResponse.json(),
        )
        const choice = responseData.choices[0]

        return {
          content: choice.message.content ?? '',
          model: responseData.model,
          usage: responseData.usage,
          provider: responseData.provider,
          cost: '0',
        }
      })

      // Embeddings endpoint (for agents/apps)
      .post('/v1/embeddings', async ({ body, request, set }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(
          z.object({
            input: z.union([z.string(), z.array(z.string())]),
            model: z.string().optional(),
          }),
          body,
        )

        const providers = getConfiguredProviders()
        // Inference providers typically support embeddings (e.g., OpenAI)
        const inferenceProviders = providers.filter((p) =>
          p.categories.includes('inference'),
        )

        if (inferenceProviders.length === 0) {
          set.status = 503
          return {
            error: 'No inference providers configured',
            message:
              'Configure an inference provider with API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)',
          }
        }

        // Find a listing for an inference provider that supports embeddings
        const provider =
          inferenceProviders.find((p) => p.id === 'openai') ??
          inferenceProviders[0]
        const listing = await findCheapestListing(provider.id)

        if (!listing) {
          set.status = 503
          return {
            error: 'No embedding listings available',
            message: `No active listings for provider ${provider.id}. Create a listing first.`,
          }
        }

        const proxyReq: ProxyRequest = {
          listingId: listing.id,
          endpoint: '/v1/embeddings',
          method: 'POST',
          body: {
            input: validBody.input,
            model: validBody.model ?? 'text-embedding-3-small',
          },
        }

        const result = await proxyRequest(proxyReq, {
          userAddress,
          timeout: 30000,
        })

        if (result.status >= 400) {
          return new Response(JSON.stringify(result.body), {
            status: result.status,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const responseData = expectValid(
          EmbeddingResponseSchema,
          result.body,
          'Embedding API response',
        )
        const embeddingData = responseData.data[0]
        const embedding = embeddingData.embedding ?? []

        return {
          embedding,
          dimensions: embedding.length,
        }
      })
  )
}

export type APIMarketplaceRoutes = ReturnType<typeof createAPIMarketplaceRouter>

/**
 * API Marketplace HTTP Routes
 *
 * REST API for the decentralized API marketplace
 */

import { Hono } from 'hono';
import type { Address } from 'viem';
import {
  // Registry
  getAllProviders,
  getProviderById,
  getAllListings,
  getListing,
  getListingsByProvider,
  getListingsBySeller,
  createListing,
  updateListing,
  findCheapestListing,
  getMarketplaceStats,
  getAllProviderHealth,
  getConfiguredProviders,
  // Key vault
  storeKey,
  getKeysByOwner,
  deleteKey,
  getVaultStats,
  // Proxy
  proxyRequest,
  checkProviderHealth,
  // Payments
  processDeposit,
  processWithdraw,
  getAccountInfo,
  getBalance,
  create402Response as _create402Response,
  parsePaymentProof,
  getMinimumDeposit,
  calculateAffordableRequests,
  // Access control
  getRateLimitUsage,
  accessControl as _accessControl,
  // Types
  type ProxyRequest,
  type CreateListingParams,
} from '../../api-marketplace';
import { validateBody, validateParams, validateQuery, validateHeaders, expectValid, jejuAddressHeaderSchema, providerListQuerySchema, providerParamsSchema, listingListQuerySchema, listingParamsSchema, createListingRequestSchema, updateListingRequestSchema, proxyRequestSchema, depositRequestSchema, withdrawRequestSchema, accountParamsSchema, createApiKeyRequestSchema, apiKeyParamsSchema, z } from '../../shared';
import { extractOriginDomain } from '../../shared/utils/api-marketplace';

export function createAPIMarketplaceRouter(): Hono {
  const app = new Hono();

  // ============================================================================
  // Health & Stats
  // ============================================================================

  app.get('/health', async (c) => {
    const stats = await getMarketplaceStats();
    const vaultStats = getVaultStats();
    return c.json({
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
          pocVerifiedRequests: stats.pocStats.pocVerifiedRequests.toString(),
        },
      },
      vault: vaultStats,
    });
  });

  app.get('/stats', async (c) => {
    const stats = await getMarketplaceStats();
    return c.json({
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
    });
  });

  // ============================================================================
  // Providers
  // ============================================================================

  app.get('/providers', (c) => {
    const { category, configured } = validateQuery(providerListQuerySchema, c);
    const configuredOnly = configured === true;

    let providers = getAllProviders();

    if (category) {
      providers = providers.filter((p) => p.categories.includes(category as never));
    }

    if (configuredOnly) {
      providers = getConfiguredProviders();
    }

    return c.json({
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        categories: p.categories,
        defaultPricePerRequest: p.defaultPricePerRequest.toString(),
        supportsStreaming: p.supportsStreaming,
        configured: !!process.env[p.envVar],
      })),
      total: providers.length,
    });
  });

  app.get('/providers/:id', (c) => {
    const { id } = validateParams(providerParamsSchema, c);
    const provider = getProviderById(id);
    if (!provider) {
      throw new Error('Provider not found');
    }

    return c.json({
      ...provider,
      defaultPricePerRequest: provider.defaultPricePerRequest.toString(),
      configured: !!process.env[provider.envVar],
    });
  });

  app.get('/providers/:id/health', async (c) => {
    const { id } = validateParams(providerParamsSchema, c);
    const health = await checkProviderHealth(id);
    return c.json(health);
  });

  app.get('/providers/health/all', (c) => {
    return c.json({ providers: getAllProviderHealth() });
  });

  // ============================================================================
  // Listings
  // ============================================================================

  app.get('/listings', async (c) => {
    const { provider: providerId, seller, active: activeOnly } = validateQuery(listingListQuerySchema, c);

    let listings = await getAllListings();

    if (providerId) {
      listings = await getListingsByProvider(providerId);
    } else if (seller) {
      listings = await getListingsBySeller(seller);
    }

    if (activeOnly) {
      listings = listings.filter((l) => l.active);
    }

    return c.json({
      listings: listings.map((l) => ({
        ...l,
        pricePerRequest: l.pricePerRequest.toString(),
        totalRequests: l.totalRequests.toString(),
        totalRevenue: l.totalRevenue.toString(),
      })),
      total: listings.length,
    });
  });

  app.get('/listings/:id', async (c) => {
    const { id } = validateParams(listingParamsSchema, c);
    const listing = await getListing(id);
    if (!listing) {
      throw new Error('Listing not found');
    }

    const provider = getProviderById(listing.providerId);

    return c.json({
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
    });
  });

  app.post('/listings', async (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(createListingRequestSchema, c);

    // Validate provider exists
    const provider = getProviderById(body.providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${body.providerId}`);
    }

    // Store key in vault
    const vaultKey = storeKey(body.providerId, userAddress, body.apiKey);

    // Create listing
    const listing = await createListing({
      providerId: body.providerId,
      seller: userAddress,
      keyVaultId: vaultKey.id,
      pricePerRequest: body.pricePerRequest ? BigInt(body.pricePerRequest) : undefined,
      limits: body.limits,
      accessControl: body.accessControl,
    });

    return c.json(
      {
        listing: {
          ...listing,
          pricePerRequest: listing.pricePerRequest.toString(),
          totalRequests: listing.totalRequests.toString(),
          totalRevenue: listing.totalRevenue.toString(),
        },
        keyVaultId: vaultKey.id,
      },
      201
    );
  });

  app.patch('/listings/:id', async (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);
    const { id } = validateParams(listingParamsSchema, c);
    const listing = await getListing(id);
    if (!listing) {
      throw new Error('Listing not found');
    }

    // Only seller can update
    if (listing.seller.toLowerCase() !== userAddress.toLowerCase()) {
      throw new Error('Unauthorized');
    }

    const body = await validateBody(updateListingRequestSchema, c);

    const updated = await updateListing(listing.id, {
      pricePerRequest: body.pricePerRequest ? BigInt(body.pricePerRequest) : undefined,
      limits: body.limits,
      accessControl: body.accessControl,
      active: body.active,
    });

    return c.json({
      ...updated,
      pricePerRequest: updated.pricePerRequest.toString(),
      totalRequests: updated.totalRequests.toString(),
      totalRevenue: updated.totalRevenue.toString(),
    });
  });

  app.get('/listings/cheapest/:providerId', async (c) => {
    const { providerId } = validateParams(z.object({ providerId: z.string().min(1) }), c);
    const listing = await findCheapestListing(providerId);
    if (!listing) {
      throw new Error('No active listings for this provider');
    }

    return c.json({
      ...listing,
      pricePerRequest: listing.pricePerRequest.toString(),
      totalRequests: listing.totalRequests.toString(),
      totalRevenue: listing.totalRevenue.toString(),
    });
  });

  // ============================================================================
  // Proxy
  // ============================================================================

  app.post('/proxy', async (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(proxyRequestSchema, c);
    const headers = validateHeaders(z.object({
      origin: z.string().url().optional(),
      referer: z.string().url().optional(),
    }), c);
    const originDomain = extractOriginDomain(headers.origin, headers.referer);

    const response = await proxyRequest(body, {
      userAddress,
      originDomain,
      timeout: 30000,
    });

    // Set response headers
    for (const [key, value] of Object.entries(response.headers)) {
      c.res.headers.set(key, value);
    }
    c.res.headers.set('X-Request-Id', response.requestId);
    c.res.headers.set('X-Request-Cost', response.cost.toString());
    c.res.headers.set('X-Latency-Ms', response.latencyMs.toString());

    return c.json(response.body, response.status as 200);
  });

  // Convenience endpoint for direct provider access
  app.all('/proxy/:providerId/*', async (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);
    const { providerId } = validateParams(z.object({ providerId: z.string().min(1) }), c);
    const listing = await findCheapestListing(providerId);
    if (!listing) {
      throw new Error(`No active listings for provider: ${providerId}`);
    }

    // Extract path after /proxy/:providerId/
    const fullPath = c.req.path;
    const pathParts = fullPath.split(`/proxy/${providerId}`);
    const endpoint = pathParts[1] || '/';

    // Get body if present
    let body: string | Record<string, unknown> | undefined;
    if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
      try {
        body = await validateBody(z.record(z.string(), z.unknown()).optional(), c);
      } catch {
        // Body is optional for proxy requests
        body = undefined;
      }
    }

    // Get query params
    const queryParams: Record<string, string> = {};
    const url = new URL(c.req.url);
    url.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });

    const originDomain = c.req.header('origin') || c.req.header('referer');

    const response = await proxyRequest(
      {
        listingId: listing.id,
        endpoint,
        method: c.req.method as ProxyRequest['method'],
        body,
        queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      },
      {
        userAddress,
        originDomain: originDomain ? new URL(originDomain).hostname : undefined,
        timeout: 30000,
      }
    );

    for (const [key, value] of Object.entries(response.headers)) {
      c.res.headers.set(key, value);
    }
    c.res.headers.set('X-Request-Id', response.requestId);
    c.res.headers.set('X-Request-Cost', response.cost.toString());
    c.res.headers.set('X-Latency-Ms', response.latencyMs.toString());

    return c.json(response.body, response.status as 200);
  });

  // ============================================================================
  // Accounts & Payments
  // ============================================================================

  app.get('/account', async (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);

    const account = await getAccountInfo(userAddress);
    return c.json({
      address: userAddress,
      balance: account.balance.toString(),
      totalSpent: account.totalSpent.toString(),
      totalRequests: account.totalRequests.toString(),
    });
  });

  app.get('/account/balance', async (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);

    const balance = await getBalance(userAddress);
    return c.json({
      balance: balance.toString(),
      minimumDeposit: getMinimumDeposit().toString(),
    });
  });

  app.post('/account/deposit', async (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(depositRequestSchema, c);
    const amount = BigInt(body.amount);

    // Check for payment proof
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const proof = parsePaymentProof(headers);

    const result = await processDeposit(
      { amount, payer: userAddress },
      proof || undefined
    );

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({
      success: true,
      newBalance: result.newBalance.toString(),
    });
  });

  app.post('/account/withdraw', async (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(withdrawRequestSchema, c);
    const amount = BigInt(body.amount);

    const result = await processWithdraw({ amount, recipient: body.recipient }, userAddress);

    if (!result.success) {
      throw new Error(result.error || 'Withdrawal failed');
    }

    return c.json({
      success: true,
      remainingBalance: result.remainingBalance.toString(),
    });
  });

  app.get('/account/affordable/:listingId', async (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);
    const { id: listingId } = validateParams(listingParamsSchema.extend({ listingId: z.string().uuid() }), c);
    const listing = await getListing(listingId);
    if (!listing) {
      throw new Error('Listing not found');
    }

    const balance = await getBalance(userAddress);
    const affordable = calculateAffordableRequests(balance, listing.pricePerRequest);

    return c.json({
      balance: balance.toString(),
      pricePerRequest: listing.pricePerRequest.toString(),
      affordableRequests: affordable.toString(),
    });
  });

  // ============================================================================
  // Rate Limits
  // ============================================================================

  app.get('/ratelimit/:listingId', async (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);
    const { listingId } = validateParams(z.object({ listingId: z.string().uuid() }), c);
    const listing = await getListing(listingId);
    if (!listing) {
      throw new Error('Listing not found');
    }

    const usage = getRateLimitUsage(userAddress, listing.id, listing.limits);
    return c.json(usage);
  });

  // ============================================================================
  // Keys (for sellers)
  // ============================================================================

  app.get('/keys', (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);

    const keys = getKeysByOwner(userAddress);
    return c.json({ keys, total: keys.length });
  });

  app.delete('/keys/:keyId', (c) => {
    const { 'x-jeju-address': userAddress } = validateHeaders(jejuAddressHeaderSchema, c);
    const { keyId } = validateParams(apiKeyParamsSchema, c);
    const deleted = deleteKey(keyId, userAddress);
    if (!deleted) {
      throw new Error('Key not found or unauthorized');
    }

    return c.json({ success: true });
  });

  // ============================================================================
  // V1 API (for app compatibility)
  // ============================================================================
  
  // List available models (for agents/apps)
  app.get('/v1/models', (c) => {
    const providers = getConfiguredProviders();
    
    // Generate model list based on configured providers
    const models: Array<{
      id: string;
      name: string;
      provider: string;
      pricePerInputToken: string;
      pricePerOutputToken: string;
      maxContextLength: number;
      capabilities: string[];
    }> = [];
    
    for (const p of providers) {
      if (p.id === 'openai') {
        models.push(
          { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', pricePerInputToken: '2500000000000', pricePerOutputToken: '10000000000000', maxContextLength: 128000, capabilities: ['chat', 'vision', 'function-calling'] },
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', pricePerInputToken: '150000000000', pricePerOutputToken: '600000000000', maxContextLength: 128000, capabilities: ['chat', 'vision', 'function-calling'] },
          { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', pricePerInputToken: '10000000000000', pricePerOutputToken: '30000000000000', maxContextLength: 128000, capabilities: ['chat', 'vision', 'function-calling'] },
        );
      } else if (p.id === 'anthropic') {
        models.push(
          { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', provider: 'anthropic', pricePerInputToken: '3000000000000', pricePerOutputToken: '15000000000000', maxContextLength: 200000, capabilities: ['chat', 'vision'] },
          { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', provider: 'anthropic', pricePerInputToken: '250000000000', pricePerOutputToken: '1250000000000', maxContextLength: 200000, capabilities: ['chat', 'vision'] },
          { id: 'claude-3-opus-latest', name: 'Claude 3 Opus', provider: 'anthropic', pricePerInputToken: '15000000000000', pricePerOutputToken: '75000000000000', maxContextLength: 200000, capabilities: ['chat', 'vision'] },
        );
      } else if (p.id === 'groq') {
        models.push(
          { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', provider: 'groq', pricePerInputToken: '590000000', pricePerOutputToken: '790000000', maxContextLength: 128000, capabilities: ['chat'] },
          { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', provider: 'groq', pricePerInputToken: '50000000', pricePerOutputToken: '80000000', maxContextLength: 128000, capabilities: ['chat'] },
          { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', provider: 'groq', pricePerInputToken: '240000000', pricePerOutputToken: '240000000', maxContextLength: 32768, capabilities: ['chat'] },
        );
      }
    }
    
    return c.json({ models });
  });

  // Inference endpoint (for agents/apps) - forwards to /compute/chat/completions
  app.post('/v1/inference', async (c) => {
    const body = await validateBody(z.object({
      messages: z.array(z.object({
        role: z.string(),
        content: z.string(),
      })).min(1),
      model: z.string().optional(),
      maxTokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
    }), c);

    // Forward to compute endpoint which handles provider selection
    const computeResponse = await fetch('http://localhost:' + (process.env.PORT ?? '4030') + '/compute/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: body.model ?? 'llama-3.3-70b-versatile',
        messages: body.messages,
        max_tokens: body.maxTokens ?? 2048,
        temperature: body.temperature ?? 0.7,
      }),
    });

    if (!computeResponse.ok) {
      const errorData = await computeResponse.json() as { error?: string };
      return c.json(errorData, computeResponse.status as 400 | 401 | 500 | 503);
    }

    const responseData = await computeResponse.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number };
      provider?: string;
    };

    return c.json({
      content: responseData.choices[0]?.message?.content ?? '',
      model: responseData.model,
      usage: responseData.usage,
      provider: responseData.provider,
      cost: '0',
    });
  });

  // Embeddings endpoint (for agents/apps)
  app.post('/v1/embeddings', async (c) => {
    const body = await validateBody(z.object({
      input: z.union([z.string(), z.array(z.string())]),
    }), c);

    const providers = getConfiguredProviders();
    const embeddingProviders = providers.filter(p => p.categories.includes('embeddings'));
    
    if (embeddingProviders.length === 0) {
      // No embedding provider available - fail with clear error
      return c.json({
        error: 'No embedding provider configured',
        message: 'Set OPENAI_API_KEY or similar for embeddings',
      }, 503);
    }

    const provider = embeddingProviders[0];
    
    const proxyReq: ProxyRequest = {
      providerId: provider.id,
      path: 'embeddings',
      method: 'POST',
      body: JSON.stringify({
        input: body.input,
        model: provider.models[0]?.id ?? 'text-embedding-3-small',
      }),
    };

    const result = await proxyRequest(proxyReq);
    
    if ('error' in result) {
      return c.json(result, 500);
    }

    const responseData = await result.response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return c.json({
      embedding: responseData.data[0]?.embedding ?? [],
      dimensions: responseData.data[0]?.embedding?.length ?? 0,
    });
  });

  return app;
}

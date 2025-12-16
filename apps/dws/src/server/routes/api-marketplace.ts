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
  create402Response,
  parsePaymentProof,
  getMinimumDeposit,
  calculateAffordableRequests,
  // Access control
  getRateLimitUsage,
  accessControl,
  // Types
  type ProxyRequest,
  type CreateListingParams,
} from '../../api-marketplace';

export function createAPIMarketplaceRouter(): Hono {
  const app = new Hono();

  // ============================================================================
  // Health & Stats
  // ============================================================================

  app.get('/health', (c) => {
    const stats = getMarketplaceStats();
    const vaultStats = getVaultStats();
    return c.json({
      status: 'healthy',
      service: 'api-marketplace',
      marketplace: {
        ...stats,
        totalRequests: stats.totalRequests.toString(),
        totalVolume: stats.totalVolume.toString(),
        last24hRequests: stats.last24hRequests.toString(),
        last24hVolume: stats.last24hVolume.toString(),
      },
      vault: vaultStats,
    });
  });

  app.get('/stats', (c) => {
    const stats = getMarketplaceStats();
    return c.json({
      ...stats,
      totalRequests: stats.totalRequests.toString(),
      totalVolume: stats.totalVolume.toString(),
      last24hRequests: stats.last24hRequests.toString(),
      last24hVolume: stats.last24hVolume.toString(),
    });
  });

  // ============================================================================
  // Providers
  // ============================================================================

  app.get('/providers', (c) => {
    const category = c.req.query('category');
    const configuredOnly = c.req.query('configured') === 'true';

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
    const provider = getProviderById(c.req.param('id'));
    if (!provider) {
      return c.json({ error: 'Provider not found' }, 404);
    }

    return c.json({
      ...provider,
      defaultPricePerRequest: provider.defaultPricePerRequest.toString(),
      configured: !!process.env[provider.envVar],
    });
  });

  app.get('/providers/:id/health', async (c) => {
    const health = await checkProviderHealth(c.req.param('id'));
    return c.json(health);
  });

  app.get('/providers/health/all', (c) => {
    return c.json({ providers: getAllProviderHealth() });
  });

  // ============================================================================
  // Listings
  // ============================================================================

  app.get('/listings', async (c) => {
    const providerId = c.req.query('provider');
    const seller = c.req.query('seller') as Address | undefined;
    const activeOnly = c.req.query('active') !== 'false';

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
    const listing = await getListing(c.req.param('id'));
    if (!listing) {
      return c.json({ error: 'Listing not found' }, 404);
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
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const body = await c.req.json<{
      providerId: string;
      apiKey: string;
      pricePerRequest?: string;
      limits?: CreateListingParams['limits'];
      accessControl?: {
        allowedDomains?: string[];
        blockedDomains?: string[];
        allowedEndpoints?: string[];
        blockedEndpoints?: string[];
        allowedMethods?: Array<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>;
      };
    }>();

    // Validate provider exists
    const provider = getProviderById(body.providerId);
    if (!provider) {
      return c.json({ error: `Unknown provider: ${body.providerId}` }, 400);
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
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const listing = await getListing(c.req.param('id'));
    if (!listing) {
      return c.json({ error: 'Listing not found' }, 404);
    }

    // Only seller can update
    if (listing.seller.toLowerCase() !== userAddress.toLowerCase()) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    const body = await c.req.json<{
      pricePerRequest?: string;
      limits?: Partial<CreateListingParams['limits']>;
      accessControl?: Partial<CreateListingParams['accessControl']>;
      active?: boolean;
    }>();

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
    const listing = await findCheapestListing(c.req.param('providerId'));
    if (!listing) {
      return c.json({ error: 'No active listings for this provider' }, 404);
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
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const body = await c.req.json<ProxyRequest>();
    const originDomain = c.req.header('origin') || c.req.header('referer');

    const response = await proxyRequest(body, {
      userAddress,
      originDomain: originDomain ? new URL(originDomain).hostname : undefined,
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
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const providerId = c.req.param('providerId');
    const listing = await findCheapestListing(providerId);
    if (!listing) {
      return c.json({ error: `No active listings for provider: ${providerId}` }, 404);
    }

    // Extract path after /proxy/:providerId/
    const fullPath = c.req.path;
    const pathParts = fullPath.split(`/proxy/${providerId}`);
    const endpoint = pathParts[1] || '/';

    // Get body if present
    let body: string | Record<string, unknown> | undefined;
    if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
      body = await c.req.json().catch(() => undefined);
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

  app.get('/account', (c) => {
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const account = getAccountInfo(userAddress);
    return c.json({
      address: userAddress,
      balance: account.balance.toString(),
      totalSpent: account.totalSpent.toString(),
      totalRequests: account.totalRequests.toString(),
    });
  });

  app.get('/account/balance', (c) => {
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    return c.json({
      balance: getBalance(userAddress).toString(),
      minimumDeposit: getMinimumDeposit().toString(),
    });
  });

  app.post('/account/deposit', async (c) => {
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const body = await c.req.json<{ amount: string }>();
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
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const body = await c.req.json<{ amount: string }>();
    const amount = BigInt(body.amount);

    const result = await processWithdraw({ amount, recipient: userAddress }, userAddress);

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({
      success: true,
      remainingBalance: result.remainingBalance.toString(),
    });
  });

  app.get('/account/affordable/:listingId', (c) => {
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const listing = getListing(c.req.param('listingId'));
    if (!listing) {
      return c.json({ error: 'Listing not found' }, 404);
    }

    const balance = getBalance(userAddress);
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

  app.get('/ratelimit/:listingId', (c) => {
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const listing = getListing(c.req.param('listingId'));
    if (!listing) {
      return c.json({ error: 'Listing not found' }, 404);
    }

    const usage = getRateLimitUsage(userAddress, listing.id, listing.limits);
    return c.json(usage);
  });

  // ============================================================================
  // Keys (for sellers)
  // ============================================================================

  app.get('/keys', (c) => {
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const keys = getKeysByOwner(userAddress);
    return c.json({ keys, total: keys.length });
  });

  app.delete('/keys/:id', (c) => {
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const deleted = deleteKey(c.req.param('id'), userAddress);
    if (!deleted) {
      return c.json({ error: 'Key not found or unauthorized' }, 404);
    }

    return c.json({ success: true });
  });

  return app;
}

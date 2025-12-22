/**
 * Scraping Service Routes
 * Browserless-compatible web scraping API
 */

import { Hono } from 'hono';
import type { Address } from 'viem';
import { validateBody, validateQuery, validateHeaders, scrapingRequestSchema, scrapingFunctionRequestSchema, scrapingFetchQuerySchema, jejuAddressHeaderSchema } from '../../shared';

interface ScrapingNode {
  id: string;
  operator: Address;
  endpoint: string;
  region: string;
  browserType: 'chromium' | 'firefox' | 'webkit';
  maxConcurrent: number;
  currentSessions: number;
  status: 'active' | 'busy' | 'maintenance' | 'offline';
  lastSeen: number;
  capabilities: string[];
}

interface ScrapingSession {
  id: string;
  user: Address;
  nodeId: string;
  browserType: string;
  startedAt: number;
  expiresAt: number;
  pageLoads: number;
  screenshotsTaken: number;
  status: 'active' | 'expired' | 'terminated';
}

interface ScrapingRequest {
  url: string;
  waitFor?: string;          // CSS selector to wait for
  waitForTimeout?: number;   // ms
  screenshot?: boolean;
  fullPage?: boolean;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  cookies?: Array<{ name: string; value: string; domain?: string }>;
  headers?: Record<string, string>;
  javascript?: boolean;
  blockResources?: string[]; // image, stylesheet, font, etc.
}

interface ScrapingResult {
  url: string;
  html?: string;
  screenshot?: string;       // base64
  title?: string;
  statusCode?: number;
  headers?: Record<string, string>;
  cookies?: Array<{ name: string; value: string }>;
  timing?: {
    loadTime: number;
    domContentLoaded: number;
    firstPaint: number;
  };
}

const scrapingNodes = new Map<string, ScrapingNode>();
const scrapingSessions = new Map<string, ScrapingSession>();

// Browserless-compatible endpoints
const BROWSERLESS_ENDPOINTS = [
  '/content',
  '/screenshot',
  '/pdf',
  '/scrape',
  '/function',
];

export function createScrapingRouter(): Hono {
  const router = new Hono();

  // ============================================================================
  // Health & Info
  // ============================================================================

  router.get('/health', (c) => {
    const activeNodes = Array.from(scrapingNodes.values())
      .filter(n => n.status === 'active' || n.status === 'busy');
    const activeSessions = Array.from(scrapingSessions.values())
      .filter(s => s.status === 'active');

    return c.json({
      status: 'healthy',
      service: 'dws-scraping',
      nodes: {
        total: scrapingNodes.size,
        active: activeNodes.length,
        capacity: activeNodes.reduce((sum, n) => sum + n.maxConcurrent, 0),
        inUse: activeNodes.reduce((sum, n) => sum + n.currentSessions, 0),
      },
      sessions: {
        active: activeSessions.length,
      },
      endpoints: BROWSERLESS_ENDPOINTS,
    });
  });

  // ============================================================================
  // Node Management
  // ============================================================================

  // Register scraping node
  router.post('/nodes', async (c) => {
    const { 'x-jeju-address': operator } = validateHeaders(jejuAddressHeaderSchema, c);

    const body = await c.req.json<{
      endpoint: string;
      region: string;
      browserType: 'chromium' | 'firefox' | 'webkit';
      maxConcurrent: number;
      capabilities?: string[];
    }>();

    const id = crypto.randomUUID();
    const node: ScrapingNode = {
      id,
      operator,
      endpoint: body.endpoint,
      region: body.region,
      browserType: body.browserType,
      maxConcurrent: body.maxConcurrent,
      currentSessions: 0,
      status: 'active',
      lastSeen: Date.now(),
      capabilities: body.capabilities ?? [
        'screenshot', 'pdf', 'content', 'cookies', 'headers'
      ],
    };

    scrapingNodes.set(id, node);

    return c.json({
      nodeId: id,
      status: 'registered',
    }, 201);
  });

  // List nodes
  router.get('/nodes', (c) => {
    const region = c.req.query('region');
    const browserType = c.req.query('browserType');

    let nodes = Array.from(scrapingNodes.values());
    
    if (region) nodes = nodes.filter(n => n.region === region);
    if (browserType) nodes = nodes.filter(n => n.browserType === browserType);

    return c.json({
      nodes: nodes.map(n => ({
        id: n.id,
        region: n.region,
        browserType: n.browserType,
        maxConcurrent: n.maxConcurrent,
        currentSessions: n.currentSessions,
        status: n.status,
        capabilities: n.capabilities,
      })),
    });
  });

  // ============================================================================
  // Scraping Sessions
  // ============================================================================

  // Create session (for persistent browser)
  router.post('/sessions', async (c) => {
    const { 'x-jeju-address': user } = validateHeaders(jejuAddressHeaderSchema, c);

    const body = await c.req.json<{
      browserType?: 'chromium' | 'firefox' | 'webkit';
      region?: string;
      duration?: number; // seconds
    }>();

    // Find available node
    const candidates = Array.from(scrapingNodes.values())
      .filter(n => 
        n.status === 'active' && 
        n.currentSessions < n.maxConcurrent &&
        (!body.browserType || n.browserType === body.browserType) &&
        (!body.region || n.region === body.region)
      )
      .sort((a, b) => 
        (a.currentSessions / a.maxConcurrent) - (b.currentSessions / b.maxConcurrent)
      );

    const node = candidates[0];
    if (!node) {
      throw new Error('No available scraping nodes');
    }

    const sessionId = crypto.randomUUID();
    const duration = body.duration ?? 1800; // 30 min default

    const session: ScrapingSession = {
      id: sessionId,
      user,
      nodeId: node.id,
      browserType: node.browserType,
      startedAt: Date.now(),
      expiresAt: Date.now() + duration * 1000,
      pageLoads: 0,
      screenshotsTaken: 0,
      status: 'active',
    };

    scrapingSessions.set(sessionId, session);
    node.currentSessions++;

    return c.json({
      sessionId,
      browserType: node.browserType,
      wsEndpoint: `ws://${node.endpoint}/session/${sessionId}`,
      httpEndpoint: `/scraping/sessions/${sessionId}`,
      expiresAt: session.expiresAt,
    }, 201);
  });

  // Get session status
  router.get('/sessions/:id', (c) => {
    const session = scrapingSessions.get(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({
      sessionId: session.id,
      browserType: session.browserType,
      status: session.status,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      pageLoads: session.pageLoads,
      screenshotsTaken: session.screenshotsTaken,
    });
  });

  // Terminate session
  router.delete('/sessions/:id', (c) => {
    const user = c.req.header('x-jeju-address')?.toLowerCase();
    const session = scrapingSessions.get(c.req.param('id'));
    
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    if (session.user.toLowerCase() !== user) {
      throw new Error('Not authorized');
    }

    session.status = 'terminated';
    
    const node = scrapingNodes.get(session.nodeId);
    if (node) node.currentSessions--;

    return c.json({ success: true });
  });

  // ============================================================================
  // Browserless-Compatible API
  // ============================================================================

  // Get page content
  router.post('/content', async (c) => {
    const body = await c.req.json<ScrapingRequest>();
    
    if (!body.url) {
      return c.json({ error: 'URL required' }, 400);
    }

    try {
      const result = await performScrape(body, 'content');
      return c.json(result);
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Scraping failed',
      }, 500);
    }
  });

  // Take screenshot
  router.post('/screenshot', async (c) => {
    const body = await c.req.json<ScrapingRequest>();
    
    if (!body.url) {
      return c.json({ error: 'URL required' }, 400);
    }

    try {
      const result = await performScrape({ ...body, screenshot: true }, 'screenshot');
      
      if (result.screenshot) {
        // Return as image
        const format = body.format ?? 'png';
        const buffer = Buffer.from(result.screenshot, 'base64');
        return new Response(buffer, {
          headers: {
            'Content-Type': `image/${format}`,
            'Content-Length': String(buffer.length),
          },
        });
      }
      
      throw new Error('Screenshot failed');
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Screenshot failed',
      }, 500);
    }
  });

  // Generate PDF
  router.post('/pdf', async (c) => {
    const body = await c.req.json<ScrapingRequest & {
      printBackground?: boolean;
      landscape?: boolean;
      format?: 'A4' | 'Letter' | 'Legal';
      margin?: { top?: string; right?: string; bottom?: string; left?: string };
    }>();
    
    if (!body.url) {
      return c.json({ error: 'URL required' }, 400);
    }

    // PDF generation requires a headless browser
    return c.json({
      error: 'PDF generation not available',
      message: 'Set BROWSERLESS_URL to enable PDF generation',
      url: body.url,
    }, 501);
  });

  // Scrape with selectors
  router.post('/scrape', async (c) => {
    const body = await validateBody(scrapingRequestSchema, c);
    const result = await performScrape(body, 'scrape');
    return c.json(result);
  });

  // Run custom function
  router.post('/function', async (c) => {
    const body = await validateBody(scrapingFunctionRequestSchema, c);

    // Function execution requires a headless browser
    return c.json({
      error: 'Function execution not available',
      message: 'Set BROWSERLESS_URL to enable browser-based function execution',
    }, 501);
  });

  // ============================================================================
  // Quick Scrape (stateless)
  // ============================================================================

  router.get('/fetch', async (c) => {
    const { url, screenshot, waitFor } = validateQuery(scrapingFetchQuerySchema, c);
    const result = await performScrape({
      url,
      screenshot: screenshot ?? false,
      waitFor,
      javascript: true,
    }, screenshot ? 'screenshot' : 'content');
    return c.json(result);
  });

  return router;
}

// Scraping implementation (HTTP fetch, set BROWSERLESS_URL for browser-rendered content)
async function performScrape(
  request: ScrapingRequest,
  type: 'content' | 'screenshot' | 'pdf' | 'scrape'
): Promise<ScrapingResult> {
  const startTime = Date.now();

  // Use fetch for basic HTTP content (set BROWSERLESS_URL for browser-rendered content)
  const response = await fetch(request.url, {
    headers: {
      'User-Agent': request.userAgent ?? 'DWS-Scraper/1.0',
      ...request.headers,
    },
  });

  const html = await response.text();

  const result: ScrapingResult = {
    url: request.url,
    statusCode: response.status,
    headers: Object.fromEntries([...response.headers]),
    timing: {
      loadTime: Date.now() - startTime,
      domContentLoaded: Date.now() - startTime,
      firstPaint: Date.now() - startTime,
    },
  };

  if (type === 'content' || type === 'scrape') {
    result.html = html;
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    result.title = titleMatch?.[1];
  }

  if (type === 'screenshot') {
    // Screenshot requires a browser instance - return error if not available
    throw new Error('Screenshot capture requires BROWSERLESS_URL or browser pool configuration. Set BROWSERLESS_URL env var to enable screenshots.');
  }

  return result;
}


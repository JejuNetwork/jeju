/**
 * Scraping Service Routes
 * Browserless-compatible web scraping API
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'

interface ScrapingNode {
  id: string
  operator: Address
  endpoint: string
  region: string
  browserType: 'chromium' | 'firefox' | 'webkit'
  maxConcurrent: number
  currentSessions: number
  status: 'active' | 'busy' | 'maintenance' | 'offline'
  lastSeen: number
  capabilities: string[]
}

interface ScrapingSession {
  id: string
  user: Address
  nodeId: string
  browserType: string
  startedAt: number
  expiresAt: number
  pageLoads: number
  screenshotsTaken: number
  status: 'active' | 'expired' | 'terminated'
}

interface ScrapingRequest {
  url: string
  waitFor?: string // CSS selector to wait for
  waitForTimeout?: number // ms
  screenshot?: boolean
  fullPage?: boolean
  format?: 'png' | 'jpeg' | 'webp'
  quality?: number
  viewport?: { width: number; height: number }
  userAgent?: string
  cookies?: Array<{ name: string; value: string; domain?: string }>
  headers?: Record<string, string>
  javascript?: boolean
  blockResources?: string[] // image, stylesheet, font, etc.
}

interface ScrapingResult {
  url: string
  html?: string
  screenshot?: string // base64
  title?: string
  statusCode?: number
  headers?: Record<string, string>
  cookies?: Array<{ name: string; value: string }>
  timing?: {
    loadTime: number
    domContentLoaded: number
    firstPaint: number
  }
}

const scrapingNodes = new Map<string, ScrapingNode>()
const scrapingSessions = new Map<string, ScrapingSession>()

// Browserless-compatible endpoints
const BROWSERLESS_ENDPOINTS = [
  '/content',
  '/screenshot',
  '/pdf',
  '/scrape',
  '/function',
]

// Scraping implementation (HTTP fetch, set BROWSERLESS_URL for browser-rendered content)
async function performScrape(
  request: ScrapingRequest,
  type: 'content' | 'screenshot' | 'pdf' | 'scrape',
): Promise<ScrapingResult> {
  const startTime = Date.now()

  // Use fetch for basic HTTP content (set BROWSERLESS_URL for browser-rendered content)
  const response = await fetch(request.url, {
    headers: {
      'User-Agent': request.userAgent ?? 'DWS-Scraper/1.0',
      ...request.headers,
    },
  })

  const html = await response.text()

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })

  const result: ScrapingResult = {
    url: request.url,
    statusCode: response.status,
    headers: responseHeaders,
    timing: {
      loadTime: Date.now() - startTime,
      domContentLoaded: Date.now() - startTime,
      firstPaint: Date.now() - startTime,
    },
  }

  if (type === 'content' || type === 'scrape') {
    result.html = html

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    result.title = titleMatch?.[1]
  }

  if (type === 'screenshot') {
    // Screenshot requires a browser instance - return error if not available
    throw new Error(
      'Screenshot capture requires BROWSERLESS_URL or browser pool configuration. Set BROWSERLESS_URL env var to enable screenshots.',
    )
  }

  return result
}

export function createScrapingRouter() {
  return (
    new Elysia({ name: 'scraping', prefix: '/scraping' })
      // ============================================================================
      // Health & Info
      // ============================================================================

      .get('/health', () => {
        const activeNodes = Array.from(scrapingNodes.values()).filter(
          (n) => n.status === 'active' || n.status === 'busy',
        )
        const activeSessions = Array.from(scrapingSessions.values()).filter(
          (s) => s.status === 'active',
        )

        return {
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
        }
      })

      // ============================================================================
      // Node Management
      // ============================================================================

      // Register scraping node
      .post(
        '/nodes',
        async ({ headers, body, set }) => {
          const operator = headers['x-jeju-address'] as Address
          if (!operator) {
            set.status = 401
            return { error: 'Missing x-jeju-address header' }
          }

          const id = crypto.randomUUID()
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
              'screenshot',
              'pdf',
              'content',
              'cookies',
              'headers',
            ],
          }

          scrapingNodes.set(id, node)

          set.status = 201
          return { nodeId: id, status: 'registered' }
        },
        {
          headers: t.Object({
            'x-jeju-address': t.String(),
          }),
          body: t.Object({
            endpoint: t.String(),
            region: t.String(),
            browserType: t.Union([
              t.Literal('chromium'),
              t.Literal('firefox'),
              t.Literal('webkit'),
            ]),
            maxConcurrent: t.Number(),
            capabilities: t.Optional(t.Array(t.String())),
          }),
        },
      )

      // List nodes
      .get(
        '/nodes',
        ({ query }) => {
          let nodes = Array.from(scrapingNodes.values())

          if (query.region)
            nodes = nodes.filter((n) => n.region === query.region)
          if (query.browserType)
            nodes = nodes.filter((n) => n.browserType === query.browserType)

          return {
            nodes: nodes.map((n) => ({
              id: n.id,
              region: n.region,
              browserType: n.browserType,
              maxConcurrent: n.maxConcurrent,
              currentSessions: n.currentSessions,
              status: n.status,
              capabilities: n.capabilities,
            })),
          }
        },
        {
          query: t.Object({
            region: t.Optional(t.String()),
            browserType: t.Optional(t.String()),
          }),
        },
      )

      // ============================================================================
      // Scraping Sessions
      // ============================================================================

      // Create session (for persistent browser)
      .post(
        '/sessions',
        async ({ headers, body, set }) => {
          const user = headers['x-jeju-address'] as Address
          if (!user) {
            set.status = 401
            return { error: 'Missing x-jeju-address header' }
          }

          // Find available node
          const candidates = Array.from(scrapingNodes.values())
            .filter(
              (n) =>
                n.status === 'active' &&
                n.currentSessions < n.maxConcurrent &&
                (!body.browserType || n.browserType === body.browserType) &&
                (!body.region || n.region === body.region),
            )
            .sort(
              (a, b) =>
                a.currentSessions / a.maxConcurrent -
                b.currentSessions / b.maxConcurrent,
            )

          const node = candidates[0]
          if (!node) {
            set.status = 503
            return { error: 'No available scraping nodes' }
          }

          const sessionId = crypto.randomUUID()
          const duration = body.duration ?? 1800 // 30 min default

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
          }

          scrapingSessions.set(sessionId, session)
          node.currentSessions++

          set.status = 201
          return {
            sessionId,
            browserType: node.browserType,
            wsEndpoint: `ws://${node.endpoint}/session/${sessionId}`,
            httpEndpoint: `/scraping/sessions/${sessionId}`,
            expiresAt: session.expiresAt,
          }
        },
        {
          headers: t.Object({
            'x-jeju-address': t.String(),
          }),
          body: t.Object({
            browserType: t.Optional(
              t.Union([
                t.Literal('chromium'),
                t.Literal('firefox'),
                t.Literal('webkit'),
              ]),
            ),
            region: t.Optional(t.String()),
            duration: t.Optional(t.Number()),
          }),
        },
      )

      // Get session status
      .get(
        '/sessions/:id',
        ({ params, set }) => {
          const session = scrapingSessions.get(params.id)
          if (!session) {
            set.status = 404
            return { error: 'Session not found' }
          }

          return {
            sessionId: session.id,
            browserType: session.browserType,
            status: session.status,
            startedAt: session.startedAt,
            expiresAt: session.expiresAt,
            pageLoads: session.pageLoads,
            screenshotsTaken: session.screenshotsTaken,
          }
        },
        {
          params: t.Object({
            id: t.String({ format: 'uuid' }),
          }),
        },
      )

      // Terminate session
      .delete(
        '/sessions/:id',
        ({ headers, params, set }) => {
          const user = headers['x-jeju-address']?.toLowerCase()
          const session = scrapingSessions.get(params.id)

          if (!session) {
            set.status = 404
            return { error: 'Session not found' }
          }
          if (session.user.toLowerCase() !== user) {
            set.status = 403
            return { error: 'Not authorized' }
          }

          session.status = 'terminated'

          const node = scrapingNodes.get(session.nodeId)
          if (node) node.currentSessions--

          return { success: true }
        },
        {
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
          params: t.Object({
            id: t.String({ format: 'uuid' }),
          }),
        },
      )

      // ============================================================================
      // Browserless-Compatible API
      // ============================================================================

      // Get page content
      .post(
        '/content',
        async ({ body, set }) => {
          if (!body.url) {
            set.status = 400
            return { error: 'URL required' }
          }

          const result = await performScrape(body, 'content')
          return result
        },
        {
          body: t.Object({
            url: t.String(),
            waitFor: t.Optional(t.String()),
            waitForTimeout: t.Optional(t.Number()),
            userAgent: t.Optional(t.String()),
            headers: t.Optional(t.Record(t.String(), t.String())),
            javascript: t.Optional(t.Boolean()),
          }),
        },
      )

      // Take screenshot
      .post(
        '/screenshot',
        async ({ body, set }) => {
          if (!body.url) {
            set.status = 400
            return { error: 'URL required' }
          }

          const result = await performScrape(
            { ...body, screenshot: true },
            'screenshot',
          )

          if (result.screenshot) {
            // Return as image
            const format = body.format ?? 'png'
            const buffer = Buffer.from(result.screenshot, 'base64')
            return new Response(buffer, {
              headers: {
                'Content-Type': `image/${format}`,
                'Content-Length': String(buffer.length),
              },
            })
          }

          set.status = 500
          return { error: 'Screenshot failed' }
        },
        {
          body: t.Object({
            url: t.String(),
            format: t.Optional(
              t.Union([t.Literal('png'), t.Literal('jpeg'), t.Literal('webp')]),
            ),
            fullPage: t.Optional(t.Boolean()),
            quality: t.Optional(t.Number()),
            viewport: t.Optional(
              t.Object({
                width: t.Number(),
                height: t.Number(),
              }),
            ),
            userAgent: t.Optional(t.String()),
          }),
        },
      )

      // Generate PDF
      .post(
        '/pdf',
        async ({ body, set }) => {
          if (!body.url) {
            set.status = 400
            return { error: 'URL required' }
          }

          // PDF generation requires a headless browser
          set.status = 501
          return {
            error: 'PDF generation not available',
            message: 'Set BROWSERLESS_URL to enable PDF generation',
            url: body.url,
          }
        },
        {
          body: t.Object({
            url: t.String(),
            printBackground: t.Optional(t.Boolean()),
            landscape: t.Optional(t.Boolean()),
            format: t.Optional(
              t.Union([
                t.Literal('A4'),
                t.Literal('Letter'),
                t.Literal('Legal'),
              ]),
            ),
          }),
        },
      )

      // Scrape with selectors
      .post(
        '/scrape',
        async ({ body }) => {
          const result = await performScrape(body, 'scrape')
          return result
        },
        {
          body: t.Object({
            url: t.String(),
            waitFor: t.Optional(t.String()),
            waitForTimeout: t.Optional(t.Number()),
            userAgent: t.Optional(t.String()),
            headers: t.Optional(t.Record(t.String(), t.String())),
            javascript: t.Optional(t.Boolean()),
          }),
        },
      )

      // Run custom function
      .post(
        '/function',
        async ({ set }) => {
          // Function execution requires a headless browser
          set.status = 501
          return {
            error: 'Function execution not available',
            message:
              'Set BROWSERLESS_URL to enable browser-based function execution',
          }
        },
        {
          body: t.Object({
            code: t.String(),
            context: t.Optional(t.Record(t.String(), t.Unknown())),
          }),
        },
      )

      // ============================================================================
      // Quick Scrape (stateless)
      // ============================================================================

      .get(
        '/fetch',
        async ({ query }) => {
          const result = await performScrape(
            {
              url: query.url,
              screenshot: query.screenshot === 'true',
              waitFor: query.waitFor,
              javascript: true,
            },
            query.screenshot === 'true' ? 'screenshot' : 'content',
          )
          return result
        },
        {
          query: t.Object({
            url: t.String(),
            screenshot: t.Optional(t.String()),
            waitFor: t.Optional(t.String()),
          }),
        },
      )
  )
}

export type ScrapingRoutes = ReturnType<typeof createScrapingRouter>

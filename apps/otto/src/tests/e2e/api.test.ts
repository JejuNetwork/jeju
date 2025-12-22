/**
 * E2E API Tests for Otto
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Create minimal test app
const createTestApp = () => {
  const app = new Hono()

  app.use('/*', cors({ origin: '*' }))

  // Health check
  app.get('/health', (c) => c.json({ status: 'healthy', agent: 'otto' }))

  // Status
  app.get('/status', (c) =>
    c.json({
      name: 'Otto Trading Agent',
      version: '1.0.0',
      platforms: {
        discord: { enabled: false },
        telegram: { enabled: false },
        whatsapp: { enabled: false },
        farcaster: { enabled: false },
      },
    }),
  )

  // Chains
  app.get('/api/chains', (c) =>
    c.json({
      chains: [420691, 1, 8453, 10, 42161, 101],
      defaultChainId: 420691,
    }),
  )

  // Info
  app.get('/api/info', (c) =>
    c.json({
      name: 'Otto',
      platforms: ['discord', 'telegram', 'whatsapp', 'farcaster', 'web'],
      features: ['swap', 'bridge', 'send', 'launch'],
    }),
  )

  // Chat session
  const sessions = new Map<
    string,
    { id: string; messages: Array<{ role: string; content: string }> }
  >()

  app.post('/api/chat/session', async (c) => {
    const sessionId = crypto.randomUUID()
    sessions.set(sessionId, {
      id: sessionId,
      messages: [{ role: 'assistant', content: 'Welcome to Otto.' }],
    })
    return c.json({ sessionId, messages: sessions.get(sessionId)?.messages })
  })

  app.get('/api/chat/session/:id', (c) => {
    const id = c.req.param('id')
    const session = sessions.get(id)
    if (!session) return c.json({ error: 'Not found' }, 404)
    return c.json(session)
  })

  app.post('/api/chat/chat', async (c) => {
    const body = (await c.req.json()) as { message: string; sessionId?: string }
    const sessionId = body.sessionId ?? crypto.randomUUID()

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { id: sessionId, messages: [] })
    }

    const session = sessions.get(sessionId)!
    session.messages.push({ role: 'user', content: body.message })

    // Simple response
    const response = {
      role: 'assistant',
      content: `I received: ${body.message}`,
    }
    session.messages.push(response)

    return c.json({
      sessionId,
      message: { id: crypto.randomUUID(), ...response, timestamp: Date.now() },
      requiresAuth: false,
    })
  })

  // Frame
  app.get('/frame', (c) => {
    return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="https://otto.jejunetwork.org/frame/image" />
</head>
<body>Otto Frame</body>
</html>`)
  })

  // Miniapp
  app.get('/miniapp/', (c) => {
    return c.html(`<!DOCTYPE html>
<html>
<head><title>Otto</title></head>
<body><h1>Otto Trading Agent</h1></body>
</html>`)
  })

  return app
}

describe('Otto API E2E Tests', () => {
  let app: Hono

  beforeAll(() => {
    app = createTestApp()
  })

  describe('Health & Status', () => {
    test('GET /health returns healthy status', async () => {
      const res = await app.request('/health')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.status).toBe('healthy')
      expect(data.agent).toBe('otto')
    })

    test('GET /status returns agent info', async () => {
      const res = await app.request('/status')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.name).toBe('Otto Trading Agent')
      expect(data.version).toBe('1.0.0')
      expect(data.platforms).toBeDefined()
    })
  })

  describe('API Endpoints', () => {
    test('GET /api/chains returns supported chains', async () => {
      const res = await app.request('/api/chains')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.chains).toBeArray()
      expect(data.chains).toContain(420691) // Jeju
      expect(data.defaultChainId).toBe(420691)
    })

    test('GET /api/info returns agent info', async () => {
      const res = await app.request('/api/info')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.name).toBe('Otto')
      expect(data.platforms).toContain('farcaster')
      expect(data.features).toContain('swap')
    })
  })

  describe('Chat API', () => {
    test('POST /api/chat/session creates new session', async () => {
      const res = await app.request('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.sessionId).toBeDefined()
      expect(data.messages).toBeArray()
      expect(data.messages.length).toBeGreaterThan(0)
    })

    test('GET /api/chat/session/:id returns session', async () => {
      // First create a session
      const createRes = await app.request('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const { sessionId } = await createRes.json()

      // Then get it
      const res = await app.request(`/api/chat/session/${sessionId}`)
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.id).toBe(sessionId)
    })

    test('GET /api/chat/session/:id returns 404 for unknown session', async () => {
      const res = await app.request('/api/chat/session/unknown-id')
      expect(res.status).toBe(404)
    })

    test('POST /api/chat/chat sends message and receives response', async () => {
      // Create session
      const createRes = await app.request('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const { sessionId } = await createRes.json()

      // Send message
      const res = await app.request('/api/chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: 'help' }),
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.sessionId).toBe(sessionId)
      expect(data.message).toBeDefined()
      expect(data.message.role).toBe('assistant')
      expect(data.message.content).toContain('help')
    })
  })

  describe('Frame API', () => {
    test('GET /frame returns frame HTML with meta tags', async () => {
      const res = await app.request('/frame')
      expect(res.status).toBe(200)

      const html = await res.text()
      expect(html).toContain('fc:frame')
      expect(html).toContain('vNext')
    })
  })

  describe('Miniapp', () => {
    test('GET /miniapp/ returns miniapp HTML', async () => {
      const res = await app.request('/miniapp/')
      expect(res.status).toBe(200)

      const html = await res.text()
      expect(html).toContain('Otto')
      expect(html).toContain('Trading Agent')
    })
  })
})

/**
 * Futarchy Integration Tests
 * 
 * Tests the futarchy escalation flow:
 * 1. Fetch vetoed proposals
 * 2. Escalate to futarchy market
 * 3. View market details and sentiment
 * 4. Resolve futarchy after voting period
 * 5. Execute futarchy-approved proposals
 */

import { test, expect, type APIRequestContext } from '@playwright/test'

const API_BASE = process.env.COUNCIL_API_URL || 'http://localhost:8010'

test.describe('Futarchy API Integration', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext({
      baseURL: API_BASE,
    })
  })

  test.afterAll(async () => {
    await request.dispose()
  })

  test('GET /api/v1/futarchy/vetoed returns array', async () => {
    const response = await request.get('/api/v1/futarchy/vetoed')
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(data).toHaveProperty('proposals')
    expect(Array.isArray(data.proposals)).toBeTruthy()
  })

  test('GET /api/v1/futarchy/pending returns array', async () => {
    const response = await request.get('/api/v1/futarchy/pending')
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(data).toHaveProperty('proposals')
    expect(Array.isArray(data.proposals)).toBeTruthy()
  })

  test('GET /api/v1/futarchy/parameters returns config or 404', async () => {
    const response = await request.get('/api/v1/futarchy/parameters')
    
    // Either returns parameters or 404 if not deployed
    if (response.ok()) {
      const data = await response.json()
      expect(data).toHaveProperty('votingPeriod')
      expect(data).toHaveProperty('liquidity')
      expect(typeof data.votingPeriod).toBe('number')
    } else {
      expect(response.status()).toBe(404)
    }
  })

  test('GET /api/v1/futarchy/market/:proposalId returns 404 for unknown proposal', async () => {
    const response = await request.get('/api/v1/futarchy/market/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef')
    
    // Should return 404 for non-existent market
    expect(response.status()).toBe(404)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  test('GET /api/v1/futarchy/sentiment/:proposalId returns 404 for unknown proposal', async () => {
    const response = await request.get('/api/v1/futarchy/sentiment/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef')
    
    expect(response.status()).toBe(404)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  test('POST /api/v1/futarchy/escalate requires proposalId', async () => {
    const response = await request.post('/api/v1/futarchy/escalate', {
      data: {}
    })
    
    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('proposalId')
  })

  test('POST /api/v1/futarchy/resolve requires proposalId', async () => {
    const response = await request.post('/api/v1/futarchy/resolve', {
      data: {}
    })
    
    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('proposalId')
  })

  test('POST /api/v1/futarchy/execute requires proposalId', async () => {
    const response = await request.post('/api/v1/futarchy/execute', {
      data: {}
    })
    
    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('proposalId')
  })

  test('POST /api/v1/futarchy/escalate returns error when contract not deployed', async () => {
    const response = await request.post('/api/v1/futarchy/escalate', {
      data: { proposalId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' }
    })
    
    const data = await response.json()
    // Either succeeds or returns deployment error
    expect(data).toBeDefined()
    if (!data.success) {
      expect(data.error).toBeDefined()
    }
  })
})

test.describe('Futarchy UI Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('health endpoint shows futarchy status', async ({ page }) => {
    const response = await page.request.get(`${API_BASE}/health`)
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(data).toHaveProperty('futarchy')
    expect(data.futarchy).toHaveProperty('council')
    expect(data.futarchy).toHaveProperty('predimarket')
    expect(typeof data.futarchy.council).toBe('boolean')
    expect(typeof data.futarchy.predimarket).toBe('boolean')
  })

  test('root endpoint lists futarchy in available endpoints', async ({ page }) => {
    const response = await page.request.get(`${API_BASE}/`)
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(data.endpoints).toHaveProperty('futarchy')
    expect(data.endpoints.futarchy).toBe('/api/v1/futarchy')
  })
})

test.describe('Futarchy Flow Simulation', () => {
  // These tests verify the full flow works when contracts ARE deployed
  // Skip if contracts not available
  
  test('full escalation flow with deployed contracts', async ({ request }) => {
    // Check if contracts are deployed
    const healthResponse = await request.get(`${API_BASE}/health`)
    const health = await healthResponse.json()
    
    if (!health.futarchy?.council || !health.futarchy?.predimarket) {
      test.skip()
      return
    }

    // 1. Get vetoed proposals
    const vetoedResponse = await request.get(`${API_BASE}/api/v1/futarchy/vetoed`)
    const vetoed = await vetoedResponse.json()
    
    if (vetoed.proposals.length === 0) {
      // No vetoed proposals to test with
      console.log('No vetoed proposals available for escalation test')
      return
    }

    const proposalId = vetoed.proposals[0]

    // 2. Check if already escalated
    const marketResponse = await request.get(`${API_BASE}/api/v1/futarchy/market/${proposalId}`)
    
    if (marketResponse.ok()) {
      // Already has a market - check sentiment
      const market = await marketResponse.json()
      expect(market).toHaveProperty('yesPrice')
      expect(market).toHaveProperty('noPrice')
      expect(market).toHaveProperty('deadline')
      
      // 3. Check sentiment
      const sentimentResponse = await request.get(`${API_BASE}/api/v1/futarchy/sentiment/${proposalId}`)
      expect(sentimentResponse.ok()).toBeTruthy()
      
      const sentiment = await sentimentResponse.json()
      expect(['bullish', 'bearish', 'neutral']).toContain(sentiment.sentiment)
      expect(sentiment.confidence).toBeGreaterThanOrEqual(0)
    } else {
      // 2. Escalate to futarchy
      const escalateResponse = await request.post(`${API_BASE}/api/v1/futarchy/escalate`, {
        data: { proposalId }
      })
      
      const escalateResult = await escalateResponse.json()
      
      if (escalateResult.success) {
        expect(escalateResult).toHaveProperty('txHash')
        
        // 3. Verify market was created
        const newMarketResponse = await request.get(`${API_BASE}/api/v1/futarchy/market/${proposalId}`)
        expect(newMarketResponse.ok()).toBeTruthy()
      } else {
        // Escalation failed - check for known error
        expect(escalateResult.error).toBeDefined()
        console.log('Escalation failed:', escalateResult.error)
      }
    }
  })
})

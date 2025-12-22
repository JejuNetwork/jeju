// Load Testing for Council API
// These tests require the API to be running at API_URL (default: localhost:8010)
// Run with REQUIRE_API=true to fail instead of skip when API is down
import { describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(30000)

const API_URL = process.env.API_URL ?? 'http://localhost:8010'
const REQUIRE_API = process.env.REQUIRE_API === 'true'

async function checkApi(): Promise<boolean> {
  try {
    const r = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return r.ok
  } catch {
    return false
  }
}

async function benchmark(
  name: string,
  fn: () => Promise<Response>,
  iterations: number,
) {
  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  return {
    name,
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    min: times[0],
    max: times[times.length - 1],
    p95: times[Math.floor(times.length * 0.95)],
  }
}

async function concurrent(fn: () => Promise<Response>, count: number) {
  const start = performance.now()
  const results = await Promise.allSettled(Array.from({ length: count }, fn))
  return {
    success: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
    durationMs: performance.now() - start,
  }
}

// Check API availability once at module load
const apiAvailable = await checkApi()

// Skip all tests if API is not available (unless REQUIRE_API=true)
const testFn = apiAvailable ? test : test.skip

if (!apiAvailable) {
  if (REQUIRE_API) {
    throw new Error(`API not running at ${API_URL}. Start with: bun run dev`)
  }
  console.log(
    `⚠️  API not running at ${API_URL} - load tests skipped (set REQUIRE_API=true to fail)`,
  )
}

describe('Load Tests', () => {
  testFn('health endpoint latency', async () => {
    const result = await benchmark(
      'health',
      () => fetch(`${API_URL}/health`),
      50,
    )
    console.log(
      `✅ Health: avg=${result.avg.toFixed(1)}ms p95=${result.p95.toFixed(1)}ms max=${result.max.toFixed(1)}ms`,
    )
    expect(result.avg).toBeLessThan(100)
    expect(result.p95).toBeLessThan(200)
  })

  testFn('metrics endpoint latency', async () => {
    const result = await benchmark(
      'metrics',
      () => fetch(`${API_URL}/metrics`),
      50,
    )
    console.log(
      `✅ Metrics: avg=${result.avg.toFixed(1)}ms p95=${result.p95.toFixed(1)}ms`,
    )
    expect(result.avg).toBeLessThan(100)
  })

  testFn('assess endpoint latency', async () => {
    const check = await fetch(`${API_URL}/api/v1/proposals/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test',
        summary: 'Test',
        description: 'Test',
      }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)
    if (!check?.ok) {
      console.log(
        '⚠️  Assess endpoint unavailable (Ollama may not be running) - skipping',
      )
      return
    }
    const result = await benchmark(
      'assess',
      () =>
        fetch(`${API_URL}/api/v1/proposals/assess`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Test',
            summary: 'Test',
            description: 'Test',
          }),
        }),
      5,
    )
    console.log(
      `✅ Assess: avg=${result.avg.toFixed(1)}ms p95=${result.p95.toFixed(1)}ms`,
    )
    expect(result.avg).toBeLessThan(10000)
  })

  testFn('concurrent requests (100)', async () => {
    const result = await concurrent(() => fetch(`${API_URL}/health`), 100)
    console.log(
      `✅ Concurrent: ${result.success}/100 in ${result.durationMs.toFixed(0)}ms`,
    )
    expect(result.success).toBeGreaterThanOrEqual(95)
  })

  testFn('burst load (2x100 waves)', async () => {
    const w1 = await concurrent(() => fetch(`${API_URL}/health`), 100)
    const w2 = await concurrent(() => fetch(`${API_URL}/health`), 100)
    console.log(`✅ Burst: wave1=${w1.success} wave2=${w2.success}`)
    expect(w1.success + w2.success).toBeGreaterThanOrEqual(190)
  })

  testFn('sustained load (50 req @ 10/s)', async () => {
    let success = 0
    for (let i = 0; i < 50; i++) {
      const r = await fetch(`${API_URL}/health`)
      if (r.ok) success++
      await new Promise((r) => setTimeout(r, 100))
    }
    console.log(`✅ Sustained: ${success}/50`)
    expect(success).toBe(50)
  })
})

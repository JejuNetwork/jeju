#!/usr/bin/env bun
/**
 * Verify Deployment Script
 *
 * Verifies both frontend and backend are working after deployment.
 * Run after deploy.ts or as part of CI/CD.
 *
 * Usage:
 *   bun run scripts/verify-deployment.ts [--url https://example.jejunetwork.org]
 */

import { parseArgs } from 'node:util'
import { z } from 'zod'

const args = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4500' },
    frontend: { type: 'string' },
    timeout: { type: 'string', default: '30000' },
    verbose: { type: 'boolean', default: false },
  },
})

const BASE_URL = args.values.url!
const FRONTEND_URL = args.values.frontend || BASE_URL
const TIMEOUT = Number(args.values.timeout)
const VERBOSE = args.values.verbose

// Schemas for response validation
const HealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string(),
  services: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
    }),
  ),
})

const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  endpoints: z.record(z.string()),
})

const A2ACardSchema = z.object({
  protocolVersion: z.string(),
  name: z.string(),
  skills: z.array(z.object({ id: z.string() })),
})

const MCPInfoSchema = z.object({
  name: z.string(),
  tools: z.array(z.object({ name: z.string() })),
})

type VerifyResult = {
  name: string
  passed: boolean
  latency: number
  error?: string
  details?: string
}

async function verify(
  name: string,
  check: () => Promise<{ passed: boolean; details?: string }>,
): Promise<VerifyResult> {
  const start = Date.now()
  try {
    const { passed, details } = await check()
    return { name, passed, latency: Date.now() - start, details }
  } catch (err) {
    return {
      name,
      passed: false,
      latency: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
): Promise<{ data: T | null; ok: boolean; status: number }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    return { data: null, ok: false, status: response.status }
  }

  const json = await response.json()
  const parsed = schema.safeParse(json)

  if (!parsed.success) {
    return { data: null, ok: false, status: response.status }
  }

  return { data: parsed.data, ok: true, status: response.status }
}

// ========================================================================
// Verification Checks
// ========================================================================

const checks: Array<{
  name: string
  category: 'frontend' | 'backend' | 'integration'
  check: () => Promise<{ passed: boolean; details?: string }>
}> = [
  // Frontend Checks
  {
    name: 'Frontend index.html loads',
    category: 'frontend',
    check: async () => {
      const response = await fetch(FRONTEND_URL, {
        signal: AbortSignal.timeout(TIMEOUT),
      })
      const html = await response.text()
      const hasRoot = html.includes('id="app"') || html.includes('id="root"')
      return {
        passed: response.ok && hasRoot,
        details: `Status: ${response.status}, Has app root: ${hasRoot}`,
      }
    },
  },
  {
    name: 'Frontend static assets',
    category: 'frontend',
    check: async () => {
      const html = await fetch(FRONTEND_URL).then((r) => r.text())
      const jsMatch = html.match(/src="([^"]+\.js)"/g)
      const cssMatch = html.match(/href="([^"]+\.css)"/g)

      const assetChecks: boolean[] = []

      for (const match of jsMatch?.slice(0, 3) || []) {
        const path = match.match(/src="([^"]+)"/)?.[1]
        if (path) {
          const url = path.startsWith('http')
            ? path
            : `${FRONTEND_URL}${path.startsWith('/') ? '' : '/'}${path}`
          const response = await fetch(url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(TIMEOUT),
          }).catch(() => null)
          assetChecks.push(response?.ok === true)
        }
      }

      const passed = assetChecks.length === 0 || assetChecks.every(Boolean)
      return {
        passed,
        details: `${assetChecks.filter(Boolean).length}/${assetChecks.length} assets OK`,
      }
    },
  },

  // Backend Health Checks
  {
    name: 'Backend health endpoint',
    category: 'backend',
    check: async () => {
      const { data, ok, status } = await fetchJson(
        `${BASE_URL}/health`,
        HealthSchema,
      )
      return {
        passed: ok && (data?.status === 'healthy' || data?.status === 'degraded'),
        details: data ? `Status: ${data.status}, Services: ${data.services.length}` : `HTTP ${status}`,
      }
    },
  },
  {
    name: 'Backend app info',
    category: 'backend',
    check: async () => {
      const { data, ok } = await fetchJson(`${BASE_URL}/`, AppInfoSchema)
      return {
        passed: ok && !!data?.name,
        details: data ? `${data.name} v${data.version}` : 'Failed to load app info',
      }
    },
  },
  {
    name: 'REST API available',
    category: 'backend',
    check: async () => {
      const response = await fetch(`${BASE_URL}/api/health`, {
        signal: AbortSignal.timeout(TIMEOUT),
      })
      return { passed: response.ok, details: `Status: ${response.status}` }
    },
  },

  // Protocol Checks
  {
    name: 'A2A protocol (agent card)',
    category: 'integration',
    check: async () => {
      const { data, ok } = await fetchJson(
        `${BASE_URL}/a2a/.well-known/agent-card.json`,
        A2ACardSchema,
      )
      return {
        passed: ok && !!data?.skills?.length,
        details: data ? `${data.skills.length} skills available` : 'No agent card',
      }
    },
  },
  {
    name: 'MCP protocol (tools)',
    category: 'integration',
    check: async () => {
      const { data, ok } = await fetchJson(`${BASE_URL}/mcp`, MCPInfoSchema)
      return {
        passed: ok && !!data?.tools?.length,
        details: data ? `${data.tools.length} tools available` : 'No MCP info',
      }
    },
  },
  {
    name: 'x402 payments info',
    category: 'integration',
    check: async () => {
      const response = await fetch(`${BASE_URL}/x402/info`, {
        signal: AbortSignal.timeout(TIMEOUT),
      })
      return { passed: response.ok, details: `Status: ${response.status}` }
    },
  },
  {
    name: 'Auth providers',
    category: 'integration',
    check: async () => {
      const response = await fetch(`${BASE_URL}/auth/providers`, {
        signal: AbortSignal.timeout(TIMEOUT),
      })
      return { passed: response.ok, details: `Status: ${response.status}` }
    },
  },
]

// ========================================================================
// Main
// ========================================================================

async function main() {
  console.log('')
  console.log('====================================================')
  console.log('       Deployment Verification')
  console.log('====================================================')
  console.log('')
  console.log(`Backend URL:  ${BASE_URL}`)
  console.log(`Frontend URL: ${FRONTEND_URL}`)
  console.log(`Timeout:      ${TIMEOUT}ms`)
  console.log('')

  const results: VerifyResult[] = []
  const categories = ['frontend', 'backend', 'integration'] as const

  for (const category of categories) {
    console.log(`\n${category.toUpperCase()}`)
    console.log('-'.repeat(50))

    const categoryChecks = checks.filter((c) => c.category === category)

    for (const { name, check } of categoryChecks) {
      const result = await verify(name, check)
      results.push(result)

      const icon = result.passed ? '✓' : '✗'
      const status = result.passed ? 'PASS' : 'FAIL'
      const latency = `${result.latency}ms`

      console.log(`  ${icon} ${name.padEnd(30)} ${status.padEnd(6)} ${latency}`)

      if (VERBOSE && result.details) {
        console.log(`      ${result.details}`)
      }
      if (result.error) {
        console.log(`      Error: ${result.error}`)
      }
    }
  }

  // Summary
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const avgLatency = Math.round(
    results.reduce((sum, r) => sum + r.latency, 0) / results.length,
  )

  console.log('')
  console.log('====================================================')
  console.log('       SUMMARY')
  console.log('====================================================')
  console.log('')
  console.log(`  Passed: ${passed}/${results.length}`)
  console.log(`  Failed: ${failed}`)
  console.log(`  Avg Latency: ${avgLatency}ms`)
  console.log('')

  if (failed > 0) {
    console.log('FAILED CHECKS:')
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  - ${result.name}: ${result.error || 'Check failed'}`)
    }
    console.log('')
    process.exit(1)
  }

  console.log('All checks passed! Deployment verified.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Verification failed:', err)
  process.exit(1)
})

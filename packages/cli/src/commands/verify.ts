/**
 * Jeju CLI - Verify Command
 *
 * Verify frontend and backend deployments are working correctly.
 *
 * Usage:
 *   jeju verify [app-name]              - Verify app in current dir or by name
 *   jeju verify --url https://...       - Verify specific URL
 *   jeju verify --local                 - Verify local deployment (localhost)
 *   jeju verify --network testnet       - Verify testnet deployment
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getCurrentNetwork, type NetworkType } from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import { z } from 'zod'

// Response schemas for validation
const HealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string().optional(),
  services: z
    .array(z.object({ name: z.string(), status: z.string() }))
    .optional(),
})

const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  endpoints: z.record(z.string(), z.string()).optional(),
})

const A2ACardSchema = z.object({
  protocolVersion: z.string().optional(),
  name: z.string(),
  skills: z.array(z.object({ id: z.string() })).optional(),
})

const MCPInfoSchema = z.object({
  name: z.string(),
  tools: z.array(z.object({ name: z.string() })).optional(),
})

const ManifestSchema = z.object({
  name: z.string(),
  jns: z.object({ name: z.string() }).optional(),
  ports: z.object({ main: z.number() }).optional(),
})

type VerifyResult = {
  name: string
  category: string
  passed: boolean
  latency: number
  error?: string
  details?: string
}

async function fetchWithTimeout(
  url: string,
  timeout = 10000,
): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { Accept: 'application/json' },
  })
}

async function verifyCheck(
  name: string,
  category: string,
  check: () => Promise<{ passed: boolean; details?: string }>,
): Promise<VerifyResult> {
  const start = Date.now()
  try {
    const result = await check()
    return { name, category, ...result, latency: Date.now() - start }
  } catch (err) {
    return {
      name,
      category,
      passed: false,
      latency: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

function getAppUrl(
  network: NetworkType,
  jnsName: string,
): { backend: string; frontend: string } {
  const baseDomain =
    network === 'localnet'
      ? 'localhost'
      : network === 'testnet'
        ? 'testnet.jejunetwork.org'
        : 'jejunetwork.org'

  const subdomain = jnsName.replace('.jeju', '')

  if (network === 'localnet') {
    return {
      backend: `http://localhost:4500`,
      frontend: `http://localhost:4501`,
    }
  }

  return {
    backend: `https://${subdomain}.${baseDomain}`,
    frontend: `https://${subdomain}.${baseDomain}`,
  }
}

async function runVerification(options: {
  backendUrl: string
  frontendUrl: string
  timeout: number
  verbose: boolean
}): Promise<{ passed: number; failed: number; results: VerifyResult[] }> {
  const { backendUrl, frontendUrl, timeout, verbose } = options
  const results: VerifyResult[] = []

  // Frontend checks
  results.push(
    await verifyCheck('Index page loads', 'frontend', async () => {
      const response = await fetchWithTimeout(frontendUrl, timeout)
      const html = await response.text()
      const hasRoot = html.includes('id="app"') || html.includes('id="root"')
      return {
        passed: response.ok && (hasRoot || html.includes('<!DOCTYPE html>')),
        details: `Status: ${response.status}`,
      }
    }),
  )

  // Backend checks
  results.push(
    await verifyCheck('Health endpoint', 'backend', async () => {
      const response = await fetchWithTimeout(`${backendUrl}/health`, timeout)
      const data = HealthSchema.safeParse(await response.json())
      return {
        passed:
          response.ok &&
          data.success &&
          (data.data.status === 'healthy' || data.data.status === 'degraded'),
        details: data.success
          ? `Status: ${data.data.status}`
          : `HTTP ${response.status}`,
      }
    }),
  )

  results.push(
    await verifyCheck('App info', 'backend', async () => {
      const response = await fetchWithTimeout(`${backendUrl}/`, timeout)
      const data = AppInfoSchema.safeParse(await response.json())
      return {
        passed: response.ok && data.success,
        details: data.success
          ? `${data.data.name} v${data.data.version || '?'}`
          : 'Invalid response',
      }
    }),
  )

  results.push(
    await verifyCheck('REST API', 'backend', async () => {
      const response = await fetchWithTimeout(
        `${backendUrl}/api/health`,
        timeout,
      )
      return { passed: response.ok, details: `Status: ${response.status}` }
    }),
  )

  // Integration checks
  results.push(
    await verifyCheck('A2A protocol', 'integration', async () => {
      const response = await fetchWithTimeout(
        `${backendUrl}/a2a/.well-known/agent-card.json`,
        timeout,
      )
      const data = A2ACardSchema.safeParse(await response.json())
      return {
        passed: response.ok && data.success,
        details: data.success
          ? `${data.data.skills?.length || 0} skills`
          : 'No agent card',
      }
    }),
  )

  results.push(
    await verifyCheck('MCP protocol', 'integration', async () => {
      const response = await fetchWithTimeout(`${backendUrl}/mcp`, timeout)
      const data = MCPInfoSchema.safeParse(await response.json())
      return {
        passed: response.ok && data.success,
        details: data.success
          ? `${data.data.tools?.length || 0} tools`
          : 'No MCP info',
      }
    }),
  )

  results.push(
    await verifyCheck('x402 payments', 'integration', async () => {
      const response = await fetchWithTimeout(
        `${backendUrl}/x402/info`,
        timeout,
      )
      return { passed: response.ok, details: `Status: ${response.status}` }
    }),
  )

  // Print results
  const categories = ['frontend', 'backend', 'integration']
  for (const category of categories) {
    console.log(chalk.bold(`\n${category.toUpperCase()}`))
    console.log('-'.repeat(60))

    for (const result of results.filter((r) => r.category === category)) {
      const icon = result.passed ? chalk.green('✓') : chalk.red('✗')
      const status = result.passed ? chalk.green('PASS') : chalk.red('FAIL')
      const latency = chalk.gray(`${result.latency}ms`)

      console.log(
        `  ${icon} ${result.name.padEnd(25)} ${status.padEnd(15)} ${latency}`,
      )

      if (verbose && result.details) {
        console.log(chalk.gray(`      ${result.details}`))
      }
      if (result.error) {
        console.log(chalk.red(`      ${result.error}`))
      }
    }
  }

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length

  return { passed, failed, results }
}

export const verifyCommand = new Command()
  .name('verify')
  .description('Verify frontend and backend deployment')
  .argument('[app]', 'App name or directory')
  .option('-u, --url <url>', 'Backend URL to verify')
  .option('-f, --frontend <url>', 'Frontend URL (if different from backend)')
  .option(
    '-n, --network <network>',
    'Network to verify (localnet/testnet/mainnet)',
  )
  .option('-l, --local', 'Verify local deployment (localhost)')
  .option('-t, --timeout <ms>', 'Request timeout in ms', '10000')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (appArg, options) => {
    console.log(chalk.bold('\n🔍 Jeju Deployment Verification\n'))

    let backendUrl: string
    let frontendUrl: string
    const timeout = Number(options.timeout)
    const verbose = options.verbose || false

    // Determine URLs to verify
    if (options.url) {
      backendUrl = options.url
      frontendUrl = options.frontend || options.url
    } else if (options.local) {
      backendUrl = 'http://localhost:4500'
      frontendUrl = 'http://localhost:4501'
    } else {
      // Try to read from jeju-manifest.json
      const cwd = appArg ? resolve(appArg) : process.cwd()
      const manifestPath = join(cwd, 'jeju-manifest.json')

      if (existsSync(manifestPath)) {
        const manifest = ManifestSchema.parse(
          JSON.parse(readFileSync(manifestPath, 'utf-8')),
        )

        const network = (options.network as NetworkType) || getCurrentNetwork()
        const jnsName = manifest.jns?.name || `${manifest.name}.jeju`

        const urls = getAppUrl(network, jnsName)
        backendUrl = urls.backend
        frontendUrl = urls.frontend

        console.log(chalk.gray(`App: ${manifest.name}`))
        console.log(chalk.gray(`JNS: ${jnsName}`))
      } else {
        // Default to localnet
        backendUrl = 'http://localhost:4500'
        frontendUrl = 'http://localhost:4501'
      }
    }

    const network = options.network || getCurrentNetwork()
    console.log(chalk.gray(`Network: ${network}`))
    console.log(chalk.gray(`Backend: ${backendUrl}`))
    if (frontendUrl !== backendUrl) {
      console.log(chalk.gray(`Frontend: ${frontendUrl}`))
    }

    const { passed, failed } = await runVerification({
      backendUrl,
      frontendUrl,
      timeout,
      verbose,
    })

    // Summary
    console.log(chalk.bold(`\n${'='.repeat(60)}`))
    console.log(chalk.bold('SUMMARY'))
    console.log('='.repeat(60))
    console.log(`  Passed: ${chalk.green(passed)}`)
    console.log(`  Failed: ${chalk.red(failed)}`)
    console.log('')

    if (failed > 0) {
      console.log(
        chalk.yellow('⚠️  Some checks failed. Review the errors above.'),
      )
      process.exit(1)
    }

    console.log(chalk.green('✓ All checks passed! Deployment verified.'))
    process.exit(0)
  })

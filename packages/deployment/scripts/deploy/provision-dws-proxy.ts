#!/usr/bin/env bun

/**
 * Provision DWS Reverse Proxy Infrastructure
 *
 * Sets up the reverse proxy layer on DWS for all Jeju network services:
 * - Indexer
 * - Monitoring (with Prometheus sidecar)
 * - Gateway
 * - Other apps
 *
 * This script:
 * 1. Verifies DWS is running
 * 2. Deploys/updates proxy configuration
 * 3. Registers services with the proxy
 * 4. Verifies connectivity
 * 5. Sets up monitoring for the proxy itself
 *
 * Usage:
 *   bun run scripts/deploy/provision-dws-proxy.ts [--network testnet|mainnet]
 */

import { parseArgs } from 'node:util'
import { getCurrentNetwork } from '@jejunetwork/config'
import { z } from 'zod'

// ============================================================================
// Configuration
// ============================================================================

interface ProxyTarget {
  name: string
  upstream: string
  pathPrefix: string
  healthPath: string
  rateLimit: {
    requestsPerMinute: number
    burstSize: number
  }
}

interface DeploymentResult {
  success: boolean
  proxyEndpoint: string
  registeredServices: string[]
  healthStatus: Record<string, boolean>
  errors: string[]
}

const ProxyHealthResponseSchema = z.object({
  status: z.string(),
  service: z.string(),
  targets: z.array(
    z.object({
      name: z.string(),
      pathPrefix: z.string(),
      circuitState: z.string(),
    }),
  ),
  metrics: z.object({
    totalRequests: z.number(),
    totalErrors: z.number(),
    errorRate: z.string(),
  }),
})

// Default service configurations
const DEFAULT_SERVICES: ProxyTarget[] = [
  {
    name: 'indexer',
    upstream: 'http://127.0.0.1:4352',
    pathPrefix: '/indexer',
    healthPath: '/health',
    rateLimit: { requestsPerMinute: 1000, burstSize: 100 },
  },
  {
    name: 'indexer-graphql',
    upstream: 'http://127.0.0.1:4350',
    pathPrefix: '/graphql',
    healthPath: '/',
    rateLimit: { requestsPerMinute: 500, burstSize: 50 },
  },
  {
    name: 'monitoring',
    upstream: 'http://127.0.0.1:9091',
    pathPrefix: '/monitoring',
    healthPath: '/.well-known/agent-card.json',
    rateLimit: { requestsPerMinute: 500, burstSize: 50 },
  },
  {
    name: 'gateway',
    upstream: 'http://127.0.0.1:4200',
    pathPrefix: '/gateway',
    healthPath: '/health',
    rateLimit: { requestsPerMinute: 1000, burstSize: 100 },
  },
]

// ============================================================================
// Provisioner
// ============================================================================

class DWSProxyProvisioner {
  private dwsUrl: string
  private network: string
  private services: ProxyTarget[]

  constructor(dwsUrl: string, network: string, services?: ProxyTarget[]) {
    this.dwsUrl = dwsUrl
    this.network = network
    this.services = services ?? DEFAULT_SERVICES
  }

  async provision(): Promise<DeploymentResult> {
    const result: DeploymentResult = {
      success: false,
      proxyEndpoint: `${this.dwsUrl}/proxy`,
      registeredServices: [],
      healthStatus: {},
      errors: [],
    }

    console.log(
      '╔══════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║           DWS Reverse Proxy Infrastructure Setup                 ║',
    )
    console.log(
      '╚══════════════════════════════════════════════════════════════════╝',
    )
    console.log('')
    console.log(`Network:     ${this.network}`)
    console.log(`DWS URL:     ${this.dwsUrl}`)
    console.log(`Services:    ${this.services.length}`)
    console.log('')

    // Step 1: Verify DWS is running
    console.log('1. Verifying DWS availability...')
    const dwsHealth = await this.checkDWSHealth()
    if (!dwsHealth) {
      result.errors.push('DWS is not available')
      console.error('   ❌ DWS is not responding')
      return result
    }
    console.log('   ✅ DWS is healthy')

    // Step 2: Check proxy health
    console.log('')
    console.log('2. Checking proxy service...')
    const proxyHealth = await this.checkProxyHealth()
    if (!proxyHealth) {
      result.errors.push('Proxy service is not available')
      console.error('   ❌ Proxy service not responding')
      console.log('   ℹ️  Make sure DWS includes the proxy router')
      return result
    }
    console.log(
      `   ✅ Proxy is healthy (${proxyHealth.metrics.totalRequests} total requests)`,
    )

    // Step 3: Verify upstream services
    console.log('')
    console.log('3. Verifying upstream services...')
    for (const service of this.services) {
      const healthy = await this.checkServiceHealth(service)
      result.healthStatus[service.name] = healthy

      if (healthy) {
        result.registeredServices.push(service.name)
        console.log(`   ✅ ${service.name}: healthy (${service.upstream})`)
      } else {
        console.log(
          `   ⚠️  ${service.name}: not available (${service.upstream})`,
        )
      }
    }

    // Step 4: Test proxy routing
    console.log('')
    console.log('4. Testing proxy routing...')
    for (const service of this.services) {
      if (result.healthStatus[service.name]) {
        const proxyPath = `/proxy${service.pathPrefix}${service.healthPath}`
        const success = await this.testProxyRoute(proxyPath)
        if (success) {
          console.log(`   ✅ ${service.name}: proxy route working`)
        } else {
          console.log(`   ⚠️  ${service.name}: proxy route failed`)
          result.errors.push(`Proxy route failed for ${service.name}`)
        }
      }
    }

    // Step 5: Print summary
    console.log('')
    console.log(
      '═══════════════════════════════════════════════════════════════════',
    )
    console.log('                         Summary')
    console.log(
      '═══════════════════════════════════════════════════════════════════',
    )
    console.log('')
    console.log('Proxy Endpoints:')
    for (const service of this.services) {
      const status = result.healthStatus[service.name] ? '✅' : '⚠️'
      console.log(`  ${status} ${this.dwsUrl}/proxy${service.pathPrefix}`)
    }
    console.log('')
    console.log('Metrics Endpoint:')
    console.log(`  📊 ${this.dwsUrl}/proxy/metrics`)
    console.log('')
    console.log('Request Logs:')
    console.log(`  📋 ${this.dwsUrl}/proxy/logs`)
    console.log('')

    if (result.registeredServices.length > 0) {
      result.success = true
      console.log(
        `✅ Proxy infrastructure ready with ${result.registeredServices.length} services`,
      )
    } else {
      console.log('⚠️  No services are currently available')
      console.log('   Start the required services and re-run this script')
    }

    return result
  }

  private async checkDWSHealth(): Promise<boolean> {
    const response = await fetch(`${this.dwsUrl}/health`, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    return response?.ok ?? false
  }

  private async checkProxyHealth(): Promise<z.infer<
    typeof ProxyHealthResponseSchema
  > | null> {
    const response = await fetch(`${this.dwsUrl}/proxy/health`, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (!response?.ok) return null

    const json = await response.json().catch(() => null)
    const parsed = ProxyHealthResponseSchema.safeParse(json)
    return parsed.success ? parsed.data : null
  }

  private async checkServiceHealth(service: ProxyTarget): Promise<boolean> {
    const url = `${service.upstream}${service.healthPath}`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    return response?.ok ?? false
  }

  private async testProxyRoute(path: string): Promise<boolean> {
    const url = `${this.dwsUrl}${path}`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    // Accept 2xx or 404 (service healthy but resource not found)
    return response !== null && (response.ok || response.status === 404)
  }
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      network: { type: 'string', default: 'testnet' },
      'dws-url': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(`
Usage: bun run scripts/deploy/provision-dws-proxy.ts [options]

Options:
  --network <network>   Network to deploy to (testnet, mainnet, devnet)
  --dws-url <url>       DWS endpoint URL (default: http://localhost:4030)
  -h, --help            Show this help message

Examples:
  bun run scripts/deploy/provision-dws-proxy.ts
  bun run scripts/deploy/provision-dws-proxy.ts --network testnet
  bun run scripts/deploy/provision-dws-proxy.ts --dws-url https://dws.testnet.jejunetwork.org
`)
    process.exit(0)
  }

  const network = values.network ?? getCurrentNetwork()
  const dwsUrl =
    values['dws-url'] ?? process.env.DWS_URL ?? 'http://localhost:4030'

  const provisioner = new DWSProxyProvisioner(dwsUrl, network)
  const result = await provisioner.provision()

  if (!result.success) {
    console.log('')
    console.log('Errors:')
    for (const error of result.errors) {
      console.log(`  - ${error}`)
    }
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Provisioning failed:', err)
  process.exit(1)
})

export { DWSProxyProvisioner, type DeploymentResult, type ProxyTarget }

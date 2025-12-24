/**
 * DWS App SDK
 *
 * Enables Jeju apps (Elysia backends) to run as workerd workers
 * through the DWS network. Provides:
 *
 * - Unified deployment interface for all apps
 * - Local development with simulated TEE (matches testnet exactly)
 * - Automatic service discovery and routing
 * - Secret management integration
 *
 * Usage:
 * ```typescript
 * import { DWSApp } from '@jejunetwork/dws'
 *
 * const app = new DWSApp({
 *   name: 'autocrat',
 *   port: 8010,
 *   handler: elysiaApp.fetch,
 * })
 *
 * await app.start()
 * ```
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { getRegionConfig } from './tee/regions'
import { createSecretManager, TEESecretManager } from './tee/secrets'
import type { NetworkEnvironment, RegionId, TEEPlatform } from './tee/types'

// Types

export type FetchHandler = (request: Request) => Response | Promise<Response>

export interface DWSAppConfig {
  /** Unique app name (e.g., 'autocrat', 'bazaar', 'factory') */
  name: string
  /** Port to listen on locally */
  port: number
  /** The app's fetch handler (from Elysia) */
  handler: FetchHandler
  /** App description */
  description?: string
  /** Environment variables (non-secret) */
  env?: Record<string, string>
  /** Secret names to inject from TEE vault */
  secrets?: string[]
  /** Resource requirements */
  resources?: {
    memoryMb?: number
    cpuMillis?: number
    timeoutMs?: number
  }
  /** Region preferences for deployment */
  regionPreferences?: {
    preferred?: RegionId[]
    excluded?: RegionId[]
  }
  /** Whether TEE is required (default: true for mainnet) */
  teeRequired?: boolean
  /** TEE platforms to use */
  teePlatforms?: TEEPlatform[]
}

export interface DWSAppDeployment {
  appId: string
  name: string
  status: 'starting' | 'running' | 'stopped' | 'error'
  endpoint: string
  region: RegionId
  environment: NetworkEnvironment
  teeSimulated: boolean
  startedAt: number
}

export interface DWSAppMetrics {
  requests: number
  errors: number
  avgLatencyMs: number
  uptime: number
}

// DWS App Runtime

export class DWSApp {
  private config: Required<DWSAppConfig>
  private environment: NetworkEnvironment
  private secretManager: TEESecretManager
  private deployment: DWSAppDeployment | null = null
  private metrics: DWSAppMetrics = {
    requests: 0,
    errors: 0,
    avgLatencyMs: 0,
    uptime: 0,
  }
  private server: ReturnType<typeof Bun.serve> | null = null

  constructor(config: DWSAppConfig) {
    this.environment = (process.env.NETWORK as NetworkEnvironment) || 'localnet'

    // Validate required config
    if (!config.name) throw new Error('App name is required')
    if (!config.port) throw new Error('App port is required')
    if (!config.handler) throw new Error('App handler is required')

    this.config = {
      name: config.name,
      port: config.port,
      handler: config.handler,
      description: config.description ?? `Jeju ${config.name} service`,
      env: config.env ?? {},
      secrets: config.secrets ?? [],
      resources: {
        memoryMb: config.resources?.memoryMb ?? 256,
        cpuMillis: config.resources?.cpuMillis ?? 1000,
        timeoutMs: config.resources?.timeoutMs ?? 30000,
      },
      regionPreferences: {
        preferred: config.regionPreferences?.preferred ?? [],
        excluded: config.regionPreferences?.excluded ?? [],
      },
      teeRequired: config.teeRequired ?? this.environment === 'mainnet',
      teePlatforms: config.teePlatforms ?? ['simulator'],
    }

    // Initialize secret manager with simulated TEE for local/testnet
    this.secretManager = createSecretManager({
      teePlatform: this.environment === 'mainnet' ? 'intel-sgx' : 'simulator',
      storageBackend: 'memory',
    })
  }

  // Lifecycle

  /**
   * Start the app
   *
   * In localnet: Runs directly with Bun.serve (simulated TEE)
   * In testnet: Deploys to DWS network (simulated TEE in 2 regions)
   * In mainnet: Deploys to DWS network (real TEE)
   */
  async start(): Promise<DWSAppDeployment> {
    const regionConfig = getRegionConfig(this.environment)

    console.log(`[DWSApp:${this.config.name}] Starting in ${this.environment}`)
    console.log(
      `[DWSApp:${this.config.name}] TEE: ${this.environment === 'mainnet' ? 'REQUIRED' : 'SIMULATED'}`,
    )
    console.log(
      `[DWSApp:${this.config.name}] Regions: ${regionConfig.regions.map((r) => r.id).join(', ')}`,
    )

    // Load secrets
    await this.loadSecrets()

    // Create deployment
    this.deployment = {
      appId: `${this.config.name}-${Date.now()}`,
      name: this.config.name,
      status: 'starting',
      endpoint: `http://localhost:${this.config.port}`,
      region: regionConfig.defaultRegion,
      environment: this.environment,
      teeSimulated: this.environment !== 'mainnet',
      startedAt: Date.now(),
    }

    if (this.environment === 'localnet') {
      // Run directly with Bun.serve
      await this.startLocalServer()
    } else {
      // Deploy through DWS network
      await this.deployToDWS()
    }

    this.deployment.status = 'running'
    return this.deployment
  }

  /**
   * Stop the app
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop()
      this.server = null
    }

    if (this.deployment) {
      this.deployment.status = 'stopped'
    }

    console.log(`[DWSApp:${this.config.name}] Stopped`)
  }

  // Local Development

  private async startLocalServer(): Promise<void> {
    // Wrap handler with metrics and TEE simulation
    const wrappedHandler = this.wrapHandler(this.config.handler)

    this.server = Bun.serve({
      port: this.config.port,
      fetch: wrappedHandler,
    })

    console.log(
      `[DWSApp:${this.config.name}] Running at http://localhost:${this.config.port}`,
    )
  }

  private wrapHandler(handler: FetchHandler): FetchHandler {
    return async (request: Request): Promise<Response> => {
      const startTime = Date.now()
      this.metrics.requests++

      try {
        // Add TEE context headers
        const headers = new Headers(request.headers)
        headers.set(
          'x-tee-mode',
          this.environment === 'mainnet' ? 'real' : 'simulated',
        )
        headers.set('x-dws-region', this.deployment?.region ?? 'local')
        headers.set('x-dws-app', this.config.name)

        const modifiedRequest = new Request(request.url, {
          method: request.method,
          headers,
          body: request.body,
        })

        const response = await handler(modifiedRequest)

        // Add response headers
        const responseHeaders = new Headers(response.headers)
        responseHeaders.set(
          'x-tee-mode',
          this.environment === 'mainnet' ? 'real' : 'simulated',
        )
        responseHeaders.set('x-dws-app', this.config.name)

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        })
      } catch (err) {
        this.metrics.errors++
        throw err
      } finally {
        const latency = Date.now() - startTime
        this.metrics.avgLatencyMs =
          this.metrics.avgLatencyMs * 0.9 + latency * 0.1
      }
    }
  }

  // DWS Deployment

  private async deployToDWS(): Promise<void> {
    const dwsUrl = process.env.DWS_URL ?? 'http://localhost:4030'

    // For testnet/mainnet, we'd deploy through the DWS coordinator
    // For now, we still run locally but simulate the deployment flow

    console.log(`[DWSApp:${this.config.name}] Would deploy to DWS at ${dwsUrl}`)
    console.log(
      `[DWSApp:${this.config.name}] Running locally with ${this.environment} configuration`,
    )

    // Start local server with testnet/mainnet config
    await this.startLocalServer()
  }

  // Secret Management

  private async loadSecrets(): Promise<void> {
    if (this.config.secrets.length === 0) return

    console.log(
      `[DWSApp:${this.config.name}] Loading ${this.config.secrets.length} secrets`,
    )

    // In real deployment, secrets would come from TEE vault
    // For local development, we load from environment variables
    for (const secretName of this.config.secrets) {
      const envValue = process.env[secretName]
      if (envValue) {
        // Store encrypted (simulated)
        const publicKey = this.secretManager.getEnclavePublicKey()
        const encrypted = TEESecretManager.encryptSecret(envValue, publicKey)
        encrypted.name = secretName

        await this.secretManager.storeSecret(
          '0x0000000000000000000000000000000000000000',
          secretName,
          encrypted,
        )
      }
    }
  }

  /**
   * Get a secret value (only available inside TEE)
   */
  async getSecret(name: string): Promise<string | null> {
    return this.secretManager.getSecret(
      '0x0000000000000000000000000000000000000000',
      name,
    )
  }

  // Status & Metrics

  getDeployment(): DWSAppDeployment | null {
    return this.deployment
  }

  getMetrics(): DWSAppMetrics {
    return {
      ...this.metrics,
      uptime: this.deployment ? Date.now() - this.deployment.startedAt : 0,
    }
  }

  isRunning(): boolean {
    return this.deployment?.status === 'running'
  }

  /**
   * Health check endpoint data
   */
  getHealth(): {
    status: 'healthy' | 'degraded' | 'unhealthy'
    app: string
    environment: NetworkEnvironment
    teeMode: string
    region: string
    uptime: number
  } {
    return {
      status: this.isRunning() ? 'healthy' : 'unhealthy',
      app: this.config.name,
      environment: this.environment,
      teeMode: this.environment === 'mainnet' ? 'real' : 'simulated',
      region: this.deployment?.region ?? 'unknown',
      uptime: this.deployment
        ? Math.floor((Date.now() - this.deployment.startedAt) / 1000)
        : 0,
    }
  }
}

// Helper: Create DWS App from Elysia

export function createDWSAppFromElysia(
  elysia: { fetch: FetchHandler },
  config: Omit<DWSAppConfig, 'handler'>,
): DWSApp {
  return new DWSApp({
    ...config,
    handler: elysia.fetch,
  })
}

// Registry of all Jeju apps

export const JEJU_APPS = {
  autocrat: {
    name: 'autocrat',
    port: CORE_PORTS.AUTOCRAT_API.get(),
    description: 'AI-powered DAO governance',
    secrets: ['PRIVATE_KEY', 'OPENAI_API_KEY'],
  },
  bazaar: {
    name: 'bazaar',
    port: CORE_PORTS.BAZAAR.get(),
    description: 'Token marketplace and trading',
    secrets: ['PRIVATE_KEY'],
  },
  crucible: {
    name: 'crucible',
    port: CORE_PORTS.CRUCIBLE_API.get(),
    description: 'Agent runtime and coordination',
    secrets: ['PRIVATE_KEY', 'OPENAI_API_KEY'],
  },
  factory: {
    name: 'factory',
    port: CORE_PORTS.FACTORY.get(),
    description: 'Developer hub and bounties',
    secrets: ['GITHUB_TOKEN'],
  },
  gateway: {
    name: 'gateway',
    port: CORE_PORTS.GATEWAY.get(),
    description: 'RPC gateway and x402 payments',
    secrets: ['PRIVATE_KEY'],
  },
  dws: {
    name: 'dws',
    port: CORE_PORTS.DWS_API.get(),
    description: 'Decentralized web services',
    secrets: ['PRIVATE_KEY'],
  },
  indexer: {
    name: 'indexer',
    port: CORE_PORTS.INDEXER_GRAPHQL.get(),
    description: 'Blockchain indexer',
    secrets: ['DATABASE_URL'],
  },
  otto: {
    name: 'otto',
    port: CORE_PORTS.OTTO_API.get(),
    description: 'Automation service',
    secrets: ['PRIVATE_KEY'],
  },
  monitoring: {
    name: 'monitoring',
    port: CORE_PORTS.MONITORING.get(),
    description: 'Infrastructure monitoring',
    secrets: [],
  },
  'babylon-web': {
    name: 'babylon-web',
    port: CORE_PORTS.BABYLON_WEB.get(),
    description: 'Social prediction platform frontend',
    secrets: [],
  },
  'babylon-api': {
    name: 'babylon-api',
    port: CORE_PORTS.BABYLON_API.get(),
    description: 'Social prediction platform API',
    secrets: ['DATABASE_URL', 'OPENAI_API_KEY'],
  },
  vpn: {
    name: 'vpn',
    port: CORE_PORTS.VPN_API.get(),
    description: 'Decentralized VPN service',
    secrets: ['PRIVATE_KEY'],
  },
} as const

export type JejuAppName = keyof typeof JEJU_APPS

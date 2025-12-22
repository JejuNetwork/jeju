/**
 * Workerd App Adapter
 *
 * Wraps Elysia apps to run as workerd workers.
 * Provides the same interface as Cloudflare Workers with Jeju extensions.
 *
 * Features:
 * - TEE context injection
 * - Secret management
 * - Service bindings
 * - Regional routing headers
 */

import type { NetworkEnvironment, RegionId, TEEAttestation } from '../tee/types'

// ============================================================================
// Workerd Environment Types
// ============================================================================

/**
 * Environment bindings available to workerd workers
 */
export interface WorkerdEnv {
  // Standard Cloudflare bindings
  [key: string]: string | KVNamespace | DurableObjectNamespace | undefined

  // Jeju TEE context
  TEE_MODE: 'real' | 'simulated'
  TEE_PLATFORM: string
  TEE_REGION: string

  // Network context
  NETWORK: NetworkEnvironment
  RPC_URL: string

  // Service bindings
  DWS_URL: string
  GATEWAY_URL: string
  INDEXER_URL: string
}

/**
 * Execution context for workerd
 */
export interface WorkerdContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/**
 * KV namespace binding (subset of Cloudflare KV)
 */
export interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>
    list_complete: boolean
  }>
}

/**
 * Durable Object namespace binding
 */
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

export interface DurableObjectId {
  toString(): string
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

// ============================================================================
// Jeju Extensions
// ============================================================================

/**
 * Extended environment with Jeju-specific bindings
 */
export interface JejuEnv extends WorkerdEnv {
  // Secrets (decrypted inside TEE)
  PRIVATE_KEY?: string
  OPENAI_API_KEY?: string
  DATABASE_URL?: string
  GITHUB_TOKEN?: string

  // Contract addresses
  IDENTITY_REGISTRY_ADDRESS: string
  SERVICE_REGISTRY_ADDRESS: string
  AGENT_VAULT_ADDRESS: string

  // TEE attestation
  getTEEAttestation(): Promise<TEEAttestation | null>

  // Secret retrieval (TEE-only)
  getSecret(name: string): Promise<string | null>
}

/**
 * Request with TEE context
 */
export interface JejuRequest extends Request {
  tee: {
    mode: 'real' | 'simulated'
    platform: string
    region: RegionId
    attestation?: TEEAttestation
  }
  env: JejuEnv
  ctx: WorkerdContext
}

// ============================================================================
// App Adapter
// ============================================================================

export type FetchHandler = (request: Request) => Response | Promise<Response>

export interface WorkerdAppHandler {
  fetch(
    request: Request,
    env: JejuEnv,
    ctx: WorkerdContext,
  ): Response | Promise<Response>
}

/**
 * Adapt an Elysia app to workerd format
 */
export function adaptAppForWorkerd(
  handler: FetchHandler,
  options?: {
    name?: string
    region?: RegionId
    teeRequired?: boolean
  },
): WorkerdAppHandler {
  return {
    async fetch(
      request: Request,
      env: JejuEnv,
      ctx: WorkerdContext,
    ): Promise<Response> {
      // Inject TEE context into request
      const teeMode = env.TEE_MODE || 'simulated'
      const teeRegion = env.TEE_REGION || options?.region || 'local'

      // Add Jeju headers
      const headers = new Headers(request.headers)
      headers.set('x-tee-mode', teeMode)
      headers.set('x-tee-region', teeRegion)
      headers.set('x-network', env.NETWORK || 'localnet')

      if (options?.name) {
        headers.set('x-dws-app', options.name)
      }

      // Create modified request
      const modifiedRequest = new Request(request.url, {
        method: request.method,
        headers,
        body: request.body,
      })

      // Add env and ctx to request for handler access
      Object.defineProperty(modifiedRequest, 'env', { value: env })
      Object.defineProperty(modifiedRequest, 'ctx', { value: ctx })
      Object.defineProperty(modifiedRequest, 'tee', {
        value: {
          mode: teeMode,
          platform: env.TEE_PLATFORM || 'simulator',
          region: teeRegion,
        },
      })

      // Call the original handler
      const response = await handler(modifiedRequest)

      // Add response headers
      const responseHeaders = new Headers(response.headers)
      responseHeaders.set('x-tee-mode', teeMode)
      responseHeaders.set('x-tee-region', teeRegion)

      if (options?.name) {
        responseHeaders.set('x-dws-app', options.name)
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      })
    },
  }
}

/**
 * Generate workerd-compatible worker code from an app
 */
export function generateWorkerdCode(
  appPath: string,
  exportName: string = 'app',
  options?: {
    name?: string
    region?: RegionId
  },
): string {
  return `
// Auto-generated workerd worker wrapper
import { ${exportName} } from '${appPath}';

// Workerd exports
export default {
  async fetch(request, env, ctx) {
    // Add TEE context
    const teeMode = env.TEE_MODE || 'simulated';
    const teeRegion = env.TEE_REGION || '${options?.region || 'local'}';
    
    // Clone request with extra headers
    const headers = new Headers(request.headers);
    headers.set('x-tee-mode', teeMode);
    headers.set('x-tee-region', teeRegion);
    headers.set('x-network', env.NETWORK || 'localnet');
    ${options?.name ? `headers.set('x-dws-app', '${options.name}');` : ''}
    
    const modifiedRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
    });
    
    // Call the app's fetch handler
    const response = await ${exportName}.fetch(modifiedRequest);
    
    // Add response headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-tee-mode', teeMode);
    responseHeaders.set('x-tee-region', teeRegion);
    ${options?.name ? `responseHeaders.set('x-dws-app', '${options.name}');` : ''}
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  }
};
`
}

/**
 * Generate workerd config for an app
 */
export function generateWorkerdConfig(params: {
  name: string
  mainModule: string
  port: number
  env: Record<string, string>
  memoryMb?: number
  compatibilityDate?: string
}): string {
  const {
    name,
    mainModule,
    port,
    env,
    memoryMb: _memoryMb = 256, // Reserved for future memory limits
    compatibilityDate = new Date().toISOString().split('T')[0],
  } = params

  const bindings = Object.entries(env)
    .map(
      ([key, value]) =>
        `      (name = "${key}", text = "${escapeCapnp(value)}")`,
    )
    .join(',\n')

  return `using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "${name}", worker = .${name}Worker),
  ],
  sockets = [
    (name = "http", address = "*:${port}", http = (), service = "${name}"),
  ],
);

const ${name}Worker :Workerd.Worker = (
  modules = [
    (name = "${mainModule}", esModule = embed "${mainModule}"),
  ],
  bindings = [
${bindings}
  ],
  compatibilityDate = "${compatibilityDate}",
);
`
}

function escapeCapnp(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

// ============================================================================
// Elysia Plugin for TEE Context
// ============================================================================

import { Elysia } from 'elysia'

/**
 * Elysia plugin to add TEE context headers
 */
export function teeContextPlugin(env?: JejuEnv) {
  return new Elysia({ name: 'tee-context' }).onBeforeHandle(
    ({ request, set }) => {
      const teeMode =
        env?.TEE_MODE || request.headers.get('x-tee-mode') || 'simulated'
      const teeRegion =
        env?.TEE_REGION || request.headers.get('x-tee-region') || 'local'

      set.headers['x-tee-mode'] = teeMode
      set.headers['x-tee-region'] = teeRegion
    },
  )
}

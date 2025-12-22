/**
 * Factory Worker Entry Point
 * Runs on DWS workerd (V8 isolate) for serverless deployment
 *
 * This file exports a Cloudflare Workers-compatible handler that
 * wraps the Elysia server for execution in DWS workerd.
 */

import { app } from '../server'

/**
 * Workers-compatible fetch handler
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    // Set environment variables from worker bindings
    if (env.COVENANTSQL_NODES) {
      process.env.COVENANTSQL_NODES = env.COVENANTSQL_NODES
    }
    if (env.FACTORY_DATABASE_ID) {
      process.env.FACTORY_DATABASE_ID = env.FACTORY_DATABASE_ID
    }
    if (env.FACTORY_DB_PRIVATE_KEY) {
      process.env.FACTORY_DB_PRIVATE_KEY = env.FACTORY_DB_PRIVATE_KEY
    }
    if (env.DWS_URL) {
      process.env.DWS_URL = env.DWS_URL
    }
    if (env.RPC_URL) {
      process.env.RPC_URL = env.RPC_URL
    }

    // Handle the request with Elysia
    return app.handle(request)
  },
}

/**
 * Environment bindings for the worker
 */
interface Env {
  // CovenantSQL configuration
  COVENANTSQL_NODES?: string
  FACTORY_DATABASE_ID?: string
  FACTORY_DB_PRIVATE_KEY?: string

  // DWS configuration
  DWS_URL?: string
  RPC_URL?: string

  // KV namespaces (optional, for caching)
  CACHE?: KVNamespace
}

/**
 * KV Namespace type (Cloudflare Workers compatible)
 */
interface KVNamespace {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * Execution context type (Cloudflare Workers compatible)
 */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/** Factory Worker Entry Point */

import { app } from '../server'

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
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

    return app.handle(request)
  },
}

interface Env {
  COVENANTSQL_NODES?: string
  FACTORY_DATABASE_ID?: string
  FACTORY_DB_PRIVATE_KEY?: string

  DWS_URL?: string
  RPC_URL?: string

  CACHE?: KVNamespace
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  delete(key: string): Promise<void>
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

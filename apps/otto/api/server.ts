#!/usr/bin/env bun
/**
 * Otto API Server
 *
 * Minimal API server for development and testing.
 * Full Otto functionality requires ElizaOS runtime.
 */
import { cors } from '@elysiajs/cors'
import { getLocalhostHost, getNetworkName } from '@jejunetwork/config'
import { Elysia } from 'elysia'

const PORT = Number(process.env.OTTO_PORT) || 4050
const networkName = getNetworkName()
const host = getLocalhostHost()

const app = new Elysia()
  .use(cors())
  .get('/health', () => ({
    status: 'ok',
    service: 'otto',
    network: networkName,
    timestamp: new Date().toISOString(),
  }))
  .get('/', () => ({
    name: 'Otto API',
    version: '1.0.0',
    description: 'Otto ElizaOS trading bot API',
    network: networkName,
  }))
  .get('/status', () => ({
    running: true,
    network: networkName,
    elizaRuntime: false,
    message:
      'Otto is running in minimal API mode. Full features require ElizaOS runtime.',
  }))

if (import.meta.main) {
  console.log(`🤖 Otto API running at http://${host}:${PORT}`)
  console.log(`   Network: ${networkName}`)
  console.log(`   Health: http://${host}:${PORT}/health`)
  app.listen(PORT)
}

export { app }

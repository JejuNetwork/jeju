#!/usr/bin/env bun
/**
 * Gateway Main API Server
 *
 * Starts the JNS Gateway with health checks and API endpoints.
 */
import { startJNSGateway } from './jns-gateway'

const PORT = Number(process.env.PORT) || 4013

async function main() {
  try {
    console.log(`[Gateway] Starting API server on port ${PORT}...`)
    const gateway = await startJNSGateway()
    console.log(`[Gateway] API server started on port ${PORT}`)
    return gateway
  } catch (error) {
    console.error('[Gateway] Failed to start API server:', error)
    process.exit(1)
  }
}

main()

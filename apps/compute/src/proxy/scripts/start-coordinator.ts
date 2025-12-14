#!/usr/bin/env bun
/**
 * Start Proxy Coordinator
 * 
 * Starts the central proxy coordinator that manages nodes and routes requests.
 * 
 * Usage:
 *   bun run apps/compute/src/proxy/scripts/start-coordinator.ts
 * 
 * Environment:
 *   JEJU_RPC_URL - RPC endpoint (default: http://127.0.0.1:9545)
 *   PROXY_REGISTRY_ADDRESS - ProxyRegistry contract address
 *   PROXY_PAYMENT_ADDRESS - ProxyPayment contract address
 *   COORDINATOR_PRIVATE_KEY - Coordinator wallet private key
 *   PROXY_COORDINATOR_PORT - HTTP port (default: 4020)
 *   PROXY_COORDINATOR_WS_PORT - WebSocket port (default: 4021)
 */

import { startProxyCoordinator } from '../coordinator/server';

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                  Jeju Proxy Coordinator                          ║
╚══════════════════════════════════════════════════════════════════╝
`);

startProxyCoordinator()
  .then((coordinator) => {
    console.log(`
Coordinator running successfully.

API Endpoints:
  GET  /health              - Health check
  GET  /v1/proxy/stats      - Network statistics
  GET  /v1/proxy/regions    - Available regions
  GET  /v1/proxy/nodes      - Connected nodes
  POST /v1/proxy/sessions   - Open session info
  GET  /v1/proxy/sessions/:id - Get session
  POST /v1/proxy/fetch      - Proxy a request

Press Ctrl+C to stop.
`);

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down coordinator...');
      coordinator.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down coordinator...');
      coordinator.stop();
      process.exit(0);
    });
  })
  .catch((err) => {
    console.error('Failed to start coordinator:', err);
    process.exit(1);
  });


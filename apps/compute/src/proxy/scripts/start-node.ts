#!/usr/bin/env bun
/**
 * Start Proxy Node
 * 
 * Starts a proxy node that connects to the Jeju coordinator and serves requests.
 * 
 * Usage:
 *   bun run apps/compute/src/proxy/scripts/start-node.ts
 * 
 * Environment:
 *   NODE_PRIVATE_KEY - Node wallet private key (will be used for registration)
 *   PROXY_COORDINATOR_URL - Coordinator WebSocket URL (default: ws://localhost:4021)
 *   NODE_REGION - Region code (default: US)
 *   NODE_MAX_CONCURRENT - Max concurrent requests (default: 10)
 */

import { startProxyNode } from '../node/client';

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    Jeju Proxy Node                               ║
╚══════════════════════════════════════════════════════════════════╝
`);

startProxyNode()
  .then((node) => {
    console.log(`
Node running successfully.
Region: ${node.regionCode}
Address: ${node.address}

Press Ctrl+C to stop.
`);

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down node...');
      node.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down node...');
      node.disconnect();
      process.exit(0);
    });

    // Log stats periodically
    setInterval(() => {
      const stats = node.getStats();
      console.log(`[Stats] Requests: ${stats.totalRequests} | Success: ${stats.successfulRequests} | Bytes: ${stats.totalBytesServed} | Load: ${stats.currentLoad}%`);
    }, 60000);
  })
  .catch((err) => {
    console.error('Failed to start node:', err);
    process.exit(1);
  });


#!/usr/bin/env bun
/**
 * Start Proxy Node
 * Entry point for Docker container
 */

import { startProxyNode } from '../node/client';

console.log('Starting Network Proxy Node...');

const client = await startProxyNode();

// Handle shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  client.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  client.disconnect();
  process.exit(0);
});

// Log stats periodically
setInterval(() => {
  const stats = client.getStats();
  console.log('[Node Stats]', {
    requests: stats.totalRequests,
    success: stats.successfulRequests,
    bytes: stats.totalBytesServed,
    load: stats.currentLoad + '%',
  });
}, 60000);

// Keep running
await new Promise(() => {});

#!/usr/bin/env bun
/**
 * Start Proxy Coordinator
 * Entry point for Docker container
 */

import { startProxyCoordinator } from '../coordinator/server';

console.log('Starting Jeju Proxy Coordinator...');

const server = await startProxyCoordinator();

// Handle shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.stop();
  process.exit(0);
});

// Keep running
await new Promise(() => {});

/**
 * Unified API Server - starts REST, A2A, and MCP alongside GraphQL
 */

import { getDataSource, closeDataSource } from './lib/db';
import { startRestServer } from './rest-server';
import { startA2AServer } from './a2a-server';
import { startMCPServer } from './mcp-server';

async function main() {
  console.log('🚀 Starting Jeju Indexer API servers...');
  
  await getDataSource();
  await Promise.all([startRestServer(), startA2AServer(), startMCPServer()]);
  
  console.log(`
┌─────────────────────────────────────────┐
│  Jeju Indexer API Servers Running       │
├─────────────────────────────────────────┤
│  GraphQL: http://localhost:4350/graphql │
│  REST:    http://localhost:4352         │
│  A2A:     http://localhost:4351         │
│  MCP:     http://localhost:4353         │
└─────────────────────────────────────────┘`);
}

async function shutdown() {
  console.log('\nShutting down...');
  await closeDataSource();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(e => { console.error('Startup failed:', e); process.exit(1); });

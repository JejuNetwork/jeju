#!/usr/bin/env bun
/**
 * @title Heartbeat Service
 * @notice Sends regular heartbeats to node explorer
 */

import { createPublicClient, http, getBlockNumber, signMessage, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { inferChainFromRpcUrl } from '../../../scripts/shared/chain-utils';
import { z } from 'zod';

// Validate and parse environment config
const NODE_ID = process.env.NODE_ID;
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY;

if (!NODE_ID) {
  throw new Error('NODE_ID environment variable is required');
}
if (!OPERATOR_PRIVATE_KEY) {
  throw new Error('OPERATOR_PRIVATE_KEY environment variable is required');
}

// Optional config with explicit defaults
const NODE_EXPLORER_API = process.env.NODE_EXPLORER_API ?? 'https://nodes.jejunetwork.org/api';
const RPC_URL = process.env.RPC_URL ?? 'http://localhost:6546';
const HEARTBEAT_INTERVAL = process.env.HEARTBEAT_INTERVAL;
const INTERVAL = HEARTBEAT_INTERVAL ? parseInt(HEARTBEAT_INTERVAL, 10) : 300000;

if (isNaN(INTERVAL) || INTERVAL <= 0) {
  throw new Error('HEARTBEAT_INTERVAL must be a positive number');
}

const CONFIG = {
  NODE_ID,
  OPERATOR_PRIVATE_KEY,
  NODE_EXPLORER_API,
  RPC_URL,
  INTERVAL,
};

// Zod schema for heartbeat API response
const HeartbeatResponseSchema = z.object({
  uptime_score: z.number(),
});

async function sendHeartbeat(): Promise<void> {
  const chain = inferChainFromRpcUrl(CONFIG.RPC_URL);
  const publicClient = createPublicClient({ chain, transport: http(CONFIG.RPC_URL) });
  const account = privateKeyToAccount(CONFIG.OPERATOR_PRIVATE_KEY as `0x${string}`);
  
  // Get node stats
  const blockNumber = await getBlockNumber(publicClient);
  const peerCount = await publicClient.request({ method: 'net_peerCount' }) as string;
  const isSyncing = await publicClient.request({ method: 'eth_syncing' }) as boolean | object;
  
  const startTime = Date.now();
  await getBlockNumber(publicClient); // Test response time
  const responseTime = Date.now() - startTime;
  
  // Sign heartbeat
  const message = `Heartbeat: ${CONFIG.NODE_ID}:${Date.now()}`;
  const signature = await signMessage({
    account,
    message,
  });
  
  // Send to explorer
  const response = await fetch(`${CONFIG.NODE_EXPLORER_API}/nodes/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      node_id: CONFIG.NODE_ID,
      block_number: blockNumber,
      peer_count: parseInt(peerCount, 16),
      is_syncing: isSyncing !== false,
      response_time: responseTime,
      signature,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Heartbeat failed: ${response.status} ${response.statusText}`);
  }
  
  const rawData = await response.json();
  const parsed = HeartbeatResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new Error(`Invalid heartbeat response: ${parsed.error.message}`);
  }
  
  console.log(`💓 Heartbeat sent (uptime: ${(parsed.data.uptime_score * 100).toFixed(2)}%)`);
}

async function main(): Promise<void> {
  console.log('💓 Heartbeat service starting...');
  console.log(`   Node ID: ${CONFIG.NODE_ID}`);
  console.log(`   Interval: ${CONFIG.INTERVAL / 1000}s`);
  
  // Initial heartbeat - fail fast if configuration is wrong
  await sendHeartbeat();
  
  // Regular heartbeats - log errors but keep running
  setInterval(async () => {
    try {
      await sendHeartbeat();
    } catch (error) {
      console.error('❌ Heartbeat error:', error instanceof Error ? error.message : String(error));
    }
  }, CONFIG.INTERVAL);
  
  console.log('✅ Heartbeat service running\n');
}

if (import.meta.main) {
  main().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

export { sendHeartbeat };


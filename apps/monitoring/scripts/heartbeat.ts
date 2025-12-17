#!/usr/bin/env bun
/**
 * @title Heartbeat Service
 * @notice Sends regular heartbeats to node explorer
 */

import { createPublicClient, http, getBlockNumber, signMessage, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { inferChainFromRpcUrl } from '../../../scripts/shared/chain-utils';

const CONFIG = {
  NODE_ID: process.env.NODE_ID || '',
  OPERATOR_PRIVATE_KEY: process.env.OPERATOR_PRIVATE_KEY || '',
  NODE_EXPLORER_API: process.env.NODE_EXPLORER_API || 'https://nodes.jejunetwork.org/api',
  RPC_URL: process.env.RPC_URL || 'http://localhost:8545',
  INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL || '300000'), // 5 minutes
};

async function sendHeartbeat() {
  try {
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
    
    if (response.ok) {
      const data = await response.json() as { uptime_score: number };
      console.log(`💓 Heartbeat sent (uptime: ${(data.uptime_score * 100).toFixed(2)}%)`);
    } else {
      console.error('❌ Heartbeat failed:', response.statusText);
    }
  } catch (error) {
    console.error('❌ Heartbeat error:', error);
  }
}

async function main() {
  console.log('💓 Heartbeat service starting...');
  console.log(`   Node ID: ${CONFIG.NODE_ID}`);
  console.log(`   Interval: ${CONFIG.INTERVAL / 1000}s`);
  
  if (!CONFIG.NODE_ID || !CONFIG.OPERATOR_PRIVATE_KEY) {
    console.error('❌ NODE_ID and OPERATOR_PRIVATE_KEY required');
    process.exit(1);
  }
  
  // Initial heartbeat
  await sendHeartbeat();
  
  // Regular heartbeats
  setInterval(sendHeartbeat, CONFIG.INTERVAL);
  
  console.log('✅ Heartbeat service running\n');
}

if (import.meta.main) {
  main().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

export { sendHeartbeat };


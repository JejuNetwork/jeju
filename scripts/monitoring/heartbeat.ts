#!/usr/bin/env bun
/**
 * @title Heartbeat Service
 * @notice Sends regular heartbeats to node explorer
 */

import { ethers } from 'ethers';

const CONFIG = {
  NODE_ID: process.env.NODE_ID || '',
  OPERATOR_PRIVATE_KEY: process.env.OPERATOR_PRIVATE_KEY || '',
  NODE_EXPLORER_API: process.env.NODE_EXPLORER_API || 'https://nodes.jeju.network/api',
  RPC_URL: process.env.RPC_URL || 'http://localhost:8545',
  INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL || '300000'), // 5 minutes
};

async function sendHeartbeat() {
  try {
    const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    const wallet = new ethers.Wallet(CONFIG.OPERATOR_PRIVATE_KEY);
    
    // Get node stats
    const blockNumber = await provider.getBlockNumber();
    const peerCount = await provider.send('net_peerCount', []);
    const isSyncing = await provider.send('eth_syncing', []);
    
    const startTime = Date.now();
    await provider.getBlockNumber(); // Test response time
    const responseTime = Date.now() - startTime;
    
    // Sign heartbeat
    const message = `Heartbeat: ${CONFIG.NODE_ID}:${Date.now()}`;
    const signature = await wallet.signMessage(message);
    
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
      const data = await response.json() as any;
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


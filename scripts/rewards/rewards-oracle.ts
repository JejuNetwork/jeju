#!/usr/bin/env bun
/**
 * @title Rewards Oracle
 * @notice Updates node performance data for the rewards contract
 * 
 * Responsibilities:
 * - Fetch performance data from node-explorer API
 * - Calculate uptime scores
 * - Submit on-chain updates
 * - Distribute monthly rewards
 */

import { ethers } from 'ethers';

// ============ Configuration ============

const CONFIG = {
  REWARDS_CONTRACT: process.env.REWARDS_CONTRACT || '',
  ORACLE_PRIVATE_KEY: process.env.ORACLE_PRIVATE_KEY || '',
  NODE_EXPLORER_API: process.env.NODE_EXPLORER_API || 'http://localhost:4002',
  RPC_URL: process.env.RPC_URL || 'https://rpc.jeju.network',
  UPDATE_INTERVAL: parseInt(process.env.UPDATE_INTERVAL || '3600000'), // 1 hour
};

// ============ Contract ABI ============

const REWARDS_ABI = [
  'function updatePerformance(bytes32 nodeId, uint256 uptimeScore, uint256 requestsServed, uint256 avgResponseTime) external',
  'function getNodeInfo(bytes32 nodeId) external view returns (tuple(address operator, string rpcUrl, uint256 stakedAmount, uint256 registrationTime, uint256 totalRewardsClaimed, uint256 lastClaimTime, bool isActive, bool isSlashed), tuple(uint256 uptimeScore, uint256 requestsServed, uint256 avgResponseTime, uint256 lastUpdateTime, string geographicRegion), uint256 pendingRewards)',
  'function startNewPeriod() external',
  'function getAllNodes() external view returns (bytes32[])',
  'event PerformanceUpdated(bytes32 indexed nodeId, uint256 uptimeScore, uint256 requestsServed, string region)',
];

// ============ Performance Calculator ============

interface NodePerformance {
  nodeId: string;
  uptimeScore: number; // 0-10000 (100.00%)
  requestsServed: number;
  avgResponseTime: number;
  rpcVerified: boolean; // Whether RPC endpoint actually responds
}

async function fetchNodePerformance(): Promise<NodePerformance[]> {
  try {
    const response = await fetch(`${CONFIG.NODE_EXPLORER_API}/nodes?limit=1000`);
    const data = await response.json() as any;
    const nodes = data.nodes || [];
    
    const performance: NodePerformance[] = [];
    
    for (const node of nodes) {
      // Calculate uptime score based on heartbeat consistency
      const uptimeScore = calculateUptimeScore(node);
      
      // CRITICAL: Verify RPC endpoint actually responds
      const rpcVerified = await verifyRPCEndpoint(node.rpc_url);
      
      // Only credit nodes with verified RPCs
      // Nodes with failed verification get 0 uptime score
      const finalUptimeScore = rpcVerified ? uptimeScore : 0;
      
      performance.push({
        nodeId: node.id,
        uptimeScore: finalUptimeScore,
        requestsServed: node.total_requests || 0,
        avgResponseTime: await getAvgResponseTime(node.id),
        rpcVerified,
      });
      
      if (!rpcVerified) {
        console.log(`⚠️  Node ${node.id} RPC verification failed: ${node.rpc_url}`);
      }
    }
    
    return performance;
  } catch (error) {
    console.error('Failed to fetch node performance:', error);
    return [];
  }
}

function calculateUptimeScore(node: any): number {
  // Uptime score based on:
  // 1. Heartbeat consistency (has the node been reporting?)
  // 2. Node status (online/offline/syncing)
  
  const now = Date.now() / 1000;
  const lastHeartbeat = node.last_heartbeat;
  const timeSinceHeartbeat = now - lastHeartbeat;
  
  // If last heartbeat is recent
  if (timeSinceHeartbeat < 300) { // 5 minutes
    if (node.status === 'online') {
      return Math.floor(node.uptime_score * 10000); // Convert 0-1 to 0-10000
    } else if (node.status === 'syncing') {
      return Math.floor(node.uptime_score * 10000 * 0.8); // 80% for syncing
    }
  }
  
  // Offline or stale
  return 0;
}

async function getAvgResponseTime(nodeId: string): Promise<number> {
  try {
    const response = await fetch(`${CONFIG.NODE_EXPLORER_API}/nodes/${nodeId}`);
    const data = await response.json() as any;
    const heartbeats = data.heartbeats || [];
    
    if (heartbeats.length === 0) return 0;
    
    // Average of last 100 heartbeats
    const sum = heartbeats.reduce((acc: number, hb: any) => acc + (hb.response_time || 0), 0);
    return Math.floor(sum / heartbeats.length);
  } catch {
    return 0;
  }
}

/**
 * Verify RPC endpoint is actually responding to requests
 * Makes real eth_blockNumber call to ensure node is live
 */
async function verifyRPCEndpoint(rpcUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
    
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) return false;
    
    const data = await response.json();
    
    // Must return valid block number
    return data.result && typeof data.result === 'string' && data.result.startsWith('0x');
  } catch {
    return false;
  }
}

// ============ Oracle Updater ============

class RewardsOracle {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  
  constructor() {
    this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    this.wallet = new ethers.Wallet(CONFIG.ORACLE_PRIVATE_KEY, this.provider);
    this.contract = new ethers.Contract(CONFIG.REWARDS_CONTRACT, REWARDS_ABI, this.wallet);
  }
  
  async updateAllNodes() {
    console.log('\n🔄 Updating node performance data...');
    
    try {
      // Fetch on-chain registered nodes
      const nodeIds = await this.contract.getAllNodes();
      console.log(`Found ${nodeIds.length} registered nodes on-chain`);
      
      // Fetch performance from node explorer
      const performanceData = await fetchNodePerformance();
      console.log(`Fetched performance for ${performanceData.length} nodes`);
      
      // Map node IDs to performance
      const performanceMap = new Map(
        performanceData.map(p => [p.nodeId, p])
      );
      
      let updated = 0;
      let failed = 0;
      
    for (const nodeId of nodeIds) {
      const perf = performanceMap.get(nodeId);
      
      if (!perf) {
        console.log(`⚠️  No performance data for ${nodeId}`);
        continue;
      }
      
      // Skip nodes that failed RPC verification
      if (!perf.rpcVerified) {
        console.log(`⚠️  Node ${nodeId.slice(0, 10)}... failed RPC verification - skipping update`);
        continue;
      }
      
      try {
        // Check if update is needed
        const [, currentPerf] = await this.contract.getNodeInfo(nodeId);
          
          const shouldUpdate = 
            Math.abs(currentPerf.uptimeScore - perf.uptimeScore) > 100 || // 1% change
            perf.requestsServed !== currentPerf.requestsServed ||
            Math.abs(currentPerf.avgResponseTime - perf.avgResponseTime) > 50; // 50ms change
          
          if (!shouldUpdate) {
            console.log(`✓ ${nodeId.slice(0, 10)}... - no update needed`);
            continue;
          }
          
          console.log(`📊 Updating ${nodeId.slice(0, 10)}...`);
          console.log(`   Uptime: ${(perf.uptimeScore / 100).toFixed(2)}%`);
          console.log(`   Requests: ${perf.requestsServed}`);
          console.log(`   Response: ${perf.avgResponseTime}ms`);
          
          const tx = await this.contract.updatePerformance(
            nodeId,
            perf.uptimeScore,
            perf.requestsServed,
            perf.avgResponseTime,
            {
              gasLimit: 200000,
            }
          );
          
          await tx.wait();
          
          console.log(`✅ Updated successfully (tx: ${tx.hash.slice(0, 10)}...)`);
          updated++;
          
        } catch (error: any) {
          console.error(`❌ Failed to update ${nodeId}:`, error.message);
          failed++;
        }
        
        // Rate limit to avoid spamming
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`\n✅ Update complete: ${updated} updated, ${failed} failed`);
      
    } catch (error) {
      console.error('❌ Update failed:', error);
    }
  }
  
  async checkAndStartNewPeriod() {
    try {
      // Check if 30 days have passed since current period start
      // This would typically be called once per month
      const tx = await this.contract.startNewPeriod();
      await tx.wait();
      console.log('✅ New reward period started');
    } catch (error: any) {
      // Expected to fail if period hasn't ended yet
      if (!error.message.includes('TooSoonToClaim')) {
        console.error('❌ Failed to start new period:', error.message);
      }
    }
  }
  
  async getStatistics() {
    console.log('\n📊 Rewards Statistics:');
    
    try {
      const nodeIds = await this.contract.getAllNodes();
      
      let totalStaked = 0n;
      let totalRewards = 0n;
      let activeCount = 0;
      
      for (const nodeId of nodeIds) {
        const [node, , pendingRewards] = await this.contract.getNodeInfo(nodeId);
        
        if (node.isActive) {
          activeCount++;
          totalStaked += node.stakedAmount;
          totalRewards += pendingRewards;
        }
      }
      
      console.log(`   Total Nodes: ${nodeIds.length}`);
      console.log(`   Active Nodes: ${activeCount}`);
      console.log(`   Total Staked: ${ethers.formatEther(totalStaked)} JEJU`);
      console.log(`   Pending Rewards: ${ethers.formatEther(totalRewards)} JEJU`);
      
    } catch (error) {
      console.error('Failed to fetch statistics:', error);
    }
  }
}

// ============ Main Loop ============

async function main() {
  console.log('🚀 Jeju Rewards Oracle starting...');
  console.log(`   Contract: ${CONFIG.REWARDS_CONTRACT}`);
  console.log(`   Node Explorer: ${CONFIG.NODE_EXPLORER_API}`);
  console.log(`   Update Interval: ${CONFIG.UPDATE_INTERVAL / 1000}s`);
  
  if (!CONFIG.ORACLE_PRIVATE_KEY) {
    console.error('❌ ORACLE_PRIVATE_KEY environment variable required');
    process.exit(1);
  }
  
  if (!CONFIG.REWARDS_CONTRACT) {
    console.error('❌ REWARDS_CONTRACT environment variable required');
    process.exit(1);
  }
  
  const oracle = new RewardsOracle();
  
  // Initial update
  await oracle.updateAllNodes();
  await oracle.checkAndStartNewPeriod();
  await oracle.getStatistics();
  
  // Periodic updates
  setInterval(async () => {
    try {
      await oracle.updateAllNodes();
    } catch (error) {
      console.error('❌ Update failed:', error);
    }
  }, CONFIG.UPDATE_INTERVAL);
  
  // Check for new period daily
  setInterval(async () => {
    try {
      await oracle.checkAndStartNewPeriod();
    } catch (error) {
      // Silent fail - expected most of the time
    }
  }, 86400000); // 24 hours
  
  // Statistics every 6 hours
  setInterval(async () => {
    try {
      await oracle.getStatistics();
    } catch (error) {
      console.error('❌ Statistics failed:', error);
    }
  }, 21600000); // 6 hours
  
  console.log('\n✅ Oracle running. Press Ctrl+C to stop.\n');
}

if (import.meta.main) {
  main().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

export { RewardsOracle };


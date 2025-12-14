#!/usr/bin/env bun
/**
 * Deploy MPC Node to Phala TEE
 *
 * Deploys MPC node(s) to Phala Cloud CVM for production TEE-backed
 * threshold key management and signing.
 *
 * Usage:
 *   PHALA_API_KEY=xxx bun run scripts/deploy-mpc-phala.ts
 *
 * Environment:
 *   PHALA_API_KEY      - Phala Cloud API key (required)
 *   PHALA_CLUSTER_ID   - Phala cluster ID (optional)
 *   MPC_NETWORK_ID     - Network ID (default: jeju-testnet)
 *   MPC_NODE_COUNT     - Number of nodes to deploy (default: 1)
 *   MPC_THRESHOLD      - Signing threshold (default: 1)
 */

import { getPhalaProvider } from '../src/infra/phala-provider';

const DOCKER_IMAGE = 'ghcr.io/jeju-ai/mpc-node:latest';

interface DeployedNode {
  nodeId: string;
  endpoint: string;
  cvmId: string;
}

async function deployMPCNodes(): Promise<void> {
  console.log('🔐 Deploying MPC Nodes to Phala TEE\n');

  // Check for API key
  const apiKey = process.env.PHALA_API_KEY;
  if (!apiKey) {
    console.error('❌ PHALA_API_KEY environment variable is required');
    console.error('   Get one at: https://cloud.phala.network');
    process.exit(1);
  }

  const networkId = process.env.MPC_NETWORK_ID ?? 'jeju-testnet';
  const nodeCount = parseInt(process.env.MPC_NODE_COUNT ?? '1', 10);
  const threshold = parseInt(process.env.MPC_THRESHOLD ?? '1', 10);

  console.log(`Network: ${networkId}`);
  console.log(`Nodes: ${nodeCount}`);
  console.log(`Threshold: ${threshold}/${nodeCount}\n`);

  // Get Phala provider
  const provider = getPhalaProvider({
    apiKey,
    clusterId: process.env.PHALA_CLUSTER_ID,
  });

  if (!provider.isAvailable()) {
    console.error('❌ Phala Cloud API not available');
    console.error('   Check your API key and network connectivity');
    process.exit(1);
  }

  console.log('✅ Connected to Phala Cloud\n');

  const deployedNodes: DeployedNode[] = [];

  // Deploy nodes
  for (let i = 0; i < nodeCount; i++) {
    const nodeId = `mpc-node-${networkId}-${i + 1}`;
    console.log(`Deploying ${nodeId}...`);

    const node = await provider.provisionBackend({
      dockerImage: DOCKER_IMAGE,
      memoryGb: 4,
      cpuCores: 2,
      env: {
        MPC_NODE_ID: nodeId,
        MPC_NETWORK_ID: networkId,
        MPC_PORT: '4010',
        MPC_THRESHOLD: threshold.toString(),
        MPC_TOTAL_SHARES: nodeCount.toString(),
        MPC_VERBOSE: 'true',
        NODE_ENV: 'production',
      },
      healthCheck: {
        path: '/health',
        interval: 30,
        timeout: 10,
      },
    });

    deployedNodes.push({
      nodeId,
      endpoint: node.endpoint,
      cvmId: node.id,
    });

    console.log(`  ✅ Deployed: ${node.endpoint}`);
  }

  // Wait for nodes to be healthy
  console.log('\nWaiting for nodes to become healthy...');
  await waitForHealth(deployedNodes);

  // Output configuration
  console.log('\n' + '='.repeat(60));
  console.log('MPC Network Deployed Successfully!');
  console.log('='.repeat(60));

  console.log('\nNode Endpoints:');
  for (const node of deployedNodes) {
    console.log(`  ${node.nodeId}: ${node.endpoint}`);
  }

  console.log('\nEnvironment Variables for @babylon/auth:');
  console.log(`  MPC_ENDPOINTS=${deployedNodes.map((n) => n.endpoint).join(',')}`);
  console.log(`  MPC_NETWORK_ID=${networkId}`);
  console.log(`  MPC_THRESHOLD=${threshold}`);

  console.log('\nPeer Configuration:');
  const peers = deployedNodes.map((n) => `${n.nodeId}@${n.endpoint}`).join(',');
  console.log(`  MPC_PEERS=${peers}`);
}

async function waitForHealth(nodes: DeployedNode[]): Promise<void> {
  const maxAttempts = 30;
  const delayMs = 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`  Checking health (attempt ${attempt}/${maxAttempts})...`);

    const results = await Promise.all(
      nodes.map(async (node) => {
        try {
          const response = await fetch(`${node.endpoint}/health`, {
            signal: AbortSignal.timeout(5000),
          });
          return response.ok;
        } catch {
          return false;
        }
      })
    );

    const healthyCount = results.filter(Boolean).length;
    console.log(`    ${healthyCount}/${nodes.length} healthy`);

    if (healthyCount === nodes.length) {
      console.log('  ✅ All nodes healthy!');
      return;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  console.warn('  ⚠️ Some nodes may not be healthy yet');
}

// Run deployment
deployMPCNodes().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});

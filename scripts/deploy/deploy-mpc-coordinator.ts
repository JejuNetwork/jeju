#!/usr/bin/env bun
/**
 * Deploy MPC Coordinator for threshold signing
 * 
 * Usage:
 *   bun run scripts/deploy/deploy-mpc-coordinator.ts --network localnet|testnet|mainnet
 * 
 * This script:
 * 1. Deploys MPC coordinator service
 * 2. Registers initial party nodes
 * 3. Generates initial key for system operations
 */

import { parseArgs } from 'util';
import { getMPCCoordinator, resetMPCCoordinator, getMPCConfig, type MPCCoordinatorConfig } from '../../packages/kms/src/mpc/index.js';
import { toHex, type Address } from 'viem';

type Network = 'localnet' | 'testnet' | 'mainnet';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    network: { type: 'string', short: 'n', default: 'localnet' },
    parties: { type: 'string', short: 'p', default: '3' },
    threshold: { type: 'string', short: 't' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const network = (values.network ?? 'localnet') as Network;
const totalParties = parseInt(values.parties ?? '3');
const dryRun = values['dry-run'] ?? false;

async function main() {
  console.log('='.repeat(60));
  console.log(`MPC Coordinator Deployment - ${network.toUpperCase()}`);
  console.log('='.repeat(60));

  const config = getMPCConfig(network);
  const threshold = values.threshold ? parseInt(values.threshold) : config.threshold;

  console.log('\nConfiguration:');
  console.log(`  Network: ${network}`);
  console.log(`  Threshold: ${threshold}-of-${totalParties}`);
  console.log(`  Session Timeout: ${config.sessionTimeout / 1000}s`);
  console.log(`  Max Concurrent Sessions: ${config.maxConcurrentSessions}`);
  console.log(`  Require Attestation: ${config.requireAttestation}`);
  console.log(`  Min Party Stake: ${config.minPartyStake} wei`);
  console.log(`  Dry Run: ${dryRun}`);

  if (threshold < 2) {
    console.error('\nError: Threshold must be at least 2');
    process.exit(1);
  }

  if (threshold > totalParties) {
    console.error(`\nError: Threshold (${threshold}) cannot exceed total parties (${totalParties})`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Would deploy coordinator with above configuration');
    return;
  }

  // Reset and create coordinator
  resetMPCCoordinator();
  process.env.MPC_NETWORK = network;
  process.env.MPC_THRESHOLD = threshold.toString();
  process.env.MPC_TOTAL_PARTIES = totalParties.toString();

  const coordinator = getMPCCoordinator({ threshold, totalParties, network });

  console.log('\n--- Registering Party Nodes ---');

  // Generate and register parties
  const partyEndpoints = generatePartyEndpoints(network, totalParties);

  for (let i = 0; i < totalParties; i++) {
    const partyKey = crypto.getRandomValues(new Uint8Array(32));
    const partyId = `party-${i + 1}`;
    
    try {
      const party = coordinator.registerParty({
        id: partyId,
        index: i + 1,
        endpoint: partyEndpoints[i],
        publicKey: toHex(partyKey),
        address: `0x${toHex(partyKey).slice(2, 42)}` as Address,
        stake: config.minPartyStake,
        registeredAt: Date.now(),
      });
      
      console.log(`  [OK] Registered ${partyId} at ${party.endpoint}`);
    } catch (error) {
      console.error(`  [FAIL] Failed to register ${partyId}: ${(error as Error).message}`);
    }
  }

  // Verify all parties registered
  const activeParties = coordinator.getActiveParties();
  console.log(`\n  Total active parties: ${activeParties.length}/${totalParties}`);

  if (activeParties.length < threshold) {
    console.error(`\nError: Not enough active parties (${activeParties.length}) for threshold (${threshold})`);
    process.exit(1);
  }

  console.log('\n--- Generating System Key ---');

  const systemKeyId = `system-${network}-${Date.now().toString(36)}`;
  const partyIds = activeParties.map(p => p.id);

  try {
    const keyResult = await coordinator.generateKey({
      keyId: systemKeyId,
      threshold,
      totalParties,
      partyIds,
      curve: 'secp256k1',
    });

    console.log(`  Key ID: ${keyResult.keyId}`);
    console.log(`  Address: ${keyResult.address}`);
    console.log(`  Public Key: ${keyResult.publicKey.slice(0, 20)}...`);
    console.log(`  Version: ${keyResult.version}`);
  } catch (error) {
    console.error(`  [FAIL] Key generation failed: ${(error as Error).message}`);
    process.exit(1);
  }

  // Get status
  const status = coordinator.getStatus();
  
  console.log('\n--- Coordinator Status ---');
  console.log(`  Active Parties: ${status.activeParties}`);
  console.log(`  Total Keys: ${status.totalKeys}`);
  console.log(`  Active Sessions: ${status.activeSessions}`);

  console.log('\n' + '='.repeat(60));
  console.log('MPC Coordinator deployed successfully.');
  console.log('='.repeat(60));

  // Output environment variables to set
  console.log('\nSet these environment variables for applications:');
  console.log(`  export MPC_NETWORK=${network}`);
  console.log(`  export MPC_THRESHOLD=${threshold}`);
  console.log(`  export MPC_TOTAL_PARTIES=${totalParties}`);
  
  if (network !== 'localnet') {
    console.log(`  export MPC_COORDINATOR_ENDPOINT=https://mpc.jeju.network/${network}`);
  }
}

function generatePartyEndpoints(network: Network, count: number): string[] {
  const basePort = 4100;
  const endpoints: string[] = [];
  
  for (let i = 0; i < count; i++) {
    switch (network) {
      case 'localnet':
        endpoints.push(`http://localhost:${basePort + i}`);
        break;
      case 'testnet':
        endpoints.push(`https://mpc-party-${i + 1}.testnet.jeju.network`);
        break;
      case 'mainnet':
        endpoints.push(`https://mpc-party-${i + 1}.jeju.network`);
        break;
    }
  }
  
  return endpoints;
}

main().catch(error => {
  console.error('Deployment failed:', error);
  process.exit(1);
});


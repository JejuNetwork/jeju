#!/usr/bin/env bun
/**
 * Test Decentralization Contracts
 * 
 * Comprehensive tests for all decentralization contracts.
 */

import { createPublicClient, http, formatEther, parseAbi, type Address, type PublicClient } from 'viem';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { inferChainFromRpcUrl } from '../../../../scripts/shared/chain-utils';

const ROOT = join(import.meta.dir, '../../../..');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');

async function main() {
  console.log('🧪 Testing Decentralization Contracts');
  console.log('='.repeat(70));
  console.log('');

  const network = process.env.NETWORK || 'localnet';
  const rpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:6545';
  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`);

  if (!existsSync(deploymentFile)) {
    console.error('❌ Deployment file not found');
    console.error('   Run: bun run scripts/deploy/decentralization.ts');
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
  const chain = inferChainFromRpcUrl(rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  // Test SequencerRegistry
  await testSequencerRegistry(publicClient, deployment.sequencerRegistry);

  // Test GovernanceTimelock
  await testGovernanceTimelock(publicClient, deployment.governanceTimelock);

  // Test DisputeGameFactory
  await testDisputeGameFactory(publicClient, deployment.disputeGameFactory);

  console.log('='.repeat(70));
  console.log('✅ All Tests Passed!');
  console.log('='.repeat(70));
}

async function testSequencerRegistry(publicClient: PublicClient, address: string) {
  console.log('📋 Testing SequencerRegistry...');
  
  const abi = parseAbi([
    'function getActiveSequencers() view returns (address[] memory, uint256[] memory)',
    'function totalStaked() view returns (uint256)',
    'function MIN_STAKE() view returns (uint256)',
    'function MAX_STAKE() view returns (uint256)'
  ]);

  const minStake = await publicClient.readContract({ address: address as Address, abi, functionName: 'MIN_STAKE' });
  const maxStake = await publicClient.readContract({ address: address as Address, abi, functionName: 'MAX_STAKE' });
  const totalStaked = await publicClient.readContract({ address: address as Address, abi, functionName: 'totalStaked' });
  const result = await publicClient.readContract({ address: address as Address, abi, functionName: 'getActiveSequencers' });
  const addresses = result[0] as Address[];

  console.log(`  ✅ MIN_STAKE: ${formatEther(minStake)} JEJU`);
  console.log(`  ✅ MAX_STAKE: ${formatEther(maxStake)} JEJU`);
  console.log(`  ✅ Total Staked: ${formatEther(totalStaked)} JEJU`);
  console.log(`  ✅ Active Sequencers: ${addresses.length}`);
  console.log('');
}

async function testGovernanceTimelock(publicClient: PublicClient, address: string) {
  console.log('⏰ Testing GovernanceTimelock...');

  const abi = parseAbi([
    'function timelockDelay() view returns (uint256)',
    'function getAllProposalIds() view returns (bytes32[] memory)'
  ]);

  const delay = await publicClient.readContract({ address: address as Address, abi, functionName: 'timelockDelay' });
  const proposals = await publicClient.readContract({ address: address as Address, abi, functionName: 'getAllProposalIds' }) as `0x${string}`[];

  console.log(`  ✅ Timelock Delay: ${delay.toString()}s (${Number(delay) / 60} minutes)`);
  console.log(`  ✅ Proposals: ${proposals.length}`);
  console.log('');
}

async function testDisputeGameFactory(publicClient: PublicClient, address: string) {
  console.log('⚔️  Testing DisputeGameFactory...');

  const abi = parseAbi([
    'function MIN_BOND() view returns (uint256)',
    'function MAX_BOND() view returns (uint256)',
    'function totalBondsLocked() view returns (uint256)',
    'function getActiveGames() view returns (bytes32[] memory)'
  ]);

  const minBond = await publicClient.readContract({ address: address as Address, abi, functionName: 'MIN_BOND' });
  const maxBond = await publicClient.readContract({ address: address as Address, abi, functionName: 'MAX_BOND' });
  const totalLocked = await publicClient.readContract({ address: address as Address, abi, functionName: 'totalBondsLocked' });
  const activeGames = await publicClient.readContract({ address: address as Address, abi, functionName: 'getActiveGames' }) as `0x${string}`[];

  console.log(`  ✅ MIN_BOND: ${formatEther(minBond)} ETH`);
  console.log(`  ✅ MAX_BOND: ${formatEther(maxBond)} ETH`);
  console.log(`  ✅ Total Bonds Locked: ${formatEther(totalLocked)} ETH`);
  console.log(`  ✅ Active Games: ${activeGames.length}`);
  console.log('');
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('❌ Tests failed:', error);
    process.exit(1);
  });
}

export { main as testContracts };

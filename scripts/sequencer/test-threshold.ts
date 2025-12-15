#!/usr/bin/env bun
/**
 * Test Stage 2 Contracts
 * 
 * Comprehensive tests for all Stage 2 contracts.
 */

import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');

async function main() {
  console.log('🧪 Testing Stage 2 Contracts');
  console.log('='.repeat(70));
  console.log('');

  const network = process.env.NETWORK || 'localnet';
  const rpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  const deploymentFile = join(DEPLOYMENTS_DIR, `stage2-${network}.json`);

  if (!existsSync(deploymentFile)) {
    console.error('❌ Deployment file not found');
    console.error('   Run: bun run scripts/stage2-poc/deploy-l1.ts');
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Test SequencerRegistry
  await testSequencerRegistry(provider, deployment.sequencerRegistry);

  // Test GovernanceTimelock
  await testGovernanceTimelock(provider, deployment.governanceTimelock);

  // Test DisputeGameFactory
  await testDisputeGameFactory(provider, deployment.disputeGameFactory);

  console.log('='.repeat(70));
  console.log('✅ All Tests Passed!');
  console.log('='.repeat(70));
}

async function testSequencerRegistry(provider: ethers.Provider, address: string) {
  console.log('📋 Testing SequencerRegistry...');
  
  // Load ABI (simplified - in production would load from artifacts)
  const abi = [
    'function getActiveSequencers() view returns (address[] memory, uint256[] memory)',
    'function totalStaked() view returns (uint256)',
    'function MIN_STAKE() view returns (uint256)',
    'function MAX_STAKE() view returns (uint256)'
  ];

  const contract = new ethers.Contract(address, abi, provider);

  try {
    const minStake = await contract.MIN_STAKE();
    const maxStake = await contract.MAX_STAKE();
    const totalStaked = await contract.totalStaked();
    const [addresses] = await contract.getActiveSequencers();

    console.log(`  ✅ MIN_STAKE: ${ethers.formatEther(minStake)} JEJU`);
    console.log(`  ✅ MAX_STAKE: ${ethers.formatEther(maxStake)} JEJU`);
    console.log(`  ✅ Total Staked: ${ethers.formatEther(totalStaked)} JEJU`);
    console.log(`  ✅ Active Sequencers: ${addresses.length}`);
    console.log('');
  } catch (error) {
    console.error('  ❌ SequencerRegistry test failed:', error);
    throw error;
  }
}

async function testGovernanceTimelock(provider: ethers.Provider, address: string) {
  console.log('⏰ Testing GovernanceTimelock...');

  const abi = [
    'function timelockDelay() view returns (uint256)',
    'function getAllProposalIds() view returns (bytes32[] memory)'
  ];

  const contract = new ethers.Contract(address, abi, provider);

  try {
    const delay = await contract.timelockDelay();
    const proposals = await contract.getAllProposalIds();

    console.log(`  ✅ Timelock Delay: ${delay.toString()}s (${Number(delay) / 60} minutes)`);
    console.log(`  ✅ Proposals: ${proposals.length}`);
    console.log('');
  } catch (error) {
    console.error('  ❌ GovernanceTimelock test failed:', error);
    throw error;
  }
}

async function testDisputeGameFactory(provider: ethers.Provider, address: string) {
  console.log('⚔️  Testing DisputeGameFactory...');

  const abi = [
    'function MIN_BOND() view returns (uint256)',
    'function MAX_BOND() view returns (uint256)',
    'function totalBondsLocked() view returns (uint256)',
    'function getActiveGames() view returns (bytes32[] memory)'
  ];

  const contract = new ethers.Contract(address, abi, provider);

  try {
    const minBond = await contract.MIN_BOND();
    const maxBond = await contract.MAX_BOND();
    const totalLocked = await contract.totalBondsLocked();
    const activeGames = await contract.getActiveGames();

    console.log(`  ✅ MIN_BOND: ${ethers.formatEther(minBond)} ETH`);
    console.log(`  ✅ MAX_BOND: ${ethers.formatEther(maxBond)} ETH`);
    console.log(`  ✅ Total Bonds Locked: ${ethers.formatEther(totalLocked)} ETH`);
    console.log(`  ✅ Active Games: ${activeGames.length}`);
    console.log('');
  } catch (error) {
    console.error('  ❌ DisputeGameFactory test failed:', error);
    throw error;
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('❌ Tests failed:', error);
    process.exit(1);
  });
}

export { main as testContracts };


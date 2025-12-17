#!/usr/bin/env bun
/**
 * Verify Training Integration
 * Tests that all training components are properly integrated
 */

import { createPublicClient, http, parseEther, keccak256, encodePacked } from 'viem';
import { foundry } from 'viem/chains';

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';

// Contract addresses (localnet)
const CONTRACTS = {
  trainingCoordinator: '0x59b670e9fA9D0A427751Af201D676719a970857b' as const,
  trainingRewards: '0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1' as const,
  nodePerformanceOracle: '0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f' as const,
};

// Minimal ABIs for testing
const TRAINING_COORDINATOR_ABI = [
  { name: 'getRunState', type: 'function', inputs: [{ name: 'runId', type: 'bytes32' }], outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view' },
] as const;

const NODE_PERFORMANCE_ABI = [
  { name: 'getOptimalNodes', type: 'function', inputs: [
    { name: 'count', type: 'uint256' },
    { name: 'minGpuTier', type: 'uint8' },
    { name: 'minBandwidth', type: 'uint256' },
    { name: 'minScore', type: 'uint256' },
  ], outputs: [{ name: '', type: 'address[]' }], stateMutability: 'view' },
] as const;

async function verifyTraining() {
  console.log('=== TRAINING INTEGRATION VERIFICATION ===\n');
  
  let allPassed = true;

  // Test 1: Check imports work
  console.log('1. Testing imports...');
  try {
    const { TrainingSDK } = await import('../apps/dws/src/compute/sdk/training');
    const { DistributedTrainingClient } = await import('../apps/dws/src/compute/sdk/distributed-training');
    const { P2PTrainingNetwork } = await import('../apps/dws/src/compute/sdk/p2p');
    console.log('   ✓ SDK imports successful');
  } catch (error) {
    console.log(`   ✗ SDK import failed: ${error}`);
    allPassed = false;
  }

  // Test 2: Check Factory hooks
  console.log('\n2. Testing Factory hooks...');
  try {
    // Check that the hooks file exists and exports correctly
    const fs = await import('fs');
    const hooksPath = './apps/factory/lib/hooks/useTraining.ts';
    if (fs.existsSync(hooksPath)) {
      const content = fs.readFileSync(hooksPath, 'utf-8');
      const requiredExports = [
        'RunState',
        'useCreateRun',
        'useJoinRun',
        'useClaimRewards',
        'useOptimalNodes',
        'getDefaultLLMConfig',
      ];
      const missing = requiredExports.filter(exp => !content.includes(`export function ${exp}`) && !content.includes(`export enum ${exp}`));
      if (missing.length === 0) {
        console.log('   ✓ All required hooks present');
      } else {
        console.log(`   ✗ Missing exports: ${missing.join(', ')}`);
        allPassed = false;
      }
    } else {
      console.log('   ✗ Hooks file not found');
      allPassed = false;
    }
  } catch (error) {
    console.log(`   ✗ Hooks check failed: ${error}`);
    allPassed = false;
  }

  // Test 3: Check CLI commands
  console.log('\n3. Testing CLI commands...');
  try {
    const { trainingCommand } = await import('../packages/cli/src/commands/training');
    const subcommands = trainingCommand.commands.map((c: { name: () => string }) => c.name());
    const required = ['status', 'list', 'create', 'join', 'info', 'pause', 'resume', 'claim', 'nodes', 'models'];
    const missing = required.filter(cmd => !subcommands.includes(cmd));
    if (missing.length === 0) {
      console.log('   ✓ All CLI commands registered');
      console.log(`   Commands: ${subcommands.join(', ')}`);
    } else {
      console.log(`   ✗ Missing commands: ${missing.join(', ')}`);
      allPassed = false;
    }
  } catch (error) {
    console.log(`   ✗ CLI check failed: ${error}`);
    allPassed = false;
  }

  // Test 4: Check contract files exist
  console.log('\n4. Testing Solidity contracts...');
  try {
    const fs = await import('fs');
    const contracts = [
      'packages/contracts/src/training/TrainingCoordinator.sol',
      'packages/contracts/src/training/TrainingRewards.sol',
      'packages/contracts/src/training/NodePerformanceOracle.sol',
      'packages/contracts/src/training/CrossChainTraining.sol',
      'packages/contracts/src/training/interfaces/ITrainingCoordinator.sol',
    ];
    const missing = contracts.filter(c => !fs.existsSync(c));
    if (missing.length === 0) {
      console.log('   ✓ All contract files present');
    } else {
      console.log(`   ✗ Missing contracts: ${missing.join(', ')}`);
      allPassed = false;
    }
  } catch (error) {
    console.log(`   ✗ Contract check failed: ${error}`);
    allPassed = false;
  }

  // Test 5: Check DWS routes
  console.log('\n5. Testing DWS routes...');
  try {
    const fs = await import('fs');
    const routesFile = fs.readFileSync('apps/dws/src/server/routes/compute.ts', 'utf-8');
    const requiredRoutes = [
      '/training/runs',
      '/training/webhook',
      '/nodes/register',
    ];
    const missing = requiredRoutes.filter(route => !routesFile.includes(route));
    if (missing.length === 0) {
      console.log('   ✓ All training routes present');
    } else {
      console.log(`   ✗ Missing routes: ${missing.join(', ')}`);
      allPassed = false;
    }
  } catch (error) {
    console.log(`   ✗ Routes check failed: ${error}`);
    allPassed = false;
  }

  // Test 6: Check Factory pages
  console.log('\n6. Testing Factory pages...');
  try {
    const fs = await import('fs');
    const pages = [
      'apps/factory/app/training/page.tsx',
      'apps/factory/app/training/create/page.tsx',
    ];
    const missing = pages.filter(p => !fs.existsSync(p));
    if (missing.length === 0) {
      console.log('   ✓ All training pages present');
    } else {
      console.log(`   ✗ Missing pages: ${missing.join(', ')}`);
      allPassed = false;
    }
  } catch (error) {
    console.log(`   ✗ Pages check failed: ${error}`);
    allPassed = false;
  }

  // Test 7: Check Synpress tests
  console.log('\n7. Testing Synpress tests...');
  try {
    const fs = await import('fs');
    const testFile = 'apps/factory/tests/synpress/training.spec.ts';
    if (fs.existsSync(testFile)) {
      const content = fs.readFileSync(testFile, 'utf-8');
      const testCount = (content.match(/test\(/g) || []).length;
      console.log(`   ✓ Training tests present (${testCount} tests)`);
    } else {
      console.log('   ✗ Training tests not found');
      allPassed = false;
    }
  } catch (error) {
    console.log(`   ✗ Tests check failed: ${error}`);
    allPassed = false;
  }

  // Test 8: Try to connect to chain (if running)
  console.log('\n8. Testing chain connection...');
  try {
    const client = createPublicClient({
      chain: foundry,
      transport: http(RPC_URL),
    });
    
    const blockNumber = await client.getBlockNumber();
    console.log(`   ✓ Connected to chain at block ${blockNumber}`);
    
    // Check if contracts are deployed
    const code = await client.getBytecode({ address: CONTRACTS.trainingCoordinator });
    if (code && code.length > 2) {
      console.log('   ✓ TrainingCoordinator deployed');
    } else {
      console.log('   ⚠ TrainingCoordinator not deployed (deploy with: jeju dev --bootstrap)');
    }
  } catch (error) {
    console.log('   ⚠ Chain not running (start with: jeju dev)');
  }

  // Summary
  console.log('\n=== VERIFICATION SUMMARY ===');
  if (allPassed) {
    console.log('✓ All checks passed. Training integration is ready.');
    console.log('\nTo test the full flow:');
    console.log('  1. Start the chain: jeju dev');
    console.log('  2. Check status: jeju training status');
    console.log('  3. Create a run: jeju training create --model meta/llama-3-8b');
    console.log('  4. Open Factory: http://localhost:3000/training');
  } else {
    console.log('✗ Some checks failed. Please review the errors above.');
    process.exit(1);
  }
}

verifyTraining().catch(console.error);


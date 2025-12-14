#!/usr/bin/env bun
/**
 * Deploy to Sepolia and run integration tests
 * 
 * Prerequisites:
 *   - PRIVATE_KEY with Sepolia ETH (at least 0.15 ETH)
 * 
 * Usage:
 *   PRIVATE_KEY=0x... bun run scripts/deploy-and-test-sepolia.ts
 */

import { JsonRpcProvider, formatEther, Wallet } from 'ethers';
import { spawn } from 'child_process';
import { join } from 'path';

const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const MIN_DEPLOY_BALANCE = 0.05;
const MIN_TEST_BALANCE = 0.15;

async function run(cmd: string, args: string[], env: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      cwd: process.cwd(),
    });
    proc.on('close', resolve);
    proc.on('error', reject);
  });
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  const wallet = new Wallet(privateKey);
  const provider = new JsonRpcProvider(SEPOLIA_RPC);
  const balance = await provider.getBalance(wallet.address);
  const balanceEth = parseFloat(formatEther(balance));

  console.log('🚀 Sepolia Deployment & Test');
  console.log('============================\n');
  console.log(`Address: ${wallet.address}`);
  console.log(`Balance: ${balanceEth.toFixed(4)} ETH\n`);

  if (balanceEth < MIN_DEPLOY_BALANCE) {
    console.error(`❌ Insufficient balance. Need at least ${MIN_DEPLOY_BALANCE} ETH for deployment.`);
    console.error(`   Run: bun run scripts/get-sepolia-eth.ts ${wallet.address}`);
    process.exit(1);
  }

  // Step 1: Deploy contracts
  console.log('📦 Step 1: Deploying contracts to Sepolia...\n');
  const deployScript = join(process.cwd(), 'apps/compute/src/compute/scripts/deploy-base.ts');
  const deployResult = await run('bun', ['run', deployScript], {
    NETWORK: 'sepolia',
    PRIVATE_KEY: privateKey,
  });

  if (deployResult !== 0) {
    console.error('❌ Deployment failed');
    process.exit(1);
  }

  console.log('\n✅ Deployment complete!\n');

  // Step 2: Run read-only tests
  console.log('🧪 Step 2: Running read-only integration tests...\n');
  const testResult = await run('bun', ['test', 'apps/compute/src/compute/tests/mainnet.test.ts'], {
    NETWORK: 'sepolia',
  });

  if (testResult !== 0) {
    console.error('❌ Read-only tests failed');
    process.exit(1);
  }

  console.log('\n✅ Read-only tests passed!\n');

  // Step 3: Run write tests if enough balance
  if (balanceEth >= MIN_TEST_BALANCE) {
    console.log('🧪 Step 3: Running write tests...\n');
    const writeTestResult = await run('bun', ['test', 'apps/compute/src/compute/tests/mainnet.test.ts'], {
      NETWORK: 'sepolia',
      PRIVATE_KEY: privateKey,
      RUN_WRITE_TESTS: 'true',
    });

    if (writeTestResult !== 0) {
      console.error('⚠️  Write tests failed (non-critical)');
    } else {
      console.log('\n✅ Write tests passed!\n');
    }
  } else {
    console.log(`⏭️  Step 3: Skipping write tests (need ${MIN_TEST_BALANCE} ETH, have ${balanceEth.toFixed(4)})\n`);
  }

  console.log('🎉 All done!');
  console.log(`\nDeployment saved to: apps/compute/deployments/sepolia.json`);
}

main().catch(console.error);

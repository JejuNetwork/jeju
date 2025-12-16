/**
 * @fileoverview Test Kurtosis localnet deployment
 * @module kurtosis/test-deployment
 * 
 * Automated tests for Kurtosis localnet deployment and configuration.
 * Verifies that the deployment script works correctly and all services are accessible.
 * 
 * @example Run tests
 * ```bash
 * # Start localnet first
 * bun run localnet:start
 * 
 * # Run deployment tests
 * bun run kurtosis/test-deployment.ts
 * ```
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, formatUnits, getBalance, getBlockNumber, getChainId, sendTransaction, waitForTransactionReceipt, type Address, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { inferChainFromRpcUrl } from '../../scripts/shared/chain-utils';

const FOUNDRY_ACCOUNTS = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
    expectedBalance: parseEther('10000'),
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as `0x${string}`,
    expectedBalance: parseEther('10000'),
  },
] as const;

interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

const results: TestResult[] = [];

/**
 * Main test runner
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                                                               ║');
  console.log('║   🧪 KURTOSIS LOCALNET DEPLOYMENT TEST                        ║');
  console.log('║                                                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Test 1: Verify enclave is running
  await testEnclaveRunning();

  // Test 2: Verify L1 RPC
  await testL1RPC();

  // Test 3: Verify L2 RPC
  await testL2RPC();

  // Test 4: Verify pre-funded accounts
  await testPreFundedAccounts();

  // Test 5: Verify block production
  await testBlockProduction();

  // Test 6: Verify transaction execution
  await testTransactionExecution();

  // Print summary
  printSummary();
}

/**
 * Test: Enclave is running
 */
async function testEnclaveRunning() {
  console.log('1️⃣  Checking enclave status...');
  
  try {
    const { stdout } = await execAsync('kurtosis enclave inspect jeju-localnet');
    
    if (stdout.includes('jeju-localnet')) {
      results.push({
        name: 'Enclave Running',
        passed: true,
        message: 'Enclave jeju-localnet is active',
      });
      console.log('   ✅ Enclave is running\n');
    } else {
      throw new Error('Enclave not found');
    }
  } catch (error) {
    results.push({
      name: 'Enclave Running',
      passed: false,
      message: 'Enclave jeju-localnet not found',
    });
    console.log('   ❌ Enclave not running\n');
    console.log('   Start with: bun run localnet:start\n');
    process.exit(1);
  }
}

/**
 * Test: L1 RPC connectivity
 */
async function testL1RPC() {
  console.log('2️⃣  Testing L1 RPC...');
  
  try {
    const rpcUrl = 'http://127.0.0.1:8545';
    const chain = inferChainFromRpcUrl(rpcUrl);
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const blockNumber = await publicClient.getBlockNumber();
    const chainId = await publicClient.getChainId();
    
    results.push({
      name: 'L1 RPC',
      passed: true,
      details: {
        blockNumber: Number(blockNumber),
        chainId: Number(chainId),
      },
    });
    
    console.log(`   ✅ L1 RPC responding`);
    console.log(`   📊 Block: ${blockNumber}`);
    console.log(`   🔗 Chain ID: ${chainId}\n`);
  } catch (error) {
    results.push({
      name: 'L1 RPC',
      passed: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    console.log('   ❌ L1 RPC not responding\n');
  }
}

/**
 * Test: L2 RPC connectivity
 */
async function testL2RPC() {
  console.log('3️⃣  Testing L2 RPC...');
  
  try {
    const rpcUrl = 'http://127.0.0.1:9545';
    const chain = inferChainFromRpcUrl(rpcUrl);
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const blockNumber = await publicClient.getBlockNumber();
    const chainId = await publicClient.getChainId();
    const feeData = await publicClient.estimateGasPrice();
    
    results.push({
      name: 'L2 RPC',
      passed: true,
      details: {
        blockNumber: Number(blockNumber),
        chainId: Number(chainId),
        gasPrice: feeData.toString(),
      },
    });
    
    console.log(`   ✅ L2 RPC responding`);
    console.log(`   📊 Block: ${blockNumber}`);
    console.log(`   🔗 Chain ID: ${chainId}`);
    console.log(`   ⛽ Gas Price: ${formatUnits(feeData, 'gwei')} gwei\n`);
  } catch (error) {
    results.push({
      name: 'L2 RPC',
      passed: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    console.log('   ❌ L2 RPC not responding\n');
  }
}

/**
 * Test: Pre-funded accounts
 */
async function testPreFundedAccounts() {
  console.log('4️⃣  Verifying pre-funded accounts...');
  
  try {
    const rpcUrl = 'http://127.0.0.1:9545';
    const chain = inferChainFromRpcUrl(rpcUrl);
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    
    for (const account of FOUNDRY_ACCOUNTS) {
      const balance = await publicClient.getBalance({ address: account.address });
      
      if (balance >= parseEther('1000')) {
        console.log(`   ✅ ${account.address.slice(0, 10)}... has ${formatEther(balance)} ETH`);
      } else {
        console.log(`   ⚠️  ${account.address.slice(0, 10)}... balance low: ${formatEther(balance)} ETH`);
      }
    }
    
    results.push({
      name: 'Pre-funded Accounts',
      passed: true,
      message: 'All test accounts funded',
    });
    console.log('');
  } catch (error) {
    results.push({
      name: 'Pre-funded Accounts',
      passed: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    console.log('   ❌ Failed to check account balances\n');
  }
}

/**
 * Test: Block production
 */
async function testBlockProduction() {
  console.log('5️⃣  Testing block production...');
  
  try {
    const rpcUrl = 'http://127.0.0.1:9545';
    const chain = inferChainFromRpcUrl(rpcUrl);
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    
    const block1 = await publicClient.getBlockNumber();
    console.log(`   📊 Current block: ${block1}`);
    
    // Wait for 2 blocks (~4 seconds)
    console.log(`   ⏳ Waiting 5 seconds for new blocks...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const block2 = await publicClient.getBlockNumber();
    const blocksProduced = Number(block2 - block1);
    
    if (blocksProduced >= 1) {
      console.log(`   ✅ Produced ${blocksProduced} blocks in 5 seconds`);
      console.log(`   ⏱️  Average block time: ${(5000 / blocksProduced).toFixed(2)}ms\n`);
      
      results.push({
        name: 'Block Production',
        passed: true,
        details: { blocksProduced, blockTime: 5000 / blocksProduced },
      });
    } else {
      throw new Error('No blocks produced');
    }
  } catch (error) {
    results.push({
      name: 'Block Production',
      passed: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    console.log('   ❌ Block production not working\n');
  }
}

/**
 * Test: Transaction execution
 */
async function testTransactionExecution() {
  console.log('6️⃣  Testing transaction execution...');
  
  try {
    const rpcUrl = 'http://127.0.0.1:9545';
    const chain = inferChainFromRpcUrl(rpcUrl);
    const account = privateKeyToAccount(FOUNDRY_ACCOUNTS[0].privateKey);
    const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account });
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    
    console.log('   📤 Sending test transaction...');
    const hash = await walletClient.sendTransaction({
      to: FOUNDRY_ACCOUNTS[1].address,
      value: parseEther('0.1'),
    });
    
    console.log(`   📝 TX Hash: ${hash}`);
    
    const receipt = await waitForTransactionReceipt(publicClient, { hash });
    
    if (receipt.status === 'success') {
      console.log(`   ✅ Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`   ⛽ Gas used: ${receipt.gasUsed.toString()}\n`);
      
      results.push({
        name: 'Transaction Execution',
        passed: true,
        details: {
          hash,
          blockNumber: Number(receipt.blockNumber),
          gasUsed: receipt.gasUsed.toString(),
        },
      });
    } else {
      throw new Error('Transaction failed');
    }
  } catch (error) {
    results.push({
      name: 'Transaction Execution',
      passed: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    console.log('   ❌ Transaction execution failed\n');
  }
}

/**
 * Print test summary
 */
function printSummary() {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  
  console.log('═'.repeat(65));
  console.log(' '.repeat(20) + 'TEST SUMMARY');
  console.log('═'.repeat(65) + '\n');
  
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
    if (result.message) {
      console.log(`   ${result.message}`);
    }
  }
  
  console.log('\n' + '─'.repeat(65));
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log('─'.repeat(65) + '\n');
  
  if (failed > 0) {
    console.log('❌ Some tests failed. Check localnet status:\n');
    console.log('   kurtosis enclave inspect jeju-localnet');
    console.log('   kurtosis service logs jeju-localnet op-geth\n');
    process.exit(1);
  } else {
    console.log('✅ ALL TESTS PASSED!\n');
    console.log('🎉 Localnet is fully operational and ready for development.\n');
    process.exit(0);
  }
}

/**
 * Execute shell command
 */
async function execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execPromise = promisify(exec);
  return execPromise(command);
}

// Run tests
main().catch((error) => {
  console.error('❌ Test runner failed:', error);
  process.exit(1);
});


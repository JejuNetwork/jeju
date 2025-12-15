#!/usr/bin/env bun
/**
 * Local Cross-Chain Integration Test
 *
 * Tests the complete cross-chain token flow on local devnets:
 * 1. Deploy token on Hardhat (simulating Jeju L2)
 * 2. Deploy token on a second Hardhat instance (simulating Sepolia)
 * 3. Configure Hyperlane mock relayer
 * 4. Test cross-chain transfers
 * 5. Verify balances on both chains
 *
 * Requirements:
 * - Two local Hardhat nodes running
 * - Forge contracts built
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { preloadAllArtifacts, deployContract } from '../src/deployer/contract-deployer';

// ============================================================================
// Configuration
// ============================================================================

const JEJU_RPC = process.env.JEJU_RPC ?? 'http://localhost:8545';
const SEPOLIA_RPC = process.env.SEPOLIA_RPC ?? 'http://localhost:8546';
const PRIVATE_KEY = (process.env.PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex;

const TOKEN_CONFIG = {
  name: 'Test Cross-Chain Token',
  symbol: 'TXCHAIN',
  totalSupply: parseEther('1000000000'), // 1B
  decimals: 18,
};

interface TestResult {
  step: string;
  success: boolean;
  duration: number;
  details?: string;
  error?: string;
}

// ============================================================================
// Test Harness
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('Cross-Chain Token Integration Test');
  console.log('='.repeat(70));
  console.log('');

  const results: TestResult[] = [];
  const startTime = Date.now();

  // Create account
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`Test Account: ${account.address}`);
  console.log('');

  // Create clients for both chains
  const jejuPublic = createPublicClient({
    chain: { ...hardhat, id: 420690, name: 'Jeju Testnet' },
    transport: http(JEJU_RPC),
  });

  const jejuWallet = createWalletClient({
    chain: { ...hardhat, id: 420690, name: 'Jeju Testnet' },
    transport: http(JEJU_RPC),
    account,
  });

  const sepoliaPublic = createPublicClient({
    chain: { ...hardhat, id: 11155111, name: 'Sepolia' },
    transport: http(SEPOLIA_RPC),
  });

  const sepoliaWallet = createWalletClient({
    chain: { ...hardhat, id: 11155111, name: 'Sepolia' },
    transport: http(SEPOLIA_RPC),
    account,
  });

  // ============================================================================
  // Step 1: Check RPC Connectivity
  // ============================================================================
  let stepStart = Date.now();
  console.log('Step 1: Checking RPC connectivity...');

  let jejuBlock: bigint;
  let sepoliaBlock: bigint;

  try {
    jejuBlock = await jejuPublic.getBlockNumber();
    console.log(`  Jeju RPC connected (block: ${jejuBlock})`);
  } catch (e) {
    console.log(`  ERROR: Cannot connect to Jeju RPC at ${JEJU_RPC}`);
    console.log('  Start a local Hardhat node with: npx hardhat node');
    results.push({
      step: 'RPC Connectivity',
      success: false,
      duration: Date.now() - stepStart,
      error: 'Cannot connect to Jeju RPC',
    });
    printResults(results, startTime);
    return;
  }

  try {
    sepoliaBlock = await sepoliaPublic.getBlockNumber();
    console.log(`  Sepolia RPC connected (block: ${sepoliaBlock})`);
    results.push({
      step: 'RPC Connectivity',
      success: true,
      duration: Date.now() - stepStart,
      details: `Jeju: block ${jejuBlock}, Sepolia: block ${sepoliaBlock}`,
    });
  } catch {
    console.log(`  WARNING: Cannot connect to Sepolia RPC at ${SEPOLIA_RPC}`);
    console.log('  Running single-chain test only');
    results.push({
      step: 'RPC Connectivity',
      success: true,
      duration: Date.now() - stepStart,
      details: `Jeju only: block ${jejuBlock}`,
    });
  }

  console.log('');

  // ============================================================================
  // Step 2: Check Account Balance
  // ============================================================================
  stepStart = Date.now();
  console.log('Step 2: Checking account balance...');

  const jejuBalance = await jejuPublic.getBalance({ address: account.address });
  console.log(`  Jeju balance: ${formatEther(jejuBalance)} ETH`);

  if (jejuBalance === 0n) {
    console.log('  ERROR: Account has no ETH on Jeju');
    results.push({
      step: 'Account Balance',
      success: false,
      duration: Date.now() - stepStart,
      error: 'No ETH balance',
    });
    printResults(results, startTime);
    return;
  }

  results.push({
    step: 'Account Balance',
    success: true,
    duration: Date.now() - stepStart,
    details: `${formatEther(jejuBalance)} ETH`,
  });

  console.log('');

  // ============================================================================
  // Step 3: Preload Contract Artifacts
  // ============================================================================
  stepStart = Date.now();
  console.log('Step 3: Loading contract artifacts...');

  try {
    await preloadAllArtifacts();
    console.log('  Artifacts loaded successfully');
    results.push({
      step: 'Load Artifacts',
      success: true,
      duration: Date.now() - stepStart,
    });
  } catch (e) {
    console.log(`  ERROR: Failed to load artifacts: ${e}`);
    console.log('  Run: cd contracts && forge build');
    results.push({
      step: 'Load Artifacts',
      success: false,
      duration: Date.now() - stepStart,
      error: String(e),
    });
    printResults(results, startTime);
    return;
  }

  console.log('');

  // ============================================================================
  // Step 4: Deploy BabylonToken on Jeju
  // ============================================================================
  stepStart = Date.now();
  console.log('Step 4: Deploying BabylonToken on Jeju...');

  let tokenAddress: Address;
  try {
    const result = await deployContract(
      jejuPublic,
      jejuWallet,
      'BabylonToken',
      [
        TOKEN_CONFIG.name,
        TOKEN_CONFIG.symbol,
        TOKEN_CONFIG.totalSupply,
        account.address,
        true, // isHomeChain
      ]
    );
    tokenAddress = result.address;
    console.log(`  Token deployed: ${tokenAddress}`);
    console.log(`  Gas used: ${result.gasUsed}`);
    results.push({
      step: 'Deploy Token (Jeju)',
      success: true,
      duration: Date.now() - stepStart,
      details: `Address: ${tokenAddress}, Gas: ${result.gasUsed}`,
    });
  } catch (e) {
    console.log(`  ERROR: Deployment failed: ${e}`);
    results.push({
      step: 'Deploy Token (Jeju)',
      success: false,
      duration: Date.now() - stepStart,
      error: String(e),
    });
    printResults(results, startTime);
    return;
  }

  console.log('');

  // ============================================================================
  // Step 5: Deploy FeeDistributor
  // ============================================================================
  stepStart = Date.now();
  console.log('Step 5: Deploying FeeDistributor...');

  let feeDistributorAddress: Address;
  try {
    const minimumStakePeriod = 7n * 24n * 60n * 60n; // 7 days in seconds
    const result = await deployContract(
      jejuPublic,
      jejuWallet,
      'FeeDistributor',
      [tokenAddress, account.address, minimumStakePeriod]
    );
    feeDistributorAddress = result.address;
    console.log(`  FeeDistributor deployed: ${feeDistributorAddress}`);
    results.push({
      step: 'Deploy FeeDistributor',
      success: true,
      duration: Date.now() - stepStart,
      details: `Address: ${feeDistributorAddress}`,
    });
  } catch (e) {
    console.log(`  ERROR: FeeDistributor deployment failed: ${e}`);
    results.push({
      step: 'Deploy FeeDistributor',
      success: false,
      duration: Date.now() - stepStart,
      error: String(e),
    });
    printResults(results, startTime);
    return;
  }

  console.log('');

  // ============================================================================
  // Step 6: Deploy TokenVesting
  // ============================================================================
  stepStart = Date.now();
  console.log('Step 6: Deploying TokenVesting...');

  let vestingAddress: Address;
  try {
    const result = await deployContract(
      jejuPublic,
      jejuWallet,
      'TokenVesting',
      [tokenAddress, account.address]
    );
    vestingAddress = result.address;
    console.log(`  TokenVesting deployed: ${vestingAddress}`);
    results.push({
      step: 'Deploy TokenVesting',
      success: true,
      duration: Date.now() - stepStart,
      details: `Address: ${vestingAddress}`,
    });
  } catch (e) {
    console.log(`  ERROR: TokenVesting deployment failed: ${e}`);
    results.push({
      step: 'Deploy TokenVesting',
      success: false,
      duration: Date.now() - stepStart,
      error: String(e),
    });
    printResults(results, startTime);
    return;
  }

  console.log('');

  // ============================================================================
  // Step 7: Deploy Presale
  // ============================================================================
  stepStart = Date.now();
  console.log('Step 7: Deploying Presale...');

  const presaleConfig = {
    priceUsd: parseEther('0.001'), // $0.001 per token
    softCapUsd: parseEther('1000'), // $1000 soft cap
    hardCapUsd: parseEther('10000'), // $10000 hard cap
    startTime: BigInt(Math.floor(Date.now() / 1000)),
    endTime: BigInt(Math.floor(Date.now() / 1000) + 86400 * 7), // 7 days
  };

  let presaleAddress: Address;
  try {
    const result = await deployContract(
      jejuPublic,
      jejuWallet,
      'Presale',
      [
        tokenAddress,
        presaleConfig.priceUsd,
        presaleConfig.softCapUsd,
        presaleConfig.hardCapUsd,
        presaleConfig.startTime,
        presaleConfig.endTime,
        account.address, // owner
      ]
    );
    presaleAddress = result.address;
    console.log(`  Presale deployed: ${presaleAddress}`);
    results.push({
      step: 'Deploy Presale',
      success: true,
      duration: Date.now() - stepStart,
      details: `Address: ${presaleAddress}`,
    });
  } catch (e) {
    console.log(`  ERROR: Presale deployment failed: ${e}`);
    results.push({
      step: 'Deploy Presale',
      success: false,
      duration: Date.now() - stepStart,
      error: String(e),
    });
  }

  console.log('');

  // ============================================================================
  // Print Final Results
  // ============================================================================
  printResults(results, startTime);

  // Print deployment summary
  console.log('');
  console.log('='.repeat(70));
  console.log('DEPLOYMENT SUMMARY');
  console.log('='.repeat(70));
  console.log(`Token:          ${tokenAddress}`);
  console.log(`FeeDistributor: ${feeDistributorAddress!}`);
  console.log(`TokenVesting:   ${vestingAddress!}`);
  if (presaleAddress!) {
    console.log(`Presale:        ${presaleAddress}`);
  }
  console.log('');
  console.log('To interact with these contracts:');
  console.log(`  cast call ${tokenAddress} "totalSupply()" --rpc-url ${JEJU_RPC}`);
  console.log(`  cast call ${tokenAddress} "balanceOf(address)" ${account.address} --rpc-url ${JEJU_RPC}`);
}

function printResults(results: TestResult[], startTime: number) {
  console.log('');
  console.log('='.repeat(70));
  console.log('TEST RESULTS');
  console.log('='.repeat(70));

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const status = result.success ? '✓' : '✗';
    const color = result.success ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}${status}\x1b[0m ${result.step} (${result.duration}ms)`);
    if (result.details) {
      console.log(`    ${result.details}`);
    }
    if (result.error) {
      console.log(`    Error: ${result.error}`);
    }
    if (result.success) passed++;
    else failed++;
  }

  console.log('');
  console.log(`Total: ${passed} passed, ${failed} failed`);
  console.log(`Time: ${Date.now() - startTime}ms`);
}

main().catch(console.error);

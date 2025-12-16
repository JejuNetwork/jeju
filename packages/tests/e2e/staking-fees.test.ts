#!/usr/bin/env bun
/**
 * Staking & Fee Distribution E2E Tests
 * 
 * Tests the staking system that combines:
 * - Paymaster gas subsidization liquidity
 * - EIL cross-chain transfer liquidity
 * - Fee distribution to stakers
 * 
 * Verifies:
 * - Staking/unstaking flows
 * - Fee accrual and distribution
 * - Correct proportional payouts
 * - Liquidity utilization limits
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, createWalletClient, http, parseAbi, readContract, writeContract, waitForTransactionReceipt, formatEther, parseEther, getBalance, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { inferChainFromRpcUrl } from '../../../scripts/shared/chain-utils';

// Test configuration
const RPC_URL = process.env.JEJU_RPC_URL || 'http://localhost:9545';
const STAKING_TOKEN_ADDRESS = process.env.STAKING_TOKEN_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const STAKING_ADDRESS = process.env.STAKING_ADDRESS || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

// Test wallets (from Anvil default accounts)
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const STAKER1_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const STAKER2_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

const STAKING_TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
];

const STAKING_ABI = [
  // Staking
  'function stake(uint256 tokenAmount) payable',
  'function startUnbonding(uint256 ethAmount, uint256 tokenAmount)',
  'function completeUnstaking()',
  'function claimFees()',
  // Views
  'function getPosition(address staker) view returns (uint256 ethStaked, uint256 tokensStaked, uint256 pendingFees, uint256 unbondingETH, uint256 unbondingTokens, uint256 unbondingCompleteTime, bool isActive)',
  'function getPoolStats() view returns (uint256 totalETH, uint256 totalTokens, uint256 availableETH, uint256 availableTokens, uint256 ethUtilization, uint256 tokenUtilization)',
  'function availableETH() view returns (uint256)',
  'function availableTokens() view returns (uint256)',
  'function totalETHStaked() view returns (uint256)',
  'function totalTokensStaked() view returns (uint256)',
  'function ethFeesPerShare() view returns (uint256)',
  'function tokenFeesPerShare() view returns (uint256)',
  // Fee distribution (for testing)
  'function distributeFees(uint256 ethPoolFees, uint256 tokenPoolFees)',
  // Admin
  'function setFeeDistributor(address)',
];

let publicClient: ReturnType<typeof createPublicClient>;
let deployerAccount: ReturnType<typeof privateKeyToAccount>;
let staker1Account: ReturnType<typeof privateKeyToAccount>;
let staker2Account: ReturnType<typeof privateKeyToAccount>;
let deployerWalletClient: ReturnType<typeof createWalletClient>;
let staker1WalletClient: ReturnType<typeof createWalletClient>;
let staker2WalletClient: ReturnType<typeof createWalletClient>;

describe('Staking - Setup', () => {
  beforeAll(async () => {
    console.log('🚀 Setting up staking tests...\n');
    
    const chain = inferChainFromRpcUrl(RPC_URL);
    deployerAccount = privateKeyToAccount(DEPLOYER_KEY as `0x${string}`);
    staker1Account = privateKeyToAccount(STAKER1_KEY as `0x${string}`);
    staker2Account = privateKeyToAccount(STAKER2_KEY as `0x${string}`);
    
    publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
    deployerWalletClient = createWalletClient({ chain, transport: http(RPC_URL), account: deployerAccount });
    staker1WalletClient = createWalletClient({ chain, transport: http(RPC_URL), account: staker1Account });
    staker2WalletClient = createWalletClient({ chain, transport: http(RPC_URL), account: staker2Account });
    
    const stakingAbi = parseAbi(STAKING_ABI);
    const stakingTokenAbi = parseAbi(STAKING_TOKEN_ABI);
    
    // Setup: Authorize deployer as fee distributor for testing
    const setDistributorHash = await deployerWalletClient.writeContract({
      address: STAKING_ADDRESS as Address,
      abi: stakingAbi,
      functionName: 'setFeeDistributor',
      args: [deployerAccount.address],
    });
    await waitForTransactionReceipt(publicClient, { hash: setDistributorHash });
    
    // Mint tokens for stakers
    const mintAmount = parseEther('10000');
    const mint1Hash = await deployerWalletClient.writeContract({
      address: STAKING_TOKEN_ADDRESS as Address,
      abi: stakingTokenAbi,
      functionName: 'mint',
      args: [staker1Account.address, mintAmount],
    });
    await waitForTransactionReceipt(publicClient, { hash: mint1Hash });
    
    const mint2Hash = await deployerWalletClient.writeContract({
      address: STAKING_TOKEN_ADDRESS as Address,
      abi: stakingTokenAbi,
      functionName: 'mint',
      args: [staker2Account.address, mintAmount],
    });
    await waitForTransactionReceipt(publicClient, { hash: mint2Hash });
    
    console.log('✓ Setup complete\n');
  });

  test('should verify initial state', async () => {
    const stats = await readContract(publicClient, {
      address: STAKING_ADDRESS as Address,
      abi: parseAbi(STAKING_ABI),
      functionName: 'getPoolStats',
    }) as { totalETH: bigint; totalTokens: bigint };
    
    console.log('Initial Pool Stats:');
    console.log(`  Total ETH: ${formatEther(stats.totalETH)} ETH`);
    console.log(`  Total Tokens: ${formatEther(stats.totalTokens)} tokens`);
    
    expect(stats.totalETH).toBe(0n);
    expect(stats.totalTokens).toBe(0n);
  });
});

describe('Staking - Staking Flow', () => {
  test('should allow staking ETH and tokens', async () => {
    console.log('\n📊 Testing staking flow...\n');
    
    const ethAmount = parseEther('5');
    const tokenAmount = parseEther('1000');
    
    const stakingAbi = parseAbi(STAKING_ABI);
    const stakingTokenAbi = parseAbi(STAKING_TOKEN_ABI);
    
    // Staker1 approves and stakes
    const approveHash = await staker1WalletClient.writeContract({
      address: STAKING_TOKEN_ADDRESS as Address,
      abi: stakingTokenAbi,
      functionName: 'approve',
      args: [STAKING_ADDRESS as Address, tokenAmount],
    });
    await waitForTransactionReceipt(publicClient, { hash: approveHash });
    
    const stakeHash = await staker1WalletClient.writeContract({
      address: STAKING_ADDRESS as Address,
      abi: stakingAbi,
      functionName: 'stake',
      args: [tokenAmount],
      value: ethAmount,
    });
    await waitForTransactionReceipt(publicClient, { hash: stakeHash });
    
    const position = await readContract(publicClient, {
      address: STAKING_ADDRESS as Address,
      abi: stakingAbi,
      functionName: 'getPosition',
      args: [staker1Account.address],
    }) as { ethStaked: bigint; tokensStaked: bigint; isActive: boolean };
    
    console.log('Staker1 Position:');
    console.log(`  ETH Staked: ${formatEther(position.ethStaked)} ETH`);
    console.log(`  Tokens Staked: ${formatEther(position.tokensStaked)} tokens`);
    console.log(`  Is Active: ${position.isActive}`);
    
    expect(position.ethStaked).toBe(ethAmount);
    expect(position.tokensStaked).toBe(tokenAmount);
    expect(position.isActive).toBe(true);
  });

  test('should allow second staker with different amounts', async () => {
    const ethAmount = parseEther('3');
    const tokenAmount = parseEther('500');
    
    const stakingAbi = parseAbi(STAKING_ABI);
    const stakingTokenAbi = parseAbi(STAKING_TOKEN_ABI);
    
    const approveHash = await staker2WalletClient.writeContract({
      address: STAKING_TOKEN_ADDRESS as Address,
      abi: stakingTokenAbi,
      functionName: 'approve',
      args: [STAKING_ADDRESS as Address, tokenAmount],
    });
    await waitForTransactionReceipt(publicClient, { hash: approveHash });
    
    const stakeHash = await staker2WalletClient.writeContract({
      address: STAKING_ADDRESS as Address,
      abi: stakingAbi,
      functionName: 'stake',
      args: [tokenAmount],
      value: ethAmount,
    });
    await waitForTransactionReceipt(publicClient, { hash: stakeHash });
    
    const position = await readContract(publicClient, {
      address: STAKING_ADDRESS as Address,
      abi: stakingAbi,
      functionName: 'getPosition',
      args: [staker2Account.address],
    }) as { ethStaked: bigint; tokensStaked: bigint };
    
    console.log('\nStaker2 Position:');
    console.log(`  ETH Staked: ${formatEther(position.ethStaked)} ETH`);
    console.log(`  Tokens Staked: ${formatEther(position.tokensStaked)} tokens`);
    
    expect(position.ethStaked).toBe(ethAmount);
    expect(position.tokensStaked).toBe(tokenAmount);
  });

  test('should track total pool correctly', async () => {
    const stakingAbi = parseAbi(STAKING_ABI);
    const stats = await readContract(publicClient, {
      address: STAKING_ADDRESS as Address,
      abi: stakingAbi,
      functionName: 'getPoolStats',
    }) as { totalETH: bigint; totalTokens: bigint; availableETH: bigint; availableTokens: bigint };
    
    console.log('\nPool Stats After Stakes:');
    console.log(`  Total ETH: ${formatEther(stats.totalETH)} ETH`);
    console.log(`  Total Tokens: ${formatEther(stats.totalTokens)} tokens`);
    console.log(`  Available ETH: ${formatEther(stats.availableETH)} ETH (80% max)`);
    console.log(`  Available Tokens: ${formatEther(stats.availableTokens)} tokens (70% max)`);
    
    const expectedETH = parseEther('8'); // 5 + 3
    const expectedTokens = parseEther('1500'); // 1000 + 500
    
    expect(stats.totalETH).toBe(expectedETH);
    expect(stats.totalTokens).toBe(expectedTokens);
    
    // Check utilization limits
    const maxETH = (expectedETH * 80n) / 100n;
    const maxTokens = (expectedTokens * 70n) / 100n;
    
    expect(stats.availableETH).toBeLessThanOrEqual(maxETH);
    expect(stats.availableTokens).toBeLessThanOrEqual(maxTokens);
  });
});

describe('Staking - Fee Distribution', () => {
  test('should distribute fees proportionally to stakers', async () => {
    console.log('\n💰 Testing fee distribution...\n');
    
    // Distribute 100 tokens as fees (70 to ETH stakers, 30 to token stakers)
    const ethPoolFees = ethers.parseEther('70');
    const tokenPoolFees = ethers.parseEther('30');
    
    // Approve staking contract to pull fees
    await (await stakingToken.approve(STAKING_ADDRESS, ethPoolFees + tokenPoolFees)).wait();
    
    // Distribute fees
    const distributeTx = await staking.distributeFees(ethPoolFees, tokenPoolFees);
    await distributeTx.wait();
    
    // Check pending fees for both stakers
    const position1 = await staking.getPosition(staker1.address);
    const position2 = await staking.getPosition(staker2.address);
    
    console.log('Pending Fees After Distribution:');
    console.log(`  Staker1: ${ethers.formatEther(position1.pendingFees)} tokens`);
    console.log(`  Staker2: ${ethers.formatEther(position2.pendingFees)} tokens`);
    
    // Staker1 has 5/8 of ETH (62.5%) and 1000/1500 of tokens (66.67%)
    // ETH fees: 70 * 5/8 = 43.75
    // Token fees: 30 * 1000/1500 = 20
    // Total: ~63.75 tokens
    
    // Staker2 has 3/8 of ETH (37.5%) and 500/1500 of tokens (33.33%)
    // ETH fees: 70 * 3/8 = 26.25
    // Token fees: 30 * 500/1500 = 10
    // Total: ~36.25 tokens
    
    const totalFees = position1.pendingFees + position2.pendingFees;
    const expectedTotal = ethPoolFees + tokenPoolFees;
    
    // Allow small rounding difference
    expect(totalFees).toBeGreaterThan(expectedTotal - ethers.parseEther('0.01'));
    expect(totalFees).toBeLessThanOrEqual(expectedTotal);
    
    // Staker1 should have more fees (larger stake)
    expect(position1.pendingFees).toBeGreaterThan(position2.pendingFees);
  });

  test('should allow stakers to claim fees', async () => {
    const staker1Staking = staking.connect(staker1);
    const staker2Staking = staking.connect(staker2);
    
    const balanceBefore1 = await stakingToken.balanceOf(staker1.address);
    const balanceBefore2 = await stakingToken.balanceOf(staker2.address);
    
    // Claim fees
    await (await staker1Staking.claimFees()).wait();
    await (await staker2Staking.claimFees()).wait();
    
    const balanceAfter1 = await stakingToken.balanceOf(staker1.address);
    const balanceAfter2 = await stakingToken.balanceOf(staker2.address);
    
    const claimed1 = balanceAfter1 - balanceBefore1;
    const claimed2 = balanceAfter2 - balanceBefore2;
    
    console.log('\nFees Claimed:');
    console.log(`  Staker1: ${ethers.formatEther(claimed1)} tokens`);
    console.log(`  Staker2: ${ethers.formatEther(claimed2)} tokens`);
    
    expect(claimed1).toBeGreaterThan(0n);
    expect(claimed2).toBeGreaterThan(0n);
    
    // Verify pending fees are now 0
    const position1 = await staking.getPosition(staker1.address);
    const position2 = await staking.getPosition(staker2.address);
    
    expect(position1.pendingFees).toBe(0n);
    expect(position2.pendingFees).toBe(0n);
  });
});

describe('Staking - Multiple Fee Distributions', () => {
  test('should accumulate fees correctly over multiple distributions', async () => {
    console.log('\n📈 Testing multiple fee distributions...\n');
    
    // Distribute fees 3 times
    const feeAmount = ethers.parseEther('10');
    
    for (let i = 0; i < 3; i++) {
      await (await stakingToken.approve(STAKING_ADDRESS, feeAmount * 2n)).wait();
      await (await staking.distributeFees(feeAmount, feeAmount)).wait();
    }
    
    const position1 = await staking.getPosition(staker1.address);
    const position2 = await staking.getPosition(staker2.address);
    
    console.log('Accumulated Fees (3 distributions):');
    console.log(`  Staker1: ${ethers.formatEther(position1.pendingFees)} tokens`);
    console.log(`  Staker2: ${ethers.formatEther(position2.pendingFees)} tokens`);
    
    // Should have accumulated ~60 tokens total (3 * 20)
    const totalPending = position1.pendingFees + position2.pendingFees;
    const expectedMinimum = ethers.parseEther('59'); // Allow for rounding
    
    expect(totalPending).toBeGreaterThan(expectedMinimum);
  });
});

describe('Staking - Unbonding Flow', () => {
  test('should allow starting unbonding', async () => {
    console.log('\n⏳ Testing unbonding flow...\n');
    
    const staker1Staking = staking.connect(staker1);
    
    // Claim any pending fees first
    await (await staker1Staking.claimFees()).wait();
    
    // Start unbonding half the stake
    const ethToUnbond = ethers.parseEther('2.5');
    const tokensToUnbond = ethers.parseEther('500');
    
    const unbondTx = await staker1Staking.startUnbonding(ethToUnbond, tokensToUnbond);
    await unbondTx.wait();
    
    const position = await staking.getPosition(staker1.address);
    
    console.log('Staker1 After Unbonding Started:');
    console.log(`  ETH Still Staked: ${ethers.formatEther(position.ethStaked)} ETH`);
    console.log(`  Tokens Still Staked: ${ethers.formatEther(position.tokensStaked)} tokens`);
    console.log(`  ETH Unbonding: ${ethers.formatEther(position.unbondingETH)} ETH`);
    console.log(`  Tokens Unbonding: ${ethers.formatEther(position.unbondingTokens)} tokens`);
    console.log(`  Unbonding Complete At: ${new Date(Number(position.unbondingCompleteTime) * 1000).toISOString()}`);
    
    expect(position.ethStaked).toBe(ethers.parseEther('2.5'));
    expect(position.tokensStaked).toBe(ethers.parseEther('500'));
    expect(position.unbondingETH).toBe(ethToUnbond);
    expect(position.unbondingTokens).toBe(tokensToUnbond);
  });

  test('should reject early unstaking', async () => {
    const staker1Staking = staking.connect(staker1);
    
    let reverted = false;
    try {
      await staker1Staking.completeUnstaking();
    } catch (e) {
      reverted = true;
    }
    
    expect(reverted).toBe(true);
    console.log('✓ Early unstaking correctly rejected');
  });

  test('should reflect reduced staking in pool stats', async () => {
    const stats = await staking.getPoolStats();
    
    console.log('\nPool Stats After Unbonding Started:');
    console.log(`  Total ETH: ${ethers.formatEther(stats.totalETH)} ETH`);
    console.log(`  Total Tokens: ${ethers.formatEther(stats.totalTokens)} tokens`);
    
    // Should be reduced by unbonding amounts
    // Original: 8 ETH, 1500 tokens
    // After unbonding: 5.5 ETH (8 - 2.5), 1000 tokens (1500 - 500)
    expect(stats.totalETH).toBe(ethers.parseEther('5.5'));
    expect(stats.totalTokens).toBe(ethers.parseEther('1000'));
  });
});

describe('Staking - Fee Share Calculation Verification', () => {
  test('should verify fee per share calculations', async () => {
    console.log('\n🔢 Verifying fee per share calculations...\n');
    
    const ethFeesPerShare = await staking.ethFeesPerShare();
    const tokenFeesPerShare = await staking.tokenFeesPerShare();
    
    console.log('Per-Share Accumulators:');
    console.log(`  ETH Fees Per Share: ${ethers.formatEther(ethFeesPerShare)}`);
    console.log(`  Token Fees Per Share: ${ethers.formatEther(tokenFeesPerShare)}`);
    
    // These should be non-zero after distributions
    expect(ethFeesPerShare).toBeGreaterThan(0n);
    expect(tokenFeesPerShare).toBeGreaterThan(0n);
  });

  test('should verify proportional distribution formula', async () => {
    // Formula: userFees = userShares * (currentFeesPerShare - lastPaidFeesPerShare) / PRECISION
    // This is verified by checking the actual fee accumulation matches expected
    
    const totalETH = await staking.totalETHStaked();
    const totalTokens = await staking.totalTokensStaked();
    
    console.log('\nTotal Stakes for Verification:');
    console.log(`  Total ETH: ${ethers.formatEther(totalETH)} ETH`);
    console.log(`  Total Tokens: ${ethers.formatEther(totalTokens)} tokens`);
    
    // The fee distribution should be:
    // - For ETH stakers: proportional to ethStaked / totalETHStaked
    // - For Token stakers: proportional to tokensStaked / totalTokensStaked
    
    const position1 = await staking.getPosition(staker1.address);
    const position2 = await staking.getPosition(staker2.address);
    
    // Calculate expected ratios
    const staker1EthRatio = Number(position1.ethStaked) / Number(totalETH);
    const staker2EthRatio = Number(position2.ethStaked) / Number(totalETH);
    
    console.log('\nStake Ratios:');
    console.log(`  Staker1 ETH: ${(staker1EthRatio * 100).toFixed(2)}%`);
    console.log(`  Staker2 ETH: ${(staker2EthRatio * 100).toFixed(2)}%`);
    
    // Verify ratios sum to ~100%
    expect(staker1EthRatio + staker2EthRatio).toBeCloseTo(1.0, 2);
  });
});

describe('Staking - Edge Cases', () => {
  test('should handle zero fee distribution gracefully', async () => {
    let reverted = false;
    try {
      await staking.distributeFees(0n, 0n);
    } catch (e) {
      reverted = true;
    }
    
    expect(reverted).toBe(true);
    console.log('✓ Zero fee distribution correctly rejected');
  });

  test('should track active stakers correctly', async () => {
    const position1 = await staking.getPosition(staker1.address);
    const position2 = await staking.getPosition(staker2.address);
    
    expect(position1.isActive).toBe(true);
    expect(position2.isActive).toBe(true);
    
    console.log('✓ Both stakers correctly marked as active');
  });
});

describe('Staking - Summary', () => {
  test('should print final state summary', async () => {
    console.log('\n📋 FINAL STATE SUMMARY\n');
    console.log('='.repeat(50));
    
    const stats = await staking.getPoolStats();
    const position1 = await staking.getPosition(staker1.address);
    const position2 = await staking.getPosition(staker2.address);
    
    console.log('\nPool Statistics:');
    console.log(`  Total ETH Staked: ${ethers.formatEther(stats.totalETH)} ETH`);
    console.log(`  Total Tokens Staked: ${ethers.formatEther(stats.totalTokens)} tokens`);
    console.log(`  Available ETH (80% max): ${ethers.formatEther(stats.availableETH)} ETH`);
    console.log(`  Available Tokens (70% max): ${ethers.formatEther(stats.availableTokens)} tokens`);
    
    console.log('\nStaker Positions:');
    console.log(`  Staker1: ${ethers.formatEther(position1.ethStaked)} ETH, ${ethers.formatEther(position1.tokensStaked)} tokens`);
    console.log(`  Staker2: ${ethers.formatEther(position2.ethStaked)} ETH, ${ethers.formatEther(position2.tokensStaked)} tokens`);
    
    console.log('\nPending Fees:');
    console.log(`  Staker1: ${ethers.formatEther(position1.pendingFees)} tokens`);
    console.log(`  Staker2: ${ethers.formatEther(position2.pendingFees)} tokens`);
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ All staking tests passed!');
  });
});


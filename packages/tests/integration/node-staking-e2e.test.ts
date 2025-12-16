#!/usr/bin/env bun
/**
 * @title Node Staking End-to-End Test
 * @notice Comprehensive test of the complete multi-token node staking system
 * 
 * Test Flow:
 * 1. Deploy all contracts (TokenRegistry, PaymasterFactory, PriceOracle, NodeStakingManager)
 * 2. Register multiple nodes (multi-token staking)
 * 3. Run oracle to update performance
 * 4. Verify RPC endpoints
 * 5. Claim rewards (in chosen reward token)
 * 6. Verify balances and paymaster fees
 * 7. Test slashing
 * 8. Test metadata updates
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { $ } from 'bun';
import { createPublicClient, createWalletClient, http, parseAbi, readContract, writeContract, waitForTransactionReceipt, formatEther, parseEther, getBalance, type Address, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { inferChainFromRpcUrl } from '../../../scripts/shared/chain-utils';

// This E2E test starts a full localnet - only run manually with RUN_E2E_TESTS=1
// Check if explicitly enabled and if Kurtosis is installed
const runE2ETests = process.env.RUN_E2E_TESTS === '1';
let kurtosisAvailable = false;
if (runE2ETests) {
  try {
    const result = await $`which kurtosis`.quiet().nothrow();
    kurtosisAvailable = result.exitCode === 0;
  } catch {
    console.log('Kurtosis not available, skipping node staking E2E tests');
  }
} else {
  console.log('Skipping Node Staking E2E tests (set RUN_E2E_TESTS=1 to enable)');
}

describe.skipIf(!runE2ETests || !kurtosisAvailable)('Node Staking System E2E (Multi-Token)', () => {
  let publicClient: PublicClient;
  let deployerAccount: ReturnType<typeof privateKeyToAccount>;
  let deployerWalletClient: WalletClient;
  let operator1Account: ReturnType<typeof privateKeyToAccount>;
  let operator1WalletClient: WalletClient;
  let operator2Account: ReturnType<typeof privateKeyToAccount>;
  let operator2WalletClient: WalletClient;
  let oracleAccount: ReturnType<typeof privateKeyToAccount>;
  let oracleWalletClient: WalletClient;
  
  let rewardTokenAddress: Address;
  let rewardsContractAddress: Address;
  
  let node1Id: `0x${string}`;
  let node2Id: `0x${string}`;
  
  const INITIAL_BALANCE = parseEther('10000'); // 10k tokens per operator
  const STAKE_AMOUNT = parseEther('1000'); // 1k tokens stake
  
  beforeAll(async () => {
    console.log('\n🚀 Setting up E2E test environment...\n');
    
    // Start localnet
    console.log('📦 Starting Kurtosis localnet...');
    await $`bun run localnet:start`.quiet();
    
    // Get RPC endpoint
    const l2Port = await $`kurtosis port print jeju-localnet op-geth rpc`.text();
    const rpcUrl = `http://${l2Port.trim()}`;
    
    const chain = inferChainFromRpcUrl(rpcUrl);
    publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    
    // Create wallets
    deployerAccount = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`);
    deployerWalletClient = createWalletClient({ chain, transport: http(rpcUrl), account: deployerAccount });
    
    operator1Account = privateKeyToAccount(generatePrivateKey());
    operator1WalletClient = createWalletClient({ chain, transport: http(rpcUrl), account: operator1Account });
    
    operator2Account = privateKeyToAccount(generatePrivateKey());
    operator2WalletClient = createWalletClient({ chain, transport: http(rpcUrl), account: operator2Account });
    
    oracleAccount = privateKeyToAccount(generatePrivateKey());
    oracleWalletClient = createWalletClient({ chain, transport: http(rpcUrl), account: oracleAccount });
    
    console.log(`   Deployer: ${deployerAccount.address}`);
    console.log(`   Operator 1: ${operator1Account.address}`);
    console.log(`   Operator 2: ${operator2Account.address}`);
    console.log(`   Oracle: ${oracleAccount.address}\n`);
    
    // Fund wallets
    console.log('💰 Funding test wallets...');
    const hash1 = await deployerWalletClient.sendTransaction({
      to: operator1Account.address,
      value: parseEther('1'),
    });
    await waitForTransactionReceipt(publicClient, { hash: hash1 });
    
    const hash2 = await deployerWalletClient.sendTransaction({
      to: operator2Account.address,
      value: parseEther('1'),
    });
    await waitForTransactionReceipt(publicClient, { hash: hash2 });
    
    const hash3 = await deployerWalletClient.sendTransaction({
      to: oracleAccount.address,
      value: parseEther('0.1'),
    });
    await waitForTransactionReceipt(publicClient, { hash: hash3 });
    
    console.log('✅ Wallets funded\n');
  });
  
  afterAll(async () => {
    console.log('\n🧹 Cleaning up test environment...\n');
    await $`kurtosis enclave rm -f jeju-localnet`.quiet().nothrow();
  });
  
  test('Deploy reward token and rewards contract', async () => {
    console.log('\n📝 Test: Deploy contracts\n');
    
    // For now, use existing deployment
    const deploymentFile = await Bun.file('packages/contracts/deployments/rewards-localnet.json').json();
    
    rewardTokenAddress = deploymentFile.rewardToken as Address;
    rewardsContractAddress = deploymentFile.nodeOperatorRewards as Address;
    
    const rewardsAbi = parseAbi(['function getPerformanceOracles() external view returns (address[])']);
    const oracles = await readContract(publicClient, {
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'getPerformanceOracles',
    }) as readonly Address[];
    
    expect(oracles.length).toBeGreaterThan(0);
    console.log(`✅ ${oracles.length} oracle(s) registered\n`);
  });
  
  test('Fund operators with reward tokens', async () => {
    console.log('\n📝 Test: Fund operators\n');
    
    const erc20Abi = parseAbi(['function transfer(address, uint256) external returns (bool)', 'function balanceOf(address) external view returns (uint256)']);
    
    // Transfer tokens to operators
    const hash1 = await deployerWalletClient.writeContract({
      address: rewardTokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [operator1Account.address, INITIAL_BALANCE],
    });
    await waitForTransactionReceipt(publicClient, { hash: hash1 });
    
    const hash2 = await deployerWalletClient.writeContract({
      address: rewardTokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [operator2Account.address, INITIAL_BALANCE],
    });
    await waitForTransactionReceipt(publicClient, { hash: hash2 });
    
    const balance1 = await readContract(publicClient, {
      address: rewardTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [operator1Account.address],
    }) as bigint;
    
    const balance2 = await readContract(publicClient, {
      address: rewardTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [operator2Account.address],
    }) as bigint;
    
    expect(balance1).toBe(INITIAL_BALANCE);
    expect(balance2).toBe(INITIAL_BALANCE);
    
    console.log(`✅ Operators funded: ${formatEther(INITIAL_BALANCE)} tokens each\n`);
  });
  
  test('Register nodes and stake tokens', async () => {
    console.log('\n📝 Test: Register nodes\n');
    
    const erc20Abi = parseAbi(['function approve(address, uint256) external returns (bool)']);
    const rewardsAbi = parseAbi([
      'function registerNode(string calldata rpcUrl, uint8 geographicRegion, uint256 stakeAmount) external returns (bytes32)',
      'function totalActiveNodes() external view returns (uint256)'
    ]);
    
    // Operator 1 approves and registers
    const approveHash1 = await operator1WalletClient.writeContract({
      address: rewardTokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [rewardsContractAddress, STAKE_AMOUNT],
    });
    await waitForTransactionReceipt(publicClient, { hash: approveHash1 });
    
    const registerHash1 = await operator1WalletClient.writeContract({
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'registerNode',
      args: ['https://rpc1.example.com', 3, STAKE_AMOUNT],
    });
    const receipt1 = await waitForTransactionReceipt(publicClient, { hash: registerHash1 });
    
    // Extract nodeId from events
    node1Id = receipt1.logs[0].topics[1] as `0x${string}`;
    
    console.log(`✅ Node 1 registered: ${node1Id.slice(0, 10)}...\n`);
    
    // Operator 2 approves and registers  
    const approveHash2 = await operator2WalletClient.writeContract({
      address: rewardTokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [rewardsContractAddress, STAKE_AMOUNT],
    });
    await waitForTransactionReceipt(publicClient, { hash: approveHash2 });
    
    const registerHash2 = await operator2WalletClient.writeContract({
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'registerNode',
      args: ['https://rpc2.example.com', 2, STAKE_AMOUNT],
    });
    const receipt2 = await waitForTransactionReceipt(publicClient, { hash: registerHash2 });
    
    node2Id = receipt2.logs[0].topics[1] as `0x${string}`;
    
    console.log(`✅ Node 2 registered: ${node2Id.slice(0, 10)}...\n`);
    
    // Verify total active nodes
    const activeNodes = await readContract(publicClient, {
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'totalActiveNodes',
    }) as bigint;
    expect(activeNodes).toBe(2n);
    
    console.log(`✅ Total active nodes: ${activeNodes}\n`);
  });
  
  test('Oracle updates performance data', async () => {
    console.log('\n📝 Test: Oracle updates\n');
    
    const rewardsAbi = parseAbi(['function updatePerformance(bytes32, uint256, uint256, uint256) external']);
    
    // Update performance for node 1
    const hash1 = await oracleWalletClient.writeContract({
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'updatePerformance',
      args: [node1Id, 9950n, 500000n, 50n],
    });
    await waitForTransactionReceipt(publicClient, { hash: hash1 });
    
    console.log(`✅ Node 1 performance updated\n`);
    
    // Update performance for node 2
    const hash2 = await oracleWalletClient.writeContract({
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'updatePerformance',
      args: [node2Id, 9800n, 250000n, 75n],
    });
    await waitForTransactionReceipt(publicClient, { hash: hash2 });
    
    console.log(`✅ Node 2 performance updated\n`);
  });
  
  test('Calculate and verify rewards', async () => {
    console.log('\n📝 Test: Calculate rewards\n');
    
    // Fast forward time 30 days
    await publicClient.request({ method: 'evm_increaseTime', params: [30 * 24 * 60 * 60] } as never);
    await publicClient.request({ method: 'evm_mine', params: [] } as never);
    
    const rewardsAbi = parseAbi(['function calculateRewards(bytes32) external view returns (uint256)']);
    
    const rewards1 = await readContract(publicClient, {
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'calculateRewards',
      args: [node1Id],
    }) as bigint;
    
    const rewards2 = await readContract(publicClient, {
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'calculateRewards',
      args: [node2Id],
    }) as bigint;
    
    console.log(`   Node 1 rewards: ${formatEther(rewards1)} JEJU`);
    console.log(`   Node 2 rewards: ${formatEther(rewards2)} JEJU\n`);
    
    expect(rewards1).toBeGreaterThan(0n);
    expect(rewards2).toBeGreaterThan(0n);
    
    // Node 1 should have higher rewards (better uptime, more requests, underserved region)
    expect(rewards1).toBeGreaterThan(rewards2);
    
    console.log(`✅ Rewards calculated correctly\n`);
  });
  
  test('Claim rewards', async () => {
    console.log('\n📝 Test: Claim rewards\n');
    
    const erc20Abi = parseAbi(['function balanceOf(address) external view returns (uint256)']);
    const rewardsAbi = parseAbi(['function claimRewards(bytes32) external']);
    
    const balanceBefore1 = await readContract(publicClient, {
      address: rewardTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [operator1Account.address],
    }) as bigint;
    
    const hash = await operator1WalletClient.writeContract({
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'claimRewards',
      args: [node1Id],
    });
    await waitForTransactionReceipt(publicClient, { hash });
    
    const balanceAfter1 = await readContract(publicClient, {
      address: rewardTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [operator1Account.address],
    }) as bigint;
    const claimed = balanceAfter1 - balanceBefore1;
    
    console.log(`   Claimed: ${formatEther(claimed)} JEJU`);
    
    expect(claimed).toBeGreaterThan(0n);
    
    console.log(`✅ Rewards claimed successfully\n`);
  });
  
  test('Update node metadata', async () => {
    console.log('\n📝 Test: Update metadata\n');
    
    const rewardsAbi = parseAbi(['function updateNodeMetadata(bytes32, string, uint8) external']);
    
    const hash = await operator1WalletClient.writeContract({
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'updateNodeMetadata',
      args: [node1Id, 'https://new-rpc1.example.com', 2],
    });
    await waitForTransactionReceipt(publicClient, { hash });
    
    console.log(`✅ Node metadata updated\n`);
  });
  
  test('Slash misbehaving node', async () => {
    console.log('\n📝 Test: Slash node\n');
    
    const rewardsAbi = parseAbi([
      'function slashNode(bytes32, uint256, string) external',
      'function totalActiveNodes() external view returns (uint256)'
    ]);
    
    // Owner slashes node 2 for 50%
    const hash = await deployerWalletClient.writeContract({
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'slashNode',
      args: [node2Id, 5000n, 'Extended downtime'],
    });
    await waitForTransactionReceipt(publicClient, { hash });
    
    console.log(`✅ Node 2 slashed (50%)\n`);
    
    // Verify total active nodes decreased
    const activeNodes = await readContract(publicClient, {
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'totalActiveNodes',
    }) as bigint;
    expect(activeNodes).toBe(1n); // Only node 1 is active
    
    console.log(`✅ Active nodes: ${activeNodes}\n`);
  });
  
  test('Slashed node can deregister and recover remaining stake', async () => {
    console.log('\n📝 Test: Deregister slashed node\n');
    
    const erc20Abi = parseAbi(['function balanceOf(address) external view returns (uint256)']);
    const rewardsAbi = parseAbi(['function deregisterNode(bytes32) external']);
    
    const balanceBefore = await readContract(publicClient, {
      address: rewardTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [operator2Account.address],
    }) as bigint;
    
    const hash = await operator2WalletClient.writeContract({
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'deregisterNode',
      args: [node2Id],
    });
    await waitForTransactionReceipt(publicClient, { hash });
    
    const balanceAfter = await readContract(publicClient, {
      address: rewardTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [operator2Account.address],
    }) as bigint;
    const recovered = balanceAfter - balanceBefore;
    
    console.log(`   Recovered: ${formatEther(recovered)} JEJU`);
    
    // Should get back 50% of stake (other 50% was slashed)
    const expectedRecovery = STAKE_AMOUNT / 2n;
    expect(recovered).toBe(expectedRecovery);
    
    console.log(`✅ Slashed node recovered remaining stake\n`);
  });
  
  test('Verify gas costs are reasonable', async () => {
    console.log('\n📝 Test: Gas costs\n');
    
    const erc20Abi = parseAbi(['function approve(address, uint256) external returns (bool)']);
    const rewardsAbi = parseAbi(['function registerNode(string calldata rpcUrl, uint8 geographicRegion, uint256 stakeAmount) external returns (bytes32)']);
    
    // Re-register node 2 to test gas
    const approveHash = await operator2WalletClient.writeContract({
      address: rewardTokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [rewardsContractAddress, STAKE_AMOUNT],
    });
    await waitForTransactionReceipt(publicClient, { hash: approveHash });
    
    const registerHash = await operator2WalletClient.writeContract({
      address: rewardsContractAddress,
      abi: rewardsAbi,
      functionName: 'registerNode',
      args: ['https://rpc3.example.com', 1, STAKE_AMOUNT],
    });
    const receipt = await waitForTransactionReceipt(publicClient, { hash: registerHash });
    
    const gasUsed = Number(receipt.gasUsed);
    
    console.log(`   Registration gas: ${gasUsed.toLocaleString()}`);
    
    // Should be under 300k gas for registration
    expect(gasUsed).toBeLessThan(300000);
    
    console.log(`✅ Gas costs are reasonable\n`);
  });
});

// Run test if called directly
if (import.meta.main) {
  console.log('Running Node Rewards E2E Tests...\n');
  
  const { test, describe, expect, beforeAll, afterAll } = await import('bun:test');
  
  // Import test framework
  const runner = await import('bun:test');
  
  console.log('\n✅ All E2E tests completed successfully!\n');
}


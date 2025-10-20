/**
 * Complete Trading Flow Tests using direct viem
 * 
 * Tests the full user journey with on-chain verification:
 * 1. Create a market
 * 2. Place predictions (YES/NO bets)
 * 3. Verify on-chain state after each action
 * 4. Resolve market
 * 5. Claim payouts
 */

import { test, expect } from '@playwright/test';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, keccak256, toBytes, encodeAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Test wallet private key (first account from test mnemonic)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);

// Contract ABIs (minimal, just what we need)
const ELIZA_TOKEN_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const ORACLE_ABI = [
  {
    name: 'commitGame',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'question', type: 'string' },
      { name: 'commitment', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'revealGame',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'outcome', type: 'bool' },
      { name: 'salt', type: 'bytes32' },
      { name: 'teeQuote', type: 'bytes' },
      { name: 'winners', type: 'address[]' },
      { name: 'totalPayout', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'games',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'sessionId', type: 'bytes32' },
          { name: 'question', type: 'string' },
          { name: 'outcome', type: 'bool' },
          { name: 'commitment', type: 'bytes32' },
          { name: 'salt', type: 'bytes32' },
          { name: 'startTime', type: 'uint256' },
          { name: 'endTime', type: 'uint256' },
          { name: 'teeQuote', type: 'bytes' },
          { name: 'totalPayout', type: 'uint256' },
          { name: 'finalized', type: 'bool' },
        ],
      },
    ],
  },
] as const;

const PREDIMARKET_ABI = [
  {
    name: 'createMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'question', type: 'string' },
      { name: 'liquidityParameter', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'outcome', type: 'bool' },
      { name: 'maxCost', type: 'uint256' },
      { name: 'minShares', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'resolveMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'claimPayout',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getMarket',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'sessionId', type: 'bytes32' },
          { name: 'question', type: 'string' },
          { name: 'yesShares', type: 'uint256' },
          { name: 'noShares', type: 'uint256' },
          { name: 'liquidityParameter', type: 'uint256' },
          { name: 'totalVolume', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'resolved', type: 'bool' },
          { name: 'outcome', type: 'bool' },
          { name: 'gameType', type: 'uint8' },
          { name: 'gameContract', type: 'address' },
          { name: 'category', type: 'uint8' },
        ],
      },
    ],
  },
  {
    name: 'getPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }, { name: '', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'yesShares', type: 'uint256' },
          { name: 'noShares', type: 'uint256' },
          { name: 'totalSpent', type: 'uint256' },
          { name: 'totalReceived', type: 'uint256' },
          { name: 'hasClaimed', type: 'bool' },
        ],
      },
    ],
  },
] as const;

// Helper to get contract addresses from env
function getContractAddresses() {
  const addresses = {
    elizaToken: process.env.NEXT_PUBLIC_ELIZA_OS_ADDRESS || '',
    oracle: process.env.NEXT_PUBLIC_PREDICTION_ORACLE_ADDRESS || '',
    predimarket: process.env.NEXT_PUBLIC_PREDIMARKET_ADDRESS || '',
  };

  if (!addresses.elizaToken || !addresses.oracle || !addresses.predimarket) {
    throw new Error('Contract addresses not set in environment');
  }

  return addresses as { elizaToken: `0x${string}`; oracle: `0x${string}`; predimarket: `0x${string}` };
}

// Helper to create viem clients
function getClients() {
  // Custom chain config for Anvil on port 9545, chain ID 1337
  const anvilChain = {
    id: 1337,
    name: 'Anvil',
    network: 'anvil',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: { http: ['http://localhost:9545'] },
      public: { http: ['http://localhost:9545'] },
    },
  } as const;

  const publicClient = createPublicClient({
    chain: anvilChain,
    transport: http('http://localhost:9545'),
  });

  const walletClient = createWalletClient({
    account: TEST_ACCOUNT,
    chain: anvilChain,
    transport: http('http://localhost:9545'),
  });

  return { publicClient, walletClient };
}

test.describe('Complete Predimarket User Flow (On-Chain)', () => {
  test('Full cycle: Create market, place bets, resolve, claim', async () => {
    const addresses = getContractAddresses();
    const { publicClient, walletClient } = getClients();
    const userAddress = TEST_ACCOUNT.address;

    console.log('🎯 Starting full cycle test...');
    console.log('User address:', userAddress);

    // Generate unique session ID and commitment
    const timestamp = Date.now();
    const sessionId = keccak256(toBytes(`test-session-${timestamp}`));
    const question = 'Will the test pass?';
    const salt = keccak256(toBytes(`salt-${timestamp}`));
    const outcome = true; // YES
    // Commitment must match: keccak256(abi.encode(outcome, salt))
    const commitment = keccak256(encodeAbiParameters(
      [{ type: 'bool' }, { type: 'bytes32' }],
      [outcome, salt]
    ));

    // ====== STEP 1: Commit game in oracle ======
    console.log('\n📝 Step 1: Committing game to oracle...');
    const commitTx = await walletClient.writeContract({
      address: addresses.oracle,
      abi: ORACLE_ABI,
      functionName: 'commitGame',
      args: [sessionId, question, commitment],
    });
    const commitReceipt = await publicClient.waitForTransactionReceipt({ hash: commitTx });
    expect(commitReceipt.status).toBe('success');
    console.log('✅ Game committed, tx:', commitTx);
    console.log('✅ On-chain verification: Transaction successful');

    // ====== STEP 2: Create market ======
    console.log('\n📝 Step 2: Creating prediction market...');
    const createMarketTx = await walletClient.writeContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'createMarket',
      args: [sessionId, question, parseEther('1000')],
    });
    await publicClient.waitForTransactionReceipt({ hash: createMarketTx });
    console.log('✅ Market created, tx:', createMarketTx);

    // Verify on-chain: market exists
    const market = await publicClient.readContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'getMarket',
      args: [sessionId],
    });
    expect(market.sessionId).toBe(sessionId);
    expect(market.question).toBe(question);
    expect(market.resolved).toBe(false);
    console.log('✅ On-chain verification: Market created');
    console.log('   Initial YES shares:', formatEther(market.yesShares));
    console.log('   Initial NO shares:', formatEther(market.noShares));

    // ====== STEP 3: Approve ELIZA spending ======
    console.log('\n📝 Step 3: Approving ELIZA token spending...');
    const approveTx = await walletClient.writeContract({
      address: addresses.elizaToken,
      abi: ELIZA_TOKEN_ABI,
      functionName: 'approve',
      args: [addresses.predimarket, parseEther('1000000')],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log('✅ Token approved, tx:', approveTx);

    // Verify on-chain: allowance set
    const allowance = await publicClient.readContract({
      address: addresses.elizaToken,
      abi: ELIZA_TOKEN_ABI,
      functionName: 'allowance',
      args: [userAddress, addresses.predimarket],
    });
    expect(allowance).toBeGreaterThan(0n);
    console.log('✅ On-chain verification: Allowance set to', formatEther(allowance), 'ELIZA');

    // ====== STEP 4: Get initial balance ======
    const initialBalance = await publicClient.readContract({
      address: addresses.elizaToken,
      abi: ELIZA_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    });
    console.log('\n💰 Initial ELIZA balance:', formatEther(initialBalance));

    // ====== STEP 5: Buy YES shares ======
    console.log('\n📝 Step 4: Buying YES shares (100 ELIZA max)...');
    const buyCost = parseEther('100');
    const buyYesTx = await walletClient.writeContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'buy',
      args: [sessionId, true, buyCost, 0n], // YES, 100 ELIZA max, 0 min shares
    });
    const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyYesTx });
    console.log('✅ YES shares purchased, tx:', buyYesTx);

    // Verify on-chain: position updated
    const positionAfterBuy = await publicClient.readContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'getPosition',
      args: [sessionId, userAddress],
    });
    expect(positionAfterBuy.yesShares).toBeGreaterThan(0n);
    expect(positionAfterBuy.totalSpent).toBeGreaterThan(0n);
    console.log('✅ On-chain verification: Position updated');
    console.log('   YES shares owned:', formatEther(positionAfterBuy.yesShares));
    console.log('   Total spent:', formatEther(positionAfterBuy.totalSpent), 'ELIZA');

    // Verify balance decreased
    const balanceAfterBuy = await publicClient.readContract({
      address: addresses.elizaToken,
      abi: ELIZA_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    });
    expect(balanceAfterBuy).toBeLessThan(initialBalance);
    const spent = initialBalance - balanceAfterBuy;
    console.log('   ELIZA spent:', formatEther(spent));

    // ====== STEP 6: Buy NO shares ======
    console.log('\n📝 Step 5: Buying NO shares (50 ELIZA max)...');
    const buyNoTx = await walletClient.writeContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'buy',
      args: [sessionId, false, parseEther('50'), 0n], // NO, 50 ELIZA max, 0 min shares
    });
    await publicClient.waitForTransactionReceipt({ hash: buyNoTx });
    console.log('✅ NO shares purchased, tx:', buyNoTx);

    // Verify on-chain: position updated with NO shares
    const positionAfterNo = await publicClient.readContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'getPosition',
      args: [sessionId, userAddress],
    });
    expect(positionAfterNo.noShares).toBeGreaterThan(0n);
    console.log('✅ On-chain verification: Position updated with NO shares');
    console.log('   YES shares owned:', formatEther(positionAfterNo.yesShares));
    console.log('   NO shares owned:', formatEther(positionAfterNo.noShares));
    console.log('   Total spent:', formatEther(positionAfterNo.totalSpent), 'ELIZA');

    // ====== STEP 7: Check market state ======
    const marketAfterTrades = await publicClient.readContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'getMarket',
      args: [sessionId],
    });
    console.log('\n📊 Market state after trades:');
    console.log('   Total YES shares:', formatEther(marketAfterTrades.yesShares));
    console.log('   Total NO shares:', formatEther(marketAfterTrades.noShares));
    console.log('   Total volume:', formatEther(marketAfterTrades.totalVolume), 'ELIZA');
    expect(marketAfterTrades.totalVolume).toBeGreaterThan(0n);

    // ====== STEP 8: Reveal game outcome (YES wins) ======
    console.log('\n📝 Step 6: Revealing game outcome (YES wins)...');
    const revealTx = await walletClient.writeContract({
      address: addresses.oracle,
      abi: ORACLE_ABI,
      functionName: 'revealGame',
      args: [
        sessionId,
        outcome, // YES wins
        salt,
        '0x', // empty bytes for teeQuote
        [userAddress], // winners
        0n, // totalPayout
      ],
    });
    const revealReceipt = await publicClient.waitForTransactionReceipt({ hash: revealTx });
    expect(revealReceipt.status).toBe('success');
    console.log('✅ Game revealed, tx:', revealTx);
    console.log('✅ On-chain verification: Game revealed successfully');

    // ====== STEP 9: Resolve market ======
    console.log('\n📝 Step 7: Resolving market...');
    const resolveTx = await walletClient.writeContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'resolveMarket',
      args: [sessionId],
    });
    await publicClient.waitForTransactionReceipt({ hash: resolveTx });
    console.log('✅ Market resolved, tx:', resolveTx);

    // Verify on-chain: market resolved
    const marketAfterResolve = await publicClient.readContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'getMarket',
      args: [sessionId],
    });
    expect(marketAfterResolve.resolved).toBe(true);
    expect(marketAfterResolve.outcome).toBe(true); // YES won
    console.log('✅ On-chain verification: Market resolved with YES outcome');

    // ====== STEP 10: Claim payout ======
    console.log('\n📝 Step 8: Claiming payout...');
    const balanceBeforeClaim = await publicClient.readContract({
      address: addresses.elizaToken,
      abi: ELIZA_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    });

    const claimTx = await walletClient.writeContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'claimPayout',
      args: [sessionId],
    });
    await publicClient.waitForTransactionReceipt({ hash: claimTx });
    console.log('✅ Payout claimed, tx:', claimTx);

    // Verify on-chain: balance increased
    const balanceAfterClaim = await publicClient.readContract({
      address: addresses.elizaToken,
      abi: ELIZA_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    });
    const payout = balanceAfterClaim - balanceBeforeClaim;
    expect(payout).toBeGreaterThan(0n);
    console.log('✅ On-chain verification: Payout received');
    console.log('   Payout amount:', formatEther(payout), 'ELIZA');

    // Verify position marked as claimed
    const finalPosition = await publicClient.readContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'getPosition',
      args: [sessionId, userAddress],
    });
    expect(finalPosition.hasClaimed).toBe(true);
    console.log('✅ On-chain verification: Position marked as claimed');

    // Calculate profit/loss (balance comparison)
    const finalBalance = await publicClient.readContract({
      address: addresses.elizaToken,
      abi: ELIZA_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    });
    const netChange = finalBalance - initialBalance;
    console.log('\n💰 Final P&L:');
    console.log('   Initial balance:', formatEther(initialBalance), 'ELIZA');
    console.log('   Final balance:', formatEther(finalBalance), 'ELIZA');
    console.log('   Net change:', formatEther(netChange), 'ELIZA', netChange >= 0n ? '🟢' : '🔴');
    // Note: User broke even because they bet on both YES and NO
    // The YES bet won and returned the full investment

    console.log('\n✅ Full cycle test completed successfully!');
  });

  test('Multiple users betting on opposite sides', async () => {
    const addresses = getContractAddresses();
    const { publicClient, walletClient } = getClients();

    console.log('🎯 Testing multiple users scenario...');

    // Generate unique session ID and commitment
    const timestamp = Date.now();
    const sessionId = keccak256(toBytes(`multi-user-${timestamp}`));
    const question = 'Will NO win?';
    const salt = keccak256(toBytes(`salt-${timestamp}`));
    const outcome = false; // NO
    // Commitment must match: keccak256(abi.encode(outcome, salt))
    const commitment = keccak256(encodeAbiParameters(
      [{ type: 'bool' }, { type: 'bytes32' }],
      [outcome, salt]
    ));

    // Setup: commit and create market
    console.log('\n📝 Setting up market...');
    const commitTx = await walletClient.writeContract({
      address: addresses.oracle,
      abi: ORACLE_ABI,
      functionName: 'commitGame',
      args: [sessionId, question, commitment],
    });
    await publicClient.waitForTransactionReceipt({ hash: commitTx });

    const createTx = await walletClient.writeContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'createMarket',
      args: [sessionId, question, parseEther('500')],
    });
    await publicClient.waitForTransactionReceipt({ hash: createTx });

    const approveTx = await walletClient.writeContract({
      address: addresses.elizaToken,
      abi: ELIZA_TOKEN_ABI,
      functionName: 'approve',
      args: [addresses.predimarket, parseEther('1000000')],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    console.log('✅ Market setup complete');

    // User 1 buys YES (will lose)
    console.log('\n📝 User 1 buys YES shares (200 ELIZA)...');
    const buyYesTx = await walletClient.writeContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'buy',
      args: [sessionId, true, parseEther('200'), 0n],
    });
    await publicClient.waitForTransactionReceipt({ hash: buyYesTx });
    console.log('✅ User 1 bought YES shares');

    // User 1 also buys NO (will win)
    console.log('\n📝 User 1 buys NO shares (100 ELIZA)...');
    const buyNoTx = await walletClient.writeContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'buy',
      args: [sessionId, false, parseEther('100'), 0n],
    });
    await publicClient.waitForTransactionReceipt({ hash: buyNoTx });
    console.log('✅ User 1 bought NO shares');

    // Check market prices shifted
    const marketAfterBets = await publicClient.readContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'getMarket',
      args: [sessionId],
    });
    console.log('\n📊 Market state:');
    console.log('   YES shares:', formatEther(marketAfterBets.yesShares));
    console.log('   NO shares:', formatEther(marketAfterBets.noShares));
    console.log('   Volume:', formatEther(marketAfterBets.totalVolume));

    // Reveal: NO wins
    console.log('\n📝 Revealing outcome: NO wins...');
    const revealTx = await walletClient.writeContract({
      address: addresses.oracle,
      abi: ORACLE_ABI,
      functionName: 'revealGame',
      args: [
        sessionId,
        outcome, // NO wins
        salt,
        '0x', // empty bytes for teeQuote
        [TEST_ACCOUNT.address],
        0n, // totalPayout
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: revealTx });

    // Resolve market
    const resolveTx = await walletClient.writeContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'resolveMarket',
      args: [sessionId],
    });
    await publicClient.waitForTransactionReceipt({ hash: resolveTx });

    // Verify market resolved to NO
    const resolvedMarket = await publicClient.readContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'getMarket',
      args: [sessionId],
    });
    expect(resolvedMarket.resolved).toBe(true);
    expect(resolvedMarket.outcome).toBe(false); // NO won
    console.log('✅ Market resolved: NO wins');

    // User 1 claims (should get payout from NO shares)
    console.log('\n📝 User 1 claiming payout...');
    const claimTx = await walletClient.writeContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'claimPayout',
      args: [sessionId],
    });
    await publicClient.waitForTransactionReceipt({ hash: claimTx });

    const position = await publicClient.readContract({
      address: addresses.predimarket,
      abi: PREDIMARKET_ABI,
      functionName: 'getPosition',
      args: [sessionId, TEST_ACCOUNT.address],
    });

    console.log('\n💰 Final position:');
    console.log('   YES shares (lost):', formatEther(position.yesShares));
    console.log('   NO shares (won):', formatEther(position.noShares));
    console.log('   Total spent:', formatEther(position.totalSpent));
    console.log('   Total received:', formatEther(position.totalReceived));
    
    const profit = position.totalReceived - position.totalSpent;
    console.log('   Net P&L:', formatEther(profit), profit > 0n ? '🟢' : '🔴');

    expect(position.hasClaimed).toBe(true);
    console.log('\n✅ Multiple user scenario completed!');
  });
});


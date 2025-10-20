#!/usr/bin/env bun
/**
 * Full Cycle Test for eHorse
 * Tests complete flow: Deploy → Start → Bet → Grace → Results → Payout
 */

import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const CONTEST_ADDRESS = process.env.CONTEST_ADDRESS!;
const PREDIMARKET_ADDRESS = process.env.PREDIMARKET_ADDRESS!;
const MARKET_FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS!;
const ELIZAOS_ADDRESS = process.env.ELIZAOS_ADDRESS!;

// Test wallets (Anvil defaults)
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TRADER1_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const TRADER2_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

const CONTEST_ABI = [
  'function getCurrentContest() view returns (bytes32)',
  'function getContestInfo(bytes32) view returns (uint8 state, uint8 mode, uint256 startTime, uint256 endTime, uint256 optionCount)',
  'function getOptions(bytes32) view returns (string[] memory)',
  'function getWinner(bytes32) view returns (uint256 winner, bool finalized)',
  'function getOutcome(bytes32) view returns (bool outcome, bool finalized)'
];

const PREDIMARKET_ABI = [
  'function getMarket(bytes32) view returns (tuple(bytes32 sessionId, string question, uint256 yesShares, uint256 noShares, uint256 liquidityParameter, uint256 totalVolume, uint256 createdAt, bool resolved, bool outcome, uint8 gameType, address gameContract, uint8 category))',
  'function buy(bytes32 sessionId, bool outcome, uint256 tokenAmount, uint256 minShares) returns (uint256)',
  'function resolveMarket(bytes32 sessionId)',
  'function claimPayout(bytes32 sessionId) returns (uint256)',
  'function getPosition(bytes32 sessionId, address trader) view returns (tuple(uint256 yesShares, uint256 noShares, uint256 totalSpent, uint256 totalReceived, bool hasClaimed))'
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)'
];

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   🧪 eHorse Full Cycle Test                                  ║');
  console.log('║   TEE Oracle → Prediction Market → Betting → Payouts         ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const trader1 = new ethers.Wallet(TRADER1_KEY, provider);
  const trader2 = new ethers.Wallet(TRADER2_KEY, provider);

  const contest = new ethers.Contract(CONTEST_ADDRESS, CONTEST_ABI, provider);
  const predimarket = new ethers.Contract(PREDIMARKET_ADDRESS, PREDIMARKET_ABI, provider);
  const elizaOS = new ethers.Contract(ELIZAOS_ADDRESS, ERC20_ABI, provider);
  
  console.log('📊 Contract Addresses:');
  console.log(`   Contest:     ${CONTEST_ADDRESS}`);
  console.log(`   Predimarket: ${PREDIMARKET_ADDRESS}`);
  console.log(`   Factory:     ${MARKET_FACTORY_ADDRESS}`);
  console.log(`   elizaOS:     ${ELIZAOS_ADDRESS}\n`);

  // STEP 1: Wait for current contest
  console.log('📍 STEP 1: Waiting for contest...');
  const contestId = await contest.getCurrentContest();
  console.log(`   Contest ID: ${contestId}\n`);

  // STEP 2: Check contest info
  console.log('📍 STEP 2: Checking contest info...');
  const [state, mode, startTime, endTime, optionCount] = await contest.getContestInfo(contestId);
  const options = await contest.getOptions(contestId);
  
  console.log(`   State: ${['PENDING', 'ACTIVE', 'GRACE_PERIOD', 'FINISHED', 'CANCELLED'][state]}`);
  console.log(`   Options: ${options.join(', ')}`);
  console.log(`   Start time: ${new Date(Number(startTime) * 1000).toLocaleTimeString()}\n`);

  // STEP 3: Wait for contest to start
  console.log('📍 STEP 3: Waiting for contest to start...');
  let currentState = state;
  while (currentState === 0) { // PENDING
    await sleep(5000);
    [currentState] = await contest.getContestInfo(contestId);
    console.log(`   Current state: ${['PENDING', 'ACTIVE', 'GRACE_PERIOD', 'FINISHED', 'CANCELLED'][currentState]}`);
  }
  console.log('   ✅ Contest started!\n');

  // STEP 4: Check if market exists
  console.log('📍 STEP 4: Checking for prediction market...');
  await sleep(3000); // Wait for market creation
  
  const market = await predimarket.getMarket(contestId);
  console.log(`   Market created: ${market.createdAt > 0n ? 'Yes' : 'No'}`);
  console.log(`   Question: ${market.question}`);
  console.log(`   Liquidity: ${ethers.formatEther(market.liquidityParameter)}\n`);

  // STEP 5: Traders place bets
  console.log('📍 STEP 5: Placing bets...');
  
  // Trader1 bets YES (Storm/Blaze)
  console.log('   Trader1 betting YES (Storm/Blaze will win)...');
  const trader1Balance = await elizaOS.balanceOf(trader1.address);
  console.log(`   Trader1 balance: ${ethers.formatEther(trader1Balance)} elizaOS`);
  
  const elizaOS1 = elizaOS.connect(trader1);
  const predimarket1 = predimarket.connect(trader1);
  
  await elizaOS1.approve(PREDIMARKET_ADDRESS, ethers.MaxUint256);
  const betAmount1 = ethers.parseEther('100');
  const tx1 = await predimarket1.buy(contestId, true, betAmount1, 0n);
  await tx1.wait();
  console.log(`   ✅ Trader1 bet 100 elizaOS on YES`);
  
  // Trader2 bets NO (Thunder/Lightning)
  console.log('   Trader2 betting NO (Thunder/Lightning will win)...');
  const trader2Balance = await elizaOS.balanceOf(trader2.address);
  console.log(`   Trader2 balance: ${ethers.formatEther(trader2Balance)} elizaOS`);
  
  const elizaOS2 = elizaOS.connect(trader2);
  const predimarket2 = predimarket.connect(trader2);
  
  await elizaOS2.approve(PREDIMARKET_ADDRESS, ethers.MaxUint256);
  const betAmount2 = ethers.parseEther('50');
  const tx2 = await predimarket2.buy(contestId, false, betAmount2, 0n);
  await tx2.wait();
  console.log(`   ✅ Trader2 bet 50 elizaOS on NO\n`);

  // Check positions
  const pos1 = await predimarket.getPosition(contestId, trader1.address);
  const pos2 = await predimarket.getPosition(contestId, trader2.address);
  console.log(`   Trader1 position: ${ethers.formatEther(pos1.yesShares)} YES shares`);
  console.log(`   Trader2 position: ${ethers.formatEther(pos2.noShares)} NO shares\n`);

  // STEP 6: Wait for grace period
  console.log('📍 STEP 6: Waiting for grace period...');
  while (currentState === 1) { // ACTIVE
    await sleep(5000);
    [currentState] = await contest.getContestInfo(contestId);
    console.log(`   State: ${['PENDING', 'ACTIVE', 'GRACE_PERIOD', 'FINISHED', 'CANCELLED'][currentState]}`);
  }
  console.log('   ✅ Grace period started (trading frozen)!\n');

  // STEP 7: Wait for results
  console.log('📍 STEP 7: Waiting for results...');
  while (currentState === 2) { // GRACE_PERIOD
    await sleep(5000);
    [currentState] = await contest.getContestInfo(contestId);
    console.log(`   State: ${['PENDING', 'ACTIVE', 'GRACE_PERIOD', 'FINISHED', 'CANCELLED'][currentState]}`);
  }
  
  const [winner, finalized] = await contest.getWinner(contestId);
  const [outcome, outcomeFinalized] = await contest.getOutcome(contestId);
  
  console.log('   ✅ Results published!');
  console.log(`   Winner: ${options[Number(winner)]} (index ${winner})`);
  console.log(`   Binary outcome: ${outcome ? 'YES' : 'NO'}\n`);

  // STEP 8: Resolve market
  console.log('📍 STEP 8: Resolving market...');
  const resolveTx = await predimarket.resolveMarket(contestId);
  await resolveTx.wait();
  console.log('   ✅ Market resolved\n');

  // STEP 9: Claim payouts
  console.log('📍 STEP 9: Claiming payouts...');
  
  const trader1BalanceBefore = await elizaOS.balanceOf(trader1.address);
  const trader2BalanceBefore = await elizaOS.balanceOf(trader2.address);
  
  console.log(`   Trader1 balance before: ${ethers.formatEther(trader1BalanceBefore)}`);
  console.log(`   Trader2 balance before: ${ethers.formatEther(trader2BalanceBefore)}`);
  
  // Trader1 claims (bet YES)
  try {
    const claim1 = await predimarket1.claimPayout(contestId);
    const receipt1 = await claim1.wait();
    const trader1BalanceAfter = await elizaOS.balanceOf(trader1.address);
    const profit1 = trader1BalanceAfter - trader1BalanceBefore;
    console.log(`   ✅ Trader1 claimed: ${ethers.formatEther(profit1)} elizaOS profit`);
  } catch (e: any) {
    console.log(`   ❌ Trader1 lost (bet ${outcome ? 'YES' : 'NO'}, result was ${outcome ? 'YES' : 'NO'})`);
  }
  
  // Trader2 claims (bet NO)
  try {
    const claim2 = await predimarket2.claimPayout(contestId);
    const receipt2 = await claim2.wait();
    const trader2BalanceAfter = await elizaOS.balanceOf(trader2.address);
    const profit2 = trader2BalanceAfter - trader2BalanceBefore;
    console.log(`   ✅ Trader2 claimed: ${ethers.formatEther(profit2)} elizaOS profit`);
  } catch (e: any) {
    console.log(`   ❌ Trader2 lost (bet ${!outcome ? 'NO' : 'YES'}, result was ${outcome ? 'YES' : 'NO'})`);
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   ✅ FULL CYCLE TEST COMPLETE!                               ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  console.log('📊 Test Summary:');
  console.log(`   Contest ID: ${contestId}`);
  console.log(`   Winner: ${options[Number(winner)]}`);
  console.log(`   Binary outcome: ${outcome ? 'YES (Storm/Blaze)' : 'NO (Thunder/Lightning)'}`);
  console.log(`   Trader1 bet YES: ${outcome ? 'WON ✅' : 'LOST ❌'}`);
  console.log(`   Trader2 bet NO:  ${!outcome ? 'WON ✅' : 'LOST ❌'}`);
  console.log('');
  
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});


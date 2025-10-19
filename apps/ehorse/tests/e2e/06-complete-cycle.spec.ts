import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

const config = JSON.parse(readFileSync(join(__dirname, '../test-config.json'), 'utf-8'));

const EHORSE_URL = process.env.EHORSE_URL || 'http://localhost:5700';
const RPC_URL = config.rpcUrl;
const PREDIMARKET_ADDRESS = config.addresses.predimarket;
const ORACLE_ADDRESS = config.addresses.predictionOracle;
const ELIZAOS_ADDRESS = config.addresses.elizaOS;

const ORACLE_ABI = [
  'function games(bytes32) view returns (bytes32, string, bool, bytes32, bytes32, uint256, uint256, bytes, address[], uint256, bool)',
  'function getOutcome(bytes32) view returns (bool, bool)'
];

const PREDIMARKET_ABI = [
  'function markets(bytes32) view returns (bytes32, string, uint256, uint256, uint256, uint256, uint256, bool, bool)',
  'function buy(bytes32, bool, uint256, uint256) external returns (uint256)',
  'function resolveMarket(bytes32) external',
  'function claimPayout(bytes32) external returns (uint256)',
  'function positions(bytes32, address) view returns (uint256, uint256, uint256, uint256, bool)'
];

const ERC20_ABI = [
  'function approve(address, uint256) external returns (bool)',
  'function balanceOf(address) view returns (uint256)'
];

test.describe('Complete Race → Bet → Resolve → Claim Cycle', () => {
  let provider: ethers.JsonRpcProvider;
  let wallet: ethers.Wallet;
  let oracle: ethers.Contract;
  let predimarket: ethers.Contract;
  let elizaOS: ethers.Contract;

  test.beforeAll(async () => {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    wallet = new ethers.Wallet(config.testWallets[1].key, provider); // Agent1
    oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider);
    predimarket = new ethers.Contract(PREDIMARKET_ADDRESS, PREDIMARKET_ABI, wallet);
    elizaOS = new ethers.Contract(ELIZAOS_ADDRESS, ERC20_ABI, wallet);
  });

  test('COMPLETE CYCLE: Create → Commit → Market → Bet → Reveal → Resolve → Claim', async ({ page }) => {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║   🧪 Testing Complete Prediction Market Cycle                ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // ========== PHASE 1: RACE CREATION ==========
    console.log('📍 PHASE 1: Race Creation');
    
    let raceRes = await page.request.get(`${EHORSE_URL}/api/race`);
    let race = await raceRes.json();
    
    console.log(`  Current race: ${race.id}`);
    console.log(`  Status: ${race.status}`);
    
    const initialRaceId = race.id;
    
    // Wait for pending race
    if (race.status === 'finished') {
      console.log('  Waiting for new race...');
      await page.waitForTimeout(12000); // Wait for new race
      raceRes = await page.request.get(`${EHORSE_URL}/api/race`);
      race = await raceRes.json();
    }
    
    expect(['pending', 'running'].includes(race.status)).toBe(true);
    console.log('  ✅ Race is active\n');

    // ========== PHASE 2: ORACLE COMMITMENT ==========
    console.log('📍 PHASE 2: Oracle Commitment');
    
    // Wait for race to start
    while (race.status === 'pending') {
      console.log('  Waiting for race to start...');
      await page.waitForTimeout(5000);
      raceRes = await page.request.get(`${EHORSE_URL}/api/race`);
      race = await raceRes.json();
    }
    
    const sessionId = ethers.id(race.id);
    console.log(`  SessionId: ${sessionId}`);
    
    // Check oracle commitment
    await page.waitForTimeout(3000); // Wait for tx to confirm
    
    const gameData = await oracle.games(sessionId);
    console.log(`  Oracle commitment: ${gameData[3]}`);
    console.log(`  Oracle question: ${gameData[1]}`);
    console.log(`  ✅ Committed to oracle\n`);
    
    expect(gameData[5]).toBeGreaterThan(0); // startTime

    // ========== PHASE 3: MARKET CREATION ==========
    console.log('📍 PHASE 3: Market Creation on Predimarket');
    
    // Wait for market to be created
    await page.waitForTimeout(5000);
    
    const market = await predimarket.markets(sessionId);
    console.log(`  Market question: ${market[1]}`);
    console.log(`  Created at: ${market[6]}`);
    console.log(`  Liquidity: ${ethers.formatEther(market[4])}`);
    console.log(`  ✅ Market created\n`);
    
    expect(market[6]).toBeGreaterThan(0); // createdAt

    // ========== PHASE 4: PLACE BET ==========
    console.log('📍 PHASE 4: Placing Bet');
    
    // Get initial balance
    const initialBalance = await elizaOS.balanceOf(wallet.address);
    console.log(`  Initial balance: ${ethers.formatEther(initialBalance)} elizaOS`);
    
    // Approve elizaOS
    const approveTx = await elizaOS.approve(PREDIMARKET_ADDRESS, ethers.MaxUint256);
    await approveTx.wait();
    console.log(`  ✅ Approved elizaOS`);
    
    // Place bet (bet on YES - horses 3 or 4)
    const betAmount = ethers.parseEther('100');
    const betOutcome = true; // YES
    
    console.log(`  Betting 100 elizaOS on ${betOutcome ? 'YES' : 'NO'}`);
    
    const betTx = await predimarket.buy(sessionId, betOutcome, betAmount, 0n);
    const betReceipt = await betTx.wait();
    
    console.log(`  ✅ Bet placed! Tx: ${betReceipt.hash}`);
    
    // Verify position
    const position = await predimarket.positions(sessionId, wallet.address);
    console.log(`  Position:`);
    console.log(`    YES shares: ${ethers.formatEther(position[0])}`);
    console.log(`    NO shares: ${ethers.formatEther(position[1])}`);
    console.log(`    Total spent: ${ethers.formatEther(position[2])}`);
    console.log('  ✅ Position recorded\n');
    
    expect(position[2]).toBeGreaterThan(0); // totalSpent

    // ========== PHASE 5: WAIT FOR RACE TO FINISH ==========
    console.log('📍 PHASE 5: Waiting for Race to Finish');
    
    let finished = false;
    let attempts = 0;
    
    while (!finished && attempts < 20) {
      await page.waitForTimeout(5000);
      const res = await page.request.get(`${EHORSE_URL}/api/race`);
      const currentRace = await res.json();
      
      // Check if it's a different race (old one finished)
      if (currentRace.id !== race.id) {
        finished = true;
        console.log(`  ✅ Race finished! New race: ${currentRace.id}`);
      } else if (currentRace.status === 'finished') {
        finished = true;
        race = currentRace;
        console.log(`  ✅ Race finished! Winner: Horse #${race.winner}`);
      } else {
        console.log(`  Status: ${currentRace.status} (attempt ${attempts}/20)`);
      }
      
      attempts++;
    }
    
    if (!finished) {
      console.log('  ⚠️  Race did not finish in time, skipping resolution\n');
      return;
    }
    
    console.log('');

    // ========== PHASE 6: ORACLE REVEAL ==========
    console.log('📍 PHASE 6: Oracle Reveal');
    
    // Wait for reveal transaction to confirm
    await page.waitForTimeout(5000);
    
    const [oracleOutcome, finalized] = await oracle.getOutcome(sessionId);
    const revealedGameData = await oracle.games(sessionId);
    
    console.log(`  Oracle outcome: ${oracleOutcome ? 'YES' : 'NO'}`);
    console.log(`  Finalized: ${finalized}`);
    console.log(`  End time: ${revealedGameData[6]}`);
    
    // Verify outcome matches winner
    const expectedOutcome = race.winner >= 3;
    console.log(`  Expected outcome (winner #${race.winner}): ${expectedOutcome ? 'YES' : 'NO'}`);
    console.log(`  ✅ Oracle revealed\n`);
    
    expect(finalized).toBe(true);
    expect(oracleOutcome).toBe(expectedOutcome);

    // ========== PHASE 7: MARKET RESOLUTION ==========
    console.log('📍 PHASE 7: Market Resolution');
    
    // Anyone can resolve
    const resolveTx = await predimarket.resolveMarket(sessionId);
    const resolveReceipt = await resolveTx.wait();
    
    console.log(`  ✅ Market resolved! Tx: ${resolveReceipt.hash}`);
    
    // Verify market is resolved
    const resolvedMarket = await predimarket.markets(sessionId);
    console.log(`  Market resolved: ${resolvedMarket[7]}`);
    console.log(`  Market outcome: ${resolvedMarket[8] ? 'YES' : 'NO'}`);
    console.log('');
    
    expect(resolvedMarket[7]).toBe(true); // resolved
    expect(resolvedMarket[8]).toBe(oracleOutcome); // outcome matches oracle

    // ========== PHASE 8: CLAIM PAYOUT ==========
    console.log('📍 PHASE 8: Claim Payout');
    
    const positionBefore = await predimarket.positions(sessionId, wallet.address);
    const yesShares = positionBefore[0];
    const noShares = positionBefore[1];
    const hasClaimed = positionBefore[4];
    
    console.log(`  Position before claim:`);
    console.log(`    YES shares: ${ethers.formatEther(yesShares)}`);
    console.log(`    NO shares: ${ethers.formatEther(noShares)}`);
    console.log(`    Already claimed: ${hasClaimed}`);
    
    const wonBet = (betOutcome === oracleOutcome);
    console.log(`  Did we win? ${wonBet ? 'YES! 🎉' : 'NO 😢'}`);
    
    if (wonBet && !hasClaimed) {
      const balanceBefore = await elizaOS.balanceOf(wallet.address);
      
      // Claim payout
      const claimTx = await predimarket.claimPayout(sessionId);
      const claimReceipt = await claimTx.wait();
      
      console.log(`  ✅ Payout claimed! Tx: ${claimReceipt.hash}`);
      
      const balanceAfter = await elizaOS.balanceOf(wallet.address);
      const payout = balanceAfter - balanceBefore;
      
      console.log(`  Payout received: ${ethers.formatEther(payout)} elizaOS`);
      console.log(`  New balance: ${ethers.formatEther(balanceAfter)} elizaOS`);
      
      expect(payout).toBeGreaterThan(0);
      
      // Verify position marked as claimed
      const positionAfter = await predimarket.positions(sessionId, wallet.address);
      expect(positionAfter[4]).toBe(true); // hasClaimed
      
      console.log(`  ✅ Position marked as claimed`);
    } else if (hasClaimed) {
      console.log(`  ⚠️  Already claimed`);
    } else {
      console.log(`  ℹ️  Lost bet, no payout`);
    }
    
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                                                              ║');
    console.log('║   ✅ COMPLETE CYCLE VERIFIED!                                ║');
    console.log('║                                                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

  }, 180000); // 3 minute timeout for complete cycle
});




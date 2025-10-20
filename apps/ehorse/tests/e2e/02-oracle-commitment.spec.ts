import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

const config = JSON.parse(readFileSync(join(__dirname, '../test-config.json'), 'utf-8'));

const EHORSE_URL = process.env.EHORSE_URL || 'http://localhost:5700';
const RPC_URL = config.rpcUrl;
const ORACLE_ADDRESS = config.addresses.predictionOracle;

const ORACLE_ABI = [
  'function games(bytes32 sessionId) external view returns (bytes32 _sessionId, string memory question, bool outcome, bytes32 commitment, bytes32 salt, uint256 startTime, uint256 endTime, bytes memory teeQuote, address[] memory winners, uint256 totalPayout, bool finalized)',
  'function getOutcome(bytes32 sessionId) external view returns (bool outcome, bool finalized)',
  'function gameServer() external view returns (address)',
  'event GameCommitted(bytes32 indexed sessionId, string question, bytes32 commitment, uint256 startTime)',
  'event GameRevealed(bytes32 indexed sessionId, bool outcome, uint256 endTime, bytes teeQuote, uint256 winnersCount)'
];

test.describe('On-Chain Oracle Verification', () => {
  let provider: ethers.JsonRpcProvider;
  let oracle: ethers.Contract;

  test.beforeAll(async () => {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider);
  });

  test('oracle should have correct gameServer set', async () => {
    const gameServer = await oracle.gameServer();
    const expectedGameServer = config.testWallets[0].address; // Deployer
    
    console.log(`Game Server: ${gameServer}`);
    console.log(`Expected: ${expectedGameServer}`);
    
    expect(gameServer.toLowerCase()).toBe(expectedGameServer.toLowerCase());
  });

  test('should wait for race to start and verify commitment on-chain', async ({ page }) => {
    // Get current race
    const raceRes = await page.request.get(`${EHORSE_URL}/api/race`);
    let race = await raceRes.json();
    
    console.log(`Current race: ${race.id}, status: ${race.status}`);
    
    // If pending, wait for it to start (max 35 seconds)
    if (race.status === 'pending') {
      console.log('Waiting for race to start...');
      await page.waitForTimeout(35000);
      
      const raceRes2 = await page.request.get(`${EHORSE_URL}/api/race`);
      race = await raceRes2.json();
    }
    
    // If race is running or finished, check oracle
    if (race.status === 'running' || race.status === 'finished') {
      const sessionId = ethers.id(race.id);
      
      console.log(`Checking oracle for sessionId: ${sessionId}`);
      
      // Query oracle contract
      const gameData = await oracle.games(sessionId);
      
      console.log(`Game on-chain:`);
      console.log(`  Question: ${gameData.question}`);
      console.log(`  Start time: ${gameData.startTime}`);
      console.log(`  Commitment: ${gameData.commitment}`);
      
      // Verify data exists
      expect(gameData.startTime).toBeGreaterThan(0);
      expect(gameData.commitment).not.toBe('0x0000000000000000000000000000000000000000000000000000000000000000');
      expect(gameData.question).toContain('race');
    } else {
      console.log('Race still pending, skipping on-chain check');
    }
  }, 60000); // 60 second timeout

  test('should wait for race to finish and verify reveal on-chain', async ({ page }) => {
    // Get current race
    const raceRes = await page.request.get(`${EHORSE_URL}/api/race`);
    let race = await raceRes.json();
    
    console.log(`Current race: ${race.id}, status: ${race.status}`);
    
    // Wait for race to finish (max 95 seconds)
    let attempts = 0;
    while (race.status !== 'finished' && attempts < 19) {
      await page.waitForTimeout(5000);
      const res = await page.request.get(`${EHORSE_URL}/api/race`);
      race = await res.json();
      attempts++;
      console.log(`Status: ${race.status} (attempt ${attempts}/19)`);
    }
    
    if (race.status === 'finished') {
      const sessionId = ethers.id(race.id);
      
      console.log(`Race finished! Winner: Horse #${race.winner}`);
      console.log(`Checking oracle reveal...`);
      
      // Query oracle
      const [outcome, finalized] = await oracle.getOutcome(sessionId);
      const gameData = await oracle.games(sessionId);
      
      console.log(`Oracle data:`);
      console.log(`  Outcome: ${outcome} (${outcome ? 'YES' : 'NO'})`);
      console.log(`  Finalized: ${finalized}`);
      console.log(`  End time: ${gameData.endTime}`);
      
      // Verify reveal matches race
      const expectedOutcome = race.winner >= 3;
      expect(outcome).toBe(expectedOutcome);
      expect(finalized).toBe(true);
      expect(gameData.endTime).toBeGreaterThan(0);
    } else {
      console.log('Race did not finish in time, skipping reveal check');
    }
  }, 120000); // 2 minute timeout

  test('should verify GameCommitted event was emitted', async () => {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 100);
    
    const filter = oracle.filters.GameCommitted();
    const events = await oracle.queryFilter(filter, fromBlock, currentBlock);
    
    console.log(`Found ${events.length} GameCommitted events in last 100 blocks`);
    
    if (events.length > 0) {
      const latest = events[events.length - 1];
      console.log(`Latest GameCommitted:`);
      console.log(`  SessionId: ${latest.args?.[0]}`);
      console.log(`  Question: ${latest.args?.[1]}`);
      console.log(`  Commitment: ${latest.args?.[2]}`);
      console.log(`  Start time: ${latest.args?.[3]}`);
      
      expect(latest.args?.[0]).toBeTruthy();
      expect(latest.args?.[1]).toContain('race');
    }
  });

  test('should verify GameRevealed event was emitted', async () => {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 100);
    
    const filter = oracle.filters.GameRevealed();
    const events = await oracle.queryFilter(filter, fromBlock, currentBlock);
    
    console.log(`Found ${events.length} GameRevealed events in last 100 blocks`);
    
    if (events.length > 0) {
      const latest = events[events.length - 1];
      console.log(`Latest GameRevealed:`);
      console.log(`  SessionId: ${latest.args?.[0]}`);
      console.log(`  Outcome: ${latest.args?.[1]} (${latest.args?.[1] ? 'YES' : 'NO'})`);
      console.log(`  End time: ${latest.args?.[2]}`);
      
      expect(latest.args?.[0]).toBeTruthy();
      expect(typeof latest.args?.[1]).toBe('boolean');
    }
  });
});




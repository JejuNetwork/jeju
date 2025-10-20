import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

const config = JSON.parse(readFileSync(join(__dirname, '../test-config.json'), 'utf-8'));

const EHORSE_URL = process.env.EHORSE_URL || 'http://localhost:5700';
const RPC_URL = config.rpcUrl;
const PREDIMARKET_ADDRESS = config.addresses.predimarket;
const MARKET_FACTORY_ADDRESS = config.addresses.marketFactory;

const PREDIMARKET_ABI = [
  'function markets(bytes32 sessionId) external view returns (bytes32 sessionId_, string memory question, uint256 yesShares, uint256 noShares, uint256 liquidityParameter, uint256 totalVolume, uint256 createdAt, bool resolved, bool outcome)',
  'event MarketCreated(bytes32 indexed sessionId, string question, uint256 liquidity)',
  'event SharesPurchased(bytes32 indexed sessionId, address indexed trader, bool outcome, uint256 shares, uint256 cost, address paymentToken)'
];

const FACTORY_ABI = [
  'function marketCreated(bytes32 sessionId) external view returns (bool)',
  'event MarketAutoCreated(bytes32 indexed sessionId, string question)'
];

test.describe('Predimarket Market Creation from eHorse', () => {
  let provider: ethers.JsonRpcProvider;
  let predimarket: ethers.Contract;
  let factory: ethers.Contract;

  test.beforeAll(async () => {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    predimarket = new ethers.Contract(PREDIMARKET_ADDRESS, PREDIMARKET_ABI, provider);
    factory = new ethers.Contract(MARKET_FACTORY_ADDRESS, FACTORY_ABI, provider);
  });

  test('should verify MarketFactory is watching oracle', async () => {
    const oracleAddress = await factory.oracle();
    const expectedOracle = config.addresses.predictionOracle;
    
    console.log(`MarketFactory oracle: ${oracleAddress}`);
    console.log(`Expected: ${expectedOracle}`);
    
    expect(oracleAddress.toLowerCase()).toBe(expectedOracle.toLowerCase());
  });

  test('should create market when race starts', async ({ page }) => {
    // Get current race
    const raceRes = await page.request.get(`${EHORSE_URL}/api/race`);
    let race = await raceRes.json();
    
    console.log(`Current race: ${race.id}, status: ${race.status}`);
    
    // Wait for race to start if pending
    if (race.status === 'pending') {
      console.log('Waiting for race to start (max 35s)...');
      await page.waitForTimeout(35000);
      
      const res2 = await page.request.get(`${EHORSE_URL}/api/race`);
      race = await res2.json();
    }
    
    if (race.status === 'running' || race.status === 'finished') {
      const sessionId = ethers.id(race.id);
      
      console.log(`Checking if market exists for sessionId: ${sessionId}`);
      
      // Wait a bit for market creation (async)
      await page.waitForTimeout(5000);
      
      // Check market exists
      const market = await predimarket.markets(sessionId);
      
      console.log(`Market data:`);
      console.log(`  Question: ${market.question}`);
      console.log(`  Created at: ${market.createdAt}`);
      console.log(`  Liquidity: ${market.liquidityParameter}`);
      console.log(`  YES shares: ${market.yesShares}`);
      console.log(`  NO shares: ${market.noShares}`);
      
      expect(market.createdAt).toBeGreaterThan(0);
      expect(market.question).toContain('race');
      expect(market.liquidityParameter).toBe(1000000000000000000000n); // 1000e18
    }
  }, 60000);

  test('should verify MarketAutoCreated event was emitted', async () => {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 100);
    
    const filter = factory.filters.MarketAutoCreated();
    const events = await factory.queryFilter(filter, fromBlock, currentBlock);
    
    console.log(`Found ${events.length} MarketAutoCreated events`);
    
    if (events.length > 0) {
      const latest = events[events.length - 1];
      console.log(`Latest market created:`);
      console.log(`  SessionId: ${latest.args?.[0]}`);
      console.log(`  Question: ${latest.args?.[1]}`);
      
      expect(latest.args?.[0]).toBeTruthy();
      expect(latest.args?.[1]).toContain('race');
    }
  });

  test('should verify market binary mapping is correct', async ({ page }) => {
    const res = await page.request.get(`${EHORSE_URL}/api/history`);
    const history = await res.json();
    
    if (history.races && history.races.length > 0) {
      const finishedRace = history.races[history.races.length - 1];
      
      if (finishedRace && finishedRace.winner) {
        const sessionId = ethers.id(finishedRace.id);
        const [outcome, finalized] = await predimarket.oracle.getOutcome(sessionId);
        
        // Verify mapping: horses 1-2 = NO (false), horses 3-4 = YES (true)
        const expectedOutcome = finishedRace.winner >= 3;
        
        console.log(`Winner: Horse #${finishedRace.winner}`);
        console.log(`Expected outcome: ${expectedOutcome ? 'YES' : 'NO'}`);
        console.log(`Actual outcome: ${outcome ? 'YES' : 'NO'}`);
        
        if (finalized) {
          expect(outcome).toBe(expectedOutcome);
        }
      }
    }
  });
});




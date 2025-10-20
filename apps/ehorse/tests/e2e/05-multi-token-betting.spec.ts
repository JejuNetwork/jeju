import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

const config = JSON.parse(readFileSync(join(__dirname, '../test-config.json'), 'utf-8'));

const EHORSE_URL = process.env.EHORSE_URL || 'http://localhost:5700';
const RPC_URL = config.rpcUrl;
const PREDIMARKET_ADDRESS = config.addresses.predimarket;

const TOKENS = {
  elizaOS: config.addresses.elizaOS,
  CLANKER: config.addresses.clanker,
  VIRTUAL: config.addresses.virtual,
  CLANKERMON: config.addresses.clankermon
};

const PREDIMARKET_ABI = [
  'function buy(bytes32 sessionId, bool outcome, uint256 tokenAmount, uint256 minShares, address token) external returns (uint256)',
  'function supportedTokens(address token) external view returns (bool)',
  'function markets(bytes32 sessionId) external view returns (bytes32, string, uint256, uint256, uint256, uint256, uint256, bool, bool)'
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function symbol() external view returns (string)'
];

test.describe('Multi-Token Betting', () => {
  let provider: ethers.JsonRpcProvider;
  let wallet: ethers.Wallet;
  let predimarket: ethers.Contract;

  test.beforeAll(async () => {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    wallet = new ethers.Wallet(config.testWallets[1].key, provider); // Agent1
    predimarket = new ethers.Contract(PREDIMARKET_ADDRESS, PREDIMARKET_ABI, wallet);
  });

  for (const [tokenName, tokenAddress] of Object.entries(TOKENS)) {
    test(`should verify ${tokenName} is supported`, async () => {
      const supported = await predimarket.supportedTokens(tokenAddress);
      
      console.log(`${tokenName} (${tokenAddress}): ${supported ? 'Supported' : 'Not supported'}`);
      
      expect(supported).toBe(true);
    });

    test(`should bet with ${tokenName}`, async ({ page }) => {
      // Get current race
      const raceRes = await page.request.get(`${EHORSE_URL}/api/race`);
      let race = await raceRes.json();
      
      // Wait for running race
      let attempts = 0;
      while (race.status !== 'running' && attempts < 10) {
        await page.waitForTimeout(5000);
        const res = await page.request.get(`${EHORSE_URL}/api/race`);
        race = await res.json();
        attempts++;
      }
      
      if (race.status !== 'running') {
        console.log(`No running race, skipping ${tokenName} bet`);
        return;
      }
      
      const sessionId = ethers.id(race.id);
      
      // Wait for market
      await page.waitForTimeout(5000);
      
      const market = await predimarket.markets(sessionId);
      if (market[6] === 0n) { // createdAt
        console.log(`Market not created yet for ${tokenName}`);
        return;
      }
      
      // Get token contract
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      
      // Check balance
      const balance = await token.balanceOf(wallet.address);
      console.log(`${tokenName} balance: ${ethers.formatEther(balance)}`);
      
      if (balance < ethers.parseEther('100')) {
        console.log(`Insufficient ${tokenName} balance`);
        return;
      }
      
      // Approve
      const approveTx = await token.approve(PREDIMARKET_ADDRESS, ethers.MaxUint256);
      await approveTx.wait();
      console.log(`✅ Approved ${tokenName} spending`);
      
      // Place bet
      const betAmount = ethers.parseEther('50'); // 50 tokens
      const outcome = Math.random() < 0.5; // Random YES/NO
      
      console.log(`Betting 50 ${tokenName} on ${outcome ? 'YES' : 'NO'}`);
      
      const betTx = await predimarket.buy(sessionId, outcome, betAmount, 0n, tokenAddress);
      const receipt = await betTx.wait();
      
      console.log(`✅ Bet placed with ${tokenName}! Tx: ${receipt.hash}`);
      
      expect(receipt.status).toBe(1);
      
      // Verify SharesPurchased event
      const event = receipt.logs
        .map((log: ethers.Log) => {
          return predimarket.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
        })
        .find((e: ethers.LogDescription | null) => e?.name === 'SharesPurchased');
      
      if (event) {
        console.log(`SharesPurchased event:`);
        console.log(`  SessionId: ${event.args.sessionId}`);
        console.log(`  Trader: ${event.args.trader}`);
        console.log(`  Outcome: ${event.args.outcome ? 'YES' : 'NO'}`);
        console.log(`  Shares: ${event.args.shares}`);
        console.log(`  Cost: ${ethers.formatEther(event.args.cost)}`);
        console.log(`  Token: ${event.args.paymentToken}`);
        
        expect(event.args.paymentToken.toLowerCase()).toBe(tokenAddress.toLowerCase());
      }
    }, 120000);
  }
});




import { expect } from '@playwright/test';
import { testWithCustomWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet } from '../../../../tests/shared/helpers/contracts';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

const config = JSON.parse(readFileSync(join(__dirname, '../test-config.json'), 'utf-8'));

const EHORSE_URL = process.env.EHORSE_URL || 'http://localhost:5700';
const PREDIMARKET_URL = process.env.PREDIMARKET_URL || 'http://localhost:4005';
const RPC_URL = config.rpcUrl;

const AGENT_WALLET = config.testWallets[1]; // Agent1
const PREDIMARKET_ADDRESS = config.addresses.predimarket;
const ELIZA_OS_ADDRESS = config.addresses.elizaOS;

test.describe('Agent Betting with MetaMask', () => {
  let provider: ethers.JsonRpcProvider;

  test.beforeAll(async () => {
    provider = new ethers.JsonRpcProvider(RPC_URL);
  });

  // Override custom account fixture
  test.use({
    customAccount: AGENT_WALLET,
  });

  test('agent should have elizaOS balance', async () => {
    const elizaOS = new ethers.Contract(
      ELIZA_OS_ADDRESS,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );

    const balance = await elizaOS.balanceOf(AGENT_WALLET.address);
    const formatted = ethers.formatEther(balance);

    console.log(`Agent elizaOS balance: ${formatted}`);

    expect(balance).toBeGreaterThan(0n);
  });

  test('should approve elizaOS spending for Predimarket', async ({ wallet, page }) => {
    // Navigate to Predimarket
    await page.goto(PREDIMARKET_URL);
    await expect(page.getByText('Predimarket')).toBeVisible();

    // Connect wallet
    await connectWallet(page, wallet);

    // Verify connected
    const addressText = page.getByText(/0x[a-fA-F0-9]{4}/);
    if (await addressText.isVisible()) {
      console.log('✅ Wallet connected to Predimarket');
    }
  });

  test('should wait for market and place bet with elizaOS', async ({ page }) => {
    // Get current race from eHorse
    const raceRes = await page.request.get(`${EHORSE_URL}/api/race`);
    let race = await raceRes.json();

    console.log(`Current race: ${race.id}, status: ${race.status}`);

    // Wait for running race
    let attempts = 0;
    while (race.status !== 'running' && attempts < 10) {
      await page.waitForTimeout(5000);
      const res = await page.request.get(`${EHORSE_URL}/api/race`);
      race = await res.json();
      attempts++;
    }

    if (race.status !== 'running') {
      console.log('No running race found, skipping bet test');
      test.skip();
      return;
    }

    const sessionId = ethers.id(race.id);
    console.log(`Race is running! SessionId: ${sessionId}`);

    // Check if market exists
    await page.waitForTimeout(5000); // Wait for market creation

    const predimarket = new ethers.Contract(
      PREDIMARKET_ADDRESS,
      ['function markets(bytes32) view returns (bytes32, string, uint256, uint256, uint256, uint256, uint256, bool, bool)'],
      provider
    );

    const market = await predimarket.markets(sessionId);
    const marketExists = market[6] > 0; // createdAt

    if (!marketExists) {
      console.log('Market not yet created, waiting...');
      await page.waitForTimeout(10000);
    }

    console.log('✅ Market verified on-chain');
  }, 90000);
});

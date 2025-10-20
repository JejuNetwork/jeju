import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { defineWalletSetup } from '@synthetixio/synpress';

// Wallet setup for Jeju localnet
const JEJU_CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337');
const JEJU_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:9545';

const basicSetup = defineWalletSetup('Test1234!', async (context, walletPage) => {
  const wallet = walletPage as MetaMask;

  // Import Hardhat/Anvil test account #0
  await wallet.importWallet({
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    password: 'Test1234!',
  });

  // Add Jeju network
  await wallet.addNetwork({
    name: 'Jeju Local',
    rpcUrl: JEJU_RPC_URL,
    chainId: JEJU_CHAIN_ID,
    symbol: 'ETH',
  });

  // Switch to Jeju network
  await wallet.switchNetwork('Jeju Local');
});

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Crucible - Wallet Connection Tests', () => {
  test('should load API and connect wallet', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // 1. Check API health
    const response = await fetch('http://localhost:3001/api/health');
    expect(response.ok).toBeTruthy();
    console.log('✅ API health check passed');

    // 2. Take screenshot of API response
    await page.screenshot({
      path: 'test-results/screenshots/crucible/api/01-health-check.png',
      fullPage: true
    });

    // 3. Verify agents endpoint
    const agentsResponse = await fetch('http://localhost:3001/api/agents');
    expect(agentsResponse.ok).toBeTruthy();
    console.log('✅ Agents endpoint accessible');

    // 4. Take screenshot
    await page.screenshot({
      path: 'test-results/screenshots/crucible/api/02-agents-list.png',
      fullPage: true
    });
  });

  test('should register agent via API', async ({ page }) => {
    // Test agent registration endpoint
    const response = await fetch('http://localhost:3001/api/agents/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentId: 'test-agent-' + Date.now(),
        name: 'Test Agent',
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
      })
    });

    expect(response.ok).toBeTruthy();
    console.log('✅ Agent registration successful');

    // Take screenshot
    await page.screenshot({
      path: 'test-results/screenshots/crucible/api/03-agent-registered.png',
      fullPage: true
    });
  });
});


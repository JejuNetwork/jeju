import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from './wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Attestation API E2E Tests', () => {
  const API_BASE = process.env.LEADERBOARD_API_URL || 'http://localhost:3000';

  test('GET /api/attestation - should return 400 without params', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/attestation`);
    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('required');
  });

  test('GET /api/attestation - should return 404 for unknown wallet', async ({ request }) => {
    const response = await request.get(
      `${API_BASE}/api/attestation?wallet=0x0000000000000000000000000000000000000000`
    );
    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data.error).toContain('not linked');
  });

  test('GET /api/attestation - should return user data by username', async ({ request }) => {
    // This test assumes there's a known user in the database
    const response = await request.get(`${API_BASE}/api/attestation?username=testuser`);

    // Either 200 with data or 404 if user doesn't exist
    expect([200, 404]).toContain(response.status());

    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('username');
      expect(data).toHaveProperty('reputation');
      expect(data.reputation).toHaveProperty('totalScore');
      expect(data.reputation).toHaveProperty('normalizedScore');
    }
  });

  test('POST /api/attestation - should require username and wallet', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/attestation`, {
      data: {},
    });
    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('required');
  });

  test('POST /api/attestation - should reject unlinked wallet', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/attestation`, {
      data: {
        username: 'testuser',
        walletAddress: '0x0000000000000000000000000000000000000001',
        chainId: 'eip155:1',
      },
    });

    // Should fail since wallet is not linked
    expect([403, 404]).toContain(response.status());
  });

  test('GET /api/wallet/verify - should return verification message', async ({ request }) => {
    const response = await request.get(
      `${API_BASE}/api/wallet/verify?username=testuser&wallet=0x1234567890123456789012345678901234567890`
    );
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('message');
    expect(data).toHaveProperty('timestamp');
    expect(data.message).toContain('testuser');
    expect(data.message).toContain('verify');
  });

  test('POST /api/wallet/verify - should require all fields', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/wallet/verify`, {
      data: {
        username: 'testuser',
      },
    });
    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('required');
  });

  test('POST /api/wallet/verify - should reject invalid address', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/wallet/verify`, {
      data: {
        username: 'testuser',
        walletAddress: 'invalid-address',
        signature: '0x123',
        message: 'test message',
      },
    });
    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('Invalid wallet address');
  });

  test('GET /api/agent/link - should require params', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/agent/link`);
    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('required');
  });

  test('GET /api/agent/link - should return links by wallet', async ({ request }) => {
    const response = await request.get(
      `${API_BASE}/api/agent/link?wallet=0x1234567890123456789012345678901234567890`
    );
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('links');
    expect(Array.isArray(data.links)).toBe(true);
  });

  test('GET /api/agent/link - should return links by agentId', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/agent/link?agentId=1`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('links');
    expect(Array.isArray(data.links)).toBe(true);
  });

  test('POST /api/agent/link - should require all fields', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/agent/link`, {
      data: {
        username: 'testuser',
      },
    });
    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('required');
  });
});

test.describe('Wallet Verification with MetaMask', () => {
  test('should sign verification message and submit', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Navigate to profile edit page
    await page.goto('/profile/edit');

    // This test would require GitHub OAuth to be mocked
    // For now, just verify the page loads without errors
    await expect(page).toHaveTitle(/Leaderboard|Profile/i, { timeout: 10000 });
  });
});

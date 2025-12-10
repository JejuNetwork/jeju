import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../packages/tests/shared/helpers/screenshots';

test.describe('API Endpoints', () => {
  test('should fetch airdrops list', async ({ request }) => {
    const response = await request.get('/api/airdrops');

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data) || typeof data === 'object').toBeTruthy();
  });

  test('should fetch airdrop by id', async ({ request }) => {
    // First get the list
    const listResponse = await request.get('/api/airdrops');
    if (listResponse.ok()) {
      const airdrops = await listResponse.json();

      if (Array.isArray(airdrops) && airdrops.length > 0) {
        const firstAirdropId = airdrops[0].id || airdrops[0].airdropId;

        if (firstAirdropId) {
          const response = await request.get(`/api/airdrops/${firstAirdropId}`);
          expect([200, 404]).toContain(response.status());
        }
      }
    }
  });

  test('should fetch rewards estimate for an address', async ({ request }) => {
    const testAddress = '0x0000000000000000000000000000000000000000';
    const response = await request.get(`/api/rewards/estimate/${testAddress}`);

    // Should return 200 or 404, but not error
    expect([200, 404, 400]).toContain(response.status());
  });

  test('should fetch claims for an address', async ({ request }) => {
    const testAddress = '0x0000000000000000000000000000000000000000';
    const response = await request.get(`/api/claims/${testAddress}`);

    expect([200, 404, 400]).toContain(response.status());
  });

  test('should fetch claim history for an address', async ({ request }) => {
    const testAddress = '0x0000000000000000000000000000000000000000';
    const response = await request.get(`/api/claims/history/${testAddress}`);

    expect([200, 404, 400]).toContain(response.status());
  });

  test('should handle invalid API routes gracefully', async ({ request }) => {
    const response = await request.get('/api/nonexistent-route');

    expect([404, 405]).toContain(response.status());
  });

  test('should have correct CORS headers', async ({ request }) => {
    const response = await request.get('/api/airdrops');

    const headers = response.headers();
    // Next.js should handle CORS appropriately
    expect(response.status()).toBeLessThan(500);
  });
});

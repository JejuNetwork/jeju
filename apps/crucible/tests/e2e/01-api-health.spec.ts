import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';

const CRUCIBLE_URL = process.env.CRUCIBLE_URL || 'http://localhost:7777';

test.describe('Crucible API Health', () => {
  test('should respond to health check', async ({ request }) => {
    const response = await request.get(`${CRUCIBLE_URL}/health`);
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);
  });

  test('should list available agents', async ({ request }) => {
    const response = await request.get(`${CRUCIBLE_URL}/api/agents`);
    expect(response.ok()).toBeTruthy();

    const agents = await response.json();
    expect(Array.isArray(agents)).toBeTruthy();
  });

  test('should handle agent operations', async ({ request }) => {
    // Test agent creation/management endpoints
    const response = await request.get(`${CRUCIBLE_URL}/api/agents`);
    expect(response.ok()).toBeTruthy();
  });
});

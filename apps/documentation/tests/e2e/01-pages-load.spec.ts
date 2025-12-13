import { test, expect } from '@playwright/test';

// Helper to wait for VitePress to fully render
async function waitForVitePress(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('.VPContent, main', { state: 'visible', timeout: 10000 });
}

test.describe('Documentation Site - Core Pages', () => {
  test('homepage loads with content', async ({ page }) => {
    await page.goto('/');
    await waitForVitePress(page);
    await expect(page.locator('.VPContent, main').first()).toBeVisible();
  });

  test('homepage has navigation', async ({ page }) => {
    await page.goto('/');
    await waitForVitePress(page);
    await expect(page.locator('nav, .VPNav').first()).toBeVisible();
  });

  test('homepage has search', async ({ page }) => {
    await page.goto('/');
    await waitForVitePress(page);
    // VitePress default search button
    const searchButton = page.locator('button').filter({ hasText: /search/i });
    await expect(searchButton.first()).toBeVisible();
  });
});

test.describe('Documentation Site - Getting Started', () => {
  test('quick start page loads', async ({ page }) => {
    await page.goto('/getting-started/quick-start');
    await waitForVitePress(page);
    // Check title contains Quick Start (VitePress adds a pilcrow character for anchor links)
    await expect(page).toHaveTitle(/Quick Start/);
  });

  test('quick start has code blocks', async ({ page }) => {
    await page.goto('/getting-started/quick-start');
    await waitForVitePress(page);
    await expect(page.locator('pre, code, .vp-code, [class*="language-"]').first()).toBeVisible();
  });

  test('networks page loads', async ({ page }) => {
    await page.goto('/getting-started/networks');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Networks/);
  });

  test('configuration page loads', async ({ page }) => {
    await page.goto('/getting-started/configuration');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Configuration/);
  });

  test('test accounts page loads', async ({ page }) => {
    await page.goto('/getting-started/test-accounts');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Test Accounts/);
  });
});

test.describe('Documentation Site - Contracts', () => {
  test('contracts overview loads', async ({ page }) => {
    await page.goto('/contracts/overview');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Smart Contracts/);
  });

  test('tokens page loads', async ({ page }) => {
    await page.goto('/contracts/tokens');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Token/);
  });

  test('identity page loads', async ({ page }) => {
    await page.goto('/contracts/identity');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Identity/);
  });

  test('payments page loads', async ({ page }) => {
    await page.goto('/contracts/payments');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Payment/);
  });

  test('oif page loads', async ({ page }) => {
    await page.goto('/contracts/oif');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Open Intents|OIF/);
  });
});

test.describe('Documentation Site - Applications', () => {
  test('applications overview loads', async ({ page }) => {
    await page.goto('/applications/overview');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Application/);
  });

  test('gateway page loads', async ({ page }) => {
    await page.goto('/applications/gateway');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Gateway/);
  });

  test('bazaar page loads', async ({ page }) => {
    await page.goto('/applications/bazaar');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Bazaar/);
  });

  test('compute page loads', async ({ page }) => {
    await page.goto('/applications/compute');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Compute/);
  });

  test('indexer page loads', async ({ page }) => {
    await page.goto('/applications/indexer');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Indexer/);
  });
});

test.describe('Documentation Site - Deployment', () => {
  test('deployment overview loads', async ({ page }) => {
    await page.goto('/deployment/overview');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Deployment/);
  });

  test('localnet page loads', async ({ page }) => {
    await page.goto('/deployment/localnet');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Localnet/);
  });

  test('testnet page loads', async ({ page }) => {
    await page.goto('/deployment/testnet');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Testnet/);
  });

  test('mainnet page loads', async ({ page }) => {
    await page.goto('/deployment/mainnet');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Mainnet/);
  });
});

test.describe('Documentation Site - API Reference', () => {
  test('rpc page loads', async ({ page }) => {
    await page.goto('/api-reference/rpc');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/RPC/);
  });

  test('graphql page loads', async ({ page }) => {
    await page.goto('/api-reference/graphql');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/GraphQL/);
  });

  test('a2a page loads', async ({ page }) => {
    await page.goto('/api-reference/a2a');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/A2A/);
  });

  test('x402 page loads', async ({ page }) => {
    await page.goto('/api-reference/x402');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/x402/);
  });
});

test.describe('Documentation Site - Guides', () => {
  test('guides overview loads', async ({ page }) => {
    await page.goto('/guides/overview');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Guide/);
  });

  test('become xlp guide loads', async ({ page }) => {
    await page.goto('/guides/become-xlp');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/XLP/);
  });

  test('run rpc node guide loads', async ({ page }) => {
    await page.goto('/guides/run-rpc-node');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/RPC Node/);
  });
});

test.describe('Documentation Site - Reference', () => {
  test('cli reference loads', async ({ page }) => {
    await page.goto('/reference/cli');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/CLI/);
  });

  test('ports reference loads', async ({ page }) => {
    await page.goto('/reference/ports');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Port/);
  });

  test('env vars reference loads', async ({ page }) => {
    await page.goto('/reference/env-vars');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Environment/);
  });

  test('addresses reference loads', async ({ page }) => {
    await page.goto('/reference/addresses');
    await waitForVitePress(page);
    await expect(page).toHaveTitle(/Contract Addresses/);
  });
});

test.describe('Documentation Site - Navigation', () => {
  test('sidebar is visible on content pages', async ({ page }) => {
    await page.goto('/getting-started/quick-start');
    await waitForVitePress(page);
    await expect(page.locator('.VPSidebar, aside, [class*="sidebar"]').first()).toBeVisible();
  });

  test('can navigate via sidebar', async ({ page }) => {
    await page.goto('/getting-started/quick-start');
    await waitForVitePress(page);
    await page.click('text=Networks');
    await waitForVitePress(page);
    await expect(page).toHaveURL(/networks/);
  });
});

test.describe('Documentation Site - Responsive', () => {
  test('mobile viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await waitForVitePress(page);
    await expect(page.locator('.VPContent, main').first()).toBeVisible();
  });

  test('tablet viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await waitForVitePress(page);
    await expect(page.locator('.VPContent, main').first()).toBeVisible();
  });

  test('desktop viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await waitForVitePress(page);
    await expect(page.locator('.VPContent, main').first()).toBeVisible();
  });
});

test.describe('Documentation Site - Content Quality', () => {
  test('code blocks render', async ({ page }) => {
    await page.goto('/getting-started/quick-start');
    await waitForVitePress(page);
    // VitePress uses shiki for syntax highlighting
    const codeBlocks = page.locator('pre, code, .vp-code, [class*="language-"]');
    await expect(codeBlocks.first()).toBeVisible();
  });

  test('tables render', async ({ page }) => {
    await page.goto('/getting-started/networks');
    await waitForVitePress(page);
    await expect(page.locator('table').first()).toBeVisible();
  });

  test('has internal links', async ({ page }) => {
    await page.goto('/');
    await waitForVitePress(page);
    const links = page.locator('a[href^="/"]');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Documentation Site - Error Handling', () => {
  test('handles nonexistent route', async ({ page }) => {
    await page.goto('/nonexistent-page-12345');
    // VitePress returns 200 with 404 content
    await expect(page.locator('body')).toBeVisible();
  });
});

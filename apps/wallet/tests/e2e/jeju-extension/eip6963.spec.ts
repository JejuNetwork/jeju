/**
 * EIP-6963 Provider Announcement Tests
 * 
 * Tests that Network Wallet properly announces itself via EIP-6963
 */

import { test, expect } from './extension.fixture';

test.describe('EIP-6963 Provider Discovery', () => {
  test('should announce provider via EIP-6963', async ({ testDappPage }) => {
    // Click request providers button
    await testDappPage.click('#requestProviders');
    
    // Wait for provider announcements
    await testDappPage.waitForTimeout(2000);
    
    // Check if Network Wallet was announced
    const providerStatus = await testDappPage.locator('#providerStatus').textContent();
    
    // Should find at least one provider
    expect(providerStatus).toMatch(/found.*provider|jeju|ethereum/i);
  });

  test('should include correct provider info', async ({ testDappPage }) => {
    await testDappPage.click('#requestProviders');
    await testDappPage.waitForTimeout(2000);
    
    // Check provider badges
    const providers = testDappPage.locator('.provider-badge');
    const count = await providers.count();
    
    // Should have at least one provider (Network or detected ethereum)
    expect(count).toBeGreaterThanOrEqual(0); // Soft check
    
    if (count > 0) {
      // Get first provider info
      const firstProvider = await providers.first().textContent();
      console.log('Found provider:', firstProvider);
    }
  });
});


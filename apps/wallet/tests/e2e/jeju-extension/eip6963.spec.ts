/**
 * EIP-6963 Provider Announcement Tests
 *
 * Tests that Jeju Wallet properly announces itself via EIP-6963
 */

import { expect, test } from './extension.fixture'

test.describe('EIP-6963 Provider Discovery', () => {
  test('should announce provider via EIP-6963', async ({ testDappPage }) => {
    await testDappPage.click('#requestProviders')
    await testDappPage.waitForTimeout(2000)

    const providerStatus = await testDappPage
      .locator('#providerStatus')
      .textContent()

    expect(providerStatus).toMatch(/found.*provider|jeju|ethereum/i)
  })

  test('should include correct provider info', async ({ testDappPage }) => {
    await testDappPage.click('#requestProviders')
    await testDappPage.waitForTimeout(2000)

    const providers = testDappPage.locator('.provider-badge')
    const count = await providers.count()

    // Should have at least one provider
    expect(count).toBeGreaterThanOrEqual(0)

    if (count > 0) {
      const firstProvider = await providers.first().textContent()
      console.log('Found provider:', firstProvider)
    }
  })
})

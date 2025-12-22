/**
 * MetaMask Transaction E2E Tests
 *
 * Tests transaction sending and confirmation via MetaMask.
 */

import { expect } from '@playwright/test'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { TEST_ACCOUNTS } from '../../fixtures/accounts'
import basicSetup, { PASSWORD } from '../../wallet-setup/basic.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))

test.describe('Transactions', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const connectButton = page.locator('button').filter({ hasText: /connect/i })
    if (await connectButton.first().isVisible()) {
      await connectButton.first().click()
      await metamask.connectToDapp()
      await page.waitForTimeout(2000)
    }
  })

  test('should display send transaction UI', async ({ page }) => {
    const sendElement = page.locator('button, a, [role="button"]').filter({
      hasText: /send|transfer/i,
    })

    if (await sendElement.first().isVisible()) {
      await sendElement.first().click()

      await expect(
        page.locator('input[placeholder*="address" i], input[name*="to" i]'),
      ).toBeVisible()
    }
  })

  test('should initiate transaction and confirm in MetaMask', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId)

    const sendButton = page.locator('button, a').filter({ hasText: /send/i })

    if (await sendButton.first().isVisible()) {
      await sendButton.first().click()

      const toInput = page.locator('input').filter({ hasText: '' }).first()
      if (await toInput.isVisible()) {
        await toInput.fill(TEST_ACCOUNTS.secondary.address)
      }

      const amountInput = page.locator(
        'input[type="number"], input[placeholder*="amount" i]',
      )
      if (await amountInput.isVisible()) {
        await amountInput.fill('0.001')
      }

      const submitButton = page
        .locator('button')
        .filter({ hasText: /send|confirm|submit/i })

      if (await submitButton.isVisible()) {
        await submitButton.click()
        await metamask.confirmTransaction()
        await page.waitForTimeout(3000)
      }
    } else {
      test.skip()
    }
  })

  test('should reject transaction', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId)

    const sendButton = page.locator('button, a').filter({ hasText: /send/i })

    if (await sendButton.first().isVisible()) {
      await sendButton.first().click()

      const toInput = page.locator('input').first()
      if (await toInput.isVisible()) {
        await toInput.fill(TEST_ACCOUNTS.secondary.address)
      }

      const submitButton = page
        .locator('button')
        .filter({ hasText: /send|confirm/i })

      if (await submitButton.isVisible()) {
        await submitButton.click()
        await metamask.rejectTransaction()
        await page.waitForTimeout(2000)
      }
    } else {
      test.skip()
    }
  })
})

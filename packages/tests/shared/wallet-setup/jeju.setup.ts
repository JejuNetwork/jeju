/**
 * Unified Wallet Setup for All Jeju Apps
 *
 * This is the CANONICAL wallet setup that all apps should use.
 * It imports configuration from the shared synpress.config.base.ts
 * to ensure consistency across all E2E tests.
 *
 * Usage in app's wallet-setup/basic.setup.ts:
 * ```typescript
 * export { basicSetup as default, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests';
 * ```
 *
 * Or import in app synpress.config.ts:
 * ```typescript
 * import { createSynpressConfig, createWalletSetup, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests';
 * export default createSynpressConfig({ appName: 'myapp', port: 3000 });
 * export const basicSetup = createWalletSetup();
 * export { PASSWORD, SEED_PHRASE };
 * ```
 *
 * CLI commands:
 * ```bash
 * # Build wallet cache (do this once)
 * jeju test e2e --build-cache
 *
 * # Run e2e tests for an app
 * jeju test e2e --app myapp
 *
 * # Run all e2e tests
 * jeju test e2e
 * ```
 */

import { defineWalletSetup } from '@synthetixio/synpress'
import { PASSWORD, SEED_PHRASE } from '../utils'

/**
 * Default wallet setup for Jeju testing.
 *
 * This setup:
 * 1. Imports the standard test wallet using Anvil's default seed phrase
 * 2. Completes the MetaMask onboarding flow
 *
 * The test wallet address will be: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 */
export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  async function clickFirstButtonByNames(names: RegExp[]): Promise<boolean> {
    for (const name of names) {
      const locator = walletPage.getByRole('button', { name })
      const count = await locator.count()
      if (count > 0) {
        await locator.first().click()
        return true
      }
    }
    return false
  }

  async function fillSeedPhrase(): Promise<void> {
    const textarea = walletPage.locator('textarea')
    if ((await textarea.count()) > 0) {
      await textarea.first().click()
      await walletPage.keyboard.type(SEED_PHRASE, { delay: 10 })
      return
    }

    const input = walletPage.getByPlaceholder(
      'Add a space between each word and make sure no one is watching.',
    )
    if ((await input.count()) > 0) {
      await input.first().click()
      await walletPage.keyboard.type(SEED_PHRASE, { delay: 10 })
      return
    }

    throw new Error('Seed phrase input not found in MetaMask onboarding')
  }

  console.log('[Jeju Wallet Setup] Importing wallet...')
  await walletPage.waitForLoadState('domcontentloaded')
  await walletPage.waitForTimeout(1500)

  await clickFirstButtonByNames([/get started/i, /get start/i])
  await clickFirstButtonByNames([/i agree/i, /agree/i])
  console.log('[Jeju Wallet Setup] Start screen complete')

  const importButtons = [
    /import.*wallet/i,
    /import.*existing/i,
    /i have an existing wallet/i,
  ]
  const importClicked = await clickFirstButtonByNames(importButtons)
  if (!importClicked) {
    throw new Error('Import wallet button not found in MetaMask onboarding')
  }
  console.log('[Jeju Wallet Setup] Import wallet flow selected')

  await clickFirstButtonByNames([
    /secret recovery phrase/i,
    /import using secret recovery phrase/i,
    /use secret recovery phrase/i,
  ])
  console.log('[Jeju Wallet Setup] Secret recovery phrase screen')

  await fillSeedPhrase()
  await clickFirstButtonByNames([/continue/i, /next/i])
  console.log('[Jeju Wallet Setup] Seed phrase submitted')

  const passwordInputs = walletPage.locator('input[type="password"]')
  if ((await passwordInputs.count()) >= 2) {
    await passwordInputs.nth(0).fill(PASSWORD)
    await passwordInputs.nth(1).fill(PASSWORD)
  } else {
    throw new Error('Password inputs not found in MetaMask onboarding')
  }
  console.log('[Jeju Wallet Setup] Passwords entered')

  const termsCheckbox = walletPage.locator('input[type="checkbox"]')
  if ((await termsCheckbox.count()) > 0) {
    await termsCheckbox.first().click()
  }

  await clickFirstButtonByNames([
    /create password/i,
    /import/i,
    /continue/i,
  ])
  console.log('[Jeju Wallet Setup] Password created')

  await clickFirstButtonByNames([/done/i, /got it/i, /continue/i])
  console.log('[Jeju Wallet Setup] Post-setup screens handled')

  const openWalletButton = walletPage.getByRole('button', {
    name: /open wallet/i,
  })
  if ((await openWalletButton.count()) > 0) {
    const isEnabled = await openWalletButton.isEnabled()
    if (isEnabled) {
      await openWalletButton.click()
    }
  }
  console.log('[Jeju Wallet Setup] Wallet ready')

  console.log('[Jeju Wallet Setup] Complete')
})

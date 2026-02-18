/**
 * DWS Wallet Setup
 *
 * Re-exports the canonical wallet setup from @jejunetwork/tests
 * This ensures the cache hash matches between cache build and test run.
 */

import { defineWalletSetup } from '@synthetixio/synpress'
import { PASSWORD, SEED_PHRASE } from '@jejunetwork/tests/playwright-only'

// Official MetaMask data-testid selectors used by synpress-metamask
const sel = (id: string) => `[data-testid="${id}"]`

export default defineWalletSetup(PASSWORD, async (_context, walletPage) => {
  const seedPhraseWords = SEED_PHRASE.split(' ')
  const seedPhraseLength = seedPhraseWords.length

  console.log('[DWS Wallet Setup] Starting import...')
  await walletPage.waitForLoadState('domcontentloaded')
  await walletPage.waitForTimeout(2000)

  // Step 1: Accept terms and click import
  console.log('[DWS Wallet Setup] Accepting terms...')
  await walletPage.locator(sel('onboarding-terms-checkbox')).click()
  await walletPage.locator(sel('onboarding-import-wallet')).click()

  // Step 2: Opt out of analytics
  console.log('[DWS Wallet Setup] Opting out of analytics...')
  await walletPage.locator(sel('metametrics-no-thanks')).click()

  // Step 3: Enter seed phrase word by word
  console.log('[DWS Wallet Setup] Entering seed phrase...')

  // Select the correct number of words
  const dropdown = walletPage.locator(
    '.import-srp__number-of-words-dropdown > .dropdown__select',
  )
  await dropdown.selectOption(String(seedPhraseLength))

  // Fill in each word
  for (let i = 0; i < seedPhraseWords.length; i++) {
    const word = seedPhraseWords[i]
    if (word) {
      await walletPage.locator(sel(`import-srp__srp-word-${i}`)).fill(word)
    }
  }

  // Confirm seed phrase
  await walletPage.locator(sel('import-srp-confirm')).click()
  console.log('[DWS Wallet Setup] Seed phrase confirmed')

  // Step 4: Create password
  console.log('[DWS Wallet Setup] Creating password...')
  await walletPage.locator(sel('create-password-new')).fill(PASSWORD)
  await walletPage.locator(sel('create-password-confirm')).fill(PASSWORD)
  await walletPage.locator(sel('create-password-terms')).click()
  await walletPage.locator(sel('create-password-import')).click()

  // Step 5: Complete onboarding
  console.log('[DWS Wallet Setup] Completing onboarding...')
  await walletPage.locator(sel('onboarding-complete-done')).click()
  await walletPage.locator(sel('pin-extension-next')).click()
  await walletPage.locator(sel('pin-extension-done')).click()

  // Step 6: Close any popovers
  console.log('[DWS Wallet Setup] Closing popovers...')

  // Close network info popup if present
  const networkInfoClose = walletPage.locator(sel('popover-close'))
  if ((await networkInfoClose.count()) > 0) {
    await networkInfoClose.click().catch(() => {})
  }

  // Close any generic popovers
  const popoverClose = walletPage.locator('.popover-header__button')
  if ((await popoverClose.count()) > 0) {
    await popoverClose.first().click().catch(() => {})
  }

  // Close "What's New" popover if present
  const whatsNewClose = walletPage.locator(sel('popover-close'))
  if ((await whatsNewClose.count()) > 0) {
    await whatsNewClose.click().catch(() => {})
  }

  // Verify wallet imported successfully
  console.log('[DWS Wallet Setup] Verifying import...')
  const accountAddress = await walletPage
    .locator(sel('account-options-menu-button'))
    .textContent()
  if (!accountAddress?.startsWith('0x')) {
    console.log('[DWS Wallet Setup] Warning: Could not verify wallet address')
  }

  console.log('[DWS Wallet Setup] Complete')
})

export { PASSWORD, SEED_PHRASE }

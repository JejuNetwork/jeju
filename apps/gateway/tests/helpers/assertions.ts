/**
 * @fileoverview Custom test assertions and helpers
 * @module gateway/tests/helpers/assertions
 */

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Assert that a token is displayed with all required information
 */
export async function assertTokenDisplay(page: Page, symbol: string) {
  await expect(page.getByText(symbol)).toBeVisible();
}

/**
 * Assert that all protocol tokens are displayed
 */
export async function assertAllProtocolTokens(page: Page) {
  await assertTokenDisplay(page, 'elizaOS');
  await assertTokenDisplay(page, 'CLANKER');
  await assertTokenDisplay(page, 'VIRTUAL');
  await assertTokenDisplay(page, 'CLANKERMON');
}

/**
 * Assert success message is shown
 */
export async function assertSuccessMessage(page: Page, message: string) {
  const successBox = page.locator('[style*="background: #dcfce7"], [style*="background: #d1fae5"]');
  await expect(successBox.getByText(message, { exact: false })).toBeVisible();
}

/**
 * Assert error message is shown
 */
export async function assertErrorMessage(page: Page, message: string) {
  const errorBox = page.locator('[style*="background: #fee2e2"]');
  await expect(errorBox.getByText(message, { exact: false })).toBeVisible();
}

/**
 * Assert warning message is shown
 */
export async function assertWarningMessage(page: Page, message: string) {
  const warningBox = page.locator('[style*="background: #fef3c7"]');
  await expect(warningBox.getByText(message, { exact: false })).toBeVisible();
}

/**
 * Assert info message is shown
 */
export async function assertInfoMessage(page: Page, message: string) {
  const infoBox = page.locator('[style*="background: #dbeafe"], [style*="background: #eff6ff"]');
  await expect(infoBox.getByText(message, { exact: false })).toBeVisible();
}

/**
 * Wait for transaction to complete
 */
export async function waitForTransaction(page: Page, timeout: number = 30000) {
  // Wait for loading state to disappear
  await page.waitForFunction(
    () => !document.body.textContent?.includes('...'),
    { timeout }
  );
}

/**
 * Select token from dropdown
 */
export async function selectToken(page: Page, symbol: string, selectorIndex: number = 0) {
  const selectors = page.locator('.input');
  await selectors.nth(selectorIndex).click();
  await page.getByText(symbol).first().click();
}

/**
 * Assert card is displayed with title
 */
export async function assertCardVisible(page: Page, title: string) {
  const card = page.locator('.card').filter({ hasText: title });
  await expect(card).toBeVisible();
}

/**
 * Assert button is in correct state
 */
export async function assertButtonState(
  page: Page, 
  name: string, 
  state: 'enabled' | 'disabled' | 'loading'
) {
  const button = page.getByRole('button', { name: new RegExp(name, 'i') });
  
  if (state === 'enabled') {
    await expect(button).toBeEnabled();
  } else if (state === 'disabled') {
    await expect(button).toBeDisabled();
  } else if (state === 'loading') {
    await expect(button).toContainText(/\.\.\./);
  }
}

/**
 * Assert USD value is displayed
 */
export async function assertUSDValue(page: Page) {
  await expect(page.getByText(/\$[\d,]+\.?\d*/)).toBeVisible();
}

/**
 * Navigate to tab
 */
export async function navigateToTab(page: Page, tabName: string) {
  await page.getByRole('button', { name: new RegExp(tabName, 'i') }).click();
  await page.waitForTimeout(500); // Wait for tab transition
}


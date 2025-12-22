/**
 * Transaction Helpers for Gateway Synpress Tests
 *
 * Utilities for handling blockchain transactions with MetaMask.
 */

import type { Page } from '@playwright/test'
import type { MetaMask } from '@synthetixio/synpress/playwright'

/**
 * Execute any transaction and wait for confirmation
 */
export async function executeTransaction(
  page: Page,
  metamask: MetaMask,
  options: {
    expectSuccessMessage?: string
    timeout?: number
  } = {},
): Promise<void> {
  const timeout = options.timeout || 60000

  await page.waitForTimeout(2000)
  await metamask.confirmTransaction()

  if (options.expectSuccessMessage) {
    await page.waitForSelector(`text=/${options.expectSuccessMessage}/i`, {
      timeout,
    })
  }
}

/**
 * Execute two-step transaction (approve then main transaction)
 */
export async function executeTwoStepTransaction(
  page: Page,
  metamask: MetaMask,
  options: {
    approvalMessage?: string
    successMessage?: string
    timeout?: number
  } = {},
): Promise<void> {
  const timeout = options.timeout || 90000

  // Step 1: Approval
  await page.waitForTimeout(2000)
  await metamask.confirmTransaction()

  if (options.approvalMessage) {
    await page.waitForSelector(`text=/${options.approvalMessage}/i`, {
      timeout: 30000,
    })
  }

  // Step 2: Main transaction
  await page.waitForTimeout(3000)
  await metamask.confirmTransaction()

  if (options.successMessage) {
    await page.waitForSelector(`text=/${options.successMessage}/i`, { timeout })
  }
}

/**
 * Reject transaction in MetaMask
 */
export async function rejectTransaction(metamask: MetaMask): Promise<void> {
  await metamask.rejectTransaction()
}

/**
 * Wait for transaction success message
 */
export async function waitForSuccess(
  page: Page,
  message: string,
  timeout = 30000,
): Promise<void> {
  await page.waitForSelector(`text=/${message}/i`, { timeout })
}

/**
 * Check if transaction is pending
 */
export async function isTransactionPending(page: Page): Promise<boolean> {
  const pendingIndicators = page.locator('text=/pending|confirming|waiting/i')
  const count = await pendingIndicators.count()
  return count > 0
}

/**
 * Wait for all pending transactions to complete
 */
export async function waitForAllTransactions(
  page: Page,
  timeout = 60000,
): Promise<void> {
  const startTime = Date.now()

  while (await isTransactionPending(page)) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for transactions to complete')
    }
    await page.waitForTimeout(1000)
  }
}

/**
 * Verify transaction success on blockchain
 */
export async function verifyTransactionOnChain(
  page: Page,
  txHash: string,
): Promise<void> {
  const response = await page.request.post('http://127.0.0.1:9545', {
    data: {
      jsonrpc: '2.0',
      method: 'eth_getTransactionReceipt',
      params: [txHash],
      id: 1,
    },
  })

  const result = await response.json()

  if (!result.result || result.result.status !== '0x1') {
    throw new Error(`Transaction ${txHash} failed on blockchain`)
  }
}

/**
 * Get current block number
 */
export async function getCurrentBlockNumber(page: Page): Promise<number> {
  const response = await page.request.post('http://127.0.0.1:9545', {
    data: {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    },
  })

  const result = await response.json()
  return parseInt(result.result, 16)
}

/**
 * Extract transaction hash from success message
 */
export async function extractTxHash(page: Page): Promise<string | null> {
  const txElement = page.locator('text=/0x[a-fA-F0-9]{64}/')
  const count = await txElement.count()

  if (count === 0) return null

  const text = await txElement.first().textContent()
  const match = text?.match(/(0x[a-fA-F0-9]{64})/)

  return match ? match[1] : null
}

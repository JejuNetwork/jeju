/**
 * Transaction Helpers for Synpress Tests
 * Utilities for handling blockchain transactions with MetaMask
 */

import type { Page } from '@playwright/test'
import type { MetaMask } from '@synthetixio/synpress/playwright'

/**
 * Approve ERC20 token transaction
 */
export async function approveToken(
  page: Page,
  metamask: MetaMask,
  options: {
    timeout?: number
  } = {},
): Promise<void> {
  const timeout = options.timeout || 30000

  // Wait for MetaMask confirmation popup
  await page.waitForTimeout(2000)

  // Confirm in MetaMask
  await metamask.confirmTransaction()

  // Wait for transaction confirmation on page
  await page.waitForSelector('text=/approved|success|confirmed/i', { timeout })

  console.log('✅ Token approval confirmed')
}

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

  // Wait for MetaMask popup
  await page.waitForTimeout(2000)

  // Confirm transaction
  await metamask.confirmTransaction()

  // Wait for success message if specified
  if (options.expectSuccessMessage) {
    await page.waitForSelector(`text=/${options.expectSuccessMessage}/i`, {
      timeout,
    })
  }

  console.log('✅ Transaction confirmed')
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

  console.log('✅ Approval confirmed')

  // Step 2: Main transaction
  await page.waitForTimeout(3000)
  await metamask.confirmTransaction()

  if (options.successMessage) {
    await page.waitForSelector(`text=/${options.successMessage}/i`, { timeout })
  }

  console.log('✅ Main transaction confirmed')
}

/**
 * Reject transaction in MetaMask
 */
export async function rejectTransaction(
  page: Page,
  metamask: MetaMask,
): Promise<void> {
  await page.waitForTimeout(2000)
  await metamask.rejectTransaction()
  console.log('❌ Transaction rejected')
}

/**
 * Wait for transaction success message
 */
export async function waitForSuccess(
  page: Page,
  message: string,
  timeout: number = 30000,
): Promise<void> {
  await page.waitForSelector(`text=/${message}/i`, { timeout })
}

/**
 * Wait for balance update after transaction
 */
export async function waitForBalanceUpdate(
  page: Page,
  previousBalance: string,
  timeout: number = 15000,
): Promise<void> {
  // Wait for balance to change
  await page.waitForFunction(
    (prev) => {
      const balanceElements = document.querySelectorAll(
        '[data-balance], text=/Balance/i',
      )
      for (const el of balanceElements) {
        if (el.textContent && el.textContent !== prev) {
          return true
        }
      }
      return false
    },
    previousBalance,
    { timeout },
  )

  console.log('✅ Balance updated')
}

/**
 * Get gas estimate from MetaMask popup
 */
export async function getGasEstimate(metamaskPage: Page): Promise<string> {
  // Wait for gas display
  await metamaskPage.waitForSelector('text=/Gas/i', { timeout: 10000 })

  const gasText = await metamaskPage.locator('text=/Gas/i').textContent()
  return gasText || ''
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
  timeout: number = 60000,
): Promise<void> {
  const startTime = Date.now()

  while (await isTransactionPending(page)) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for transactions to complete')
    }
    await page.waitForTimeout(1000)
  }

  console.log('✅ All transactions completed')
}

/**
 * Verify transaction success on blockchain
 */
export async function verifyTransactionOnChain(
  page: Page,
  txHash: string,
): Promise<void> {
  // Make RPC call to verify transaction
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

  console.log('✅ Transaction verified on blockchain')
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

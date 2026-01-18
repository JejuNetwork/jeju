/**
 * Wallet Helpers for Gateway Synpress Tests
 */

import type { BrowserContext, Page } from '@playwright/test'
import { MetaMask } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../../synpress.config'

/**
 * Connect wallet to dApp using MetaMask
 */
export async function connectWallet(
  page: Page,
  metamask: MetaMask,
): Promise<void> {
  await page.waitForLoadState('networkidle')

  const connectButton = page.getByRole('button', { name: /sign in/i }).first()
  await connectButton.click()
  await page.waitForTimeout(1000)

  const walletOption = page.getByRole('button', { name: /connect wallet/i })
  if (await walletOption.isVisible().catch(() => false)) {
    await walletOption.click()
  }

  await metamask.connectToDapp()
  await page.waitForSelector('button:has-text(/0x/)', { timeout: 15000 })
}

/**
 * Create MetaMask instance from context
 */
export function createMetaMask(
  context: BrowserContext,
  metamaskPage: Page,
  extensionId: string,
): MetaMask {
  return new MetaMask(
    context,
    metamaskPage,
    basicSetup.walletPassword,
    extensionId,
  )
}

/**
 * Check if wallet is connected
 */
export async function isWalletConnected(page: Page): Promise<boolean> {
  const walletButton = page.locator('button:has-text(/0x/)')
  return walletButton.isVisible().catch(() => false)
}

/**
 * Wait for wallet to be connected
 */
export async function waitForConnection(
  page: Page,
  timeout = 15000,
): Promise<void> {
  await page.waitForSelector('button:has-text(/0x/)', { timeout })
}

/**
 * Switch to a different network
 */
export async function switchNetwork(
  metamask: MetaMask,
  networkName: string,
): Promise<void> {
  await metamask.switchNetwork(networkName)
  console.log(`✅ Switched to network: ${networkName}`)
}

/**
 * Add and switch to the network Localnet
 */
export async function setupNetworkChain(metamask: MetaMask): Promise<void> {
  await metamask.addNetwork({
    networkName: 'Jeju Localnet',
    rpcUrl: 'http://127.0.0.1:6546',
    chainId: 31337,
    symbol: 'ETH',
  })

  await metamask.switchNetwork('Jeju Localnet')
  console.log('✅ Network Localnet configured')
}

/**
 * Get connected wallet address from UI
 */
export async function getConnectedAddress(page: Page): Promise<string | null> {
  const walletButton = page.locator('button:has-text(/0x/)').first()

  if (await walletButton.isVisible().catch(() => false)) {
    const text = await walletButton.textContent()
    const match = text?.match(/(0x[a-fA-F0-9]{4,})|(0x\.\.\.[a-fA-F0-9]{4})/)
    return match ? match[1] : null
  }

  return null
}

/**
 * Disconnect wallet (if UI supports it)
 */
export async function disconnectWallet(page: Page): Promise<void> {
  const walletButton = page.locator('button:has-text(/0x/)').first()

  if (await walletButton.isVisible().catch(() => false)) {
    await walletButton.click()
    await page.waitForTimeout(500)

    const disconnectOption = page.getByText(/Disconnect/i)
    if (await disconnectOption.isVisible().catch(() => false)) {
      await disconnectOption.click()
      await page.waitForTimeout(1000)
    }
  }
}

/**
 * Reconnect wallet after page reload
 */
export async function reconnectWallet(
  page: Page,
  metamask: MetaMask,
): Promise<void> {
  const alreadyConnected = await isWalletConnected(page)

  if (!alreadyConnected) {
    await connectWallet(page, metamask)
  }
}

/**
 * Get wallet ETH balance from RPC
 */
export async function getWalletBalance(
  page: Page,
  address: string,
): Promise<bigint> {
  const response = await page.request.post('http://127.0.0.1:6546', {
    data: {
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 1,
    },
  })

  const result = await response.json()
  return BigInt(result.result)
}

/**
 * Get token balance from RPC
 */
export async function getTokenBalance(
  page: Page,
  tokenAddress: string,
  walletAddress: string,
): Promise<bigint> {
  const data = `0x70a08231000000000000000000000000${walletAddress.slice(2)}`

  const response = await page.request.post('http://127.0.0.1:6546', {
    data: {
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: tokenAddress, data }, 'latest'],
      id: 1,
    },
  })

  const result = await response.json()
  return BigInt(result.result)
}

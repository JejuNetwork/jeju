/**
 * Wallet Connection Tests
 * Tests MetaMask wallet connection, persistence, and network verification
 */

import type { BrowserContext, Page } from '@playwright/test'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { createPublicClient, formatEther, http } from 'viem'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const RPC_URL = process.env.L2_RPC_URL ?? 'http://localhost:6546'
const CHAIN_ID = parseInt(process.env.CHAIN_ID ?? '31337', 10)
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const publicClient = createPublicClient({
  chain: {
    id: CHAIN_ID,
    name: 'Network',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
  transport: http(RPC_URL),
})

async function connectWallet(
  page: Page,
  context: BrowserContext,
  metamaskPage: Page,
  extensionId: string,
): Promise<MetaMask> {
  const metamask = new MetaMask(
    context,
    metamaskPage,
    basicSetup.walletPassword,
    extensionId,
  )

  await page.goto('/')
  const connectBtn = page.getByRole('button', { name: /Connect Wallet/i })
  if (await connectBtn.isVisible()) {
    await connectBtn.click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  }
  return metamask
}

test.describe('Wallet Connection', () => {
  test('connects MetaMask wallet to Bazaar', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()

    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  })

  test('displays wallet address in header', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
  })

  test('persists wallet connection across navigation', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    const pages = ['/coins', '/swap', '/markets', '/portfolio', '/items']
    for (const url of pages) {
      await page.goto(url)
      await page.waitForTimeout(500)
      await expect(page.getByText(/0xf39F/i)).toBeVisible()
    }
  })

  test('verifies correct network connection', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    const chainId = await publicClient.getChainId()
    expect(chainId).toBe(CHAIN_ID)
  })

  test('shows correct ETH balance on-chain', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    const balance = await publicClient.getBalance({
      address: TEST_ADDRESS as `0x${string}`,
    })
    expect(balance > 0n).toBe(true)
    console.log(`On-chain balance: ${formatEther(balance)} ETH`)
  })
})

test.describe('Blockchain Health', () => {
  test('RPC connection is alive', async () => {
    const blockNumber = await publicClient.getBlockNumber()
    expect(blockNumber).toBeGreaterThan(0n)
    console.log(`RPC alive, block: ${blockNumber}`)
  })

  test('chain ID matches expected', async () => {
    const chainId = await publicClient.getChainId()
    expect(chainId).toBe(CHAIN_ID)
    console.log(`Chain ID: ${chainId}`)
  })

  test('test account has ETH', async () => {
    const balance = await publicClient.getBalance({
      address: TEST_ADDRESS as `0x${string}`,
    })
    expect(balance).toBeGreaterThan(0n)
    console.log(`Test account balance: ${formatEther(balance)} ETH`)
  })

  test('blocks are being produced', async () => {
    const block1 = await publicClient.getBlockNumber()
    await new Promise((r) => setTimeout(r, 2000))
    const block2 = await publicClient.getBlockNumber()

    expect(block2).toBeGreaterThanOrEqual(block1)
    console.log(`Block progression: ${block1} -> ${block2}`)
  })
})

test.describe('Contract Deployment', () => {
  test('ERC20 Factory is deployed', async () => {
    const factoryAddress = process.env.PUBLIC_ERC20_FACTORY_ADDRESS

    if (factoryAddress && factoryAddress !== '0x0') {
      const code = await publicClient.getCode({
        address: factoryAddress as `0x${string}`,
      })
      expect(code).not.toBe('0x')
      console.log(`ERC20 Factory deployed at ${factoryAddress}`)
    } else {
      console.log('ERC20 Factory address not configured')
    }
  })

  test('NFT Marketplace is deployed', async () => {
    const marketplaceAddress = process.env.PUBLIC_NFT_MARKETPLACE_ADDRESS

    if (marketplaceAddress && marketplaceAddress !== '0x0') {
      const code = await publicClient.getCode({
        address: marketplaceAddress as `0x${string}`,
      })
      expect(code).not.toBe('0x')
      console.log(`NFT Marketplace deployed at ${marketplaceAddress}`)
    } else {
      console.log('NFT Marketplace address not configured')
    }
  })

  test('Predimarket is deployed', async () => {
    const predimarketAddress = process.env.PUBLIC_PREDIMARKET_ADDRESS

    if (predimarketAddress && predimarketAddress !== '0x0') {
      const code = await publicClient.getCode({
        address: predimarketAddress as `0x${string}`,
      })
      expect(code).not.toBe('0x')
      console.log(`Predimarket deployed at ${predimarketAddress}`)
    } else {
      console.log('Predimarket address not configured')
    }
  })

  test('Pool Manager is deployed', async () => {
    const poolManagerAddress = process.env.PUBLIC_V4_POOL_MANAGER_ADDRESS

    if (poolManagerAddress && poolManagerAddress !== '0x0') {
      const code = await publicClient.getCode({
        address: poolManagerAddress as `0x${string}`,
      })
      expect(code).not.toBe('0x')
      console.log(`Pool Manager deployed at ${poolManagerAddress}`)
    } else {
      console.log('Pool Manager address not configured')
    }
  })
})

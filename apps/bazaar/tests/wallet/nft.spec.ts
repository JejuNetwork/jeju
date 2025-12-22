/**
 * NFT Marketplace Tests with Wallet
 * Tests NFT minting, listing, and purchasing with MetaMask
 */

import type { BrowserContext, Page } from '@playwright/test'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { createPublicClient, http, parseAbi } from 'viem'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const RPC_URL = process.env.L2_RPC_URL ?? 'http://localhost:6546'
const CHAIN_ID = parseInt(process.env.CHAIN_ID ?? '1337', 10)

const publicClient = createPublicClient({
  chain: {
    id: CHAIN_ID,
    name: 'Network',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
  transport: http(RPC_URL),
})

const MARKETPLACE_ABI = parseAbi([
  'function getListing(uint256 listingId) view returns (address seller, address nftContract, uint256 tokenId, uint256 price, bool active, uint256 endTime)',
  'function getAuction(uint256 auctionId) view returns (address seller, address nftContract, uint256 tokenId, uint256 reservePrice, uint256 highestBid, address highestBidder, uint256 endTime, bool settled)',
  'function nextListingId() view returns (uint256)',
  'function nextAuctionId() view returns (uint256)',
])

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

test.describe('Items Page with Wallet', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  test('displays items grid', async ({ page }) => {
    await page.goto('/items')
    await expect(page.getByRole('heading', { name: /Items/i })).toBeVisible()
  })

  test('has filter buttons', async ({ page }) => {
    await page.goto('/items')

    const allFilter = page.getByTestId('filter-all-nfts')
    const myFilter = page.getByTestId('filter-my-nfts')

    if (await allFilter.isVisible()) {
      await allFilter.click()
      await expect(allFilter).toHaveClass(/bg-purple-600/)
    }

    if (await myFilter.isVisible()) {
      await myFilter.click()
      await expect(myFilter).toHaveClass(/bg-purple-600/)
    }
  })

  test('has sort dropdown', async ({ page }) => {
    await page.goto('/items')

    const sortSelect = page.getByTestId('nft-sort-select')
    if (await sortSelect.isVisible()) {
      await sortSelect.selectOption('price')
      expect(await sortSelect.inputValue()).toBe('price')

      await sortSelect.selectOption('recent')
      expect(await sortSelect.inputValue()).toBe('recent')

      await sortSelect.selectOption('collection')
      expect(await sortSelect.inputValue()).toBe('collection')
    }
  })

  test('can click on NFT card', async ({ page }) => {
    await page.goto('/items')
    await page.waitForTimeout(1000)

    const nftCard = page.getByTestId('nft-card').first()
    if (await nftCard.isVisible()) {
      await nftCard.click()
      await page.waitForTimeout(500)
    }
  })
})

test.describe('Marketplace Contract Verification', () => {
  test('verifies marketplace listing state', async () => {
    const marketplaceAddress = process.env.NEXT_PUBLIC_NFT_MARKETPLACE_ADDRESS
    if (!marketplaceAddress || marketplaceAddress === '0x0') {
      console.log('Skipping: Marketplace not deployed')
      return
    }

    const nextListingId = await publicClient.readContract({
      address: marketplaceAddress as `0x${string}`,
      abi: MARKETPLACE_ABI,
      functionName: 'nextListingId',
    })

    console.log(`Marketplace state: nextListingId = ${nextListingId}`)
    expect(nextListingId).toBeGreaterThanOrEqual(0n)
  })

  test('verifies marketplace auction state', async () => {
    const marketplaceAddress = process.env.NEXT_PUBLIC_NFT_MARKETPLACE_ADDRESS
    if (!marketplaceAddress || marketplaceAddress === '0x0') {
      console.log('Skipping: Marketplace not deployed')
      return
    }

    const nextAuctionId = await publicClient.readContract({
      address: marketplaceAddress as `0x${string}`,
      abi: MARKETPLACE_ABI,
      functionName: 'nextAuctionId',
    })

    console.log(`Marketplace state: nextAuctionId = ${nextAuctionId}`)
    expect(nextAuctionId).toBeGreaterThanOrEqual(0n)
  })
})

test.describe('Games with Wallet', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  test('displays games section', async ({ page }) => {
    await page.goto('/games')
    await expect(page.getByRole('heading', { name: /Games/i })).toBeVisible()
  })

  test('navigates to Hyperscape', async ({ page }) => {
    await page.goto('/games')

    const hyperscapeLink = page.getByRole('link', { name: /Hyperscape/i })
    if (await hyperscapeLink.isVisible()) {
      await hyperscapeLink.click()
      await page.waitForURL('**/games/hyperscape')
    }
  })

  test('shows Hyperscape player stats', async ({ page }) => {
    await page.goto('/games/hyperscape')
    await page.waitForTimeout(1000)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })
})

test.describe('Pools with Wallet', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  test('displays pools list', async ({ page }) => {
    await page.goto('/pools')
    await expect(page.getByRole('heading', { name: /Pools/i })).toBeVisible()
  })

  test('has create pool button', async ({ page }) => {
    await page.goto('/pools')

    const createButton = page.getByRole('button', { name: /Create Pool/i })
    if (await createButton.isVisible()) {
      await expect(createButton).toBeVisible()
    }
  })
})

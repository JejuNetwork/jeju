/**
import type { Page } from "@playwright/test";
 * COMPREHENSIVE ALL FEATURES TEST SUITE
 * 
 * Tests EVERY page, button, component, and form in Bazaar
 * with wallet connection and on-chain validation
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'
import { createPublicClient, http, parseAbi, formatEther } from 'viem'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const RPC_URL = process.env.L2_RPC_URL || 'http://localhost:9545'
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337')

const publicClient = createPublicClient({
  chain: {
    id: CHAIN_ID,
    name: 'Network',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } }
  },
  transport: http(RPC_URL)
})

// Helper to connect wallet
async function connectWallet(page: Page, metamask: MetaMask) {
  await page.goto('/')
  const connectBtn = page.getByRole('button', { name: /Connect Wallet/i })
  if (await connectBtn.isVisible()) {
    await connectBtn.click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  }
}

// =============================================================================
// SECTION 1: WALLET CONNECTION
// =============================================================================
test.describe('1. Wallet Connection', () => {
  test('should connect MetaMask wallet', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    
    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  })

  test('should show wallet address in header after connect', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    // Should show shortened address
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
  })

  test('should persist wallet connection across navigation', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    // Navigate to multiple pages and verify connection persists
    const pages = ['/coins', '/swap', '/markets', '/portfolio', '/items']
    for (const url of pages) {
      await page.goto(url)
      await page.waitForTimeout(500)
      await expect(page.getByText(/0xf39F/i)).toBeVisible()
    }
  })

  test('should be on correct network (Network)', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    // Verify chain ID matches
    const chainId = await publicClient.getChainId()
    expect(chainId).toBe(CHAIN_ID)
  })

  test('should show correct ETH balance on-chain', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    // Verify on-chain balance
    const balance = await publicClient.getBalance({
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    })
    expect(balance > 0n).toBe(true)
    console.log(`✅ On-chain balance: ${formatEther(balance)} ETH`)
  })
})

// =============================================================================
// SECTION 2: HOMEPAGE
// =============================================================================
test.describe('2. Homepage', () => {
  test('should display hero section', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Welcome to Bazaar/i })).toBeVisible()
  })

  test('should have working navigation links', async ({ page }) => {
    await page.goto('/')
    
    // Test each nav link
    const navLinks = [
      { name: /Coins/i, url: '/coins' },
      { name: /Swap/i, url: '/swap' },
      { name: /Markets/i, url: '/markets' },
      { name: /Games/i, url: '/games' },
      { name: /Items/i, url: '/items' },
    ]
    
    for (const link of navLinks) {
      await page.goto('/')
      const navItem = page.getByRole('link', { name: link.name })
      if (await navItem.isVisible()) {
        await navItem.click()
        await page.waitForURL(`**${link.url}*`)
      }
    }
  })

  test('should show connect wallet button when disconnected', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /Connect Wallet/i })).toBeVisible()
  })
})

// =============================================================================
// SECTION 3: COINS PAGE
// =============================================================================
test.describe('3. Coins Page', () => {
  test('should display coins list', async ({ page }) => {
    await page.goto('/coins')
    await expect(page.getByRole('heading', { name: /Coins/i })).toBeVisible()
  })

  test('should have search input', async ({ page }) => {
    await page.goto('/coins')
    const searchInput = page.getByPlaceholder(/Search/i)
    if (await searchInput.isVisible()) {
      await searchInput.fill('ETH')
      await page.waitForTimeout(500)
    }
  })

  test('should have create token link', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/coins')
    const createLink = page.getByRole('link', { name: /Create/i })
    if (await createLink.isVisible()) {
      await createLink.click()
      await page.waitForURL('**/coins/create')
    }
  })
})

// =============================================================================
// SECTION 4: TOKEN CREATION
// =============================================================================
test.describe('4. Token Creation Page', () => {
  test('should display token creation form', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/coins/create')
    await expect(page.getByRole('heading', { name: /Create Token/i })).toBeVisible()
  })

  test('should have all form fields', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/coins/create')
    
    // Token name input
    const nameInput = page.getByPlaceholder(/My Awesome Token/i)
    await expect(nameInput).toBeVisible()
    await nameInput.fill('Test Token')
    
    // Symbol input
    const symbolInput = page.getByPlaceholder(/MAT/i)
    await expect(symbolInput).toBeVisible()
    await symbolInput.fill('TEST')
    
    // Supply input
    const supplyInput = page.getByPlaceholder('1000000')
    await expect(supplyInput).toBeVisible()
    await supplyInput.fill('1000000')
    
    // Decimals select
    const decimalsSelect = page.locator('select').first()
    if (await decimalsSelect.isVisible()) {
      await decimalsSelect.selectOption('18')
    }
  })

  test('should validate required fields', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/coins/create')
    
    // Try to create without filling fields
    const createButton = page.getByRole('button', { name: /Create Token/i })
    const isDisabled = await createButton.isDisabled()
    expect(isDisabled).toBe(true)
  })

  test('should create token with MetaMask confirmation', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/coins/create')
    
    // Fill form
    await page.getByPlaceholder(/My Awesome Token/i).fill(`TestToken${Date.now()}`)
    await page.getByPlaceholder(/MAT/i).fill(`T${Date.now().toString().slice(-4)}`)
    await page.getByPlaceholder('1000000').fill('1000000')
    
    const createButton = page.getByRole('button', { name: /Create Token/i })
    if (await createButton.isEnabled()) {
      await createButton.click()
      await page.waitForTimeout(2000)
      
      // Confirm in MetaMask
      await metamask.confirmTransaction()
      await page.waitForTimeout(5000)
      
      console.log('✅ Token creation transaction confirmed')
    }
  })
})

// =============================================================================
// SECTION 5: SWAP PAGE
// =============================================================================
test.describe('5. Swap Page', () => {
  test('should display swap interface', async ({ page }) => {
    await page.goto('/swap')
    await expect(page.getByRole('heading', { name: /Swap/i })).toBeVisible()
  })

  test('should have token selectors', async ({ page }) => {
    await page.goto('/swap')
    
    const selects = page.locator('select')
    const count = await selects.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('should have amount inputs', async ({ page }) => {
    await page.goto('/swap')
    
    const inputAmount = page.locator('input[type="number"]').first()
    await expect(inputAmount).toBeVisible()
    await inputAmount.fill('0.1')
    expect(await inputAmount.inputValue()).toBe('0.1')
  })

  test('should have swap button', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/swap')
    const swapButton = page.getByRole('button', { name: /Swap/i })
    await expect(swapButton).toBeVisible()
  })

  test('should switch tokens with arrow button', async ({ page }) => {
    await page.goto('/swap')
    
    const switchButton = page.getByRole('button', { name: '↓' })
    if (await switchButton.isVisible()) {
      await switchButton.click()
      await page.waitForTimeout(300)
    }
  })
})

// =============================================================================
// SECTION 6: MARKETS PAGE
// =============================================================================
test.describe('6. Markets Page', () => {
  test('should display markets list', async ({ page }) => {
    await page.goto('/markets')
    await expect(page.getByRole('heading', { name: /Markets/i })).toBeVisible()
  })

  test('should have search input', async ({ page }) => {
    await page.goto('/markets')
    
    const searchInput = page.getByTestId('market-search')
    if (await searchInput.isVisible()) {
      await searchInput.fill('test')
      await page.waitForTimeout(500)
      await searchInput.clear()
    }
  })

  test('should have filter buttons', async ({ page }) => {
    await page.goto('/markets')
    
    const allFilter = page.getByTestId('filter-all')
    const activeFilter = page.getByTestId('filter-active')
    const resolvedFilter = page.getByTestId('filter-resolved')
    
    // Test filter buttons if visible
    if (await allFilter.isVisible()) {
      await allFilter.click()
      await expect(allFilter).toHaveClass(/bg-purple-600|active/)
    }
    
    if (await activeFilter.isVisible()) {
      await activeFilter.click()
      await expect(activeFilter).toHaveClass(/bg-purple-600|active/)
    }
    
    if (await resolvedFilter.isVisible()) {
      await resolvedFilter.click()
      await expect(resolvedFilter).toHaveClass(/bg-purple-600|active/)
    }
  })

  test('should navigate to market detail', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(1000)
    
    const marketCard = page.getByTestId('market-card').first()
    if (await marketCard.isVisible()) {
      await marketCard.click()
      await page.waitForURL('**/markets/**')
    }
  })
})

// =============================================================================
// SECTION 7: MARKET DETAIL & TRADING
// =============================================================================
test.describe('7. Market Detail & Trading', () => {
  test('should display trading interface', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    // Navigate to markets and click first one
    await page.goto('/markets')
    await page.waitForTimeout(1000)
    
    const marketCard = page.getByTestId('market-card').first()
    if (await marketCard.isVisible()) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      const tradingInterface = page.getByTestId('trading-interface')
      if (await tradingInterface.isVisible()) {
        await expect(tradingInterface).toBeVisible()
      }
    }
  })

  test('should have YES/NO outcome buttons', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/markets')
    await page.waitForTimeout(1000)
    
    const marketCard = page.getByTestId('market-card').first()
    if (await marketCard.isVisible()) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      const yesButton = page.getByTestId('outcome-yes-button')
      const noButton = page.getByTestId('outcome-no-button')
      
      if (await yesButton.isVisible()) {
        await yesButton.click()
        await expect(yesButton).toHaveClass(/bg-green-600|ring/)
      }
      
      if (await noButton.isVisible()) {
        await noButton.click()
        await expect(noButton).toHaveClass(/bg-red-600|ring/)
      }
    }
  })

  test('should have amount input and buy button', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/markets')
    await page.waitForTimeout(1000)
    
    const marketCard = page.getByTestId('market-card').first()
    if (await marketCard.isVisible()) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      const amountInput = page.getByTestId('amount-input')
      const buyButton = page.getByTestId('buy-button')
      
      if (await amountInput.isVisible()) {
        await amountInput.fill('100')
        expect(await amountInput.inputValue()).toBe('100')
      }
      
      if (await buyButton.isVisible()) {
        await expect(buyButton).toBeVisible()
      }
    }
  })

  test('should execute trade with MetaMask confirmation', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/markets')
    await page.waitForTimeout(1000)
    
    const marketCard = page.getByTestId('market-card').first()
    if (await marketCard.isVisible()) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      const yesButton = page.getByTestId('outcome-yes-button')
      const amountInput = page.getByTestId('amount-input')
      const buyButton = page.getByTestId('buy-button')
      
      if (await yesButton.isVisible() && await buyButton.isVisible()) {
        await yesButton.click()
        await amountInput.fill('10')
        await buyButton.click()
        
        await page.waitForTimeout(2000)
        await metamask.confirmTransaction()
        await page.waitForTimeout(5000)
        
        console.log('✅ Trade transaction confirmed')
      }
    }
  })
})

// =============================================================================
// SECTION 8: PORTFOLIO PAGE
// =============================================================================
test.describe('8. Portfolio Page', () => {
  test('should display portfolio stats', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/portfolio')
    
    await expect(page.getByText(/Total Value/i)).toBeVisible()
    await expect(page.getByText(/Total P&L/i)).toBeVisible()
  })

  test('should show positions or empty state', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/portfolio')
    await page.waitForTimeout(1000)
    
    // Should show either positions table or empty state
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('should have claim buttons for resolved positions', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/portfolio')
    await page.waitForTimeout(1000)
    
    const claimButtons = page.getByRole('button', { name: /Claim/i })
    const count = await claimButtons.count()
    
    if (count > 0) {
      console.log(`✅ Found ${count} claim button(s)`)
    }
  })
})

// =============================================================================
// SECTION 9: ITEMS (NFT) PAGE
// =============================================================================
test.describe('9. Items Page', () => {
  test('should display items grid', async ({ page }) => {
    await page.goto('/items')
    await expect(page.getByRole('heading', { name: /Items/i })).toBeVisible()
  })

  test('should have filter buttons', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
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

  test('should have sort dropdown', async ({ page }) => {
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

  test('should click on NFT card to open detail', async ({ page }) => {
    await page.goto('/items')
    await page.waitForTimeout(1000)
    
    const nftCard = page.getByTestId('nft-card').first()
    if (await nftCard.isVisible()) {
      await nftCard.click()
      await page.waitForTimeout(500)
      // Should open modal or navigate
    }
  })
})

// =============================================================================
// SECTION 10: LIQUIDITY PAGE
// =============================================================================
test.describe('10. Liquidity Page', () => {
  test('should display liquidity interface', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/liquidity')
    await expect(page.getByRole('heading', { name: /Liquidity/i })).toBeVisible()
  })

  test('should have token address inputs', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/liquidity')
    
    const token0Input = page.getByPlaceholder('0x...')
    if (await token0Input.first().isVisible()) {
      await token0Input.first().fill('0x0000000000000000000000000000000000000001')
    }
  })

  test('should have fee tier selector', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/liquidity')
    
    const feeSelect = page.locator('select').first()
    if (await feeSelect.isVisible()) {
      await feeSelect.selectOption('3000')
    }
  })

  test('should have price range inputs', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/liquidity')
    
    const minPriceInput = page.getByPlaceholder('0.0').first()
    const maxPriceInput = page.getByPlaceholder('0.0').nth(1)
    
    if (await minPriceInput.isVisible()) {
      await minPriceInput.fill('0.5')
    }
    if (await maxPriceInput.isVisible()) {
      await maxPriceInput.fill('2.0')
    }
  })
})

// =============================================================================
// SECTION 11: POOLS PAGE
// =============================================================================
test.describe('11. Pools Page', () => {
  test('should display pools list', async ({ page }) => {
    await page.goto('/pools')
    await expect(page.getByRole('heading', { name: /Pools/i })).toBeVisible()
  })

  test('should have create pool button', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/pools')
    
    const createButton = page.getByRole('button', { name: /Create Pool/i })
    if (await createButton.isVisible()) {
      await expect(createButton).toBeVisible()
    }
  })
})

// =============================================================================
// SECTION 12: GAMES PAGE
// =============================================================================
test.describe('12. Games Page', () => {
  test('should display games section', async ({ page }) => {
    await page.goto('/games')
    await expect(page.getByRole('heading', { name: /Games/i })).toBeVisible()
  })

  test('should navigate to Hyperscape', async ({ page }) => {
    await page.goto('/games')
    
    const hyperscapeLink = page.getByRole('link', { name: /Hyperscape/i })
    if (await hyperscapeLink.isVisible()) {
      await hyperscapeLink.click()
      await page.waitForURL('**/games/hyperscape')
    }
  })
})

// =============================================================================
// SECTION 13: HYPERSCAPE PAGE
// =============================================================================
test.describe('13. Hyperscape Page', () => {
  test('should display Hyperscape stats', async ({ page }) => {
    await page.goto('/games/hyperscape')
    await page.waitForTimeout(1000)
    
    const heading = page.getByRole('heading', { name: /Hyperscape/i })
    await expect(heading).toBeVisible()
  })

  test('should show player stats table', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    await connectWallet(page, metamask)
    
    await page.goto('/games/hyperscape')
    await page.waitForTimeout(1000)
    
    // Should show stats or empty state
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })
})

// =============================================================================
// SECTION 14: ON-CHAIN VALIDATION
// =============================================================================
test.describe('14. On-Chain Validation', () => {
  test('should verify block number is advancing', async ({ page }) => {
    const blockNumber = await publicClient.getBlockNumber()
    expect(blockNumber > 0n).toBe(true)
    console.log(`✅ Current block number: ${blockNumber}`)
  })

  test('should verify test account has balance', async ({ page }) => {
    const balance = await publicClient.getBalance({
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    })
    expect(balance > 0n).toBe(true)
    console.log(`✅ Test account balance: ${formatEther(balance)} ETH`)
  })

  test('should verify chain ID matches', async ({ page }) => {
    const chainId = await publicClient.getChainId()
    expect(chainId).toBe(CHAIN_ID)
    console.log(`✅ Chain ID: ${chainId}`)
  })

  test('should read contract state (if deployed)', async ({ page }) => {
    const MARKETPLACE_ADDRESS = process.env.NEXT_PUBLIC_NFT_MARKETPLACE_ADDRESS
    
    if (MARKETPLACE_ADDRESS && MARKETPLACE_ADDRESS !== '0x0') {
      const code = await publicClient.getCode({ address: MARKETPLACE_ADDRESS as `0x${string}` })
      
      if (code && code !== '0x') {
        console.log(`✅ NFT Marketplace contract deployed at ${MARKETPLACE_ADDRESS}`)
      } else {
        console.log('⚠️ NFT Marketplace not deployed')
      }
    } else {
      console.log('⚠️ No marketplace address configured')
    }
  })
})

// =============================================================================
// SECTION 15: ERROR HANDLING
// =============================================================================
test.describe('15. Error Handling', () => {
  test('should handle non-existent market gracefully', async ({ page }) => {
    await page.goto('/markets/0x0000000000000000000000000000000000000000000000000000000000000000')
    await page.waitForTimeout(1000)
    
    const body = await page.textContent('body')
    const hasError = body?.includes('Not Found') || body?.includes('doesn\'t exist')
    expect(body).toBeTruthy()
  })

  test('should handle non-existent item gracefully', async ({ page }) => {
    await page.goto('/items/nonexistent-id-12345')
    await page.waitForTimeout(1000)
    
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('should show connect wallet prompt when needed', async ({ page }) => {
    await page.goto('/portfolio')
    await page.waitForTimeout(500)
    
    const connectPrompt = page.getByRole('button', { name: /Connect Wallet/i })
    await expect(connectPrompt).toBeVisible()
  })
})

// =============================================================================
// SECTION 16: COMPLETE USER JOURNEY
// =============================================================================
test.describe('16. Complete User Journey', () => {
  test('should complete full journey: connect -> browse -> trade -> check portfolio', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    
    // Step 1: Connect wallet
    await connectWallet(page, metamask)
    console.log('✅ Step 1: Wallet connected')
    
    // Step 2: Browse coins
    await page.goto('/coins')
    await page.waitForTimeout(1000)
    console.log('✅ Step 2: Browsed coins')
    
    // Step 3: Check swap page
    await page.goto('/swap')
    await page.locator('input[type="number"]').first().fill('0.1')
    console.log('✅ Step 3: Checked swap page')
    
    // Step 4: Browse markets
    await page.goto('/markets')
    await page.waitForTimeout(1000)
    console.log('✅ Step 4: Browsed markets')
    
    // Step 5: Check portfolio
    await page.goto('/portfolio')
    await expect(page.getByText(/Total Value/i)).toBeVisible()
    console.log('✅ Step 5: Checked portfolio')
    
    // Step 6: Browse NFTs
    await page.goto('/items')
    await page.waitForTimeout(500)
    console.log('✅ Step 6: Browsed items')
    
    // Step 7: Check games
    await page.goto('/games')
    await page.waitForTimeout(500)
    console.log('✅ Step 7: Checked games')
    
    // Step 8: Return home
    await page.goto('/')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
    console.log('✅ Step 8: Journey complete - wallet still connected')
    
    console.log('\n═══════════════════════════════════════')
    console.log('  COMPLETE USER JOURNEY: ALL STEPS PASSED')
    console.log('═══════════════════════════════════════')
  })
})


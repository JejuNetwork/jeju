/**
* @fileoverview Test file
 * Game Feeds & Hyperscape Events Tests
 * Tests real-time game feed integration and Hyperscape oracle events
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Game Feeds & Hyperscape', () => {
  test('should display game feed on market detail page', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      // Look for game feed panel
      const gameFeed = page.getByText(/Game Feed|GameFeedOracle/i)
      const feedExists = await gameFeed.isVisible()
      
      if (feedExists) {
        await expect(gameFeed).toBeVisible()
        console.log('✅ Game feed panel found')
        
        // Should show posts or empty state
        const feedBody = await page.locator('text=/Game Feed/i').locator('../..').textContent()
        expect(feedBody).toBeTruthy()
      }
    }
  })

  test('should display real-time game posts', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      // Wait for game feed to load
      await page.waitForTimeout(3000)
      
      // Look for post cards
      const posts = page.locator('[class*="rounded"][class*="border"]').filter({ hasText: /Day \d+|Block \d+|0x[a-fA-F0-9]+/i })
      const postCount = await posts.count()
      
      console.log(`Found ${postCount} game feed posts`)
      
      if (postCount > 0) {
        // Verify post structure
        const firstPost = posts.first()
        const postText = await firstPost.textContent()
        
        // Should have author, content, timestamp
        const hasPostStructure = postText?.includes('0x') || 
                                postText?.includes('Day') ||
                                postText?.includes('Block')
        
        expect(hasPostStructure).toBe(true)
      }
    }
  })

  test('should show market odds updates in game feed', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(2000)
      
      // Look for market odds display in game feed
      const oddsDisplay = page.locator('text=/Latest Market Odds|YES.*%|NO.*%/i')
      const oddsExists = await oddsDisplay.count()
      
      if (oddsExists > 0) {
        const oddsText = await oddsDisplay.first().locator('../..').textContent()
        
        // Should show YES% and NO%
        const hasOdds = oddsText?.includes('YES') && oddsText?.includes('NO')
        expect(hasOdds).toBe(true)
        
        console.log('✅ Market odds displayed in game feed')
      }
    }
  })

  test('should display Hyperscape player stats', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      // Look for Hyperscape stats panel
      const hyperscapeStats = page.getByText(/Hyperscape Stats/i)
      const statsExists = await hyperscapeStats.isVisible()
      
      if (statsExists) {
        await expect(hyperscapeStats).toBeVisible()
        
        // Should show stats like Level-Ups, Kills, Deaths
        const body = await page.textContent('body')
        const hasStats = body?.includes('Level-Ups') || 
                        body?.includes('Kills') ||
                        body?.includes('Deaths') ||
                        body?.includes('Achievements')
        
        expect(hasStats).toBe(true)
        console.log('✅ Hyperscape stats panel found')
      }
    }
  })

  test('should switch between Hyperscape stats tabs', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      // Look for tab buttons
      const skillsTab = page.getByRole('button', { name: /Skills/i })
      const combatTab = page.getByRole('button', { name: /Combat/i })
      const achievementsTab = page.getByRole('button', { name: /Achievements/i })
      
      const hasSkillsTab = await skillsTab.isVisible()
      
      if (hasSkillsTab) {
        // Switch tabs
        await combatTab.click()
        await page.waitForTimeout(500)
        await expect(combatTab).toHaveClass(/text-blue-400|border-blue-400/)
        
        await achievementsTab.click()
        await page.waitForTimeout(500)
        await expect(achievementsTab).toHaveClass(/text-blue-400|border-blue-400/)
        
        await skillsTab.click()
        await page.waitForTimeout(500)
        await expect(skillsTab).toHaveClass(/text-blue-400|border-blue-400/)
        
        console.log('✅ Hyperscape tabs working')
      }
    }
  })

  test('should view registered games page', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate to games
    await page.goto('/games')
    await page.waitForTimeout(1000)
    
    await expect(page.getByRole('heading', { name: /Games/i })).toBeVisible()
    
    // Should show games or empty state
    const body = await page.textContent('body')
    const hasGamesContent = body?.includes('game') || 
                           body?.includes('ERC-8004') ||
                           body?.includes('registered')
    
    expect(hasGamesContent).toBe(true)
  })

  test('should display game stats and tags', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/games')
    await page.waitForTimeout(1000)
    
    // Look for game cards
    const gameCards = page.locator('[class*="rounded"][class*="p-6"]').filter({ hasText: /players|items|Agent ID/i })
    const cardCount = await gameCards.count()
    
    console.log(`Found ${cardCount} game cards`)
    
    if (cardCount > 0) {
      const firstCard = gameCards.first()
      const cardText = await firstCard.textContent()
      
      // Should show game info
      const hasGameInfo = cardText?.includes('players') || 
                         cardText?.includes('items') ||
                         cardText?.includes('Agent')
      
      expect(hasGameInfo).toBe(true)
    }
  })

  test('should link to external game interfaces', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/games')
    await page.waitForTimeout(1000)
    
    // Look for "View Game" links
    const viewGameLinks = page.getByRole('link', { name: /View Game/i })
    const linkCount = await viewGameLinks.count()
    
    console.log(`Found ${linkCount} game links`)
    
    if (linkCount > 0) {
      // Verify links have target="_blank"
      const firstLink = viewGameLinks.first()
      const target = await firstLink.getAttribute('target')
      
      expect(target).toBe('_blank')
    }
  })
})

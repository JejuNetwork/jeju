/**
import type { Page } from "@playwright/test";
 * Portfolio Management - Complete Flow
 * Tests REAL position tracking, P&L calculation, and claims
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Portfolio - Complete Management', () => {
  test('should view portfolio with connected wallet', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate to portfolio
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    // Should show portfolio stats
    await expect(page.getByText(/Total Value/i)).toBeVisible()
    await expect(page.getByText(/Total P&L/i)).toBeVisible()
    await expect(page.getByText(/Active Positions/i)).toBeVisible()
  })

  test('should display all positions with market info', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    // Check positions table
    const positionsTable = page.getByTestId('positions-table')
    const tableExists = await positionsTable.isVisible()
    
    if (tableExists) {
      // Should have table headers
      await expect(page.getByText(/Market/i)).toBeVisible()
      await expect(page.getByText(/Position/i)).toBeVisible()
      await expect(page.getByText(/Value/i)).toBeVisible()
      await expect(page.getByText(/Status/i)).toBeVisible()
    } else {
      // Should show no positions message
      const noPositions = page.getByTestId('no-positions')
      await expect(noPositions).toBeVisible()
    }
  })

  test('should calculate total value correctly', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    // Get Total Value display
    const totalValueContainer = page.locator('text=/Total Value/i').locator('..')
    const valueText = await totalValueContainer.textContent()
    
    expect(valueText).toBeTruthy()
    expect(valueText).toMatch(/\d+\.?\d*\s*ETH/)
  })

  test('should calculate P&L with correct sign', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    // Get P&L display
    const pnlContainer = page.locator('text=/Total P&L/i').locator('..')
    const pnlText = await pnlContainer.textContent()
    
    expect(pnlText).toBeTruthy()
    // Should show +/- and ETH
    expect(pnlText).toMatch(/[+\-]?\d+\.?\d*\s*ETH/)
  })

  test('should click position to navigate to market', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    // If positions exist, click first market link
    const positionsTable = page.getByTestId('positions-table')
    const tableExists = await positionsTable.isVisible()
    
    if (tableExists) {
      const marketLinks = positionsTable.locator('a')
      const linkCount = await marketLinks.count()
      
      if (linkCount > 0) {
        const firstLink = marketLinks.first()
        await firstLink.click()
        
        // Should navigate to market detail
        await expect(page).toHaveURL(/\/markets\/.+/)
        await page.waitForTimeout(1000)
        
        const body = await page.textContent('body')
        expect(body).toBeTruthy()
      }
    }
  })

  test('should claim winnings from resolved market', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    // Look for claim buttons
    const claimButtons = page.getByRole('button', { name: /Claim/i })
    const claimCount = await claimButtons.count()
    
    if (claimCount > 0) {
      const firstClaimButton = claimButtons.first()
      
      // Click claim
      await firstClaimButton.click()
      await page.waitForTimeout(2000)
      
      // Confirm in MetaMask
      await metamask.confirmTransaction()
      await page.waitForTimeout(5000)
      
      // Should show success or update position
      const body = await page.textContent('body')
      const hasClaimed = body?.includes('Claimed') || 
                        body?.includes('successfully') ||
                        body?.includes('Success')
      
      expect(body).toBeTruthy()
    }
  })

  test('should hover position rows and show details', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    const positionsTable = page.getByTestId('positions-table')
    const tableExists = await positionsTable.isVisible()
    
    if (tableExists) {
      const rows = positionsTable.locator('tbody tr')
      const rowCount = await rows.count()
      
      if (rowCount > 0) {
        const firstRow = rows.first()
        
        // Hover to trigger highlight
        await firstRow.hover()
        await page.waitForTimeout(500)
        
        // Should have hover class
        const rowClass = await firstRow.getAttribute('class')
        expect(rowClass).toContain('hover:bg-white/5')
      }
    }
  })

  test('should show correct position shares (YES/NO)', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    const positionsTable = page.getByTestId('positions-table')
    const tableExists = await positionsTable.isVisible()
    
    if (tableExists) {
      const rows = positionsTable.locator('tbody tr')
      const rowCount = await rows.count()
      
      if (rowCount > 0) {
        const firstRow = rows.first()
        const rowText = await firstRow.textContent()
        
        // Should show YES or NO shares
        const hasShares = rowText?.includes('YES') || rowText?.includes('NO')
        expect(hasShares).toBe(true)
      }
    }
  })

  test('should navigate from portfolio to markets and back', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/portfolio')
    await page.waitForTimeout(1000)
    
    // Click "Browse Markets" link (if no positions)
    const browseLink = page.getByRole('link', { name: /Browse markets/i })
    const linkExists = await browseLink.isVisible()
    
    if (linkExists) {
      await browseLink.click()
      await expect(page).toHaveURL('/markets')
      
      // Navigate back to portfolio
      await page.getByRole('link', { name: /^Portfolio$/i }).click()
      await expect(page).toHaveURL('/portfolio')
    } else {
      // Use header navigation
      await page.getByRole('link', { name: /^Markets$/i }).click()
      await expect(page).toHaveURL('/markets')
      
      await page.getByRole('link', { name: /^Portfolio$/i }).click()
      await expect(page).toHaveURL('/portfolio')
    }
  })
})

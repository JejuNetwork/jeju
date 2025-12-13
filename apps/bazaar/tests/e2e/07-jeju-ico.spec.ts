import { test, expect } from '@playwright/test'

test.describe('Jeju ICO Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/coins/jeju-ico')
    await page.waitForLoadState('networkidle')
  })

  test('renders hero section with correct content', async ({ page }) => {
    // Check title
    await expect(page.locator('h1').first()).toBeVisible()
    await expect(page.locator('h1').first()).toContainText('Jeju')
    
    // Check description contains key text
    await expect(page.locator('text=Governance and utility token').first()).toBeVisible()
    
    // Check feature badges - use first() to avoid strict mode issues
    await expect(page.locator('text=Moderation Staking').first()).toBeVisible()
    await expect(page.locator('text=Network Utility').first()).toBeVisible()
    
    // Check stats
    await expect(page.locator('text=10B JEJU').first()).toBeVisible()
    await expect(page.locator('text=Max Supply').first()).toBeVisible()
  })

  test('renders presale card with countdown and progress', async ({ page }) => {
    // Check presale card title
    await expect(page.locator('text=Participate in Presale').first()).toBeVisible()
    
    // Check countdown - the page should have these labels
    const countdownSection = page.locator('[class*="grid-cols-4"]').first()
    await expect(countdownSection).toBeVisible()
    
    // Check progress bar exists
    await expect(page.locator('text=Progress').first()).toBeVisible()
    
    // Check stats section
    await expect(page.locator('text=Participants').first()).toBeVisible()
  })

  test('renders contribution input with quick amounts', async ({ page }) => {
    // Check input label
    await expect(page.getByText('Contribution Amount (ETH)')).toBeVisible()
    
    // Check input exists
    const input = page.getByTestId('presale-amount')
    await expect(input).toBeVisible()
    
    // Check quick amount buttons
    await expect(page.getByRole('button', { name: '0.1' })).toBeVisible()
    await expect(page.getByRole('button', { name: '1', exact: true })).toBeVisible()
  })

  test('quick amount buttons update input', async ({ page }) => {
    const input = page.getByTestId('presale-amount')
    
    // Click 0.1 button
    await page.getByRole('button', { name: '0.1' }).click()
    await expect(input).toHaveValue('0.1')
    
    // Click 1 button
    await page.getByRole('button', { name: '1', exact: true }).click()
    await expect(input).toHaveValue('1')
  })

  test('shows token calculation on amount entry', async ({ page }) => {
    const input = page.getByTestId('presale-amount')
    
    // Enter an amount
    await input.fill('1')
    
    // Should show calculation - use locators to be more specific
    await expect(page.locator('text=You receive').first()).toBeVisible()
    await expect(page.locator('text=Total').first()).toBeVisible()
  })

  test('shows bonus for eligible amounts', async ({ page }) => {
    const input = page.getByTestId('presale-amount')
    
    // Enter 1 ETH (should get 1% bonus)
    await input.fill('1')
    
    // Should show bonus
    await expect(page.getByText(/Bonus.*1%/)).toBeVisible()
    
    // Enter 5 ETH (should get 3% bonus)
    await input.fill('5')
    await expect(page.getByText(/Bonus.*3%/)).toBeVisible()
    
    // Enter 10 ETH (should get 5% bonus)
    await input.fill('10')
    await expect(page.getByText(/Bonus.*5%/)).toBeVisible()
  })

  test('renders tokenomics section', async ({ page }) => {
    // Check tokenomics heading
    await expect(page.getByRole('heading', { name: 'Tokenomics' })).toBeVisible()
    
    // Check allocation categories are shown - use locators with first()
    await expect(page.locator('text=presale').first()).toBeVisible()
    await expect(page.locator('text=ecosystem').first()).toBeVisible()
    await expect(page.locator('text=liquidity').first()).toBeVisible()
  })

  test('renders utility section', async ({ page }) => {
    // Check utility heading
    await expect(page.getByText('Token Utility')).toBeVisible()
    
    // Check exclusive utility
    await expect(page.getByText('Exclusive JEJU Functions')).toBeVisible()
    
    // Check universal payment
    await expect(page.getByText('Universal Payment')).toBeVisible()
  })

  test('renders timeline section', async ({ page }) => {
    // Check timeline heading
    await expect(page.locator('text=Timeline').first()).toBeVisible()
    
    // Check timeline items
    await expect(page.locator('text=Infrastructure').first()).toBeVisible()
    await expect(page.locator('text=TGE').first()).toBeVisible()
  })

  test('has working navigation links', async ({ page }) => {
    // Check whitepaper link
    const whitepaperLink = page.getByRole('link', { name: /Whitepaper/ })
    await expect(whitepaperLink).toBeVisible()
    await expect(whitepaperLink).toHaveAttribute('href', '/coins/jeju-ico/whitepaper')
    
    // Check GitHub link
    const githubLink = page.getByRole('link', { name: /GitHub/ })
    await expect(githubLink).toBeVisible()
    await expect(githubLink).toHaveAttribute('href', 'https://github.com/elizaos/jeju')
    
    // Check docs link
    const docsLink = page.getByRole('link', { name: /Documentation/ })
    await expect(docsLink).toBeVisible()
    await expect(docsLink).toHaveAttribute('href', 'https://docs.jeju.network')
  })

  test('contribute button shows correct state when wallet not connected', async ({ page }) => {
    const contributeBtn = page.getByTestId('presale-contribute-btn')
    
    // Should show Connect Wallet when not connected
    await expect(contributeBtn).toContainText('Connect Wallet')
  })

  test('min/max contribution limits are displayed', async ({ page }) => {
    // Check min/max text
    await expect(page.getByText('Min: 0.01 ETH')).toBeVisible()
    await expect(page.getByText('Max: 50 ETH')).toBeVisible()
  })
})

test.describe('Jeju ICO Whitepaper Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/coins/jeju-ico/whitepaper')
    await page.waitForLoadState('networkidle')
  })

  test('renders whitepaper content', async ({ page }) => {
    // Check title
    await expect(page.getByRole('heading', { name: 'Jeju Token Whitepaper' })).toBeVisible()
    
    // Check table of contents
    await expect(page.locator('text=Contents').first()).toBeVisible()
    // Use role to be more specific
    await expect(page.getByRole('link', { name: 'Abstract' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Tokenomics' })).toBeVisible()
    
    // Check tokenomics table
    await expect(page.locator('table').first()).toBeVisible()
    
    // Check disclaimer
    await expect(page.getByRole('heading', { name: 'Disclaimer' })).toBeVisible()
  })

  test('has back link to ICO page', async ({ page }) => {
    const backLink = page.getByRole('link', { name: /Back to Jeju ICO/ })
    await expect(backLink).toBeVisible()
    await expect(backLink).toHaveAttribute('href', '/coins/jeju-ico')
  })

  test('section navigation works', async ({ page }) => {
    // Click on a ToC link
    await page.getByRole('link', { name: '4. Tokenomics' }).click()
    
    // Should scroll to section (URL should have hash)
    await expect(page).toHaveURL(/.*#section-4/)
  })
})

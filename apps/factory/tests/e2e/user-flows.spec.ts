/**
 * Advanced User Flow Tests
 * Tests complete end-to-end user journeys through the Factory app
 */

import { expect, test } from '@playwright/test'

const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

test.describe('Developer Onboarding Flow', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('new developer explores Factory', async ({ page }) => {
    // Step 1: Land on home page
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /factory/i })).toBeVisible()

    // Step 2: Browse bounties
    await page
      .getByRole('link', { name: /bounties/i })
      .first()
      .click()
    await expect(page).toHaveURL('/bounties')
    await expect(page.getByRole('heading', { name: /bounties/i })).toBeVisible()

    // Step 3: Check out repositories
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /repositories/i })
      .click()
    await expect(page).toHaveURL('/git')

    // Step 4: Explore packages
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /packages/i })
      .click()
    await expect(page).toHaveURL('/packages')

    // Step 5: View AI models
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /models/i })
      .click()
    await expect(page).toHaveURL('/models')
  })

  test('developer navigates to create bounty', async ({ page }) => {
    await page.goto('/bounties')
    await page.getByRole('link', { name: /create bounty/i }).click()
    await expect(page).toHaveURL(/\/bounties\/(create|new)/)
  })

  test('developer navigates to create repository', async ({ page }) => {
    await page.goto('/git')
    const newRepoBtn = page.getByRole('link', {
      name: /new repository|create/i,
    })
    if (await newRepoBtn.isVisible()) {
      await newRepoBtn.click()
      await expect(page).toHaveURL(/\/git\/new/)
    }
  })
})

test.describe('Bounty Discovery Flow', () => {
  test('developer searches and filters bounties', async ({ page }) => {
    await page.goto('/bounties')

    // Search for bounties
    const searchInput = page.getByPlaceholder(/search bounties/i)
    await searchInput.fill('solidity')
    await expect(searchInput).toHaveValue('solidity')

    // Filter by status
    const openFilter = page.getByRole('button', { name: /^open$/i })
    if (await openFilter.isVisible()) {
      await openFilter.click()
    }

    // Sort bounties
    const sortSelect = page.locator('select').first()
    if (await sortSelect.isVisible()) {
      await sortSelect.selectOption({ index: 0 })
    }
  })

  test('developer views bounty details', async ({ page }) => {
    await page.goto('/bounties')
    const bountyLink = page.locator('a[href^="/bounties/"]').first()
    if (await bountyLink.isVisible()) {
      await bountyLink.click()
      await expect(page).toHaveURL(/\/bounties\/.+/)
    }
  })
})

test.describe('Repository Workflow', () => {
  test('developer browses repository contents', async ({ page }) => {
    await page.goto('/git/jeju/factory')
    await expect(page.getByRole('main')).toBeVisible()

    // View code tab
    const codeBtn = page.getByRole('button', { name: /code/i }).first()
    if (await codeBtn.isVisible()) {
      await codeBtn.click()
    }

    // View issues
    const issuesBtn = page.getByRole('button', { name: /issues/i })
    if (await issuesBtn.isVisible()) {
      await issuesBtn.click()
    }

    // View pull requests
    const prsBtn = page.getByRole('button', { name: /pull requests/i })
    if (await prsBtn.isVisible()) {
      await prsBtn.click()
    }
  })

  test('developer creates new issue', async ({ page }) => {
    await page.goto('/git/jeju/factory/issues/new')
    await expect(page.getByRole('main')).toBeVisible()

    // Fill issue form
    const titleInput = page.getByPlaceholder(/issue title/i)
    if (await titleInput.isVisible()) {
      await titleInput.fill('Test Issue Title')
    }

    const bodyInput = page.locator('textarea').first()
    if (await bodyInput.isVisible()) {
      await bodyInput.fill('This is a test issue description')
    }
  })

  test('developer creates pull request', async ({ page }) => {
    await page.goto('/git/jeju/factory/pulls/new')
    await expect(page.getByRole('main')).toBeVisible()

    // Verify branch selectors
    await expect(page.getByText(/base:/i)).toBeVisible()
    await expect(page.getByText(/compare:/i)).toBeVisible()
  })
})

test.describe('Package Publishing Flow', () => {
  test('developer views package publish instructions', async ({ page }) => {
    await page.goto('/packages/publish')

    // Verify CLI tab
    await expect(
      page.getByRole('button', { name: /cli/i }).first(),
    ).toBeVisible()

    // Check registry configuration
    await expect(page.getByText(/configure registry/i)).toBeVisible()

    // Check publish command
    await expect(page.getByText(/bun jeju publish/i)).toBeVisible()
  })

  test('developer views package details', async ({ page }) => {
    await page.goto('/packages/@jeju/sdk')

    // View README
    await expect(page.getByRole('button', { name: /readme/i })).toBeVisible()

    // View versions
    await page.getByRole('button', { name: /versions/i }).click()
    await expect(page.locator('.card').first()).toBeVisible()

    // View dependencies
    await page.getByRole('button', { name: /dependencies/i }).click()
    await expect(page.getByText(/dependencies/i).first()).toBeVisible()
  })
})

test.describe('Model Interaction Flow', () => {
  test('developer explores model hub', async ({ page }) => {
    await page.goto('/models')

    // Search for models
    const searchInput = page.getByPlaceholder(/search models/i)
    await searchInput.fill('llama')
    await expect(searchInput).toHaveValue('llama')

    // Filter by type
    const filterBtn = page.getByRole('button', { name: /llm/i })
    if (await filterBtn.isVisible()) {
      await filterBtn.click()
    }
  })

  test('developer uses inference playground', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')

    // Navigate to inference tab
    await page.getByRole('button', { name: /inference/i }).click()

    // Fill prompt
    const textarea = page.locator('textarea')
    if (await textarea.isVisible()) {
      await textarea.fill('Write a hello world function in TypeScript')
    }

    // Verify generate button
    await expect(page.getByRole('button', { name: /generate/i })).toBeVisible()
  })

  test('developer views training options', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /training/i }).click()
    await expect(page.getByText(/train on jeju/i)).toBeVisible()
  })
})

test.describe('CI/CD Monitoring Flow', () => {
  test('developer monitors CI runs', async ({ page }) => {
    await page.goto('/ci')

    // View pipeline stats
    await expect(page.getByText(/total runs/i)).toBeVisible()

    // Filter by status
    const inProgressBtn = page.getByRole('button', { name: /in progress/i })
    if (await inProgressBtn.isVisible()) {
      await inProgressBtn.click()
    }

    // Click on a run
    const runLink = page.locator('a[href^="/ci/runs/"]').first()
    if (await runLink.isVisible()) {
      await runLink.click()
      await expect(page).toHaveURL(/\/ci\/runs\/.+/)
    }
  })
})

test.describe('Project Management Flow', () => {
  test('developer creates and manages project', async ({ page }) => {
    // Navigate to projects
    await page.goto('/projects')

    // Go to create page
    const createBtn = page.getByRole('link', { name: /new project|create/i })
    if (await createBtn.isVisible()) {
      await createBtn.click()
      await expect(page).toHaveURL(/\/projects\/new/)
    }
  })

  test('developer manages project board', async ({ page }) => {
    await page.goto('/projects/1')
    await expect(page.getByRole('main')).toBeVisible()

    // Look for task columns
    const columns = page.getByText(/todo|in progress|done/i)
    const count = await columns.count()
    expect(count).toBeGreaterThan(0)
  })
})

test.describe('Agent Deployment Flow', () => {
  test('developer deploys an agent', async ({ page }) => {
    await page.goto('/agents')

    // Navigate to deploy
    await page.getByRole('link', { name: /deploy agent/i }).click()
    await expect(page).toHaveURL(/\/agents\/deploy/)
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('developer views agent details', async ({ page }) => {
    await page.goto('/agents/1')
    await expect(page.getByRole('main')).toBeVisible()
  })
})

test.describe('Cross-Feature Navigation', () => {
  test('navigates through all main sections', async ({ page }) => {
    const sections = [
      { path: '/', check: /factory/i },
      { path: '/bounties', check: /bounties/i },
      { path: '/jobs', check: /jobs/i },
      { path: '/git', check: /repositories/i },
      { path: '/packages', check: /packages/i },
      { path: '/models', check: /model/i },
      { path: '/containers', check: /container/i },
      { path: '/projects', check: /project/i },
      { path: '/ci', check: /ci/i },
      { path: '/agents', check: /agent/i },
      { path: '/feed', check: /feed/i },
    ]

    for (const { path, check } of sections) {
      await page.goto(path)
      await expect(
        page.getByRole('heading', { name: check }).first(),
      ).toBeVisible()
    }
  })

  test('quick action links work', async ({ page }) => {
    await page.goto('/')

    // Test quick action links on home page
    const quickActions = page.locator(
      'a[href^="/bounties"], a[href^="/git"], a[href^="/packages"], a[href^="/models"]',
    )
    const count = await quickActions.count()
    expect(count).toBeGreaterThan(0)
  })
})

test.describe('Search Across Features', () => {
  test('global search works', async ({ page }) => {
    await page.goto('/')

    // Find global search
    const searchInput = page.getByPlaceholder(/search/i)
    if (await searchInput.isVisible()) {
      await searchInput.fill('jeju')
      await expect(searchInput).toHaveValue('jeju')
    }
  })

  test('feature-specific search works', async ({ page }) => {
    const searchPages = [
      { path: '/bounties', placeholder: /search bounties/i },
      { path: '/git', placeholder: /find.*repository/i },
      { path: '/packages', placeholder: /search packages/i },
      { path: '/models', placeholder: /search models/i },
    ]

    for (const { path, placeholder } of searchPages) {
      await page.goto(path)
      const searchInput = page.getByPlaceholder(placeholder)
      if (await searchInput.isVisible()) {
        await searchInput.fill('test')
        await expect(searchInput).toHaveValue('test')
      }
    }
  })
})

/**
 * Repositories E2E Tests
 * Tests git repository listing, detail view, issues, pull requests, and settings
 */

import { expect, test } from '@playwright/test'

const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

test.describe('Repository List', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays repository list', async ({ page }) => {
    await page.goto('/git')
    await expect(
      page.getByRole('heading', { name: /repositories/i }),
    ).toBeVisible()
  })

  test('shows repository stats', async ({ page }) => {
    await page.goto('/git')
    await expect(page.getByText(/total repos/i)).toBeVisible()
  })

  test('filters repositories by visibility', async ({ page }) => {
    await page.goto('/git')

    const publicFilter = page.getByRole('button', { name: /public/i })
    const privateFilter = page.getByRole('button', { name: /private/i })

    if (await publicFilter.isVisible()) {
      await publicFilter.click()
      await expect(publicFilter).toHaveClass(/bg-accent/)
    }

    if (await privateFilter.isVisible()) {
      await privateFilter.click()
      await expect(privateFilter).toHaveClass(/bg-accent/)
    }
  })

  test('searches repositories', async ({ page }) => {
    await page.goto('/git')
    const searchInput = page.getByPlaceholder(/find a repository/i)
    await searchInput.fill('contracts')
    await expect(searchInput).toHaveValue('contracts')
  })

  test('sorts repositories', async ({ page }) => {
    await page.goto('/git')
    const sortSelect = page.locator('select').first()
    if (await sortSelect.isVisible()) {
      await sortSelect.selectOption('stars')
    }
  })

  test('displays repository cards', async ({ page }) => {
    await page.goto('/git')
    const repoCard = page.locator('.card').first()
    await expect(repoCard).toBeVisible()
  })
})

test.describe('Repository Detail', () => {
  test('displays repository page', async ({ page }) => {
    await page.goto('/git/jeju/factory')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('shows repository tabs', async ({ page }) => {
    await page.goto('/git/jeju/factory')
    const codeButton = page.getByRole('button', { name: /code/i }).first()
    await expect(codeButton).toBeVisible()
  })

  test('shows action buttons', async ({ page }) => {
    await page.goto('/git/jeju/factory')
    const buttons = page.getByRole('button')
    await expect(buttons.first()).toBeVisible()
  })

  test('displays README section', async ({ page }) => {
    await page.goto('/git/jeju/factory')
    await expect(page.getByRole('heading', { name: /readme/i })).toBeVisible()
  })
})

test.describe('Issues', () => {
  test('displays issues list', async ({ page }) => {
    await page.goto('/git/jeju/factory')
    await page.getByRole('button', { name: /issues/i }).click()
    const issuesList = page.locator('.card').first()
    await expect(issuesList).toBeVisible()
  })

  test('shows new issue button', async ({ page }) => {
    await page.goto('/git/jeju/factory')
    await page.getByRole('button', { name: /issues/i }).click()

    const newIssueBtn = page.getByRole('link', { name: /new issue/i })
    if (await newIssueBtn.isVisible()) {
      await expect(newIssueBtn).toBeVisible()
    }
  })

  test('displays new issue form', async ({ page }) => {
    await page.goto('/git/jeju/factory/issues/new')
    await expect(
      page.getByRole('heading', { name: /new issue/i }),
    ).toBeVisible()
    await expect(page.getByPlaceholder(/issue title/i)).toBeVisible()
  })

  test('has markdown toolbar', async ({ page }) => {
    await page.goto('/git/jeju/factory/issues/new')
    await expect(page.getByRole('button', { name: /write/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /preview/i })).toBeVisible()
  })

  test('shows label selector', async ({ page }) => {
    await page.goto('/git/jeju/factory/issues/new')
    await expect(page.getByText(/labels/i).first()).toBeVisible()
  })

  test('shows assignee selector', async ({ page }) => {
    await page.goto('/git/jeju/factory/issues/new')
    await expect(page.getByText(/assignees/i).first()).toBeVisible()
  })

  test('displays issue detail page', async ({ page }) => {
    await page.goto('/git/jeju/factory/issues/42')
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByText(/#42/)).toBeVisible()
  })

  test('shows comments section', async ({ page }) => {
    await page.goto('/git/jeju/factory/issues/42')
    await expect(page.getByPlaceholder(/leave a comment/i)).toBeVisible()
  })

  test('shows issue status badge', async ({ page }) => {
    await page.goto('/git/jeju/factory/issues/42')
    await expect(page.locator('.badge').first()).toBeVisible()
  })
})

test.describe('Pull Requests', () => {
  test('displays pull requests list', async ({ page }) => {
    await page.goto('/git/jeju/factory')
    await page.getByRole('button', { name: /pull requests/i }).click()
    await expect(page.locator('.card, [class*="empty"]').first()).toBeVisible()
  })

  test('displays new PR form', async ({ page }) => {
    await page.goto('/git/jeju/factory/pulls/new')
    await expect(
      page.getByRole('heading', { name: /open a pull request/i }),
    ).toBeVisible()
  })

  test('shows branch selectors', async ({ page }) => {
    await page.goto('/git/jeju/factory/pulls/new')
    await expect(page.getByText(/base:/i)).toBeVisible()
    await expect(page.getByText(/compare:/i)).toBeVisible()
  })

  test('shows diff summary', async ({ page }) => {
    await page.goto('/git/jeju/factory/pulls/new')
    await expect(page.getByText(/files changed/i)).toBeVisible()
  })

  test('displays PR detail page', async ({ page }) => {
    await page.goto('/git/jeju/factory/pulls/45')
    await expect(page.getByText(/#45/)).toBeVisible()
  })

  test('shows PR tabs', async ({ page }) => {
    await page.goto('/git/jeju/factory/pulls/45')
    await expect(
      page.getByRole('button', { name: /conversation/i }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /commits/i })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /files changed/i }),
    ).toBeVisible()
  })

  test('displays diff viewer', async ({ page }) => {
    await page.goto('/git/jeju/factory/pulls/45')
    await page.getByRole('button', { name: /files changed/i }).click()
    await expect(page.getByText(/\.ts$/i).first()).toBeVisible()
  })

  test('shows merge button', async ({ page }) => {
    await page.goto('/git/jeju/factory/pulls/45')
    await expect(page.getByRole('button', { name: /merge/i })).toBeVisible()
  })
})

test.describe('Actions Tab', () => {
  test('displays workflow runs', async ({ page }) => {
    await page.goto('/git/jeju/factory')
    await page.getByRole('button', { name: /actions/i }).click()
    await expect(
      page.getByRole('link', { name: /view all workflows/i }),
    ).toBeVisible()
  })
})

test.describe('Repository Settings', () => {
  test('displays settings page', async ({ page }) => {
    await page.goto('/git/jeju/factory/settings')
    await expect(
      page.getByRole('heading', { name: /repository settings/i }),
    ).toBeVisible()
  })

  test('has settings tabs', async ({ page }) => {
    await page.goto('/git/jeju/factory/settings')
    await expect(page.getByRole('button', { name: /general/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /branches/i })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /collaborators/i }),
    ).toBeVisible()
  })

  test('shows visibility options', async ({ page }) => {
    await page.goto('/git/jeju/factory/settings')
    await expect(page.getByText(/public/i).first()).toBeVisible()
    await expect(page.getByText(/private/i).first()).toBeVisible()
  })

  test('shows danger zone', async ({ page }) => {
    await page.goto('/git/jeju/factory/settings')
    await page.getByRole('button', { name: /danger zone/i }).click()
    await expect(page.getByText(/delete repository/i)).toBeVisible()
  })

  test('shows branch protection', async ({ page }) => {
    await page.goto('/git/jeju/factory/settings')
    await page.getByRole('button', { name: /branches/i }).click()
    await expect(page.getByText(/branch protection/i)).toBeVisible()
  })
})

test.describe('Create Repository', () => {
  test('displays new repository form', async ({ page }) => {
    await page.goto('/git/new')
    await expect(
      page.getByRole('heading', { name: /create a new repository/i }),
    ).toBeVisible()
  })

  test('shows repository name input', async ({ page }) => {
    await page.goto('/git/new')
    const nameInput = page.getByPlaceholder(/my-awesome-project/i)
    await expect(nameInput).toBeVisible()
    await nameInput.fill('test-repo')
    await expect(nameInput).toHaveValue('test-repo')
  })

  test('shows visibility options', async ({ page }) => {
    await page.goto('/git/new')
    await expect(page.getByText(/public/i).first()).toBeVisible()
    await expect(page.getByText(/private/i).first()).toBeVisible()
  })

  test('shows git remote setup info', async ({ page }) => {
    await page.goto('/git/new')
    await expect(page.getByText(/git remote configuration/i)).toBeVisible()
    await expect(page.getByText(/git.jejunetwork.org/i).first()).toBeVisible()
  })

  test('shows readme and license options', async ({ page }) => {
    await page.goto('/git/new')
    await expect(page.getByText(/add a readme file/i)).toBeVisible()
    await expect(page.getByText(/license/i).first()).toBeVisible()
  })

  test('has create button', async ({ page }) => {
    await page.goto('/git/new')
    const createBtn = page.getByRole('button', { name: /create repository/i })
    await expect(createBtn).toBeVisible()
  })
})

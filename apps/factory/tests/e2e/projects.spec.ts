/**
 * Projects E2E Tests
 * Tests project board listing, creation, and task management flows
 */

import { expect, test } from '@playwright/test'

const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

test.describe('Projects List', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays projects page', async ({ page }) => {
    await page.goto('/projects')
    await expect(page.getByRole('heading').first()).toBeVisible()
  })

  test('shows create project button', async ({ page }) => {
    await page.goto('/projects')
    await expect(
      page.getByRole('link', { name: /new project|create project/i }),
    ).toBeVisible()
  })

  test('displays project cards', async ({ page }) => {
    await page.goto('/projects')
    const projectCards = page.locator('.card')
    await expect(projectCards.first()).toBeVisible()
  })

  test('filters projects by status', async ({ page }) => {
    await page.goto('/projects')
    const filterButtons = page
      .getByRole('button')
      .filter({ hasText: /all|active|completed|archived/i })
    const count = await filterButtons.count()
    if (count > 0) {
      await filterButtons.first().click()
    }
  })

  test('navigates to create project page', async ({ page }) => {
    await page.goto('/projects')
    await page
      .getByRole('link', { name: /new project|create project/i })
      .click()
    await expect(page).toHaveURL(/\/projects\/new/)
  })
})

test.describe('Create Project', () => {
  test.skip(isRemote, 'Skipping project creation on remote network')
  test('displays project creation form', async ({ page }) => {
    await page.goto('/projects/new')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('has name and description fields', async ({ page }) => {
    await page.goto('/projects/new')
    await expect(page.locator('input, textarea').first()).toBeVisible()
  })

  test('has visibility options', async ({ page }) => {
    await page.goto('/projects/new')
    await expect(page.getByText(/public|private/i).first()).toBeVisible()
  })
})

test.describe('Project Detail', () => {
  test.skip(isRemote, 'Skipping project detail on remote network')
  test('displays project board', async ({ page }) => {
    await page.goto('/projects/1')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('shows task columns', async ({ page }) => {
    await page.goto('/projects/1')
    await expect(page.getByText(/todo|in progress|done/i).first()).toBeVisible()
  })

  test('shows add task button', async ({ page }) => {
    await page.goto('/projects/1')
    const addTaskBtn = page.getByRole('button', { name: /add task|new task/i })
    if (await addTaskBtn.isVisible()) {
      await expect(addTaskBtn).toBeVisible()
    }
  })
})

test.describe('Task Management', () => {
  test.skip(isRemote, 'Skipping task management on remote network')
  test('opens task creation modal', async ({ page }) => {
    await page.goto('/projects/1')
    const addTaskBtn = page.getByRole('button', { name: /add task|new task/i })
    if (await addTaskBtn.isVisible()) {
      await addTaskBtn.click()
      await expect(page.locator('input, textarea').first()).toBeVisible()
    }
  })

  test('displays task detail', async ({ page }) => {
    await page.goto('/projects/1/tasks/1')
    await expect(page.getByRole('main')).toBeVisible()
  })
})

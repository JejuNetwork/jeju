import { basicSetup, test } from '@jejunetwork/tests'
import type { BrowserContext, Page } from '@playwright/test'
import { MetaMask } from '@synthetixio/synpress/playwright'

const { expect } = test

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
  await page.waitForLoadState('domcontentloaded')

  const connectBtn = page.locator('#connect')
  if (await connectBtn.isVisible()) {
    await connectBtn.click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  }

  return metamask
}

async function createTodo(
  page: Page,
  metamask: MetaMask,
  title: string,
  priority: 'low' | 'medium' | 'high' = 'medium',
): Promise<void> {
  await page.locator('#todo-input').fill(title)
  await page.locator('#priority-select').selectOption(priority)
  await page.locator('button[type="submit"]').click()

  // Sign the message in MetaMask
  await page.waitForTimeout(500)
  await metamask.confirmSignature()

  // Wait for todo to appear
  await expect(page.getByText(title)).toBeVisible({ timeout: 15000 })
}

test.describe('Create Todo', () => {
  test('creates a new todo with default priority', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    const todoTitle = `Test Todo ${Date.now()}`
    await createTodo(page, metamask, todoTitle)

    // Verify todo appears in list
    await expect(page.getByText(todoTitle)).toBeVisible()

    // Verify priority badge shows "medium" (default)
    await expect(page.getByText('medium').first()).toBeVisible()
  })

  test('creates a high priority todo', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    const todoTitle = `High Priority Todo ${Date.now()}`
    await createTodo(page, metamask, todoTitle, 'high')

    await expect(page.getByText(todoTitle)).toBeVisible()
    await expect(page.getByText('high').first()).toBeVisible()
  })

  test('creates a low priority todo', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    const todoTitle = `Low Priority Todo ${Date.now()}`
    await createTodo(page, metamask, todoTitle, 'low')

    await expect(page.getByText(todoTitle)).toBeVisible()
    await expect(page.getByText('low').first()).toBeVisible()
  })

  test('clears input after creating todo', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    const todoTitle = `Clear Input Test ${Date.now()}`
    await createTodo(page, metamask, todoTitle)

    // Input should be cleared after submit
    await expect(page.locator('#todo-input')).toHaveValue('')
  })
})

test.describe('Toggle Todo Completion', () => {
  test('marks a todo as complete', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    const todoTitle = `Toggle Test ${Date.now()}`
    await createTodo(page, metamask, todoTitle)

    // Find the checkbox for this todo
    const todoItem = page.locator('li').filter({ hasText: todoTitle })
    const checkbox = todoItem.locator('input[type="checkbox"]')

    // Click to complete
    await checkbox.click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()

    // Verify checkbox is checked after reload
    await page.waitForTimeout(2000)
    await expect(checkbox).toBeChecked()
  })

  test('unchecks a completed todo', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    const todoTitle = `Uncheck Test ${Date.now()}`
    await createTodo(page, metamask, todoTitle)

    const todoItem = page.locator('li').filter({ hasText: todoTitle })
    const checkbox = todoItem.locator('input[type="checkbox"]')

    // Complete then uncomplete
    await checkbox.click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)

    await checkbox.click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)

    await expect(checkbox).not.toBeChecked()
  })
})

test.describe('Filter Todos', () => {
  test('filters by pending todos', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    // Create two todos
    const pendingTodo = `Pending Filter ${Date.now()}`
    const completedTodo = `Completed Filter ${Date.now()}`

    await createTodo(page, metamask, pendingTodo)
    await createTodo(page, metamask, completedTodo)

    // Complete one todo
    const completedItem = page.locator('li').filter({ hasText: completedTodo })
    await completedItem.locator('input[type="checkbox"]').click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)

    // Click "Pending" filter
    await page.getByRole('button', { name: 'Pending' }).click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)

    // Only pending todo should be visible
    await expect(page.getByText(pendingTodo)).toBeVisible()
    await expect(page.getByText(completedTodo)).not.toBeVisible()
  })

  test('filters by completed todos', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    const completedTodo = `Completed Only ${Date.now()}`
    await createTodo(page, metamask, completedTodo)

    // Complete the todo
    const todoItem = page.locator('li').filter({ hasText: completedTodo })
    await todoItem.locator('input[type="checkbox"]').click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)

    // Click "Completed" filter
    await page.getByRole('button', { name: 'Completed' }).click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)

    // Completed todo should be visible
    await expect(page.getByText(completedTodo)).toBeVisible()
  })

  test('shows all todos with All filter', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    const todo1 = `All Filter 1 ${Date.now()}`
    const todo2 = `All Filter 2 ${Date.now()}`

    await createTodo(page, metamask, todo1)
    await createTodo(page, metamask, todo2)

    // Click "All" filter
    await page.getByRole('button', { name: 'All' }).click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)

    // Both should be visible
    await expect(page.getByText(todo1)).toBeVisible()
    await expect(page.getByText(todo2)).toBeVisible()
  })
})

test.describe('Delete Todo', () => {
  test('deletes a todo', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    const todoTitle = `Delete Test ${Date.now()}`
    await createTodo(page, metamask, todoTitle)

    // Verify todo exists
    await expect(page.getByText(todoTitle)).toBeVisible()

    // Click delete button
    const todoItem = page.locator('li').filter({ hasText: todoTitle })
    await todoItem.locator('[data-delete]').click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)

    // Todo should be gone
    await expect(page.getByText(todoTitle)).not.toBeVisible()
  })
})

test.describe('Encrypt Todo', () => {
  test('encrypts a todo', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    const todoTitle = `Encrypt Test ${Date.now()}`
    await createTodo(page, metamask, todoTitle)

    // Click encrypt button
    const todoItem = page.locator('li').filter({ hasText: todoTitle })
    await todoItem.locator('[data-encrypt]').click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)

    // Should show encrypted indicator
    await expect(todoItem.getByText('Encrypted')).toBeVisible()

    // Encrypt button should no longer be visible
    await expect(todoItem.locator('[data-encrypt]')).not.toBeVisible()
  })
})

test.describe('Full User Journey', () => {
  test('complete todo lifecycle: create, complete, filter, delete', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = await connectWallet(
      page,
      context,
      metamaskPage,
      extensionId,
    )

    // Step 1: Create a todo
    const todoTitle = `Journey ${Date.now()}`
    await createTodo(page, metamask, todoTitle, 'high')
    await expect(page.getByText(todoTitle)).toBeVisible()
    console.log('Step 1: Created todo')

    // Step 2: Mark as complete
    const todoItem = page.locator('li').filter({ hasText: todoTitle })
    await todoItem.locator('input[type="checkbox"]').click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)
    await expect(todoItem.locator('input[type="checkbox"]')).toBeChecked()
    console.log('Step 2: Marked as complete')

    // Step 3: Filter to completed
    await page.getByRole('button', { name: 'Completed' }).click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)
    await expect(page.getByText(todoTitle)).toBeVisible()
    console.log('Step 3: Filtered to completed')

    // Step 4: Switch back to All
    await page.getByRole('button', { name: 'All' }).click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)
    await expect(page.getByText(todoTitle)).toBeVisible()
    console.log('Step 4: Switched to All filter')

    // Step 5: Delete the todo
    await todoItem.locator('[data-delete]').click()
    await page.waitForTimeout(500)
    await metamask.confirmSignature()
    await page.waitForTimeout(2000)
    await expect(page.getByText(todoTitle)).not.toBeVisible()
    console.log('Step 5: Deleted todo')

    // Step 6: Disconnect wallet
    await page.locator('#disconnect').click()
    await expect(page.locator('#connect')).toBeVisible()
    console.log('Step 6: Disconnected wallet')
  })
})

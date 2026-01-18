/**
 * Blockchain Verification E2E Tests
 * Tests on-chain state verification after transactions
 */

import type { Page } from '@playwright/test'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const execAsync = promisify(exec)
const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

async function openWalletLogin(page: Page): Promise<void> {
  await page.getByRole('button', { name: /sign in/i }).click()
  const walletOption = page.getByRole('button', { name: /connect wallet/i })
  if (await walletOption.isVisible().catch(() => false)) {
    await walletOption.click()
  }
}

async function runJejuCLI(command: string): Promise<string> {
  const workspaceRoot = process.cwd().replace(/\/apps\/factory.*$/, '')
  const { stdout, stderr } = await execAsync(
    `bun run packages/cli/src/index.ts ${command}`,
    { cwd: workspaceRoot },
  )
  if (stderr && !stderr.includes('warning')) {
    throw new Error(stderr)
  }
  return stdout.trim()
}

test.describe('Bounty On-Chain State', () => {
  test('verifies bounty exists on-chain after creation', async ({
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
    await openWalletLogin(page)

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/bounties/new')
    const bountyTitle = `E2E Verify Bounty ${Date.now()}`

    await page.getByLabel(/title/i).fill(bountyTitle)
    await page.getByLabel(/description/i).fill('Verification test bounty')
    await page.getByLabel(/reward/i).fill('0.01')

    await page.getByRole('button', { name: /create bounty/i }).click()
    await metamask.confirmTransaction()

    await page.waitForURL(/\/bounties\/(\d+)/, { timeout: 30000 })
    const bountyId = page.url().match(/\/bounties\/(\d+)/)?.[1]

    expect(bountyId).toBeDefined()

    const cliOutput = await runJejuCLI(
      `bounty get ${bountyId} --network localnet`,
    )

    expect(cliOutput).toContain(bountyTitle)
    expect(cliOutput).toContain('status: Open')
    expect(cliOutput).toContain('reward: 0.01')
  })

  test('verifies bounty status changes on-chain', async ({
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
    await openWalletLogin(page)

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/bounties/1')
    await page.getByRole('button', { name: /apply/i }).click()
    await page.getByLabel(/proposal/i).fill('I will complete this')
    await page.getByRole('button', { name: /submit/i }).click()
    await metamask.confirmTransaction()

    await page.waitForTimeout(5000)

    const cliOutput = await runJejuCLI(
      `bounty applications 1 --network localnet`,
    )

    expect(cliOutput).toContain('applicant:')
    expect(cliOutput).toContain('proposal: I will complete this')
  })

  test('verifies bounty completion on-chain', async ({
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

    const bountyStatus = await runJejuCLI(`bounty get 1 --network localnet`)

    if (bountyStatus.includes('status: InProgress')) {
      await page.goto('/')
      await openWalletLogin(page)

      const metamaskOption = page.getByText(/metamask/i)
      if (await metamaskOption.isVisible()) {
        await metamaskOption.click()
      }

      await metamask.connectToDapp()

      await page.goto('/bounties/1')
      await page.getByRole('button', { name: /submit work/i }).click()
      await page.getByLabel(/url/i).fill('https://github.com/test/submission')
      await page.getByRole('button', { name: /submit/i }).click()
      await metamask.confirmTransaction()

      await page.waitForTimeout(5000)

      const submissionOutput = await runJejuCLI(
        `bounty submissions 1 --network localnet`,
      )
      expect(submissionOutput).toContain('https://github.com/test/submission')
    }
  })
})

test.describe('Model Registry On-Chain State', () => {
  test('verifies model registration on-chain', async ({
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
    await openWalletLogin(page)

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    const modelName = `test-model-${Date.now()}`
    await page.goto('/models/upload')

    await page.getByLabel(/name/i).fill(modelName)
    await page.getByLabel(/type/i).selectOption('llm')
    await page.getByLabel(/description/i).fill('E2E test model')

    await page.getByRole('button', { name: /register/i }).click()
    await metamask.confirmTransaction()

    await page.waitForTimeout(5000)

    const cliOutput = await runJejuCLI(
      `model get ${modelName} --network localnet`,
    )

    expect(cliOutput).toContain(modelName)
    expect(cliOutput).toContain('type: LLM')
  })
})

test.describe('Container Registry On-Chain State', () => {
  test('verifies container registration on-chain', async ({
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
    await openWalletLogin(page)

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    const containerName = `test-container-${Date.now()}`
    await page.goto('/containers/push')

    await page.getByLabel(/name/i).fill(containerName)
    await page.getByLabel(/tag/i).fill('latest')

    await page.getByRole('button', { name: /register/i }).click()
    await metamask.confirmTransaction()

    await page.waitForTimeout(5000)

    const cliOutput = await runJejuCLI(
      `container get ${containerName} --network localnet`,
    )

    expect(cliOutput).toContain(containerName)
    expect(cliOutput).toContain('tag: latest')
  })
})

test.describe('Guardian Registry On-Chain State', () => {
  test('verifies guardian registration on-chain', async ({
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
    await openWalletLogin(page)

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/guardians')
    await page.getByRole('button', { name: /register as guardian/i }).click()

    await page.getByLabel(/stake/i).fill('0.1')
    await page.getByRole('button', { name: /stake and register/i }).click()
    await metamask.confirmTransaction()

    await page.waitForTimeout(5000)

    const addressText = await page.locator('[class*="address"]').textContent()
    const address = addressText?.match(/0x[a-fA-F0-9]+/)?.[0]

    const cliOutput = await runJejuCLI(
      `guardian get ${address} --network localnet`,
    )

    expect(cliOutput).toContain('status: Active')
    expect(cliOutput).toContain('stake: 0.1')
  })

  test('verifies guardian vote on-chain', async ({
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
    await openWalletLogin(page)

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/bounties/1')
    await page.getByRole('button', { name: /review/i }).click()
    await page.getByRole('button', { name: /approve/i }).click()
    await metamask.confirmTransaction()

    await page.waitForTimeout(5000)

    const cliOutput = await runJejuCLI(`bounty votes 1 --network localnet`)

    expect(cliOutput).toContain('vote: Approve')
  })
})

test.describe('Project Board On-Chain State', () => {
  test('verifies project creation on-chain', async ({
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
    await openWalletLogin(page)

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    const projectName = `E2E Project ${Date.now()}`
    await page.goto('/projects/new')

    await page.getByLabel(/name/i).fill(projectName)
    await page.getByLabel(/description/i).fill('E2E test project')

    await page.getByRole('button', { name: /create project/i }).click()
    await metamask.confirmTransaction()

    await page.waitForURL(/\/projects\/(\d+)/, { timeout: 30000 })
    const projectId = page.url().match(/\/projects\/(\d+)/)?.[1]

    const cliOutput = await runJejuCLI(
      `project get ${projectId} --network localnet`,
    )

    expect(cliOutput).toContain(projectName)
    expect(cliOutput).toContain('status: Active')
  })

  test('verifies task creation on-chain', async ({
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
    await openWalletLogin(page)

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    const taskTitle = `E2E Task ${Date.now()}`
    await page.goto('/projects/1')

    await page.getByRole('button', { name: /add task/i }).click()
    await page.getByLabel(/title/i).fill(taskTitle)

    await page.getByRole('button', { name: /create task/i }).click()
    await metamask.confirmTransaction()

    await page.waitForTimeout(5000)

    const cliOutput = await runJejuCLI(`project tasks 1 --network localnet`)

    expect(cliOutput).toContain(taskTitle)
  })
})

test.describe('Transaction Receipts Verification', () => {
  test('captures and verifies transaction receipt', async ({
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
    await openWalletLogin(page)

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    let txHash: string | undefined

    page.on('console', (msg) => {
      const text = msg.text()
      const match = text.match(/0x[a-fA-F0-9]{64}/)
      if (match) {
        txHash = match[0]
      }
    })

    await page.goto('/bounties/new')
    await page.getByLabel(/title/i).fill('TX Verify Bounty')
    await page.getByLabel(/description/i).fill('Test')
    await page.getByLabel(/reward/i).fill('0.001')

    await page.getByRole('button', { name: /create bounty/i }).click()
    await metamask.confirmTransaction()

    await page.waitForTimeout(5000)

    if (txHash) {
      const cliOutput = await runJejuCLI(`tx get ${txHash} --network localnet`)

      expect(cliOutput).toContain('status: success')
      expect(cliOutput).toContain('blockNumber:')
    }
  })
})

test.describe('Event Logs Verification', () => {
  test('verifies BountyCreated event emitted', async ({
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
    await openWalletLogin(page)

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/bounties/new')
    await page.getByLabel(/title/i).fill('Event Test Bounty')
    await page.getByLabel(/description/i).fill('Test')
    await page.getByLabel(/reward/i).fill('0.001')

    await page.getByRole('button', { name: /create bounty/i }).click()
    await metamask.confirmTransaction()

    await page.waitForURL(/\/bounties\/(\d+)/, { timeout: 30000 })
    const bountyId = page.url().match(/\/bounties\/(\d+)/)?.[1]

    const cliOutput = await runJejuCLI(
      `events BountyCreated --bountyId ${bountyId} --network localnet`,
    )

    expect(cliOutput).toContain('BountyCreated')
    expect(cliOutput).toContain(`bountyId: ${bountyId}`)
  })
})

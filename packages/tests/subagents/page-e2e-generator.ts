#!/usr/bin/env bun
/**
 * Page E2E Test Generator
 *
 * Scans app pages and generates comprehensive E2E tests for:
 * - All pages and routes
 * - Form submissions
 * - Button clicks and actions
 * - Wallet interactions (connect, sign, transactions)
 * - Navigation flows
 *
 * Usage:
 *   bun run packages/tests/subagents/page-e2e-generator.ts
 *   jeju test generate --app gateway
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import type { FormInfo, PageAction, PageInfo, WalletInteraction } from './types'

interface GeneratorConfig {
  rootDir: string
  targetApp?: string
  outputDir?: string
  force?: boolean
}

// Patterns to detect React components that are pages
const PAGE_PATTERNS = [
  /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+Page)/,
  /export\s+(?:default\s+)?(?:const|let)\s+(\w+Page)\s*=/,
  /export\s+(?:default\s+)?(?:const|let)\s+(\w+)\s*=\s*\(\s*\)\s*=>/,
]

// Patterns to detect wallet interactions
const WALLET_PATTERNS = {
  connect: [
    /useConnect\(/,
    /connectWallet/i,
    /ConnectButton/,
    /RainbowKitProvider/,
  ],
  sign: [/signMessage/, /signTypedData/, /useSignMessage/, /useSignTypedData/],
  transaction: [
    /sendTransaction/,
    /writeContract/,
    /useSendTransaction/,
    /useWriteContract/,
    /useContractWrite/,
  ],
  switch_network: [/switchNetwork/, /useSwitchNetwork/, /switchChain/],
}

function findMonorepoRoot(): string {
  let dir = process.cwd()
  while (dir !== '/') {
    if (
      existsSync(join(dir, 'bun.lock')) &&
      existsSync(join(dir, 'packages'))
    ) {
      return dir
    }
    dir = join(dir, '..')
  }
  return process.cwd()
}

function findPageFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files

  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (
        entry.name !== 'node_modules' &&
        !entry.name.startsWith('.') &&
        entry.name !== 'dist' &&
        entry.name !== 'build'
      ) {
        findPageFiles(fullPath, files)
      }
    } else if (
      (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) &&
      !entry.name.endsWith('.test.tsx') &&
      !entry.name.endsWith('.spec.tsx')
    ) {
      files.push(fullPath)
    }
  }

  return files
}

function analyzePage(filePath: string): PageInfo | null {
  const content = readFileSync(filePath, 'utf-8')
  const fileName = basename(filePath, '.tsx')

  // Skip non-page components
  const isPage =
    filePath.includes('/pages/') ||
    filePath.includes('/app/') ||
    filePath.includes('Page.tsx') ||
    filePath.includes('page.tsx') ||
    PAGE_PATTERNS.some((p) => p.test(content))

  if (!isPage) return null

  // Extract route from file path
  let route = '/'
  if (filePath.includes('/pages/')) {
    route =
      filePath
        .split('/pages/')[1]
        ?.replace(/\.tsx?$/, '')
        .replace(/index$/, '') ?? '/'
  } else if (filePath.includes('/app/')) {
    const appPart = filePath.split('/app/')[1] ?? ''
    route = `/${appPart.replace(/\/page\.tsx?$/, '').replace(/\(.*?\)\//g, '')}`
  }

  // Detect wallet interactions
  const walletInteractions: WalletInteraction[] = []
  for (const [type, patterns] of Object.entries(WALLET_PATTERNS)) {
    if (patterns.some((p) => p.test(content))) {
      walletInteractions.push({
        type: type as WalletInteraction['type'],
        description: `${type} interaction detected`,
        testCovered: false,
      })
    }
  }

  // Detect forms
  const forms: FormInfo[] = []
  const formMatches = content.match(/<form[^>]*>[\s\S]*?<\/form>/gi) ?? []
  for (const formMatch of formMatches) {
    const nameMatch = formMatch.match(/name=['"]([^'"]+)['"]/i)
    const inputMatches =
      formMatch.match(/<input[^>]*name=['"]([^'"]+)['"]/gi) ?? []
    const fields = inputMatches.map((m) => {
      const fieldName = m.match(/name=['"]([^'"]+)['"]/i)?.[1]
      return fieldName ?? 'unknown'
    })

    forms.push({
      name: nameMatch?.[1] ?? 'form',
      fields,
      submitAction: 'submit',
      validationRules: [],
      testCovered: false,
    })
  }

  // Detect button actions
  const actions: PageAction[] = []
  const buttonMatches =
    content.match(/<[Bb]utton[^>]*>[\s\S]*?<\/[Bb]utton>/gi) ?? []
  for (const buttonMatch of buttonMatches) {
    const textMatch = buttonMatch.match(/>([^<]+)</)?.[1]?.trim()
    if (textMatch && textMatch.length < 50) {
      actions.push({
        name: textMatch,
        selector: `button:has-text("${textMatch}")`,
        type: 'click',
        testCovered: false,
      })
    }
  }

  // Add wallet-specific actions
  if (walletInteractions.some((w) => w.type === 'connect')) {
    actions.push({
      name: 'Connect Wallet',
      selector: 'button:has-text(/connect/i)',
      type: 'wallet',
      testCovered: false,
    })
  }

  return {
    path: filePath,
    route,
    component: fileName,
    hasTest: false,
    actions,
    forms,
    walletInteractions,
  }
}

function generateTestCode(page: PageInfo, _appName: string): string {
  const hasWallet = page.walletInteractions.length > 0

  let imports = `import { expect } from '@playwright/test'
`

  if (hasWallet) {
    imports = `import { test, expect, connectAndVerify, approveTransaction, signMessage, basicSetup, walletPassword } from '@jejunetwork/tests'
import { MetaMask } from '@synthetixio/synpress/playwright'
`
  } else {
    imports = `import { test, expect } from '@playwright/test'
`
  }

  let testCode = `${imports}
/**
 * E2E Tests for ${page.component}
 * Route: ${page.route}
 * Generated by jeju test generate
 */

test.describe('${page.component}', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('${page.route}')
  })

  test('should load page correctly', async ({ page }) => {
    await expect(page).toHaveURL(/${page.route.replace(/\//g, '\\/')}/)
    // TODO: Add more specific assertions
  })
`

  // Generate wallet tests
  if (hasWallet) {
    const hasConnect = page.walletInteractions.some((w) => w.type === 'connect')
    const hasSign = page.walletInteractions.some((w) => w.type === 'sign')
    const hasTx = page.walletInteractions.some((w) => w.type === 'transaction')

    if (hasConnect) {
      testCode += `
  test('should connect wallet', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId)
    await connectAndVerify(page, metamask)
    
    // Verify connected state
    await expect(page.getByText(/0x/)).toBeVisible()
  })
`
    }

    if (hasSign) {
      testCode += `
  test('should sign message', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId)
    await connectAndVerify(page, metamask)
    
    // Trigger sign action (update selector)
    await page.click('button:has-text(/sign/i)')
    await signMessage(metamask)
    
    // Verify signature result
    // TODO: Add signature verification
  })
`
    }

    if (hasTx) {
      testCode += `
  test('should send transaction', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId)
    await connectAndVerify(page, metamask)
    
    // Trigger transaction (update selector)
    // TODO: Fill in transaction form if needed
    await page.click('button:has-text(/submit|confirm|send/i)')
    await approveTransaction(metamask)
    
    // Verify transaction result
    // TODO: Add transaction confirmation check
  })
`
    }
  }

  // Generate form tests
  for (const form of page.forms) {
    testCode += `
  test('should submit ${form.name} form', async ({ page }) => {
    // Fill form fields
${form.fields.map((field) => `    await page.fill('input[name="${field}"]', 'test-value')`).join('\n')}
    
    // Submit form
    await page.click('button[type="submit"]')
    
    // Verify submission
    // TODO: Add submission verification
  })

  test('should validate ${form.name} form', async ({ page }) => {
    // Submit empty form
    await page.click('button[type="submit"]')
    
    // Check for validation errors
    // TODO: Add validation error checks
  })
`
  }

  // Generate action tests
  for (const action of page.actions.filter((a) => a.type === 'click')) {
    testCode += `
  test('should handle ${action.name} action', async ({ page }) => {
    await page.click('${action.selector}')
    
    // Verify action result
    // TODO: Add action verification
  })
`
  }

  testCode += `})
`

  return testCode
}

function generateWalletSetup(): string {
  return `import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'
import { PASSWORD, SEED_PHRASE, JEJU_CHAIN } from '@jejunetwork/tests'

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD)
  
  // Import wallet
  await metamask.importWallet(SEED_PHRASE)
  
  // Add and switch to Jeju localnet
  await metamask.addNetwork({
    name: JEJU_CHAIN.name,
    rpcUrl: JEJU_CHAIN.rpcUrl,
    chainId: JEJU_CHAIN.chainId,
    symbol: JEJU_CHAIN.symbol,
    blockExplorerUrl: JEJU_CHAIN.blockExplorerUrl ?? '',
  })
  await metamask.switchNetwork(JEJU_CHAIN.name)
})

export { PASSWORD }
`
}

async function generateTests(config: GeneratorConfig): Promise<void> {
  const rootDir = config.rootDir
  const appsDir = join(rootDir, 'apps')

  // Get target apps
  const appNames = config.targetApp
    ? [config.targetApp]
    : readdirSync(appsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)

  console.log(`🔧 Generating E2E tests for ${appNames.length} apps...\n`)

  for (const appName of appNames) {
    const appPath = join(appsDir, appName)
    if (!existsSync(join(appPath, 'package.json'))) continue

    console.log(`📱 Processing ${appName}...`)

    // Find pages
    const pageFiles = findPageFiles(join(appPath, 'src'))
      .concat(findPageFiles(join(appPath, 'app')))
      .concat(findPageFiles(join(appPath, 'pages')))

    const pages = pageFiles
      .map(analyzePage)
      .filter((p): p is PageInfo => p !== null)

    if (pages.length === 0) {
      console.log(`  No pages found in ${appName}`)
      continue
    }

    console.log(`  Found ${pages.length} pages`)

    // Create test directory
    const testDir = config.outputDir || join(appPath, 'tests', 'synpress')
    const walletSetupDir = join(appPath, 'tests', 'wallet-setup')

    mkdirSync(testDir, { recursive: true })
    mkdirSync(walletSetupDir, { recursive: true })

    // Check for existing tests
    const existingTests = new Set(
      existsSync(testDir)
        ? readdirSync(testDir).filter((f) => f.endsWith('.spec.ts'))
        : [],
    )

    let generated = 0
    let skipped = 0

    for (const page of pages) {
      const testFileName = `${page.component.replace(/Page$/, '').toLowerCase()}.spec.ts`
      const testPath = join(testDir, testFileName)

      if (existingTests.has(testFileName) && !config.force) {
        skipped++
        continue
      }

      const testCode = generateTestCode(page, appName)
      writeFileSync(testPath, testCode)
      generated++
      console.log(`  ✅ Generated ${testFileName}`)
    }

    // Generate wallet setup if any page has wallet interactions
    const hasWalletPages = pages.some((p) => p.walletInteractions.length > 0)
    if (hasWalletPages) {
      const walletSetupPath = join(walletSetupDir, 'basic.setup.ts')
      if (!existsSync(walletSetupPath) || config.force) {
        writeFileSync(walletSetupPath, generateWalletSetup())
        console.log(`  ✅ Generated wallet-setup/basic.setup.ts`)
      }
    }

    // Generate synpress.config.ts if missing
    const synpressConfigPath = join(appPath, 'synpress.config.ts')
    if (!existsSync(synpressConfigPath)) {
      const manifest = existsSync(join(appPath, 'jeju-manifest.json'))
        ? JSON.parse(readFileSync(join(appPath, 'jeju-manifest.json'), 'utf-8'))
        : { ports: { main: 3000 } }

      const port = manifest.ports?.main ?? 3000
      const configCode = `import { createSynpressConfig, createWalletSetup } from '@jejunetwork/tests'

const PORT = parseInt(process.env.${appName.toUpperCase().replace(/-/g, '_')}_PORT || '${port}', 10)

export default createSynpressConfig({
  appName: '${appName}',
  port: PORT,
  testDir: './tests/synpress',
  overrides: {
    timeout: 180000,
  },
})

export const basicSetup = createWalletSetup()
`
      writeFileSync(synpressConfigPath, configCode)
      console.log(`  ✅ Generated synpress.config.ts`)
    }

    console.log(`  Summary: ${generated} generated, ${skipped} skipped\n`)
  }

  console.log('✅ E2E test generation complete')
}

// Main execution
const args = process.argv.slice(2)
const appIndex = args.findIndex((a) => a === '--app' || a === '-a')

const config: GeneratorConfig = {
  rootDir: findMonorepoRoot(),
  targetApp: appIndex >= 0 ? args[appIndex + 1] : undefined,
  force: args.includes('--force'),
}

generateTests(config).catch((error) => {
  console.error('Test generation failed:', error)
  process.exit(1)
})

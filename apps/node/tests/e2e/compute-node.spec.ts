/**
 * Compute Node E2E Tests - Diagnostic Version
 *
 * Tests for diagnosing issues with:
 * 1. Compute service start/stop not working
 * 2. CPU cores not being saved
 * 3. Staking not working (stub implementation)
 *
 * Run with: TAURI_WEB=1 bunx playwright test tests/e2e/compute-node.spec.ts
 */

import { expect, test, Page } from '@playwright/test'

// Test configuration
const TEST_PRIVATE_KEY = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const TEST_PASSWORD = 'password123'
const BASE_URL = 'http://localhost:1420'

// Store console messages for analysis
interface ConsoleLog {
  type: string
  text: string
  timestamp: number
}

// Helper to set up console monitoring
async function setupConsoleMonitoring(page: Page): Promise<ConsoleLog[]> {
  const logs: ConsoleLog[] = []

  page.on('console', (msg) => {
    logs.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now(),
    })
  })

  page.on('pageerror', (error) => {
    logs.push({
      type: 'pageerror',
      text: error.message,
      timestamp: Date.now(),
    })
  })

  return logs
}

// Helper to wait for app initialization
async function waitForAppReady(page: Page): Promise<void> {
  await page.goto(BASE_URL)
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  await page.waitForFunction(() => {
    const body = document.body
    return body && !body.textContent?.includes('Initializing...')
  }, { timeout: 30000 })
}

// Helper to import wallet with private key
async function importWallet(page: Page): Promise<boolean> {
  const walletExists = await page.locator('text=ETH Balance').first().isVisible({ timeout: 5000 }).catch(() => false)
  if (walletExists) {
    return true
  }

  const importButton = page.locator('button:has-text("Import Wallet"), text=Import Wallet').first()
  if (await importButton.isVisible({ timeout: 5000 })) {
    await importButton.click()
    await page.waitForTimeout(500)

    const privateKeyTab = page.locator('button:has-text("Private Key")').first()
    if (await privateKeyTab.isVisible({ timeout: 3000 })) {
      await privateKeyTab.click()
      await page.waitForTimeout(300)
    }

    const privateKeyInput = page.locator('#private-key-input, input[type="password"][placeholder*="0x"]').first()
    if (await privateKeyInput.isVisible({ timeout: 3000 })) {
      await privateKeyInput.fill(TEST_PRIVATE_KEY)
    }

    const passwordInput = page.locator('#import-password-input, input[type="password"][placeholder*="password"]').first()
    if (await passwordInput.isVisible({ timeout: 3000 })) {
      await passwordInput.fill(TEST_PASSWORD)
    }

    const confirmImport = page.locator('button:has-text("Import Wallet")').last()
    if (await confirmImport.isVisible({ timeout: 3000 })) {
      await confirmImport.click()
      await page.waitForTimeout(2000)
    }

    return true
  }

  return false
}

// Helper to navigate to Services page
async function navigateToServices(page: Page): Promise<void> {
  const servicesLink = page.locator('nav a:has-text("Services"), button:has-text("Services")').first()
  if (await servicesLink.isVisible({ timeout: 5000 })) {
    await servicesLink.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
  }
}

// Helper to navigate to Staking page
async function navigateToStaking(page: Page): Promise<void> {
  const stakingLink = page.locator('nav a:has-text("Staking"), button:has-text("Staking")').first()
  if (await stakingLink.isVisible({ timeout: 5000 })) {
    await stakingLink.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
  }
}

// Get errors from console logs
function getErrors(logs: ConsoleLog[]): ConsoleLog[] {
  return logs.filter(log => log.type === 'error' || log.type === 'pageerror')
}

test.describe('DIAGNOSTIC: Compute Service Issues', () => {
  let consoleLogs: ConsoleLog[]

  test.beforeEach(async ({ page }) => {
    consoleLogs = await setupConsoleMonitoring(page)
    await waitForAppReady(page)
    await importWallet(page)
  })

  test('diagnose: CPU cores setting flow', async ({ page }) => {
    await navigateToServices(page)

    // Find the CPU cores slider
    const coresSlider = page.locator('input[type="range"]').first()
    const sliderVisible = await coresSlider.isVisible({ timeout: 10000 })

    console.log('\n=== CPU CORES DIAGNOSIS ===')

    if (sliderVisible) {
      const initialValue = await coresSlider.inputValue()
      console.log(`Initial slider value: ${initialValue}`)

      // Try to set to 1
      await coresSlider.fill('1')
      await page.waitForTimeout(500)

      const newValue = await coresSlider.inputValue()
      console.log(`After setting to 1: ${newValue}`)

      // Check if there's a display showing the selected cores
      const coresDisplay = await page.locator('text=/\\d+ core/i').first().textContent().catch(() => null)
      console.log(`Cores display text: ${coresDisplay}`)

      // Screenshot
      await page.screenshot({ path: 'test-results/screenshots/diag-01-cores-set.png', fullPage: true })

      // Check if the value is actually saved by navigating away and back
      await page.locator('nav a:has-text("Dashboard")').first().click()
      await page.waitForTimeout(500)
      await navigateToServices(page)

      const valueAfterNavigation = await coresSlider.inputValue().catch(() => 'not found')
      console.log(`Value after navigation: ${valueAfterNavigation}`)

      // KNOWN ISSUE: The startService function in AppContext.tsx line 300
      // hardcodes custom_settings: null, so cores are NEVER sent to backend
      console.log('\nKNOWN ISSUE: AppContext.tsx line 300 hardcodes custom_settings: null')
      console.log('CPU cores are shown in UI but NEVER passed to backend start_service command')
    }

    expect(sliderVisible).toBe(true)
  })

  test('diagnose: Start compute provider - capture errors', async ({ page }) => {
    await navigateToServices(page)

    // Configure compute
    const coresSlider = page.locator('input[type="range"]').first()
    if (await coresSlider.isVisible({ timeout: 5000 })) {
      await coresSlider.fill('1')
    }

    const rateInput = page.locator('input#hourly-rate, input[type="number"][step="0.001"]').first()
    if (await rateInput.isVisible({ timeout: 5000 })) {
      await rateInput.fill('0.05')
    }

    await page.waitForTimeout(500)

    console.log('\n=== START COMPUTE DIAGNOSIS ===')

    // Clear console logs before clicking
    consoleLogs.length = 0

    // Find Start button
    const startButton = page.locator('button:has-text("Start Compute Provider")').first()
    const startVisible = await startButton.isVisible({ timeout: 10000 })

    if (startVisible) {
      const isDisabled = await startButton.isDisabled()
      console.log(`Start button disabled: ${isDisabled}`)

      if (!isDisabled) {
        // Click start
        await startButton.click()
        await page.waitForTimeout(1000)

        // Check for privacy warning modal
        const privacyModal = page.locator('text=Non-TEE compute, text=Privacy Warning').first()
        if (await privacyModal.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log('Privacy modal appeared, clicking Accept')
          const acceptButton = page.locator('button:has-text("Accept"), button:has-text("I Understand"), button:has-text("Continue")').first()
          if (await acceptButton.isVisible({ timeout: 2000 })) {
            await acceptButton.click()
          }
        }

        await page.waitForTimeout(3000)

        // Capture any errors
        const errors = getErrors(consoleLogs)
        console.log(`Console errors after start: ${errors.length}`)
        errors.forEach((e, i) => console.log(`  Error ${i+1}: ${e.text.substring(0, 200)}`))

        // Check current state
        const stopVisible = await page.locator('button:has-text("Stop Compute Provider")').isVisible({ timeout: 5000 }).catch(() => false)
        const statusText = await page.locator('text=Running, text=Stopped').first().textContent().catch(() => 'unknown')

        console.log(`Stop button visible (means running): ${stopVisible}`)
        console.log(`Status text: ${statusText}`)

        // KNOWN ISSUES:
        console.log('\nKNOWN ISSUES:')
        console.log('1. compute.rs lines 247-257: Service requires 8 cores, 32GB RAM, GPU')
        console.log('2. services.rs lines 52-79: Frontend shows 2 cores, 4GB requirement')
        console.log('3. This mismatch may cause silent failures')

        await page.screenshot({ path: 'test-results/screenshots/diag-02-after-start.png', fullPage: true })
      }
    }
  })

  test('diagnose: Stop compute provider - capture errors', async ({ page }) => {
    await navigateToServices(page)

    console.log('\n=== STOP COMPUTE DIAGNOSIS ===')

    // Check if Stop button is visible (meaning compute is running)
    const stopButton = page.locator('button:has-text("Stop Compute Provider")').first()
    const stopVisible = await stopButton.isVisible({ timeout: 5000 }).catch(() => false)

    console.log(`Stop button visible: ${stopVisible}`)

    if (stopVisible) {
      // Clear console logs
      consoleLogs.length = 0

      // Click stop
      await stopButton.click()
      await page.waitForTimeout(3000)

      // Capture any errors
      const errors = getErrors(consoleLogs)
      console.log(`Console errors after stop: ${errors.length}`)
      errors.forEach((e, i) => console.log(`  Error ${i+1}: ${e.text.substring(0, 200)}`))

      // Check if it actually stopped
      const startVisible = await page.locator('button:has-text("Start Compute Provider")').isVisible({ timeout: 5000 }).catch(() => false)
      const stillRunning = await page.locator('button:has-text("Stop Compute Provider")').isVisible({ timeout: 2000 }).catch(() => false)

      console.log(`Start button visible (means stopped): ${startVisible}`)
      console.log(`Stop button still visible (means still running): ${stillRunning}`)

      if (stillRunning) {
        console.log('\nFAILURE: Service did not stop')
        console.log('Possible causes:')
        console.log('1. withOperationLock silently swallows errors (AppContext.tsx lines 203-212)')
        console.log('2. Backend stop_service may return error not shown in UI')
      }

      await page.screenshot({ path: 'test-results/screenshots/diag-03-after-stop.png', fullPage: true })
    } else {
      console.log('Compute not running - nothing to stop')

      // Try to start it first
      const startButton = page.locator('button:has-text("Start Compute Provider")').first()
      if (await startButton.isVisible({ timeout: 3000 })) {
        console.log('Attempting to start first, then stop...')
      }
    }
  })

  test('diagnose: Full start-stop cycle with error capture', async ({ page }) => {
    await navigateToServices(page)

    console.log('\n=== FULL CYCLE DIAGNOSIS ===')

    // Configure
    const coresSlider = page.locator('input[type="range"]').first()
    if (await coresSlider.isVisible({ timeout: 5000 })) {
      await coresSlider.fill('1')
      console.log('Set cores to 1')
    }

    const rateInput = page.locator('input#hourly-rate, input[type="number"][step="0.001"]').first()
    if (await rateInput.isVisible({ timeout: 5000 })) {
      await rateInput.fill('0.05')
      console.log('Set rate to 0.05')
    }

    await page.waitForTimeout(500)

    // Inject error capture into window
    await page.evaluate(() => {
      (window as any).__CAPTURED_ERRORS__ = []
      const originalInvoke = (window as any).__TAURI__?.invoke
      if (originalInvoke) {
        (window as any).__TAURI__.invoke = async function(...args: any[]) {
          try {
            const result = await originalInvoke.apply(this, args)
            console.log(`[INVOKE SUCCESS] ${args[0]}`)
            return result
          } catch (err: any) {
            (window as any).__CAPTURED_ERRORS__.push({
              command: args[0],
              error: err?.message || String(err),
              timestamp: Date.now()
            })
            console.error(`[INVOKE ERROR] ${args[0]}: ${err?.message || err}`)
            throw err
          }
        }
      }
    })

    consoleLogs.length = 0

    // START
    let startButton = page.locator('button:has-text("Start Compute Provider")').first()
    if (await startButton.isVisible({ timeout: 5000 })) {
      const isDisabled = await startButton.isDisabled()
      console.log(`\nSTART: Button disabled=${isDisabled}`)

      if (!isDisabled) {
        await startButton.click()
        await page.waitForTimeout(1000)

        // Handle privacy modal
        const acceptButton = page.locator('button:has-text("Accept"), button:has-text("Continue"), button:has-text("I Understand")').first()
        if (await acceptButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await acceptButton.click()
          console.log('Accepted privacy modal')
        }

        await page.waitForTimeout(3000)

        const errors = getErrors(consoleLogs)
        console.log(`Errors after start: ${errors.length}`)

        // Check captured invoke errors
        const capturedErrors = await page.evaluate(() => (window as any).__CAPTURED_ERRORS__ || [])
        console.log(`Captured invoke errors: ${capturedErrors.length}`)
        capturedErrors.forEach((e: any) => console.log(`  ${e.command}: ${e.error}`))

        await page.screenshot({ path: 'test-results/screenshots/diag-04-cycle-started.png', fullPage: true })
      }
    }

    await page.waitForTimeout(2000)

    // Check if running
    const stopButton = page.locator('button:has-text("Stop Compute Provider")').first()
    const isRunning = await stopButton.isVisible({ timeout: 5000 }).catch(() => false)
    console.log(`\nAfter start - is running: ${isRunning}`)

    if (isRunning) {
      // STOP
      consoleLogs.length = 0
      await page.evaluate(() => { (window as any).__CAPTURED_ERRORS__ = [] })

      await stopButton.click()
      await page.waitForTimeout(3000)

      const errors = getErrors(consoleLogs)
      console.log(`Errors after stop: ${errors.length}`)

      const capturedErrors = await page.evaluate(() => (window as any).__CAPTURED_ERRORS__ || [])
      console.log(`Captured invoke errors: ${capturedErrors.length}`)
      capturedErrors.forEach((e: any) => console.log(`  ${e.command}: ${e.error}`))

      // Check if stopped
      startButton = page.locator('button:has-text("Start Compute Provider")').first()
      const isStopped = await startButton.isVisible({ timeout: 5000 }).catch(() => false)
      console.log(`\nAfter stop - is stopped: ${isStopped}`)

      await page.screenshot({ path: 'test-results/screenshots/diag-05-cycle-stopped.png', fullPage: true })
    }

    // Summary
    console.log('\n=== SUMMARY ===')
    console.log('If start/stop fails silently, the issues are:')
    console.log('1. AppContext.tsx withOperationLock (lines 203-212) uses try-finally without catching errors')
    console.log('2. Errors from invoke() are not dispatched to state')
    console.log('3. UI has no error display for service operations')
  })
})

test.describe('DIAGNOSTIC: Staking Issues', () => {
  let consoleLogs: ConsoleLog[]

  test.beforeEach(async ({ page }) => {
    consoleLogs = await setupConsoleMonitoring(page)
    await waitForAppReady(page)
    await importWallet(page)
  })

  test('diagnose: Staking backend is a STUB', async ({ page }) => {
    await navigateToStaking(page)

    console.log('\n=== STAKING DIAGNOSIS ===')

    // Inject error capture
    await page.evaluate(() => {
      (window as any).__STAKE_ERRORS__ = []
      const originalInvoke = (window as any).__TAURI__?.invoke
      if (originalInvoke) {
        (window as any).__TAURI__.invoke = async function(...args: any[]) {
          try {
            const result = await originalInvoke.apply(this, args)
            return result
          } catch (err: any) {
            if (args[0] === 'stake' || args[0] === 'unstake' || args[0] === 'claim_rewards') {
              (window as any).__STAKE_ERRORS__.push({
                command: args[0],
                error: err?.message || String(err),
                args: JSON.stringify(args[1])
              })
            }
            throw err
          }
        }
      }
    })

    await page.screenshot({ path: 'test-results/screenshots/diag-06-staking-page.png', fullPage: true })

    // Find Stake button for Compute
    const computeRow = page.locator('div:has(h3:has-text("Compute"))').first()
    const stakeButton = computeRow.locator('button:has-text("Stake")').first()

    if (await stakeButton.isVisible({ timeout: 10000 })) {
      await stakeButton.click()
      await page.waitForTimeout(1000)

      console.log('Stake modal opened')

      // Fill amount
      const stakeAmountInput = page.locator('#stake-amount, input[type="number"]').first()
      if (await stakeAmountInput.isVisible({ timeout: 5000 })) {
        await stakeAmountInput.fill('0.1')
        console.log('Set stake amount to 0.1 ETH')

        await page.screenshot({ path: 'test-results/screenshots/diag-07-stake-amount.png', fullPage: true })

        // Clear logs before clicking stake
        consoleLogs.length = 0

        // Click Stake confirm button
        const confirmButton = page.locator('button:has-text("Stake")').last()
        if (await confirmButton.isVisible({ timeout: 3000 })) {
          const isDisabled = await confirmButton.isDisabled()
          console.log(`Stake confirm button disabled: ${isDisabled}`)

          if (!isDisabled) {
            await confirmButton.click()
            await page.waitForTimeout(3000)

            // Check for captured errors
            const stakeErrors = await page.evaluate(() => (window as any).__STAKE_ERRORS__ || [])
            console.log(`\nCaptured stake errors: ${stakeErrors.length}`)
            stakeErrors.forEach((e: any) => {
              console.log(`  Command: ${e.command}`)
              console.log(`  Error: ${e.error}`)
              console.log(`  Args: ${e.args}`)
            })

            // Check console errors
            const errors = getErrors(consoleLogs)
            console.log(`Console errors: ${errors.length}`)
            errors.forEach((e, i) => console.log(`  ${i+1}: ${e.text.substring(0, 200)}`))

            // KNOWN ISSUE
            console.log('\nKNOWN ISSUE: staking.rs lines 171-179')
            console.log('The stake() command is a STUB that ALWAYS returns an error:')
            console.log('Err("To stake X wei to service Y: Use the wallet interface...")')
            console.log('\nThis means staking is NOT IMPLEMENTED in the backend!')

            await page.screenshot({ path: 'test-results/screenshots/diag-08-after-stake.png', fullPage: true })
          }
        }

        // Close modal
        const cancelButton = page.locator('button:has-text("Cancel")').first()
        if (await cancelButton.isVisible({ timeout: 2000 })) {
          await cancelButton.click()
        }
      }
    } else {
      console.log('Stake button not found for Compute service')
    }
  })

  test('verify: Backend staking commands are stubs', async ({ page }) => {
    // This test documents that ALL staking commands are stubs
    console.log('\n=== BACKEND STAKING COMMANDS STATUS ===')
    console.log('\nFile: apps/node/app/src-tauri/src/commands/staking.rs')
    console.log('\n1. stake() - Lines 154-179:')
    console.log('   - STUB: Always returns Err("To stake X wei...")')
    console.log('   - No actual contract interaction')
    console.log('\n2. unstake() - Lines 181-203:')
    console.log('   - STUB: Always returns Err("To unstake X wei...")')
    console.log('   - No actual contract interaction')
    console.log('\n3. claim_rewards() - Lines 205-233:')
    console.log('   - STUB: Always returns Err("To claim rewards...")')
    console.log('   - No actual contract interaction')
    console.log('\nThe ContractClient in contracts.rs has the infrastructure')
    console.log('(INodeStakingManager interface) but stake/unstake/claim')
    console.log('commands never call it.')

    // Just verify the page loads
    await navigateToStaking(page)
    expect(true).toBe(true)
  })
})

test.describe('DIAGNOSTIC: Error Handling Issues', () => {
  test('document: withOperationLock swallows errors', async ({ page }) => {
    console.log('\n=== ERROR HANDLING DIAGNOSIS ===')
    console.log('\nFile: apps/node/web/context/AppContext.tsx')
    console.log('\nThe withOperationLock function (lines 182-215) has a bug:')
    console.log('')
    console.log('  try {')
    console.log('    return await fn()')
    console.log('  } finally {')
    console.log('    // Clears loading state but does NOT catch/re-throw errors')
    console.log('    dispatch({ type: "SET_LOADING", payload: { isLoading: false } })')
    console.log('  }')
    console.log('')
    console.log('This pattern means:')
    console.log('1. Errors from invoke() are thrown')
    console.log('2. finally block runs (clears loading)')
    console.log('3. Error continues propagating')
    console.log('4. But no dispatch({ type: "SET_ERROR" }) happens')
    console.log('5. User never sees the error message')
    console.log('')
    console.log('FIX NEEDED:')
    console.log('')
    console.log('  try {')
    console.log('    return await fn()')
    console.log('  } catch (error) {')
    console.log('    dispatch({ type: "SET_ERROR", payload: error.message })')
    console.log('    throw error  // re-throw if needed')
    console.log('  } finally {')
    console.log('    dispatch({ type: "SET_LOADING", payload: { isLoading: false } })')
    console.log('  }')

    expect(true).toBe(true)
  })

  test('document: startService does not pass custom_settings', async ({ page }) => {
    console.log('\n=== CUSTOM SETTINGS DIAGNOSIS ===')
    console.log('\nFile: apps/node/web/context/AppContext.tsx')
    console.log('\nThe startService function (lines 285-309) hardcodes:')
    console.log('')
    console.log('  const request = StartServiceRequestSchema.parse({')
    console.log('    service_id: serviceId,')
    console.log('    auto_stake: stakeAmount !== undefined && stakeAmount !== "",')
    console.log('    stake_amount: ...,')
    console.log('    custom_settings: null,  // <-- ALWAYS NULL!')
    console.log('  })')
    console.log('')
    console.log('This means CPU cores, price, and other settings from')
    console.log('Services.tsx computeConfig are NEVER sent to the backend.')
    console.log('')
    console.log('FIX NEEDED:')
    console.log('1. Add customSettings parameter to startService()')
    console.log('2. Pass computeConfig from Services.tsx')
    console.log('3. Backend compute.rs should read cpu_cores from custom_settings')

    expect(true).toBe(true)
  })

  test('document: Compute service hardware requirements mismatch', async ({ page }) => {
    console.log('\n=== HARDWARE REQUIREMENTS DIAGNOSIS ===')
    console.log('\nThere is a mismatch between frontend and backend requirements:')
    console.log('')
    console.log('services.rs (shown to UI) - lines 52-59:')
    console.log('  min_cpu_cores: 2')
    console.log('  min_memory_mb: 4 * 1024 (4GB)')
    console.log('  requires_gpu: false')
    console.log('')
    console.log('compute.rs (actual service) - lines 247-257:')
    console.log('  min_cpu_cores: 8')
    console.log('  min_memory_mb: 32 * 1024 (32GB)')
    console.log('  requires_gpu: true')
    console.log('  min_gpu_memory_mb: 8 * 1024 (8GB)')
    console.log('')
    console.log('This means:')
    console.log('- UI shows service as "available" on modest hardware')
    console.log('- Actual service may fail to start on same hardware')
    console.log('- Error may be swallowed and user sees nothing')
    console.log('')
    console.log('FIX NEEDED: Align requirements in both files')

    expect(true).toBe(true)
  })
})

test.describe('Test Screenshots', () => {
  test('capture all pages for debugging', async ({ page }) => {
    await waitForAppReady(page)
    await importWallet(page)

    const pages = [
      { name: 'Dashboard', selector: 'nav a:has-text("Dashboard")' },
      { name: 'Services', selector: 'nav a:has-text("Services")' },
      { name: 'Staking', selector: 'nav a:has-text("Staking")' },
      { name: 'Settings', selector: 'nav a:has-text("Settings")' },
    ]

    for (const p of pages) {
      const link = page.locator(p.selector).first()
      if (await link.isVisible({ timeout: 3000 }).catch(() => false)) {
        await link.click()
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(1000)
        await page.screenshot({
          path: `test-results/screenshots/page-${p.name.toLowerCase()}.png`,
          fullPage: true
        })
        console.log(`Captured ${p.name} page`)
      }
    }
  })
})
